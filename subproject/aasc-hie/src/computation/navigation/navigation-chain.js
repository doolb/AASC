const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
};

export const branchIdsFor = (goalId, stateVersion = 0, branches = 1) => (
  Array.from({ length: Math.max(1, Number(branches) || 1) }, (_, index) => `${goalId}:${stateVersion}:${index}`)
);

const flattenSteps = (goal, prefix = goal.id) => (goal.steps ?? []).flatMap((step) => {
  const id = `${prefix}:${step.id}`;
  const current = [{ ...clone(step), id, stepId: step.id, goalId: goal.id }];
  return current.concat(step.steps ? flattenSteps({ ...step, id }, id) : []);
});

const nodesFor = (goal, plan) => {
  const steps = flattenSteps(goal);
  const pathWaypoints = Array.isArray(plan?.path) ? plan.path : (plan?.path?.waypoints ?? []);
  if (!steps.length) {
    const target = goal.target ?? plan?.target;
    if (pathWaypoints.length > 1) return pathWaypoints.slice(1).map((waypoint, index) => ({
      id: `${goal.id}:waypoint-${index + 1}`,
      kind: 'map-waypoint',
      goalId: goal.id,
      target: clone(waypoint),
      terminal: index === pathWaypoints.length - 2,
    }));
    return target ? [{ id: `${goal.id}:target`, kind: 'target', goalId: goal.id, target: clone(target), terminal: Boolean(goal.terminal) }] : [{ id: goal.id, kind: goal.kind ?? 'goal', goalId: goal.id, target: clone(goal.target), terminal: Boolean(goal.terminal) }];
  }
  if (pathWaypoints.length > 1) {
    return steps.concat(pathWaypoints.slice(1).map((target, index) => ({
      id: `${goal.id}:waypoint-${index + 1}`,
      kind: 'map-waypoint',
      goalId: goal.id,
      target: clone(target),
      terminal: index === pathWaypoints.length - 2,
    })));
  }
  return steps;
};

export class NavigationChainBuilder {
  constructor(options = {}) { this.seed = options.seed ?? 0; }

  build(worldState = {}, goal = {}, options = {}) {
    if (!goal || typeof goal !== 'object' || !goal.id) throw new Error('navigation goal with id is required');
    const stateVersion = worldState.stateVersion ?? 0;
    const nodes = nodesFor(goal, options.plan);
    const branchIds = options.branchIds ?? branchIdsFor(goal.id, stateVersion, options.branches ?? 1);
    const planBlocked = options.planStatus === 'blocked'
      || options.plan?.status === 'blocked'
      || options.plan?.path?.status === 'blocked';
    const selectedIds = planBlocked ? [] : (options.selectedStepIds ?? options.selectedNodeIds);
    const selectedNodes = planBlocked ? [] : selectedIds?.length
      ? nodes.filter((node) => selectedIds.includes(node.stepId) || selectedIds.includes(node.id) || selectedIds.includes(node.id.split(':').at(-1)))
      : nodes;
    const terminal = nodes.some((node) => node.terminal) || Boolean(goal.terminal);
    const chain = {
      goalId: goal.id,
      navigatorId: options.navigator?.id,
      mode: options.navigator?.mode ?? goal.kind,
      stateVersion,
      gameTime: worldState.gameTime,
      status: planBlocked ? 'blocked' : (nodes.length ? 'complete' : 'blocked'),
      ...(planBlocked && (options.reason ?? options.plan?.reason) ? { reason: options.reason ?? options.plan.reason } : {}),
      terminal,
      branchIds: [...branchIds],
      nodeIds: nodes.map((node) => node.id),
      nodes: nodes.map((node, index) => ({
        id: node.id,
        navigatorId: options.navigator?.id ?? node.navigatorId ?? node.delegate,
        mode: options.navigator?.mode ?? node.kind,
        kind: node.kind,
        goalId: node.goalId ?? goal.id,
        stepId: node.stepId,
        target: clone(node.target),
        condition: node.condition ?? node.success,
        optional: Boolean(node.optional),
        terminal: Boolean(node.terminal),
        branchIds: [branchIds[index % branchIds.length]],
      })),
      selected: {
        fragmentId: `${goal.id}:fragment:${selectedNodes[0]?.stepId ?? 'target'}`,
        nodeIds: selectedNodes.map((node) => node.id),
        branchIds: [...branchIds],
        ...(planBlocked ? { executable: false } : {}),
      },
      fragments: nodes.map((node) => ({ fragmentId: `${goal.id}:fragment:${node.stepId ?? 'target'}`, nodeIds: [node.id], branchIds: [...branchIds], ...(planBlocked ? { executable: false } : {}) })),
    };
    if (options.plan) chain.plan = clone(options.plan);
    return chain;
  }
}

export const buildNavigationChain = (worldState, goal, options = {}) => new NavigationChainBuilder(options).build(worldState, goal, options);

export const selectChainFragment = (chain, fragmentOrStepId) => {
  if (!chain || !Array.isArray(chain.fragments)) throw new Error('navigation chain is required');
  if (chain.status === 'blocked') return { fragmentId: fragmentOrStepId, nodeIds: [], branchIds: [...(chain.branchIds ?? [])], executable: false };
  const fragment = chain.fragments.find((value) => value.fragmentId === fragmentOrStepId || value.nodeIds.includes(fragmentOrStepId) || value.fragmentId.endsWith(`:${fragmentOrStepId}`));
  if (!fragment) return { ...clone(chain.selected), fragmentId: fragmentOrStepId, nodeIds: [] };
  return clone(fragment);
};
