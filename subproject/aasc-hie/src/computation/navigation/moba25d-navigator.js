import { MapNavigator } from './map-navigator.js';

export class Moba25dNavigator extends MapNavigator {
  constructor(options = {}) { super(options.id ?? 'map-2.5d', 'map-2.5d', options); }

  getCurrentState(worldState = {}) {
    const state = super.getCurrentState(worldState);
    return { ...state, mode: 'map-2.5d', data: { ...state.data, coordinateSystem: this.map?.coordinateSystem ?? { horizontal: ['x', 'z'], up: 'y' } } };
  }

  plan(worldState = {}, goal = {}) {
    const map = this.map ?? worldState.navmesh ?? worldState.map?.navmesh;
    if (map && map.spaceModel !== 'moba-25d') return { status: 'blocked', reason: 'moba-25d-navmesh-required', navigatorId: this.id, goalId: goal.id };
    return super.plan(worldState, goal);
  }

  generateInstruction(worldState, plan = {}) {
    const instruction = super.generateInstruction(worldState, plan);
    if (instruction.action !== 'move') return instruction;
    return { ...instruction, control: 'left-joystick', durationMs: Math.max(100, Math.min(500, Math.round(Number(plan.moveDurationMs ?? 350)))), reason: 'follow-moba-25d-path' };
  }

  getMapSnapshot() {
    return { mapId: this.map?.mapId, spaceModel: this.map?.spaceModel, revision: this.map?.revision, coordinateSystem: this.map?.coordinateSystem, tiles: this.map?.tiles ?? [], landmarks: this.map?.landmarks ?? [] };
  }
}
