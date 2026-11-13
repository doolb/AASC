const ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

const assertId = (value, field) => {
  if (typeof value !== 'string' || !value.trim() || !ID_PATTERN.test(value.trim())
    || value.trim() === '.' || value.trim() === '..') {
    throw new Error('invalid ' + field + ': ' + String(value));
  }
  return value.trim();
};

export const normalizeEnvironment = (environment = {}) => {
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
    throw new Error('environment must be an object');
  }
  const id = assertId(environment.id, 'environment id');
  if (!environment.frameSource?.next) {
    throw new Error('environment.frameSource.next is required');
  }
  return { ...environment, id };
};

export class EnvironmentRegistry {
  constructor(environments = []) {
    this.environments = new Map();
    for (const environment of environments) this.register(environment);
  }

  register(environment) {
    const normalized = normalizeEnvironment(environment);
    if (this.environments.has(normalized.id)) {
      throw new Error('environment is already registered: ' + normalized.id);
    }
    this.environments.set(normalized.id, normalized);
    return normalized;
  }

  has(id) { return this.environments.has(id); }

  get(id) {
    const environment = this.environments.get(id);
    if (!environment) throw new Error('environment is not registered: ' + String(id));
    return environment;
  }

  list() { return [...this.environments.values()]; }
}
