'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { QuarkVideoCache } = require('../src/apps/web-mediacenter/modules/media/quark-video-cache');

test('同一视频并发只下载一次，不同视频串行且最多保留两个完整缓存', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-cache-test-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const cache = new QuarkVideoCache(dir);
    let active = 0, peak = 0, downloads = 0;
    const download = content => async () => {
        downloads++; active++; peak = Math.max(active, peak);
        return Readable.from((async function* () { await new Promise(r => setTimeout(r, 30)); yield content; active--; })());
    };
    const [a, again, b] = await Promise.all([cache.prepare('a', 3, download('abc')), cache.prepare('a', 3, download('bad')), cache.prepare('b', 3, download('xyz'))]);
    assert.equal(a, again); assert.equal(downloads, 2); assert.equal(peak, 1);
    assert.equal(await fs.readFile(b, 'utf8'), 'xyz');
    assert.deepEqual((await fs.readdir(dir)).filter(x => x.endsWith('.video')).sort(), [path.basename(a), path.basename(b)].sort());
    await cache.prepare('b', 3, download('bad')); assert.equal(downloads, 2);
    await assert.rejects(cache.prepare('large', 300 * 1024 * 1024 + 1, download('')), /300 MB/);
    assert.equal(await fs.readFile(b, 'utf8'), 'xyz');
    await new Promise(r => setTimeout(r, 10));
    await cache.prepare('a', 3, download('bad'));
    const c = await cache.prepare('c', 3, download('123'));
    assert.deepEqual((await fs.readdir(dir)).filter(x => x.endsWith('.video')).sort(), [path.basename(a), path.basename(c)].sort());
    assert.equal(peak, 1);
});

test('缓存不完整不会切换成成品或留下临时文件', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-cache-test-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const cache = new QuarkVideoCache(dir);
    await assert.rejects(cache.prepare('bad', 10, async () => Readable.from(['short'])), /不完整/);
    assert.deepEqual(await fs.readdir(dir), []);
});

test('多个订阅者收到共享下载的排队、字节进度和完成事件', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-cache-test-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const cache = new QuarkVideoCache(dir);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let downloads = 0;
    const firstEvents = [], secondEvents = [];
    const download = async () => { downloads++; await gate; return Readable.from(['abc', 'def']); };
    const first = cache.prepare('same', 6, download, event => firstEvents.push({ ...event }));
    const second = cache.prepare('same', 6, download, event => secondEvents.push({ ...event }));
    release(); await Promise.all([first, second]);
    assert.equal(downloads, 1);
    for (const events of [firstEvents, secondEvents]) {
        assert.equal(events[0].phase, 'queued');
        assert.ok(events.some(event => event.phase === 'downloading'));
        assert.ok(events.some(event => event.received > 0 && event.total === 6));
        assert.deepEqual(events.at(-1), { phase: 'ready', received: 6, total: 6 });
    }
});
