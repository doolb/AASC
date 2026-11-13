import { buildNavigationChain } from './navigation/navigation-chain.js';

const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
};

const isEscape = (goal) => String(goal?.kind ?? '').startsWith('escape') || String(goal?.kind ?? '').startsWith('retreat');
const selfFor = (worldState) => worldState?.self ?? worldState?.units?.find((unit) => unit.team === 'ally' && unit.category === 'hero');
const finite = (value) => Number.isFinite(Number(value));
const healthRatioFor = (worldState) => {
  const value = worldState?.values?.healthRatio;
  if (value?.stale === false && finite(value.value)) return Number(value.value);
  const self = selfFor(worldState);
  if (self?.stale !== true && finite(self?.healthRatio)) return Number(self.healthRatio);
  return undefined;
};

/** Config-driven battle objective adapter; device execution remains external. */
export class BattleNavigator {
  constructor(options = {}) {
    this.id = options.id ?? 'battle';
    this.mode = 'battle';
    this.mapNavigator = options.mapNavigator;
    this.roleProfile = clone(options.roleProfile ?? {});
    this.policy = clone(options.policy ?? {});
  }

  plan(worldState = {}, goal = {}, context = {}) {
    if (goal.automatic === true) return this.planAutomatic(worldState, goal, context);
    const roleProfile = clone(goal.roleProfile ?? this.roleProfile);
    const health = Number(selfFor(worldState)?.health);
    const retreatHealth = Number(roleProfile.retreatHealth);
    const safetyRequired = Number.isFinite(health) && Number.isFinite(retreatHealth) && health < retreatHealth;
    const safety = { required: safetyRequired, ...(roleProfile.role ? { role: roleProfile.role } : {}) };
    const delegatedGoal = safetyRequired && goal.retreatGoal ? goal.retreatGoal : goal;
    if (isEscape(delegatedGoal)) {
      if (!this.mapNavigator?.plan) return { status: 'blocked', reason: 'map-navigator-required', navigatorId: this.id, goalId: goal.id };
      const delegated = this.mapNavigator.plan(worldState, delegatedGoal);
      return { status: delegated.status, reason: delegated.reason, navigatorId: this.id, goalId: goal.id, delegatedTo: this.mapNavigator.id ?? this.mapNavigator.mode, plan: clone(delegated), safety };
    }
    const action = goal.action ?? goal.command ?? goal.instruction;
    if (!action || typeof action !== 'object') return { status: 'blocked', reason: 'battle-action-required', navigatorId: this.id, goalId: goal.id };
    return { status: 'complete', navigatorId: this.id, goalId: goal.id, action: clone(action), objectives: clone(goal.objectives ?? []), ...(roleProfile.role ? { role: roleProfile.role } : {}), safety };
  }

  planAutomatic(worldState, goal, context) {
    const policy = { ...this.policy, ...(goal.policy ?? {}) };
    const blocked = (reason) => ({ status: 'blocked', reason, navigatorId: this.id, goalId: goal.id });
    if (!policy.battleUiId || worldState.ui?.topmost !== policy.battleUiId) return blocked('battle-ui-not-confirmed');
    const now = Number(context.now ?? Date.now());
    const observedAt = Number(worldState.observedAt);
    const maxAge = Number(policy.maxObservationAgeMs ?? 500);
    if (!Number.isFinite(observedAt) || !Number.isFinite(now) || now < observedAt || now - observedAt > maxAge) return blocked('battle-observation-stale');
    const confidence = Number(worldState.confidence ?? 0);
    const minimum = Number(policy.minConfidence ?? 0.7);
    if (!Number.isFinite(confidence) || confidence < minimum) return blocked('battle-confidence-too-low');
    const healthRatio = healthRatioFor(worldState);
    if (!Number.isFinite(healthRatio) || healthRatio < 0 || healthRatio > 1) return blocked('battle-health-unknown');
    const validity = { confidence, expiresAt: observedAt + maxAge, stateVersion: worldState.stateVersion };
    if (healthRatio <= Number(policy.retreatHealthRatio ?? 0.3)) {
      if (!policy.retreat) return blocked('battle-retreat-not-configured');
      return { status: 'complete', reason: 'low-health-retreat', navigatorId: this.id, goalId: goal.id,
        action: clone(policy.retreat), healthRatio, ...validity };
    }
    const target = (worldState.activeUnits ?? worldState.units ?? [])
      .filter((unit) => unit.team === 'enemy' && unit.attackable === true && unit.stale !== true
        && unit.visible !== false && Number(unit.confidence ?? 0) >= minimum)
      .sort((left, right) => Number(right.confidence ?? 0) - Number(left.confidence ?? 0))[0];
    if (!target) return blocked('battle-target-not-confirmed');
    if (!policy.attack) return blocked('battle-attack-not-configured');
    return { status: 'complete', reason: 'attack-confirmed-target', navigatorId: this.id,
      goalId: goal.id, targetId: target.id, action: clone(policy.attack), healthRatio,
      confidence: Math.min(confidence, Number(target.confidence)), expiresAt: validity.expiresAt,
      stateVersion: validity.stateVersion };
  }

  generateInstruction(worldState = {}, plan = {}) {
    if (plan.delegatedTo && this.mapNavigator?.generateInstruction) return this.mapNavigator.generateInstruction(worldState, plan.plan);
    return plan.status === 'complete' && plan.action && typeof plan.action === 'object'
      ? { ...clone(plan.action), mode: plan.action.mode ?? this.mode, sourceNavigator: this.id,
        targetStateVersion: worldState.stateVersion,
        ...(plan.expiresAt === undefined ? {} : { expiresAt: plan.expiresAt }),
        ...(plan.confidence === undefined ? {} : { confidence: plan.confidence }) }
      : { mode: this.mode, action: 'none', reason: plan.reason ?? 'plan-not-complete', targetStateVersion: worldState.stateVersion };
  }

  candidate(worldState = {}, goal = {}, context = {}) {
    const plan = this.plan(worldState, goal, context);
    if (plan.status !== 'complete') return { id: goal.id, active: false, status: 'blocked', reason: plan.reason,
      sourceLayer: 'muscle-memory', plan };
    return { id: goal.id, priority: Number(goal.priority ?? 0), sourceLayer: 'muscle-memory',
      plan: this.generateInstruction(worldState, plan), battlePlan: plan };
  }

  getNavigationChain(worldState, goal) { return buildNavigationChain(worldState, goal, { navigator: this, plan: this.plan(worldState, goal) }); }
}
