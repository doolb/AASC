'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    audioDurationMs, createDisplayAsrLongQueue, createDisplayAsrLongQueueSettings,
    normalizeConfig, validateConfig
} = require('../src/apps/server/modules/asr/display-asr-long-queue');

const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

function wav(samples, sampleRate = 16000) {
    const pcmBytes = samples * 2;
    const result = Buffer.alloc(44 + pcmBytes);
    result.write('RIFF', 0);
    result.writeUInt32LE(result.length - 8, 4);
    result.write('WAVEfmt ', 8);
    result.writeUInt32LE(16, 16);
    result.writeUInt16LE(1, 20);
    result.writeUInt16LE(1, 22);
    result.writeUInt32LE(sampleRate, 24);
    result.writeUInt32LE(sampleRate * 2, 28);
    result.writeUInt16LE(2, 32);
    result.writeUInt16LE(16, 34);
    result.write('data', 36);
    result.writeUInt32LE(pcmBytes, 40);
    return result;
}

test('实际 WAV 时长决定边界，异常容器回退录音时间', () => {
    assert.ok(audioDurationMs(wav(159999)) < 10000);
    assert.equal(audioDurationMs(wav(160000)), 10000);
    assert.equal(audioDurationMs(wav(320000, 32000)), 10000);
    const broken = wav(160000);
    broken.writeUInt32LE(9999999, 40);
    assert.equal(audioDurationMs(broken, { speechStartAt: 1000, speechEndAt: 13000 }), 12000);
    assert.equal(audioDurationMs(Buffer.from('not-audio'), { speechStartAt: 0, speechEndAt: 0 }), null);
    assert.equal(audioDurationMs(Buffer.from('not-audio'), { speechStartAt: null, speechEndAt: 13000 }), null);
});

test('每台 ASR 显示端长任务串行且互不影响，等待取消后不下发', async () => {
    const queue = createDisplayAsrLongQueue();
    const first = deferred(), other = deferred();
    const started = [];
    const a = queue.enqueue('display-a', () => { started.push('a1'); return first.promise; });
    const cancel = new AbortController();
    const discarded = queue.enqueue('display-a', () => { started.push('cancelled'); return 'bad'; }, cancel.signal);
    const b = queue.enqueue('display-a', () => { started.push('a2'); return 'a2'; });
    const c = queue.enqueue('display-b', () => { started.push('b1'); return other.promise; });
    await tick();
    assert.deepEqual(started, ['a1', 'b1']);
    cancel.abort();
    await assert.rejects(discarded, { code: 'asr_queue_cancelled' });
    first.resolve('a1');
    other.resolve('b1');
    assert.equal(await a, 'a1');
    assert.equal(await c, 'b1');
    assert.equal(await b, 'a2');
    assert.deepEqual(started, ['a1', 'b1', 'a2']);
});

test('运行时提高并发立即启动等待任务，降低并发不取消在途任务', async () => {
    const queue = createDisplayAsrLongQueue();
    const tasks = [deferred(), deferred(), deferred()];
    const started = [];
    const requests = tasks.map((item, index) => queue.enqueue('display-a', () => {
        started.push(index);
        return item.promise;
    }));
    await tick();
    assert.deepEqual(started, [0]);
    queue.setConfig({ thresholdSeconds: 10, concurrency: 2 });
    await tick();
    assert.deepEqual(started, [0, 1]);
    queue.setConfig({ thresholdSeconds: 10, concurrency: 1 });
    tasks[0].resolve(0);
    await tick();
    assert.deepEqual(started, [0, 1]);
    tasks[1].resolve(1);
    await tick();
    assert.deepEqual(started, [0, 1, 2]);
    tasks[2].resolve(2);
    assert.deepEqual(await Promise.all(requests), [0, 1, 2]);
});

test('等待列表满时明确报忙，任务失败后释放准入', async () => {
    const queue = createDisplayAsrLongQueue();
    const first = deferred();
    const active = queue.enqueue('display-a', () => first.promise);
    const waiting = Array.from({ length: 8 }, (_, index) => queue.enqueue('display-a', () => index));
    await assert.rejects(queue.enqueue('display-a', () => 'overflow'), { code: 'asr_queue_full' });
    first.reject(new Error('显示端已离线'));
    await assert.rejects(active, /显示端已离线/);
    assert.deepEqual(await Promise.all(waiting), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('配置严格校验、持久化后广播权威值，失败回传旧配置', () => {
    assert.deepEqual(normalizeConfig({ thresholdSeconds: 0, concurrency: 3 }), { thresholdSeconds: 10, concurrency: 3 });
    assert.throws(() => validateConfig({ thresholdSeconds: '10', concurrency: 1 }), /整数/);
    let stored = null;
    let failSave = false;
    const replies = [], broadcasts = [], applied = [];
    const socket = { send: raw => replies.push(JSON.parse(raw)) };
    const settings = createDisplayAsrLongQueueSettings({
        config: { get: () => stored, set: (key, value) => {
            assert.equal(key, 'asr.displayLongQueue');
            if (failSave) return false;
            stored = value;
            return true;
        } },
        queue: { setConfig: value => applied.push(value) },
        broadcast: message => broadcasts.push(message)
    });
    assert.equal(settings.handle(socket, { type: 'getAsrLongQueueConfig' }), true);
    assert.deepEqual(replies.at(-1), { type: 'asrLongQueueConfig', thresholdSeconds: 10, concurrency: 1 });
    assert.equal(settings.handle(socket, { type: 'setAsrLongQueueConfig', thresholdSeconds: 15, concurrency: 2, requestId: 'ok' }), true);
    assert.equal(broadcasts.at(-1).requestId, 'ok');
    assert.deepEqual(applied.at(-1), { thresholdSeconds: 15, concurrency: 2 });
    for (const input of [{ thresholdSeconds: 121, concurrency: 2 }, { thresholdSeconds: 15, concurrency: 0 }]) {
        settings.handle(socket, { type: 'setAsrLongQueueConfig', ...input });
        assert.equal(replies.at(-1).success, false);
    }
    failSave = true;
    settings.handle(socket, { type: 'setAsrLongQueueConfig', thresholdSeconds: 20, concurrency: 3 });
    assert.equal(replies.at(-1).success, false);
    assert.equal(replies.at(-1).thresholdSeconds, 15);
    assert.equal(applied.length, 1);
    assert.equal(broadcasts.length, 1);
    assert.equal(settings.handle(socket, { type: 'unrelated' }), false);
});

test('正式路由在实际发送前分流，控制端只通过现有 WS 通道保存', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/apps/server/boot/server-app.js'), 'utf8');
    assert.match(source, /audioDurationMs\(req\.file\.buffer, requestContext\)/);
    assert.match(source, /displayAsrLongQueue\.enqueue\(displayWithAsr\.id, recognize, waitingAbort\.signal\)/);
    assert.match(source, /'getAsrLongQueueConfig', 'setAsrLongQueueConfig'/);
    assert.match(source, /asrLongQueueSettings\.snapshot\(\)/);
});
