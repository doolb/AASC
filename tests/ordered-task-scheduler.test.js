'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createOrderedTaskScheduler } = require('../src/apps/server/modules/media/ordered-task-scheduler');

function deferred() {
    let resolve;
    const promise = new Promise((innerResolve) => {
        resolve = innerResolve;
    });
    return { promise, resolve };
}

test('有两个 TTS 槽位时生成可以并发但结果按入队顺序释放', async () => {
    const scheduler = createOrderedTaskScheduler({ concurrency: 2 });
    const first = deferred();
    const started = [];
    const released = [];

    const firstResult = scheduler.enqueue(async () => {
        started.push('first');
        await first.promise;
        return 'first-audio';
    }).then((value) => released.push(value));
    const secondResult = scheduler.enqueue(async () => {
        started.push('second');
        return 'second-audio';
    }).then((value) => released.push(value));

    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(started, ['first', 'second']);
    assert.deepEqual(released, []);

    first.resolve();
    await Promise.all([firstResult, secondResult, scheduler.waitForIdle()]);
    assert.deepEqual(released, ['first-audio', 'second-audio']);
});

test('没有双路槽位时保持串行生成', async () => {
    const scheduler = createOrderedTaskScheduler({ concurrency: 1 });
    const first = deferred();
    const started = [];

    const firstResult = scheduler.enqueue(async () => {
        started.push('first');
        await first.promise;
        return 'first-audio';
    });
    const secondResult = scheduler.enqueue(async () => {
        started.push('second');
        return 'second-audio';
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(started, ['first']);
    first.resolve();
    assert.deepEqual(await Promise.all([firstResult, secondResult]), ['first-audio', 'second-audio']);
    assert.deepEqual(started, ['first', 'second']);
});

test('前一个任务失败时后续任务仍能按顺序完成', async () => {
    const scheduler = createOrderedTaskScheduler({ concurrency: 2 });
    const firstResult = scheduler.enqueue(async () => {
        throw new Error('first failed');
    });
    const secondResult = scheduler.enqueue(async () => 'second-audio');

    await assert.rejects(firstResult, /first failed/u);
    assert.equal(await secondResult, 'second-audio');
    await scheduler.waitForIdle();
});
