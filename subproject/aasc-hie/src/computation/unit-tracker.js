const finite = (value) => Number.isFinite(value);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const clamp = (value, fallback = 0) => finite(value) ? Math.max(0, Math.min(1, value)) : fallback;
const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
};

const positionOf = (detection) => {
  const value = detection?.position ?? detection?.worldPosition;
  if (Array.isArray(value)) {
    const [x, y, z] = value;
    if (finite(x) && finite(y)) return { x, y, ...(finite(z) ? { z } : {}) };
  }
  if (isObject(value) && finite(value.x) && (finite(value.y) || finite(value.z))) {
    return { x: value.x, ...(finite(value.y) ? { y: value.y } : {}), ...(finite(value.z) ? { z: value.z } : {}) };
  }
  if (finite(detection?.x) && (finite(detection?.y) || finite(detection?.z))) {
    return { x: detection.x, ...(finite(detection.y) ? { y: detection.y } : {}), ...(finite(detection.z) ? { z: detection.z } : {}) };
  }
  return null;
};

const distance = (left, right) => {
  if (!left || !right) return Infinity;
  const dx = left.x - right.x;
  const dy = (left.y ?? 0) - (right.y ?? 0);
  const dz = (left.z ?? 0) - (right.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

const vector = (current, previous, deltaMs) => {
  if (!current || !previous || !finite(deltaMs) || deltaMs <= 0) return { x: 0, y: 0 };
  return {
    x: (current.x - previous.x) / deltaMs,
    ...(current.y !== undefined && previous.y !== undefined
      ? { y: (current.y - previous.y) / deltaMs }
      : {}),
    ...(current.z !== undefined && previous.z !== undefined
      ? { z: (current.z - previous.z) / deltaMs }
      : {}),
  };
};

const moved = (position, velocity, elapsed) => position && velocity
  ? {
    x: position.x + velocity.x * elapsed,
    ...(position.y !== undefined && velocity.y !== undefined
      ? { y: position.y + velocity.y * elapsed }
      : {}),
    ...(position.z !== undefined && velocity.z !== undefined
      ? { z: position.z + velocity.z * elapsed }
      : {}),
  }
  : position;

/** Associate detections into short-lived, time-aware tracked units. */
export class UnitTracker {
  constructor(options = {}) {
    this.ttlMs = options.ttlMs ?? 1_200;
    this.associationDistance = options.associationDistance ?? 80;
    this.nextId = 1;
  }

  update(units = [], detections = [], now) {
    if (!finite(now)) throw new Error('now must be finite');
    const previous = Array.isArray(units) ? units : [];
    const available = new Set(previous.map((_, index) => index));
    const result = [];

    for (const detection of Array.isArray(detections) ? detections : []) {
      if (!isObject(detection)) continue;
      const position = positionOf(detection);
      let matchIndex = detection.id === undefined
        ? undefined
        : previous.findIndex((unit) => unit.id === detection.id && available.has(previous.indexOf(unit)));
      if (matchIndex === -1) matchIndex = undefined;
      if (matchIndex === undefined) {
        let bestDistance = this.associationDistance;
        for (const index of available) {
          const candidate = previous[index];
          if (candidate.category !== detection.category || candidate.team !== detection.team) continue;
          const candidateDistance = distance(candidate.position, position);
          if (candidateDistance <= bestDistance) {
            bestDistance = candidateDistance;
            matchIndex = index;
          }
        }
      }

      const previousUnit = matchIndex === undefined ? undefined : previous[matchIndex];
      if (matchIndex !== undefined) available.delete(matchIndex);
      const observedAt = finite(detection.observedAt) ? detection.observedAt : now;
      const ttlMs = finite(detection.ttlMs) ? detection.ttlMs : this.ttlMs;
      const validUntil = observedAt + ttlMs;
      const stale = now >= validUntil;
      const velocity = vector(position, previousUnit?.position, observedAt - (previousUnit?.observedAt ?? observedAt));
      const id = detection.id ?? previousUnit?.id ?? `unit-${this.nextId++}`;
      result.push({
        ...clone(detection),
        id,
        position: position ?? previousUnit?.position ?? null,
        velocity: detection.velocity ?? velocity,
        observedAt,
        gameTime: detection.gameTime ?? previousUnit?.gameTime,
        confidence: stale ? 0 : clamp(detection.confidence, previousUnit?.confidence ?? 0),
        lastSeenAt: observedAt,
        validUntil,
        visible: stale ? false : (detection.visible ?? true),
        stale,
        freshness: { ageMs: Math.max(0, now - observedAt), remainingMs: Math.max(0, validUntil - now), stale },
      });
    }

    for (const index of available) {
      const unit = previous[index];
      const elapsed = Math.max(0, now - unit.lastSeenAt);
      const validUntil = unit.validUntil ?? unit.lastSeenAt + this.ttlMs;
      const stale = now >= validUntil;
      const extrapolation = Math.min(elapsed, Math.max(0, validUntil - unit.lastSeenAt));
      result.push({
        ...unit,
        position: moved(unit.position, unit.velocity, extrapolation),
        confidence: stale ? 0 : clamp(unit.confidence * Math.max(0, 1 - elapsed / Math.max(1, validUntil - unit.lastSeenAt)), 0),
        visible: false,
        stale,
        freshness: { ageMs: elapsed, remainingMs: Math.max(0, validUntil - now), stale },
      });
    }
    return result;
  }

  active(units, now = undefined) {
    return (Array.isArray(units) ? units : []).filter((unit) => (
      !unit.stale && (now === undefined || now < (unit.validUntil ?? Infinity))
    ));
  }
}

export { positionOf, distance };
