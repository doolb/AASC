import { describe, expect, it } from 'vitest';
import { ScriptRecognitionAdapter, measureColorBarRatio } from '../../src/recognition/script-recognition.js';
import { Recognizer } from '../../src/recognition/index.js';

describe('ScriptRecognitionAdapter', () => {
  it('runs configured JavaScript recognition and returns normalized observations', async () => {
    const adapter = new ScriptRecognitionAdapter({ scripts: {
      'hok-health-mana-v1': `({ observe(input, helpers) {
        return { values: { healthRatio: helpers.measure(input.frame, 'health'), manaRatio: 0.4 }, confidence: 0.9 };
      } })`,
    }, helpers: { measure: (_frame, key) => key === 'health' ? 0.75 : 0 } });

    await expect(adapter.observe({ buffer: Buffer.from('png'), width: 1480, height: 720, observedAt: 10 }, { scriptId: 'hok-health-mana-v1' })).resolves.toMatchObject({
      values: { healthRatio: { value: 0.75, confidence: 1 }, manaRatio: { value: 0.4, confidence: 1 } }, confidence: 0.9,
    });
  });

  it('does not expose process or require and enforces script timeouts', async () => {
    const adapter = new ScriptRecognitionAdapter({ scripts: { blocked: `({ observe() { return { values: { process: typeof process, require: typeof require } }; } })` } });
    await expect(adapter.observe({ buffer: Buffer.from('x') }, { scriptId: 'blocked' })).resolves.toMatchObject({ values: { process: { value: 'undefined', confidence: 1 }, require: { value: 'undefined', confidence: 1 } } });
    const slow = new ScriptRecognitionAdapter({ timeoutMs: 5, scripts: { slow: `({ observe() { while (true) {} } })` } });
    await expect(slow.observe({ buffer: Buffer.from('x') }, { scriptId: 'slow' })).rejects.toThrow(/timed out|Script execution timed out/);
  });

  it('can be selected by the generic recognition layer for a scene', async () => {
    const scripts = new ScriptRecognitionAdapter({ scripts: { battle: `({ observe() { return { values: { healthRatio: 0.8 } }; } })` } });
    const recognizer = new Recognizer({ scriptAdapter: scripts });
    await expect(recognizer.observe({ buffer: Buffer.from('x') }, { scriptId: 'battle' })).resolves.toMatchObject({ values: { healthRatio: { value: 0.8 } } });
  });

  it('runs a configured postprocess script only after an image match', async () => {
    const adapter = new ScriptRecognitionAdapter({ scripts: {
      'combat-bars-v1': `({ postprocess(input) {
        return { entities: [{ id: input.match.id, relation: input.match.team, healthRatio: input.match.score }] };
      } })`,
    } });
    const recognizer = new Recognizer({
      matcher: { matchAll: async () => [{ matched: false, score: 0 }, { matched: true, score: 0.82 }] },
      scriptAdapter: adapter,
    });
    await expect(recognizer.observe({ buffer: Buffer.from('x') }, {
      templates: [
        { id: 'ally-bar', team: 'ally', postprocessScriptId: 'combat-bars-v1' },
        { id: 'enemy-bar', team: 'enemy', postprocessScriptId: 'combat-bars-v1' },
      ],
    })).resolves.toMatchObject({
      entities: [{ id: 'enemy-bar', relation: 'enemy', healthRatio: 0.82 }],
    });
  });
});

describe('measureColorBarRatio', () => {
  it('measures the active color proportion inside a bar ROI', () => {
    const rgba = new Uint8Array([
      0, 255, 0, 255, 0, 255, 0, 255, 20, 20, 20, 255, 20, 20, 20, 255,
    ]);
    expect(measureColorBarRatio({ width: 4, height: 1, data: rgba }, { x: 0, y: 0, width: 4, height: 1 }, { color: 'green' })).toBe(0.5);
  });
});
