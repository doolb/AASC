const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
};

const snapshotFor = (entries) => ({
  nextId: entries.nextId,
  entries: [...entries.entries.values()].map(clone),
});

const signatureFor = (gap) => JSON.stringify({
  goalId: gap?.goalId,
  stateId: gap?.stateId,
  reason: gap?.reason,
  sourceLayer: gap?.sourceLayer,
});

/** Repair queue for gaps reported by the muscle-memory layer. */
export class NavigationGapQueue {
  constructor(options = {}) {
    this.now = options.now ?? (() => Date.now());
    this.entries = new Map();
    this.nextId = 1;
    this.escalationLimit = Math.max(1, Number(options.escalationLimit ?? 5));
    this.storage = options.storage;
    const saved = this.storage?.load?.();
    if (saved && Array.isArray(saved.entries)) {
      for (const entry of saved.entries) {
        if (entry?.signature && entry?.id) this.entries.set(entry.signature, clone(entry));
      }
      this.nextId = Math.max(1, Number(saved.nextId ?? 1));
    }
  }

  persist() {
    this.storage?.save?.(snapshotFor(this));
  }

  report(gap = {}) {
    if (!gap || typeof gap !== 'object') throw new Error('navigation gap must be an object');
    const signature = signatureFor(gap);
    const current = this.entries.get(signature);
    if (current) {
      current.attempts += 1;
      current.updatedAt = this.now();
      if (current.attempts >= this.escalationLimit) {
        current.requiresReview = true;
        current.escalation = 'retry-limit';
      }
      this.persist();
      return clone(current);
    }
    const entry = {
      ...clone(gap),
      id: gap.id ?? `gap-${this.nextId++}`,
      signature,
      priority: Number(gap.priority ?? 0),
      attempts: 1,
      status: 'pending',
      reportedAt: this.now(),
      updatedAt: this.now(),
    };
    this.entries.set(signature, entry);
    this.persist();
    return clone(entry);
  }

  list(options = {}) {
    const status = options.status ?? 'pending';
    return [...this.entries.values()]
      .filter((entry) => status === '*' || entry.status === status)
      .sort((left, right) => right.priority - left.priority || left.reportedAt - right.reportedAt)
      .map(clone);
  }

  resolve(id, resolution = {}) {
    const entry = [...this.entries.values()].find((candidate) => candidate.id === id);
    if (!entry) throw new Error('navigation gap not found: ' + id);
    entry.status = 'resolved';
    entry.resolution = clone(resolution);
    entry.resolvedAt = this.now();
    entry.updatedAt = entry.resolvedAt;
    this.persist();
    return clone(entry);
  }

  snapshot() {
    const entries = this.list({ status: '*' });
    return { pending: entries.filter((entry) => entry.status === 'pending').length, entries };
  }
}
