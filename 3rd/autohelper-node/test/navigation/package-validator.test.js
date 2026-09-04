import { describe, expect, it } from 'vitest';
import { compileNavigationGraph } from '../../src/navigation/navigation-graph.js';
import { validateNavigationPackage } from '../../src/navigation/package-validator.js';

const packageWithErrors = {
  sourcePath: '/tmp/errors.nav.md',
  metadata: { id: 'errors' },
  scenarios: [{ id: 'daily', navigators: ['ui'] }],
  goals: [{ id: 'start', kind: 'ui', flowId: 'broken' }],
  states: [],
  navmeshes: [],
  assets: [],
  flows: [{
    id: 'broken',
    navigator: 'ui',
    steps: [
      { id: 'first', kind: 'action', goto: 'missing' },
      { id: 'delegate', kind: 'delegate', delegate: 'missing-navigator', terminal: true },
      { id: 'unreachable', kind: 'terminal', terminal: true },
    ],
  }],
};

describe('validateNavigationPackage', () => {
  it('reports missing references, missing delegates and unreachable nodes', () => {
    const diagnostics = validateNavigationPackage(packageWithErrors);

    expect(diagnostics.filter((item) => item.severity === 'error').map((item) => item.code))
      .toEqual(expect.arrayContaining([
        'missing-reference',
        'missing-delegate',
      ]));
    expect(diagnostics.some((item) => item.code === 'unreachable-node'
      && item.nodeId === 'flow:broken:unreachable')).toBe(true);
  });

  it('reports an unconditional cycle as an error', () => {
    const packageWithCycle = {
      ...packageWithErrors,
      goals: [{ id: 'cycle', kind: 'ui', flowId: 'cycle-flow' }],
      flows: [{
        id: 'cycle-flow',
        navigator: 'ui',
        steps: [
          { id: 'a', kind: 'action', goto: 'b' },
          { id: 'b', kind: 'action', goto: 'a' },
        ],
      }],
    };

    const diagnostics = validateNavigationPackage(packageWithCycle);
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unconditional-cycle', severity: 'error' }),
    ]));
  });

  it('accepts a valid package graph', () => {
    const valid = {
      ...packageWithErrors,
      goals: [{ id: 'start', kind: 'ui', flowId: 'valid' }],
      flows: [{
        id: 'valid',
        navigator: 'ui',
        steps: [
          { id: 'tap', kind: 'action', goto: 'done' },
          { id: 'done', kind: 'terminal', terminal: true },
        ],
      }],
    };

    expect(validateNavigationPackage(valid)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: 'error' })]),
    );
  });
});
