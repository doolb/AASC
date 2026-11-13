import { describe, expect, it } from 'vitest';
import { DepthSource, MotionEstimator } from '../../src/recognition/depth-source.js';

describe('DepthSource', () => {
  it('uses an injected depth provider and normalizes confidence', async () => {
    const source = new DepthSource({ estimate: async () => ({ depth: [1, 2], confidence: 0.8, model: 'anydepth-fp16' }) });

    await expect(source.estimate({ buffer: Buffer.from([1]) })).resolves.toMatchObject({ available: true, confidence: 0.8, model: 'anydepth-fp16' });
  });

  it('returns an unavailable result when no depth provider is configured', async () => {
    await expect(new DepthSource().estimate({ buffer: Buffer.from([1]) })).resolves.toMatchObject({ available: false, confidence: 0, reason: 'depth-provider-not-configured' });
  });
});

describe('MotionEstimator', () => {
  it('does not calculate velocity for static frames', () => {
    const estimator = new MotionEstimator();

    expect(estimator.update({ observedAt: 100, static: true }, { x: 1, z: 1 })).toMatchObject({ available: false, reason: 'static-frame' });
  });

  it('calculates velocity only from timestamped multi-frame positions', () => {
    const estimator = new MotionEstimator();
    estimator.update({ observedAt: 100 }, { x: 0, z: 0 });

    expect(estimator.update({ observedAt: 200 }, { x: 10, z: 0 })).toMatchObject({ available: true, velocity: { x: 100, z: 0 }, durationMs: 100 });
  });
});
