export class NavigatorExecutor {
}
const defaultSleep = async (milliseconds) => {
    await new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
};
const assertPoint = (point, field) => {
    if (!Number.isInteger(point.x) || !Number.isInteger(point.y) || point.x < 0 || point.y < 0) {
        throw new Error('invalid ' + field);
    }
};
const assertMovement = (movement) => {
    if (!movement || !Number.isInteger(movement.radius) || movement.radius <= 0) {
        throw new Error('movement control is not configured');
    }
    assertPoint(movement.origin, 'movement origin');
    return movement;
};
const movementEndpoint = (movement, vector) => {
    const length = Math.hypot(vector.x, vector.y);
    if (!Number.isFinite(length) || length === 0) {
        throw new Error('spatial movement vector cannot be zero');
    }
    return {
        x: Math.round(movement.origin.x + ((vector.x / length) * movement.radius)),
        y: Math.round(movement.origin.y + ((vector.y / length) * movement.radius)),
    };
};
const instructionAction = (instruction) => (instruction.mode === 'none' ? 'none' : instruction.action);
export class AdbNavigatorExecutor extends NavigatorExecutor {
    options;
    sleep;
    constructor(options) {
        super();
        this.options = options;
        this.sleep = options.sleep ?? defaultSleep;
        if (options.movement && (!Number.isInteger(options.movement.radius) || options.movement.radius <= 0)) {
            throw new Error('invalid movement radius');
        }
    }
    async execute(instruction) {
        const action = instructionAction(instruction);
        if (instruction.mode === 'none') {
            return { executed: false, reason: 'noop', mode: instruction.mode, action };
        }
        if (this.options.dryRun) {
            return { executed: false, reason: 'dry-run', mode: instruction.mode, action };
        }
        if (instruction.mode === 'ui') {
            if (instruction.action === 'tap') {
                assertPoint(instruction.point, 'tap point');
                await this.options.adb.tap(instruction.point.x, instruction.point.y);
            }
            else if (instruction.action === 'switch-flow') {
                if (!this.options.switchFlow) {
                    throw new Error('flow switching is not configured');
                }
                await this.options.switchFlow(instruction.flowId);
            }
            else {
                await this.sleep(instruction.durationMs);
            }
            return { executed: true, reason: 'executed', mode: instruction.mode, action };
        }
        if (instruction.action === 'jump') {
            if (!this.options.jumpPoint) {
                throw new Error('jump control is not configured');
            }
            assertPoint(this.options.jumpPoint, 'jump point');
            await this.options.adb.tap(this.options.jumpPoint.x, this.options.jumpPoint.y);
            return { executed: true, reason: 'executed', mode: instruction.mode, action };
        }
        if (instruction.action === 'stop') {
            return { executed: true, reason: 'executed', mode: instruction.mode, action };
        }
        if (instruction.action === 'move' || instruction.action === 'turn') {
            const movement = assertMovement(this.options.movement);
            if (!this.options.adb.swipe) {
                throw new Error('ADB client does not support swipe');
            }
            const endpoint = movementEndpoint(movement, instruction.vector);
            await this.options.adb.swipe(movement.origin.x, movement.origin.y, endpoint.x, endpoint.y, instruction.durationMs);
            return { executed: true, reason: 'executed', mode: instruction.mode, action };
        }
        throw new Error('unsupported spatial navigation action');
    }
}
