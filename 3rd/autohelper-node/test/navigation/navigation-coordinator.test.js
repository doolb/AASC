import { describe, expect, it } from 'vitest';
import { NavigationCoordinator } from '../../src/navigation/navigation-coordinator.js';
import { Navigator } from '../../src/navigation/navigator.js';

class FakeNavigator extends Navigator {
  constructor(id, mode, state, instruction) {
    super(id, mode);
    this.state = state;
    this.instruction = instruction;
  }

  async getCurrentState() {
    return this.state;
  }

  async generateInstruction() {
    return this.instruction;
  }
}

describe('NavigationCoordinator', () => {
  it('observes enabled navigators together and emits one highest-priority instruction', async () => {
    const coordinator = new NavigationCoordinator({
      navigators: [
        new FakeNavigator('ui', 'ui', {
          navigatorId: 'ui',
          mode: 'ui',
          status: 'confirmed',
          confidence: 0.9,
          observedAt: 'now',
          data: { uis: ['world'] },
        }, {
          mode: 'ui',
          action: 'tap',
          point: { x: 10, y: 20 },
          confidence: 0.9,
        }),
        new FakeNavigator('spatial-3d', 'spatial-3d', {
          navigatorId: 'spatial-3d',
          mode: 'spatial-3d',
          id: 'walkable',
          status: 'confirmed',
          confidence: 0.95,
          observedAt: 'now',
          data: { region: 'walkable' },
        }, {
          mode: 'spatial-3d',
          action: 'move',
          vector: { x: 0, y: -1 },
          durationMs: 300,
          confidence: 0.95,
          reason: 'clear-road',
        }),
      ],
    });

    const plan = await coordinator.plan(Buffer.from('frame'), [
      { id: 'daily-ui', kind: 'ui', priority: 10, delegate: 'ui' },
      { id: 'escape', kind: 'spatial-3d', priority: 100, delegate: 'spatial-3d' },
    ]);

    expect(plan.states).toHaveLength(2);
    expect(plan.goalId).toBe('escape');
    expect(plan.navigatorId).toBe('spatial-3d');
    expect(plan.instruction).toMatchObject({ mode: 'spatial-3d', action: 'move' });
  });

  it('allows a high-priority goal to delegate to a navigator mode', async () => {
    const coordinator = new NavigationCoordinator({
      navigators: [
        new FakeNavigator('map-controller', 'spatial-3d', {
          navigatorId: 'map-controller',
          mode: 'spatial-3d',
          status: 'confirmed',
          confidence: 0.8,
          observedAt: 'now',
          data: {},
        }, { mode: 'spatial-3d', action: 'stop', confidence: 0.8, reason: 'water-ahead' }),
      ],
    });

    const plan = await coordinator.plan(Buffer.from('frame'), [{
      id: 'escape-map',
      kind: 'compound',
      priority: 20,
      delegate: 'spatial-3d',
    }]);

    expect(plan.navigatorId).toBe('map-controller');
    expect(plan.instruction.action).toBe('stop');
  });
});
