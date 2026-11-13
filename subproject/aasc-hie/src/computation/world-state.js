import { StateFusion } from './state-fusion.js';
import { UnitTracker } from './unit-tracker.js';

const finite = (value) => Number.isFinite(value);
const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
};

const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};

const initialState = () => ({
  stateVersion: 0,
  observedAt: 0,
  gameTime: 0,
  confidence: 0,
  ui: { layers: [], topmost: null },
  values: {},
  map: {},
  entities: [],
  units: [],
  activeUnits: [],
});

/** Own immutable world snapshots and the events produced while applying them. */
export class WorldStateStore {
  constructor(options = {}) {
    this.fusion = options.fusion ?? new StateFusion(options);
    this.tracker = options.tracker ?? new UnitTracker(options);
    this.snapshot = freeze(initialState());
    this.events = [];
    this.snapshots = [this.snapshot];
  }

  apply(observation = {}, clockState = {}) {
    if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
      throw new Error('observation must be an object');
    }
    const observedAt = finite(observation.observedAt)
      ? observation.observedAt
      : (clockState.observedAt ?? this.snapshot.observedAt);
    const units = this.tracker.update(this.snapshot.units, observation.entities ?? [], observedAt);
    const merged = this.fusion.merge(this.snapshot, { ...observation, entities: units }, {
      ...clockState,
      observedAt,
    });
    const stateVersion = this.snapshot.stateVersion + 1;
    const next = freeze({
      ...merged,
      stateVersion,
      units,
      entities: units,
      activeUnits: this.tracker.active(units, observedAt),
    });
    const stateEvent = { type: 'state-updated', stateVersion, observedAt, gameTime: next.gameTime };
    const events = freeze(clone([...(Array.isArray(clockState.events) ? clockState.events : []), stateEvent]));
    this.snapshot = next;
    this.snapshots.push(next);
    this.events.push(...events);
    return { stateVersion, worldState: next, events: clone(events) };
  }

  current() {
    return this.snapshot;
  }

  eventHistory() {
    return freeze(clone(this.events));
  }

  history() {
    return this.snapshots.slice();
  }
}

export { clone, freeze };
