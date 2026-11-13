import { evaluateExpression } from './restricted-expression.js';
import { branchIdsFor } from './navigation/navigation-chain.js';
import { findPolygonPath } from './navigation/pathfinder.js';

const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
};
const finite = (value) => Number.isFinite(Number(value));
const clamp = (value) => Math.max(0, Math.min(1, Number(value)));
const distance = (left, right, axes = ['x', 'z']) => left && right ? Math.hypot(...axes.map((axis) => (left[axis] ?? 0) - (right[axis] ?? 0))) : Infinity;
const position = (entity) => entity?.position ?? entity?.worldPosition;
const movementAxes = (state, action, target) => {
  const system = state?.map?.coordinateSystem ?? state?.navmesh?.coordinateSystem ?? action?.coordinateSystem;
  const horizontal = system?.horizontal ?? ['x', 'z'];
  const spatial3d = state?.map?.spaceModel === 'spatial-3d' || state?.navmesh?.spaceModel === 'spatial-3d' || action?.spaceModel === 'spatial-3d';
  return spatial3d && system?.up && !horizontal.includes(system.up) ? [...horizontal, system.up] : horizontal.filter((axis) => target?.[axis] !== undefined);
};
const moveTowards = (from, to, amount, axes = ['x', 'z']) => {
  if (!from || !to) return from;
  const length = distance(from, to, axes);
  if (!length || length <= amount) return { ...to };
  return { ...from, ...Object.fromEntries(axes.map((axis) => [axis, (from[axis] ?? 0) + (((to[axis] ?? 0) - (from[axis] ?? 0)) / length) * amount])) };
};
const hash = (seed, branch, tick) => {
  let value = (Number(seed) || 0) + branch * 1_103 + tick * 9_973;
  value = (value ^ (value >>> 16)) * 22_695_477;
  return ((value ^ (value >>> 13)) >>> 0) / 4_294_967_295;
};
const rulesFor = (worldState, options) => ({ ...(worldState.package?.rules ?? {}), ...(worldState.rules ?? {}), ...(options.rules ?? {}) });
const ruleFor = (rules, actor) => rules[actor?.id] ?? rules[actor?.category] ?? rules[actor?.team] ?? rules.hero ?? {};
const withContext = (state) => ({ ...state, self: state.self, units: state.units });

const conditionStatus = (condition, state) => {
  if (!condition) return true;
  try {
    const value = evaluateExpression(condition, withContext(state));
    return value === undefined ? 'unknown' : Boolean(value);
  } catch { return 'unknown'; }
};

const applyTransition = (state, transition, event) => {
  if (transition.type === 'set' && typeof transition.path === 'string') {
    const segments = transition.path.split('.').filter(Boolean);
    if (segments.length && segments.every((segment) => /^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(segment))) {
      let target = state;
      for (const segment of segments.slice(0, -1)) { target[segment] ??= {}; target = target[segment]; }
      target[segments.at(-1)] = clone(transition.value);
    }
  }
  event.type = transition.type ?? 'state-transition';
  event.path = transition.path;
  event.value = clone(transition.value);
};

/** Deterministic fixed-timestep battle/preplay simulator. */
export class BattleSimulator {
  constructor(options = {}) {
    this.rules = options.rules ?? {};
    this.rulesetId = options.rulesetId ?? 'default';
    this.navmesh = options.navmesh;
    this.goalPlanner = options.goalPlanner;
  }

