'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const TaskManager = require('../src/apps/server/modules/task-engine/task-manager');
const { collectOfflineTaskSeeds, applyOfflineTaskSeeds } = require('../src/apps/server/modules/task-engine/offline-task-seeds');
const { stageNodeMinSeeds } = require('../scripts/ops/node-min-seeds');
const project = path.resolve(__dirname, '..');
const originalCode = path.join(project, 'res/tasks/domestic-media');

function catalog(available = true) {
  return { context: { version: 5 }, isManaged: name => available && name === 'domestic-media', task: name => ({ taskName: name }),
    resolve: (name, file) => path.join(originalCode, file), assertWritable() {},
    tasks: new Map(available ? [['domestic-media', { taskName: 'domestic-media', files: [] }]] : []) };
}
function managerFor(tasksDir, taskCodeCatalog = catalog()) {
  const registered = new Set();
  const manager = new TaskManager({ tasksDir, taskCodeCatalog, serverExecutionDisabled: true,
    registerMediaProvider: (_owner, def) => { registered.add(def.id); return () => registered.delete(def.id); } });
  return { manager, registered };
}

test('显式种子迁移只创建一次，保留停止和删除状态', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-auto-task-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const seeds = await collectOfflineTaskSeeds(path.join(project, 'release/task'));
  assert.deepEqual(seeds.map(item => item.taskName), ['domestic-media']);
  const { manager, registered } = managerFor(root);
  t.after(() => manager.destroy());
  await manager.init();
  await applyOfflineTaskSeeds(manager, seeds);
  let entries = await manager.taskIO.getIndex('domestic-media');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, 'running');
  assert.deepEqual([...registered].sort(), ['douyin', 'hongguo', 'tomato']);
  await applyOfflineTaskSeeds(manager, seeds);
  assert.equal((await manager.taskIO.getIndex('domestic-media')).length, 1);
  await manager.stopInstance('domestic-media', entries[0].instanceId);
  await applyOfflineTaskSeeds(manager, seeds);
  assert.equal((await manager.taskIO.getIndex('domestic-media'))[0].status, 'stopped');
  await manager.taskIO.deleteInstance('domestic-media', entries[0].instanceId);
  await applyOfflineTaskSeeds(manager, seeds);
  assert.equal((await manager.taskIO.getIndex('domestic-media')).length, 0);
});

test('旧设备已有停止实例时保留参数；代码未就绪时稍后重试', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-auto-existing-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const seeds = await collectOfflineTaskSeeds(path.join(project, 'release/task'));
  const existing = managerFor(path.join(root, 'existing'));
  t.after(() => existing.manager.destroy());
  await existing.manager.init();
  await existing.manager.taskIO.updateIndex('domestic-media', { taskName: 'domestic-media', instanceId: 'old', mode: 'service', status: 'stopped', params: { custom: true } });
  await applyOfflineTaskSeeds(existing.manager, seeds);
  assert.deepEqual((await existing.manager.taskIO.getIndex('domestic-media'))[0].params, { custom: true });
  assert.equal(existing.registered.size, 0);
  const waiting = managerFor(path.join(root, 'waiting'), catalog(false));
  t.after(() => waiting.manager.destroy());
  await waiting.manager.init();
  await applyOfflineTaskSeeds(waiting.manager, seeds);
  assert.equal((await waiting.manager.taskIO.getIndex('domestic-media')).length, 0);
  waiting.manager.taskIO.taskCodeCatalog = catalog();
  await applyOfflineTaskSeeds(waiting.manager, seeds);
  assert.equal((await waiting.manager.taskIO.getIndex('domestic-media'))[0].status, 'running');
});

test('首次安装任务种子包含真实任务及服务实例，按原恢复流程启动', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-auto-first-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const release = path.join(root, 'release');
  await fs.mkdir(path.join(release, 'config'), { recursive: true });
  await fs.mkdir(path.join(release, 'userconfig'));
  await fs.writeFile(path.join(release, 'config/config.json'), '{}');
  await fs.cp(path.join(project, 'release/task/domestic-media'), path.join(release, 'task/domestic-media'), { recursive: true });
  const stage = path.join(root, 'stage');
  await stageNodeMinSeeds(release, stage);
  const seed = JSON.parse(await fs.readFile(path.join(stage, 'task/domestic-media/results/index.json'), 'utf8'));
  assert.equal(seed.autoStartOnUpdate, true);
  assert.equal(seed.instances[0].status, 'running');
  for (const file of ['task.js', 'providers/proxy.js', 'providers/http.js', 'providers/hongguo.js', 'providers/tomato.js', 'providers/douyin.js', 'providers/ytdlp.js']) {
    assert.deepEqual(await fs.readFile(path.join(stage, 'task/domestic-media', file)), await fs.readFile(path.join(originalCode, file)), `种子代码必须与任务代码一致: ${file}`);
  }
  const { manager, registered } = managerFor(path.join(stage, 'task'));
  t.after(() => manager.destroy());
  await manager.init();
  await manager.restoreAutoStartServices();
  assert.deepEqual([...registered].sort(), ['douyin', 'hongguo', 'tomato']);
  await applyOfflineTaskSeeds(manager, await collectOfflineTaskSeeds(path.join(project, 'release/task')));
  assert.equal((await manager.taskIO.getIndex('domestic-media')).length, 1);
});


test('升级中断后只恢复本机制预留的草稿', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-auto-resume-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const seeds = await collectOfflineTaskSeeds(path.join(project, 'release/task'));
  const { manager, registered } = managerFor(root);
  t.after(() => manager.destroy());
  await manager.init();
  await manager.submit({ ...seeds[0], instanceId: 'pending01', files: [] });
  await fs.writeFile(path.join(root, '.offline-seed-autostart.json'), JSON.stringify({ 'domestic-media': { instanceId: 'pending01' } }));
  await applyOfflineTaskSeeds(manager, seeds);
  assert.deepEqual([...registered].sort(), ['douyin', 'hongguo', 'tomato']);
  const entries = await manager.taskIO.getIndex('domestic-media');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, 'running');
});

test('通用机制按种子处理其他任务，单个启动异常不阻碍后续任务', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-auto-generic-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const files = new Map();
  const started = [];
  for (const name of ['other-a', 'other-b']) { const file = path.join(root, `${name}.js`); await fs.writeFile(file, ''); files.set(name, file); }
  const indexes = new Map();
  const fake = {
    taskIO: { tasksDir: root, taskCodeCatalog: { isManaged: name => files.has(name), task: () => ({}) },
      getIndex: async name => indexes.get(name) || [], resolveCodePath: name => files.get(name) },
    submit: async item => { if (item.taskName === 'other-a') throw new Error('模拟失败'); indexes.set(item.taskName, [{ instanceId: item.instanceId, status: 'draft' }]); return item; },
    runInstance: async name => { started.push(name); }
  };
  const seeds = ['other-a', 'other-b'].map(taskName => ({ taskName, taskType: 'user', entryFile: 'task.js', target: 'server', mode: 'service', env: 'auto', params: {} }));
  await applyOfflineTaskSeeds(fake, seeds);
  assert.deepEqual(started, ['other-b']);
  const marker = JSON.parse(await fs.readFile(path.join(root, '.offline-seed-autostart.json'), 'utf8'));
  assert.equal(marker['other-b'], true);
  assert.ok(marker['other-a'].instanceId);
});
