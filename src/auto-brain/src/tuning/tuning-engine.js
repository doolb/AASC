'use strict';

class TuningEngine {
  constructor() {
    this.snapshot = {
      threshold: 0.5,
      cooldownMs: 1000,
      weight: 1
    };
  }

  adjust(feedback) {
    const reward = typeof feedback.reward === 'number' ? feedback.reward : 0;
    const thresholdDelta = reward > 0 ? -0.01 : 0.01;
    const nextThreshold = Math.max(0.1, Math.min(0.9, this.snapshot.threshold + thresholdDelta));
    this.snapshot = {
      ...this.snapshot,
      threshold: nextThreshold
    };
    return this.snapshot;
  }
}

module.exports = {
  TuningEngine
};
