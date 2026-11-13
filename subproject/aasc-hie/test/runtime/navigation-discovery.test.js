import { describe, expect, it } from 'vitest';
import { NavigationDiscovery } from '../../src/runtime/navigation-discovery.js';

describe('NavigationDiscovery', () => {
  it('deduplicates stable observations and emits ordinary map candidate operations', () => {
    const discovery = new NavigationDiscovery({ dedupWindowMs: 1_000 });
    const observation = { observedAt: 100, map: { position: { x: 2, z: 3 }, region: 'road', landmark: 'tower' } };

    const first = discovery.accept(observation, undefined, { now: 100 });
    const second = discovery.accept({ ...observation, observedAt: 200 }, undefined, { now: 200 });

    expect(first.candidateState).toMatchObject({ candidate: true, map: { region: 'road' } });
    expect(first.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: 'add', path: '/states/-', value: expect.objectContaining({ candidate: true }) }),
      expect.objectContaining({ op: 'add', path: '/states/-', value: expect.objectContaining({ kind: 'map-observation' }) }),
    ]));
    expect(second.operations).toEqual([]);
  });

  it('records an action-linked transition only after the signature changes', () => {
    const discovery = new NavigationDiscovery({ dedupWindowMs: 0 });
    discovery.accept({ observedAt: 100, ui: [{ id: 'menu', visible: true }] }, undefined, { now: 100 });
    const result = discovery.accept({ observedAt: 200, ui: [{ id: 'task', visible: true }] }, { executed: true, action: 'tap' }, { now: 200 });

    expect(result.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: 'add', path: '/flows/-', value: expect.objectContaining({ candidate: true, action: 'tap' }) }),
    ]));
  });

  it('records whether an executed navigation step reached its expected state', () => {
    const discovery = new NavigationDiscovery({ dedupWindowMs: 0 });
    discovery.accept({ observedAt: 100, ui: { topmost: 'hok-hero-select' } }, undefined, { now: 100 });
    const result = discovery.accept({ observedAt: 200, ui: { topmost: 'hok-skin-select' } }, {
      executed: true, action: 'tap', expectedStateId: 'hok-skin-select',
    }, { now: 200 });

    expect(result.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: 'add', path: '/flows/-', value: expect.objectContaining({
        verified: true, fromStateId: 'hok-hero-select', toStateId: 'hok-skin-select',
        verification: { expectedStateId: 'hok-skin-select', observedStateId: 'hok-skin-select' },
      }) }),
    ]));
  });
});
