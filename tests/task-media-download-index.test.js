'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Readable } = require('node:stream');
const express = require('express');
const { TaskMediaDownloadIndex } = require('../src/apps/server/modules/media/task-media-download-index');
const { registerTaskMediaRoutes } = require('../src/apps/server/modules/media/task-media-routes');

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-task-media-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const library = path.join(root, 'library'); await fs.mkdir(library);
    const getTarget = id => { if (id !== 'local') throw new Error('bad target secret'); return { basePath: library }; };
    const index = new TaskMediaDownloadIndex({ indexPath: path.join(root, 'index.json'), getTarget });
    let calls = 0, fail = false;
    const provider = {
        home: async () => ({ items: [{ id: '1', title: '一', mediaType: 'video' }] }),
        search: async p => ({ items: [{ id: '1', title: p.keyword }] }),
        resolveLink: async p => ({ items: [{ id: '1', title: p.url }] }),
        related: async () => ({ items: [] }),
        getStream: async (id, range) => {
            if (range && range.start >= 4) return { stream: Readable.from([]), statusCode: 416, headers: { 'content-range': 'bytes */4' } };
            const start = range?.start || 0, end = Math.min(range?.end ?? 3, 3);
            return { stream: Readable.from(['abcd'.slice(start, end + 1)]), statusCode: range ? 206 : 200, headers: { 'content-type': id === 'html' ? 'text/html' : 'video/mp4', 'content-length': String(end - start + 1), ...(range ? { 'content-range': `bytes ${start}-${end}/4` } : {}), 'set-cookie': 'secret' } };
        },
        download: async (item, { save }) => { calls++; await save('same.mp4', Readable.from(['abcd'])); if (fail) throw new Error('https://secret.example/password'); }
    };
    const entry = { name: '国内来源', features: ['home', 'search', 'resolveLink', 'related', 'stream', 'download'] };
    const manager = { taskMediaProviders: { get: id => ['test', 'tomato'].includes(id) ? entry : undefined }, getTaskSourceProvider: () => ({ getImplementation: () => provider }), callTaskSource: (id, action, p) => provider[action](p) };
    const app = express(); app.use(express.json()); registerTaskMediaRoutes(app, { manager, index, getTarget, getBaseUrl: () => 'http://localhost' });
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const base = `http://127.0.0.1:${server.address().port}/api/task-media-sources/test`;
    return { root, library, index, base, provider, get calls() { return calls; }, set fail(v) { fail = v; } };
}
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('番茄代理租约只返回精确白名单错误，其他异常继续脱敏', async t => {
    const f = await fixture(t), base = f.base.replace(/\/test$/, '/tomato');
    const first = '番茄下载或读取进行中，暂不能切换代理';
    const second = '番茄下载任务状态不可用，暂不能切换代理';
    f.provider.home = async () => { throw new Error(first); };
    assert.equal((await (await fetch(base + '/home')).json()).message, first);
    f.provider.getStream = async () => { throw new Error(second); };
    assert.equal((await (await fetch(base + '/stream/id')).json()).message, second);
    f.provider.download = async () => { throw new Error(first); };
    assert.equal((await (await post(base + '/download', { item: { id: 'x' }, targetId: 'local' })).json()).message, first);
    f.provider.download = async () => { throw new Error('番茄下载文件无法确认书籍身份'); };
    assert.equal((await (await post(base + '/download', { item: { id: 'x' }, targetId: 'local' })).json()).message, '番茄下载文件无法确认书籍身份');
    f.provider.home = async () => { throw new Error(first + ' http://user:secret@example'); };
    assert.doesNotMatch(await (await fetch(base + '/home')).text(), /secret|番茄下载或读取/);
    f.provider.home = async () => { throw new Error(first); };
    assert.doesNotMatch(await (await fetch(f.base + '/home')).text(), /番茄下载或读取/);
});

