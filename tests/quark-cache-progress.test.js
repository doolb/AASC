'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { TextDecoder, TextEncoder } = require('node:util');
const src = fs.readFileSync('src/apps/web-mediacenter/ui/public/js/quark-cache-progress.js', 'utf8');

test('跨数据块解析进度、心跳和最终结果', async () => {
    const enc = new TextEncoder(); const events = []; let requested;
    const chunks = ['\n{"type":"progress","phase":"down', 'loading","received":5,"total":10}\n', '{"status":"success"}\n'];
    const context = { window: { location: { href: 'https://server.test/display' } }, URL, TextDecoder, Uint8Array,
        fetch: async url => { requested = url; return { ok: true, body: { getReader: () => ({ read: async () => chunks.length ? { value: enc.encode(chunks.shift()), done: false } : { done: true } }) } }; } };
    vm.runInNewContext(src, context);
    const result = await context.window.QuarkCacheProgress.prepare('/api/media-libraries/q/proxy/a', e => events.push(e));
    assert.equal(result.status, 'success');
    assert.match(requested, /prepare=1&progress=1/);
    assert.equal(events.length, 1); assert.equal(events[0].received, 5); assert.equal(events[0].total, 10);
});

test('缓存在流中返回错误时正确失败', async () => {
    const context = { window: { location: { href: 'https://server.test/' } }, URL, TextDecoder, Uint8Array,
        fetch: async () => ({ ok: true, text: async () => '{"status":"error","message":"超过 300 MB"}' }) };
    vm.runInNewContext(src, context);
    await assert.rejects(context.window.QuarkCacheProgress.prepare('/v'), /300 MB/);
});
