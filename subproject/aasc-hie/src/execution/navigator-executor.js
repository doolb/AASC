import { CommandValidator } from './command.js';

const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
};

const point = (value) => ({ x: Math.round(Number(value.x)), y: Math.round(Number(value.y)) });
const validPoint = (value) => value && Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.y));

/** Execute validated navigation commands through an injected device adapter. */
export class CommandExecutor {
  constructor(options = {}) {
    this.adb = options.adb;
    this.enabled = options.enabled === true;
    this.dryRun = options.dryRun === true;
    this.validator = options.validator ?? new CommandValidator(options);
    this.now = options.now ?? (() => Date.now());
    this.rateLimitMs = Number(options.rateLimitMs ?? 0);
    this.lastExecutedAt = undefined;
    this.movement = options.movement;
  }

  async execute(command, context = {}) {
    const worldState = context.worldState ?? {};
    if (context.signal?.aborted) return { executed: false, reason: 'cancelled' };
    const validation = this.validator.validate(command, worldState);
    if (!validation.valid) return { executed: false, reason: validation.reason, validation };
    if (command.action === 'manual') return { executed: false, reason: 'manual-handoff', paused: true, action: command.action, detail: clone(command) };
    const enabled = context.enabled ?? this.enabled;
    if (!enabled) return { executed: false, reason: 'execution-disabled', action: command.action };
    if (context.dryRun ?? this.dryRun) return { executed: false, reason: 'dry-run', action: command.action, command: clone(command) };
    const at = Number(this.now());
    if (this.lastExecutedAt !== undefined && at - this.lastExecutedAt < this.rateLimitMs) return { executed: false, reason: 'rate-limited', action: command.action };
    if (!this.adb && command.action !== 'stop' && command.action !== 'none') return { executed: false, reason: 'adb-not-configured', action: command.action };
    if (command.action === 'tap') await this.adb.tap(command.point.x, command.point.y);
    else if (command.action === 'swipe') await this.adb.swipe(command.from.x, command.from.y, command.to.x, command.to.y, Number(command.durationMs ?? 300));
    else if (command.action === 'start') await this.adb.startActivity(command.packageName, command.activityName, Number(command.displayId ?? 0));
    else if (['move', 'joystick', 'turn'].includes(command.action)) {
      const movement = command.movement ?? this.movement;
      if (!validPoint(movement?.origin) || !Number.isFinite(Number(movement.radius)) || Number(movement.radius) <= 0) return { executed: false, reason: 'movement-not-configured', action: command.action };
      const origin = point(movement.origin);
      const vector = { x: Number(command.vector.x ?? 0), y: Number(command.vector.y ?? command.vector.z ?? 0) };
      const length = Math.hypot(vector.x, vector.y);
      if (!length) return { executed: false, reason: 'zero-movement', action: command.action };
      const endpoint = point({ x: origin.x + vector.x / length * movement.radius, y: origin.y + vector.y / length * movement.radius });
      await this.adb.swipe(origin.x, origin.y, endpoint.x, endpoint.y, Number(command.durationMs ?? 300));
    }
    this.lastExecutedAt = at;
    return {
      executed: true,
      reason: 'executed',
      action: command.action,
      mode: command.mode,
      ...(command.nextStateId || command.expectedStateId ? { expectedStateId: command.nextStateId ?? command.expectedStateId } : {}),
    };
  }
}

export class NavigatorExecutor extends CommandExecutor {}
