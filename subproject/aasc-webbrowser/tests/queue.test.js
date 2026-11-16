'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TaskStore } = require('../src/task-store');
const { WindowQueue } = require('../src/window-queue');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('runs tasks FIFO across sub-businesses and stores results', async () => {
  const store = new TaskStore();
  const queue = new WindowQueue({ store });
  const order = [];
  const first = queue.enqueue(async () => { order.push('first-start'); await new Promise(r => setTimeout(r, 10)); order.push('first-end'); return { ok: true }; }, { subBusinessId: 'one' });
  const second = queue.enqueue(async () => { order.push('second'); return 2; }, { subBusinessId: 'two' });

  assert.equal(store.get(first.taskId).status, 'running');
  assert.equal(store.get(second.taskId).status, 'queued');
  await Promise.all([first.done, second.done]);
  assert.deepEqual(order, ['first-start', 'first-end', 'second']);
  assert.equal(store.get(first.taskId).status, 'succeeded');
  assert.deepEqual(store.get(first.taskId).result, { ok: true });
});

test('different queues execute concurrently', async () => {
  const store = new TaskStore();
  const one = new WindowQueue({ store });
  const two = new WindowQueue({ store });
  const first = deferred();
  const second = deferred();
  const taskOne = one.enqueue(() => first.promise);
  const taskTwo = two.enqueue(() => second.promise);

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.get(taskOne.taskId).status, 'running');
  assert.equal(store.get(taskTwo.taskId).status, 'running');
  first.resolve('one');
  second.resolve('two');
  await Promise.all([taskOne.done, taskTwo.done]);
});

test('continues after a rejected task and records a bounded error', async () => {
  const store = new TaskStore({ maxValueBytes: 100 });
  const queue = new WindowQueue({ store });
  const failed = queue.enqueue(async () => { throw new Error('bad '.repeat(100)); });
  const succeeded = queue.enqueue(async () => 'ok');

  await assert.rejects(failed.done, /bad/);
  assert.equal(await succeeded.done, 'ok');
  assert.equal(store.get(failed.taskId).status, 'failed');
  assert.ok(store.get(failed.taskId).error.message.length < 100);
});

test('cancels queued tasks during shutdown', async () => {
  const store = new TaskStore();
  const queue = new WindowQueue({ store });
  const running = deferred();
  const first = queue.enqueue(() => running.promise);
  const second = queue.enqueue(() => 'never');
  queue.shutdown();

  assert.equal(store.get(second.taskId).status, 'cancelled');
  running.resolve('done');
  assert.equal(await first.done, 'done');
  await assert.rejects(second.done, /cancelled/i);
});

test('returns null for an unknown task', () => {
  assert.equal(new TaskStore().get('missing'), null);
});
