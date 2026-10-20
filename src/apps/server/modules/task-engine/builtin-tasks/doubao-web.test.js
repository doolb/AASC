'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const registry = require('./registry');
const task = require('./doubao-web');
const { getDoubaoWebTaskStatus, doubaoWebTaskBridge } = require('../../chat2api/chat2api-doubao-web-task-registry');

test('doubao.web 注册为常驻任务，启动和停止控制 Chat2API 网页桥', async () => {
  assert.equal(registry.getTask('doubao.web'), task);
  assert.equal(task.mode, 'service');
  let calls = 0;
  let stopped = 0;
  let runtimeStopped = 0;
  const bridge = { request: async () => { calls += 1; return { status: 200 }; },
    stop: async () => { stopped += 1; } };
  const updates = [];
  const running = await task.run({ params: { accountId: 'acc-test' },
    doubaoBrowserBridge: bridge, postWidgetUpdate: state => updates.push(state),
    chat2apiRuntimeFactory: () => ({ start: async () => {}, stop: async () => { runtimeStopped += 1; } }) });
  assert.equal(getDoubaoWebTaskStatus().running, true);
  assert.equal((await doubaoWebTaskBridge.request({})).status, 200);
  assert.equal(calls, 1);
  assert.equal(updates[0].accountText, 'acc-test');
  await running.stop();
  assert.equal(stopped, 1);
  assert.equal(runtimeStopped, 1);
  assert.equal(getDoubaoWebTaskStatus().running, false);
  await assert.rejects(doubaoWebTaskBridge.request({}), { code: 'doubao_browser_disabled' });
});
