import { describe, expect, it } from 'vitest';
import { WorldStateStore } from '../../src/computation/world-state.js';

const clockAt = (observedAt, gameTime) => ({
  observedAt,
  gameTime,
  confidence: 0.95,
  paused: false,
});

describe('WorldStateStore', () => {
  it('returns immutable, increasing snapshots and preserves overlapping UI layers', () => {
    const store = new WorldStateStore({ valueTtlMs: 500 });
    const first = store.apply({
      observedAt: 100,
      ui: [
        { id: 'hud', visible: true, zIndex: 1, confidence: 0.8 },
        { id: 'dialog', visible: true, zIndex: 2, confidence: 0.9 },
      ],
      values: { health: { value: 80, confidence: 0.8 } },
      entities: [],
    }, clockAt(100, 1_000));

    expect(first).toMatchObject({ stateVersion: 1 });
    expect(first.worldState).toMatchObject({
      stateVersion: 1,
      ui: { layers: [{ id: 'hud' }, { id: 'dialog' }], topmost: 'dialog' },
      values: { health: { value: 80, observedAt: 100, gameTime: 1_000, lastSeenAt: 100, validUntil: 600 } },
    });
    expect(Object.isFrozen(first.worldState)).toBe(true);
    expect(Object.isFrozen(first.worldState.ui.layers)).toBe(true);

    const second = store.apply({
      observedAt: 200,
      ui: [{ id: 'hud', visible: true, zIndex: 1, confidence: 0.8 }],
      values: { health: { value: 70, confidence: 0.85 } },
      entities: [],
    }, clockAt(200, 1_100));

    expect(second.stateVersion).toBe(2);
    expect(first.worldState.values.health.value).toBe(80);
    expect(second.worldState.values.health.value).toBe(70);
    expect(second.worldState.ui.topmost).toBe('hud');
    expect(store.current()).toBe(second.worldState);
  });

  it('does not freeze nested objects owned by the observation caller', () => {
    const observation = {
      observedAt: 100,
      ui: [{ id: 'hud', visible: true, style: { color: 'red' } }],
      entities: [{ id: 'ally-1', category: 'hero', team: 'ally', position: { x: 1, y: 2 }, cooldowns: { dash: 3 } }],
    };
    new WorldStateStore().apply(observation, clockAt(100, 1_000));

    expect(Object.isFrozen(observation.ui[0].style)).toBe(false);
    expect(Object.isFrozen(observation.entities[0].cooldowns)).toBe(false);
  });

  it('copies event records before retaining them in history', () => {
    const store = new WorldStateStore();
    const event = { type: 'clock-adjusted', details: { driftMs: 900 } };
    store.apply({ observedAt: 100, entities: [] }, { observedAt: 100, gameTime: 1_000, events: [event] });

    event.type = 'caller-mutated';
    event.details.driftMs = 0;
    expect(store.eventHistory()).toEqual([
      { type: 'clock-adjusted', details: { driftMs: 900 } },
      { type: 'state-updated', stateVersion: 1, observedAt: 100, gameTime: 1_000 },
    ]);
  });
});
