'use strict';
// 任务引擎：服务器重启后 display_offline 服务实例自动恢复（方案 A）
// 覆盖：restoreAutoStartServices 回填孤儿表 / 去重 / 缺 displayId 跳过 /
//      显示端重连 retryOrphanedTasks 接管恢复 / 幂等 / running 旧路径不回归
// 运行：node --test tests/task-engine-restore.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const TaskManager = require('../src/apps/server/modules/task-engine/task-manager.js');

function makeTask(base, taskName) {
  const taskDir = path.join(base, taskName);
  fs.mkdirSync(path.join(taskDir, 'results'), { recursive: true });
  fs.writeFileSync(path.join(taskDir, 'task.js'), 'module.exports = {};');
  return taskDir;
}

function writeIndex(taskDir, instances) {
  fs.writeFileSync(path.join(taskDir, 'results', 'index.json'), JSON.stringify({ instances }, null, 2));
}

// _forwardToDisplay 是 fire-and-forget（runInstance 未 await），readTaskFiles 异步完成后才真正转发/入队。
// 断言前轮询等待条件满足，避免固定延时。
async function waitFor(fn, timeout = 2000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = fn();
    if (last) return last;
    await new Promise(r => setTimeout(r, 10));
  }
  return last;
}

const offlineEntry = {
  instanceId: 'offline-inst', taskName: 'render-display', status: 'display_offline',
  timestamp: 1786975265817, target: 'display', env: 'auto', mode: 'service',
  displayId: 'disp-1', params: {}, taskType: 'user', builtinId: null,
  entryFile: 'task.js', stage: 'running', progress: 100, error: '显示端已断开连接'
};

test('restoreAutoStartServices 把 display_offline 服务实例按 displayId 回填孤儿表（不占内存）', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'task-engine-restore-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  makeTask(base, 'render-display');
  writeIndex(path.join(base, 'render-display'), [offlineEntry]);

  const tm = new TaskManager({ tasksDir: base });
  await tm.init();
  await tm.restoreAutoStartServices();

  const orphans = tm._orphanedTasks.get('disp-1');
  assert.ok(orphans, '应存在 disp-1 分组');
  assert.strictEqual(orphans.length, 1, '分组内只有 offline-inst');
  assert.strictEqual(orphans[0].instanceId, 'offline-inst');
  assert.strictEqual(orphans[0].displayId, 'disp-1');
  assert.strictEqual(orphans[0].entryFile, 'task.js');
  assert.strictEqual(tm.instances.has('offline-inst'), false, '显示端重连前不占内存');
  assert.strictEqual(tm._pendingDisplayServices.length, 0, 'display_offline 不应进 pending 转发队列');
  await tm.destroy();
});

test('display_offline 回填幂等：同一 instanceId 不重复入表', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'task-engine-restore-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  makeTask(base, 'render-display');
  writeIndex(path.join(base, 'render-display'), [offlineEntry]);

  const tm = new TaskManager({ tasksDir: base });
  await tm.init();
  await tm.restoreAutoStartServices();
  await tm.restoreAutoStartServices();   // 模拟重复启动 / 重复扫描
  tm._collectOfflineOrphan(offlineEntry); // 直接再触发一次收集

  const orphans = tm._orphanedTasks.get('disp-1');
  assert.strictEqual(orphans.length, 1, '重复收集不应产生重复孤儿');
  await tm.destroy();
});

test('缺 displayId 的 display_offline 实例被跳过，不产生孤儿', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'task-engine-restore-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  makeTask(base, 'render-display');
  const noDisplay = { ...offlineEntry, instanceId: 'no-display-inst', displayId: null };
  writeIndex(path.join(base, 'render-display'), [noDisplay]);

  const tm = new TaskManager({ tasksDir: base });
  await tm.init();
  await tm.restoreAutoStartServices();

  assert.strictEqual(tm._orphanedTasks.size, 0, '缺 displayId 无法按组恢复，应跳过');
  assert.strictEqual(tm.instances.has('no-display-inst'), false);
  await tm.destroy();
});

