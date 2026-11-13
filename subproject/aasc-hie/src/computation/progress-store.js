import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
};

const pad = (value) => String(value).padStart(2, '0');
const asDate = (value) => value instanceof Date ? value : new Date(value);
const dateKey = (date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

const isoWeekKey = (value) => {
  const date = asDate(value);
  const day = date.getUTCDay() || 7;
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 4 - day));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((thursday - yearStart) / 86_400_000) + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${pad(week)}`;
};

const normalizePeriod = (goal = {}) => String(goal.period ?? goal.resetPeriod ?? goal.cycle ?? 'persistent').trim().toLowerCase();

const defaultState = () => ({ version: 1, periods: {} });

export const createFileProgressStorage = (filePath) => ({
  async read() {
    try { return JSON.parse(await readFile(filePath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  },
  async write(value) {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  },
});

/** Persist daily, weekly, version, or durable goal progress. */
export class ProgressStore {
  constructor(options = {}) {
    this.storage = options.storage ?? (options.filePath ? createFileProgressStorage(options.filePath) : undefined);
    this.now = options.now ?? (() => Date.now());
    this.state = clone(options.state ?? defaultState());
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return this.snapshot();
    const value = this.storage ? await this.storage.read() : undefined;
    if (value && typeof value === 'object' && !Array.isArray(value)) this.state = { ...defaultState(), ...clone(value), periods: { ...(value.periods ?? {}) } };
    this.loaded = true;
    return this.snapshot();
  }

  async persist() {
    if (this.storage) await this.storage.write(this.state);
  }

  periodKey(goal = {}, at = this.now()) {
    const period = normalizePeriod(goal);
    const date = asDate(at);
    if (period === 'daily' || period === 'day') return dateKey(date);
    if (period === 'weekly' || period === 'week') return isoWeekKey(date);
    if (period === 'version' || period === 'release') return String(goal.version ?? goal.versionKey ?? 'current');
    return 'persistent';
  }

  async bucket(goal = {}, at = this.now()) {
    await this.load();
    const period = normalizePeriod(goal);
    const key = this.periodKey(goal, at);
    const current = this.state.periods[period];
    if (!current || current.key !== key) {
      this.state.periods[period] = { key, goals: {} };
      await this.persist();
    }
    return this.state.periods[period];
  }

  async get(goalOrId, definition = {}, at = this.now()) {
    const goal = typeof goalOrId === 'string' ? { ...definition, id: goalOrId } : (goalOrId ?? {});
    if (!goal.id) throw new Error('goal id is required');
    const bucket = await this.bucket(goal, at);
    const existing = bucket.goals[goal.id] ?? {};
    return clone({
      goalId: goal.id,
      period: normalizePeriod(goal),
      periodKey: bucket.key,
      count: 0,
      completed: false,
      ...(goal.target === undefined ? {} : { target: goal.target }),
      ...existing,
    });
  }

  async record(goalOrId, patch = {}, at = this.now()) {
    const goal = typeof goalOrId === 'string' ? { id: goalOrId } : (goalOrId ?? {});
    if (!goal.id) throw new Error('goal id is required');
    const bucket = await this.bucket(goal, at);
    const current = await this.get(goal, {}, at);
    const count = patch.count === undefined ? current.count : Number(patch.count);
    if (!Number.isFinite(count) || count < 0) throw new Error('goal progress count must be a non-negative number');
    const target = patch.target ?? current.target ?? goal.target;
    const completed = patch.completed === undefined
      ? (current.completed === true || (target !== undefined && count >= Number(target)))
      : patch.completed === true;
    bucket.goals[goal.id] = {
      ...current,
      ...(target === undefined ? {} : { target }),
      count,
      completed,
      ...(patch.data === undefined ? {} : { data: clone(patch.data) }),
      updatedAt: asDate(at).toISOString(),
    };
    await this.persist();
    return clone(bucket.goals[goal.id]);
  }

  snapshot() { return clone(this.state); }
}
