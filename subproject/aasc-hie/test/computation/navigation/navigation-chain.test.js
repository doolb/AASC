import { describe, expect, it } from 'vitest';
import {
  NavigationChainBuilder,
  buildNavigationChain,
  selectChainFragment,
} from '../../../src/computation/navigation/navigation-chain.js';
import { NavigatorRegistry } from '../../../src/computation/navigation/navigator-registry.js';

describe('navigation chains', () => {
  it('returns the complete chain and a selected visual fragment with stable branch identity', () => {
    const worldState = { stateVersion: 12, gameTime: 4_500 };
    const goal = {
      id: 'retreat',
      kind: 'compound',
      steps: [
        { id: 'leave-fight', kind: 'battle', terminal: false },
        { id: 'reach-safe-zone', kind: 'map-2.5d', target: { x: 20, z: 10 }, terminal: true },
      ],
    };
    const chain = new NavigationChainBuilder({ seed: 9 }).build(worldState, goal, {
      selectedStepIds: ['reach-safe-zone'],
    });

    expect(chain).toMatchObject({
      goalId: 'retreat',
      stateVersion: 12,
      status: 'complete',
      terminal: true,
      branchIds: ['retreat:12:0'],
    });
    expect(chain.nodes.map((node) => node.id)).toEqual(['retreat:leave-fight', 'retreat:reach-safe-zone']);
    expect(chain.selected).toEqual({
      fragmentId: 'retreat:fragment:reach-safe-zone',
      nodeIds: ['retreat:reach-safe-zone'],
      branchIds: ['retreat:12:0'],
    });
    expect(selectChainFragment(chain, 'leave-fight').nodeIds).toEqual(['retreat:leave-fight']);
  });

  it('can build from a planner plan without executing a command', () => {
    const chain = buildNavigationChain(
      { stateVersion: 3 },
      { id: 'move', kind: 'map-2.5d', target: { x: 5, z: 6 } },
      { plan: { navigatorId: 'map', path: [{ x: 0, z: 0 }, { x: 5, z: 6 }] } },
    );
    expect(chain.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'map-waypoint', target: { x: 5, z: 6 } }),
    ]));
    expect(chain.command).toBeUndefined();
  });

  it('creates configured adapters from package navigator modes', () => {
    const registry = new NavigatorRegistry()
      .register('horizontal', (options) => ({ mode: options.mode, configured: true }));
    expect(registry.createForPackage({
      metadata: { navigators: ['horizontal'] }, scenarios: [], flows: [],
    })).toEqual([{ mode: 'horizontal', configured: true }]);
  });

  it('propagates a blocked plan and leaves its selected fragment non-executable', () => {
    const chain = buildNavigationChain({ stateVersion: 5 }, {
      id: 'missing-map', kind: 'map-2.5d', target: { x: 8, z: 8 },
    }, { plan: { status: 'blocked', reason: 'navmesh-required' } });

    expect(chain).toMatchObject({ status: 'blocked', reason: 'navmesh-required', selected: { nodeIds: [] } });
    expect(chain.fragments.every((fragment) => fragment.executable === false)).toBe(true);
    expect(selectChainFragment(chain, 'target').nodeIds).toEqual([]);
  });
});
