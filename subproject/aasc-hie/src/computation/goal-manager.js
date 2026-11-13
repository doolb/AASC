import { GoalPlanner } from './goal-planner.js';
import { ProgressStore } from './progress-store.js';

const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
};

const decorate = async (node, goal, progressStore) => {
  const progress = await progressStore.get(goal ?? { id: node.goalId });
  const children = [];
  for (let index = 0; index < (node.children ?? []).length; index += 1) {
    children.push(await decorate(node.children[index], goal?.steps?.[index] ?? { id: node.children[index].goalId }, progressStore));
  }
  const childCompleted = children.length > 0 && children.every((child) => child.progress.completed);
  return {
    ...clone(node),
    id: node.id ?? node.goalId,
    progress: { ...progress, completed: progress.completed || childCompleted },
    children,
  };
};

const evaluateNode = async (node, goal, worldState, progressStore) => {
  const children = [];
  for (let index = 0; index < (node.children ?? []).length; index += 1) {
    children.push(await evaluateNode(node.children[index], goal?.steps?.[index] ?? { id: node.children[index].goalId }, worldState, progressStore));
  }
  const progress = await progressStore.get(goal ?? { id: node.goalId });
  const conditionComplete = node.condition?.expression !== undefined && node.condition?.satisfied === true;
  const childrenComplete = children.length > 0 && children.every((child) => child.completed);
  const completed = progress.completed === true || (children.length > 0 ? childrenComplete : conditionComplete);
  const status = completed ? 'complete' : (node.status === 'blocked' ? 'blocked' : 'pending');
  return {
    ...clone(node),
    id: node.id ?? node.goalId,
    status,
    completed,
    progress: { ...progress, completed },
    children,
  };
};

/** Intelligence-layer facade for goal decomposition and persisted progress. */
export class GoalManager {
  constructor(options = {}) {
    this.planner = options.planner ?? new GoalPlanner(options);
    this.progressStore = options.progressStore ?? new ProgressStore(options.progress ?? {});
  }

  plan(worldState = {}, goal = {}) { return this.planner.expand(worldState, goal); }

  get(goalId) {
    const goal = (this.planner.package?.goals ?? []).find?.((candidate) => candidate?.id === goalId);
    return goal ? clone(goal) : undefined;
  }

  list() { return clone(this.planner.package?.goals ?? []); }

  async evaluate(worldState = {}, goal = {}) {
    return evaluateNode(this.planner.expand(worldState, goal), goal, worldState, this.progressStore);
  }

  async next(worldState = {}, goal = {}) {
    const evaluation = await this.evaluate(worldState, goal);
    const find = async (node, definition) => {
      if (node.completed) return undefined;
      if (!(node.children ?? []).length) return { ...clone(definition), id: definition.id ?? node.goalId, nodeId: node.id };
      for (let index = 0; index < node.children.length; index += 1) {
        const child = await find(node.children[index], definition?.steps?.[index] ?? { id: node.children[index].goalId });
        if (child) return child;
      }
      return undefined;
    };
    return find(evaluation, goal);
  }

  async status(worldState = {}, goals = []) {
    return Promise.all((goals ?? []).map((goal) => this.evaluate(worldState, goal)));
  }

  record(goal, patch, at) { return this.progressStore.record(goal, patch, at); }

  snapshot() { return this.progressStore.snapshot(); }
}

export const manageGoals = (worldState, goals, options) => new GoalManager(options).status(worldState, goals);
