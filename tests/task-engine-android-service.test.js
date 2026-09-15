'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const TaskManager = require('../src/apps/server/modules/task-engine/task-manager.js');

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
