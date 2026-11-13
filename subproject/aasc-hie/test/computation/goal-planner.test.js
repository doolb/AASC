import { describe, expect, it } from 'vitest';
import { GoalPlanner } from '../../src/computation/goal-planner.js';
import { Moba25dNavigator } from '../../src/computation/navigation/moba25d-navigator.js';

const map = {
  mapId: 'arena',
  spaceModel: 'moba-25d',
  revision: 2,
  tiles: [{ id: 'tile', vertices: [
    { x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 },
  ], polygons: [{ id: 'p', vertices: [0, 1, 2, 3], neighbors: [], region: 'road' }] }],
};

describe('GoalPlanner', () => {
  it('expands a retreat goal through a map navigator and preserves the low-level condition', () => {
    const mapNavigator = new Moba25dNavigator({ map });
    const planner = new GoalPlanner({ navigators: { 'map-2.5d': mapNavigator } });
    const result = planner.expand({ stateVersion: 6, map: { position: { x: 2, z: 2 } } }, {
      id: 'retreat-to-safe-tower',
      kind: 'retreat-to-safe-tower',
      success: 'self.health > 0',
      target: { x: 8, z: 8 },
      delegate: 'map-2.5d',
    });

    expect(result).toMatchObject({ goalId: 'retreat-to-safe-tower', status: 'ready', delegatedTo: 'map-2.5d' });
    expect(result.condition).toEqual({ expression: 'self.health > 0', satisfied: 'unknown' });
    expect(result.plan).toMatchObject({ navigatorId: 'map-2.5d', path: { status: 'complete' } });
  });

  it('evaluates nested low-level conditions when their root value is present', () => {
    const planner = new GoalPlanner();
    expect(planner.expand({ self: { health: 80 } }, {
      id: 'survive',
      kind: 'battle',
      success: 'self.health > 0',
    }).condition).toEqual({ expression: 'self.health > 0', satisfied: true });
  });

  it('reverse-looks up goals by low-level condition and action reference', () => {
    const planner = new GoalPlanner({ package: {
      goals: [
        { id: 'escape', kind: 'compound', success: 'self.health > 0', steps: [{ id: 'move', action: 'retreat' }] },
        { id: 'routine', kind: 'ui', action: 'open-menu' },
      ],
    } });

    expect(planner.reverseLookup({ condition: 'self.health > 0' }).map((goal) => goal.id)).toEqual(['escape']);
    expect(planner.reverseLookup({ action: 'retreat' }).map((goal) => goal.id)).toEqual(['escape']);
  });

  it('recursively expands nested child goals and retains each child plan', () => {
    const planner = new GoalPlanner({ navigators: { 'map-2.5d': new Moba25dNavigator({ map }) } });
    const result = planner.expand({ stateVersion: 7, map: { position: { x: 2, z: 2 } } }, {
      id: 'compound',
      kind: 'compound',
      steps: [{ id: 'outer', kind: 'compound', steps: [{ id: 'inner', kind: 'map-2.5d', target: { x: 8, z: 8 } }] }],
    });

    expect(result.children[0].children[0]).toMatchObject({
      id: 'compound:outer:inner',
      plan: { status: 'complete', path: { status: 'complete' } },
    });
    expect(result.nodes.map((node) => node.id)).toEqual(['compound:outer', 'compound:outer:inner']);
  });

  it('infers the configured map navigator for a retreat goal without an explicit delegate', () => {
    const planner = new GoalPlanner({ navigators: { 'map-2.5d': new Moba25dNavigator({ map }) } });
    const result = planner.expand({ stateVersion: 8, map: { position: { x: 2, z: 2 } } }, {
      id: 'retreat-to-safe-tower', kind: 'retreat-to-safe-tower', target: { x: 8, z: 8 },
    });

    expect(result).toMatchObject({ delegatedTo: 'map-2.5d', plan: { status: 'complete' } });
  });
});
