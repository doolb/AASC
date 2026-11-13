import { describe, expect, it } from 'vitest';
import { BattleScoringLayer, ScriptScoringAdapter } from '../../src/computation/battle-scoring-layer.js';

describe('BattleScoringLayer', () => {
  it('scores command validity, state verification, latency, goals, and economy', () => {
    const scorer = new BattleScoringLayer({
      weights: { validCommand: 0.3, stateTransition: 0.25, latency: 0.2, goalCompletion: 0.15, economyEfficiency: 0.1 },
      responseBudgetMs: { muscleMemory: 500, intelligence: 2_000 },
      now: () => 2_000,
    });
    scorer.recordCommand({ issuedAt: 1_000, completedAt: 1_200, sourceLayer: 'muscleMemory', executed: true });
    scorer.recordVerification({ verified: true, expectedStateId: 'battle', observedStateId: 'battle' });
    scorer.recordCommand({ issuedAt: 1_300, completedAt: 1_900, sourceLayer: 'muscleMemory', executed: true });
    scorer.recordVerification({ verified: false, expectedStateId: 'lane', observedStateId: 'base' });
    scorer.recordCommand({ issuedAt: 1_950, completedAt: 2_000, sourceLayer: 'intelligence', executed: false, reason: 'invalid-point' });

    const result = scorer.finish({ finalEconomy: 800, referenceEconomy: 1_000, goalCompletionRate: 0.8 });

    expect(result.metrics).toMatchObject({ commandCount: 3, invalidCommandCount: 2, verifiedTransitionCount: 1, failedTransitionCount: 1, intelligenceInterventions: 1 });
    expect(result.components).toMatchObject({ validCommand: expect.any(Number), stateTransition: 0.5, economyEfficiency: 0.8 });
    expect(result.invalidCommandPenalty).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('suggests increasing or decreasing muscle-memory confidence from the battle score', () => {
    const scorer = new BattleScoringLayer();
    expect(scorer.confidenceUpdate(0.5, 90)).toEqual({ previous: 0.5, next: 0.55, delta: 0.05 });
    expect(scorer.confidenceUpdate(0.5, 40)).toEqual({ previous: 0.5, next: 0.4, delta: -0.1 });
  });

  it('supports a restricted scoring script as an optional policy', async () => {
    const adapter = new ScriptScoringAdapter({ source: `({ score(input) { return { score: input.finalEconomy > 500 ? 80 : 20, policy: 'economy-only' }; } })` });
    await expect(adapter.score({ finalEconomy: 600 })).resolves.toEqual({ score: 80, policy: 'economy-only' });
  });

  it('scores intelligence-layer navigation data growth separately', () => {
    const scorer = new BattleScoringLayer({ now: () => 3_000 });
    scorer.recordCommand({ issuedAt: 1_000, completedAt: 1_100, sourceLayer: 'intelligence', executed: true });
    const result = scorer.finish({
      goalCompletionRate: 0.8,
      intelligence: {
        planValidityRate: 0.9,
        responseLatencyMs: 700,
        newNavigationDataCount: 6,
        navigationDataObservedCount: 10,
      },
    });

    expect(result.intelligenceScore).toBeGreaterThan(0);
    expect(result.intelligenceComponents).toMatchObject({
      goalCompletion: 0.8,
      planValidity: 0.9,
      newNavigationDataRate: 0.6,
    });
    expect(result.metrics).toMatchObject({ newNavigationDataCount: 6, navigationDataObservedCount: 10, newNavigationDataRate: 0.6 });
  });

  it('calculates a total score from end-to-end outcome components', () => {
    const scorer = new BattleScoringLayer();
    const result = scorer.finish({
      goalCompletionRate: 0.9,
      terminalOutcome: 'victory',
      safetyOutcome: 0.8,
      executionEfficiency: 0.75,
      navigationContribution: 0.6,
      resourceEfficiency: 0.7,
    });

    expect(result.totalScore).toBeGreaterThan(0);
    expect(result.totalComponents).toMatchObject({
      goalCompletion: 0.9,
      terminalOutcome: 1,
      safetyOutcome: 0.8,
      executionEfficiency: 0.75,
      navigationContribution: 0.6,
      resourceEfficiency: 0.7,
    });
  });
});
