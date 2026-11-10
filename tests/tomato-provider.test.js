'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { createTomatoProvider, parseSearch, parseLibrary, safeRelPath, parseRankPage, parseRankDetail, epubHasBookId, encodeLibraryPath, decodeLibraryPath } = require('../res/tasks/domestic-media/providers/tomato');
const TaskManager = require('../src/apps/server/modules/task-engine/task-manager');
async function reserve() { const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return server; }
async function epub(id) {
  const yazl = require('yazl'), zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from('<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'), 'META-INF/container.xml');
  zip.addBuffer(Buffer.from(`<package><metadata><dc:identifier>${id}</dc:identifier></metadata></package>`), 'OEBPS/content.opf');
  zip.end(); const chunks = []; for await (const chunk of zip.outputStream) chunks.push(chunk); return Buffer.concat(chunks);
}
async function zipEntries(entries) {
  const zip = new (require('yazl').ZipFile)();
  for (const [name, data] of entries) zip.addBuffer(Buffer.from(data), name);
  zip.end(); const chunks = []; for await (const chunk of zip.outputStream) chunks.push(chunk); return Buffer.concat(chunks);
}

test('解析和路径校验拒绝目录穿越', () => {
  assert.equal(parseSearch({ items: [{ book_id: '7659683388898413630', title: '书', author: '作者' }] })[0].id, 'book:7659683388898413630');
  const parsed = parseLibrary({ items: [{ kind: 'file', name: '书.txt', rel_path: '书.txt', ext: 'txt' }, { kind: 'file', rel_path: '../x.txt', ext: 'txt' }] });
  assert.equal(parsed.length, 1); assert.equal(parsed[0].id, 'file:书.txt');
  for (const value of ['../x', '/x', 'a/../b', 'a\\b']) assert.throws(() => safeRelPath(value));
  const rel = '书名 1：一（完结）.txt';
  assert.equal(decodeLibraryPath(encodeLibraryPath(rel)), rel);
  assert.throws(() => decodeLibraryPath('/f_' + Buffer.from('../secret').toString('base64url')));
  for (const invalid of ['/file:secret', '/f_..', '/f__w', '/f_YQ=']) assert.throws(() => decodeLibraryPath(invalid));
});

