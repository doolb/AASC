import { findPolygonPath } from './pathfinder.js';
import { buildNavigationChain } from './navigation-chain.js';

const finite = (value) => Number.isFinite(Number(value));
const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
};

const pointFrom = (value) => value?.target ?? value?.position ?? value;
const coordinateSystemFor = (map) => map?.coordinateSystem ?? { horizontal: ['x', 'z'], up: 'y' };
const axesFor = (map) => coordinateSystemFor(map).horizontal ?? ['x', 'z'];
const distance = (left, right, dimensions) => Math.hypot(...dimensions.map((axis) => left[axis] - right[axis]));
const positionOf = (worldState) => worldState?.map?.position ?? worldState?.self?.position ?? worldState?.self?.worldPosition;

export class Navigator {
  constructor(id, mode) {
    if (typeof id !== 'string' || !id.trim()) throw new Error('navigator id is required');
    this.id = id.trim(); this.mode = mode;
  }

  getCurrentState(worldState = {}) {
    return { navigatorId: this.id, mode: this.mode, status: positionOf(worldState) ? 'confirmed' : 'unknown', confidence: Number(worldState.confidence ?? 0), stateVersion: worldState.stateVersion, observedAt: worldState.observedAt, data: { position: clone(positionOf(worldState)) } };
  }

  getNavigationChain(worldState, goal) { return buildNavigationChain(worldState, goal, { navigator: this }); }
}

export class MapNavigator extends Navigator {
  constructor(id = 'map', mode = 'map', options = {}) {
    super(id, mode); this.map = options.map; this.pathOptions = options.pathOptions ?? {}; this.arrivalRadius = options.arrivalRadius ?? 3; this.movementSpeed = options.movementSpeed;
  }

  validateTarget(target, map = this.map) {
    const point = pointFrom(target);
    const dimensions = this.dimensions(map);
    if (!point || dimensions.some((axis) => !finite(point[axis]))) throw new Error(`map target must contain finite ${dimensions.join(' and ')}`);
    return Object.fromEntries(dimensions.map((axis) => [axis, Number(point[axis])]));
  }

  dimensions(map = this.map) {
    const system = coordinateSystemFor(map);
    const axes = system.horizontal ?? ['x', 'z'];
    return this.mode === 'spatial-3d' && system.up && !axes.includes(system.up) ? [...axes, system.up] : axes;
  }

  getCurrentState(worldState = {}) {
    const position = positionOf(worldState);
    return { ...super.getCurrentState(worldState), data: { position: clone(position), mapId: this.map?.mapId ?? worldState.map?.mapId, spaceModel: this.map?.spaceModel ?? worldState.map?.spaceModel } };
  }

  plan(worldState = {}, goal = {}) {
    const start = positionOf(worldState);
    const map = this.map ?? worldState.navmesh ?? worldState.map?.navmesh;
    const dimensions = this.dimensions(map);
    const target = this.validateTarget(goal, map);
    if (!start) return { status: 'blocked', reason: 'map-position-unknown', navigatorId: this.id, goalId: goal.id };
    if (dimensions.some((axis) => !finite(start[axis]))) return { status: 'blocked', reason: 'map-position-invalid', navigatorId: this.id, goalId: goal.id };
    if (!map) return { status: 'blocked', reason: 'navmesh-required', navigatorId: this.id, goalId: goal.id };
    if (distance(start, target, dimensions) <= Number(goal.arrivalRadius ?? this.arrivalRadius)) return { status: 'complete', navigatorId: this.id, goalId: goal.id, dimensions, path: { status: 'complete', polygonIds: [], waypoints: [clone(start), target], cost: 0 }, reached: true, target };
    const path = findPolygonPath(map, start, target, { ...this.pathOptions, ...(goal.pathOptions ?? {}), dimensions, horizontal: axesFor(map) });
    return { status: path.status, reason: path.reason, navigatorId: this.id, goalId: goal.id, dimensions, target, path, stateVersion: worldState.stateVersion, confidence: Number(worldState.confidence ?? 0) };
  }

  generateInstruction(worldState = {}, plan = {}) {
    if (!plan.path && plan.id) plan = this.plan(worldState, plan);
    if (plan.status !== 'complete') return { mode: 'none', confidence: Number(worldState.confidence ?? 0), reason: plan.reason ?? 'plan-not-complete', stateVersion: worldState.stateVersion };
    if (plan.reached || plan.path.waypoints.length < 2) return { mode: this.mode, action: 'stop', sourceNavigator: this.id, targetStateVersion: worldState.stateVersion, confidence: Number(worldState.confidence ?? 0), reason: 'target-reached' };
    const start = plan.path.waypoints[0]; const waypoint = plan.path.waypoints[1];
    const dimensions = plan.dimensions ?? this.dimensions(this.map);
    const vector = Object.fromEntries(dimensions.map((axis) => [axis, (waypoint[axis] ?? 0) - (start[axis] ?? 0)]));
    return { mode: this.mode, action: 'move', control: this.mode === 'spatial-3d' ? 'spatial' : 'horizontal', vector, waypoint: clone(waypoint), path: clone(plan.path), pathRevision: this.map?.revision, sourceNavigator: this.id, targetStateVersion: worldState.stateVersion, confidence: Number(worldState.confidence ?? 0), ...(finite(this.movementSpeed) ? { speed: Number(this.movementSpeed) } : {}), reason: 'follow-navmesh-path' };
  }
}

export class Spatial3dNavigator extends MapNavigator {
  constructor(options = {}) { super(options.id ?? 'spatial-3d', 'spatial-3d', options); }

  plan(worldState = {}, goal = {}) {
    const map = this.map ?? worldState.navmesh ?? worldState.map?.navmesh;
    if (map && map.spaceModel !== 'spatial-3d') return { status: 'blocked', reason: 'spatial-3d-navmesh-required', navigatorId: this.id, goalId: goal.id };
    return super.plan(worldState, goal);
  }
}

export class HorizontalNavigator extends MapNavigator {
  constructor(options = {}) { super(options.id ?? 'horizontal', 'horizontal', options); }

  plan(worldState = {}, goal = {}) {
    const map = this.map ?? worldState.navmesh ?? worldState.map?.navmesh;
    const model = map?.spaceModel;
    if (model && !['horizontal', 'moba-25d'].includes(model)) return { status: 'blocked', reason: 'horizontal-navmesh-required', navigatorId: this.id, goalId: goal.id };
    return super.plan(worldState, goal);
  }
}
