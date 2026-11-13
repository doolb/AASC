const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
};

const configuredPriority = (priorities, scenarioId) => {
  if (priorities instanceof Map) return Number(priorities.get(scenarioId));
  if (Array.isArray(priorities)) return Number(priorities.find((scenario) => scenario?.id === scenarioId)?.priority);
  return Number(priorities?.[scenarioId]);
};

/** Select one executable plan while retaining every scenario result for inspection. */
export class PriorityScheduler {
  constructor(options = {}) {
    this.priorities = options.priorities ?? options.package?.priorities ?? {};
    this.scenarios = options.scenarios ?? options.package?.scenarios ?? [];
    this.defaultPriority = options.defaultPriority ?? 0;
  }

  priority(candidate) {
    const direct = Number(candidate?.priority);
    if (Number.isFinite(direct)) return direct;
    const scenario = configuredPriority(this.priorities, candidate?.scenarioId);
    if (Number.isFinite(scenario)) return scenario;
    const configuredScenario = this.scenarios instanceof Map
      ? this.scenarios.get(candidate?.scenarioId)
      : this.scenarios.find?.((value) => value?.id === candidate?.scenarioId);
    return Number.isFinite(Number(configuredScenario?.priority)) ? Number(configuredScenario.priority) : this.defaultPriority;
  }

  select(worldState = {}, candidates = []) {
    const retained = (Array.isArray(candidates) ? candidates : []).map((candidate, index) => ({
      ...clone(candidate),
      effectivePriority: this.priority(candidate),
      candidateOrder: index,
    }));
    const available = retained.filter((candidate) => {
      const plan = candidate.plan;
      const planStatus = plan?.status;
      const pathStatus = plan?.path?.status;
      const complete = planStatus === undefined || planStatus === 'complete';
      return candidate.active !== false && candidate.status !== 'blocked' && plan !== undefined
        && complete && pathStatus !== 'blocked';
    });
    const selectedCandidate = [...available].sort((left, right) => right.effectivePriority - left.effectivePriority || String(left.id ?? '').localeCompare(String(right.id ?? '')) || left.candidateOrder - right.candidateOrder)[0];
    const selected = selectedCandidate ? clone(selectedCandidate.plan) : undefined;
    return {
      stateVersion: worldState.stateVersion,
      selectedId: selectedCandidate?.id,
      selected,
      selectedPlan: selected,
      candidate: selectedCandidate ? clone(selectedCandidate) : undefined,
      candidates: retained.map(clone),
      previews: retained.map((candidate) => clone(candidate.preview)),
      alerts: retained.flatMap((candidate) => Array.isArray(candidate.alerts) ? clone(candidate.alerts) : []),
    };
  }
}

export const selectPriorityPlan = (worldState, candidates, options) => new PriorityScheduler(options).select(worldState, candidates);
