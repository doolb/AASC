const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
};

/** In-memory event log with bounded retention; a durable sink can be injected later. */
export class EventLog {
  constructor(options = {}) {
    this.limit = Math.max(1, Number(options.limit ?? 10_000));
    this.events = [];
  }

  async append(event) {
    this.events.push(clone(event));
    if (this.events.length > this.limit) this.events.splice(0, this.events.length - this.limit);
  }

  snapshot() { return this.events.map(clone); }
  clear() { this.events.length = 0; }
}

export { clone as cloneEvent };
