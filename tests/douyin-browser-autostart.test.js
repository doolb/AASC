'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const TaskManager = require('../src/apps/server/modules/task-engine/task-manager');
const { activateBrowserMedia } = require('../src/apps/server/modules/media/browser-media-registry');

test('媒体任务按需启动并复用浏览器媒体实例', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-media-ensure-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manager = new TaskManager({ tasksDir: root });
  await manager.init();
  t.after(() => manager.destroy());
  const name = 'ensure-test';
  const source = "module.exports.run = async c => { globalThis.__aascEnsureTest = c.browserMedia; return { stop: async () => {} }; };";
  const submitted = await manager.submit({ taskName: name, taskType: 'user', target: 'server', mode: 'service', entryFile: 'task.js', files: [{ name: 'task.js', data: Buffer.from(source).toString('base64') }] });
  await manager.runInstance(name, submitted.instanceId);
  for (let i = 0; i < 200 && !globalThis.__aascEnsureTest; i++) await new Promise(resolve => setTimeout(resolve, 10));
  const media = globalThis.__aascEnsureTest;
  assert.ok(media);
  t.after(() => { delete globalThis.__aascEnsureTest; });
  let calls = 0, deactivate;
  t.after(() => deactivate?.());
  manager.ensureBuiltinServiceInstance = async name => {
    calls++;
    assert.equal(name, 'browser.media');
    deactivate = activateBrowserMedia({ status: () => ({ running: true, sessions: [] }) });
    return { status: 'running' };
  };
  await media.ensure(); await media.ensure();
  assert.equal(calls, 1);
});
