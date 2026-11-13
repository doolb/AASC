const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => Number.isFinite(value);
const confidenceOf = (value, fallback = 0) => (
  finite(value) ? Math.max(0, Math.min(1, value)) : fallback
);
const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
};

const timed = (value, metadata, validUntil) => {
  const result = isObject(value) && own(value, 'value') ? clone(value) : { value: clone(value) };
  return {
    ...result,
    observedAt: metadata.observedAt,
    gameTime: metadata.gameTime,
    confidence: confidenceOf(result.confidence, metadata.confidence),
    lastSeenAt: metadata.observedAt,
    validUntil,
    stale: false,
    freshness: { ageMs: 0, remainingMs: Math.max(0, validUntil - metadata.observedAt), stale: false },
  };
};

const refreshTimed = (value, observedAt) => {
  if (!isObject(value) || !finite(value.lastSeenAt) || !finite(value.validUntil)) return value;
  const stale = observedAt >= value.validUntil;
  return {
    ...value,
    stale,
    freshness: {
      ageMs: Math.max(0, observedAt - value.lastSeenAt),
      remainingMs: Math.max(0, value.validUntil - observedAt),
      stale,
    },
  };
};

const timedObject = (value, metadata) => ({
  ...(isObject(value) ? clone(value) : { value: clone(value) }),
  observedAt: metadata.observedAt,
  gameTime: metadata.gameTime,
  confidence: confidenceOf(value?.confidence, metadata.confidence),
});

const visibleLayers = (observation, previous, metadata) => {
  if (!Array.isArray(observation.ui)) return previous?.ui?.layers ?? [];
  return observation.ui.filter((layer) => layer?.visible !== false).map((layer) => ({
    ...clone(layer),
    observedAt: metadata.observedAt,
    gameTime: metadata.gameTime,
    confidence: confidenceOf(layer?.confidence, metadata.confidence),
  }));
};

const topmostLayer = (layers, observation, previous) => {
  const uiObserved = Array.isArray(observation.ui);
  if (uiObserved && layers.length === 0) return null;
  if (!uiObserved) return previous?.ui?.topmost ?? null;
  const requested = observation.topmost ?? observation.uiTopmost;
  if (typeof requested === 'string' && layers.some((layer) => layer.id === requested)) return requested;
  const ranked = layers
    .map((layer, index) => ({ layer, index }))
    .sort((a, b) => (Number.isFinite(a.layer.zIndex) ? a.layer.zIndex : a.index)
      - (Number.isFinite(b.layer.zIndex) ? b.layer.zIndex : b.index));
  return ranked.at(-1)?.layer?.id ?? null;
};

/** Purely merge one observation into a new world-state object. */
export class StateFusion {
  constructor(options = {}) {
    this.valueTtlMs = options.valueTtlMs ?? options.ttlMs ?? 1_000;
  }

  merge(worldState = {}, observation = {}, clockState = {}) {
    const observedAt = finite(observation.observedAt)
      ? observation.observedAt
      : (clockState.observedAt ?? worldState.observedAt ?? 0);
    const gameTime = clockState.gameTime ?? observation.gameTime ?? worldState.gameTime ?? 0;
    const stateConfidence = confidenceOf(
      observation.confidence,
      confidenceOf(clockState.confidence, confidenceOf(worldState.confidence)),
    );
    const metadata = { observedAt, gameTime, confidence: stateConfidence };
    const previousValues = isObject(worldState.values) ? worldState.values : {};
    const values = Object.fromEntries(
      Object.entries(previousValues).map(([key, value]) => [key, refreshTimed(value, observedAt)]),
    );
    if (isObject(observation.values)) {
      for (const [key, value] of Object.entries(observation.values)) {
        values[key] = timed(value, metadata, observedAt + this.valueTtlMs);
      }
    }

    const layers = visibleLayers(observation, worldState, metadata);
    const ui = {
      layers,
      topmost: topmostLayer(layers, observation, worldState),
      observedAt,
      gameTime,
      confidence: confidenceOf(observation.uiConfidence, stateConfidence),
    };
    const map = observation.map === undefined
      ? (worldState.map ?? {})
      : timedObject(observation.map, metadata);
    const entities = Array.isArray(observation.entities)
      ? observation.entities.map((entity) => clone(entity))
      : (worldState.entities ?? []);

    return {
      ...worldState,
      observedAt,
      gameTime,
      confidence: stateConfidence,
      ui,
      values,
      map,
      entities,
      ...(observation.source !== undefined ? { source: observation.source } : {}),
    };
  }
}

export const mergeState = (worldState, observation, clockState, options) => (
  new StateFusion(options).merge(worldState, observation, clockState)
);
