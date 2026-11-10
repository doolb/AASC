'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeProxyUrl, resolveSourceProxyUrl, axiosProxyOptions } = require('../src/apps/server/modules/media/web-proxy');

test('normalizeProxyUrl 接受 HTTP/HTTPS/SOCKS5 并去掉末尾斜杠', () => {
    assert.equal(normalizeProxyUrl(''), '');
    assert.equal(normalizeProxyUrl('http://127.0.0.1:7890/'), 'http://127.0.0.1:7890');
    assert.equal(normalizeProxyUrl('socks5://127.0.0.1:1080'), 'socks5://127.0.0.1:1080');
});

test('normalizeProxyUrl 拒绝非法协议和查询参数', () => {
    assert.throws(() => normalizeProxyUrl('ftp://127.0.0.1:21'), /HTTP\/HTTPS\/SOCKS5/);
    assert.throws(() => normalizeProxyUrl('http://127.0.0.1:7890/?a=1'), /查询参数/);
});

test('resolveSourceProxyUrl 使用显式开关覆盖默认值', () => {
    const base = { globalProxy: 'http://127.0.0.1:7890', sourceId: 'youtube' };
    assert.equal(resolveSourceProxyUrl({ ...base, switches: {}, proxyDefault: true }), 'http://127.0.0.1:7890');
    assert.equal(resolveSourceProxyUrl({ ...base, switches: { youtube: false }, proxyDefault: true }), '');
    assert.equal(resolveSourceProxyUrl({ ...base, switches: { youtube: true }, proxyDefault: false }), 'http://127.0.0.1:7890');
    assert.equal(resolveSourceProxyUrl({ ...base, switches: {}, proxyDefault: false }), '');
});

test('resolveSourceProxyUrl 对非法持久化代理抛错（调用方需容错）', () => {
    // server-app.js 的 getSourceProxyUrl 在读取路径 try/catch 降级为无代理，
    // 但核心校验仍必须抛错，供保存代理配置等写入路径返回明确错误。
    assert.throws(() => resolveSourceProxyUrl({
        globalProxy: 'not-a-url',
        switches: { bilibili: true },
        sourceId: 'bilibili'
    }), /代理地址格式无效/);
});

test('axiosProxyOptions 为代理请求关闭 axios 默认代理并返回 agent', () => {
    const options = axiosProxyOptions('socks5://127.0.0.1:1080');
    assert.equal(options.proxy, false);
    assert.ok(options.httpAgent);
    assert.ok(options.httpsAgent);
    assert.deepEqual(axiosProxyOptions(''), {});
});
