import { spawn } from 'node:child_process';

const DEFAULT_ADB_COMMAND = 'adb';

const runAdbCommand = (file, args, options = {}) => new Promise((resolvePromise, reject) => {
  const child = spawn(file, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  child.once('error', reject);
  child.once('close', (exitCode) => resolvePromise({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), exitCode: exitCode ?? 1 }));
});

const successful = (result, file, args) => {
  if (result.exitCode !== 0) throw new Error(`ADB command failed (${[file, ...args].join(' ')}): ${result.stderr?.toString('utf8').trim() || `exit code ${result.exitCode}`}`);
  return result.stdout;
};

const coordinate = (value) => {
  if (!Number.isInteger(value) || value < 0) throw new Error('invalid tap coordinates');
};

const duration = (value) => {
  if (!Number.isInteger(value) || value < 0) throw new Error('invalid swipe duration');
};

const activityPart = (value, field, pattern) => {
  if (typeof value !== 'string' || !value.trim() || !pattern.test(value)) throw new Error(`invalid ${field}`);
};

/** Minimal, argument-array based ADB adapter. */
export class AdbClient {
  constructor(options = {}) {
    if (typeof options.serial !== 'string' || !options.serial.trim()) throw new Error('ADB serial is required');
    this.serial = options.serial.trim();
    this.runner = options.runner ?? runAdbCommand;
  }

  async listDevices() {
    const args = ['devices'];
    try {
      return successful(await this.runner(DEFAULT_ADB_COMMAND, args), DEFAULT_ADB_COMMAND, args).toString('utf8')
        .split(/\r?\n/).slice(1).map((line) => line.trim().split(/\s+/))
        .filter((parts) => parts.length >= 2 && parts[1] === 'device').map((parts) => parts[0]);
    } catch (error) { throw new Error('failed to list ADB devices', { cause: error }); }
  }

  async assertConnected() {
    if (!(await this.listDevices()).includes(this.serial)) throw new Error(`ADB device is not ready: ${this.serial}`);
  }

  async screenshot() {
    const args = ['-s', this.serial, 'exec-out', 'screencap', '-p'];
    try { return successful(await this.runner(DEFAULT_ADB_COMMAND, args), DEFAULT_ADB_COMMAND, args); }
    catch (error) { throw new Error(`failed to capture screenshot from ${this.serial}`, { cause: error }); }
  }

  async tap(x, y) {
    coordinate(x); coordinate(y);
    const args = ['-s', this.serial, 'shell', 'input', 'tap', String(x), String(y)];
    try { successful(await this.runner(DEFAULT_ADB_COMMAND, args), DEFAULT_ADB_COMMAND, args); }
    catch (error) { throw new Error(`failed to tap ${x},${y} on ${this.serial}`, { cause: error }); }
  }

  async swipe(x1, y1, x2, y2, durationMs = 300) {
    coordinate(x1); coordinate(y1); coordinate(x2); coordinate(y2); duration(durationMs);
    const args = ['-s', this.serial, 'shell', 'input', 'swipe', String(x1), String(y1), String(x2), String(y2), String(durationMs)];
    try { successful(await this.runner(DEFAULT_ADB_COMMAND, args), DEFAULT_ADB_COMMAND, args); }
    catch (error) { throw new Error(`failed to swipe on ${this.serial}`, { cause: error }); }
  }

  async startActivity(packageName, activityName, displayId = 0) {
    activityPart(packageName, 'package name', /^[A-Za-z0-9._]+$/);
    activityPart(activityName, 'activity name', /^[A-Za-z0-9._$]+$/);
    if (!Number.isInteger(displayId) || displayId < 0) throw new Error('invalid display id');
    const args = ['-s', this.serial, 'shell', 'am', 'start', '--display', String(displayId), '-n', `${packageName}/${activityName}`];
    try { successful(await this.runner(DEFAULT_ADB_COMMAND, args), DEFAULT_ADB_COMMAND, args); }
    catch (error) { throw new Error(`failed to start ${packageName}/${activityName} on ${this.serial}`, { cause: error }); }
  }
}
