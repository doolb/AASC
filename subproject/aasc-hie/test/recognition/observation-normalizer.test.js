import { describe, expect, it } from 'vitest';
import { normalizeObservation } from '../../src/recognition/observation-normalizer.js';

describe('normalizeObservation', () => {
  it('preserves sensor data while attaching observation metadata and confidence', () => {
    const result = normalizeObservation({
      observedAt: 1234,
      gameTimeHint: 42,
      source: 'test-frame',
      ui: [{ id: 'battle-hud', visible: true, confidence: 0.9 }],
      entities: [{ id: 'enemy-1', category: 'hero', confidence: 0.8 }],
      map: { region: 'mid', confidence: 0.7 },
      values: { health: { value: 87, confidence: 0.95 } },
    });

    expect(result).toMatchObject({
      observedAt: 1234,
      gameTimeHint: 42,
      source: 'test-frame',
      ui: [{ id: 'battle-hud', visible: true, confidence: 0.9 }],
      entities: [{ id: 'enemy-1', category: 'hero', confidence: 0.8 }],
      map: { region: 'mid', confidence: 0.7 },
      values: { health: { value: 87, confidence: 0.95 } },
      confidence: expect.any(Number),
    });
    expect(result.confidence).toBeCloseTo(0.8375);
  });

  it('represents missing configured sensor values as unknown with zero confidence', () => {
    const result = normalizeObservation({
      observedAt: 1234,
      source: 'test-frame',
      sensorIds: ['enemyHero', 'battleText'],
    });

    expect(result.values).toEqual({
      enemyHero: { value: 'unknown', confidence: 0 },
      battleText: { value: 'unknown', confidence: 0 },
    });
    expect(result.confidence).toBe(0);
  });
});
