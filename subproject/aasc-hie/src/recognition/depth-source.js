const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
};

const confidence = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : 0;

/** Optional depth adapter; AnyDepth/ONNX implementations are injected by the host. */
export class DepthSource {
  constructor(options = {}) { this.provider = options.estimate ?? options.provider; }

  async estimate(frame, options = {}) {
    if (typeof this.provider !== 'function') return { available: false, confidence: 0, reason: 'depth-provider-not-configured' };
    const result = await this.provider(frame, options);
    return { ...clone(result ?? {}), available: true, confidence: confidence(result?.confidence) };
  }
}

/** Estimate motion only when two non-static frames have valid timestamps. */
export class MotionEstimator {
  constructor() { this.previous = undefined; }

  update(frame = {}, position = {}) {
    if (frame.static === true) {
      this.previous = undefined;
      return { available: false, reason: 'static-frame' };
    }
    const observedAt = Number(frame.observedAt);
    const current = clone(position);
    if (!Number.isFinite(observedAt) || !Number.isFinite(Number(current.x)) || !Number.isFinite(Number(current.z))) {
      return { available: false, reason: 'timestamped-position-required' };
    }
    if (!this.previous) {
      this.previous = { observedAt, position: current };
      return { available: false, reason: 'insufficient-frames' };
    }
    const durationMs = observedAt - this.previous.observedAt;
    if (durationMs <= 0) return { available: false, reason: 'non-positive-frame-duration' };
    const velocity = {};
    for (const axis of ['x', 'y', 'z']) {
      if (Number.isFinite(Number(current[axis])) && Number.isFinite(Number(this.previous.position[axis]))) {
        velocity[axis] = (Number(current[axis]) - Number(this.previous.position[axis])) / durationMs * 1000;
      }
    }
    this.previous = { observedAt, position: current };
    return { available: true, durationMs, velocity };
  }
}
