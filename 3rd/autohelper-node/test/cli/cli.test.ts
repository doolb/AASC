import { describe, expect, it } from 'vitest';
import { parseCli } from '../../src/cli.js';

describe('CLI parser', () => {
  it('parses start options and enables dry-run', () => {
    const options = parseCli([
      'start',
      '--device', 'd',
      '--flow', 'launch',
      '--dry-run',
      '--once',
    ]);

    expect(options).toMatchObject({
      command: 'start',
      device: 'd',
      flow: 'launch',
      dryRun: true,
      once: true,
    });
  });

  it('parses capture regions and numeric runtime options', () => {
    const options = parseCli([
      'capture',
      '--device', 'd',
      '--flow', 'launch',
      '--name', 'button@0.9',
      '--region', '1,2,30,40',
    ]);

    expect(options).toMatchObject({
      command: 'capture',
      region: { x: 1, y: 2, width: 30, height: 40 },
    });
  });

  it('requires device and flow for start', () => {
    expect(() => parseCli(['start'])).toThrow('start requires --device and --flow');
  });

  it('parses OCR connection options for start', () => {
    const options = parseCli([
      'start',
      '--device', 'd',
      '--flow', 'launch',
      '--ocr-url', 'http://127.0.0.1:8081',
      '--ocr-short-side', '720',
    ]);

    expect(options).toMatchObject({
      command: 'start',
      ocrUrl: 'http://127.0.0.1:8081',
      ocrShortSide: 720,
    });
    expect(options).not.toHaveProperty('ocrDisplay');
  });

  it('does not expose a display selector for OCR', () => {
    expect(() => parseCli([
      'start',
      '--device', 'd',
      '--flow', 'launch',
      '--ocr-display', '2',
    ])).toThrow('Unknown option');
  });
});
