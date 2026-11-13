const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const confidence = (value) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);
const unknown = () => ({ value: 'unknown', confidence: 0 });

const normalizeItem = (value) => {
  if (!isObject(value)) return { value, confidence: value === undefined ? 0 : 1 };
  return { ...value, confidence: confidence(value.confidence) };
};

const normalizeCollection = (value) => {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map(normalizeItem);
};

const normalizeValues = (values, sensorIds = []) => {
  const result = {};
  if (isObject(values)) {
    for (const [key, value] of Object.entries(values)) {
      result[key] = isObject(value) && Object.prototype.hasOwnProperty.call(value, 'value')
        ? { ...value, value: value.value ?? 'unknown', confidence: confidence(value.confidence) }
        : { value, confidence: value === undefined ? 0 : 1 };
    }
  }
  for (const sensorId of sensorIds) {
    if (typeof sensorId === 'string' && sensorId && !Object.prototype.hasOwnProperty.call(result, sensorId)) result[sensorId] = unknown();
  }
  return result;
};

const collectionConfidence = (values) => {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + confidence(value.confidence), 0) / values.length;
};

const valuesConfidence = (values) => {
  const entries = Object.values(values);
  return entries.length ? entries.reduce((sum, value) => sum + confidence(value.confidence), 0) / entries.length : 0;
};

/** Normalize all recognition results into the cross-layer observation contract. */
export const normalizeObservation = (input = {}) => {
  if (!isObject(input)) throw new Error('observation must be an object');
  const ui = normalizeCollection(input.ui);
  const entities = normalizeCollection(input.entities);
  const sensorIds = [
    ...(Array.isArray(input.sensorIds) ? input.sensorIds : []),
    ...(isObject(input.sensors) ? Object.keys(input.sensors) : []),
  ];
  const values = normalizeValues(input.values, sensorIds);
  const map = input.map === undefined ? {} : normalizeItem(input.map);
  const domainConfidence = [
    collectionConfidence(ui),
    collectionConfidence(entities),
    confidence(map.confidence),
    valuesConfidence(values),
  ];
  const inferredConfidence = domainConfidence.reduce((sum, value) => sum + value, 0) / domainConfidence.length;
  return {
    observedAt: Number.isFinite(input.observedAt) ? input.observedAt : Date.now(),
    gameTimeHint: input.gameTimeHint ?? input.gameTime ?? 'unknown',
    source: typeof input.source === 'string' && input.source ? input.source : 'unknown',
    ui,
    entities,
    map,
    values,
    ...(input.freshness === undefined ? {} : { freshness: input.freshness }),
    confidence: input.confidence === undefined ? inferredConfidence : confidence(input.confidence),
  };
};

export { unknown as unknownObservationValue };
