import { describe, expect, it } from 'vitest';
import { parseImageDescriptor } from '../../src/flow/filename-parser.js';

describe('parseImageDescriptor', () => {
  it('parses goto and legacy click options from one image stem', () => {
    const descriptor = parseImageDescriptor(
      'launch',
      '/tmp/enter@0.9,clickpoint@0.6&0.5,delay@800,goto@home.png',
    );

    expect(descriptor.name).toBe('enter@0.9,clickpoint@0.6&0.5,delay@800,goto@home');
    expect(descriptor.queue).toBe(0);
    expect(descriptor.threshold).toBe(0.9);
    expect(descriptor.clickPoint).toEqual({ x: 0.6, y: 0.5 });
    expect(descriptor.delayMs).toBe(800);
    expect(descriptor.gotoFlow).toBe('home');
  });

  it('rejects a goto target that can escape the flow root', () => {
    expect(() => parseImageDescriptor('launch', '/tmp/a@0.9,goto@...png'))
      .toThrow('invalid goto flow id');
  });

  it('keeps negative queue and legacy flags', () => {
    const descriptor = parseImageDescriptor(
      'home', '/tmp/a@0.8,~10@0.7,default,loop,wait,clickpoint_ab@0&0.png',
    );

    expect(descriptor.queue).toBe(-10);
    expect(descriptor.defaultCandidate).toBe(true);
    expect(descriptor.loop).toBe(true);
    expect(descriptor.wait).toBe(true);
    expect(descriptor.centerClick).toBe(true);
  });

  it('parses OCR text as an additional image condition', () => {
    const descriptor = parseImageDescriptor(
      'launch', '/tmp/enter@0.9,ocr@放弃福利,clickpoint@0.5&0.5,goto@home.png',
    );

    expect(descriptor.ocrText).toBe('放弃福利');
    expect(descriptor.threshold).toBe(0.9);
    expect(descriptor.gotoFlow).toBe('home');
  });

  it('rejects an empty OCR condition', () => {
    expect(() => parseImageDescriptor('launch', '/tmp/enter@0.9,ocr@.png'))
      .toThrow('missing OCR text');
  });
});