test('真实路由返回条目、查询、链接、相关推荐和 Range，过滤危险响应头', async t => {
    const f = await fixture(t);
    const home = await (await fetch(f.base + '/home')).json();
    assert.equal(home.items[0].downloaded, false); assert.match(home.items[0].playUrl, /\/stream\/1$/);
    assert.equal((await (await fetch(f.base + '/search?keyword=abc')).json()).items[0].title, 'abc');
    assert.equal((await (await post(f.base + '/resolve-link', { url: 'id' })).json()).items[0].title, 'id');
    assert.deepEqual((await (await fetch(f.base + '/related')).json()).items, []);
    const stream = await fetch(f.base + '/stream/1', { headers: { Range: 'bytes=1-2' } });
    assert.equal(stream.status, 206); assert.equal(await stream.text(), 'bc'); assert.equal(stream.headers.get('set-cookie'), null);
    assert.equal(stream.headers.get('access-control-allow-origin'), '*'); assert.equal(stream.headers.get('x-content-type-options'), 'nosniff');
    const suffix = await fetch(f.base + '/stream/1', { headers: { Range: 'bytes=-2' } });
    assert.equal(suffix.status, 206); assert.equal(await suffix.text(), 'cd'); assert.equal(suffix.headers.get('content-range'), 'bytes 2-3/4');
    const invalid = await fetch(f.base + '/stream/1', { headers: { Range: 'bytes=9-10' } });
    assert.equal(invalid.status, 416); assert.equal(invalid.headers.get('content-range'), 'bytes */4');
    assert.equal((await fetch(f.base + '/stream/1', { headers: { Range: 'bytes=5-2' } })).status, 416);
    const html = await fetch(f.base + '/stream/html'); assert.equal(html.headers.get('content-type'), 'application/octet-stream');
    assert.equal(html.headers.get('x-content-type-options'), 'nosniff');
    const preflight = await fetch(f.base + '/stream/1', { method: 'OPTIONS' }); assert.equal(preflight.status, 204); assert.match(preflight.headers.get('access-control-allow-headers'), /Range/);
});

test('并发下载同一条目只保存一次；文件冲突不覆盖，丢失后重新下载', async t => {
    const f = await fixture(t); const dir = path.join(f.library, '国内来源'); await fs.mkdir(dir); await fs.writeFile(path.join(dir, 'same.mp4'), 'old');
    const body = { item: { id: '1', title: '测试' }, targetId: 'local' };
    const result = await Promise.all([post(f.base + '/download', body), post(f.base + '/download', body)]);
    assert.deepEqual(result.map(r => r.status), [200, 200]); assert.equal(f.calls, 1);
    assert.equal(await fs.readFile(path.join(dir, 'same.mp4'), 'utf8'), 'old');
    assert.equal(await fs.readFile(path.join(dir, 'same (1).mp4'), 'utf8'), 'abcd');
    assert.equal((await (await fetch(f.base + '/home')).json()).items[0].downloaded, true);
    await fs.unlink(path.join(dir, 'same (1).mp4'));
    assert.equal((await (await fetch(f.base + '/home')).json()).items[0].downloaded, false);
    assert.equal((await post(f.base + '/download', body)).status, 200); assert.equal(f.calls, 2);
});

test('下载异常、越界与符号链接被拒绝，清理文件、不泄漏异常', async t => {
    const f = await fixture(t); const body = { item: { id: '1' }, targetId: 'local' };
    f.fail = true;
    let response = await post(f.base + '/download', body); assert.equal(response.status, 400); assert.doesNotMatch(await response.text(), /secret/);
    assert.deepEqual(await fs.readdir(path.join(f.library, '国内来源')), []); assert.equal(await f.index.lookup('test', '1'), null);
    f.fail = false;
    response = await post(f.base + '/download', { ...body, dirPath: '../escape' }); assert.equal(response.status, 400);
    await fs.symlink(f.root, path.join(f.library, '国内来源', 'link'));
    response = await post(f.base + '/download', { ...body, dirPath: '/link' }); assert.equal(response.status, 400);
    assert.equal(await f.index.lookup('test', '1'), null);
});

