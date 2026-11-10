'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const express = require('express');
const axios = require('axios');
const { createYoutubeProvider, extractVideoId, parseInitialData, collectVideoRenderers, normalizeVideoRenderer } = require('../res/tasks/overseas-media/providers/youtube');
const { TaskMediaProviderRegistry } = require('../src/apps/web-mediacenter/modules/media/task-media-provider-registry');
const { MediaLibraryManager } = require('../src/apps/web-mediacenter/modules/media/media-library-app-service');
const { TaskMediaDownloadIndex } = require('../src/apps/server/modules/media/task-media-download-index');
const { registerTaskMediaRoutes } = require('../src/apps/server/modules/media/task-media-routes');
const id = 'dQw4w9WgXcQ';
const html = `<script>var ytInitialData = ${JSON.stringify({ contents: [{ videoRenderer: { videoId: id, title: { runs: [{ text: '真实标题 } ;' }] }, ownerText: { runs: [{ text: '作者' }] } } }] })};</script>`;
test('解析 YouTube ID 和包含花括号的页面数据，拒绝其他来源', () => {
  for (const url of [id, `https://youtu.be/${id}`, `https://www.youtube.com/watch?v=${id}`, `https://www.youtube.com/shorts/${id}`]) assert.equal(extractVideoId(url), id);
  for (const url of [`http://youtu.be/${id}`, `https://youtube.com.evil.test/watch?v=${id}`, `https://user@youtube.com/watch?v=${id}`]) assert.equal(extractVideoId(url), '');
  assert.equal(normalizeVideoRenderer(collectVideoRenderers(parseInitialData(html))[0]).title, '真实标题 } ;');
  assert.equal(parseInitialData('var ytInitialData = {bad};'), null);
});
test('首页没有推荐时给出提示，搜索仍返回实际视频', async () => {
  const provider = createYoutubeProvider({}, { ytdlp: { ensure: async () => {} }, httpGet: async (_config, url) => ({ data: url.includes('/results?') ? html : '<script>var ytInitialData = {"contents":[]};</script>' }) });
  await assert.rejects(provider.home(), /首页暂无推荐视频.*搜索/);
  assert.equal((await provider.search({ keyword: '音乐' })).items[0].id, id);
  await provider.stop();
});
test('真实注册表和路由代理上游、切换代理、传输 Range 与保存实际格式', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'youtube-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let proxy = 'http://127.0.0.1:18080', bad = false, homeEmpty = false;
  const calls = [];
  const previous = axios.defaults.adapter;
  axios.defaults.adapter = async config => {
    calls.push({ url: config.url, cookie: config.headers.get('Cookie'), agent: config.httpsAgent, range: config.headers.get('Range'), redirects: config.maxRedirects });
    if (config.url.startsWith('https://www.youtube.com/')) return { data: homeEmpty && config.url === 'https://www.youtube.com/' ? '<script>var ytInitialData = {"contents":[]};</script>' : html, status: 200, headers: {}, config };
    assert.match(config.url, /^https:\/\/r1\.googlevideo\.com\//);
    return { data: Readable.from(['bc']), status: 206, headers: { 'content-type': 'video/webm', 'content-range': 'bytes 1-2/4', 'content-length': '2' }, config };
  };
  t.after(() => { axios.defaults.adapter = previous; });
  const ytdlp = { async ensure() {}, async resolve() { return { url: bad ? 'https://127.0.0.1/private' : 'https://r1.googlevideo.com/videoplayback', title: '真实标题', ext: 'webm' }; }, async run(url, template) { const output = template.replace('%(ext)s', 'webm'); await fs.writeFile(output, 'video'); return output; } };
  const registry = new TaskMediaProviderRegistry();
  registry.register('owner', { id: 'youtube', name: 'YouTube', features: ['home', 'search', 'resolveLink', 'related', 'stream', 'download'], create: config => createYoutubeProvider(config, { ytdlp, cookie: 'secret=1' }) });
  const manager = new MediaLibraryManager({ configPath: path.join(root, 'libraries.json'), taskMediaProviders: registry, getProxyUrl: () => proxy });
  const getTarget = () => ({ basePath: root });
  const index = new TaskMediaDownloadIndex({ indexPath: path.join(root, 'index.json'), getTarget });
  const app = express(); app.use(express.json()); registerTaskMediaRoutes(app, { manager, index, getTarget, getBaseUrl: () => 'http://localhost' });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}/api/task-media-sources/youtube`;
  const home = await (await fetch(`${base}/home`)).json(); assert.equal(home.items[0].title, '真实标题 } ;'); assert.ok(calls[0].agent); assert.equal(calls[0].cookie, 'secret=1');
  homeEmpty = true;
  const empty = await (await fetch(`${base}/home`)).json(); assert.match(empty.message, /首页暂无推荐视频.*搜索/);
  homeEmpty = false;
  proxy = '';
  const stream = await fetch(`${base}/stream/${id}`, { headers: { Range: 'bytes=1-2' } }); assert.equal(stream.status, 206); assert.equal(await stream.text(), 'bc');
  assert.equal(calls.at(-1).range, 'bytes=1-2'); assert.equal(calls.at(-1).cookie, undefined); assert.equal(calls.at(-1).agent, undefined); assert.equal(calls.at(-1).redirects, 0);
  const result = await fetch(`${base}/download`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item: { id, title: '标题' }, targetId: 'local' }) }); assert.equal(result.status, 200); assert.equal(await fs.readFile(path.join(root, 'YouTube', '标题.webm'), 'utf8'), 'video');
  const impl = manager.getTaskSourceProvider('youtube'); assert.equal((await impl.list('/'))[0].path, `/${id}`); assert.equal((await impl.getFile(`/${id}`)).name, '真实标题');
  bad = true; const count = calls.length; assert.equal((await fetch(`${base}/stream/${id}`)).status, 502); assert.equal(calls.length, count);
});
test('下载拒绝临时目录之外的输出文件', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'youtube-out-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const external = path.join(root, 'external.mp4'); await fs.writeFile(external, 'data');
  const provider = createYoutubeProvider({}, { ytdlp: { run: async () => external } });
  await assert.rejects(provider.download({ id }, { save: async () => assert.fail('不应保存') }));
  assert.equal(await fs.readFile(external, 'utf8'), 'data');
});

test('真实任务停止时取消首页以外的在途请求、播放流及正在保存的下载', async t => {
  const Module = require('node:module');
  const nativeFs = require('node:fs');
  const { run } = require('../res/tasks/overseas-media/task');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'youtube-lifecycle-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const priorLoad = Module._load, priorAdapter = axios.defaults.adapter, priorRead = nativeFs.createReadStream;
  let ensureCount = 0, resolveSearch, resolveSave;
  const searchStarted = new Promise(resolve => { resolveSearch = resolve; });
  const saveStarted = new Promise(resolve => { resolveSave = resolve; });
  let upstreamStream;
  const ytdlp = { ensure: async () => { ensureCount++; }, resolve: async () => ({ url: 'https://r1.googlevideo.com/video', title: '视频', ext: 'mp4' }), run: async (url, template) => { const file = template.replace('%(ext)s', 'mp4'); await fs.writeFile(file, 'video'); return file; }, stop: async () => {} };
  Module._load = function(request, parent) {
    if (parent?.filename.endsWith('/res/tasks/overseas-media/task.js')) {
      if (request === './providers/ytdlp') return { createYtdlp: () => ytdlp };
      if (request === './providers/pinterest' || request === './providers/pixiv') return { [request.endsWith('pinterest') ? 'createPinterestProvider' : 'createPixivProvider']: () => ({ list() {}, getFile() {}, getFileStream() {} }) };
    }
    return priorLoad.apply(this, arguments);
  };
  axios.defaults.adapter = async config => {
    if (config.url.includes('/results?')) return new Promise((resolve, reject) => { resolveSearch(); config.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }); });
    if (config.url.includes('googlevideo.com')) { upstreamStream = new Readable({ read() {} }); upstreamStream.push('first'); return { data: upstreamStream, status: 200, headers: { 'content-type': 'video/mp4' }, config }; }
    return { data: html, status: 200, headers: {}, config };
  };
  nativeFs.createReadStream = function(file, ...args) { if (String(file).includes('aasc-youtube-') && String(file).endsWith('video.mp4')) { resolveSave(); return new Readable({ read() {} }); } return priorRead.call(this, file, ...args); };
  t.after(() => { Module._load = priorLoad; axios.defaults.adapter = priorAdapter; nativeFs.createReadStream = priorRead; });
  const registry = new TaskMediaProviderRegistry();
  registry.register('other-owner', { id: 'other', create: () => ({}) });
  const service = await run({ params: {}, workDir: root, log() {}, registerMediaProvider: definition => registry.register('test', definition) });
  Module._load = priorLoad;
  const manager = new MediaLibraryManager({ configPath: path.join(root, 'libraries.json'), taskMediaProviders: registry });
  const getTarget = () => ({ basePath: root }); const index = new TaskMediaDownloadIndex({ indexPath: path.join(root, 'index.json'), getTarget });
  const app = express(); app.use(express.json()); registerTaskMediaRoutes(app, { manager, index, getTarget, getBaseUrl: () => 'http://localhost' });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}/api/task-media-sources/youtube`;
  assert.equal((await fetch(`${base}/home`)).status, 200); assert.equal(ensureCount, 1);
  const search = fetch(`${base}/search?keyword=test`); await searchStarted;
  const stream = await fetch(`${base}/stream/${id}`); assert.equal(stream.status, 200);
  const download = fetch(`${base}/download`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item: {id, title: '视频'}, targetId:'local' }) }); await saveStarted;
  await service.stop();
  assert.equal(upstreamStream.destroyed, true); assert.equal((await search).status, 400); assert.equal((await download).status, 400);
  assert.deepEqual(registry.list().map(entry => entry.id), ['other']);
  assert.deepEqual(await fs.readdir(path.join(root, 'YouTube')), []);
});

test('首页 yt-dlp 初始化失败时返回安全错误，其他来源不受影响', async () => {
  const p = createYoutubeProvider({}, { ytdlp: { ensure: async () => { throw new Error('secret'); } } });
  await assert.rejects(p.home(), error => /初始化失败/.test(error.message) && !error.message.includes('secret'));
  await p.stop();
});
