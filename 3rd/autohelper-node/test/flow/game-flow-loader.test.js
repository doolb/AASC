import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GameFlowLoader } from '../../src/flow/game-flow-loader.js';
const roots = [];
afterEach(async () => {
    await Promise.all(roots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })));
});
describe('GameFlowLoader', () => {
    it('loads new flow and state directories, keeping match files scoped to a state', async () => {
        const root = await mkdtemp(join(tmpdir(), 'autohelper-game-'));
        roots.push(root);
        const featureRoot = join(root, 'infinity-nikki', 'enter-game');
        await mkdir(join(featureRoot, 'flow', 'open-task'), { recursive: true });
        await mkdir(join(featureRoot, 'state', 'task-panel', 'match'), { recursive: true });
        await writeFile(join(featureRoot, 'flow', 'open-task', 'open@0.9.png'), 'open');
        await writeFile(join(featureRoot, 'state', 'task-panel', 'title@0.9.png'), 'title');
        await writeFile(join(featureRoot, 'state', 'task-panel', 'notes.txt'), 'ignore');
        await writeFile(join(featureRoot, 'state', 'task-panel', 'match', 'daily@0.9,match@daily-task,goto@execute.png'), 'match');
        const loader = new GameFlowLoader({
            flowsRoot: root,
            gameId: 'infinity-nikki',
            loadTemplate: async (descriptor) => ({
                descriptor,
                buffer: Buffer.from(descriptor.name),
            }),
        });
        const context = await loader.loadFlow('enter-game', 'open-task');
        const states = await loader.listStates('enter-game');
        expect(context.id).toBe('open-task');
        expect(states).toHaveLength(1);
        expect(states[0]?.markers.map((item) => item.descriptor.name)).toEqual(['title@0.9']);
        expect(states[0]?.matchTemplates.map((item) => item.descriptor.matchId)).toEqual(['daily-task']);
    });
    it('loads provider flows and states from a top-level provider root', async () => {
        const root = await mkdtemp(join(tmpdir(), 'autohelper-provider-'));
        roots.push(root);
        const providerRoot = join(root, 'netease-cloud');
        await mkdir(join(providerRoot, 'flow', 'bootstrap'), { recursive: true });
        await mkdir(join(providerRoot, 'state', 'game-running'), { recursive: true });
        await writeFile(join(providerRoot, 'flow', 'bootstrap', 'launch@0.9.png'), 'launch');
        await writeFile(join(providerRoot, 'state', 'game-running', 'running@0.9.png'), 'running');
        const loader = new GameFlowLoader({
            flowsRoot: root,
            gameId: 'infinity-nikki',
            loadTemplate: async (descriptor) => ({
                descriptor,
                buffer: Buffer.from(descriptor.name),
            }),
        });
        const context = await loader.loadExternalFlow('netease-cloud', 'bootstrap');
        const states = await loader.listExternalStates('netease-cloud');
        expect(context.id).toBe('bootstrap');
        expect(states.map((state) => state.id)).toEqual(['game-running']);
    });
});
