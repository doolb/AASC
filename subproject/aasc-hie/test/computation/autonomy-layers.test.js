import { describe, expect, it, vi } from 'vitest';
import {
  AutonomyCoordinator,
  IntelligenceLayer,
  InstinctLayer,
  MuscleMemoryLayer,
} from '../../src/computation/autonomy-layers.js';

describe('hierarchical autonomy layers', () => {
  it('lets the instinct layer override lower-priority plans with a safety command', async () => {
    const layer = new InstinctLayer({
      rules: [{
        id: 'fall-risk',
        when: (context) => context.worldState.risk === 'fall',
        plan: { action: 'stop', reason: 'fall-risk' },
      }],
    });

    const result = await layer.decide({ worldState: { risk: 'fall' } });

    expect(result.layer).toBe('instinct');
    expect(result.plans[0]).toMatchObject({
      id: 'instinct:fall-risk',
      priority: 1000,
      plan: { action: 'stop', reason: 'fall-risk' },
    });
  });

  it('reports a navigation gap when muscle memory cannot produce a plan', async () => {
    const layer = new MuscleMemoryLayer({
      planner: vi.fn(() => undefined),
      failureLimit: 2,
    });

    const first = await layer.decide({ worldState: { ui: { topmost: 'unknown' } }, goal: { id: 'open-daily' } });
    const second = await layer.decide({ worldState: { ui: { topmost: 'unknown' } }, goal: { id: 'open-daily' } });

    expect(first.gaps).toHaveLength(0);
    expect(second.gaps).toMatchObject([{
      type: 'navigation-gap',
      sourceLayer: 'muscle-memory',
      goalId: 'open-daily',
      reason: 'no-plan',
      requiresIntelligence: true,
    }]);
  });

  it('allows intelligence to turn a gap into a candidate update without executing it', async () => {
    const update = { op: 'add', path: '/flows/-', value: { id: 'open-daily-generated' } };
    const layer = new IntelligenceLayer({
      planner: vi.fn(() => ({
        plans: [{ id: 'intelligence:repair', priority: 100, plan: { action: 'none' } }],
        updates: [update],
      })),
    });

    const result = await layer.decide({ gaps: [{ type: 'navigation-gap', goalId: 'open-daily' }] });

    expect(result.layer).toBe('intelligence');
    expect(result.plans[0].plan.action).toBe('none');
    expect(result.updates).toEqual([update]);
    expect(result.executed).toBe(false);
  });

  it('selects the highest-priority plan while preserving layer output and gaps', async () => {
    const coordinator = new AutonomyCoordinator({
      instinct: new InstinctLayer({ rules: [] }),
      muscleMemory: { planner: () => ({ id: 'muscle:daily', priority: 300, plan: { action: 'tap' } }) },
      intelligence: { planner: () => ({ id: 'intelligence:fallback', priority: 100, plan: { action: 'none' } }) },
    });

    const result = await coordinator.decide({ goal: { id: 'daily' }, worldState: {} });

    expect(result.selected.id).toBe('muscle:daily');
    expect(result.layers.map((entry) => entry.layer)).toEqual(['instinct', 'muscle-memory', 'intelligence']);
    expect(result.gaps).toEqual([]);
  });
});
