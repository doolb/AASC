const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
};

const asPlans = (value) => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

const resolve = async (value, context) => (typeof value === 'function' ? value(context) : value);

const normalizePlan = (candidate, defaults = {}) => {
  if (!candidate || typeof candidate !== 'object') return undefined;
  const plan = candidate.plan ?? candidate.command ?? candidate;
  return {
    ...clone(candidate),
    id: candidate.id ?? defaults.id,
    priority: Number(candidate.priority ?? defaults.priority ?? 0),
    plan: clone(plan),
    sourceLayer: candidate.sourceLayer ?? defaults.sourceLayer,
  };
};

/** A low-latency safety layer. It never mutates package data or executes commands. */
export class InstinctLayer {
  constructor(options = {}) {
    this.rules = Array.isArray(options.rules) ? options.rules : [];
    this.defaultPriority = Number(options.defaultPriority ?? 1000);
  }

  async decide(context = {}) {
    const plans = [];
    for (const rule of this.rules) {
      const matched = await resolve(rule.when ?? rule.match, context);
      if (!matched) continue;
      const value = await resolve(rule.plan ?? rule.command, context);
      const plan = normalizePlan(value, {
        id: `instinct:${rule.id ?? plans.length}`,
        priority: rule.priority ?? this.defaultPriority,
        sourceLayer: 'instinct',
      });
      if (plan) plans.push(plan);
    }
    return { layer: 'instinct', plans, gaps: [], events: [] };
  }
}

/** Configured routines and known navigation chains. Missing routines become gaps. */
export class MuscleMemoryLayer {
  constructor(options = {}) {
    this.planner = options.planner;
    this.failureLimit = Math.max(1, Number(options.failureLimit ?? 5));
    this.failures = new Map();
  }

  failureKey(context) {
    return String(context.goal?.id ?? context.goalId ?? context.state?.id ?? 'default');
  }

  async decide(context = {}) {
    const key = this.failureKey(context);
    const value = await resolve(this.planner, context);
    const plans = asPlans(value).map((candidate) => normalizePlan(candidate, {
      sourceLayer: 'muscle-memory',
    })).filter(Boolean);
    if (plans.length) {
      this.failures.delete(key);
      return { layer: 'muscle-memory', plans, gaps: [], events: [] };
    }

    const failures = (this.failures.get(key) ?? 0) + 1;
    this.failures.set(key, failures);
    const gaps = failures >= this.failureLimit ? [{
      type: 'navigation-gap',
      sourceLayer: 'muscle-memory',
      goalId: context.goal?.id ?? context.goalId,
      stateId: context.worldState?.ui?.topmost ?? context.state?.id,
      reason: 'no-plan',
      failures,
      requiresIntelligence: true,
    }] : [];
    return { layer: 'muscle-memory', plans: [], gaps, events: [] };
  }
}

/** High-level planning and package-update proposal layer. Updates are candidates only. */
export class IntelligenceLayer {
  constructor(options = {}) {
    this.planner = options.planner;
  }

  async decide(context = {}) {
    const value = await resolve(this.planner, context);
    const result = value && typeof value === 'object' ? value : {};
    const plans = asPlans(result.plans ?? result.plan).map((candidate) => normalizePlan(candidate, {
      sourceLayer: 'intelligence',
    })).filter(Boolean);
    return {
      layer: 'intelligence',
      plans,
      updates: clone(result.updates ?? []),
      gaps: [],
      events: clone(result.events ?? []),
      executed: false,
    };
  }
}

/** Run instinct, muscle-memory, and intelligence in order and select one plan. */
export class AutonomyCoordinator {
  constructor(options = {}) {
    const layerFor = (value, Layer) => {
      if (!value) return new Layer();
      return typeof value.decide === 'function' ? value : new Layer(value);
    };
    this.layers = [
      ['instinct', layerFor(options.instinct, InstinctLayer)],
      ['muscle-memory', layerFor(options.muscleMemory, MuscleMemoryLayer)],
      ['intelligence', layerFor(options.intelligence, IntelligenceLayer)],
    ];
  }

  async decide(context = {}) {
    const results = [];
    const gaps = [...(context.gaps ?? [])];
    let shared = { ...context };
    for (const [, layer] of this.layers) {
      const result = await layer.decide({ ...shared, gaps: [...gaps] });
      results.push(result);
      gaps.push(...(result.gaps ?? []));
      shared = { ...shared, gaps: [...gaps] };
    }
    const plans = results.flatMap((result) => result.plans ?? []);
    const selected = [...plans].sort((left, right) => Number(right.priority ?? 0) - Number(left.priority ?? 0)
      || String(left.id ?? '').localeCompare(String(right.id ?? '')))[0];
    return {
      selected: selected ? clone(selected) : undefined,
      plans: clone(plans),
      layers: clone(results),
      gaps: clone(gaps),
      updates: clone(results.flatMap((result) => result.updates ?? [])),
    };
  }
}
