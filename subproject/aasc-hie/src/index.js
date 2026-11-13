import { pathToFileURL } from 'node:url';

export { EnvironmentRegistry, normalizeEnvironment } from './runtime/environment.js';
export { RoleHost, RoleRuntime, normalizeRole } from './runtime/index.js';
export {
  AutonomyCoordinator,
  InstinctLayer,
  MuscleMemoryLayer,
  IntelligenceLayer,
} from './computation/autonomy-layers.js';
export { GoalManager, manageGoals } from './computation/goal-manager.js';
export { ProgressStore, createFileProgressStorage } from './computation/progress-store.js';
export { ActiveGoalController } from './runtime/active-goal.js';
export { NavigationGapQueue } from './runtime/navigation-gap-queue.js';
export { GameTaskBridge } from './runtime/game-task-bridge.js';
export { Localizer } from './computation/navigation/localizer.js';
export { BattleNavigator } from './computation/battle-navigator.js';
export { BattleHudRecognizer } from './recognition/battle-hud-recognizer.js';
export { ButtonStateRecognizer } from './recognition/button-state-recognizer.js';
export { GameStateRecognizer } from './recognition/game-state-recognizer.js';
export { SceneFingerprintClassifier } from './recognition/scene-fingerprint-classifier.js';
export { AdbVideoFrameSource } from './recognition/adb-video-frame-source.js';
export { BattleScoringLayer, ScriptScoringAdapter, scoreBattle } from './computation/battle-scoring-layer.js';

export function createApplication(options = {}) {
  return { options };
}

export function main() {
  console.log('AASC-HIE hierarchical autonomy engine ready.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
