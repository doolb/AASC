import { evaluateExpression } from './restricted-expression.js';

const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
};

const timeMs = (value) => {
  if (value === undefined || value === null) return Date.now();
  if (Number.isFinite(Number(value))) return Number(value);
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return parsed;
  throw new Error(`invalid alert time: ${value}`);
};

const listFor = (value) => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.entries(value).map(([id, config]) => ({ id, ...config }));
  return [];
};

const contextFor = (worldState, preview) => ({
  ...(worldState && typeof worldState === 'object' ? clone(worldState) : {}),
  ...(preview && typeof preview === 'object' ? clone(preview) : {}),
  preview: clone(preview),
});

const conditionValue = (expression, context) => {
  if (!expression) return true;
  try {
    const value = evaluateExpression(expression, context);
    return value === undefined ? undefined : Boolean(value);
  } catch {
    return undefined;
  }
};

const priorityOf = (alert) => Number.isFinite(Number(alert.priority)) ? Number(alert.priority) : 0;

/** Evaluate configured warnings without selecting or executing a command. */
export class AlertEngine {
  constructor(options = {}) {
    this.alerts = listFor(options.alerts ?? options.package?.alerts);
    this.now = options.now ?? (() => Date.now());
    this.instances = new Map();
  }

  evaluate(worldState = {}, preview = {}, now = this.now()) {
    const at = timeMs(now);
    const context = contextFor(worldState, preview);
    const emitted = [];
    for (const config of this.alerts) {
      if (!config?.id) continue;
      const instance = this.instances.get(config.id) ?? { since: undefined, active: false, lastEmittedAt: undefined };
      const satisfied = conditionValue(config.when ?? config.condition, context);
      if (satisfied !== true) {
        instance.since = undefined;
        this.instances.set(config.id, instance);
        continue;
      }
      if (instance.since === undefined) instance.since = at;
      const forMs = Math.max(0, Number(config.forMs ?? 0));
      const cooldownMs = Math.max(0, Number(config.cooldownMs ?? config.cooldown ?? 0));
      const coolingDown = instance.lastEmittedAt !== undefined && at - instance.lastEmittedAt < cooldownMs;
      if (!instance.active && at - instance.since >= forMs && !coolingDown) {
        instance.active = true;
        instance.lastEmittedAt = at;
        emitted.push({
          ...clone(config),
          id: String(config.id),
          type: 'alert',
          status: 'active',
          raisedAt: at,
          stateVersion: worldState.stateVersion,
          gameTime: worldState.gameTime,
          confidence: worldState.confidence,
          sourceNavigator: config.sourceNavigator ?? preview?.sourceNavigator,
          priority: priorityOf(config),
        });
      }
      this.instances.set(config.id, instance);
    }
    return emitted.sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id)).map(clone);
  }

  clear(worldState = {}, now = this.now(), preview = {}) {
    const at = timeMs(now);
    const context = contextFor(worldState, preview);
    const cleared = [];
    for (const config of this.alerts) {
      const instance = this.instances.get(config?.id);
      if (!config?.id || !instance?.active) continue;
      const clearExpression = config.clearWhen ?? config.clear;
      const clearValue = clearExpression ? conditionValue(clearExpression, context) : !conditionValue(config.when ?? config.condition, context);
      if (clearValue !== true) continue;
      instance.active = false;
      instance.since = undefined;
      this.instances.set(config.id, instance);
      cleared.push({
        id: String(config.id),
        type: 'clear',
        status: 'cleared',
        clearedAt: at,
        stateVersion: worldState.stateVersion,
        gameTime: worldState.gameTime,
        confidence: worldState.confidence,
        sourceNavigator: config.sourceNavigator ?? preview?.sourceNavigator,
        priority: priorityOf(config),
      });
    }
    return cleared.sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id)).map(clone);
  }

  active() {
    return [...this.instances.entries()].filter(([, instance]) => instance.active).map(([id]) => id);
  }

  reset() {
    this.instances.clear();
  }
}

export const evaluateAlerts = (worldState, preview, now, options) => new AlertEngine(options).evaluate(worldState, preview, now);
