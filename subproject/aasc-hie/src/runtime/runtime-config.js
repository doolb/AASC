const nonNegative = (value, fallback) => {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number < 0) throw new Error('runtime interval must be a non-negative number');
  return number;
};

export const normalizeRuntimeConfig = (options = {}) => {
  const source = options.runtime ?? options.config ?? options;
  return {
    recognitionIntervalMs: nonNegative(source.recognitionIntervalMs, 250),
    predictionIntervalMs: nonNegative(source.predictionIntervalMs, 100),
    abnormalObservationLimit: Math.max(1, Math.floor(Number(source.abnormalObservationLimit ?? 5))),
    commandFailureLimit: Math.max(1, Math.floor(Number(source.commandFailureLimit ?? 5))),
    execution: { enabled: source.execution?.enabled === true },
  };
};
