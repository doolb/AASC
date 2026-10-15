'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getEventListeners } = require('node:events');
const { createDoubaoSpeechQueue } = require('./chat2api-doubao-speech-queue');
const context = signal => ({ signal, deadline: Date.now() + 10000 });

test('同账号FIFO、不同账号独立执行，重复释放不跳过等待者', async () => {
    const queue = createDoubaoSpeechQueue();
    const first = queue.acquire('one', context());
    let entered = 0;
    const second = queue.acquire('one', context()).then(release => { entered++; return release; });
    const third = queue.acquire('one', context()).then(release => { entered++; return release; });
    const other = queue.acquire('two', context());
    assert.equal(typeof other, 'function');
    await Promise.resolve();
    assert.equal(entered, 0);
    first();
    const releaseSecond = await second;
    first();
    await Promise.resolve();
    assert.equal(entered, 1);
    releaseSecond();
    const releaseThird = await third;
    assert.equal(entered, 2);
    releaseThird(); other();
    const fresh = queue.acquire('one', context());
    assert.equal(typeof fresh, 'function'); fresh();
});

test('等待取消立即清理监听和容量，不阻塞后续任务', async () => {
    const queue = createDoubaoSpeechQueue({ maxWaitingPerAccount: 1 });
    const first = queue.acquire('one', context());
    const controller = new AbortController();
    const waiting = queue.acquire('one', context(controller.signal));
    const rejected = assert.rejects(waiting, e => e.code === 'doubao_speech_cancelled' && e.speechQueueFailure);
    controller.abort(); await rejected;
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    const next = queue.acquire('one', context());
    first(); (await next)();
});

test('等待超时使用原deadline，清理后可再次等待', async () => {
    const queue = createDoubaoSpeechQueue({ maxWaitingPerAccount: 1 });
    const first = queue.acquire('one', context());
    const controller = new AbortController();
    const waiting = queue.acquire('one', { signal: controller.signal, deadline: Date.now() + 20 });
    await assert.rejects(waiting, e => e.code === 'doubao_speech_timeout' && e.speechQueueFailure);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    const next = queue.acquire('one', context());
    first(); (await next)();
});

test('账号与实例等待容量独立受限，满队列不阻止空闲账号', async () => {
    const queue = createDoubaoSpeechQueue({ maxWaitingPerAccount: 1, maxWaitingTotal: 2 });
    const a = queue.acquire('a', context()); const b = queue.acquire('b', context());
    const aw = queue.acquire('a', context());
    assert.throws(() => queue.acquire('a', context()), e => e.code === 'doubao_speech_busy' && e.speechQueueFailure && /队列已满/u.test(e.message));
    const bw = queue.acquire('b', context()); const c = queue.acquire('c', context());
    assert.throws(() => queue.acquire('c', context()), e => e.code === 'doubao_speech_busy');
    a(); (await aw)(); b(); (await bw)(); c();
});

test('预取消/无效截止时间不占槽，交接时已到期项不会运行', async () => {
    const queue = createDoubaoSpeechQueue();
    const controller = new AbortController(); controller.abort();
    assert.throws(() => queue.acquire('one', context(controller.signal)), e => e.code === 'doubao_speech_cancelled');
    for (const deadline of [NaN, Infinity, Date.now() - 1])
        assert.throws(() => queue.acquire('one', { deadline }), e => e.code === 'doubao_speech_timeout');
    const first = queue.acquire('one', context());
    const deadline = Date.now() + 5;
    const expired = queue.acquire('one', { deadline });
    const rejected = assert.rejects(expired, e => e.code === 'doubao_speech_timeout');
    const next = queue.acquire('one', context());
    // 同步占用事件循环直到截止，验证交接检查不依赖定时回调先执行。
    while (Date.now() <= deadline) { /* 仅测试短暂阻塞，生产代码不轮询。 */ }
    first(); await rejected; (await next)();
});
