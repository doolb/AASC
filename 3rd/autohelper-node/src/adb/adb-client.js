import { spawn } from 'node:child_process';
const DEFAULT_ADB_COMMAND = 'adb';
function runAdbCommand(file, args, options = {}) {
    return new Promise((resolvePromise, reject) => {
        const child = spawn(file, args, {
            cwd: options.cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false,
        });
        const stdout = [];
        const stderr = [];
        child.stdout.on('data', (chunk) => stdout.push(chunk));
        child.stderr.on('data', (chunk) => stderr.push(chunk));
        child.once('error', reject);
        child.once('close', (exitCode) => {
            resolvePromise({
                stdout: Buffer.concat(stdout),
                stderr: Buffer.concat(stderr),
                exitCode: exitCode ?? 1,
            });
        });
    });
}
function formatCommand(file, args) {
    return [file, ...args].join(' ');
}
function assertSuccessful(result, file, args) {
    if (result.exitCode !== 0) {
        const details = result.stderr.toString('utf8').trim() || `exit code ${result.exitCode}`;
        throw new Error(`ADB command failed (${formatCommand(file, args)}): ${details}`);
    }
    return result.stdout;
}
function assertCoordinate(value) {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
        throw new Error('invalid tap coordinates');
    }
}
function assertSwipeDuration(value) {
    if (!Number.isInteger(value) || value < 0) {
        throw new Error('invalid swipe duration');
    }
}
function assertActivityPart(value, field, pattern) {
    if (!value.trim() || !pattern.test(value)) {
        throw new Error(`invalid ${field}`);
    }
}
function assertDisplayId(value) {
    if (!Number.isInteger(value) || value < 0) {
        throw new Error('invalid display id');
    }
}
export class AdbClient {
    serial;
    runner;
    constructor(options) {
        if (!options.serial.trim()) {
            throw new Error('ADB serial is required');
        }
        this.serial = options.serial.trim();
        this.runner = options.runner ?? runAdbCommand;
    }
    async listDevices() {
        const args = ['devices'];
        let output;
        try {
            output = assertSuccessful(await this.runner(DEFAULT_ADB_COMMAND, args), DEFAULT_ADB_COMMAND, args);
        }
        catch (error) {
            throw new Error('failed to list ADB devices', { cause: error });
        }
        return output.toString('utf8')
            .split(/\r?\n/)
            .slice(1)
            .map((line) => line.trim().split(/\s+/))
            .filter((parts) => parts.length >= 2 && parts[1] === 'device')
            .map((parts) => parts[0]);
    }
    async assertConnected() {
        const devices = await this.listDevices();
        if (!devices.includes(this.serial)) {
            throw new Error(`ADB device is not ready: ${this.serial}`);
        }
    }
    async screenshot() {
        const args = ['-s', this.serial, 'exec-out', 'screencap', '-p'];
        try {
            return assertSuccessful(await this.runner(DEFAULT_ADB_COMMAND, args), DEFAULT_ADB_COMMAND, args);
        }
        catch (error) {
            throw new Error(`failed to capture screenshot from ${this.serial}`, { cause: error });
        }
    }
    async tap(x, y) {
        assertCoordinate(x);
        assertCoordinate(y);
        const args = ['-s', this.serial, 'shell', 'input', 'tap', String(x), String(y)];
        try {
            assertSuccessful(await this.runner(DEFAULT_ADB_COMMAND, args), DEFAULT_ADB_COMMAND, args);
        }
        catch (error) {
            throw new Error(`failed to tap ${x},${y} on ${this.serial}`, { cause: error });
        }
    }
    async swipe(x1, y1, x2, y2, durationMs = 300) {
        assertCoordinate(x1);
        assertCoordinate(y1);
        assertCoordinate(x2);
        assertCoordinate(y2);
        assertSwipeDuration(durationMs);
        const args = [
            '-s', this.serial, 'shell', 'input', 'swipe',
            String(x1), String(y1), String(x2), String(y2), String(durationMs),
        ];
        try {
            assertSuccessful(await this.runner(DEFAULT_ADB_COMMAND, args), DEFAULT_ADB_COMMAND, args);
        }
        catch (error) {
            throw new Error('failed to swipe on ' + this.serial, { cause: error });
        }
    }
    async startActivity(packageName, activityName, displayId = 0) {
        assertActivityPart(packageName, 'package name', /^[A-Za-z0-9._]+$/);
        assertActivityPart(activityName, 'activity name', /^[A-Za-z0-9._$]+$/);
        assertDisplayId(displayId);
        const args = [
            '-s', this.serial, 'shell', 'am', 'start', '--display', String(displayId),
            '-n', `${packageName}/${activityName}`,
        ];
        try {
            assertSuccessful(await this.runner(DEFAULT_ADB_COMMAND, args), DEFAULT_ADB_COMMAND, args);
        }
        catch (error) {
            throw new Error(`failed to start ${packageName}/${activityName} on ${this.serial}`, { cause: error });
        }
    }
}