test('真实下载器隔离启动、登录、书库和停止', async t => {
  const binary = '/mnt/novel/TomatoNovelDownloader-Linux_amd64-v2.4.13';
  if (!fs.existsSync(binary)) return t.skip('未安装番茄下载器');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-tomato-test-'));
  const server = await reserve(); const port = server.address().port; await new Promise(resolve => server.close(resolve));
  const source = createTomatoProvider({ binary, port, workDir: dir, password: 'test-local-password' });
  try {
    assert.deepEqual(await source.create({}).list('/'), []);
    // 直接验证真实进程启用认证，并检查密码没有出现在进程参数中。
    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/status`);
    assert.ok([401, 403].includes(unauthorized.status));
    const childPids = fs.readFileSync(`/proc/self/task/${process.pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean);
    let checked = false;
    for (const pid of childPids) {
      try {
        const args = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
        const env = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
        if (args[0] !== binary || !env.includes(`TOMATO_WEB_ADDR=127.0.0.1:${port}`)) continue;
        assert.equal(args.some(arg => arg.includes('test-local-password')), false);
        assert.ok(env.includes('TOMATO_WEB_PASSWORD=test-local-password'));
        checked = true;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    assert.equal(checked, true);
  } finally { await source.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
  const other = net.createServer(); await new Promise((resolve, reject) => other.once('error', reject).listen(port, '127.0.0.1', resolve)); await new Promise(resolve => other.close(resolve));
});

test('占用端口启动失败且不影响原服务', async () => {
  const server = await reserve(); const port = server.address().port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-tomato-test-'));
  const source = createTomatoProvider({ binary: '/not/used', port, workDir: dir });
  try { await assert.rejects(source.start(), /端口/); assert.equal(server.listening, true); }
  finally { await source.stop(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('真实任务管理器停止失败保留控制器并允许重试', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-manager-test-'));
  const manager = new TaskManager({ tasksDir: dir });
  let count = 0;
  const instance = { taskName: 'test', status: 'running', stage: 'running' };
  manager.instances.set('i', instance);
  manager._services.set('i', { status: 'running', stop: async () => { if (++count === 1) throw new Error('secret'); } });
  manager.taskIO.updateIndex = async () => {};
  try {
    const first = await manager.stopInstance('test', 'i');
    assert.deepEqual(first, { success: false, error: '服务停止失败，请重试' });
    assert.equal(instance.status, 'running'); assert.equal(manager._services.has('i'), true);
    assert.equal((await manager.stopInstance('test', 'i')).success, true);
    assert.equal(instance.status, 'stopped'); assert.equal(manager._services.has('i'), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('章节按文本和 Range 读取且拒绝章节符号链接', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-tomato-test-'));
  const root = path.join(dir, 'tomato-output'); const book = path.join(root, '123456'); fs.mkdirSync(book, { recursive: true });
  fs.writeFileSync(path.join(book, 'downloaded_chapters.jsonl'), JSON.stringify({ id: '789', title: '第一章', content: '<p>你好</p>' }) + '\n');
  const source = createTomatoProvider({ binary: '/unused', port: 19001, workDir: dir });
  try {
    const provider = source.create({});
    assert.equal((await provider.resolveLink({ url: '123456' })).items[0].id, 'chapter:123456:789');
    const result = await provider.getStream('chapter:123456:789', { start: 0, end: 2 });
    const chunks = []; for await (const chunk of result.stream) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(), '你'); assert.equal(result.statusCode, 206);
    let savedName, savedBody;
    await provider.download({ id: 'chapter:123456:789', title: '第一章' }, { save: async (name, stream) => { savedName = name; const parts = []; for await (const part of stream) parts.push(part); savedBody = Buffer.concat(parts).toString(); } });
    assert.equal(savedName, '第一章.txt'); assert.equal(savedBody, '你好');
    fs.unlinkSync(path.join(book, 'downloaded_chapters.jsonl')); fs.symlinkSync('/etc/passwd', path.join(book, 'downloaded_chapters.jsonl'));
    await assert.rejects(provider.resolveLink({ url: '123456' }), /章节读取失败/);
  } finally { await source.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('通过真实任务管理器启动国内任务并停止其番茄进程', async t => {
  const binary = '/mnt/novel/TomatoNovelDownloader-Linux_amd64-v2.4.13';
  if (!fs.existsSync(binary)) return t.skip('未安装番茄下载器');
  const { TaskMediaProviderRegistry } = require('../src/apps/web-mediacenter/modules/media/task-media-provider-registry');
  const dir = fs.mkdtempSync(path.join(process.cwd(), 'tmp', 'tomato-engine-'));
  const taskDir = path.join(dir, 'domestic-media'); fs.cpSync(path.resolve('res/tasks/domestic-media'), taskDir, { recursive: true });
  const held = await reserve(); const port = held.address().port; await new Promise(resolve => held.close(resolve));
  const registry = new TaskMediaProviderRegistry();
  const manager = new TaskManager({ tasksDir: dir, taskCodeCatalog: null, registerMediaProvider: (owner, def) => registry.register(owner, def) });
  let submitted;
  try {
    await manager.init();
    submitted = await manager.submit({ taskName: 'domestic-media', taskType: 'user', target: 'server', mode: 'service', entryFile: 'task.js', files: [], params: { tomatoBinary: binary, tomatoPort: port } });
    await manager.runInstance(submitted.taskName, submitted.instanceId);
    for (let i = 0; i < 100 && !registry.get('tomato'); i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(registry.get('tomato'));
    assert.deepEqual(await registry.get('tomato').create({}).list('/'), []);
    assert.equal((await manager.stopInstance(submitted.taskName, submitted.instanceId)).success, true);
    assert.equal(registry.get('tomato'), undefined);
    const verify = net.createServer(); await new Promise((resolve, reject) => verify.once('error', reject).listen(port, '127.0.0.1', resolve)); await new Promise(resolve => verify.close(resolve));
  } finally { if (submitted && manager._services.has(submitted.instanceId)) await manager.stopInstance(submitted.taskName, submitted.instanceId); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('无效二进制启动失败后可停止并释放端口', async () => {
  const server = await reserve(); const port = server.address().port; await new Promise(resolve => server.close(resolve));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-tomato-test-'));
  const source = createTomatoProvider({ binary: path.join(dir, 'missing'), port, workDir: dir });
  try {
    await assert.rejects(source.start(), /启动失败/);
    await source.stop();
    const verify = net.createServer(); await new Promise((resolve, reject) => verify.once('error', reject).listen(port, '127.0.0.1', resolve)); await new Promise(resolve => verify.close(resolve));
  } finally { await source.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('代理按进程切换，后台作业和流阻止切换并在终态后释放', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-tomato-proxy-'));
  const binary = path.join(dir, 'downloader');
  fs.writeFileSync(binary, `#!/usr/bin/env node
const http = require('http'), fs = require('fs'), path = require('path');
const addr = process.env.TOMATO_WEB_ADDR, port = Number(addr.split(':').pop());
const mode = process.env.ALL_PROXY ? new URL(process.env.ALL_PROXY).protocol.replace(':','') : 'direct';
const server = http.createServer((req, res) => {
  const send = obj => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/status') return send({ bind_addrs: [addr] });
  if (url.pathname === '/api/search') return send({ items: [{ book_id:'123456', title: mode }] });
  if (url.pathname === '/api/library') return send({ running:false, items: [{kind:'file', name:'Book.txt', rel_path:'Book.txt', ext:'txt', size:4}, {kind:'file', name:'Book.pdf', rel_path:'Book.pdf', ext:'pdf', size:4}, ...(fs.existsSync('Book.epub') ? [{kind:'file', name:'Book.epub', rel_path:'Book.epub', ext:'epub', size:fs.statSync('Book.epub').size, modified_ms:fs.statSync('Book.epub').mtimeMs}] : []), ...(fs.existsSync('huge') ? [{kind:'file',name:'huge.epub',rel_path:'huge.epub',ext:'epub',size:65*1024*1024}] : [])] });
  if (url.pathname === '/api/jobs' && req.method === 'POST') { const n = fs.existsSync('created') ? Number(fs.readFileSync('created','utf8')) : 0; fs.writeFileSync('created',String(n+1)); if (fs.existsSync('drop')) return req.socket.destroy(); if (fs.existsSync('../next.epub')) fs.copyFileSync('../next.epub', 'Book.epub'); return send({id:'1', book_id:'123456'}); }
  if (url.pathname === '/api/jobs') { if (fs.existsSync('poll_fail')) return res.writeHead(500).end(); return send({items: [{id:'1', book_id:'123456', title:'Book', progress:{chapter_total:1,saved_chapters:1}, state:fs.existsSync('finished')?'done':'running'}]}); }
  if (url.pathname === '/download/Book.txt') { res.writeHead(200, {'content-length':'4'}); res.write('da'); setTimeout(() => res.end('ta'), 300); return; }
  if (url.pathname === '/download/Book.epub') { res.writeHead(200, {'content-length':fs.statSync('Book.epub').size}); return fs.createReadStream('Book.epub').pipe(res); }
  res.writeHead(404).end();
});
server.listen(port, '127.0.0.1', () => console.log('Web UI listening'));
process.on('SIGINT', () => server.close(() => process.exit(0)));
`); fs.chmodSync(binary, 0o755);
  const held = await reserve(); const port = held.address().port; await new Promise(resolve => held.close(resolve));
  const options = { binary, port, workDir: dir };
  const source = createTomatoProvider(options);
  let selected = '';
  const config = { get proxyUrl() { return selected; } };
  const provider = source.create(config);
  const output = path.join(dir, 'tomato-output');
  const { TaskMediaProviderRegistry } = require('../src/apps/web-mediacenter/modules/media/task-media-provider-registry');
  const { MediaLibraryManager } = require('../src/apps/web-mediacenter/modules/media/media-library-app-service');
  const { TaskMediaDownloadIndex } = require('../src/apps/server/modules/media/task-media-download-index');
  const { registerTaskMediaRoutes } = require('../src/apps/server/modules/media/task-media-routes');
  const { createDisplayLocalRouter } = require('../src/apps/server/modules/media/display-local-media');
  const { PlaylistManager } = require('../src/apps/web-mediacenter/modules/media/playlist-app-service');
  const express = require('express');
  const registry = new TaskMediaProviderRegistry();
  registry.register('task', { id: 'tomato', name: '番茄', features: ['download', 'related'], create: source.create });
  const manager = new MediaLibraryManager({ taskMediaProviders: registry, getProxyUrl: () => selected });
  const target = path.join(dir, 'target'); fs.mkdirSync(target);
  const getTarget = () => ({ basePath: target });
  const index = new TaskMediaDownloadIndex({ indexPath: path.join(dir, 'index.json'), getTarget });
  const app = express(); app.use(express.json()); registerTaskMediaRoutes(app, { manager, index, getTarget, getBaseUrl: () => 'http://localhost' });
  app.use('/api/display-local', createDisplayLocalRouter({ mediaLibraryManager: manager }));
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const route = `http://127.0.0.1:${server.address().port}/api/task-media-sources/tomato/download`;
  const post = item => fetch(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item, targetId: 'local' }) });
  let download;
  try {
    assert.equal((await provider.search({ keyword: 'x' })).items[0].title, 'direct');
    const libraryId = 'task-auto:tomato';
    const entries = await manager.list(libraryId, '/');
    assert.equal(entries.length, 1); assert.equal(decodeLibraryPath(entries[0].path), 'Book.txt');
    assert.equal((await manager.getFile(libraryId, entries[0].path)).name, 'Book.txt');
    const streamed = await manager.getFileStream(libraryId, entries[0].path);
    const body = []; for await (const chunk of streamed.stream) body.push(chunk); assert.equal(Buffer.concat(body).toString(), 'data');
    await assert.rejects(manager.getFile(libraryId, encodeLibraryPath('not-in-library.txt')), /不存在/);
    await assert.rejects(manager.getFileStream(libraryId, '/f_' + Buffer.from('../secret').toString('base64url')), /路径/);
    const local = await (await fetch(`http://127.0.0.1:${server.address().port}/api/display-local/list?libraryId=${encodeURIComponent(libraryId)}&path=%2F`)).json();
    assert.equal(local.entries[0].path, entries[0].path); assert.equal(local.entries[0].mediaType, 'text');
    const playlist = await new PlaylistManager(manager).buildFromLibrary(libraryId, '/', { mediaTypes: ['text'] });
    assert.equal(playlist[0].path, entries[0].path); assert.equal(playlist[0].fileName, 'Book.txt');
    const related = await (await fetch(route.replace('/download', '/related'))).json();
    assert.equal(related.items.find(item => item.id === 'file:Book.pdf').playable, false);
    assert.notEqual(related.items.find(item => item.id === 'file:Book.txt').playable, false);
    await assert.rejects(manager.getFile(libraryId, encodeLibraryPath('Book.pdf')), /不存在/);
    selected = 'http://user:secret@127.0.0.1:8080';
    assert.equal((await provider.search({ keyword: 'x' })).items[0].title, 'http');
    selected = 'socks5://127.0.0.1:1080';
    assert.equal((await provider.search({ keyword: 'x' })).items[0].title, 'socks5');
    const stream = await provider.getStream('file:Book.txt');
    selected = '';
    await assert.rejects(provider.search({ keyword: 'x' }), /读取进行中/);
    stream.stream.resume(); await new Promise(resolve => stream.stream.once('end', resolve));
    assert.equal((await provider.search({ keyword: 'x' })).items[0].title, 'direct');
    fs.writeFileSync(path.join(dir, 'next.epub'), await epub('999999'));
    const conflict = await post({ id: 'book:123456', url: '999999', title: 'Book' });
    assert.equal(conflict.status, 400); assert.equal(fs.existsSync(path.join(output, 'created')), false);
    assert.equal(await index.lookup('tomato', 'book:123456', 'local'), null);
    fs.writeFileSync(path.join(output, 'huge'), '');
    await assert.rejects(provider.download({ id: 'book:123456' }, { save: async () => {} }), /无法确认书籍身份/);
    assert.equal(fs.existsSync(path.join(output, 'created')), false);
    fs.unlinkSync(path.join(output, 'huge'));
    let saved = false;
    download = provider.download({ id: 'book:123456' }, { save: async () => { saved = true; } });
    for (let i = 0; i < 100 && !fs.existsSync(path.join(output, 'created')); i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(fs.existsSync(path.join(output, 'created')));
    // 另一个控制器即便配置了不同端口，也不能在同一输出域并行启动作业。
    const activePort = await reserve(); const activePortNumber = activePort.address().port; await new Promise(resolve => activePort.close(resolve));
    const competing = createTomatoProvider({ binary, port: activePortNumber, workDir: dir, saveDir: output });
    const competingPromise = competing.create({}).download({ id: 'book:123456' }, { save: async () => {} }).then(() => null, error => error);
    selected = 'http://user:secret@127.0.0.1:8080';
    await assert.rejects(provider.search({ keyword: 'x' }), error => /下载或读取进行中/.test(error.message) && !error.message.includes('secret'));
    fs.writeFileSync(path.join(output, 'finished'), '');
    assert.equal((await provider.search({ keyword: 'x' })).items[0].title, 'http');
    await assert.rejects(download, /无法确认书籍身份/); assert.equal(saved, false);
    assert.equal((await manager.list(libraryId, '/')).length, 1);
    assert.equal((await provider.related()).items.find(item => item.id === 'file:Book.epub').playable, false);
    await assert.rejects(manager.getFile(libraryId, encodeLibraryPath('Book.epub')), /不存在/);
    assert.match((await competingPromise)?.message || '', /端口|无法确认书籍身份|状态不可用/); await competing.stop();
    fs.writeFileSync(path.join(dir, 'next.epub'), await epub('123456'));
    const success = await post({ id: 'book:123456', url: '123456', title: 'Book' });
    assert.equal(success.status, 200); assert.equal((await success.json()).downloaded, true);
    assert.ok(await index.lookup('tomato', 'book:123456', 'local'));
    let staleSaved = false;
    await assert.rejects(provider.download({ id: 'book:123456' }, { save: async () => { staleSaved = true; } }), /无法确认书籍身份/);
    assert.equal(staleSaved, false);
    fs.writeFileSync(path.join(output, 'poll_fail'), '');
    await assert.rejects(provider.download({ id: 'book:123456' }, { save: async () => {} }), /请求失败/);
    const countAfterFailure = fs.readFileSync(path.join(output, 'created'), 'utf8');
    await assert.rejects(provider.download({ id: 'book:123456' }, { save: async () => {} }), /状态不可用/);
    assert.equal(fs.readFileSync(path.join(output, 'created'), 'utf8'), countAfterFailure);
    fs.unlinkSync(path.join(output, 'poll_fail'));
    await assert.rejects(provider.download({ id: 'book:123456' }, { save: async () => {} }), /无法确认书籍身份/);
    fs.unlinkSync(path.join(output, 'finished'));
    options.jobPollLimit = 1;
    await assert.rejects(provider.download({ id: 'book:123456' }, { save: async () => {} }), /任务超时/);
    const countAfterTimeout = fs.readFileSync(path.join(output, 'created'), 'utf8');
    await assert.rejects(provider.download({ id: 'book:123456' }, { save: async () => {} }), /状态不可用/);
    assert.equal(fs.readFileSync(path.join(output, 'created'), 'utf8'), countAfterTimeout);
    fs.writeFileSync(path.join(output, 'finished'), '');
    await assert.rejects(provider.download({ id: 'book:123456' }, { save: async () => {} }), /无法确认书籍身份/);
    delete options.jobPollLimit;
    fs.writeFileSync(path.join(output, 'drop'), '');
    await assert.rejects(provider.download({ id: 'book:123456' }, { save: async () => {} }), /请求失败/);
    fs.unlinkSync(path.join(output, 'drop'));
    const countAfterUnknown = fs.readFileSync(path.join(output, 'created'), 'utf8');
    await assert.rejects(provider.download({ id: 'book:123456' }, { save: async () => {} }), /状态不可用/);
    assert.equal(fs.readFileSync(path.join(output, 'created'), 'utf8'), countAfterUnknown);
    const alias = path.join(dir, 'same-output'); fs.symlinkSync(output, alias, 'dir');
    const otherPort = await reserve(); const nextPort = otherPort.address().port; await new Promise(resolve => otherPort.close(resolve));
    const other = createTomatoProvider({ binary, port: nextPort, workDir: dir, saveDir: alias });
    try { await assert.rejects(other.create({}).download({ id: 'book:123456' }, { save: async () => {} }), /状态不可用/); }
    finally { await other.stop(); }
    assert.equal(fs.readFileSync(path.join(output, 'created'), 'utf8'), countAfterUnknown);
    selected = '';
    await assert.rejects(provider.search({ keyword: 'x' }), /暂不能切换代理/);
  } finally { if (download) await download.catch(() => {}); await source.stop(); await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); fs.rmSync(dir, { recursive:true, force:true }); }
});

test('EPUB 只接受与目标 book_id 完全一致的内容标识', async () => {
  assert.equal(await epubHasBookId(await epub('123456'), '123456'), true);
  assert.equal(await epubHasBookId(await epub('999999'), '123456'), false);
  assert.equal(await epubHasBookId(Buffer.from('not zip'), '123456'), false);
  const container = '<container><rootfiles><rootfile full-path="OEBPS/real.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
  const opf = id => `<package><metadata><dc:identifier>${id}</dc:identifier></metadata></package>`;
  const forged = await zipEntries([['OEBPS/content.opf', opf('123456')], ['META-INF/container.xml', container], ['OEBPS/real.opf', opf('999999')]]);
  assert.equal(await epubHasBookId(forged, '123456'), false);
  const duplicate = await zipEntries([['META-INF/container.xml', container], ['OEBPS/real.opf', opf('123456')], ['OEBPS/real.opf', opf('999999')]]);
  assert.equal(await epubHasBookId(duplicate, '123456'), false);
  const multi = await zipEntries([['META-INF/container.xml', container.replace('</rootfiles>', '<rootfile full-path="OEBPS/real.opf" media-type="application/oebps-package+xml"/></rootfiles>')], ['OEBPS/real.opf', opf('123456')]]);
  assert.equal(await epubHasBookId(multi, '123456'), false);
});

test('下载器异常退出后重启重新登录，不沿用旧会话', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-tomato-restart-'));
  const binary = path.join(dir, 'downloader');
  fs.writeFileSync(binary, `#!/usr/bin/env node
const http = require('http');
const address = process.env.TOMATO_WEB_ADDR, port = Number(address.split(':').pop()), session = String(process.pid);
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/login') { res.setHeader('Set-Cookie', 'session=' + session + '; HttpOnly'); return res.end('{}'); }
  if (req.headers.cookie !== 'session=' + session) { res.writeHead(401).end('unauthorized'); return; }
  if (url.pathname === '/api/status') { res.setHeader('content-type','application/json'); return res.end(JSON.stringify({bind_addrs:[address]})); }
  if (url.pathname === '/api/search') { res.setHeader('content-type','application/json'); res.end(JSON.stringify({items:[{book_id:'123456',title:session}]})); if (url.searchParams.get('q') === 'exit') setTimeout(() => process.exit(0), 30); return; }
  res.writeHead(404).end();
});
server.listen(port, '127.0.0.1', () => console.log('Web UI listening'));
process.on('SIGINT', () => server.close(() => process.exit(0)));
`); fs.chmodSync(binary, 0o755);
  const held = await reserve(); const port = held.address().port; await new Promise(resolve => held.close(resolve));
  const source = createTomatoProvider({ binary, port, workDir: dir, password: 'local-only' });
  try {
    const provider = source.create({});
    const first = (await provider.search({ keyword: 'exit' })).items[0].title;
    await new Promise(resolve => setTimeout(resolve, 250));
    const second = (await provider.search({ keyword: 'again' })).items[0].title;
    assert.notEqual(first, second);
  } finally { await source.stop(); fs.rmSync(dir, { recursive:true, force:true }); }
});

test('榜单从官方详情结构化数据还原书名，复用所选代理并限制并发', async () => {
  const idList = ['123456', '234567', '345678', '456789'];
  const page = idList.map(id => `<a href="/page/${id}">\uE001混淆标题</a>`).join('') + '<a href="https://evil.example/page/123456">bad</a><a href="/page/123456">重复</a>';
  assert.deepEqual(parseRankPage(page), idList);
  const detail = title => `<script type="application/ld+json">${JSON.stringify({ '@type': 'NewsArticle', headline: `${title}完整版在线免费阅读_${title}小说_番茄小说官网`, author: [{ name: '作者' }] })}</script>`;
  assert.equal(parseRankDetail(detail('书名'), '123456').title, '书名');
  assert.equal(parseRankDetail(detail('\uE001错误'), '123456'), null);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-rank-test-'));
  let active = 0, max = 0, calls = 0, selected = 'http://localhost:8888';
  const source = createTomatoProvider({ binary: '/unused', port: 19002, workDir: dir, rankGet: async (config, url) => {
    calls++; assert.equal(config.proxyUrl, selected); assert.ok(url.startsWith('https://fanqienovel.com/'));
    if (url.endsWith('/rank/1')) return { data: page };
    active++; max = Math.max(max, active); await new Promise(resolve => setTimeout(resolve, 10)); active--;
    const id = url.split('/').pop(); return { data: detail(`作品${id}`) };
  } });
  try {
    const provider = source.create({ get proxyUrl() { return selected; } });
    const [first, second] = await Promise.all([provider.home(), source.create({ get proxyUrl() { return selected; } }).home()]);
    const items = first.items; assert.deepEqual(second.items, items);
    assert.deepEqual(items.map(item => item.id), idList.map(id => `book:${id}`));
    assert.equal(max, 3); await provider.home(); assert.equal(calls, 5);
    selected = ''; await provider.home(); assert.equal(calls, 10);
  } finally { await source.stop(); fs.rmSync(dir, { recursive:true, force:true }); }
});

test('同一输出目录的并发下载跨独立 controller 串行保存', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-tomato-serial-'));
  const book = path.join(dir, 'tomato-output', '123456'); fs.mkdirSync(book, { recursive:true });
  fs.writeFileSync(path.join(book, 'downloaded_chapters.jsonl'), JSON.stringify({ id:'1', title:'章节', content:'正文' }) + '\n');
  const source = createTomatoProvider({ binary:'/unused', port:19003, workDir:dir });
  const copy = fs.mkdtempSync(path.join(process.cwd(), 'tmp', 'tomato-module-copy-'));
  for (const name of ['tomato.js', 'http.js', 'proxy.js']) fs.copyFileSync(path.resolve('res/tasks/domestic-media/providers', name), path.join(copy, name));
  const other = require(path.join(copy, 'tomato.js')).createTomatoProvider({ binary:'/unused', port:19004, workDir:dir });
  let release, firstEntered; const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { firstEntered = resolve; }); const seen = [];
  try {
    const first = source.create({}).download({ id:'chapter:123456:1', title:'一' }, { save: async () => { seen.push('first'); firstEntered(); await gate; } });
    const second = other.create({}).download({ id:'chapter:123456:1', title:'二' }, { save: async () => { seen.push('second'); } });
    await entered; await new Promise(resolve => setTimeout(resolve, 50)); assert.deepEqual(seen, ['first']);
    release(); await Promise.all([first, second]); assert.deepEqual(seen, ['first', 'second']);
  } finally { release(); await source.stop(); await other.stop(); fs.rmSync(dir, { recursive:true, force:true }); fs.rmSync(copy, { recursive:true, force:true }); }
});
