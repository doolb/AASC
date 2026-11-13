import { describe, expect, it } from 'vitest';
import { BattleSimulator } from '../../src/computation/battle-simulator.js';
import { GoalPlanner } from '../../src/computation/goal-planner.js';
import { Moba25dNavigator } from '../../src/computation/navigation/moba25d-navigator.js';

const world = () => ({
  stateVersion: 8,
  observedAt: 1_000,
  gameTime: 12_000,
  confidence: 0.9,
  self: { id: 'self', position: { x: 0, z: 0 }, health: 100, team: 'ally', category: 'hero', cooldowns: { attack: 0 } },
  units: [
    { id: 'enemy', position: { x: 50, z: 0 }, velocity: { x: 0.01, z: 0 }, health: 30, team: 'enemy', category: 'hero', confidence: 0.9, stale: false },
  ],
  package: {
    rules: {
      hero: { movementSpeed: 10, attackRange: 60, attackDamage: 20, attackCooldownMs: 200 },
      enemy: { movementSpeed: 0, attackRange: 120, attackDamage: 10, attackCooldownMs: 100 },
    },
  },
});

describe('BattleSimulator', () => {
  it('produces deterministic seeded branches, timed combat events, and terminal objective state', () => {
    const simulator = new BattleSimulator({
      rules: { hero: { movementSpeed: 10, attackRange: 60, attackDamage: 20, attackCooldownMs: 200 } },
    });
    const request = {
      worldState: world(),
      goal: {
        id: 'clear-enemy',
        kind: 'battle',
        objectives: [{ id: 'survive', condition: 'self.health > 0', terminal: true }],
        action: { kind: 'attack', actorId: 'self', targetId: 'enemy' },
      },
      horizonMs: 600,
      stepMs: 100,
      branches: 2,
      seed: 17,
    };
    const first = simulator.simulate(request);
    const second = simulator.simulate(request);

    expect(first).toEqual(second);
    expect(first).toMatchObject({ stateVersion: 8, rulesetId: 'default', branchIds: ['clear-enemy:8:0', 'clear-enemy:8:1'] });
    expect(first.branches[0].trajectory.length).toBe(7);
    expect(first.branches[0].events.some((event) => event.type === 'attack')).toBe(true);
    expect(first.objectives).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'survive', terminal: true })]));
    expect(first.terminal).toBe(true);
  });

  it('does not mutate input and lowers confidence when a required unit is stale', () => {
    const input = world();
    input.units[0].stale = true;
    const before = JSON.stringify(input);
    const preview = new BattleSimulator().simulate({
      worldState: input,
      goal: { id: 'approach', kind: 'battle', action: { kind: 'move', actorId: 'self', target: { x: 50, z: 0 } } },
      horizonMs: 200,
      stepMs: 100,
      branches: 1,
      seed: 1,
    });

    expect(JSON.stringify(input)).toBe(before);
    expect(preview.confidence).toBeLessThan(0.9);
    expect(preview.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'stale-unit', unitId: 'enemy' }),
    ]));
  });

  it('emits warning previews and timed state transitions for optional objectives', () => {
    const preview = new BattleSimulator().simulate({
      worldState: { stateVersion: 1, confidence: 1, self: { id: 'self', position: { x: 0, z: 0 }, health: 100 } },
      goal: {
        id: 'hold-point',
        kind: 'battle',
        transitions: [{ atMs: 100, type: 'warning', message: 'objective window' }],
        objectives: [
          { id: 'bonus', condition: 'self.health > 0', optional: true },
          { id: 'end', condition: 'self.health > 0', terminal: true },
        ],
      },
      horizonMs: 200,
      stepMs: 100,
      branches: 1,
      seed: 4,
    });

    expect(preview.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'timed-transition', message: 'objective window', atMs: 100 }),
    ]));
    expect(preview.objectives).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bonus', optional: true, status: 'complete' }),
    ]));
  });

  it('blocks movement that cannot be supported by the configured NavMesh', () => {
    const navmesh = {
      mapId: 'arena',
      spaceModel: 'moba-25d',
      tiles: [{ id: 'tile', vertices: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }], polygons: [{ id: 'p', vertices: [0, 1, 2, 3], neighbors: [], region: 'road' }] }],
    };
    const preview = new BattleSimulator({ navmesh }).simulate({
      worldState: { stateVersion: 2, confidence: 1, self: { id: 'self', position: { x: 2, z: 2 }, health: 100 } },
      goal: { id: 'leave-mesh', action: { kind: 'move', actorId: 'self', target: { x: 20, z: 20 } } },
      horizonMs: 100,
      stepMs: 100,
    });
    expect(preview.trajectory.at(-1).self.position).toEqual({ x: 2, z: 2 });
    expect(preview.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'navmesh-blocked' })]));
  });

  it('decrements enemy cooldowns between attacks', () => {
    const preview = new BattleSimulator({ rules: {
      enemy: { attackRange: 20, attackDamage: 10, attackCooldownMs: 1_000 },
    } }).simulate({
      worldState: {
        stateVersion: 3,
        confidence: 1,
        self: { id: 'self', position: { x: 0, z: 0 }, health: 100 },
        units: [{ id: 'enemy', team: 'enemy', category: 'hero', position: { x: 10, z: 0 }, health: 100, stale: false }],
      },
      goal: { id: 'wait' },
      horizonMs: 250,
      stepMs: 100,
    });

    expect(preview.events.filter((event) => event.type === 'attack' && event.actorId === 'enemy')).toHaveLength(1);
  });

  it('tracks configured skill uses for auxiliary objectives without requiring victory', () => {
    const preview = new BattleSimulator().simulate({
      worldState: { stateVersion: 6, confidence: 1, self: { id: 'self', position: { x: 0, z: 0 }, health: 100 } },
      goal: {
        id: 'use-skill-twice',
        action: { kind: 'skill', actorId: 'self', skillId: 'heal', cooldownMs: 100 },
        objectives: [{ id: 'skill-count', condition: 'metrics.skills.heal >= 2', optional: true }],
      },
      horizonMs: 300,
      stepMs: 100,
    });

    expect(preview.objectives).toMatchObject([{ id: 'skill-count', status: 'complete', optional: true }]);
    expect(preview.events.filter((event) => event.type === 'skill')).toHaveLength(3);
  });

  it('uses seeded stochastic movement to produce stable but distinct branches', () => {
    const request = {
      worldState: { stateVersion: 4, confidence: 1, self: { id: 'self', position: { x: 0, z: 0 }, health: 100 } },
      goal: { id: 'scout', action: { kind: 'move', actorId: 'self', target: { x: 100, z: 0 } }, stochastic: { movementVariance: 0.5 } },
      horizonMs: 100,
      stepMs: 100,
      branches: 2,
      seed: 22,
    };
    const first = new BattleSimulator({ rules: { hero: { movementSpeed: 10 } } }).simulate(request);
    const second = new BattleSimulator({ rules: { hero: { movementSpeed: 10 } } }).simulate(request);

    expect(first).toEqual(second);
    expect(first.branchIds).toEqual(['scout:4:0', 'scout:4:1']);
    expect(first.branches[0].trajectory.at(-1).self.position).not.toEqual(first.branches[1].trajectory.at(-1).self.position);
  });

  it('hands a configured battle rule off to a mapped retreat planner', () => {
    const map = { mapId: 'arena', spaceModel: 'moba-25d', revision: 1, tiles: [{ id: 'tile', vertices: [
      { x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 },
    ], polygons: [{ id: 'p', vertices: [0, 1, 2, 3], neighbors: [], region: 'road' }] }] };
    const planner = new GoalPlanner({ navigators: { 'map-2.5d': new Moba25dNavigator({ map }) } });
    const preview = new BattleSimulator({ goalPlanner: planner }).simulate({
      worldState: { stateVersion: 5, confidence: 1, self: { id: 'self', position: { x: 2, z: 2 }, health: 20 } },
      goal: { id: 'battle', kind: 'battle', handoffs: [{ condition: 'self.health < 50', goal: { id: 'retreat-to-safe-tower', kind: 'retreat-to-safe-tower', target: { x: 8, z: 8 } } }] },
      horizonMs: 0,
      stepMs: 100,
    });

    expect(preview.handoff).toMatchObject({ goalId: 'retreat-to-safe-tower', delegatedTo: 'map-2.5d', plan: { status: 'complete' } });
  });
});
