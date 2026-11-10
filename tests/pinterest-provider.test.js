'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const axios = require('axios');
const express = require('express');
const { createPinterestProvider, encodePinId, decodePinId, parsePins, isAllowedPinUrl, pinLink, parsePinMetadata } = require('../res/tasks/overseas-media/providers/pinterest');
const { TaskMediaProviderRegistry } = require('../src/apps/web-mediacenter/modules/media/task-media-provider-registry');
const { MediaLibraryManager } = require('../src/apps/web-mediacenter/modules/media/media-library-app-service');
const { TaskMediaDownloadIndex } = require('../src/apps/server/modules/media/task-media-download-index');
const { registerTaskMediaRoutes } = require('../src/apps/server/modules/media/task-media-routes');
const image = 'https://i.pinimg.com/736x/aa/bb.jpg', video = 'https://v1.pinimg.com/video.mp4';
const data = { props: { pins: { a: { title: '图片', images: { orig: { url: image } } }, b: { title: '视频', videos: { video_list: { V: { url: video } } } }, c: { title: 'HLS', videos: { video_list: { V: { url: 'https://v1.pinimg.com/movie.m3u8' } } } } } } };
const html = `<script id="__PWS_DATA__" type="application/json">${JSON.stringify(data)}</script>`;
test('解析真实页面数据并拒绝伪装域名、凭据、端口和 HLS', () => {
  assert.equal(decodePinId(encodePinId(image)), image); assert.deepEqual(parsePins(data).map(x => x.mediaType), ['image', 'video', 'video']);
  for (const url of ['http://i.pinimg.com/a.jpg', 'https://pinimg.com.evil/a.jpg', 'https://u@i.pinimg.com/a.jpg', 'https://i.pinimg.com:444/a.jpg']) assert.equal(isAllowedPinUrl(url), false);
  assert.equal(parsePins({ images: { orig: { url: image } }, videos: { video_list: { hls: { url: 'https://v1.pinimg.com/video.m3u8' } } } })[0].playable, false);
  assert.equal(pinLink('https://www.pinterest.com/pin/123/?x=1'), 'https://www.pinterest.com/pin/123/');
  assert.equal(pinLink('https://www.pinterest.com.evil/pin/123/'), '');
});
test('真实注册表和 HTTP 路由按当前代理访问、隔离 Cookie、Range 和受控下载', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinterest-test-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  let proxy = 'http://127.0.0.1:18080', loginWall = false; const pinFixture = await fs.readFile(path.join(__dirname, 'fixtures/pinterest/pin-og.html'), 'utf8'); const calls = []; const previous = axios.defaults.adapter;
  axios.defaults.adapter = async config => {
    calls.push({ url: config.url, cookie: config.headers.get('Cookie'), agent: config.httpsAgent, range: config.headers.get('Range'), redirects: config.maxRedirects });
    if (config.url.startsWith('https://www.pinterest.com/')) return { data: loginWall ? 'Log in to continue' : config.url.includes('/pin/485825878526052520/') ? pinFixture : html, status: 200, headers: {}, config };
    return { data: Readable.from(['bc']), status: config.headers.get('Range') ? 206 : 200, headers: { 'content-type': 'image/jpeg', 'content-range': 'bytes 1-2/4', 'content-length': '2' }, config };
  }; t.after(() => { axios.defaults.adapter = previous; });
  const registry = new TaskMediaProviderRegistry();
  registry.register('owner', { id: 'pinterest', name: 'Pinterest', features: ['home', 'search', 'resolveLink', 'related', 'stream', 'download'], create: config => createPinterestProvider(config, { cookie: 'secret=1' }) });
  const manager = new MediaLibraryManager({ configPath: path.join(root, 'libraries.json'), taskMediaProviders: registry, getProxyUrl: () => proxy });
  const getTarget = () => ({ basePath: root }), index = new TaskMediaDownloadIndex({ indexPath: path.join(root, 'index.json'), getTarget });
  const app = express(); app.use(express.json()); registerTaskMediaRoutes(app, { manager, index, getTarget, getBaseUrl: () => 'http://localhost' });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}/api/task-media-sources/pinterest`;
  const home = await (await fetch(`${base}/home`)).json(); assert.equal(home.items[0].title, '图片'); assert.equal(home.items[2].playable, false); assert.equal(home.items[2].playUrl, ''); assert.equal(home.items[2].playbackMessage, 'HLS 视频请先下载'); assert.ok(calls[0].agent); assert.equal(calls[0].cookie, 'secret=1');
  const pinResponse = await (await fetch(`${base}/resolve-link`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://www.pinterest.com/pin/485825878526052520/' }) })).json(); assert.equal(pinResponse.items[0].title, '<3 Pin, Pin, Pin <3 Image by kentbrew');
  assert.equal((await (await fetch(`${base}/search?keyword=cat&page=2`)).json()).message, 'Pinterest 暂不支持搜索分页');
  assert.equal((await (await fetch(`${base}/home?page=2`)).json()).message, 'Pinterest 暂不支持首页分页');
  proxy = ''; const id = home.items[0].id;
  const stream = await fetch(`${base}/stream/${encodeURIComponent(id)}`, { headers: { Range: 'bytes=1-2' } }); assert.equal(stream.status, 206); assert.equal(await stream.text(), 'bc');
  assert.equal(calls.at(-1).range, 'bytes=1-2'); assert.equal(calls.at(-1).cookie, undefined); assert.equal(calls.at(-1).agent, undefined); assert.equal(calls.at(-1).redirects, 0);
  const result = await fetch(`${base}/download`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item: { id, title: '图片' }, targetId: 'local' }) }); assert.equal(result.status, 200); assert.equal(await fs.readFile(path.join(root, 'Pinterest', '图片.jpg'), 'utf8'), 'bc');
  const impl = manager.getTaskSourceProvider('pinterest'); assert.deepEqual((await impl.getImplementation().related({ itemId: id })).items, []); assert.equal((await impl.list('/'))[0].path, `/pin-${id.slice(4)}`); assert.equal((await impl.getFile(`/pin-${id.slice(4)}`)).mediaType, 'image');
  loginWall = true; const wallResponse = await (await fetch(`${base}/home`)).json(); assert.match(wallResponse.message, /检查 Cookie 是否有效/);
  const wallPin = await fetch(`${base}/resolve-link`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://www.pinterest.com/pin/485825878526052520/' }) }); assert.equal(wallPin.status, 400); assert.match((await wallPin.json()).message, /检查 Cookie 是否有效/);
  const count = calls.length; const evil = `pin:${Buffer.from('https://127.0.0.1/a.jpg').toString('base64url')}`; assert.equal((await fetch(`${base}/stream/${evil}`)).status, 502); assert.equal(calls.length, count);
});
test('合并页面多个数据脚本，并区分匿名和已配置 Cookie 的访问拒绝', async () => {
  const second = 'https://i.pinimg.com/736x/cc/dd.jpg';
  const scripts = html + `<script id="__PWS_INITIAL_PROPS__" type="application/json">${JSON.stringify({ images: { orig: { url: second } }, title: '后续图片' })}</script>`;
  const provider = createPinterestProvider({}, { httpGet: async () => ({ status: 200, data: scripts }) });
  assert.equal((await provider.home()).items.length, 4);
  assert.equal((await provider.home()).items[3].title, '后续图片');
  await provider.stop();
  for (const status of [401, 403]) {
    const anonymous = createPinterestProvider({}, { httpGet: async () => { const error = new Error('secret'); error.response = { status }; throw error; } });
    await assert.rejects(anonymous.home(), error => /匿名访问受限.*配置 Cookie/.test(error.message) && !error.message.includes('secret'));
    await anonymous.stop();
    const loggedIn = createPinterestProvider({}, { cookie: 'secret', httpGet: async () => ({ status, data: '' }) });
    await assert.rejects(loggedIn.search({ keyword: 'cat' }), error => /检查 Cookie 是否有效/.test(error.message) && !error.message.includes('secret'));
    await loggedIn.stop();
  }
});
test('登录墙与错误脱敏，停止取消页面请求、媒体流及保存', async () => {
  const wall = createPinterestProvider({}, { httpGet: async () => ({ data: 'Log in to continue' }) }); await assert.rejects(wall.home(), /配置 Cookie/); await wall.stop();
  const secret = createPinterestProvider({}, { httpGet: async () => { throw new Error('secret'); } }); await assert.rejects(secret.home(), e => !e.message.includes('secret')); await secret.stop();
  let started; const pending = new Promise(resolve => { started = resolve; }); let stream;
  const provider = createPinterestProvider({}, { httpGet: async (config, url, options) => {
    if (url.includes('/search/')) return new Promise((resolve, reject) => { started(); options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); });
    stream = new Readable({ read() {} }); return { data: stream, status: 200, headers: {} };
  } });
  const search = provider.search({ keyword: 'x' }); await pending;
  const playing = await provider.getStream(encodePinId(image));
  const download = provider.download({ id: encodePinId(image) }, { save: async (name, input) => new Promise((resolve, reject) => { input.on('close', () => reject(new Error('closed'))); }) });
  await new Promise(resolve => setImmediate(resolve)); await provider.stop();
  await assert.rejects(search); await assert.rejects(download); assert.equal(playing.stream.destroyed, true); assert.equal(stream.destroyed, true);
});

test('HLS 受控抓取 TS 分段并离线转封装，拒绝加密及不可信地址', async t => {
  const { spawnSync } = require('node:child_process');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinterest-hls-test-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'sample.ts');
  const generated = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=64x64:rate=25', '-t', '2', '-c:v', 'mpeg2video', '-f', 'mpegts', file]);
  assert.equal(generated.status, 0, '需要 ffmpeg 和 mpeg2 编码器');
  const ts = await fs.readFile(file); let playlist = '#EXTM3U\n#EXTINF:1,\nsegment.ts\n#EXT-X-ENDLIST\n'; const requests = [];
  const p = createPinterestProvider({}, { httpGet: async (config, url, options) => {
    requests.push(url); assert.equal(options.maxRedirects, 0); assert.equal(options.headers.Cookie, undefined);
    return { status: 200, data: url.endsWith('.m3u8') ? Buffer.from(playlist) : ts, headers: {} };
  } });
  const id = encodePinId('https://v1.pinimg.com/path/video.m3u8');
  await assert.rejects(p.getStream(id), /请先下载/);
  let saved; await p.download({ id, title: '视频' }, { save: async (name, stream) => { assert.equal(name, '视频.mp4'); const chunks = []; for await (const chunk of stream) chunks.push(chunk); saved = Buffer.concat(chunks); } });
  assert.ok(saved.length > 0); assert.equal(saved.toString('ascii', 4, 8), 'ftyp'); assert.deepEqual(requests, ['https://v1.pinimg.com/path/video.m3u8', 'https://v1.pinimg.com/path/segment.ts']);
  playlist = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://evil.example/key"\n#EXTINF:1,\nsegment.ts\n#EXT-X-ENDLIST\n';
  await assert.rejects(p.download({ id }, { save: async () => assert.fail() }), /格式不支持/);
  playlist = '#EXTM3U\n#EXTINF:1,\nhttps://evil.example/segment.ts\n#EXT-X-ENDLIST\n';
  const count = requests.length; await assert.rejects(p.download({ id }, { save: async () => assert.fail() })); assert.equal(requests.length, count + 1);
  await p.stop();
  const limited = createPinterestProvider({}, { hlsOutputLimit: 128, httpGet: async (config, url) => ({ status: 200, data: url.endsWith('.m3u8') ? Buffer.from('#EXTM3U\n#EXTINF:1,\nsegment.ts\n#EXT-X-ENDLIST\n') : ts }) });
  await assert.rejects(limited.download({ id }, { save: async () => assert.fail('超限输出不能保存') })); await limited.stop();
});

test('停止时取消 HLS 分段请求并清理临时目录', async () => {
  let started; const pending = new Promise(resolve => { started = resolve; });
  const p = createPinterestProvider({}, { httpGet: async (config, url, options) => {
    if (url.endsWith('.m3u8')) return { status: 200, data: Buffer.from('#EXTM3U\n#EXTINF:1,\nsegment.ts\n#EXT-X-ENDLIST\n') };
    return new Promise((resolve, reject) => { started(); options.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }); });
  } });
  const before = new Set((await fs.readdir(os.tmpdir())).filter(x => x.startsWith('aasc-pinterest-')));
  const download = p.download({ id: encodePinId('https://v1.pinimg.com/video.m3u8') }, { save: async () => assert.fail() });
  await pending;
  const second = createPinterestProvider({}, { httpGet: async () => { assert.fail('并发 HLS 不应发出请求'); } });
  await assert.rejects(second.download({ id: encodePinId('https://v1.pinimg.com/other.m3u8') }, { save: async () => assert.fail() })); await second.stop();
  await p.stop(); await assert.rejects(download);
  assert.deepEqual((await fs.readdir(os.tmpdir())).filter(x => x.startsWith('aasc-pinterest-') && !before.has(x)), []);
});


test('Pin OG 元数据仅接收 canonical 一致的图片，不把视频封面当图片', async () => {
  const html = await fs.readFile(path.join(__dirname, 'fixtures/pinterest/pin-og.html'), 'utf8');
  const url = 'https://www.pinterest.com/pin/485825878526052520/';
  assert.equal(parsePinMetadata(html, url)[0].mediaType, 'image');
  assert.deepEqual(parsePinMetadata(html, 'https://www.pinterest.com/pin/123/'), []);
  assert.deepEqual(parsePinMetadata(html.replace('</head>', '<meta property="og:video" content="https://v1.pinimg.com/movie.mp4"></head>'), url), []);
  assert.deepEqual(parsePinMetadata(html.replace('i.pinimg.com', 'evil.example'), url), []);
});


test('Pin 详情只返回 canonical 匹配且自身 ID 匹配的媒体，不能返回推荐 Pin', async () => {
  const id = '485825878526052520';
  const fixture = await fs.readFile(path.join(__dirname, 'fixtures/pinterest/pin-og.html'), 'utf8');
  const recommended = { id: '123456', title: '推荐', images: { orig: { url: 'https://i.pinimg.com/other.jpg' } } };
  const own = { id, title: '目标', images: { orig: { url: image } }, recommendations: [recommended] };
  let html = fixture.replace('{"site":{}}', JSON.stringify({ pins: [own, recommended] }));
  const p = createPinterestProvider({}, { httpGet: async () => ({ status: 200, data: html }) });
  const url = `https://www.pinterest.com/pin/${id}/`;
  const result = await p.resolveLink({ url }); assert.deepEqual(result.items.map(item => item.title), ['目标']);
  html = html.replace('what-a-cute-animal--485825878526052520', 'other--123456');
  await assert.rejects(p.resolveLink({ url }), /未返回与链接匹配/);
  html = fixture.replace('{"site":{}}', JSON.stringify({ pins: [recommended] }));
  const fallback = await p.resolveLink({ url }); assert.equal(fallback.items.length, 1); assert.notEqual(fallback.items[0].title, '推荐');
  await p.stop();
});
