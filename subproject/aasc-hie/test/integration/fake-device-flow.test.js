import { describe, expect, it } from 'vitest';
import { AlertEngine } from '../../src/computation/alert-engine.js';
import { GoalPlanner } from '../../src/computation/goal-planner.js';
import { Moba25dNavigator } from '../../src/computation/navigation/moba25d-navigator.js';
import { NavigationChainBuilder } from '../../src/computation/navigation/navigation-chain.js';
import { NavigationRuntime } from '../../src/runtime/navigation-runtime.js';
import { CommandExecutor } from '../../src/execution/navigator-executor.js';

const navmesh = {
  mapId: 'training-map',
  spaceModel: 'moba-25d',
  revision: 1,
  coordinateSystem: { horizontal: ['x', 'z'], up: 'y' },
  tiles: [{
    id: 'training-tile',
    vertices: [{ x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 20 }, { x: 0, z: 20 }],
    polygons: [{ id: 'training-road', vertices: [0, 1, 2, 3], neighbors: [], region: 'road' }],
  }],
};

describe('fake-device runtime flow', () => {
  it('carries one observation through recognition, state, alert, route, chain, and dry-run execution', async () => {
    let now = 1_000;
    let frameCalls = 0;
    const deviceCalls = [];
    const goal = {
      id: 'retreat-to-safe-tower',
      kind: 'retreat-to-safe-tower',
      target: { x: 25, z: 5 },
      terminal: true,
    };
    const navigator = new Moba25dNavigator({ map: navmesh });
    const planner = new GoalPlanner({ navigators: { 'map-2.5d': navigator } });
    const chainBuilder = new NavigationChainBuilder();
    const commandExecutor = new CommandExecutor({
      enabled: true,
      dryRun: true,
      adb: {
        async swipe(...args) {
          deviceCalls.push(args);
        },
      },
    });
    const runtime = new NavigationRuntime({
      monotonicNow: () => now,
      frameSource: {
        next: async () => {
          frameCalls += 1;
          return { buffer: Buffer.from('fake-frame'), observedAt: now, source: 'fake-device' };
        },
      },
      recognizer: {
        observe: async (frame) => {
          expect(frame.source).toBe('fake-device');
          return {
            observedAt: frame.observedAt,
            confidence: 0.9,
            clock: { gameTime: 30_000, confidence: 0.95, source: 'fake-clock' },
            map: { position: { x: 5, z: 5 }, region: 'road', enemyNearby: true },
            entities: [
              { id: 'hero', team: 'ally', category: 'hero', position: { x: 5, z: 5 }, health: 80, confidence: 0.9 },
              { id: 'enemy-1', team: 'enemy', category: 'hero', position: { x: 8, z: 5 }, health: 100, confidence: 0.9 },
            ],
          };
        },
      },
      alertEngine: new AlertEngine({
        alerts: [{
          id: 'enemy-nearby',
          when: 'map.enemyNearby == true',
          severity: 'warning',
          priority: 50,
          suggestedGoal: goal.id,
        }],
      }),
      planProvider: (worldState, _preview, alerts) => {
        const expanded = planner.expand(worldState, goal);
        const chain = chainBuilder.build(worldState, goal, {
          navigator,
          plan: expanded.plan,
          planStatus: expanded.status,
        });
        return [{
          id: goal.id,
          priority: 100,
          alerts,
          plan: {
            ...expanded.plan,
            chain,
            instruction: navigator.generateInstruction(worldState, expanded.plan),
          },
        }];
      },
      commandExecutor,
      execution: { enabled: true },
      recognitionIntervalMs: 0,
    });

    const result = await runtime.tickOnce();

    expect(frameCalls).toBe(1);
    expect(result.worldState).toMatchObject({ stateVersion: 1, gameTime: 30_000 });
    expect(result.worldState.units).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'enemy-1', team: 'enemy', stale: false }),
    ]));
    expect(result.alerts).toEqual([
      expect.objectContaining({ id: 'enemy-nearby', severity: 'warning', suggestedGoal: goal.id }),
    ]);
    expect(result.selected.selected).toMatchObject({
      status: 'complete',
      path: { status: 'complete' },
      chain: { status: 'complete', goalId: goal.id },
    });
    expect(result.selected.selected.chain.nodes.length).toBeGreaterThan(0);
    expect(result.commandResult).toMatchObject({ executed: false, reason: 'dry-run' });
    expect(deviceCalls).toEqual([]);
  });
});
