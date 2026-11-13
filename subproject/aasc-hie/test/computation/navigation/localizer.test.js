import { describe, expect, it } from 'vitest';
import { Localizer } from '../../../src/computation/navigation/localizer.js';

describe('Localizer', () => {
  it('localizes from a configured key landmark', () => {
    const localizer = new Localizer();
    const result = localizer.update({ landmarks: [{ id: 'tower', position: { x: 12, z: 8 } }] }, {
      landmarks: [{ id: 'tower', position: { x: 100, z: 50 } }],
    });

    expect(result).toMatchObject({ method: 'landmark', confidence: 1, position: { x: 100, z: 50 } });
  });

  it('uses a timestamped motion sample to advance the last known position', () => {
    const localizer = new Localizer();
    localizer.update({ position: { x: 10, z: 20 }, observedAt: 100 }, {});

    expect(localizer.update({ observedAt: 200, motion: { available: true, velocity: { x: 100, z: 0 }, durationMs: 100 } }, {})).toMatchObject({
      method: 'motion', position: { x: 20, z: 20 }, confidence: 0.7,
    });
  });

  it('decays confidence and requests a stop after localization is lost', () => {
    const localizer = new Localizer({ lostFrameLimit: 2 });
    localizer.update({ position: { x: 10, z: 20 }, observedAt: 100 }, {});

    localizer.update({ observedAt: 200 }, {});
    expect(localizer.update({ observedAt: 300 }, {})).toMatchObject({ method: 'lost', requiresStop: true, confidence: 0 });
  });

  it('recovers confidence and clears the lost-frame count after a landmark returns', () => {
    const localizer = new Localizer({ lostFrameLimit: 3 });
    localizer.update({ position: { x: 10, z: 20 }, observedAt: 100 }, {});
    localizer.update({ observedAt: 200 }, {});

    expect(localizer.update({ landmarks: [{ id: 'tower', confidence: 0.9 }], observedAt: 300 }, {
      landmarks: [{ id: 'tower', position: { x: 12, z: 22 } }],
    })).toMatchObject({ method: 'landmark', position: { x: 12, z: 22 }, confidence: 0.9, requiresStop: false });
    expect(localizer.update({ observedAt: 400 }, {})).toMatchObject({ confidence: expect.closeTo(2 / 3, 5), lostFrames: 1 });
  });
});