  simulate(request = {}) {
    const source = request.worldState;
    if (!source || typeof source !== 'object') throw new Error('worldState is required');
    const horizonMs = Number(request.horizonMs ?? 1_000);
    const stepMs = Number(request.stepMs ?? 100);
    const branches = Math.max(1, Math.floor(Number(request.branches ?? 1)));
    if (!finite(horizonMs) || horizonMs < 0 || !finite(stepMs) || stepMs <= 0) throw new Error('horizonMs and stepMs must be valid');
    const goal = request.goal ?? { id: 'simulation' };
    const branchIds = request.branchIds ?? branchIdsFor(goal.id ?? 'simulation', source.stateVersion ?? 0, branches);
    const rules = { ...(source.packageSnapshot?.rules ?? {}), ...rulesFor(source, { rules: this.rules }) };
    const navmesh = request.navmesh ?? this.navmesh ?? source.navmesh;
    const warnings = [];
    const staleUnits = (source.units ?? source.entities ?? []).filter((unit) => unit?.stale);
    for (const unit of staleUnits) warnings.push({ code: 'stale-unit', unitId: unit.id, message: 'stale unit excluded from high-confidence prediction' });
    const baseConfidence = clamp((source.confidence ?? 1) * (staleUnits.length ? 0.6 : 1));
    const allBranches = [];
    for (let branchIndex = 0; branchIndex < branches; branchIndex += 1) {
      const state = clone(source);
      state.self ??= state.units?.find((unit) => unit.team === 'ally' && unit.category === 'hero');
      state.units ??= [];
      const events = [];
      const trajectory = [{ atMs: 0, observedAt: source.observedAt, gameTime: source.gameTime, self: clone(state.self), units: clone(state.units), metrics: clone(state.metrics) }];
      const cooldowns = new Map();
      if (state.self?.id !== undefined) cooldowns.set(state.self.id, Number(state.self.cooldowns?.attack ?? 0));
      for (const unit of state.units) if (unit.id !== undefined) cooldowns.set(unit.id, Number(unit.cooldowns?.attack ?? 0));
      const action = goal.action ?? goal.actions?.[0];
      const stochastic = {
        ...(rules.battle?.stochastic ?? {}),
        ...(goal.stochastic ?? {}),
        ...(action?.stochastic ?? {}),
      };
      let damageTaken = 0;
      let dead = false;
      let respawnAt;
      for (let atMs = stepMs, tick = 1; atMs <= horizonMs; atMs += stepMs, tick += 1) {
        for (const [actorId, value] of cooldowns) cooldowns.set(actorId, Math.max(0, value - stepMs));
        for (const transition of goal.transitions ?? []) {
          if (Number(transition.atMs) === atMs) {
            const event = { code: 'timed-transition', atMs, message: transition.message };
            applyTransition(state, transition, event);
            events.push(event);
            if (transition.type === 'warning' || transition.warning) warnings.push({ ...event, branchId: branchIds[branchIndex] });
          }
        }
        if (respawnAt !== undefined && atMs >= respawnAt) {
          dead = false; state.self.health = ruleFor(rules, state.self).respawnHealth ?? 100; state.self.position = clone(ruleFor(rules, state.self).respawnPosition ?? state.self.spawnPosition ?? state.self.position); respawnAt = undefined;
          events.push({ type: 'respawn', atMs, actorId: state.self.id });
        }
        const selfRule = ruleFor(rules, state.self);
        if (!dead && action?.kind === 'move' && action.actorId === state.self?.id) {
          const target = action.target ?? goal.target;
          const speed = Number(action.speed ?? selfRule.movementSpeed ?? 0);
          let nextTarget = target;
          if (navmesh) {
            const path = findPolygonPath(navmesh, state.self.position, target, action.pathOptions);
            if (path.status !== 'complete') {
              events.push({ type: 'navmesh-blocked', atMs, reason: path.reason, actorId: state.self.id });
              nextTarget = undefined;
            } else nextTarget = path.waypoints[1] ?? target;
          }
          const movementVariance = Number(stochastic.movementVariance ?? 0);
          const movementFactor = movementVariance > 0
            ? 1 + ((hash(request.seed ?? 0, branchIndex, tick) * 2 - 1) * movementVariance)
            : 1;
          if (nextTarget) state.self.position = moveTowards(state.self.position, nextTarget, speed * movementFactor * stepMs / 1_000, movementAxes(state, action, nextTarget));
        }
        if (!dead && action?.kind === 'attack') {
          const actor = action.actorId === state.self?.id ? state.self : state.units.find((unit) => unit.id === action.actorId);
          const target = state.units.find((unit) => unit.id === action.targetId);
          const actorRule = ruleFor(rules, actor);
          const range = Number(action.range ?? actorRule.attackRange ?? 0);
          const cooldown = Number(cooldowns.get(actor?.id) ?? 0);
          if (actor && target && !target.stale && target.health > 0 && distance(position(actor), position(target), movementAxes(state, action, position(target))) <= range && cooldown <= 0) {
            const hitChance = Number(action.hitChance ?? stochastic.hitChance ?? 1);
            const roll = hash(request.seed ?? 0, branchIndex, tick);
            if (roll <= hitChance) {
              const baseDamage = Number(action.damage ?? actorRule.attackDamage ?? 0);
              const damageVariance = Number(action.damageVariance ?? stochastic.damageVariance ?? 0);
              const damage = Math.max(0, baseDamage * (1 + ((roll * 2 - 1) * damageVariance)));
              target.health = Math.max(0, Number(target.health ?? 0) - damage);
              events.push({ type: 'attack', atMs, actorId: actor.id, targetId: target.id, damage });
              if (target.health <= 0) { target.dead = true; events.push({ type: 'death', atMs, actorId: target.id }); }
            } else events.push({ type: 'attack-missed', atMs, actorId: actor.id, targetId: target.id, roll, hitChance });
            cooldowns.set(actor.id, Number(action.cooldownMs ?? actorRule.attackCooldownMs ?? 1_000));
          }
        }
        if (!dead && action?.kind === 'skill') {
          const actor = action.actorId === state.self?.id ? state.self : state.units.find((unit) => unit.id === action.actorId);
          const skillId = typeof action.skillId === 'string' && action.skillId ? action.skillId : undefined;
          const cooldown = Number(cooldowns.get(actor?.id) ?? 0);
          if (actor && skillId && cooldown <= 0) {
            state.metrics ??= {};
            state.metrics.skills ??= {};
            state.metrics.skills[skillId] = Number(state.metrics.skills[skillId] ?? 0) + 1;
            cooldowns.set(actor.id, Number(action.cooldownMs ?? 0));
            events.push({ type: 'skill', atMs, actorId: actor.id, skillId, count: state.metrics.skills[skillId] });
          }
        }
        const enemy = state.units.find((unit) => unit.team === 'enemy' && !unit.stale && unit.health > 0);
        const enemyRule = ruleFor(rules, enemy);
        if (!dead && enemy && state.self && enemyRule.attackRange !== undefined && distance(position(enemy), position(state.self), movementAxes(state, undefined, position(state.self))) <= Number(enemyRule.attackRange)) {
          const enemyCooldown = Number(cooldowns.get(enemy.id) ?? enemy.cooldowns?.attack ?? 0);
          if (enemyCooldown <= 0) {
            const damage = Number(enemyRule.attackDamage ?? 0);
            state.self.health = Math.max(0, Number(state.self.health ?? 0) - damage); damageTaken += damage;
            cooldowns.set(enemy.id, Number(enemyRule.attackCooldownMs ?? 1_000));
            events.push({ type: 'attack', atMs, actorId: enemy.id, targetId: state.self.id, damage });
            if (state.self.health <= 0) { dead = true; events.push({ type: 'death', atMs, actorId: state.self.id }); if (Number(selfRule.respawnMs) > 0) respawnAt = atMs + Number(selfRule.respawnMs); }
          }
        }
        for (const unit of state.units) {
          if (unit.stale || !unit.position || !unit.velocity || unit.health <= 0) continue;
          const velocityAxes = Object.keys(unit.velocity).filter((axis) => finite(unit.position[axis]) && finite(unit.velocity[axis]));
          unit.position = { ...unit.position, ...Object.fromEntries(velocityAxes.map((axis) => [axis, unit.position[axis] + Number(unit.velocity[axis]) * stepMs])) };
        }
        trajectory.push({ atMs, observedAt: finite(source.observedAt) ? source.observedAt + atMs : undefined, gameTime: finite(source.gameTime) ? source.gameTime + atMs : undefined, self: clone(state.self), units: clone(state.units), metrics: clone(state.metrics) });
      }
      const branchEvents = clone(events);
      const objectives = (goal.objectives ?? []).map((objective) => {
        const finalState = trajectory.at(-1);
        const satisfied = conditionStatus(objective.condition ?? objective.when ?? objective.success, finalState);
        return { id: objective.id, status: satisfied === true ? 'complete' : 'pending', optional: Boolean(objective.optional), terminal: Boolean(objective.terminal), satisfied };
      });
      allBranches.push({ branchId: branchIds[branchIndex], seed: Number(request.seed ?? 0) + branchIndex, trajectory, events: branchEvents, objectives, riskScore: clamp((damageTaken / Math.max(1, Number(source.self?.health ?? 100))) + (dead ? 0.5 : 0)), confidence: baseConfidence * (dead ? 0.8 : 1), probability: 1 / branches, terminal: Boolean(goal.terminal) || objectives.some((objective) => objective.terminal && objective.status === 'complete') });
    }
    const first = allBranches[0];
    const result = {
      goalId: goal.id,
      stateVersion: source.stateVersion,
      gameTime: source.gameTime,
      rulesetId: request.rulesetId ?? source.package?.rulesetId ?? this.rulesetId,
      branchIds: [...branchIds],
      branches: allBranches,
      trajectory: first.trajectory,
      events: first.events,
      objectives: first.objectives,
      terminal: allBranches.some((branch) => branch.terminal),
      riskScore: allBranches.reduce((sum, branch) => sum + branch.riskScore, 0) / allBranches.length,
      confidence: allBranches.reduce((sum, branch) => sum + branch.confidence, 0) / allBranches.length,
      probability: allBranches.reduce((sum, branch) => sum + branch.probability, 0),
      warnings: clone(warnings),
    };
    const handoffRules = request.handoffRules ?? goal.handoffs
      ?? source.package?.rules?.battle?.handoffs
      ?? source.package?.rules?.goalHandoffs
      ?? rules.battle?.handoffs
      ?? rules.goalHandoffs
      ?? [];
    const planner = request.goalPlanner ?? this.goalPlanner;
    const finalState = first.trajectory.at(-1);
    for (const handoffRule of handoffRules) {
      if (conditionStatus(handoffRule.condition ?? handoffRule.when, finalState) !== true) continue;
      const configuredGoal = typeof handoffRule.goal === 'string'
        ? (source.package?.goals ?? source.packageSnapshot?.goals ?? []).find((candidate) => candidate.id === handoffRule.goal)
        : handoffRule.goal;
      if (!configuredGoal) continue;
      const expanded = planner?.expand({ ...finalState, stateVersion: source.stateVersion }, configuredGoal);
      result.handoff = {
        goalId: configuredGoal.id,
        goal: clone(configuredGoal),
        ...(expanded ? clone(expanded) : {}),
      };
      break;
    }
    return result;
  }
}

export const simulateBattle = (request, options) => new BattleSimulator(options).simulate(request);