test('显示端重连后 retryOrphanedTasks 自动接管 display_offline 实例并转发', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'task-engine-restore-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  makeTask(base, 'render-display');
  writeIndex(path.join(base, 'render-display'), [offlineEntry]);

  const tm = new TaskManager({ tasksDir: base });
  await tm.init();
  const sent = [];
  tm.setSendToDisplay((displayId, msg) => { sent.push({ displayId, msg }); return true; });
  await tm.restoreAutoStartServices();

  // 模拟显示端重连（server-app.js:2762 调用）
  const restored = await tm.retryOrphanedTasks('disp-1');
  assert.deepStrictEqual(restored.map(r => r.instanceId), ['offline-inst'], '应恢复 offline-inst');
  assert.ok(!tm._orphanedTasks.has('disp-1'), '孤儿组应被消费删除');

  const inst = tm.instances.get('offline-inst');
  assert.ok(inst, '恢复后实例应进入内存');
  assert.strictEqual(inst.status, 'pending_forward', '转发到显示端后应为 pending_forward');
  assert.strictEqual(inst.targetInfo.displayId, 'disp-1');

  const exe = await waitFor(() => sent.find(s => s.displayId === 'disp-1' && s.msg.type === 'task:execute' && s.msg.payload.instanceId === 'offline-inst'));
  assert.ok(exe, '应发送 task:execute 到 disp-1');
  assert.strictEqual(exe.msg.payload.taskName, 'render-display');

  const idx = await tm.taskIO.getIndex('render-display');
  const entry = idx.find(e => e.instanceId === 'offline-inst');
  assert.strictEqual(entry.status, 'pending_forward', 'index.json 状态应更新为 pending_forward');

  // 幂等：孤儿组已消费，再次重连无动作
  const again = await tm.retryOrphanedTasks('disp-1');
  assert.deepStrictEqual(again, [], '孤儿组消费后再次调用应为空');

  const fin = tm.instances.get('offline-inst');
  if (fin && fin._forwardTimeout) clearTimeout(fin._forwardTimeout);
  await tm.destroy();
});

test('restore 对 running 显示端服务仍走旧路径（pending 队列），与 display_offline 互不冲突', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'task-engine-restore-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  makeTask(base, 'render-display');
  const running = {
    instanceId: 'running-inst', taskName: 'render-display', status: 'running',
    timestamp: 1786975265000, target: 'display', env: 'auto', mode: 'service',
    displayId: 'disp-1', params: {}, taskType: 'user', builtinId: null, entryFile: 'task.js'
  };
  writeIndex(path.join(base, 'render-display'), [running, offlineEntry]);

  const tm = new TaskManager({ tasksDir: base });
  await tm.init();
  const sent = [];
  // 显示端未连接：_sendToDisplay 返回 false → running 实例进 _pendingDisplayServices
  tm.setSendToDisplay((displayId, msg) => { sent.push({ displayId, msg }); return false; });
  await tm.restoreAutoStartServices();

  // running 实例走旧路径：进 pending 队列（_forwardToDisplay 异步，需等待入队）
  assert.ok(await waitFor(() => tm._pendingDisplayServices.some(p => p.instanceId === 'running-inst')), 'running 实例应进 pending 队列');
  // display_offline 实例走孤儿表
  assert.ok(tm._orphanedTasks.has('disp-1'), 'display_offline 应进孤儿表');
  assert.strictEqual(tm._orphanedTasks.get('disp-1').length, 1);
  // 两者不重复：pending 队列里没有 offline-inst，孤儿表里没有 running-inst
  assert.ok(!tm._pendingDisplayServices.some(p => p.instanceId === 'offline-inst'), 'offline 实例不应进 pending 队列');
  const orphanIds = tm._orphanedTasks.get('disp-1').map(o => o.instanceId);
  assert.ok(!orphanIds.includes('running-inst'), 'running 实例不应进孤儿表');

  const run = tm.instances.get('running-inst');
  if (run && run._forwardTimeout) clearTimeout(run._forwardTimeout);
  await tm.destroy();
});
