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
