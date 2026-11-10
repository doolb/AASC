'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const express = require('express');
const axios = require('axios');
const { createHongguoProvider, parseSeriesId, parseSearchPayload, htmlItems, episodeItems } = require('../res/tasks/domestic-media/providers/hongguo');
const { TaskMediaProviderRegistry } = require('../src/apps/web-mediacenter/modules/media/task-media-provider-registry');
const { MediaLibraryManager } = require('../src/apps/web-mediacenter/modules/media/media-library-app-service');
const { TaskMediaDownloadIndex } = require('../src/apps/server/modules/media/task-media-download-index');
const { registerTaskMediaRoutes } = require('../src/apps/server/modules/media/task-media-routes');
const id = '7701935931787316286', video = '12345';
const html = `<a href="/detail?series_id=${id}"><img alt="剧A" src="https://p3-sign.douyinpic.com/a.jpg"></a><a href="/detail?series_id=${id}">重复</a>`;
const episode = `<script type="application/ld+json">${JSON.stringify({ '@type': 'VideoObject', name: '公开片段', contentUrl: `https://hongguoduanju.com/video/public/${video}/360p.mp4` })}</script>`;

test('解析仅接受红果链接，规范化条目并过滤非公开地址', () => {
  assert.equal(parseSeriesId(`https://hongguoduanju.com/player/${id}`), id);
  assert.equal(parseSeriesId(`https://hongguoduanju.com/detail?series_id=${id}`), id);
  assert.equal(parseSeriesId(id), id);
  assert.equal(parseSeriesId('https://example.com/player/1'), '');
  assert.equal(parseSeriesId('https://user@hongguoduanju.com/player/1'), '');
  const parsed = parseSearchPayload({ searchList: [{ name: '剧名', video_data: { series_id: id }, cover: 'https://p3-sign.douyinpic.com/a.jpg' }, { video_data: { series_id: 9007199254740992 } }] });
  assert.equal(parsed.length, 1); assert.equal(parsed[0].mediaType, 'collection'); assert.equal(parsed[0].downloadable, false); assert.match(parsed[0].url, new RegExp(id));
  assert.equal(htmlItems(html).length, 1);
  assert.equal(episodeItems(id, episode).length, 1);
  assert.equal(episodeItems(id, episode.replace('hongguoduanju.com/video', 'example.com/video')).length, 0);
});

test('多集逐页核验公开地址，保留无法播放的分集并排除无关链接', async t => {
  const previous = axios.defaults.adapter;
  const requests = [];
  const links = `<a href="/player/${id}">1</a><a href="/player/${id}/111">2</a><a href="/player/${id}/222">3</a><a href="/player/${id}/333">4</a><a href="/player/${id}/111">重复</a><a href="/player/999/444">其他剧</a><a href="https://evil.example/player/${id}/555">外站</a>`;
  const second = episode.replace(video, '67890');
  axios.defaults.adapter = async config => {
    requests.push(config.url);
    if (config.url.endsWith(`/player/${id}`)) return { data: links + episode, status: 200, headers: {}, config };
    if (config.url.endsWith(`/player/${id}/111`)) return { data: second, status: 200, headers: {}, config };
    if (config.url.endsWith(`/player/${id}/222`)) return { data: '<script type="application/ld+json">{"@type":"VideoObject"}</script>', status: 200, headers: {}, config };
    if (config.url.endsWith(`/player/${id}/333`)) throw new Error('网络错误');
    if (config.url.endsWith('/video/public/67890/360p.mp4')) return { data: Readable.from(['second']), status: 200, headers: {}, config };
    throw new Error('unexpected upstream');
  };
  t.after(() => { axios.defaults.adapter = previous; });
  const provider = createHongguoProvider();
  t.after(() => provider.stop());
  const { items } = await provider.resolveLink({ url: id });
  assert.deepEqual(items.map(item => item.title), ['第1集', '第2集', '第3集', '第4集']);
  assert.equal(items[1].id, `episode:${id}:67890`);
  assert.equal(items[2].playable, false); assert.equal(items[2].downloadable, false);
  assert.equal(items[3].playable, false); assert.match(items[3].playbackMessage, /暂无公开/);
  assert.equal((await provider.list(`/${id}`)).length, 2);
  const stream = await provider.getStream(items[1].id);
  let data = ''; for await (const chunk of stream.stream) data += chunk;
  assert.equal(data, 'second');
  await assert.rejects(provider.getStream(items[2].id));
  assert.equal(requests.some(url => /evil|\/999\/444|\/555/.test(url)), false);
});

