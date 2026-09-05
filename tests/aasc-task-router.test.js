'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { AascTaskRouter } = require('../src/framework/aasc/task-router');
const TaskManager = require('../src/apps/server/modules/task-engine/task-manager');

function createRouter(displays) {
    return new AascTaskRouter({
        getDisplays: () => displays,
        getCurrentServer: () => ({ nodeId: 'main-server' })
    });
}

test('display-first 任务优先选择在线且能力匹配的显示端', () => {
    const router = createRouter([
        { id: 'offline', online: false, capabilities: { ocr: true } },
        { id: 'display-a', online: true, capabilities: { ocr: true, display: true } },
        { id: 'display-b', online: true, capabilities: { display: true } }
    ]);

    assert.deepEqual(router.resolve({ routing: 'display-first', requiredCapabilities: ['ocr'] }), {
        target: 'display',
        displayId: 'display-a',
        reason: 'capability-match'
    });
});

test('没有匹配显示端时 display-first 任务回退当前服务器', () => {
    const router = createRouter([{ id: 'display-a', online: true, capabilities: { display: true } }]);

    assert.deepEqual(router.resolve({ target: 'auto', requiredCapabilities: ['ocr'] }), {
        target: 'server',
        nodeId: 'main-server',
        reason: 'display-unavailable'
    });
});

test('显式显示端和服务器目标不被自动路由改写', () => {
    const router = createRouter([{ id: 'display-a', online: true, capabilities: { ocr: true } }]);

    assert.deepEqual(router.resolve({ target: 'display', displayId: 'display-a' }), {
        target: 'display',
        displayId: 'display-a',
        reason: 'explicit-display'
    });
    assert.deepEqual(router.resolve({ target: 'server', routing: 'server' }), {
        target: 'server',
        nodeId: 'main-server',
        reason: 'explicit-server'
    });
});

test('TaskManager 执行 auto 任务时应用显示端优先路由', async () => {
    const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-task-router-'));
    let forwarded = null;
    const manager = new TaskManager({
        tasksDir,
        resolveTaskRoute: () => ({ target: 'display', displayId: 'display-a', reason: 'capability-match' })
    });
    manager.setSendToDisplay((displayId, message) => {
        forwarded = { displayId, message };
        return true;
    });

    try {
        const submitted = await manager.submit({
            taskName: 'auto-task',
            target: 'auto',
            routing: 'display-first',
            requiredCapabilities: ['display'],
            files: [{ name: 'task.js', data: Buffer.from('module.exports = async () => ({ success: true });').toString('base64') }]
        });
        const result = await manager.runInstance('auto-task', submitted.instanceId);
        for (let attempt = 0; attempt < 20 && !forwarded; attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        assert.equal(result.status, 'pending_forward');
        assert.equal(forwarded.displayId, 'display-a');
        assert.equal(forwarded.message.type, 'task:execute');
        assert.equal(manager.instances.get(submitted.instanceId).routeReason, 'capability-match');
        clearTimeout(manager.instances.get(submitted.instanceId)._forwardTimeout);
    } finally {
        fs.rmSync(tasksDir, { recursive: true, force: true });
    }
});
