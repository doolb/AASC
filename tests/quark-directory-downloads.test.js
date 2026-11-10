'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const express = require('express');
const { QuarkDirectoryDownloads, serveQuarkDirectoryDownload } = require('../src/apps/server/modules/media/quark-directory-downloads');

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'quark-folder-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const a = path.join(root, 'a'), b = path.join(root, 'b'); await fs.mkdir(a); await fs.mkdir(b);
    const targets = { a: { basePath: a }, b: { basePath: b } };
    const state = { calls: 0, events: [], lists: { '/course': [{ type: 'folder', path: '/course/sub' }, { type: 'file', path: '/course/a.mp4', size: 3 }], '/course/sub': [{ type: 'file', path: '/course/sub/b.mp4', size: 3 }] } };
    const deps = { indexPath: path.join(root, 'index.json'), getTarget(id) { if (!targets[id]) throw Error('目标不存在'); return targets[id]; }, list: async (s, dir) => state.lists[dir], open: async () => { state.calls++; return Readable.from(['abc']); }, notify: job => state.events.push({ ...job }) };
    return { root, a, b, state, deps, service: new QuarkDirectoryDownloads(deps), source: { nodeId: 'main-server', libraryId: 'q' } };
}
async function finish(service) {
    for (let i = 0; i < 200 && service.job?.status === 'running'; i++) await new Promise(r => setTimeout(r, 5));
    assert.notEqual(service.job?.status, 'running');
    return service.job;
}

test('目录递归保存到指定媒体库，记录映射、重启复用、保留已有文件', async t => {
    const f = await fixture(t);
    f.service.start(f.source, '/course', 'b');
    assert.equal((await finish(f.service)).status, 'done');
    const one = await f.service.lookup(f.source, '/course/a.mp4');
    assert.ok(one.full.startsWith(f.b + path.sep));
    assert.equal(await fs.readFile(one.full, 'utf8'), 'abc');
    assert.equal(await f.service.lookup(f.source, '/course/sub/b.mp4').then(x => fs.readFile(x.full, 'utf8')), 'abc');
    assert.equal((await fs.readdir(f.a)).length, 0);
    const restarted = new QuarkDirectoryDownloads(f.deps);
    assert.equal((await restarted.lookup(f.source, '/course/a.mp4')).full, one.full);
    restarted.start(f.source, '/course', 'b'); await finish(restarted);
    assert.equal(restarted.job.skipped, 2); assert.equal(f.state.calls, 2);
    restarted.start(f.source, '/course', 'a'); await finish(restarted);
    assert.ok((await restarted.lookup(f.source, '/course/a.mp4')).full.startsWith(f.a + path.sep));
    assert.equal(await fs.readFile(one.full, 'utf8'), 'abc');
});

test('相同目标文件名不会覆盖，失败文件不登记，下载任务串行', async t => {
    const f = await fixture(t);
    f.service.start(f.source, '/course', 'a');
    assert.throws(() => f.service.start(f.source, '/course', 'b'), /正在下载/);
    await finish(f.service);
    const original = await f.service.lookup(f.source, '/course/a.mp4');
    f.state.lists['/course'][1].modifiedTime = 'changed';
    f.service.start(f.source, '/course', 'a'); await finish(f.service);
    const updated = await f.service.lookup(f.source, '/course/a.mp4');
    assert.notEqual(updated.full, original.full);
    assert.equal(await fs.readFile(original.full, 'utf8'), 'abc');
    f.state.lists['/course'][1].size = 99;
    f.service.start(f.source, '/course', 'b');
    assert.match((await finish(f.service)).message, /不完整/);
    assert.equal(await f.service.lookup(f.source, '/course/a.mp4', 'b'), null);
});

test('下载映射提供本地 Range、预缓存完成响应和缺失回退', async t => {
    const f = await fixture(t); f.service.start(f.source, '/course', 'a'); await finish(f.service);
    const app = express();
    app.get('/file', async (req, res) => { if (!await serveQuarkDirectoryDownload(req, res, f.source, '/course/a.mp4', f.service)) res.sendStatus(404); });
    const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r); }));
    const url = `http://127.0.0.1:${server.address().port}/file`;
    const partial = await fetch(url, { headers: { Range: 'bytes=1-2' } });
    assert.equal(partial.status, 206); assert.equal(partial.headers.get('content-range'), 'bytes 1-2/3'); assert.equal(await partial.text(), 'bc');
    const ready = await fetch(url + '?prepare=1&progress=1'); assert.match(await ready.text(), /"phase":"ready"/);
    await fs.unlink((await f.service.lookup(f.source, '/course/a.mp4')).full);
    assert.equal((await fetch(url)).status, 404);
});

test('目录完成记录可查询，单文件记录不会被误判为目录', async () => {
    const { QuarkDirectoryDownloads } = require('../src/apps/server/modules/media/quark-directory-downloads');
    const os = require('node:os');
    const path = require('node:path');
    const instance = new QuarkDirectoryDownloads({
        indexPath: path.join(os.tmpdir(), `quark-index-${process.pid}.json`),
        getTarget: () => ({ basePath: os.tmpdir() }),
        list: async () => [],
        open: async () => ({})
    });
    const source = { nodeId: 'main-server', libraryId: 'share1' };
    instance.records.push({ key: instance.key(source, '/'), source, filePath: '/', targetId: 't1', relative: '', size: 0, directory: true, fileCount: 2, updatedAt: Date.now() });
    assert.ok(await instance.lookupDirectory(source, '/'));
    assert.equal(await instance.lookup(source, '/'), null);
    instance.records.push({ key: instance.key(source, '/file.mp4'), source, filePath: '/file.mp4', targetId: 't1', relative: 'file.mp4', size: 3, updatedAt: Date.now() });
    assert.equal(await instance.lookupDirectory(source, '/file.mp4'), null);
});

