import { describe, expect, it } from 'vitest';
import { AdbNavigatorExecutor } from '../../src/navigation/navigator-executor.js';
describe('AdbNavigatorExecutor', () => {
    it('executes UI taps and spatial movement separately', async () => {
        const calls = [];
        const executor = new AdbNavigatorExecutor({
            adb: {
                tap: async (x, y) => { calls.push('tap:' + x + ',' + y); },
                swipe: async (x1, y1, x2, y2, durationMs) => {
                    calls.push('swipe:' + x1 + ',' + y1 + ',' + x2 + ',' + y2 + ',' + durationMs);
                },
            },
            movement: { origin: { x: 100, y: 200 }, radius: 50 },
            jumpPoint: { x: 500, y: 600 },
        });
        await expect(executor.execute({
            mode: 'ui',
            action: 'tap',
            point: { x: 10, y: 20 },
            confidence: 0.9,
        })).resolves.toMatchObject({ executed: true, reason: 'executed' });
        await executor.execute({
            mode: 'spatial-3d',
            action: 'move',
            vector: { x: 1, y: 0 },
            durationMs: 400,
            confidence: 0.9,
            reason: 'clear-road',
        });
        await executor.execute({
            mode: 'spatial-3d',
            action: 'jump',
            confidence: 0.9,
            reason: 'close-jumpable-obstacle',
        });
        expect(calls).toEqual(['tap:10,20', 'swipe:100,200,150,200,400', 'tap:500,600']);
    });
    it('does not send ADB commands in dry-run mode', async () => {
        let callCount = 0;
        const executor = new AdbNavigatorExecutor({
            adb: {
                tap: async () => { callCount += 1; },
            },
            dryRun: true,
        });
        await expect(executor.execute({
            mode: 'ui',
            action: 'tap',
            point: { x: 10, y: 20 },
            confidence: 0.9,
        })).resolves.toMatchObject({ executed: false, reason: 'dry-run' });
        expect(callCount).toBe(0);
    });
});
