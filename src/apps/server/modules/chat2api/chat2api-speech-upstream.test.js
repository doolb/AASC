'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createSpeechUpstreamController, createQwenApiRateGate } = require('./chat2api-speech-upstream');
const { DEFAULT_ROOT_DIR } = require('./chat2api-data-store');
const { createOrderedTaskScheduler } = require('../media/ordered-task-scheduler');
const { createDoubaoSpeechAdapter } = require('./chat2api-doubao-speech-adapter');
const { EventEmitter } = require('node:events');
const context = () => ({ deadline: Date.now() + 10000 });

test('Qwen API 同账号按启动间隔排队，跨入口共享且不因等待数量丢句', async () => {
    const gate = createQwenApiRateGate({ intervalMs: 5 });
    const started = [];
    const jobs = Array.from({ length: 20 }, (_, index) => gate.waitForStart('same').then(() => {
        started.push({ index, at: Date.now() });
    }));
    await Promise.all(jobs);
    assert.deepEqual(started.map(item => item.index), Array.from({ length: 20 }, (_, index) => index));
    for (let index = 1; index < started.length; index++) assert.ok(started[index].at - started[index - 1].at >= 4);
    const owner = createSpeechUpstreamController();
    const first = owner.forRoot().qwenApiRateGate;
    const second = owner.forRoot(path.join(DEFAULT_ROOT_DIR, '.')).qwenApiRateGate;
    const begun = Date.now();
    await first.waitForStart('one', 'fixed');
    await second.waitForStart('one', 'fixed');
    assert.ok(Date.now() - begun >= 450);
    const web = owner.forRoot().qwenChatRateGate;
    const webProxy = owner.forRoot(path.join(DEFAULT_ROOT_DIR, '.')).qwenChatRateGate;
    const webStarted = Date.now();
    await web.waitForStart('one', 'QUARK_VOICE');
    await webProxy.waitForStart('one', 'QUARK_VOICE');
    assert.ok(Date.now() - webStarted >= 450);
});

test('Qwen API 等待取消和截止后不迟到启动，其他账号独立', async () => {
    const gate = createQwenApiRateGate({ intervalMs: 40 });
    await gate.waitForStart('one');
    const controller = new AbortController();
    const cancelled = gate.waitForStart('one', { signal: controller.signal });
    const expired = gate.waitForStart('one', { deadline: Date.now() + 10 });
    await gate.waitForStart('two');
    controller.abort();
    await assert.rejects(cancelled, error => error.code === 'ABORT_ERR');
    await assert.rejects(expired, error => error.code === 'TTS_PROVIDER_TIMEOUT');
    await new Promise(resolve => setTimeout(resolve, 45));
    await gate.waitForStart('one');
});

test('两个真实适配器共享controller，同账号总连接最多3而非各3', async () => {
    const owner = createSpeechUpstreamController();
    const sockets = [];
    const create = () => createDoubaoSpeechAdapter({ queue: owner.forRoot(), createSocket() {
        const socket = new EventEmitter(); socket.terminate = () => {}; socket.send = () => {};
        sockets.push(socket); return socket;
    } });
    const adapters = [create(), create()];
    const cookie = 'sessionid=demo_session_12345678; passport_csrf_token=demo_csrf_12345678';
    const tasks = [0, 1, 0, 1].map(index => adapters[index].generate({ text: '模拟上游' }, cookie,
        { accountId: 'one', deadline: Date.now() + 10000 }));
    const rejections = tasks.map(task => assert.rejects(task, e => e.code === 'doubao_speech_incomplete'));
    assert.equal(sockets.length, 3);
    sockets[0].emit('close'); await rejections[0];
    assert.equal(sockets.length, 4);
    sockets.slice(1).forEach(socket => socket.emit('close')); await Promise.all(rejections);
});

// 对应.src/framework/tts-provider-configuration.md：不同服务/代理视图共享同实例准入，资料根与账号分隔。
test('同根聊天与代理共用三路额度，不同根与账号独立', async () => {
    const owner = createSpeechUpstreamController();
    const chat = owner.forRoot();
    const proxy = owner.forRoot(path.join(DEFAULT_ROOT_DIR, '.'));
    const releases = [chat.acquire('one', context()), proxy.acquire('one', context()), chat.acquire('one', context())];
    let entered = false;
    const waiting = proxy.acquire('one', context()).then(release => { entered = true; return release; });
    const other = owner.forRoot(path.join(DEFAULT_ROOT_DIR, 'other')).acquire('one', context());
    const account = proxy.acquire('two', context());
    await Promise.resolve(); assert.equal(entered, false);
    releases[0](); (await waiting)(); releases[1](); releases[2](); other(); account();
});

test('同一控制器动态刷新两个入口，全部分句先提交而上游始终不超过3', async () => {
    const owner = createSpeechUpstreamController();
    const entrypoints = [owner.forRoot(), owner.forRoot()];
    const scheduler = createOrderedTaskScheduler({ orderOnly: true });
    let submitted = 0, active = 0, maximum = 0;
    const delivered = [];
    const work = Array.from({ length: 9 }, (_, index) => scheduler.enqueue(async () => {
        submitted++;
        const pending = entrypoints[index % 2].acquire('one', context());
        const release = typeof pending === 'function' ? pending : await pending;
        active++; maximum = Math.max(maximum, active);
        try { await new Promise(resolve => setTimeout(resolve, 10 - index)); return index; }
        finally { active--; release(); }
    }).then(value => delivered.push(value)));
    await Promise.resolve(); assert.equal(submitted, 9);
    await Promise.all(work); await scheduler.waitForIdle();
    assert.equal(maximum, 3); assert.deepEqual(delivered, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test('权威值热更新立即唤醒排队入口，无效读取只回退默认3', async () => {
    let concurrency = 1;
    const owner = createSpeechUpstreamController({ getDoubaoConcurrency: () => concurrency });
    const chat = owner.forRoot(), proxy = owner.forRoot();
    const first = chat.acquire('one', context());
    const second = proxy.acquire('one', context());
    concurrency = 3; owner.refresh(); const releaseSecond = await second;
    const third = proxy.acquire('one', context()); assert.equal(typeof third, 'function');
    first(); releaseSecond(); third();
    concurrency = 0;
    const defaults = [1, 2, 3].map(() => chat.acquire('one', context()));
    assert.ok(defaults.every(release => typeof release === 'function')); defaults.forEach(release => release());
});