test('真实注册表和 HTTP 路由连接模拟上游，动态代理、Range、下载与公开性校验', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hongguo-provider-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const prior = axios.defaults.adapter, requests = [];
  axios.defaults.adapter = async config => {
    requests.push({ url: config.url, headers: config.headers.toJSON(), agent: config.httpsAgent });
    let data, status = 200, headers = {};
    if (config.url.endsWith('/api/search/result/')) data = { searchList: [{ name: '剧A', video_data: { series_id: id } }] };
    else if (config.url.endsWith(`/player/${id}`)) data = episode;
    else if (config.url.endsWith('/')) data = html;
    else if (config.url.endsWith(`/video/public/${video}/360p.mp4`)) {
      const range = config.headers.get('Range');
      status = range ? 206 : 200; data = Readable.from([range ? 'bc' : 'abcd']);
      headers = { 'content-type': 'video/mp4', 'content-length': range ? '2' : '4', ...(range ? { 'content-range': 'bytes 1-2/4' } : {}) };
    } else throw new Error('unexpected upstream');
    return { data, status, statusText: 'OK', headers, config };
  };
  t.after(() => { axios.defaults.adapter = prior; });
  let proxy = 'http://127.0.0.1:18080';
  const registry = new TaskMediaProviderRegistry();
  registry.register('owner', { id: 'hongguo', name: '红果短剧', features: ['home', 'search', 'resolveLink', 'related', 'stream', 'download'], create: config => createHongguoProvider(config, { cookie: 'session=test' }) });
  const manager = new MediaLibraryManager({ configPath: path.join(root, 'libraries.json'), taskMediaProviders: registry, getProxyUrl: () => proxy });
  const getTarget = () => ({ basePath: root });
  const index = new TaskMediaDownloadIndex({ indexPath: path.join(root, 'index.json'), getTarget });
  const app = express(); app.use(express.json()); registerTaskMediaRoutes(app, { manager, index, getTarget, getBaseUrl: () => 'http://localhost' });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}/api/task-media-sources/hongguo`;
  const home = await (await fetch(`${base}/home`)).json(); assert.equal(home.items[0].id, `series:${id}`);
  assert.ok(requests[0].agent); assert.equal(requests[0].headers.Cookie, 'session=test');
  proxy = '';
  const search = await (await fetch(`${base}/search?keyword=测试`)).json(); assert.equal(search.items[0].title, '剧A');
  assert.equal(requests.at(-1).agent, undefined);
  const before = requests.length; const next = await (await fetch(`${base}/search?keyword=测试&page=2`)).json();
  assert.deepEqual(next.items, []); assert.equal(next.page, 1); assert.equal(next.totalPages, 1); assert.equal(requests.length, before);
  assert.equal(home.items[0].downloadable, false); assert.equal(search.items[0].downloadable, false);
  const resolved = await (await fetch(`${base}/resolve-link`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: id }) })).json();
  const item = resolved.items[0]; assert.equal(item.id, `episode:${id}:${video}`);
  const stream = await fetch(`${base}/stream/${encodeURIComponent(item.id)}`, { headers: { Range: 'bytes=1-2' } });
  assert.equal(stream.status, 206); assert.equal(await stream.text(), 'bc');
  const download = await fetch(`${base}/download`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item, targetId: 'local' }) });
  assert.equal(download.status, 200); assert.equal(await fs.readFile(path.join(root, '红果短剧', '公开片段.mp4'), 'utf8'), 'abcd');
  assert.equal((await (await fetch(`${base}/resolve-link`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: id }) })).json()).items[0].downloaded, true);
  const fake = await fetch(`${base}/stream/${encodeURIComponent(`episode:${id}:999`)}`); assert.equal(fake.status, 502);
  assert.equal(requests.some(r => r.url.includes('/999/')), false);
  const impl = manager.getTaskSourceProvider('hongguo').getImplementation();
  assert.equal((await impl.list('/'))[0].path, `/${id}`);
  assert.equal((await impl.getFile(`/${id}/${video}.mp4`)).mediaType, 'video');
  await assert.rejects(impl.getFileStream(`/${id}/999.mp4`));
});

test('真实国内任务停止会中断页面、播放流和正在保存的下载，并等待回滚', async t => {
  const { PassThrough } = require('node:stream');
  const { run } = require('../res/tasks/domestic-media/task');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hongguo-stop-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const previous = axios.defaults.adapter;
  const upstreamStreams = []; let homeStarted;
  const homeReady = new Promise(resolve => { homeStarted = resolve; });
  axios.defaults.adapter = async config => {
    if (config.url.endsWith('/')) return new Promise((resolve, reject) => {
      homeStarted();
      config.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
    if (config.url.endsWith(`/player/${id}`)) return { data: episode, status: 200, statusText: 'OK', headers: {}, config };
    if (config.url.endsWith(`/video/public/${video}/360p.mp4`)) {
      const stream = new PassThrough(); upstreamStreams.push(stream);
      setImmediate(() => stream.write('partial'));
      return { data: stream, status: 200, statusText: 'OK', headers: { 'content-type': 'video/mp4' }, config };
    }
    throw new Error('unexpected');
  };
  t.after(() => { axios.defaults.adapter = previous; });
  const registry = new TaskMediaProviderRegistry();
  const service = await run({ params: {}, workDir: root, log() {}, registerMediaProvider: def => registry.register('task', def) });
  const manager = new MediaLibraryManager({ configPath: path.join(root, 'libraries.json'), taskMediaProviders: registry, getProxyUrl: () => '' });
  const getTarget = () => ({ basePath: root });
  const index = new TaskMediaDownloadIndex({ indexPath: path.join(root, 'index.json'), getTarget });
  const app = express(); app.use(express.json()); registerTaskMediaRoutes(app, { manager, index, getTarget, getBaseUrl: () => 'http://localhost' });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}/api/task-media-sources/hongguo`;
  const pendingHome = fetch(`${base}/home`); await homeReady;
  const item = { id: `episode:${id}:${video}`, title: '测试', mediaType: 'video' };
  const playback = await fetch(`${base}/stream/${encodeURIComponent(item.id)}`);
  const reader = playback.body.getReader(); assert.equal((await reader.read()).done, false);
  const download = fetch(`${base}/download`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item, targetId: 'local' }) });
  for (let i = 0; upstreamStreams.length < 2 && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(upstreamStreams.length, 2);
  await service.stop();
  assert.equal((await pendingHome).status, 400);
  await assert.rejects(reader.read());
  assert.equal((await download).status, 400);
  assert.ok(upstreamStreams.every(stream => stream.destroyed));
  assert.deepEqual(await fs.readdir(path.join(root, '红果短剧')), []);
  assert.equal(await index.lookup('hongguo', item.id), null);
  assert.equal(registry.get('hongguo'), undefined);
});
