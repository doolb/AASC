import vm from 'node:vm';

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value) || 0));
const finite = (value) => Number.isFinite(Number(value));

const DEFAULT_WEIGHTS = Object.freeze({
  validCommand: 0.3,
  stateTransition: 0.25,
  latency: 0.2,
  goalCompletion: 0.15,
  economyEfficiency: 0.1,
});

const DEFAULT_INTELLIGENCE_WEIGHTS = Object.freeze({
  goalCompletion: 0.3,
  planValidity: 0.25,
  responseLatency: 0.15,
  newNavigationDataRate: 0.3,
});

const DEFAULT_TOTAL_WEIGHTS = Object.freeze({
  goalCompletion: 0.3,
  terminalOutcome: 0.05,
  safetyOutcome: 0.25,
  executionEfficiency: 0.15,
  navigationContribution: 0.15,
  resourceEfficiency: 0.1,
});

const nonCommandFailures = new Set(['execution-disabled', 'dry-run', 'manual-handoff', 'rate-limited', 'cancelled']);

/** Evaluate one battle session without issuing commands or mutating navigation data. */
export class BattleScoringLayer {
  constructor(options = {}) {
    this.weights = { ...DEFAULT_WEIGHTS, ...(options.weights ?? {}) };
    this.intelligenceWeights = { ...DEFAULT_INTELLIGENCE_WEIGHTS, ...(options.intelligenceWeights ?? {}) };
    this.totalWeights = { ...DEFAULT_TOTAL_WEIGHTS, ...(options.totalWeights ?? {}) };
    this.responseBudgetMs = { muscleMemory: 500, intelligence: 2_000, instinct: 150, ...(options.responseBudgetMs ?? {}) };
    this.now = options.now ?? (() => Date.now());
    this.commands = [];
    this.verifications = [];
  }

  recordCommand(event = {}) {
    const executed = event.executed === true;
    const invalid = event.invalid === true || (!executed && !nonCommandFailures.has(event.reason));
    const issuedAt = finite(event.issuedAt) ? Number(event.issuedAt) : undefined;
    const completedAt = finite(event.completedAt) ? Number(event.completedAt) : undefined;
    const latencyMs = finite(event.latencyMs) ? Number(event.latencyMs)
      : (issuedAt !== undefined && completedAt !== undefined ? Math.max(0, completedAt - issuedAt) : undefined);
    this.commands.push({ executed, invalid, sourceLayer: event.sourceLayer ?? 'unknown', latencyMs });
    return this.commands.at(-1);
  }

  recordVerification(event = {}) {
    const verification = { verified: event.verified === true, expectedStateId: event.expectedStateId, observedStateId: event.observedStateId };
    this.verifications.push(verification);
    if (!verification.verified) {
      const command = this.commands.at(-1);
      if (command) command.invalid = true;
    }
    return verification;
  }

  snapshot() {
    const layers = {};
    for (const command of this.commands) {
      const name = command.sourceLayer;
      const layer = layers[name] ?? { commandCount: 0, executedCount: 0, invalidCount: 0, responseLatencyMs: [] };
      layer.commandCount += 1;
      if (command.executed) layer.executedCount += 1;
      if (command.invalid) layer.invalidCount += 1;
      if (Number.isFinite(command.latencyMs)) layer.responseLatencyMs.push(command.latencyMs);
      layers[name] = layer;
    }
    for (const layer of Object.values(layers)) {
      const durations = layer.responseLatencyMs;
      layer.averageResponseLatencyMs = durations.length
        ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null;
      delete layer.responseLatencyMs;
    }
    return {
      commandCount: this.commands.length,
      verifiedTransitionCount: this.verifications.filter((item) => item.verified).length,
      failedTransitionCount: this.verifications.filter((item) => !item.verified).length,
      layers,
    };
  }

