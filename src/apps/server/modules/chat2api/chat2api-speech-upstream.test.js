'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createSpeechUpstreamController } = require('./chat2api-speech-upstream');
const { DEFAULT_ROOT_DIR } = require('./chat2api-data-store');
const { createOrderedTaskScheduler } = require('../media/ordered-task-scheduler');
const { createDoubaoSpeechAdapter } = require('./chat2api-doubao-speech-adapter');
const { EventEmitter } = require('node:events');
const context = () => ({ deadline: Date.now() + 10000 });

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
