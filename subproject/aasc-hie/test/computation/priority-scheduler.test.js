import { describe, expect, it } from 'vitest';
import { PriorityScheduler } from '../../src/computation/priority-scheduler.js';

describe('PriorityScheduler', () => {
  it('selects one critical safety plan while retaining all scenario previews', () => {
    const scheduler = new PriorityScheduler({ priorities: { routine: 40, battle: 80, safety: 100 } });
    const result = scheduler.select({ stateVersion: 9 }, [
      { id: 'routine-move', scenarioId: 'routine', plan: { action: 'move' } },
      { id: 'battle-response', scenarioId: 'battle', plan: { action: 'attack' }, preview: { riskScore: 0.5 } },
      { id: 'escape', scenarioId: 'safety', plan: { action: 'retreat' }, preview: { riskScore: 0.9 } },
    ]);

    expect(result).toMatchObject({ selectedId: 'escape', stateVersion: 9, selected: { action: 'retreat' } });
    expect(result.candidates).toHaveLength(3);
    expect(result.previews).toHaveLength(3);
    expect(result.selectedPlan).toEqual(result.selected);
  });

  it('uses configured candidate priority and stable order for ties', () => {
    const scheduler = new PriorityScheduler({ defaultPriority: 10 });
    const result = scheduler.select({}, [
      { id: 'second', priority: 30, plan: { action: 'b' } },
      { id: 'first', priority: 30, plan: { action: 'a' } },
    ]);
    expect(result.selectedId).toBe('first');
  });

  it('does not select a candidate whose nested plan is blocked or incomplete', () => {
    const result = new PriorityScheduler().select({}, [
      { id: 'blocked', priority: 100, plan: { status: 'blocked', action: 'unsafe' } },
      { id: 'pending', priority: 90, plan: { status: 'pending', action: 'not-ready' } },
      { id: 'safe', priority: 10, plan: { status: 'complete', action: 'move' } },
    ]);
    expect(result.selectedId).toBe('safe');
  });
});
