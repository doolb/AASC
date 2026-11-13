const finite = (value) => Number.isFinite(Number(value));
const integer = (value) => Number.isInteger(Number(value));

const timeMs = (value) => {
  if (value === undefined || value === null) return Date.now();
  if (Number.isFinite(Number(value))) return Number(value);
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return parsed;
  throw new Error(`invalid command time: ${value}`);
};

const pointValid = (point) => point && integer(point.x) && integer(point.y) && Number(point.x) >= 0 && Number(point.y) >= 0;

const inScreen = (point, screen) => !screen || (
  Number(point.x) < Number(screen.width) && Number(point.y) < Number(screen.height)
);

const vectorLength = (vector) => Math.hypot(Number(vector?.x ?? 0), Number(vector?.y ?? vector?.z ?? 0));

/** Validate an instruction before it can reach an input adapter. */
export class CommandValidator {
  constructor(options = {}) {
    this.now = options.now ?? (() => Date.now());
    this.minConfidence = Number(options.minConfidence ?? 0);
    this.screen = options.screen;
    this.joystickRadius = options.joystickRadius;
  }

  validate(command, worldState = {}) {
    if (!command || typeof command !== 'object') return { valid: false, reason: 'command-required' };
    let now;
    try { now = timeMs(this.now()); } catch { now = Date.now(); }
    if (command.expiresAt !== undefined && now >= timeMs(command.expiresAt)) return { valid: false, reason: 'expired' };
    if (command.createdAt !== undefined && command.ttlMs !== undefined && now >= timeMs(command.createdAt) + Number(command.ttlMs)) return { valid: false, reason: 'expired' };
    if (command.targetStateVersion !== undefined && command.targetStateVersion !== worldState.stateVersion) return { valid: false, reason: 'state-version-mismatch' };
    const confidence = Number(command.confidence ?? worldState.confidence ?? 0);
    if (!finite(confidence) || confidence < this.minConfidence) return { valid: false, reason: 'confidence-too-low', confidence, minimum: this.minConfidence };
    const action = command.action;
    if (!['tap', 'swipe', 'move', 'joystick', 'turn', 'stop', 'none', 'start', 'manual'].includes(action)) return { valid: false, reason: 'unsupported-action' };
    if (action === 'tap') {
      if (!pointValid(command.point)) return { valid: false, reason: 'invalid-point' };
      if (!inScreen(command.point, this.screen)) return { valid: false, reason: 'point-out-of-bounds' };
    }
    if (action === 'swipe') {
      if (!pointValid(command.from) || !pointValid(command.to)) return { valid: false, reason: 'invalid-point' };
      if (!inScreen(command.from, this.screen) || !inScreen(command.to, this.screen)) return { valid: false, reason: 'point-out-of-bounds' };
      if (command.durationMs !== undefined && (!integer(command.durationMs) || Number(command.durationMs) < 0)) return { valid: false, reason: 'invalid-duration' };
    }
    if (['move', 'joystick', 'turn'].includes(action)) {
      if (!command.vector || !finite(command.vector.x) || (!finite(command.vector.y) && !finite(command.vector.z))) return { valid: false, reason: 'invalid-vector' };
      const radius = command.joystickRadius ?? this.joystickRadius;
      if (radius !== undefined && vectorLength(command.vector) > Number(radius)) return { valid: false, reason: 'joystick-radius-exceeded' };
    }
    if (action === 'start' && (!command.packageName || !command.activityName)) return { valid: false, reason: 'activity-required' };
    return { valid: true, action, confidence };
  }
}

export const validateCommand = (command, worldState, options) => new CommandValidator(options).validate(command, worldState);