test('索引写入失败回滚已发布文件，索引并发更新互不丢失', async t => {
    const f = await fixture(t);
    const original = f.index.record.bind(f.index);
    f.index.record = async () => { throw new Error('private index path'); };
    const res = await post(f.base + '/download', { item: { id: '1' }, targetId: 'local' });
    assert.equal(res.status, 400); assert.doesNotMatch(await res.text(), /private/);
    assert.deepEqual(await fs.readdir(path.join(f.library, '国内来源')), []);
    f.index.record = original;
    await Promise.all(['a', 'b'].map(itemId => f.index.record({ providerId: 'test', itemId, targetId: 'local', relative: itemId, size: 1 })));
    const persisted = JSON.parse(await fs.readFile(path.join(f.root, 'index.json'), 'utf8'));
    assert.deepEqual(persisted.records.map(r => r.itemId).sort(), ['a', 'b']);
});

test('真实注册表与媒体库管理器的来源可经 HTTP 浏览和下载', async t => {
    const { TaskMediaProviderRegistry } = require('../src/apps/web-mediacenter/modules/media/task-media-provider-registry');
    const { MediaLibraryManager } = require('../src/apps/web-mediacenter/modules/media/media-library-app-service');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-real-provider-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const registry = new TaskMediaProviderRegistry();
    let selectedProxy = 'http://proxy-one'; let seenProxy;
    const unregister = registry.register('owner', {
        id: 'real', name: '实际来源', features: ['home', 'stream', 'download'],
        create: config => ({
            list: async () => [], getFile: async () => ({}), getFileStream: async () => ({}),
            home: async () => { seenProxy = config.proxyUrl; return { items: [{ id: 'x', title: '项目' }] }; },
            getStream: async () => ({ stream: Readable.from(['data']), statusCode: 200, headers: { 'content-type': 'text/plain' } })
        })
    });
    const manager = new MediaLibraryManager({ configPath: path.join(root, 'libraries.json'), taskMediaProviders: registry, getProxyUrl: () => selectedProxy });
    const getTarget = () => ({ basePath: root });
    const index = new TaskMediaDownloadIndex({ indexPath: path.join(root, 'index.json'), getTarget });
    const app = express(); app.use(express.json());
    registerTaskMediaRoutes(app, { manager, index, getTarget, getBaseUrl: () => 'http://localhost' });
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const base = `http://127.0.0.1:${server.address().port}/api/task-media-sources/real`;
    assert.equal((await (await fetch(base + '/home')).json()).items[0].id, 'x'); assert.equal(seenProxy, selectedProxy);
    selectedProxy = ''; await fetch(base + '/home'); assert.equal(seenProxy, '');
    assert.equal((await post(base + '/download', { item: { id: 'x', title: '一' }, targetId: 'local' })).status, 200);
    assert.equal((await (await fetch(base + '/home')).json()).items[0].downloaded, true);
    unregister(); assert.equal((await fetch(base + '/home')).status, 400);
});

test('流回退下载拒绝 416 和 206 响应，既不留文件也不登记索引', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-task-response-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const getTarget = () => ({ basePath: root });
    const index = new TaskMediaDownloadIndex({ indexPath: path.join(root, 'index.json'), getTarget });
    let statusCode = 416;
    const provider = { getStream: async () => ({ statusCode, stream: Readable.from(['错误正文']) }) };
    const entry = { name: '来源', features: ['download'] };
    const manager = { taskMediaProviders: { get: () => entry }, getTaskSourceProvider: () => ({ getImplementation: () => provider }) };
    const app = express(); app.use(express.json());
    registerTaskMediaRoutes(app, { manager, index, getTarget, getBaseUrl: () => 'http://localhost' });
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const url = `http://127.0.0.1:${server.address().port}/api/task-media-sources/source/download`;
    for (const status of [416, 206]) {
        statusCode = status;
        assert.equal((await post(url, { item: { id: 'x' }, targetId: 'local' })).status, 400);
        assert.deepEqual(await fs.readdir(path.join(root, '来源')), []);
        assert.equal(await index.lookup('source', 'x'), null);
    }
});
