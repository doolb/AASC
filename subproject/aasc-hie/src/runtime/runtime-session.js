const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
};

/** Serializable runtime session metadata and last-tick snapshot. */
export class RuntimeSession {
  constructor(options = {}) {
    this.id = options.id ?? `session-${Date.now()}`;
    this.packageId = options.packageId;
    this.startedAt = options.startedAt;
    this.stoppedAt = undefined;
    this.stopReason = undefined;
    this.tickCount = 0;
    this.last = undefined;
  }

  start(at = Date.now()) { this.startedAt ??= at; }

  record(value) {
    this.tickCount += 1;
    this.last = clone(value);
  }

  stop(reason, at = Date.now()) {
    this.stoppedAt = at;
    this.stopReason = reason;
  }

  snapshot() {
    return clone({ id: this.id, packageId: this.packageId, startedAt: this.startedAt, stoppedAt: this.stoppedAt, stopReason: this.stopReason, tickCount: this.tickCount, last: this.last });
  }
}