test('目录下载完成后写入目录记录并统计部分下载数量', async t => {
    const f = await fixture(t);
    f.service.start(f.source, '/course', 'a');
    assert.equal((await finish(f.service)).status, 'done');
    const record = await f.service.lookupDirectory(f.source, '/course');
    assert.equal(record.directory, true);
    assert.equal(record.fileCount, 2);
    assert.equal(f.service.countDirectory(f.source, '/course'), 2);
    assert.equal(f.service.countDirectory(f.source, '/course/sub'), 1);
    assert.equal(f.service.countDirectory(f.source, '/'), 2);
    assert.equal(await f.service.lookup(f.source, '/course'), null);
});

test('单文件下载保存、跳过重复并登记记录', async t => {
    const f = await fixture(t);
    f.service.startFile(f.source, '/course/a.mp4', 'b', { size: 3, modifiedTime: null });
    assert.equal((await finish(f.service)).status, 'done');
    const saved = await f.service.lookup(f.source, '/course/a.mp4', 'b');
    assert.ok(saved.full.startsWith(f.b + path.sep));
    assert.equal(await fs.readFile(saved.full, 'utf8'), 'abc');
    assert.equal(f.state.calls, 1);
    f.service.startFile(f.source, '/course/a.mp4', 'b', { size: 3, modifiedTime: null });
    const skipped = await finish(f.service);
    assert.equal(skipped.skipped, 1);
    assert.equal(f.state.calls, 1);
    assert.equal(await fs.readFile(saved.full, 'utf8'), 'abc');
});

test('单文件下载遇到同名已有文件时使用新文件名，不覆盖', async t => {
    const f = await fixture(t);
    // 在真实下载目录预置同名文件，确保覆盖防冲突逻辑被实际触发。
    const dir = path.join(f.b, ...f.service.downloadPrefix(f.source), 'course');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'a.mp4'), 'old');
    f.service.startFile(f.source, '/course/a.mp4', 'b', { size: 3, modifiedTime: null });
    assert.equal((await finish(f.service)).status, 'done');
    const saved = await f.service.lookup(f.source, '/course/a.mp4', 'b');
    assert.equal(await fs.readFile(saved.full, 'utf8'), 'abc');
    assert.equal(await fs.readFile(path.join(dir, 'a.mp4'), 'utf8'), 'old');
    assert.equal(saved.full, path.join(dir, 'a (1).mp4'));
});

test('下载子分类按来源与分类分目录，单文件同样生效', async t => {
    const f = await fixture(t);
    f.service.start(f.source, '/course', 'b', '课程 / 2026');
    assert.equal((await finish(f.service)).status, 'done');
    const saved = await f.service.lookup(f.source, '/course/a.mp4', 'b');
    assert.ok(saved.full.startsWith(path.join(f.b, '夸克分享', '课程 _ 2026') + path.sep));
    f.service.startFile(f.source, '/course/a.mp4', 'a', { size: 3, modifiedTime: null, category: '单文件分类' });
    await finish(f.service);
    const fileSaved = await f.service.lookup(f.source, '/course/a.mp4', 'a');
    assert.ok(fileSaved.full.startsWith(path.join(f.a, '夸克分享', '单文件分类') + path.sep));
});

test('缺省分类落入未分类目录', async t => {
    const f = await fixture(t);
    f.service.start(f.source, '/course', 'a');
    await finish(f.service);
    const saved = await f.service.lookup(f.source, '/course/a.mp4', 'a');
    assert.ok(saved.full.startsWith(path.join(f.a, '夸克分享', '未分类') + path.sep));
});

test('旧夸克下载目录的记录仍可查询', async t => {
    const f = await fixture(t);
    const oldDir = path.join(f.a, '夸克下载', 'legacyhash', 'course');
    await fs.mkdir(oldDir, { recursive: true });
    await fs.writeFile(path.join(oldDir, 'a.mp4'), 'old');
    const stat = await fs.stat(path.join(oldDir, 'a.mp4'));
    f.service.records.push({
        key: f.service.key(f.source, '/course/a.mp4'),
        source: f.source,
        filePath: '/course/a.mp4',
        targetId: 'a',
        relative: path.relative(f.a, path.join(oldDir, 'a.mp4')),
        size: stat.size,
        updatedAt: Date.now()
    });
    const saved = await f.service.lookup(f.source, '/course/a.mp4', 'a');
    assert.equal(await fs.readFile(saved.full, 'utf8'), 'old');
});

test('分类穿越文本作为单层目录，实际目录与单文件下载均受清洗', async t => {
    const f = await fixture(t);
    const job = f.service.start(f.source, '/course', 'a', '../../etc');
    assert.equal(job.category, '.._.._etc');
    assert.equal((await finish(f.service)).status, 'done');
    const saved = await f.service.lookup(f.source, '/course/a.mp4', 'a');
    assert.ok(saved.full.startsWith(path.join(f.a, '夸克分享', '.._.._etc') + path.sep));
    const single = f.service.startFile(f.source, '/course/a.mp4', 'b', { size: 3, category: '/' });
    assert.equal(single.category, '_');
    assert.equal((await finish(f.service)).status, 'done');
    const fileSaved = await f.service.lookup(f.source, '/course/a.mp4', 'b');
    assert.ok(fileSaved.full.startsWith(path.join(f.b, '夸克分享', '_') + path.sep));
    assert.equal(await fs.readFile(fileSaved.full, 'utf8'), 'abc');
    const otherSource = { ...f.source, libraryId: 'another-share' };
    assert.notDeepEqual(f.service.downloadPrefix(f.source, '课程'), f.service.downloadPrefix(otherSource, '课程'));
});
