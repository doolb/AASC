import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AdbFrameSource } from '../../src/recognition/frame-source.js';
import {
  FrameSource,
  Recognizer,
  normalizeObservation,
} from '../../src/recognition/index.js';

const frame = { buffer: Buffer.from('frame'), observedAt: 1000, source: 'fixture' };

describe('recognition boundary', () => {
  it('returns normalized observations only and gates OCR on its trigger', async () => {
    let ocrCalls = 0;
    const recognizer = new Recognizer({
      ocrClient: {
        read: async () => {
          ocrCalls += 1;
          return { boxes: [] };
        },
      },
    });

    const observation = await recognizer.observe(frame, {
      sensorIds: ['battleText'],
      ocr: { trigger: false },
    });

    expect(observation).toMatchObject({
      observedAt: 1000,
      source: 'fixture',
      values: { battleText: { value: 'unknown', confidence: 0 } },
      confidence: 0,
    });
    expect(observation).not.toHaveProperty('goal');
    expect(observation).not.toHaveProperty('alert');
    expect(observation).not.toHaveProperty('command');
    expect(ocrCalls).toBe(0);
  });

  it('can trigger OCR and still returns observations rather than actions', async () => {
    const recognizer = new Recognizer({
      ocrClient: { read: async () => ({ boxes: [{ text: 'ready', score: 0.9, points: [] }] }) },
    });

    const observation = await recognizer.observe(frame, {
      ocr: { trigger: true, valueKey: 'battleText' },
    });

    expect(observation.values.battleText).toMatchObject({
      value: 'ready',
      confidence: 0.9,
    });
  });

  it('gates OCR through a package-configured sensor predicate', async () => {
    let calls = 0;
    const recognizer = new Recognizer({
      ocrClient: {
        read: async () => {
          calls += 1;
          return { boxes: [{ text: 'battle', score: 0.88, points: [] }] };
        },
      },
    });
    const context = {
      values: { battleTextRequired: false },
      sensors: {
        battleText: {
          detector: 'ocr',
          valueKey: 'battleText',
          trigger: 'values.battleTextRequired == true',
        },
      },
    };

    const skipped = await recognizer.observe(frame, context);

    expect(calls).toBe(0);
    expect(skipped.values.battleText).toEqual({ value: 'unknown', confidence: 0 });

    const observation = await recognizer.observe(frame, {
      ...context,
      values: { battleTextRequired: true },
    });

    expect(calls).toBe(1);
    expect(observation.values.battleText).toMatchObject({ value: 'battle', confidence: 0.88 });
  });

  it('preserves literal true and legacy non-empty string OCR triggers', async () => {
    let calls = 0;
    const recognizer = new Recognizer({
      ocrClient: {
        read: async () => {
          calls += 1;
          return { boxes: [{ text: 'ok', score: 0.9, points: [] }] };
        },
      },
    });

    const literal = await recognizer.observe(frame, {
      ocr: { trigger: '  TrUe  ', valueKey: 'literal' },
    });
    const legacy = await recognizer.observe(frame, {
      ocr: { trigger: 'legacy-non-empty-trigger', valueKey: 'legacy' },
    });

    expect(calls).toBe(2);
    expect(literal.values.literal).toMatchObject({ value: 'ok', confidence: 0.9 });
    expect(legacy.values.legacy).toMatchObject({ value: 'ok', confidence: 0.9 });
  });

  it('implements the FrameSource.next contract without input side effects', async () => {
    const expected = { buffer: Buffer.from('frame'), observedAt: 1000, source: 'replay' };
    const source = new FrameSource(async () => expected);

    await expect(source.next()).resolves.toBe(expected);
    await expect(new FrameSource(async () => ({ buffer: expected.buffer })).next())
      .rejects.toThrow('must return { buffer, observedAt, source }');
  });

  it('captures frames only from an explicitly selected ADB client', async () => {
    let checks = 0;
    const source = new AdbFrameSource({
      client: {
        serial: 'device-1',
        assertConnected: async () => { checks += 1; },
        screenshot: async () => Buffer.from('png'),
      },
      verifyConnection: true,
      now: () => 123,
    });

    await expect(source.next()).resolves.toMatchObject({ buffer: Buffer.from('png'), observedAt: 123, source: 'adb:device-1' });
    expect(checks).toBe(1);
    expect(() => new AdbFrameSource({ client: { screenshot: async () => Buffer.from('png') } })).toThrow('explicit ADB client serial');
  });

  it('keeps recognition modules independent of execution and input side effects', async () => {
    const root = resolve(import.meta.dirname, '../../src/recognition');
    const files = (await import('node:fs/promises')).readdir(root);
    for (const file of (await files).filter((value) => value.endsWith('.js'))) {
      const source = await readFile(resolve(root, file), 'utf8');
      expect(source).not.toMatch(/src\/execution|adb input|selectGoal|emitAlert/);
    }
  });

  it('exports the normalizer as a pure recognition contract', () => {
    expect(normalizeObservation({ observedAt: 1, source: 'test' })).toMatchObject({
      observedAt: 1,
      source: 'test',
      confidence: 0,
    });
  });
});
