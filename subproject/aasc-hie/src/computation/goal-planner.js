import { evaluateExpression, tokenize } from './restricted-expression.js';
import { buildNavigationChain } from './navigation/navigation-chain.js';

const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
};
const entries = (value) => value instanceof Map ? [...value.entries()] : Object.entries(value ?? {});
const conditionFor = (goal) => goal?.condition ?? goal?.when ?? goal?.success;
const actionFor = (goal) => goal?.action ?? goal?.actionName ?? goal?.command ?? goal?.instruction;

const contextFor = (worldState) => ({
  ...worldState,
  self: worldState.self ?? worldState.units?.find((unit) => unit.team === 'ally' && unit.category === 'hero'),
});

export class GoalPlanner {
  constructor(options = {}) {
    this.package = options.package ?? options.navigationPackage ?? {};
    this.navigators = options.navigators ?? {};
    this.defaultNavigator = options.defaultNavigator;
  }

  configuredGoal(goal) {
    const configured = (this.package.goals ?? []).find?.((candidate) => candidate?.id === goal?.id);
    return configured ? { ...clone(configured), ...clone(goal) } : goal;
  }

  navigatorFor(goal) {
    const inferredKeys = goal.kind?.startsWith('retreat-') ? ['map-2.5d', 'map', 'spatial-3d'] : [];
    const key = goal.delegate ?? goal.navigatorId ?? goal.navigationMode ?? (goal.kind?.startsWith('map-') ? goal.kind : goal.kind);
    const candidates = [key, ...inferredKeys, this.defaultNavigator].filter(Boolean);
    if (this.navigators instanceof Map) {
      const direct = candidates.map((candidate) => this.navigators.get(candidate)).find(Boolean);
      return direct ?? [...this.navigators.values()].find((navigator) => goal.kind?.startsWith('retreat-') && navigator?.mode?.startsWith('map'));
    }
    const direct = candidates.map((candidate) => this.navigators[candidate]).find(Boolean);
    return direct ?? Object.values(this.navigators).find((navigator) => goal.kind?.startsWith('retreat-') && navigator?.mode?.startsWith('map'));
  }

  condition(worldState, goal) {
    const expression = conditionFor(goal);
    if (!expression) return { expression: undefined, satisfied: true };
    try {
      const value = evaluateExpression(expression, contextFor(worldState));
      const tokens = tokenize(expression);
      const roots = tokens.reduce((names, token, index) => {
        if (token.type === 'identifier' && tokens[index - 1]?.type !== '.'
          && !['true', 'false', 'null', 'undefined'].includes(token.value)) names.add(token.value);
        return names;
      }, new Set());
      const context = contextFor(worldState);
      const missingRoot = [...roots].some((name) => !Object.prototype.hasOwnProperty.call(context, name) || context[name] === undefined);
      if (missingRoot) return { expression, satisfied: 'unknown' };
      return { expression, satisfied: value === undefined ? 'unknown' : Boolean(value) };
    } catch {
      return { expression, satisfied: 'unknown' };
    }
  }

  expandNode(worldState, goal, nodeId, stack) {
    const effectiveGoal = this.configuredGoal(goal);
    if (!effectiveGoal?.id) throw new Error('goal id is required');
    if (stack.has(effectiveGoal.id)) return { id: nodeId, goalId: effectiveGoal.id, kind: effectiveGoal.kind, status: 'blocked', reason: 'goal-cycle', condition: this.condition(worldState, effectiveGoal), children: [], nodes: [] };
    const nextStack = new Set(stack).add(effectiveGoal.id);
    const condition = this.condition(worldState, effectiveGoal);
    if (condition.satisfied === false) return { id: nodeId, goalId: effectiveGoal.id, kind: effectiveGoal.kind, status: 'blocked', reason: 'goal-condition-not-satisfied', condition, children: [], nodes: [] };
    const navigator = this.navigatorFor(effectiveGoal);
    const delegatedGoal = effectiveGoal.kind?.startsWith('retreat-') && navigator?.mode
      ? { ...effectiveGoal, kind: navigator.mode, delegate: navigator.mode }
      : effectiveGoal;
    const plan = navigator?.plan ? navigator.plan(worldState, delegatedGoal) : undefined;
    const children = (effectiveGoal.steps ?? []).map((step) => this.expandNode(worldState, step, `${nodeId}:${step.id}`, nextStack));
    const blockedChild = children.find((child) => child.status === 'blocked');
    const status = blockedChild ? 'blocked' : (plan?.status === 'blocked' ? 'blocked' : 'ready');
    const reason = blockedChild?.reason ?? (plan?.status === 'blocked' ? plan.reason : undefined);
    const result = {
      id: nodeId,
      goalId: effectiveGoal.id,
      kind: effectiveGoal.kind,
      status,
      ...(reason ? { reason } : {}),
      condition,
      children,
      nodes: children.flatMap((child) => [child, ...child.nodes]),
      ...(navigator ? { delegatedTo: navigator.id ?? delegatedGoal.delegate ?? delegatedGoal.kind } : {}),
      ...(plan ? { plan: clone(plan) } : {}),
    };
    return result;
  }

  expand(worldState = {}, goal = {}) {
    if (!goal?.id) throw new Error('goal id is required');
    const result = this.expandNode(worldState, goal, goal.id, new Set());
    const { id: _id, children: _children, ...root } = result;
    return { ...root, children: result.children, nodes: result.nodes };
  }

  expandAll(worldState = {}, goals = this.package.goals ?? []) { return (goals ?? []).map((goal) => this.expand(worldState, goal)); }

  reverseLookup(query = {}) {
    const condition = typeof query === 'string' ? query : query.condition;
    const action = typeof query === 'string' ? undefined : query.action;
    const matches = [];
    const seen = new Set();
    const visit = (goal, root = goal) => {
      if (!goal || typeof goal !== 'object') return;
      if ((condition && [goal.condition, goal.when, goal.success].includes(condition)) || (action && actionFor(goal) === action)) {
        const key = root.id ?? goal.id;
        if (!seen.has(key)) { seen.add(key); matches.push(root); }
      }
      for (const step of goal.steps ?? []) visit(step, root);
    };
    for (const [, goal] of entries(this.package.goals ?? [])) visit(goal);
    return matches.map(clone);
  }

  chain(worldState, goal, options = {}) {
    const expanded = this.expand(worldState, goal);
    return buildNavigationChain(worldState, goal, {
      ...options,
      plan: expanded.plan,
      planStatus: expanded.status,
      reason: expanded.reason,
    });
  }
}

export const expandGoal = (worldState, goal, options) => new GoalPlanner(options).expand(worldState, goal);
