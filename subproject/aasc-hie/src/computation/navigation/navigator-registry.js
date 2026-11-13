const validMode = (mode) => typeof mode === 'string' && mode.trim().length > 0;
const modesFor = (navigationPackage) => [...new Set([
  ...(navigationPackage?.metadata?.navigators ?? []),
  ...(navigationPackage?.scenarios ?? []).flatMap((scenario) => scenario.navigators ?? []),
  ...(navigationPackage?.flows ?? []).map((flow) => flow.navigator),
].filter(validMode).map((mode) => mode.trim()))];

/** Resolve configured navigator modes without embedding application-specific branches. */
export class NavigatorRegistry {
  constructor(entries = []) {
    this.factories = new Map();
    if (entries instanceof Map) for (const [mode, factory] of entries) this.register(mode, factory);
    else for (const entry of entries) this.register(entry.mode ?? entry[0], entry.factory ?? entry[1]);
  }

  register(mode, factory) {
    if (!validMode(mode)) throw new Error('navigator mode is required');
    if (typeof factory !== 'function') throw new Error(`navigator factory is required: ${mode}`);
    const normalized = mode.trim();
    if (this.factories.has(normalized)) throw new Error(`navigator mode is already registered: ${normalized}`);
    this.factories.set(normalized, factory);
    return this;
  }

  has(mode) { return this.factories.has(mode); }
  create(mode, options = {}) {
    if (!this.factories.has(mode)) throw new Error(`navigator mode is not registered: ${mode}`);
    return this.factories.get(mode)({ ...options, mode });
  }

  createForPackage(navigationPackage, configs = {}) {
    return modesFor(navigationPackage).map((mode) => {
      const config = configs instanceof Map ? configs.get(mode) : configs[mode];
      return this.create(mode, { ...(config ?? {}), config });
    });
  }
}
