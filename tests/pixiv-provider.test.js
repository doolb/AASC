'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createPixivProvider, extractIllustId, parseSearch, parseRanking, safeImage, framePixels } = require('../res/tasks/overseas-media/providers/pixiv');
test('安全解析作品与来源域名', () => {
  assert.equal(extractIllustId('https://www.pixiv.net/artworks/123'), '123'); assert.equal(extractIllustId('https://i.pximg.net/a/123_p0.jpg'), '123'); assert.equal(extractIllustId('https://evil.example/artworks/123'), ''); assert.equal(safeImage('https://i.pximg.net.evil/a'), '');
  assert.equal(parseSearch({ body: { illustManga: { data: [{ id: '123', title: '作品' }] } } })[0].url, 'https://www.pixiv.net/artworks/123'); assert.equal(parseRanking({ contents: [{ illust_id: '1' }] }).length, 1);
});
test('同代理复用作品请求与已验证封面，代理变更后重新请求', async () => {
  let proxy = 'http://proxy-one'; const calls = [];
  const config = { get proxyUrl() { return proxy; } };
  const p = createPixivProvider(config, { httpGet: async (cfg, url) => {
    calls.push({ proxy: cfg.proxyUrl, url });
    if (url.includes('ranking.php')) return { data: { contents: [{ illust_id: '123', url: 'https://i.pximg.net/cover.jpg' }] } };
    if (url.includes('/pages?')) return { data: { body: [{ urls: { original: 'https://i.pximg.net/123_p0.jpg' } }] } };
    if (url.includes('/ajax/illust/')) { await new Promise(resolve => setTimeout(resolve, 10)); return { data: { body: { title: '作品', illustType: 0, urls: { small: 'https://i.pximg.net/cover.jpg' } } } }; }
    return { status: 200, headers: { 'content-type': 'image/jpeg' }, data: Readable.from(['image']) };
  } });
  await p.home();
  const cover = await p.getCover('pixiv:123'); for await (const chunk of cover.stream) void chunk;
  assert.equal(calls.filter(x => x.url.includes('/ajax/illust/')).length, 0);
  await Promise.all([p.resolveLink({ url: '123' }), p.resolveLink({ url: '123' })]);
  assert.equal(calls.filter(x => x.url.includes('/ajax/illust/')).length, 2);
  await p.resolveLink({ url: '123' }); assert.equal(calls.filter(x => x.url.includes('/ajax/illust/')).length, 2);
  proxy = 'http://proxy-two'; await p.resolveLink({ url: '123' });
  assert.equal(calls.filter(x => x.url.includes('/ajax/illust/')).length, 4);
  assert.equal(calls.filter(x => x.proxy === 'http://proxy-two').length, 2);
  await p.stop();
});
test('多页、相关推荐、管理器接口、Range 和安全下载', async () => {
  let proxy = 'http://proxy'; const calls = []; const config = { get proxyUrl() { return proxy; } };
  const p = createPixivProvider(config, { cookie: 'secret=1', httpGet: async (cfg, url, opts) => { calls.push({ url, opts, proxy: cfg.proxyUrl }); if (url.includes('ranking.php')) return { data: { contents: [{ illust_id: '123', title: '标题' }] } }; if (url.includes('/recommend/')) return { data: { body: { illusts: [{ id: '124', title: '推荐' }] } } }; if (url.includes('/pages?')) return { data: { body: [{ urls: { original: 'https://i.pximg.net/123_p0.jpg' } }, { urls: { original: 'https://i.pximg.net/123_p1.png' } }] } }; if (url.includes('/ajax/illust/')) return { data: { body: { title: '标题', illustType: 0 } } }; return { status: opts.headers.Range ? 206 : 200, headers: { 'content-type': 'image/jpeg', 'content-length': '2' }, data: Readable.from(['ab']) }; } });
  assert.equal((await p.home()).items[0].id, 'pixiv:123'); assert.equal((await p.resolveLink({ url: '123' })).items.length, 2); assert.equal((await p.related({ itemId: 'pixiv:123:0' })).items[0].id, 'pixiv:124'); assert.equal((await p.list('/pixiv-123')).length, 2); assert.equal((await p.getFile('/pixiv-123-0')).mediaType, 'image');
  proxy = ''; const stream = await p.getFileStream('/pixiv-123-0', { start: 1, end: 2 }); assert.equal(stream.statusCode, 206); for await (const chunk of stream.stream) {} const last = calls.at(-1); assert.equal(last.opts.headers.Cookie, undefined); assert.equal(last.opts.headers.Referer, 'https://www.pixiv.net/'); assert.equal(last.opts.headers.Range, 'bytes=1-2'); assert.equal(last.proxy, '');
  let saved = ''; await p.download({ id: 'pixiv:123:0', title: 'A' }, { save: async (name, input) => { assert.equal(name, 'A.jpg'); for await (const c of input) saved += c; } }); assert.equal(saved, 'ab'); await p.stop();
});
test('阻止不可信图片和在途请求，异常不泄露凭据', async () => {
  let started; const waiting = new Promise(resolve => { started = resolve; }); const p = createPixivProvider({}, { httpGet: async (cfg, url, opts) => new Promise((resolve, reject) => { started(); opts.signal.addEventListener('abort', () => reject(new Error('secret')), { once: true }); }) }); const pending = p.home(); await waiting; await p.stop(); await assert.rejects(pending, e => !e.message.includes('secret'));
});
test('动图 ZIP 解码转码并拒绝非预期条目', async () => {
  const yazl = require('yazl'); const { spawnSync } = require('node:child_process');
  const generated = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:size=32x32', '-frames:v', '1', '-threads', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1']); assert.equal(generated.status, 0);
  async function archive(name) { const zip = new yazl.ZipFile(); zip.addBuffer(generated.stdout, name); zip.end(); const chunks = []; for await (const chunk of zip.outputStream) chunks.push(chunk); return Buffer.concat(chunks); }
  let zip = await archive('000001.jpg');
  const p = createPixivProvider({}, { httpGet: async (cfg, url) => { if (url.includes('ugoira_meta')) return { data: { body: { originalSrc: 'https://i.pximg.net/a.zip', frames: [{ file: '000001.jpg', delay: 100 }] } } }; if (url.includes('/ajax/illust/')) return { data: { body: { illustType: 2 } } }; return { status: 200, headers: {}, data: Readable.from([zip]) }; } });
  assert.equal((await p.resolveLink({ url: '123' })).items[0].playable, false); let output; await p.download({ id: 'pixiv:123:0', title: '动图' }, { save: async (name, stream) => { assert.equal(name, '动图.mp4'); const chunks = []; for await (const c of stream) chunks.push(c); output = Buffer.concat(chunks); } }); assert.equal(output.toString('ascii', 4, 8), 'ftyp');
  zip = await archive('unexpected.jpg'); await assert.rejects(p.download({ id: 'pixiv:123:0' }, { save: async () => assert.fail() })); await p.stop();
});
test('真实注册表和 HTTP 路由返回作品并代理播放', async t => {
  const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), express = require('express'), axios = require('axios');
  const { TaskMediaProviderRegistry } = require('../src/apps/web-mediacenter/modules/media/task-media-provider-registry'); const { MediaLibraryManager } = require('../src/apps/web-mediacenter/modules/media/media-library-app-service'); const { TaskMediaDownloadIndex } = require('../src/apps/server/modules/media/task-media-download-index'); const { registerTaskMediaRoutes } = require('../src/apps/server/modules/media/task-media-routes');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixiv-test-')); t.after(() => fs.rm(root, { recursive: true, force: true })); const previous = axios.defaults.adapter;
  axios.defaults.adapter = async config => { let data; if (config.url.includes('ranking.php')) data = { contents: [{ illust_id: '123', title: '标题', url: 'https://i.pximg.net/cover.jpg' }] }; else if (config.url.includes('/pages?')) data = { body: [{ urls: { original: 'https://i.pximg.net/123_p0.jpg' } }] }; else if (config.url.includes('/ajax/illust/')) data = { body: { illustType: 0, urls: { small: 'https://i.pximg.net/cover.jpg' } } };  else data = Readable.from(['ok']); return { status: 200, headers: { 'content-type': 'image/jpeg' }, config, data }; }; t.after(() => { axios.defaults.adapter = previous; });
  const registry = new TaskMediaProviderRegistry(); registry.register('owner', { id: 'pixiv', name: 'Pixiv', features: ['home', 'search', 'resolveLink', 'related', 'stream', 'download'], create: c => createPixivProvider(c) }); const manager = new MediaLibraryManager({ configPath: path.join(root, 'lib.json'), taskMediaProviders: registry }); const getTarget = () => ({ basePath: root }); const index = new TaskMediaDownloadIndex({ indexPath: path.join(root, 'index.json'), getTarget }); const app = express(); app.use(express.json()); registerTaskMediaRoutes(app, { manager, index, getTarget, getBaseUrl: () => 'http://localhost' }); const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); }); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })); const base = `http://127.0.0.1:${server.address().port}/api/task-media-sources/pixiv`;
  const home = await (await fetch(`${base}/home`)).json(); assert.equal(home.items[0].url, 'https://www.pixiv.net/artworks/123'); assert.equal(home.items[0].downloadable, false); assert.match(home.items[0].cover, /\/cover\/pixiv%3A123$/); assert.equal(await (await fetch(new URL(home.items[0].cover, base))).text(), 'ok'); assert.equal((await fetch(`${base}/cover/${encodeURIComponent('https://evil/a')}`)).status, 502); const resolved = await (await fetch(`${base}/resolve-link`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: home.items[0].url }) })).json(); assert.equal(resolved.items[0].id, 'pixiv:123:0'); assert.equal(await (await fetch(`${base}/stream/${encodeURIComponent(resolved.items[0].id)}`)).text(), 'ok'); await manager.getTaskSourceProvider('pixiv').getImplementation().stop();
});

