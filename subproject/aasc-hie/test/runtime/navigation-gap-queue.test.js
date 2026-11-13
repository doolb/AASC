import { describe, expect, it } from 'vitest';
import { NavigationGapQueue } from '../../src/runtime/navigation-gap-queue.js';

describe('NavigationGapQueue', () => {
  it('deduplicates the same gap while tracking attempts and priority', () => {
    const queue = new NavigationGapQueue({ now: () => 100 });
    const gap = { type: 'navigation-gap', goalId: 'daily', stateId: 'unknown', reason: 'no-plan', priority: 20 };

    const first = queue.report(gap);
    const second = queue.report(gap);

    expect(second).toMatchObject({ id: first.id, attempts: 2, status: 'pending', priority: 20 });
    expect(queue.list()).toHaveLength(1);
  });

  it('orders pending gaps by priority and resolves one without executing it', () => {
    const queue = new NavigationGapQueue({ now: () => 100 });
    const low = queue.report({ goalId: 'low', reason: 'no-plan', priority: 1 });
    const high = queue.report({ goalId: 'high', reason: 'no-plan', priority: 10 });

    expect(queue.list().map((entry) => entry.id)).toEqual([high.id, low.id]);
    expect(queue.resolve(high.id, { kind: 'candidate-generated' })).toMatchObject({ status: 'resolved', resolution: { kind: 'candidate-generated' } });
    expect(queue.list().map((entry) => entry.id)).toEqual([low.id]);
  });

  it('persists pending and resolved gaps through an injected storage adapter', () => {
    let saved;
    const storage = {
      load: () => saved,
      save: (snapshot) => { saved = snapshot; },
    };
    const first = new NavigationGapQueue({ now: () => 100, storage });
    const gap = first.report({ goalId: 'daily', stateId: 'task', reason: 'missing-flow', priority: 4 });

    const second = new NavigationGapQueue({ now: () => 200, storage });
    expect(second.list()).toMatchObject([{ id: gap.id, status: 'pending', attempts: 1 }]);
    second.resolve(gap.id, { kind: 'flow-added' });

    const third = new NavigationGapQueue({ now: () => 300, storage });
    expect(third.list({ status: '*' })).toMatchObject([{ id: gap.id, status: 'resolved', resolution: { kind: 'flow-added' } }]);
  });

  it('escalates a gap after the configured retry threshold', () => {
    const queue = new NavigationGapQueue({ now: () => 100, escalationLimit: 3 });
    const gap = { goalId: 'daily', stateId: 'task', reason: 'missing-flow' };
    queue.report(gap);
    queue.report(gap);
    const third = queue.report(gap);

    expect(third).toMatchObject({ attempts: 3, status: 'pending', requiresReview: true, escalation: 'retry-limit' });
  });
});
