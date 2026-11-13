import { describe, expect, it } from 'vitest';
import { evaluateExpression } from '../../src/computation/restricted-expression.js';

describe('evaluateExpression', () => {
  it('evaluates literals, safe state paths, comparisons, and arithmetic', () => {
    const context = { state: { health: 80, mode: 'battle' }, values: { bonus: 5 } };
    expect(evaluateExpression('state.health > 50', context)).toBe(true);
    expect(evaluateExpression('state.mode === "battle"', context)).toBe(true);
    expect(evaluateExpression('state.health + values.bonus', context)).toBe(85);
    expect(evaluateExpression('.5 + 1', context)).toBe(1.5);
    expect(evaluateExpression('state.health-50', context)).toBe(30);
    expect(evaluateExpression('true', context)).toBe(true);
    expect(evaluateExpression('"ready"', context)).toBe('ready');
  });

  it('rejects function calls, property escapes, and external access', () => {
    const context = { state: { health: 80 }, secret: 'do-not-read' };
    for (const expression of [
      'distance(self, nearestEnemyHero) < 450',
      'state.health.toString()',
      'state.__proto__.polluted',
      'state["health"]',
      'process.env.SECRET',
      'globalThis.process',
      'require("node:fs")',
    ]) {
      expect(() => evaluateExpression(expression, context)).toThrow(/unsafe|unsupported|invalid/i);
    }
    expect(() => evaluateExpression('true || process.exit()', context)).toThrow(/unsafe|unsupported|invalid/i);
  });
});
