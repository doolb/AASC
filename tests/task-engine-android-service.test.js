'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const TaskManager = require('../src/apps/server/modules/task-engine/task-manager.js');
const { stageNodeMinSeeds } = require('../scripts/ops/node-min-seeds');

async function waitFor(predicate, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const value = predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return predicate();
}

function createManager(tasksDir) {
    return new TaskManager({
        tasksDir,
        serverExecutionDisabled: true,
        serverExecutionError: 'Android APK 节点不支持需要创建子进程的服务端任务',
        llmGatewayService: {
            getStatus: () => ({ status: 'running', modelCount: 1, displayCount: 0 })
        },
        llmHttpHandlers: {
            models: async () => {},
            request: async () => {}
        }
    });
}

test('Android 节点允许 llm-server 在当前进程注册和注销服务路由', async (t) => {
    const tasksDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aasc-android-task-'));
    t.after(() => fs.promises.rm(tasksDir, { recursive: true, force: true }));
    const manager = createManager(tasksDir);
    t.after(() => manager.destroy());
    await manager.init();

    const result = await manager.ensureBuiltinServiceInstance('llm-server', {
        target: 'server',
        mode: 'service'
    });
    assert.equal(result.taskName, 'llm-server');
    assert.equal(result.status, 'running');
    assert.ok(await waitFor(() => manager._services.has(result.instanceId)), '服务应完成启动');
    assert.deepEqual(
        manager._taskRouteRegistry.getRoutes().map((route) => `${route.method} ${route.path}`).sort(),
        [
            'GET /v1/models',
            'POST /v1/chat/completions',
            'POST /v1/responses',
            'POST /v1/chat/responses'
        ].sort()
    );

    const second = await manager.ensureBuiltinServiceInstance('llm-server', {
        target: 'server',
        mode: 'service'
    });
    assert.equal(second.instanceId, result.instanceId, '重复确保不得创建第二个 running 实例');
    assert.equal((await manager.taskIO.getIndex('llm-server')).length, 1);

    await manager.stopInstance('llm-server', result.instanceId);
    assert.equal(manager._taskRouteRegistry.getRoutes().length, 0);
});

test('release豆包网页种子通过现有恢复流程启动唯一实例，不创建浏览器或消息', async t => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aasc-doubao-seed-'));
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
    const release = path.join(root, 'release');
    const directory = path.join(release, 'task/doubao.web/results');
    await fs.promises.mkdir(directory, { recursive: true });
    await fs.promises.mkdir(path.join(release, 'config'));
    await fs.promises.mkdir(path.join(release, 'userconfig'));
    await fs.promises.writeFile(path.join(release, 'config/config.json'), '{}');
    await fs.promises.copyFile(path.resolve(__dirname, '../release/task/doubao.web/results/index.json'),
        path.join(directory, 'index.json'));
    const stage = await stageNodeMinSeeds(release, path.join(root, 'stage'));
    const tasksDir = path.join(stage, 'task');
    let starts = 0;
    let stops = 0;
    const manager = new TaskManager({ tasksDir, serverExecutionDisabled: true,
        chat2apiRuntimeFactory: () => ({ start: async () => { starts++; }, stop: async () => { stops++; } }) });
    t.after(() => manager.destroy());
    await manager.init();
    await manager.restoreAutoStartServices();
    await waitFor(() => starts === 1);
    const result = await manager.ensureBuiltinServiceInstance('doubao.web');
    assert.equal(result.status, 'running');
    assert.equal(result.instanceId, 'd0baba01');
    assert.equal(starts, 1);
    const entries = await manager.taskIO.getIndex('doubao.web');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].params.accountId, '');
    await manager.stopInstance('doubao.web', result.instanceId);
    assert.equal(stops, 1);
});

test('Android 节点仍拒绝需要服务端子进程的普通任务', async (t) => {
    const tasksDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aasc-android-task-'));
    t.after(() => fs.promises.rm(tasksDir, { recursive: true, force: true }));
    const manager = createManager(tasksDir);
    t.after(() => manager.destroy());
    await manager.init();

    const submitted = await manager.submit({
        taskName: 'needs-runner',
        taskType: 'user',
        target: 'server',
        mode: 'one-shot',
        entryFile: 'task.js',
        files: []
    });
    const result = await manager.runInstance('needs-runner', submitted.instanceId);
    assert.equal(result.status, 'failed');
    assert.match(result.error, /不支持需要创建子进程/u);
});
