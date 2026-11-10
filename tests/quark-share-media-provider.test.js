'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { QuarkShareProvider, MediaLibraryManager } = require('../src/apps/web-mediacenter/modules/media/media-library-app-service');

function client() {
    const calls = [];
    return { calls, async post(url, body) { calls.push({ url, body }); return { data: { code: 0, data: { stoken: 'token' } } }; }, async get(url, options) {
        calls.push({ url, options });
        if (options.responseType === 'stream') return { status: 200, headers: { 'content-type': 'image/webp' }, data: Readable.from(['image']) };
        const fid = options.params.pdir_fid;
        const list = fid === '0' ? [{ fid: 'folder', file_name: '相册', dir: true }] : [{ fid: 'image', file_name: 'a.png', dir: false, obj_category: 'image', preview_url: 'https://img.drive.quark.cn/image', size: 100 }];
        return { data: { code: 0, data: { list }, metadata: { _total: list.length } } };
    } };
}
test('浏览嵌套分享目录并通过受限预览地址读取图片', async () => {
    const api = client();
    const provider = new QuarkShareProvider({ id: 'q', url: 'https://pan.quark.cn/s/abc', passcode: '1234' }, { client: api });
    await provider.connect();
    assert.equal(api.calls[0].body.passcode, '1234');
    assert.equal((await provider.list('/'))[0].name, '相册');
    const item = (await provider.list('/相册'))[0];
    assert.equal(item.path, '/相册/a.png');
    assert.match(item.url, /\/api\/media-libraries\/q\/proxy\//);
    assert.equal((await provider.getFile(item.path)).size, 0);
    const result = await provider.getFileStream(item.path);
    assert.equal(result.headers['Content-Type'], 'image/webp');
    assert.equal((await Array.fromAsync(result.stream)).join(''), 'image');
    await assert.rejects(provider.list('/../x'), /路径无效/);
});
test('拒绝伪造分享链接和非夸克预览地址', async () => {
    assert.throws(() => new QuarkShareProvider({ url: 'https://pan.quark.cn.evil/s/abc' }), /有效/);
    const api = client();
    const original = api.get;
    api.get = async function(url, options) { const result = await original.call(this, url, options); if (result.data?.data?.list?.[0]?.preview_url) result.data.data.list[0].preview_url = 'https://evil.example/test'; return result; };
    const provider = new QuarkShareProvider({ url: 'https://pan.quark.cn/s/abc' }, { client: api });
    await provider.connect();
    await assert.rejects(provider.getFileStream('/相册/a.png'), /地址无效/);
});
test('夸克库保持只读且可持久化提取码', () => {
    const manager = new MediaLibraryManager({ configPath: '/tmp/aasc-quark-test-unused' });
    const config = { id: 'q', type: 'quark', readonly: true, url: 'https://pan.quark.cn/s/abc', passcode: '1234' };
    manager.libraries.set('q', { config, provider: {} });
    let saved; manager.saveConfig = () => { saved = { ...config }; };
    manager.updateLibraryConfig('q', { readonly: false });
    assert.equal(saved.readonly, true);
    assert.equal(saved.passcode, '1234');
});

test('视频免转存取链，更新 Cookie 并代理 Range；拒绝非夸克下载域名', async () => {
    const before = process.env.KUAKE_COOKIE;
    process.env.KUAKE_COOKIE = '__pus=original; __puus=old';
    try {
        const calls = [];
        const video = { fid: 'video', file_name: 'v.mp4', dir: false, share_fid_token: 'ft', size: 3 };
        const api = {
            async post(url, body, options) {
                calls.push({ url, body, options });
                if (url.endsWith('/token')) return { data: { code: 0, data: { stoken: 'st' } }, headers: {} };
                return { data: { code: 0, data: [{ download_url: 'https://dl.pds.quark.cn/v' }] }, headers: {} };
            },
            async get(url, options) {
                calls.push({ url, options });
                if (url.endsWith('/config')) return { headers: { 'set-cookie': ['__puus=fresh; Path=/'] } };
                if (url.endsWith('/detail')) return { data: { code: 0, data: { list: [video] }, metadata: { _total: 1 } }, headers: {} };
                return { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': '3' }, data: Readable.from(['abc']) };
            }
        };
        const { QuarkVideoCache } = require('../src/apps/web-mediacenter/modules/media/quark-video-cache');
        const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-quark-test-'));
        const provider = new QuarkShareProvider({ id: 'q', url: 'https://pan.quark.cn/s/abc' }, { client: api, videoCache: new QuarkVideoCache(temp) });
        await provider.connect();
        assert.equal((await provider.getFile('/v.mp4')).size, 3);
        const response = await provider.getFileStream('/v.mp4', { start: 0, end: 2 });
        assert.equal(response.statusCode, 206);
        assert.equal(response.headers['Content-Range'], 'bytes 0-2/3');
        assert.equal((await Array.fromAsync(response.stream)).join(''), 'abc');
        const upstream = calls.find(call => call.url === 'https://dl.pds.quark.cn/v');
        assert.equal(upstream.options.headers.Range, undefined);
        assert.match(upstream.options.headers.Cookie, /__puus=fresh/);
        assert.equal(upstream.options.maxRedirects, 0);
        const post = api.post;
        api.post = async (...args) => args[0].endsWith('/download') ? { data: { code: 0, data: [{ download_url: 'https://evil.example/v' }] }, headers: {} } : post(...args);
        await fs.promises.rm(temp, { recursive: true });
        await assert.rejects(provider.getFileStream('/v.mp4'), /不受信任/);
        await fs.promises.rm(temp, { recursive: true });
    } finally { if (before === undefined) delete process.env.KUAKE_COOKIE; else process.env.KUAKE_COOKIE = before; }
});

test('视频列表公布可用缩略图，缩略图独立读取且不启动视频缓存', async () => {
    let downloadStarted = false;
    const video = { fid: 'v', file_name: 'v.mp4', dir: false, size: 120, obj_category: 'video', thumbnail: 'https://thumb.drive.quark.cn/a' };
    const api = {
        async post() { return { data: { code: 0, data: { stoken: 'st' } } }; },
        async get(url, options) {
            if (options.responseType === 'stream') return { status: 200, headers: { 'content-type': 'image/png' }, data: Readable.from(['image']) };
            return { data: { code: 0, data: { list: [video] }, metadata: { _total: 1 } } };
        }
    };
    const provider = new QuarkShareProvider({ id: 'q', url: 'https://pan.quark.cn/s/abc' }, { client: api, videoCache: { prepare() { downloadStarted = true; } } });
    await provider.connect();
    assert.equal((await provider.list('/'))[0].hasThumbnail, true);
    const image = await provider.getThumbnailStream('/v.mp4');
    assert.equal(image.headers['Content-Type'], 'image/png');
    assert.equal((await Array.fromAsync(image.stream)).join(''), 'image');
    assert.equal(downloadStarted, false);
    video.thumbnail = 'https://evil.example/image';
    await assert.rejects(provider.getThumbnailStream('/v.mp4'), /地址无效/);
});

test('下载分享原文件流并透传 Range，不经过视频缓存或图片预览', async () => {
    const calls = [];
    const item = { fid: 'f', file_name: '原图.png', dir: false, share_fid_token: 'ft', size: 500 * 1024 * 1024, obj_category: 'image', preview_url: 'https://img.drive.quark.cn/preview' };
    const api = {
        async post(url, body) {
            calls.push({ url, body });
            return url.endsWith('/token') ? { data: { code: 0, data: { stoken: 'st' } }, headers: {} } : { data: { code: 0, data: [{ download_url: 'https://dl.pds.quark.cn/original' }] }, headers: {} };
        },
        async get(url, options) {
            calls.push({ url, options });
            if (url.endsWith('/config')) return { headers: {} };
            if (url.endsWith('/detail')) return { data: { code: 0, data: { list: [item] }, metadata: { _total: 1 } } };
            return { status: 206, headers: { 'content-length': '3', 'content-range': 'bytes 2-4/5', 'accept-ranges': 'bytes' }, data: Readable.from(['cde']) };
        }
    };
    const provider = new QuarkShareProvider({ id: 'q', url: 'https://pan.quark.cn/s/abc' }, { client: api, getCookie: () => '__pus=test; __puus=test', videoCache: { prepare() { throw new Error('下载不应调用播放缓存'); } } });
    await provider.connect();
    const result = await provider.getDownloadStream('/原图.png', 'bytes=2-4');
    assert.equal(result.fileName, '原图.png');
    assert.equal(result.statusCode, 206);
    assert.equal(result.headers['Content-Range'], 'bytes 2-4/5');
    assert.equal((await Array.fromAsync(result.stream)).join(''), 'cde');
    const request = calls.find(x => x.url === 'https://dl.pds.quark.cn/original');
    assert.equal(request.options.headers.Range, 'bytes=2-4');
    assert.equal(request.options.maxRedirects, 0);
    assert.ok(!calls.some(x => x.url === item.preview_url));
});
