'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { spawnSync } = require('node:child_process');
const { BilibiliDownloads } = require('../src/apps/server/modules/media/bilibili-download-service');
const { createBilibiliSearchService } = require('../src/apps/server/modules/media/bilibili-search-service');

async function wait(service) { for (let i = 0; i < 400 && service.job?.status === 'running'; i++) await new Promise(r => setTimeout(r, 10)); assert.notEqual(service.job.status, 'running'); return service.job; }
async function create(t, extra = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bili-download-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
    const first = path.join(root, 'one'), second = path.join(root, 'two'); await fs.mkdir(first); await fs.mkdir(second);
    const targets = { a: { basePath: first }, b: { basePath: second } };
    const streams = { resolveDash: async () => ({ video: { url: 'video' }, audio: { url: 'audio' } }), resolve: async () => ({ streamUrl: 'mp4' }), openDownloadStream: async url => Readable.from([url]) };
    const options = { indexPath: path.join(root, 'index.json'), getTarget(id) { if (!targets[id]) throw Error('目标不存在'); return targets[id]; }, streamService: streams, fetchCollection: async () => ({ videos: [{ bvid: 'BV1B7411m7LV', page: 1, title: '课程' }, { bvid: 'BV1B7411m7LV', page: 2, title: '课程' }] }), merge: async (v, a, o) => fs.writeFile(o, Buffer.concat([await fs.readFile(v), await fs.readFile(a)])), ...extra };
    return { root, first, second, options, service: new BilibiliDownloads(options) };
}

test('搜索结果安全规范化并校验参数', async () => {
    const search = createBilibiliSearchService({ client: { get: async (url, options) => {
        if (url.endsWith('/nav')) return { status: 200, data: { data: { wbi_img: { img_url: `https://i.test/${'a'.repeat(32)}.png`, sub_url: `https://i.test/${'b'.repeat(32)}.png` } } } };
        if (url.endsWith('/spi')) return { status: 200, data: { data: { b_3: 'abc', b_4: 'def' } } };
        // 无签名通道返回 412，触发 WBI 签名回退；签名参数在 options.params 中。
        if (!options?.params?.w_rid) return { status: 412, data: '' };
        assert.match(options.params.w_rid, /^[a-f0-9]{32}$/);
        return { status: 200, data: { code: 0, data: { numPages: 2, result: [{ bvid: 'BV1B7411m7LV', title: '<em>教学</em> &amp; 视频', pic: '//i0.hdslb.com/p.jpg', author: 'UP' }, { bvid: 'bad' }] } } };
    } } });
    const result = await search('测试', 1);
    assert.equal(result.videos.length, 1); assert.equal(result.videos[0].title, '教学 视频'); assert.equal(result.videos[0].cover, 'https://i0.hdslb.com/p.jpg');
    await assert.rejects(search('', 1), /参数无效/); await assert.rejects(search('x', 51), /参数无效/);
});

test('收藏列表下载到所选媒体库，记录分集且重启后可查找', async t => {
    const f = await create(t); f.service.start('https://www.bilibili.com/list/ml1', 'b');
    assert.throws(() => f.service.start('https://www.bilibili.com/video/BV1B7411m7LV', 'a'), /正在进行/);
    assert.equal((await wait(f.service)).completed, 2);
    const video = { bvid: 'BV1B7411m7LV', page: 2 };
    const saved = await f.service.lookup(video); assert.ok(saved.full.startsWith(f.second + path.sep)); assert.equal(saved.quality, '480P');
    assert.equal(await fs.readFile(saved.full, 'utf8'), 'videoaudio');
    const restarted = new BilibiliDownloads(f.options); assert.equal((await restarted.lookup(video)).full, saved.full);
    restarted.start('https://www.bilibili.com/video/BV1B7411m7LV?p=2', 'a', '课程'); await wait(restarted);
    assert.ok((await restarted.lookup(video)).full.startsWith(f.first + path.sep));
});

test('DASH 或合成失败时回退单文件，下载失败不记录映射', async t => {
    const f = await create(t, { merge: async () => { throw Error('无 ffmpeg'); } });
    f.service.start('https://www.bilibili.com/video/BV1B7411m7LV', 'a'); await wait(f.service);
    const saved = await f.service.lookup({ bvid: 'BV1B7411m7LV', page: 1 }); assert.equal(saved.quality, 'MP4'); assert.equal(await fs.readFile(saved.full, 'utf8'), 'mp4');
    f.options.streamService.openDownloadStream = async () => { throw Error('无法下载'); };
    const other = new BilibiliDownloads(f.options); other.start('https://www.bilibili.com/video/BV1B7411m7LV?p=2', 'a');
    assert.equal((await wait(other)).status, 'error'); assert.equal(await other.lookup({ bvid: 'BV1B7411m7LV', page: 2 }), null);
});

