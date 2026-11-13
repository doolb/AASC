const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
};

/** Runtime control-plane state for the goal selected by a CLI or HTTP client. */
export class ActiveGoalController {
  constructor(options = {}) {
    this.now = options.now ?? (() => Date.now());
    this.active = options.active ? clone(options.active) : undefined;
  }

  set(goalId, options = {}) {
    if (typeof goalId !== 'string' || !goalId.trim()) throw new Error('goalId is required');
    const priority = options.priority === undefined ? undefined : Number(options.priority);
    if (priority !== undefined && !Number.isFinite(priority)) throw new Error('goal priority must be a number');
    this.active = {
      goalId: goalId.trim(),
      source: options.source ?? 'external',
      paused: false,
      ...(priority === undefined ? {} : { priority }),
      ...(options.metadata === undefined ? {} : { metadata: clone(options.metadata) }),
      setAt: options.setAt ?? this.now(),
    };
    return this.get();
  }

  get() { return clone(this.active); }

  pause(reason = 'paused') {
    if (!this.active) return undefined;
    this.active = { ...this.active, paused: true, pauseReason: reason };
    return this.get();
  }

  resume() {
    if (!this.active) return undefined;
    const { pauseReason: _pauseReason, ...active } = this.active;
    this.active = { ...active, paused: false };
    return this.get();
  }

  clear() {
    const previous = this.get();
    this.active = undefined;
    return previous;
  }
}
