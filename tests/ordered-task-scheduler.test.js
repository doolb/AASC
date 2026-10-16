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

test('在线orderOnly同时提交全部分句，乱序成功或失败仍按入队顺序交付', async () => {
    // 对应.src/framework/tts-provider-configuration.md：此层仅排序，上游准入负责限制实际请求。
    const scheduler = createOrderedTaskScheduler({ orderOnly: true });
    const gates = Array.from({ length: 7 }, deferred);
    const started = [], delivered = [];
    const results = gates.map((gate, index) => scheduler.enqueue(async () => {
        started.push(index); await gate.promise;
        if (index === 2) throw Error('第三句失败');
        return index;
    }).then(value => delivered.push(value), () => delivered.push('failed-2')));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(started.length, 7); assert.deepEqual(delivered, []);
    for (const index of [6, 5, 4, 3, 2, 1]) gates[index].resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(delivered, []);
    gates[0].resolve(); await Promise.all(results); await scheduler.waitForIdle();
    assert.deepEqual(delivered, [0, 1, 'failed-2', 3, 4, 5, 6]);
});

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