test('动图帧头必须声明受限尺寸', () => {
  const png = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(png); png.writeUInt32BE(13, 8); png.write('IHDR', 12); png.writeUInt32BE(100, 16); png.writeUInt32BE(200, 20); assert.equal(framePixels(png), 20000); png.writeUInt32BE(5000, 16); assert.throws(() => framePixels(png)); assert.throws(() => framePixels(Buffer.from('invalid')));
});

test('排行榜和搜索分页边界与可访问页数一致', async () => {
  const p = createPixivProvider({}, { httpGet: async (cfg, url) => url.includes('ranking.php') ? { data: { contents: [], next: 101 } } : { data: { body: { illustManga: { data: [], total: 1000000 } } } } });
  assert.deepEqual(await p.home({ page: 100 }), { items: [], page: 100, totalPages: 100 });
  assert.deepEqual(await p.search({ keyword: 'test', page: 1000 }), { items: [], page: 1000, totalPages: 1000 }); await p.stop();
});
test('JPEG 超尺寸和累计超限 ZIP 在 ffmpeg 前拒绝，正常帧调用注入启动器', async () => {
  const yazl = require('yazl');
  const jpeg = Buffer.from([0xff,0xd8,0xff,0xc0,0,11,8,0,100,0,200,1,1,0x11,0,0xff,0xda]);
  assert.equal(framePixels(jpeg), 20000); const huge = Buffer.from(jpeg); huge.writeUInt16BE(5000, 7); assert.throws(() => framePixels(huge));
  const png = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(png); png.writeUInt32BE(13, 8); png.write('IHDR', 12); png.writeUInt32BE(4096, 16); png.writeUInt32BE(2048, 20);
  async function makeZip(entries) { const zip = new yazl.ZipFile(); for (const [name, data] of entries) zip.addBuffer(data, name); zip.end(); const chunks = []; for await (const c of zip.outputStream) chunks.push(c); return Buffer.concat(chunks); }
  let frames = Array.from({ length: 17 }, (_, i) => ({ file: `${String(i).padStart(6, '0')}.png`, delay: 100 })); let bytes = await makeZip(frames.map(f => [f.file, png])); let spawned = 0;
  const p = createPixivProvider({}, { spawnProcess: () => { spawned++; throw Error('注入的进程启动器'); }, httpGet: async (cfg, url) => { if (url.includes('ugoira_meta')) return { data: { body: { originalSrc: 'https://i.pximg.net/a.zip', frames } } }; if (url.includes('/ajax/illust/')) return { data: { body: { illustType: 2 } } }; return { status: 200, headers: {}, data: Readable.from([bytes]) }; } });
  const attempt = () => p.download({ id: 'pixiv:123:0' }, { save: async () => assert.fail() });
  await assert.rejects(attempt()); assert.equal(spawned, 0);
  frames = [{ file: '000001.jpg', delay: 100 }]; bytes = await makeZip([[frames[0].file, huge]]); await assert.rejects(attempt()); assert.equal(spawned, 0);
  bytes = await makeZip([[frames[0].file, jpeg]]); await assert.rejects(attempt()); assert.equal(spawned, 1, '有效尺寸必须调用注入的启动器，证明拒绝测试的检测有效'); await p.stop();
});

