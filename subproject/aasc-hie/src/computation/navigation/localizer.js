const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
};

const finitePosition = (value) => value && Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.z));

/** Runtime position estimator using configured landmarks and motion feedback. */
export class Localizer {
  constructor(options = {}) {
    this.lostFrameLimit = Math.max(1, Number(options.lostFrameLimit ?? 3));
    this.last = undefined;
    this.lostFrames = 0;
  }

  update(observation = {}, map = {}) {
    const direct = observation.position ?? observation.map?.position;
    if (finitePosition(direct)) return this.accept(direct, Number(observation.confidence ?? 1), 'direct', observation.observedAt);

    const observedLandmarks = observation.landmarks ?? observation.map?.landmarks ?? [];
    const configured = map.landmarks ?? [];
    for (const observed of observedLandmarks) {
      const known = configured.find((landmark) => landmark?.id === observed?.id);
      if (known && finitePosition(known.position)) return this.accept(known.position, Number(observed.confidence ?? 1), 'landmark', observation.observedAt);
    }

    const motion = observation.motion ?? observation.map?.motion;
    if (this.last && motion?.available && finitePosition(motion.velocity)) {
      const seconds = Number(motion.durationMs ?? 0) / 1000;
      if (seconds > 0) return this.accept({ x: this.last.position.x + Number(motion.velocity.x) * seconds, z: this.last.position.z + Number(motion.velocity.z) * seconds }, 0.7, 'motion', observation.observedAt);
    }

    this.lostFrames += 1;
    const confidence = Math.max(0, 1 - this.lostFrames / this.lostFrameLimit);
    return { available: false, method: 'lost', position: this.last?.position, confidence, lostFrames: this.lostFrames, requiresStop: this.lostFrames >= this.lostFrameLimit };
  }

  accept(position, confidence, method, observedAt) {
    const normalized = { x: Number(position.x), z: Number(position.z), ...(position.y === undefined ? {} : { y: Number(position.y) }) };
    this.last = { position: normalized, observedAt };
    this.lostFrames = 0;
    return { available: true, method, position: clone(normalized), confidence: Math.max(0, Math.min(1, Number(confidence) || 0)), requiresStop: false };
  }
}
