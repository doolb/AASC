import { describe, expect, it } from 'vitest';
import { StateFusion } from '../../src/computation/state-fusion.js';

describe('StateFusion', () => {
  it('merges timed values, map data, and all visible UI layers without mutating the source state', () => {
    const fusion = new StateFusion({ valueTtlMs: 250 });
    const previous = {
      stateVersion: 3,
      observedAt: 900,
      gameTime: 9_000,
      confidence: 0.7,
      ui: { layers: [{ id: 'hud' }], topmost: 'hud' },
      values: { health: { value: 90, confidence: 0.8 } },
      map: { region: 'mid' },
      entities: [],
    };
    const observation = {
      observedAt: 1_000,
      ui: [
        { id: 'hud', visible: true, zIndex: 1, confidence: 0.8 },
        { id: 'pause-menu', visible: true, zIndex: 5, confidence: 0.95 },
      ],
      values: { battleText: { value: 'retreat', confidence: 0.88 } },
      map: { region: 'top', confidence: 0.75 },
      entities: [],
      confidence: 0.85,
    };

    const result = fusion.merge(previous, observation, {
      observedAt: 1_000,
      gameTime: 10_000,
      confidence: 0.9,
    });

    expect(result).toMatchObject({
      observedAt: 1_000,
      gameTime: 10_000,
      confidence: 0.85,
      ui: {
        layers: [
          { id: 'hud', observedAt: 1_000, gameTime: 10_000 },
          { id: 'pause-menu', observedAt: 1_000, gameTime: 10_000 },
        ],
        topmost: 'pause-menu',
      },
      map: { region: 'top', observedAt: 1_000, gameTime: 10_000 },
      values: {
        health: { value: 90 },
        battleText: {
          value: 'retreat', observedAt: 1_000, gameTime: 10_000,
          confidence: 0.88, lastSeenAt: 1_000, validUntil: 1_250,
        },
      },
    });
    expect(previous).toEqual({
      stateVersion: 3,
      observedAt: 900,
      gameTime: 9_000,
      confidence: 0.7,
      ui: { layers: [{ id: 'hud' }], topmost: 'hud' },
      values: { health: { value: 90, confidence: 0.8 } },
      map: { region: 'mid' },
      entities: [],
    });
  });

  it('marks a carried timed value stale after its freshness deadline', () => {
    const fusion = new StateFusion({ valueTtlMs: 250 });
    const previous = {
      values: {
        health: {
          value: 90, observedAt: 1_000, gameTime: 10_000, confidence: 0.8,
          lastSeenAt: 1_000, validUntil: 1_250,
        },
      },
    };

    const result = fusion.merge(previous, { observedAt: 1_500, values: {} }, { gameTime: 10_500, confidence: 0.5 });

    expect(result.values.health).toMatchObject({
      value: 90,
      stale: true,
      freshness: { ageMs: 500, remainingMs: 0, stale: true },
    });
  });

  it('clears topmost when UI is explicitly observed with no visible layers', () => {
    const fusion = new StateFusion();
    const previous = { ui: { layers: [{ id: 'dialog' }], topmost: 'dialog' } };

    expect(fusion.merge(previous, { observedAt: 100, ui: [] }, { gameTime: 1_000 }).ui).toMatchObject({
      layers: [],
      topmost: null,
    });
    expect(fusion.merge(previous, { observedAt: 100, ui: [{ id: 'dialog', visible: false }] }, { gameTime: 1_000 }).ui).toMatchObject({
      layers: [],
      topmost: null,
    });
  });
});