  finish(result = {}) {
    const commandCount = this.commands.length;
    const invalidCommandCount = this.commands.filter((command) => command.invalid).length;
    const executedCommandCount = this.commands.filter((command) => command.executed).length;
    const verifiedTransitionCount = this.verifications.filter((item) => item.verified).length;
    const failedTransitionCount = this.verifications.length - verifiedTransitionCount;
    const latencyValues = this.commands.map((command) => command.latencyMs).filter(finite).sort((a, b) => a - b);
    const p95Index = latencyValues.length ? Math.min(latencyValues.length - 1, Math.ceil(latencyValues.length * 0.95) - 1) : -1;
    const budgetValues = this.commands.map((command) => Number(this.responseBudgetMs[command.sourceLayer])).filter(finite);
    const responseBudgetMs = budgetValues.length ? Math.max(...budgetValues) : Number(this.responseBudgetMs.muscleMemory);
    const finalEconomy = finite(result.finalEconomy) ? Math.max(0, Number(result.finalEconomy)) : undefined;
    const referenceEconomy = finite(result.referenceEconomy) && Number(result.referenceEconomy) > 0 ? Number(result.referenceEconomy) : undefined;
    const economyEfficiency = referenceEconomy === undefined ? 0 : clamp(finalEconomy / referenceEconomy);
    const intelligence = result.intelligence ?? {};
    const navigationDataAdded = finite(intelligence.newNavigationDataCount) ? Math.max(0, Number(intelligence.newNavigationDataCount)) : 0;
    const navigationDataObserved = finite(intelligence.navigationDataObservedCount)
      ? Math.max(0, Number(intelligence.navigationDataObservedCount)) : 0;
    const newNavigationDataRate = finite(intelligence.newNavigationDataRate)
      ? clamp(intelligence.newNavigationDataRate)
      : (navigationDataObserved > 0 ? clamp(navigationDataAdded / navigationDataObserved) : 0);
    const intelligenceResponseLatencyMs = finite(intelligence.responseLatencyMs) ? Math.max(0, Number(intelligence.responseLatencyMs)) : 0;
    const intelligenceComponents = {
      goalCompletion: clamp(intelligence.goalCompletionRate ?? result.goalCompletionRate ?? 0),
      planValidity: clamp(intelligence.planValidityRate ?? 0),
      responseLatency: clamp(1 - intelligenceResponseLatencyMs / Math.max(1, Number(this.responseBudgetMs.intelligence) || 2_000)),
      newNavigationDataRate,
    };
    const intelligenceScore = clamp(Object.entries(this.intelligenceWeights)
      .reduce((sum, [key, weight]) => sum + intelligenceComponents[key] * Number(weight || 0), 0) * 100);
    const components = {
      validCommand: commandCount ? clamp(executedCommandCount / commandCount) : 0,
      stateTransition: this.verifications.length ? clamp(verifiedTransitionCount / this.verifications.length) : 0,
      latency: p95Index < 0 ? 0 : clamp(1 - latencyValues[p95Index] / Math.max(1, responseBudgetMs)),
      goalCompletion: clamp(result.goalCompletionRate ?? 0),
      economyEfficiency,
    };
    const weightedScore = Object.entries(this.weights).reduce((sum, [key, weight]) => sum + components[key] * Number(weight || 0), 0);
    const invalidCommandPenalty = invalidCommandCount * 5 * (1 + (1 - economyEfficiency));
    const score = clamp(weightedScore * 100 - invalidCommandPenalty, 0, 100);
    const terminalOutcome = result.terminalOutcome === true || ['win', 'victory', 'success', 'won'].includes(String(result.terminalOutcome ?? '').toLowerCase())
      ? 1 : (result.terminalOutcome === false || ['loss', 'defeat', 'failed', 'lost'].includes(String(result.terminalOutcome ?? '').toLowerCase()) ? 0 : components.goalCompletion);
    const totalComponents = {
      goalCompletion: components.goalCompletion,
      terminalOutcome,
      safetyOutcome: clamp(result.safetyOutcome ?? result.survivalRate ?? 0),
      executionEfficiency: clamp(result.executionEfficiency ?? (components.validCommand * 0.6 + components.latency * 0.4)),
      navigationContribution: clamp(result.navigationContribution ?? intelligence.navigationDataValue ?? newNavigationDataRate),
      resourceEfficiency: clamp(result.resourceEfficiency ?? economyEfficiency),
    };
    const totalScore = clamp(Object.entries(this.totalWeights)
      .reduce((sum, [key, weight]) => sum + totalComponents[key] * Number(weight || 0), 0) * 100);
    return {
      score,
      components,
      intelligenceScore,
      intelligenceComponents,
      totalScore,
      totalComponents,
      invalidCommandPenalty,
      metrics: {
        commandCount, executedCommandCount, invalidCommandCount,
        verifiedTransitionCount, failedTransitionCount,
        intelligenceInterventions: this.commands.filter((command) => command.sourceLayer === 'intelligence').length,
        newNavigationDataCount: navigationDataAdded,
        navigationDataObservedCount: navigationDataObserved,
        newNavigationDataRate,
        intelligenceResponseLatencyMs,
        responseLatencyP95Ms: p95Index < 0 ? 0 : latencyValues[p95Index],
        responseBudgetMs,
        finalEconomy,
        referenceEconomy,
      },
      flowConfidence: this.confidenceUpdate(result.currentFlowConfidence ?? 0.5, score),
      finishedAt: result.finishedAt ?? this.now(),
    };
  }

  confidenceUpdate(previous, score) {
    const before = clamp(previous);
    const delta = Number(score) >= 70 ? 0.05 : -0.1;
    const next = clamp(before + delta);
    return { previous: before, next, delta: Number((next - before).toFixed(4)) };
  }
}

/** Optional restricted policy script for scene-specific score adjustments. */
export class ScriptScoringAdapter {
  constructor(options = {}) {
    this.timeoutMs = Math.max(1, Number(options.timeoutMs ?? 50));
    if (typeof options.source !== 'string' || !options.source.trim()) throw new Error('scoring script source is required');
    this.context = vm.createContext(Object.create(null));
    const module = new vm.Script(`(${options.source})`, { filename: 'scoring-policy' }).runInContext(this.context, { timeout: this.timeoutMs });
    if (typeof module?.score !== 'function') throw new Error('scoring script must export score()');
    this.context.module = module;
  }

  async score(input = {}) {
    this.context.input = JSON.parse(JSON.stringify(input));
    this.context.result = undefined;
    new vm.Script('result = module.score(input)', { filename: 'scoring-policy:score' }).runInContext(this.context, { timeout: this.timeoutMs });
    return JSON.parse(JSON.stringify(this.context.result ?? {}));
  }
}

export const scoreBattle = (events, result, options) => {
  const scorer = new BattleScoringLayer(options);
  for (const event of events ?? []) scorer.recordCommand(event);
  return scorer.finish(result);
};
