import { describe, expect, it } from 'vitest';
import { AlertEngine } from '../../src/computation/alert-engine.js';

describe('AlertEngine', () => {
  it('requires the configured duration, deduplicates, and emits a clear event', () => {
    const engine = new AlertEngine({ alerts: [{
      id: 'low-health', severity: 'critical', priority: 100, when: 'self.health < 30', forMs: 500, clearWhen: 'self.health >= 30', cooldownMs: 1000,
    }] });
    const danger = { stateVersion: 4, gameTime: 80, confidence: 0.8, self: { health: 20 } };

    expect(engine.evaluate(danger, undefined, 0)).toEqual([]);
    expect(engine.evaluate(danger, undefined, 499)).toEqual([]);
    expect(engine.evaluate(danger, undefined, 500)).toMatchObject([{ id: 'low-health', severity: 'critical', stateVersion: 4, gameTime: 80 }]);
    expect(engine.evaluate(danger, undefined, 600)).toEqual([]);
    expect(engine.clear({ ...danger, self: { health: 40 } }, 700)).toMatchObject([{ id: 'low-health', type: 'clear', stateVersion: 4 }]);
  });

  it('evaluates preview context and orders emitted alerts by priority', () => {
    const engine = new AlertEngine({ alerts: [
      { id: 'risk', when: 'riskScore > 0.7', priority: 10, sourceNavigator: 'battle' },
      { id: 'warning', when: 'riskScore > 0.7', priority: 50, sourceNavigator: 'map' },
    ] });
    const alerts = engine.evaluate({ stateVersion: 9, confidence: 0.6 }, { riskScore: 0.8 }, 1000);

    expect(alerts.map((alert) => alert.id)).toEqual(['warning', 'risk']);
    expect(alerts).toEqual(expect.arrayContaining([expect.objectContaining({ sourceNavigator: 'map', confidence: 0.6 })]));
  });
});
