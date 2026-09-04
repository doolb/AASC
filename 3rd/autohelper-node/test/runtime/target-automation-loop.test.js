import { PNG } from 'pngjs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProgressStore } from '../../src/runtime/progress-store.js';
import { TargetAutomationLoop } from '../../src/runtime/target-automation-loop.js';
const roots = [];
afterEach(async () => {
    await Promise.all(roots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })));
});
const screenshot = () => {
    const image = new PNG({ width: 100, height: 100 });
    image.data.fill(0);
    for (let offset = 3; offset < image.data.length; offset += 4) {
        image.data[offset] = 255;
    }
    return PNG.sync.write(image);
};
const descriptor = (name, flowId, options = {}) => ({
    name,
    flowId,
    filePath: `/tmp/${flowId}/${name}.png`,
    queue: 0,
    threshold: 0.9,
    clickPoint: { x: 0.5, y: 0.5 },
    centerClick: false,
    delayMs: 0,
    loop: true,
    wait: false,
    defaultCandidate: false,
    ...options,
});
const template = (image) => ({
    descriptor: image,
    buffer: Buffer.from(image.name),
});
const context = (flowId, imageName) => {
    const image = descriptor(imageName, flowId);
    return {
        id: flowId,
        directory: `/tmp/${flowId}`,
        descriptors: [image],
        templates: [template(image)],
    };
};
const markerState = (id, markerName, matchTemplates = []) => {
    const marker = descriptor(markerName, id);
    return {
        id,
        directory: `/tmp/${id}`,
        markers: [template(marker)],
        matchTemplates,
    };
};
const matched = () => ({
    score: 0.99,
    rect: { x: 0, y: 0, width: 100, height: 100 },
    matched: true,
    method: 'template',
});
class FakeAdb {
    panelVisible = false;
    taskCompleted = false;
    taps = [];
    startedActivities = [];
    async assertConnected() { }
    async screenshot() {
        return screenshot();
    }
    async tap(_x, _y) {
        if (!this.panelVisible) {
            this.panelVisible = true;
            this.taps.push('open-task');
            return;
        }
        this.taskCompleted = true;
        this.taps.push('execute-daily');
    }
    async startActivity(packageName, activityName, displayId = 0) {
        this.startedActivities.push(`${packageName}/${activityName}@${displayId}`);
    }
}
class FakeRepository {
    contexts;
    states;
    active;
    constructor(contexts, states, initialFlow) {
        this.contexts = contexts;
        this.states = states;
        this.active = contexts[initialFlow];
    }
    async loadFlow(_featureId, flowId) {
        this.active = this.contexts[flowId];
        return this.active;
    }
    async switchTo(flowId) {
        return this.loadFlow('enter-game', flowId);
    }
    current() {
        return this.active;
    }
    async listStates(_featureId) {
        return this.states;
    }
}
class BootstrapRepository {
    contexts;
    statesByFeature;
    active;
    loaded = [];
    constructor(contexts, statesByFeature, initialFlow) {
        this.contexts = contexts;
        this.statesByFeature = statesByFeature;
        this.active = contexts[initialFlow];
    }
    async loadFlow(featureId, flowId) {
        this.active = this.contexts[`${featureId}/${flowId}`];
        this.loaded.push(`${featureId}/${flowId}`);
        return this.active;
    }
    async switchTo(flowId) {
        const feature = this.loaded.at(-1)?.split('/')[0] ?? 'daily';
        return this.loadFlow(feature, flowId);
    }
    current() {
        return this.active;
    }
    async listStates(featureId) {
        return this.statesByFeature[featureId] ?? [];
    }
}
describe('TargetAutomationLoop', () => {
    it('confirms a state before discovering a match and persists dynamic subgoal progress', async () => {
        const root = await mkdtemp(join(tmpdir(), 'autohelper-target-'));
        roots.push(root);
        const adb = new FakeAdb();
        const route = template(descriptor('daily-row', 'task-panel', {
            matchId: 'daily-task',
            gotoFlow: 'execute-daily',
            doneState: 'daily-task-complete',
        }));
        const states = [
            markerState('task-panel', 'panel-marker', [route]),
            markerState('daily-task-complete', 'done-marker'),
        ];
        const repository = new FakeRepository({
            'open-task': context('open-task', 'open-button'),
            'execute-daily': context('execute-daily', 'execute-button'),
        }, states, 'open-task');
        const target = {
            id: 'daily-routine',
            type: 'daily',
            enabled: true,
            feature: 'enter-game',
            entryFlow: 'open-task',
            doneState: 'daily-task-complete',
            completion: 'all-discovered-subgoals',
            filePath: '/tmp/daily-routine.txt',
        };
        const progressStore = new ProgressStore({ rootDir: root });
        const matcher = {
            matchAll: async (_frame, templates) => (templates.map((item) => {
                const name = item.descriptor.name;
                if (name === 'open-button')
                    return adb.panelVisible ? { ...matched(), matched: false, rect: null } : matched();
                if (name === 'panel-marker') {
                    return adb.panelVisible && !adb.taskCompleted ? matched() : { ...matched(), matched: false, rect: null };
                }
                if (name === 'daily-row')
                    return adb.panelVisible && !adb.taskCompleted ? matched() : { ...matched(), matched: false, rect: null };
                if (name === 'execute-button')
                    return adb.panelVisible && !adb.taskCompleted ? matched() : { ...matched(), matched: false, rect: null };
                if (name === 'done-marker')
                    return adb.taskCompleted ? matched() : { ...matched(), matched: false, rect: null };
                return { ...matched(), matched: false, rect: null };
            })),
        };
        const loop = new TargetAutomationLoop({
            adb,
            gameId: 'infinity-nikki',
            repository,
            target,
            progressStore,
            matcher,
            options: { intervalMs: 0, once: true },
            sleep: async () => { },
        });
        expect((await loop.tick()).reason).toBe('clicked');
        expect((await loop.tick()).reason).toBe('flow-switched');
        expect((await loop.tick()).actionName).toBe('execute-button');
        expect((await loop.tick()).reason).toBe('target-reached');
        expect(adb.taps).toEqual(['open-task', 'execute-daily']);
        const progressPath = join(root, 'infinity-nikki', 'daily-routine');
        const files = await readdir(progressPath);
        const saved = JSON.parse(await readFile(join(progressPath, files[0]), 'utf8'));
        expect(saved.status).toBe('completed');
        expect(saved.subgoals['daily-task']?.status).toBe('completed');
    });
    it('hands off from a NetEase Cloud bootstrap state to the daily feature', async () => {
        const root = await mkdtemp(join(tmpdir(), 'autohelper-bootstrap-'));
        roots.push(root);
        const adb = new FakeAdb();
        const repository = new BootstrapRepository({
            'netease-cloud/bootstrap': context('bootstrap', 'launch-button'),
            'daily/open-calendar': context('open-calendar', 'calendar-button'),
        }, {
            'netease-cloud': [
                markerState('cloud-home', 'cloud-home-marker'),
                markerState('game-running', 'game-running-marker'),
            ],
            daily: [markerState('daily-home', 'daily-home-marker')],
        }, 'netease-cloud/bootstrap');
        const target = {
            id: 'daily-inspiration',
            type: 'daily',
            enabled: true,
            feature: 'daily',
            entryFlow: 'open-calendar',
            bootstrapFeature: 'netease-cloud',
            bootstrapFlow: 'bootstrap',
            bootstrapDoneState: 'game-running',
            bootstrapPackage: 'com.netease.android.cloudgame',
            bootstrapActivity: '.activity.SplashActivity',
            bootstrapDisplay: 0,
            completion: 'state',
            doneState: 'daily-inspiration',
            filePath: '/tmp/daily-inspiration.txt',
        };
        const matcher = {
            matchAll: async (_frame, templates) => (templates.map((item) => {
                const name = item.descriptor.name;
                if (name === 'launch-button')
                    return adb.panelVisible ? { ...matched(), matched: false, rect: null } : matched();
                if (name === 'cloud-home-marker')
                    return adb.panelVisible ? { ...matched(), matched: false, rect: null } : matched();
                if (name === 'game-running-marker')
                    return adb.panelVisible ? matched() : { ...matched(), matched: false, rect: null };
                if (name === 'daily-home-marker')
                    return adb.panelVisible ? matched() : { ...matched(), matched: false, rect: null };
                if (name === 'calendar-button')
                    return adb.panelVisible ? matched() : { ...matched(), matched: false, rect: null };
                return { ...matched(), matched: false, rect: null };
            })),
        };
        const loop = new TargetAutomationLoop({
            adb,
            gameId: 'infinity-nikki',
            repository,
            target,
            progressStore: new ProgressStore({ rootDir: root }),
            matcher,
            options: { intervalMs: 0, once: true },
            sleep: async () => { },
        });
        expect((await loop.tick()).actionName).toBe('launch-button');
        expect((await loop.tick()).reason).toBe('flow-switched');
        expect((await loop.tick()).actionName).toBe('calendar-button');
        expect(repository.loaded).toEqual(['netease-cloud/bootstrap', 'daily/open-calendar']);
        expect(adb.startedActivities).toEqual(['com.netease.android.cloudgame/.activity.SplashActivity@0']);
    });
});
