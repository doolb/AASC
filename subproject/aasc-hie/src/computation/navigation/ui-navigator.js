import { Navigator } from './map-navigator.js';
import { buildNavigationChain } from './navigation-chain.js';

const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
};

/** Compute UI actions from already-normalized UI state; image recognition stays outside computation. */
export class UiNavigator extends Navigator {
  constructor(options = {}) { super(options.id ?? 'ui', 'ui'); this.actionGenerator = options.actionGenerator; }

  getCurrentState(worldState = {}) {
    const layers = worldState.ui?.layers ?? [];
    return { navigatorId: this.id, mode: this.mode, id: worldState.ui?.topmost ?? layers.at(-1)?.id, status: layers.length ? 'confirmed' : 'unknown', confidence: Number(worldState.ui?.confidence ?? worldState.confidence ?? 0), stateVersion: worldState.stateVersion, observedAt: worldState.observedAt, data: { layers: clone(layers), topmost: worldState.ui?.topmost ?? null } };
  }

  plan(worldState = {}, goal = {}) {
    const state = this.getCurrentState(worldState);
    if (state.status !== 'confirmed') return { status: 'blocked', reason: 'ui-state-not-confirmed', navigatorId: this.id, goalId: goal.id, state };
    const action = goal.action ?? goal.command ?? goal.instruction ?? goal.target;
    if (!action || typeof action !== 'object') return { status: 'blocked', reason: 'ui-action-not-configured', navigatorId: this.id, goalId: goal.id, state };
    return { status: 'complete', navigatorId: this.id, goalId: goal.id, state, action: clone(action), confidence: state.confidence, stateVersion: worldState.stateVersion };
  }

  generateInstruction(worldState = {}, plan = {}) {
    if (!plan.action && plan.id) plan = this.plan(worldState, plan);
    if (plan.status !== 'complete') return { mode: 'none', confidence: Number(worldState.confidence ?? 0), reason: plan.reason ?? 'plan-not-complete', stateVersion: worldState.stateVersion };
    const action = this.actionGenerator ? this.actionGenerator(worldState, clone(plan.action), plan) : clone(plan.action);
    return { ...action, mode: action.mode ?? 'ui', sourceNavigator: this.id, targetStateVersion: worldState.stateVersion, confidence: plan.confidence ?? Number(worldState.confidence ?? 0) };
  }

  getNavigationChain(worldState, goal) { return buildNavigationChain(worldState, goal, { navigator: this, plan: this.plan(worldState, goal) }); }
}
