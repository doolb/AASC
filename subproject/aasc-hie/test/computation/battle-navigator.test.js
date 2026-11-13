import { describe, expect, it } from 'vitest';
import { BattleNavigator } from '../../src/computation/battle-navigator.js';

describe('BattleNavigator', () => {
  it('creates a configured auxiliary battle action without executing it', () => {
    const navigator = new BattleNavigator();

    expect(navigator.plan({ stateVersion: 4 }, {
      id: 'use-skill-twice', kind: 'battle', action: { action: 'tap', point: { x: 300, y: 500 } },
    })).toMatchObject({ status: 'complete', navigatorId: 'battle', action: { action: 'tap' } });
  });

  it('delegates escape and retreat plans to the configured map navigator', () => {
    const navigator = new BattleNavigator({
      mapNavigator: { id: 'map-2.5d', mode: 'moba-25d', plan: () => ({ status: 'complete', path: { status: 'complete' } }) },
    });

    expect(navigator.plan({ map: { position: { x: 1, z: 1 } } }, {
      id: 'escape', kind: 'escape', target: { x: 10, z: 10 },
    })).toMatchObject({ status: 'complete', navigatorId: 'battle', delegatedTo: 'map-2.5d', plan: { path: { status: 'complete' } } });
  });

  it('blocks escape when no map navigator is configured', () => {
    expect(new BattleNavigator().plan({}, { id: 'escape', kind: 'escape', target: { x: 1, z: 1 } })).toMatchObject({ status: 'blocked', reason: 'map-navigator-required' });
  });

  it('uses a configured role risk threshold to choose retreat or continue combat', () => {
    const mapNavigator = {
      id: 'map-2.5d',
      plan: (_worldState, goal) => ({ status: 'complete', goalId: goal.id, path: { status: 'complete' } }),
    };
    const marksman = new BattleNavigator({ mapNavigator, roleProfile: { role: 'marksman', retreatHealth: 35 } });
    const tank = new BattleNavigator({ mapNavigator, roleProfile: { role: 'tank', retreatHealth: 15 } });
    const goal = {
      id: 'fight-or-retreat',
      kind: 'battle',
      action: { action: 'tap', point: { x: 10, y: 10 } },
      retreatGoal: { id: 'retreat', kind: 'retreat-to-safe-tower', target: { x: 20, z: 20 } },
    };

    expect(marksman.plan({ self: { health: 20 } }, goal)).toMatchObject({ delegatedTo: 'map-2.5d', safety: { required: true, role: 'marksman' } });
    expect(tank.plan({ self: { health: 20 } }, goal)).toMatchObject({ status: 'complete', role: 'tank', safety: { required: false }, action: { action: 'tap' } });
  });

  it('requires a fresh confirmed battle state before selecting a configured attack', () => {
    const navigator = new BattleNavigator({ policy: {
      battleUiId: 'battle-hud', maxObservationAgeMs: 500, minConfidence: 0.7,
      attack: { action: 'tap', point: { x: 1200, y: 560 } },
    } });
    const goal = { id: 'practice', kind: 'battle', automatic: true };
    const state = { stateVersion: 3, observedAt: 1000, confidence: 0.9,
      ui: { topmost: 'battle-hud' },
      values: { healthRatio: { value: 0.8, stale: false } },
      units: [{ id: 'enemy-1', team: 'enemy', category: 'hero', attackable: true, confidence: 0.9, stale: false }],
    };
    expect(navigator.plan(state, goal, { now: 1200 })).toMatchObject({ status: 'complete', targetId: 'enemy-1', action: { action: 'tap' } });
    expect(navigator.generateInstruction(state, navigator.plan(state, goal, { now: 1200 }))).toMatchObject({
      action: 'tap', targetStateVersion: 3, expiresAt: 1500, confidence: 0.9,
    });
    expect(navigator.candidate(state, goal, { now: 1200 })).toMatchObject({
      sourceLayer: 'muscle-memory', plan: { action: 'tap', targetStateVersion: 3 },
    });
    expect(navigator.plan(state, goal, { now: 1600 })).toMatchObject({ status: 'blocked', reason: 'battle-observation-stale' });
    expect(navigator.plan({ ...state, ui: { topmost: 'login' } }, goal, { now: 1200 })).toMatchObject({ status: 'blocked', reason: 'battle-ui-not-confirmed' });
  });

  it('selects retreat before attack at low health and waits when no target is visible', () => {
    const navigator = new BattleNavigator({ policy: {
      battleUiId: 'battle-hud', retreatHealthRatio: 0.3,
      attack: { action: 'tap', point: { x: 1200, y: 560 } },
      retreat: { action: 'move', vector: { x: -1, y: 0 } },
    } });
    const goal = { id: 'practice', kind: 'battle', automatic: true };
    const state = { stateVersion: 5, observedAt: 1000, confidence: 0.9, ui: { topmost: 'battle-hud' },
      values: { healthRatio: { value: 0.2, stale: false } }, units: [{ id: 'enemy-1', team: 'enemy', attackable: true, confidence: 1 }],
    };
    expect(navigator.plan(state, goal, { now: 1000 })).toMatchObject({ status: 'complete', reason: 'low-health-retreat', action: { action: 'move' } });
    expect(navigator.plan({ ...state, values: { healthRatio: { value: 0.8, stale: false } }, units: [] }, goal, { now: 1000 }))
      .toMatchObject({ status: 'blocked', reason: 'battle-target-not-confirmed' });
  });
});
