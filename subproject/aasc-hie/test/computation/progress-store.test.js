import { describe, expect, it } from 'vitest';
import { GoalManager } from '../../src/computation/goal-manager.js';
import { ProgressStore } from '../../src/computation/progress-store.js';

const memoryStorage = () => {
  let value;
  return {
    async read() { return value; },
    async write(next) { value = next; },
  };
};

describe('ProgressStore', () => {
  it('resets daily progress when the period changes and preserves the new record', async () => {
    let now = Date.UTC(2026, 8, 6, 12);
    const store = new ProgressStore({ now: () => now });

    await store.record({ id: 'daily-routine', period: 'daily', target: 3 }, { count: 2 });
    expect((await store.get('daily-routine', { period: 'daily' })).count).toBe(2);

    now = Date.UTC(2026, 8, 7, 12);
    const next = await store.get('daily-routine', { period: 'daily', target: 3 });

    expect(next).toMatchObject({ count: 0, completed: false, periodKey: '2026-09-07' });
  });

  it('loads and saves progress through the configured storage adapter', async () => {
    const storage = memoryStorage();
    const first = new ProgressStore({ storage, now: () => Date.UTC(2026, 8, 6) });
    await first.record({ id: 'weekly-panel', period: 'weekly' }, { completed: true, data: { panels: 5 } });

    const second = new ProgressStore({ storage, now: () => Date.UTC(2026, 8, 6) });
    await second.load();

    expect(await second.get('weekly-panel', { period: 'weekly' })).toMatchObject({ completed: true, data: { panels: 5 } });
  });
});

describe('GoalManager', () => {
  it('evaluates a goal success expression as completed progress', async () => {
    const manager = new GoalManager({ progressStore: new ProgressStore() });

    const result = await manager.evaluate({ self: { health: 100 } }, {
      id: 'survive', kind: 'battle', success: 'self.health > 0',
    });

    expect(result).toMatchObject({ status: 'complete', completed: true, progress: { completed: true } });
  });

  it('completes a compound goal only after every child goal is complete', async () => {
    const progress = new ProgressStore();
    const manager = new GoalManager({ progressStore: progress });
    const goal = { id: 'daily', kind: 'compound', steps: [{ id: 'first' }, { id: 'second' }] };

    await manager.record(goal.steps[0], { completed: true });
    const incomplete = await manager.evaluate({}, goal);
    await manager.record(goal.steps[1], { completed: true });
    const complete = await manager.evaluate({}, goal);

    expect(incomplete).toMatchObject({ status: 'pending', completed: false });
    expect(complete).toMatchObject({ status: 'complete', completed: true });
  });

  it('returns the next incomplete low-level goal in declaration order', async () => {
    const progress = new ProgressStore();
    const manager = new GoalManager({ progressStore: progress });
    const goal = { id: 'daily', kind: 'compound', steps: [{ id: 'first' }, { id: 'second' }] };

    await manager.record(goal.steps[0], { completed: true });

    expect(await manager.next({}, goal)).toMatchObject({ id: 'second', nodeId: 'daily:second' });
  });

  it('combines planner output with persisted progress and exposes child goals', async () => {
    const progress = new ProgressStore({ now: () => Date.UTC(2026, 8, 6) });
    const manager = new GoalManager({ progressStore: progress });
    const goal = {
      id: 'daily-inspiration',
      kind: 'compound',
      period: 'daily',
      steps: [
        { id: 'open-panel', kind: 'ui', period: 'daily' },
        { id: 'collect-reward', kind: 'ui', period: 'daily' },
      ],
    };

    await manager.record(goal.steps[0], { completed: true });
    const result = await manager.status({}, [goal]);

    expect(result[0]).toMatchObject({ id: 'daily-inspiration', progress: { completed: false } });
    expect(result[0].children[0]).toMatchObject({ id: 'daily-inspiration:open-panel', progress: { completed: true } });
    expect(result[0].children[1]).toMatchObject({ id: 'daily-inspiration:collect-reward', progress: { completed: false } });
  });
});
