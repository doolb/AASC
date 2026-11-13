const finite = (value) => Number.isFinite(value);
const clampConfidence = (value, fallback = 0) => (
  finite(value) ? Math.max(0, Math.min(1, value)) : fallback
);

const parseClockValue = (hint) => {
  if (finite(hint)) return { gameTime: hint };
  if (typeof hint === 'string') {
    const value = hint.trim();
    if (!value || value.toLowerCase() === 'unknown') return {};
    if (/^\d+(?::\d{1,2}){1,2}(?:\.\d+)?$/.test(value)) {
      const parts = value.split(':').map(Number);
      const seconds = parts.length === 2
        ? parts[0] * 60 + parts[1]
        : parts[0] * 3_600 + parts[1] * 60 + parts[2];
      return { gameTime: seconds * 1_000 };
    }
    const numeric = Number(value);
    return finite(numeric) ? { gameTime: numeric } : {};
  }
  if (!hint || typeof hint !== 'object' || Array.isArray(hint)) return {};
  const raw = hint.gameTime ?? hint.value ?? hint.time;
  const parsed = parseClockValue(raw);
  return {
    ...parsed,
    ...(typeof hint.paused === 'boolean' ? { paused: hint.paused } : {}),
    ...(finite(hint.confidence) ? { confidence: hint.confidence } : {}),
    ...(typeof hint.source === 'string' && hint.source ? { source: hint.source } : {}),
    ...(finite(hint.rate) && hint.rate >= 0 ? { rate: hint.rate } : {}),
  };
};

/** Calibrate a game clock against a monotonic clock without wall-clock reads. */
export class ClockModel {
  constructor(options = {}) {
    this.driftToleranceMs = options.driftToleranceMs ?? options.driftTolerance ?? 250;
    this.fallbackConfidence = clampConfidence(options.fallbackConfidence, 0.5);
    this.defaultRate = finite(options.rate) && options.rate >= 0 ? options.rate : 1;
    this.state = null;
  }

  update(clockHint, monotonicNow) {
    if (!finite(monotonicNow)) throw new Error('monotonicNow must be finite');
    const hint = parseClockValue(clockHint);
    const previous = this.state;
    const paused = hint.paused ?? previous?.paused ?? false;
    const rate = hint.rate ?? previous?.rate ?? this.defaultRate;
    const events = [];

    if (!previous) {
      const gameTime = hint.gameTime ?? 0;
      this.state = {
        observedAt: monotonicNow,
        monotonicNow,
        gameTime,
        confidence: hint.gameTime === undefined
          ? 0
          : clampConfidence(hint.confidence, this.fallbackConfidence),
        paused,
        rate,
        source: hint.source ?? (hint.gameTime === undefined ? 'monotonic' : 'hint'),
        events,
      };
      this.anchorMonotonic = monotonicNow;
      this.anchorGameTime = gameTime;
      return this.state;
    }

    const wasPaused = previous.paused;
    const predicted = wasPaused
      ? previous.gameTime
      : this.anchorGameTime + (monotonicNow - this.anchorMonotonic) * previous.rate;
    let gameTime = predicted;
    let confidence = previous.confidence;

    if (hint.gameTime !== undefined) {
      const difference = hint.gameTime - predicted;
      // A HUD correction is anomalous independently of pause/resume state.
      if (Math.abs(difference) > this.driftToleranceMs) {
        events.push({
          type: 'clock-adjusted',
          observedAt: monotonicNow,
          previousGameTime: predicted,
          gameTime: hint.gameTime,
          driftMs: difference,
        });
      }
      gameTime = hint.gameTime;
      confidence = clampConfidence(hint.confidence, previous.confidence || this.fallbackConfidence);
      this.anchorMonotonic = monotonicNow;
      this.anchorGameTime = gameTime;
    }
    else if (paused) {
      gameTime = wasPaused ? previous.gameTime : predicted;
      this.anchorMonotonic = monotonicNow;
      this.anchorGameTime = gameTime;
      confidence = Math.max(0, previous.confidence - 0.02);
    }
    else if (wasPaused) {
      gameTime = previous.gameTime;
      this.anchorMonotonic = monotonicNow;
      this.anchorGameTime = gameTime;
      confidence = Math.max(0, previous.confidence - 0.02);
    }
    else {
      this.anchorMonotonic = previous.observedAt;
      this.anchorGameTime = previous.gameTime;
      confidence = Math.max(0, previous.confidence - 0.01);
    }

    this.state = {
      observedAt: monotonicNow,
      monotonicNow,
      gameTime,
      confidence,
      paused,
      rate,
      source: hint.source ?? previous.source,
      events,
    };
    return this.state;
  }
}

export { parseClockValue };
