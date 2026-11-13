import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { BattleHudRecognizer } from '../../src/recognition/battle-hud-recognizer.js';

const frame = (green = false) => {
  const png = new PNG({ width: 12, height: 8 });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = green ? 20 : 20;
    png.data[index + 1] = green ? 200 : 20;
    png.data[index + 2] = green ? 20 : 200;
    png.data[index + 3] = 255;
  }
  return { buffer: PNG.sync.write(png), observedAt: 100, source: 'fixture' };
};

describe('BattleHudRecognizer', () => {
  it('recognizes configured HUD bars and only calls entity detection on a confirmed frame', async () => {
    let calls = 0;
    const recognizer = new BattleHudRecognizer({ uiId: 'battle', width: 12, height: 8,
      healthBar: { x: 0, y: 0, width: 12, height: 2 },
      entityDetector: { detect: async () => { calls += 1; return [{ id: 'enemy', team: 'enemy', attackable: true, confidence: 1 }]; } },
    });
    expect(await recognizer.observe(frame(true))).toMatchObject({ ui: [{ id: 'battle' }], values: { healthRatio: { value: 1 } }, entities: [{ id: 'enemy' }] });
    expect(await recognizer.observe(frame(false))).toMatchObject({ ui: [], entities: [], confidence: 0 });
    expect(calls).toBe(1);
  });

  it('rejects a different display size instead of using misaligned coordinates', async () => {
    const recognizer = new BattleHudRecognizer({ uiId: 'battle', width: 20, height: 8,
      healthBar: { x: 0, y: 0, width: 12, height: 2 },
    });
    expect(await recognizer.observe(frame(true))).toMatchObject({ ui: [], confidence: 0 });
  });
});
