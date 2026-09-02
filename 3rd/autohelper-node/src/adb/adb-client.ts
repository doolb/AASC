import { spawn } from 'node:child_process';
import type { AdbClientLike, AdbCommandResult, AdbRunner, AdbRunnerOptions } from '../types.js';

const DEFAULT_ADB_COMMAND = 'adb';

function runAdbCommand(
  file: string,
  args: string[],
  options: AdbRunnerOptions = {},
): Promise<AdbCommandResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
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

function formatCommand(file: string, args: string[]): string {
  return [file, ...args].join(' ');
}

function assertSuccessful(result: AdbCommandResult, file: string, args: string[]): Buffer {
  if (result.exitCode !== 0) {
    const details = result.stderr.toString('utf8').trim() || `exit code ${result.exitCode}`;
    throw new Error(`ADB command failed (${formatCommand(file, args)}): ${details}`);
  }
  return result.stdout;
}

function assertCoordinate(value: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error('invalid tap coordinates');
  }
}

export type AdbClientOptions = {
  serial: string;
  runner?: AdbRunner;
};

export class AdbClient implements AdbClientLike {
  private readonly serial: string;
  private readonly runner: AdbRunner;

  public constructor(options: AdbClientOptions) {
    if (!options.serial.trim()) {
      throw new Error('ADB serial is required');
    }
    this.serial = options.serial.trim();
    this.runner = options.runner ?? runAdbCommand;
  }

  public async listDevices(): Promise<string[]> {
    const args = ['devices'];
    let output: Buffer;
    try {
      output = assertSuccessful(await this.runner(DEFAULT_ADB_COMMAND, args), DEFAULT_ADB_COMMAND, args);
    } catch (error: unknown) {
      throw new Error('failed to list ADB devices', { cause: error });
    }

    return output.toString('utf8')
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts.length >= 2 && parts[1] === 'device')
      .map((parts) => parts[0]);
  }

  public async assertConnected(): Promise<void> {
    const devices = await this.listDevices();
    if (!devices.includes(this.serial)) {
      throw new Error(`ADB device is not ready: ${this.serial}`);
    }
  }

  public async screenshot(): Promise<Buffer> {
    const args = ['-s', this.serial, 'exec-out', 'screencap', '-p'];
    try {
      return assertSuccessful(await this.runner(DEFAULT_ADB_COMMAND, args), DEFAULT_ADB_COMMAND, args);
    } catch (error: unknown) {
      throw new Error(`failed to capture screenshot from ${this.serial}`, { cause: error });
    }
  }

  public async tap(x: number, y: number): Promise<void> {
    assertCoordinate(x);
    assertCoordinate(y);
    const args = ['-s', this.serial, 'shell', 'input', 'tap', String(x), String(y)];
    try {
      assertSuccessful(await this.runner(DEFAULT_ADB_COMMAND, args), DEFAULT_ADB_COMMAND, args);
    } catch (error: unknown) {
      throw new Error(`failed to tap ${x},${y} on ${this.serial}`, { cause: error });
    }
  }
}