test('真实 ffmpeg 将音视频流合成为可播放的 MP4', async t => {
    if (spawnSync('ffmpeg', ['-version']).status !== 0) return t.skip('ffmpeg 不可用');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bili-ffmpeg-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const v = path.join(dir, 'v.mp4'), a = path.join(dir, 'a.m4a'), out = path.join(dir, 'out.mp4');
    const video = spawnSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=32x32:d=0.2', '-c:v', 'mpeg4', '-y', v]);
    const audio = spawnSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', '-c:a', 'aac', '-y', a]);
    assert.equal(video.status, 0); assert.equal(audio.status, 0);
    await require('../src/apps/server/modules/media/bilibili-download-service').mergeTracks(v, a, out);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', out], { encoding: 'utf8' });
    assert.equal(probe.status, 0); assert.match(probe.stdout, /video/); assert.match(probe.stdout, /audio/);
});

test('下载后的 B 站分集可通过本地代理读取和 Range 拖动', async t => {
    const f = await create(t); f.service.start('https://www.bilibili.com/video/BV1B7411m7LV?p=2', 'a'); await wait(f.service);
    const { serveQuarkDirectoryDownload } = require('../src/apps/server/modules/media/quark-directory-downloads');
    const express = require('express'); const app = express();
    app.get('/local', async (req, res) => { try { if (!await serveQuarkDirectoryDownload(req, res, f.service.source, '/BV1B7411m7LV/p2.mp4', f.service.index)) res.sendStatus(404); } catch { res.sendStatus(500); } });
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/local`, { headers: { Range: 'bytes=0-4' } });
    assert.equal(response.status, 206); assert.equal(await response.text(), 'video');
});

test('B 站下载按分类目录存放并保留分集后缀', async t => {
    const f = await create(t);
    f.service.start('https://www.bilibili.com/list/ml1', 'a', '课程合集', '我的课程');
    assert.equal((await wait(f.service)).completed, 2);
    const saved = await f.service.lookup({ bvid: 'BV1B7411m7LV', page: 2 });
    assert.ok(saved.full.startsWith(path.join(f.first, 'B站视频', '我的课程') + path.sep));
    assert.match(saved.full, /P2\.mp4$/);
});

test('B 站单视频无分类时落入未分类目录，旧记录仍可查询', async t => {
    const f = await create(t);
    f.service.start('https://www.bilibili.com/video/BV1B7411m7LV', 'b');
    await wait(f.service);
    const saved = await f.service.lookup({ bvid: 'BV1B7411m7LV', page: 1 });
    assert.ok(saved.full.startsWith(path.join(f.second, 'B站视频', '未分类') + path.sep));
    assert.equal(await fs.readFile(saved.full, 'utf8'), 'videoaudio');
});

// 旧版本索引保留原 relative，升级后查询和去重不能依赖新目录布局。
test('旧 B站下载记录重启后仍命中，分类变化不重复下载', async t => {
    const f = await create(t);
    const relative = path.join('B站下载', '旧课程 BV1B7411m7LV P2.mp4');
    const full = path.join(f.first, relative);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, 'legacy');
    const source = f.service.source;
    const filePath = '/BV1B7411m7LV/p2.mp4';
    await fs.writeFile(f.options.indexPath, JSON.stringify({ records: [{ key: f.service.index.key(source, filePath), source, filePath, targetId: 'a', relative, size: 6, quality: '480P' }] }));
    const restarted = new BilibiliDownloads(f.options);
    assert.equal((await restarted.lookup({ bvid: 'BV1B7411m7LV', page: 2 })).full, full);
    restarted.start('https://www.bilibili.com/video/BV1B7411m7LV?p=2', 'a', '课程', '新分类');
    assert.equal((await wait(restarted)).skipped, 1);
    assert.equal(await fs.readFile(full, 'utf8'), 'legacy');
    await assert.rejects(fs.stat(path.join(f.first, 'B站视频')), { code: 'ENOENT' });
});

// 执行 server-app 中实际注册的处理器，避免另写替身路由掩盖字段遗漏。
test('真实 B 站下载路由透传分类并保留缺省和参数校验', async () => {
    const vm = require('node:vm');
    const source = await fs.readFile(path.join(__dirname, '../src/apps/server/boot/server-app.js'), 'utf8');
    const start = source.indexOf("app.post('/api/bilibili/download',");
    const end = source.indexOf("\napp.get('/api/bilibili/download',", start);
    let handler;
    let received;
    vm.runInNewContext(source.slice(start, end), {
        app: { post(route, callback) { assert.equal(route, '/api/bilibili/download'); handler = callback; } },
        bilibiliDownloads: { start(...args) { received = args; return { category: args[3] }; } }
    });
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; } };
    handler({ body: { url: 'video', targetId: 'a', title: '标题', category: '课程 / 2026' } }, res);
    assert.deepEqual(received, ['video', 'a', '标题', '课程 / 2026']);
    assert.equal(res.body.status, 'success');
    handler({ body: { url: 'video', targetId: 'a' } }, res);
    assert.equal(received[3], '');
    handler({ body: { url: 'video' } }, res);
    assert.equal(res.statusCode, 400);
});
