import { describe, expect, it } from 'vitest';
import { ClockModel } from '../../src/computation/clock-model.js';

describe('ClockModel', () => {
  it('calibrates game time and advances from monotonic time when the hint is missing', () => {
    const clock = new ClockModel({ driftToleranceMs: 100 });

    expect(clock.update({ gameTime: 1_000, confidence: 0.9 }, 10_000)).toMatchObject({
      observedAt: 10_000,
      gameTime: 1_000,
      confidence: 0.9,
      paused: false,
    });
    expect(clock.update('unknown', 10_500)).toMatchObject({
      observedAt: 10_500,
      gameTime: 1_500,
      confidence: expect.any(Number),
      paused: false,
    });
  });

  it('holds game time while paused and resumes from the pause boundary', () => {
    const clock = new ClockModel();
    clock.update({ gameTime: 1_000 }, 10_000);

    expect(clock.update({ gameTime: 1_100, paused: true }, 10_100)).toMatchObject({
      gameTime: 1_100,
      paused: true,
    });
    expect(clock.update(undefined, 20_000)).toMatchObject({ gameTime: 1_100, paused: true });
    expect(clock.update({ gameTime: 1_200, paused: false }, 20_100)).toMatchObject({
      gameTime: 1_200,
      paused: false,
    });
    expect(clock.update(undefined, 20_600)).toMatchObject({ gameTime: 1_700, paused: false });
  });

  it('freezes the predicted value at a pause boundary when the HUD value is absent', () => {
    const clock = new ClockModel();
    clock.update(1_000, 10_000);

    expect(clock.update({ paused: true }, 10_500)).toMatchObject({ gameTime: 1_500, paused: true });
    expect(clock.update(undefined, 20_000)).toMatchObject({ gameTime: 1_500, paused: true });
  });

  it('reports and applies a clock drift correction beyond the tolerance', () => {
    const clock = new ClockModel({ driftToleranceMs: 50 });
    clock.update(1_000, 10_000);
    const result = clock.update({ gameTime: 1_500 }, 10_100);

    expect(result).toMatchObject({ gameTime: 1_500 });
    expect(result.events).toEqual([
      expect.objectContaining({ type: 'clock-adjusted', observedAt: 10_100 }),
    ]);
  });

  it('reports large HUD corrections at pause, during pause, and on resume', () => {
    const clock = new ClockModel({ driftToleranceMs: 50 });
    clock.update(1_000, 10_000);

    const pause = clock.update({ gameTime: 2_000, paused: true }, 10_100);
    const paused = clock.update({ gameTime: 3_000, paused: true }, 10_200);
    const resume = clock.update({ gameTime: 4_000, paused: false }, 10_300);

    expect(pause.events[0]).toMatchObject({ type: 'clock-adjusted', driftMs: 900 });
    expect(paused.events[0]).toMatchObject({ type: 'clock-adjusted', driftMs: 1_000 });
    expect(resume.events[0]).toMatchObject({ type: 'clock-adjusted', driftMs: 1_000 });
  });
});
