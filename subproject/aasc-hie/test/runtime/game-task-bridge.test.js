import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameTaskBridge } from '../../src/runtime/game-task-bridge.js';
import { NavigationGapQueue } from '../../src/runtime/navigation-gap-queue.js';
import { AutonomyCoordinator } from '../../src/computation/autonomy-layers.js';

const directories = [];
async function directory() {
  const value = await mkdtemp(join(tmpdir(), 'hie-game-'));
  directories.push(value);
  return value;
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('game task bridge', () => {
  it('maps a blocked run and can report its evidence to the gap queue', async () => {
    const dir = await directory();
    await writeFile(join(dir, 'level.json'), JSON.stringify({ level: 30, pigs: [{ id: 1 }] }));
    await writeFile(join(dir, 'plan.json'), JSON.stringify({ status: 'search_limit', actions: [] }));
    await writeFile(join(dir, 'result.json'), JSON.stringify({ level: 30, status: 'interrupted', reason: 'unknown object', screenshot: 'interrupted.png', clicks: 0 }));
    const queue = new NavigationGapQueue();
    const bridge = new GameTaskBridge({ gapQueue: queue });
    const data = await bridge.snapshot(dir, { report: true });
    expect(data.observation.layout.pigs).toHaveLength(1);
    expect(data.plans[0].status).toBe('search_limit');
    expect(data.gaps[0]).toMatchObject({ goalId: 'pig-level-30', reason: 'unknown object', evidence: { directory: dir, clicks: 0 } });
    expect(queue.list()).toHaveLength(1);
  });

  it('does not invent a gap for pending or successful runs and rejects malformed evidence', async () => {
    const dir = await directory();
    const bridge = new GameTaskBridge();
    expect((await bridge.snapshot(dir)).gaps).toEqual([]);
    await writeFile(join(dir, 'result.json'), '{"status":"victory"}');
    expect((await bridge.snapshot(dir)).gaps).toEqual([]);
    await writeFile(join(dir, 'plan.json'), '[]');
    await expect(bridge.snapshot(dir)).rejects.toThrow('invalid game evidence plan.json');
  });

  it('passes the task state and gap through the real autonomy coordinator', async () => {
    const dir = await directory();
    await writeFile(join(dir, 'level.json'), '{"level":30}');
    await writeFile(join(dir, 'result.json'), '{"status":"interrupted","level":30,"reason":"blocked"}');
    const planner = vi.fn(({ worldState, gaps }) => ({
      plans: [{ id: 'inspect', priority: 100, plan: { action: 'none', level: worldState.gameTask.level } }],
      events: [{ reason: gaps[0].reason }],
    }));
    const coordinator = new AutonomyCoordinator({ intelligence: { planner } });
    const { decision } = await new GameTaskBridge().decide(dir, coordinator);
    expect(decision.selected).toMatchObject({ id: 'inspect', plan: { level: 30 } });
    expect(decision.gaps[0].reason).toBe('blocked');
    expect(planner).toHaveBeenCalledOnce();
  });

  it('requires explicit enablement and starts only the fixed script with validated arguments', async () => {
    await expect(new GameTaskBridge().run({})).rejects.toThrow('disabled');
    const launch = vi.fn(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0, null));
      return child;
    });
    const bridge = new GameTaskBridge({ enabled: true, gameRoot: '/tmp/game', spawn: launch });
    await expect(bridge.run({ startLevel: 1, windowId: '0x12;bad' })).rejects.toThrow('windowId');
    await expect(bridge.run({ startLevel: 30, windowId: '0x12', maxLevels: 2, duckAuto: true })).resolves.toEqual({ code: 0, signal: null, success: true });
    expect(launch).toHaveBeenCalledWith('python3', ['scripts/auto-pig-levels.py', '--start-level', '30', '--window-id', '0x12', '--display', ':1', '--max-levels', '2', '--duck-auto'], { cwd: '/tmp/game', stdio: 'inherit', shell: false });
  });
});
