import { describe, expect, it } from 'vitest';
import { ActiveGoalController } from '../../src/runtime/active-goal.js';

describe('ActiveGoalController', () => {
  it('sets, reads, and clears the externally selected goal', () => {
    const controller = new ActiveGoalController({ now: () => 123 });

    expect(controller.set('daily-inspiration', { source: 'manual', priority: 800 })).toMatchObject({ goalId: 'daily-inspiration', source: 'manual', priority: 800, setAt: 123 });
    expect(controller.get()).toMatchObject({ goalId: 'daily-inspiration' });
    expect(controller.clear()).toMatchObject({ goalId: 'daily-inspiration' });
    expect(controller.get()).toBeUndefined();
  });
});
