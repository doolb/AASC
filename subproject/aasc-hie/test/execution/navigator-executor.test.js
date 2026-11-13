import { describe, expect, it } from 'vitest';
import { CommandExecutor } from '../../src/execution/navigator-executor.js';

describe('CommandExecutor', () => {
  it('does not call ADB when disabled or in dry-run mode', async () => {
    const calls = [];
    const adb = { tap: async (...args) => calls.push(args) };
    const command = { action: 'tap', point: { x: 10, y: 20 }, targetStateVersion: 1, confidence: 1, expiresAt: 10_000 };
    const context = { worldState: { stateVersion: 1, confidence: 1 } };

    await expect(new CommandExecutor({ adb, now: () => 1_000 }).execute(command, context)).resolves.toMatchObject({ executed: false, reason: 'execution-disabled' });
    await expect(new CommandExecutor({ adb, enabled: true, dryRun: true, now: () => 1_000 }).execute(command, context)).resolves.toMatchObject({ executed: false, reason: 'dry-run' });
    expect(calls).toEqual([]);
  });

  it('executes a validated tap and rejects cancellation, expiry, and rate limits', async () => {
    const calls = [];
    const executor = new CommandExecutor({ enabled: true, adb: { tap: async (...args) => calls.push(args) }, now: () => 1_000, rateLimitMs: 500 });
    const command = { action: 'tap', point: { x: 10, y: 20 }, targetStateVersion: 1, confidence: 1, expiresAt: 10_000 };
    const context = { worldState: { stateVersion: 1, confidence: 1 } };

    await expect(executor.execute(command, { ...context, signal: { aborted: true } })).resolves.toMatchObject({ executed: false, reason: 'cancelled' });
    await expect(executor.execute({ ...command, expiresAt: 1_000 }, context)).resolves.toMatchObject({ executed: false, reason: 'expired' });
    await expect(executor.execute(command, context)).resolves.toMatchObject({ executed: true, action: 'tap' });
    await expect(executor.execute(command, context)).resolves.toMatchObject({ executed: false, reason: 'rate-limited' });
    expect(calls).toEqual([[10, 20]]);
  });

  it('rounds joystick origins before dispatching movement to the device', async () => {
    const calls = [];
    const executor = new CommandExecutor({
      enabled: true,
      now: () => 1_000,
      adb: {
        async swipe(...args) { calls.push(args); },
      },
    });

    await expect(executor.execute({
      action: 'joystick',
      vector: { x: 3, y: 4 },
      movement: { origin: { x: 100.4, y: 200.6 }, radius: 50 },
      durationMs: 120,
      confidence: 1,
    }, { worldState: { confidence: 1 } })).resolves.toMatchObject({ executed: true, action: 'joystick' });

    expect(calls).toEqual([[100, 201, 130, 241, 120]]);
  });

  it('returns a manual handoff without calling ADB', async () => {
    const calls = [];
    const executor = new CommandExecutor({ enabled: true, adb: { tap: async () => calls.push('tap') } });

    await expect(executor.execute({ action: 'manual', reason: 'login-required' }, {})).resolves.toMatchObject({
      executed: false, reason: 'manual-handoff', paused: true,
    });
    expect(calls).toEqual([]);
  });

  it('carries the expected navigation state into the execution result', async () => {
    const executor = new CommandExecutor({ enabled: true, adb: { tap: async () => {} } });
    await expect(executor.execute({ action: 'tap', point: { x: 10, y: 20 }, confidence: 1, nextStateId: 'hok-skin-select' }, { worldState: { confidence: 1 } })).resolves.toMatchObject({
      executed: true, expectedStateId: 'hok-skin-select',
    });
  });
});
