import { describe, expect, it } from 'vitest';
import {
  compileNavigationGraph,
  resolveNavigationChain,
} from '../../src/navigation/navigation-graph.js';

const navigationPackage = {
  sourcePath: '/tmp/game.nav.md',
  metadata: { id: 'game' },
  scenarios: [{ id: 'combat', priority: 100 }],
  states: [],
  navmeshes: [],
  assets: [],
  goals: [{
    id: 'escape',
    kind: 'compound',
    scenarioId: 'combat',
    steps: [
      { id: 'cast-fireball', kind: 'combat', success: 'combat.skill.fireball.count >= 3' },
      { id: 'reach-safe-area', kind: 'spatial-3d', delegate: 'spatial-3d', success: 'map.safe == true' },
      { id: 'confirm-escape', kind: 'ui', success: 'combat.result == escaped' },
    ],
  }],
  flows: [{
    id: 'escape-flow',
    scenarioId: 'combat',
    navigator: 'combat',
    steps: [
      { id: 'check-result', kind: 'choice', branches: [
        { when: 'combat.result == escaped', goto: 'done' },
        { when: 'combat.result == active', goto: 'cast' },
      ] },
      { id: 'cast', kind: 'action', action: 'cast-fireball', goto: 'move' },
      { id: 'move', kind: 'delegate', delegate: 'spatial-3d', goto: 'done' },
      { id: 'done', kind: 'terminal', terminal: true },
    ],
  }],
};

describe('navigation graph', () => {
  it('keeps cross-navigator flow nodes and resolves a state-dependent chain', () => {
    const graph = compileNavigationGraph(navigationPackage);
    const chain = resolveNavigationChain(graph, 'escape', {
      combat: { result: 'active', skill: { fireball: { count: 3 } } },
      map: { safe: false },
    });

    expect(graph.nodes.some((node) => node.navigator === 'spatial-3d')).toBe(true);
    expect(chain.nodeIds).toEqual([
      'goal:escape',
      'goal:escape:cast-fireball',
      'goal:escape:reach-safe-area',
      'goal:escape:confirm-escape',
    ]);
    expect(chain.status).toBe('partial');
  });

  it('does not require combat termination for an add-on skill-count goal', () => {
    const packageWithSkillGoal = {
      ...navigationPackage,
      goals: [{
        id: 'cast-three',
        kind: 'combat',
        success: 'combat.skill.fireball.count >= 3',
      }],
    };
    const graph = compileNavigationGraph(packageWithSkillGoal);
    const chain = resolveNavigationChain(graph, 'cast-three', {
      combat: { active: true, skill: { fireball: { count: 3 } } },
    });

    expect(chain.status).toBe('complete');
    expect(chain.nodeIds).toEqual(['goal:cast-three']);
    expect(chain.terminal).toBe(false);
  });

  it('preserves choice and repeat-until branches in the static graph', () => {
    const graph = compileNavigationGraph({
      ...navigationPackage,
      goals: [{ id: 'daily', kind: 'ui', flowId: 'daily-flow' }],
      flows: [{
        id: 'daily-flow',
        navigator: 'ui',
        steps: [
          { id: 'discover', kind: 'repeat-until', until: 'daily.done == true', goto: 'work' },
          { id: 'work', kind: 'choice', branches: [
            { when: 'daily.hasTask == true', goto: 'finish' },
            { goto: 'discover' },
          ] },
          { id: 'finish', kind: 'terminal', terminal: true },
        ],
      }],
    });

    expect(graph.edges.some((edge) => edge.kind === 'repeat')).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === 'branch')).toBe(true);
  });
});
