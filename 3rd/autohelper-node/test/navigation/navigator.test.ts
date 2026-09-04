import { describe, expect, it } from 'vitest';
import { Navigator } from '../../src/navigation/navigator.js';
import type {
  GameGoal,
  NavigationInstruction,
  NavigatorState,
} from '../../src/navigation/types.js';

class TestNavigator extends Navigator {
  public constructor(id: string) {
    super(id, 'ui');
  }

  public async getCurrentState(_frame: Buffer): Promise<NavigatorState> {
    return {
      navigatorId: this.id,
      mode: this.mode,
      status: 'unknown',
      confidence: 0,
      observedAt: '2026-09-04T00:00:00.000Z',
      data: {},
    };
  }

  public async generateInstruction(
    _frame: Buffer,
    _target: GameGoal,
  ): Promise<NavigationInstruction> {
    return {
      mode: 'none',
      confidence: 0,
      reason: 'unknown-state',
    };
  }
}

describe('Navigator', () => {
  it('requires a non-empty navigator id', () => {
    expect(() => new TestNavigator('')).toThrow('navigator id is required');
  });

  it('exposes the navigator id and mode', () => {
    const navigator = new TestNavigator('test');

    expect(navigator.id).toBe('test');
    expect(navigator.mode).toBe('ui');
  });
});