test('真实媒体管理器与显示端本地路由浏览 Pixiv 根目录和作品页', async t => {
  const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), express = require('express');
  const { TaskMediaProviderRegistry } = require('../src/apps/web-mediacenter/modules/media/task-media-provider-registry');
  const { MediaLibraryManager } = require('../src/apps/web-mediacenter/modules/media/media-library-app-service');
  const { createDisplayLocalRouter } = require('../src/apps/server/modules/media/display-local-media');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixiv-display-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const registry = new TaskMediaProviderRegistry();
  const remove = registry.register('pixiv-owner', { id: 'pixiv', name: 'Pixiv', region: 'overseas', features: ['home', 'stream'], create: config => createPixivProvider(config, { httpGet: async (cfg, url) => {
    if (url.includes('ranking.php')) return { data: { contents: [{ illust_id: '123', title: '作品' }, { illust_id: '456', title: '动图' }] } };
    if (url.includes('/ajax/illust/456?')) return { data: { body: { title: '动图', illustType: 2 } } };
    if (url.includes('/pages?')) return { data: { body: [{ urls: { original: 'https://i.pximg.net/123_p0.jpg' } }, { urls: { original: 'https://i.pximg.net/123_p1.jpg' } }] } };
    return { data: { body: { title: '作品', illustType: 0 } } };
  } }) });
  const manager = new MediaLibraryManager({ configPath: path.join(root, 'lib.json'), taskMediaProviders: registry });
  const libraryId = 'task-auto:pixiv';
  const top = await manager.list(libraryId, '/'); assert.equal(top[0].type, 'folder'); assert.equal(top[0].path, '/pixiv-123'); assert.deepEqual(await manager.list(libraryId, '/pixiv-456'), []);
  const files = await manager.list(libraryId, top[0].path); assert.deepEqual(files.map(f => f.path), ['/pixiv-123-0', '/pixiv-123-1']); assert.ok(files.every(f => f.type === 'file' && f.mediaType === 'image'));
  const app = express(); app.use('/api/display-local', createDisplayLocalRouter({ mediaLibraryManager: manager }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); }); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}/api/display-local`; const libraries = await (await fetch(`${base}/libraries`)).json(); assert.ok(libraries.libraries.some(l => l.id === libraryId));
  const list = async p => { const res = await fetch(`${base}/list?libraryId=${encodeURIComponent(libraryId)}&path=${encodeURIComponent(p)}`); assert.equal(res.status, 200); return res.json(); };
  const displayed = await list('/'); assert.deepEqual(displayed.entries.map(e => [e.type, e.path]), [['directory', '/pixiv-123'], ['directory', '/pixiv-456']]);
  const child = await list(displayed.entries[0].path); assert.equal(child.entries.length, 2); assert.equal(child.entries[0].type, 'file'); assert.equal(child.entries[0].mediaType, 'image'); assert.match(child.entries[0].directUrl, /\/api\/media-libraries\/task-auto%3Apixiv\/proxy\/pixiv-123-0$/);
  assert.deepEqual((await list('/pixiv-456')).entries, []);
  const { PlaylistManager } = require('../src/apps/web-mediacenter/modules/media/playlist-app-service'); const playlist = new PlaylistManager(manager);
  assert.deepEqual(await playlist.buildFromLibrary(libraryId, '/pixiv-456', { recursive: false, mediaTypes: ['image', 'video', 'audio', 'text'] }), []);
  assert.equal((await playlist.buildFromLibrary(libraryId, '/pixiv-123', { recursive: false, mediaTypes: ['image', 'video', 'audio', 'text'] })).length, 2);
  const impl = manager.getTaskSourceProvider('pixiv').getImplementation(); assert.equal((await impl.resolveLink({ url: '456' })).items[0].playable, false); remove(); await impl.stop();
});
