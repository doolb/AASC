'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getEventListeners } = require('node:events');
const http = require('node:http');
const { requestLimited, requestJson } = require('../src/apps/server/modules/tts/tts-provider-http');

async function localServer(t, handler) {
    const server = http.createServer(handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    return `http://127.0.0.1:${server.address().port}`;
}

test('预取消阻止网络请求且不泄露取消原因', async t => {
    let requests = 0;
    const url = await localServer(t, (req, res) => { requests += 1; res.end('{}'); });
    const controller = new AbortController();
    controller.abort(new Error('private-cancel-reason'));
    await assert.rejects(requestLimited(url, { signal: controller.signal }), error => {
        assert.equal(error.name, 'AbortError');
        assert.equal(error.code, 'ABORT_ERR');
        assert.ok(!error.message.includes('private-cancel-reason'));
        return true;
    });
    assert.equal(requests, 0);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('进行中取消关闭HTTP响应并清理监听；JSON请求贯通取消', async t => {
    let markStarted;
    const url = await localServer(t, (req, res) => { res.write('{'); markStarted(); });
    for (const request of [requestLimited, requestJson]) {
        const started = new Promise(resolve => { markStarted = resolve; });
        const controller = new AbortController();
        const pending = request(url, { signal: controller.signal, timeoutMs: 120 });
        const rejected = assert.rejects(pending, error => error.code === 'ABORT_ERR');
        await started;
        controller.abort();
        await rejected;
        assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    }
});

test('成功、HTTP失败与超时均清理AbortSignal监听', async t => {
    let mode;
    const url = await localServer(t, (req, res) => {
        if (mode === 'timeout') return;
        res.writeHead(mode === 'http' ? 403 : 200); res.end('{}');
    });
    for (const value of ['success', 'http', 'timeout']) {
        mode = value;
        const controller = new AbortController();
        const pending = requestLimited(url, { signal: controller.signal, timeoutMs: 30 });
        // 在请求尚未结束时应确实存在监听，否则最终零监听不能证明清理。
        assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
        if (value === 'success') await pending;
        else await assert.rejects(pending);
        assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    }
});
