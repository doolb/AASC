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
});
