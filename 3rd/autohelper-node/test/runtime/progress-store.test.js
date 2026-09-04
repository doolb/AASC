import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { periodKey, ProgressStore } from '../../src/runtime/progress-store.js';
const roots = [];
const target = {
    id: 'daily-routine',
    type: 'daily',
    enabled: true,
    feature: 'enter-game',
    entryFlow: 'open-task',
    resultState: 'task-panel',
    doneState: 'daily-complete',
    completion: 'all-discovered-subgoals',
    filePath: '/tmp/daily-routine.txt',
};
afterEach(async () => {
    await Promise.all(roots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })));
});
describe('ProgressStore', () => {
    it('uses separate daily and weekly period keys', () => {
        const date = new Date('2026-09-03T12:00:00+08:00');
        expect(periodKey('daily', date)).toBe('2026-09-03');
        expect(periodKey('weekly', date)).toBe('2026-W36');
        expect(periodKey('version', date, '1.2.0')).toBe('1.2.0');
    });
    it('creates a fresh progress file for a new day and preserves discovered subgoals', async () => {
        const root = await mkdtemp(join(tmpdir(), 'autohelper-progress-'));
        roots.push(root);
        const store = new ProgressStore({ rootDir: root });
        const firstDay = new Date('2026-09-03T12:00:00+08:00');
        const nextDay = new Date('2026-09-04T12:00:00+08:00');
        const first = await store.load('infinity-nikki', target, firstDay);
        await store.upsertSubgoal(first, {
            id: 'daily-task',
            text: '完成日常任务',
            flowId: 'execute-daily',
            doneState: 'daily-complete',
        });
        await store.save(first, 'infinity-nikki', target);
        const restored = await store.load('infinity-nikki', target, firstDay);
        expect(restored.subgoals['daily-task']?.status).toBe('pending');
        const fresh = await store.load('infinity-nikki', target, nextDay);
        expect(fresh.periodKey).toBe('2026-09-04');
        expect(fresh.subgoals).toEqual({});
        expect(await readFile(join(root, 'infinity-nikki', 'daily-routine', '2026-09-03.json'), 'utf8'))
            .toContain('daily-task');
    });
});
