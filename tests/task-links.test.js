'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const TaskManager = require('../src/apps/server/modules/task-engine/task-manager.js');

function makeTask(base, taskName, instances) {
  const taskDir = path.join(base, taskName);
  fs.mkdirSync(path.join(taskDir, 'results'), { recursive: true });
  fs.writeFileSync(path.join(taskDir, 'task.js'), 'module.exports = {};');
  fs.writeFileSync(
    path.join(taskDir, 'results', 'index.json'),
    JSON.stringify({ instances }, null, 2)
  );
}

test('任务链接查询返回有效目标并过滤失效记录', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'task-links-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  makeTask(base, 'win-monitor', [{
    taskName: 'win-monitor', instanceId: 'source-1', status: 'running', target: 'server'
  }]);
  makeTask(base, 'render-display', [{
    taskName: 'render-display', instanceId: 'target-1', status: 'running',
    target: 'display', displayId: 'display-a'
  }]);

  const manager = new TaskManager({ tasksDir: base });
  await manager.init();
  t.after(() => manager.destroy());
  manager.taskLinks.set('source-1', [
    { taskName: 'render-display', instanceId: 'target-1' },
    { taskName: 'render-display', instanceId: 'target-1' },
    { taskName: 'render-display', instanceId: 'missing-target' }
  ]);

  const links = await manager.getTaskLinks();

  assert.deepStrictEqual(links, [{
    sourceTaskName: 'win-monitor',
    sourceInstanceId: 'source-1',
    targetTaskName: 'render-display',
    targetInstanceId: 'target-1',
    targetDisplayId: 'display-a',
    targetStatus: 'running'
  }]);
});

test('重复绑定同一来源和目标不会产生重复链接', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'task-links-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  makeTask(base, 'win-monitor', [{ taskName: 'win-monitor', instanceId: 'source-1' }]);
  makeTask(base, 'render-display', [{ taskName: 'render-display', instanceId: 'target-1' }]);

  const manager = new TaskManager({ tasksDir: base });
  await manager.init();
  t.after(() => manager.destroy());

  await manager.linkTasks('source-1', 'render-display', 'target-1');
  await manager.linkTasks('source-1', 'render-display', 'target-1');

  assert.strictEqual(manager.taskLinks.get('source-1').length, 1);
});

test('多个来源任务可以链接同一个 render-display 目标', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'task-links-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  makeTask(base, 'win-monitor', [
    { taskName: 'win-monitor', instanceId: 'source-1', status: 'running' },
    { taskName: 'win-monitor', instanceId: 'source-2', status: 'running' }
  ]);
  makeTask(base, 'render-display', [{
    taskName: 'render-display', instanceId: 'target-1', status: 'running',
    target: 'display', displayId: 'display-a'
  }]);

  const manager = new TaskManager({ tasksDir: base });
  await manager.init();
  t.after(() => manager.destroy());
  await manager.linkTasks('source-1', 'render-display', 'target-1');
  await manager.linkTasks('source-2', 'render-display', 'target-1');

  const links = await manager.getTaskLinks();
  assert.strictEqual(links.length, 2);
  assert.deepStrictEqual(links.map(link => link.sourceInstanceId), ['source-1', 'source-2']);

  await manager.unlinkTasks('source-1', 'target-1');
  const remaining = await manager.getTaskLinks();
  assert.deepStrictEqual(remaining.map(link => link.sourceInstanceId), ['source-2']);
});

test('不同显示端的 render-display 服务实例不会互相停止', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'task-links-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  makeTask(base, 'render-display', [
    { taskName: 'render-display', instanceId: 'target-a', status: 'running',
      target: 'display', mode: 'service', displayId: 'display-a' },
    { taskName: 'render-display', instanceId: 'target-b', status: 'draft',
      target: 'display', mode: 'service', displayId: 'display-b' }
  ]);

  const manager = new TaskManager({ tasksDir: base });
  await manager.init();
  t.after(() => manager.destroy());
  manager.setSendToDisplay(() => true);
  manager._isRestoring = true;
  const stopCalls = [];
  manager.instances.set('target-a', {
    taskName: 'render-display', target: 'display', status: 'running',
    targetInfo: { displayId: 'display-a' }
  });
  manager._services.set('target-a', {
    status: 'running',
    stop: async () => { stopCalls.push('target-a'); }
  });

  const result = await manager.runInstance('render-display', 'target-b');

  assert.strictEqual(result.status, 'pending_forward');
  assert.deepStrictEqual(stopCalls, [], '不同 displayId 不应停止旧显示端服务');
  assert.ok(manager._services.has('target-a'), '旧显示端服务应继续保留');
  const current = manager.instances.get('target-b');
  if (current && current._forwardTimeout) clearTimeout(current._forwardTimeout);
  manager._isRestoring = false;
});

test('解除多来源链接时只隐藏显示端对应的来源子条目', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'task-links-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  makeTask(base, 'win-monitor', [
    { taskName: 'win-monitor', instanceId: 'source-1', status: 'running' },
    { taskName: 'win-monitor', instanceId: 'source-2', status: 'running' }
  ]);
  makeTask(base, 'render-display', [{
    taskName: 'render-display', instanceId: 'target-1', status: 'running',
    target: 'display', mode: 'service', displayId: 'display-a'
  }]);

  const manager = new TaskManager({ tasksDir: base });
  await manager.init();
  t.after(() => manager.destroy());
  await manager.linkTasks('source-1', 'render-display', 'target-1');
  await manager.linkTasks('source-2', 'render-display', 'target-1');
  const sent = [];
  manager.setSendToDisplay((displayId, message) => { sent.push({ displayId, message }); return true; });

  await manager.unlinkTasks('source-1', 'target-1');

  assert.deepStrictEqual(sent, [{
    displayId: 'display-a',
    message: {
      type: 'task:renderUpdate',
      instanceId: 'target-1',
      sourceInstanceId: 'source-1',
      data: { _stop: true, _sourceInstanceId: 'source-1' }
    }
  }]);
  assert.deepStrictEqual((await manager.getTaskLinks()).map(link => link.sourceInstanceId), ['source-2']);
});
