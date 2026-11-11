'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
    isLoopbackAddress, listDisplayLibraries, normalizeDisplayEntries, createDisplayLocalRouter
} = require('../src/apps/server/modules/media/display-local-media');

test('回环地址判定覆盖 IPv4、IPv6 与 IPv4 映射形式', () => {
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1']) {
        assert.equal(isLoopbackAddress(address), true, address);
    }
    for (const address of ['192.168.1.10', '::ffff:192.168.1.10', '', null, undefined]) {
        assert.equal(isLoopbackAddress(address), false, String(address));
    }
});

test('显示端媒体库列表包含本地库、夸克与活动任务源', () => {
    const manager = {
        listLibraries: () => [
            { id: 'local1', name: '上传', type: 'local', readonly: false },
            { id: 'smb1', name: 'NAS', type: 'smb', readonly: true },
            { id: 'quark1', name: '夸克分享', type: 'quark', readonly: true },
            { id: 'task1', name: '旧任务库', type: 'task', readonly: true }
        ],
        listTaskMediaSources: () => [
            { id: 'hongguo', name: '红果短剧', libraryId: 'task-auto:hongguo', region: 'domestic' },
            { id: 'youtube', name: 'YouTube', libraryId: 'task-auto:youtube', region: 'overseas' }
        ]
    };
    assert.deepEqual(listDisplayLibraries(manager), [
        { id: 'local1', name: '上传', type: 'local', readonly: false },
        { id: 'smb1', name: 'NAS', type: 'smb', readonly: true },
        { id: 'quark1', name: '夸克分享', type: 'quark', readonly: true },
        { id: 'task-auto:hongguo', name: '红果短剧', type: 'task', taskId: 'hongguo', region: 'domestic' },
        { id: 'task-auto:youtube', name: 'YouTube', type: 'task', taskId: 'youtube', region: 'overseas' }
    ]);
});

test('目录条目只保留目录与可播放文件，HTTPS 下绝对 http 地址生成代理地址', () => {
    const entries = normalizeDisplayEntries([
        { name: '合集', path: '/合集', type: 'folder' },
        { name: 'a.mp4', path: '/合集/a.mp4', type: 'file', mediaType: 'video', url: 'http://192.168.1.12:8081/api/media-libraries/l/proxy/a.mp4' },
        { name: 'b.gif', path: '/合集/b.gif', type: 'file', mediaType: 'gif', url: '/uploads/b.gif' },
        { name: 'c.html', path: '/合集/c.html', type: 'file', mediaType: 'html', url: '/uploads/c.html' },
        { name: 'd.txt', path: '/合集/d.txt', type: 'file', mediaType: 'text', url: '/uploads/d.txt' }
    ], { isHttps: true });
    assert.deepEqual(entries.map(item => item.path), ['/合集', '/合集/a.mp4', '/合集/b.gif', '/合集/d.txt']);
    assert.deepEqual(entries[1], {
        name: 'a.mp4', path: '/合集/a.mp4', type: 'file', mediaType: 'video',
        directUrl: 'http://192.168.1.12:8081/api/media-libraries/l/proxy/a.mp4',
        proxyUrl: '/api/media-proxy?url=' + encodeURIComponent('http://192.168.1.12:8081/api/media-libraries/l/proxy/a.mp4')
    });
    assert.equal(entries[2].mediaType, 'image');
    assert.equal(entries[2].proxyUrl, '');
    assert.equal(entries[3].proxyUrl, '');
});

test('非回环访问 /api/display-local 一律 403', async t => {
    const app = express();
    app.use('/api/display-local', createDisplayLocalRouter({
        mediaLibraryManager: { listLibraries: () => [], listTaskMediaSources: () => [], list: async () => [] },
        isHttps: () => false,
        getRemoteAddress: () => '192.168.1.20'
    }));
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const url = `http://127.0.0.1:${server.address().port}/api/display-local/libraries`;
    const response = await fetch(url);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: '仅限本机访问' });
});

test('回环访问返回库列表、目录条目与上级路径', async t => {
    const manager = {
        listLibraries: () => [{ id: 'local1', name: '上传', type: 'local', readonly: false }],
        listTaskMediaSources: () => [],
        list: async (libraryId, dirPath) => {
            assert.equal(libraryId, 'local1');
            assert.equal(dirPath, '/电影');
            return [
                { name: '合集A', path: '/电影/合集A', type: 'folder' },
                { name: 'a.mp4', path: '/电影/a.mp4', type: 'file', mediaType: 'video', url: '/uploads/a.mp4' }
            ];
        }
    };
    const app = express();
    app.use('/api/display-local', createDisplayLocalRouter({
        mediaLibraryManager: manager,
        isHttps: () => false,
        getRemoteAddress: () => '::1'
    }));
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const base = `http://127.0.0.1:${server.address().port}/api/display-local`;
    const libraries = await (await fetch(`${base}/libraries`)).json();
    assert.deepEqual(libraries.libraries, [{ id: 'local1', name: '上传', type: 'local', readonly: false }]);
    const listing = await (await fetch(`${base}/list?libraryId=local1&path=${encodeURIComponent('/电影')}`)).json();
    assert.equal(listing.path, '/电影');
    assert.equal(listing.parent, '/');
    assert.deepEqual(listing.entries.map(item => item.type), ['directory', 'file']);
    const missing = await fetch(`${base}/list?libraryId=missing&path=/`);
    assert.equal(missing.status, 400);
});

// 使用真实媒体管理器、磁盘目录及生产任务运行器，覆盖 HTTP 返回与任务生命周期。
test('真实目录与服务任务通过显示端接口浏览，停止任务返回可识别状态', async t => {
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const { MediaLibraryManager } = require('../src/apps/web-mediacenter/modules/media/media-library-app-service');
    const TaskManager = require('../src/apps/server/modules/task-engine/task-manager');
    await fs.mkdir(path.join(process.cwd(), 'tmp'), { recursive: true });
    const root = await fs.mkdtemp(path.join(process.cwd(), 'tmp', 'aasc-display-library-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const local = path.join(root, 'media');
    await fs.mkdir(path.join(local, '电影'), { recursive: true });
    await fs.writeFile(path.join(local, '电影', '测试.mp4'), 'video');
    await fs.writeFile(path.join(local, '电影', '屏蔽.html'), '<html></html>');
    const manager = new MediaLibraryManager({ configPath: path.join(root, 'libraries.json'), getLocalIP: () => '192.168.1.10', isHttps: () => true });
    await manager.addLibraryFromConfig({ id: 'local', name: '本地', type: 'local', path: local });
    const app = express();
    app.set('trust proxy', true);
    app.get('/manifest', (req, res) => res.json({ items: [{ name: '任务.mp4', url: `${base}/video`, mediaType: 'video', size: 5 }] }));
    app.get('/http/', (req, res) => res.type('html').send('<a href="a.mp4">a.mp4</a>'));
    app.get('/http/a.mp4', (req, res) => res.type('video/mp4').send('http-video'));
    app.get('/video', (req, res) => {
        res.status(req.headers.range ? 206 : 200);
        if (req.headers.range) res.set('Content-Range', 'bytes 1-3/5');
        res.type('video/mp4').send(req.headers.range ? 'bcd' : 'abcde');
    });
    for (const route of manager.getLocalLibraryRoutes()) app.use(route.routePrefix, express.static(route.basePath));
    // 加载生产入口中原样的媒体代理路由，避免测试替代接口掩盖真实路径/Range 兼容问题。
    const serverSource = await fs.readFile(path.resolve('src/apps/server/boot/server-app.js'), 'utf8');
    const routeStart = serverSource.indexOf("app.get('/api/media-libraries/:id/proxy/*'");
    const routeEnd = serverSource.indexOf('\n// 通用 HTTPS 媒体代理', routeStart);
    require('node:vm').runInNewContext(serverSource.slice(routeStart, routeEnd), {
        app, mediaLibraryManager: manager, AASC_MAIN_NODE_ID: 'main', quarkDirectoryDownloads: {},
        serveQuarkDirectoryDownload: async () => false
    });
    app.use('/api/display-local', createDisplayLocalRouter({ mediaLibraryManager: manager, isHttps: () => true }));
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const base = `http://127.0.0.1:${server.address().port}`;
    const https = require('node:https');
    const tlsServer = https.createServer({ key: await fs.readFile('res/certs/key.pem'), cert: await fs.readFile('res/certs/cert.pem') }, app);
    await new Promise(resolve => tlsServer.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { tlsServer.closeAllConnections(); tlsServer.close(resolve); }));
    const tlsBase = `https://127.0.0.1:${tlsServer.address().port}`;
    const read = (url, headers = {}) => new Promise((resolve, reject) => {
        const request = https.get(`${tlsBase}${url}`, { rejectUnauthorized: false, headers }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString() }));
        });
        request.on('error', reject);
    });
    const get = async suffix => {
        const response = await read(`/api/display-local/${suffix}`);
        return { status: response.status, body: JSON.parse(response.text) };
    };
    await manager.addLibraryFromConfig({ id: 'http', name: 'HTTP', type: 'http', url: `${base}/http` });
    t.after(() => manager.getLibrary('http').provider.disconnect());
    const httpListing = await get('list?libraryId=http');
    assert.equal(httpListing.status, 200);
    assert.match((await manager.list('http', '/'))[0].url, /^https:\/\/192\.168\.1\.10:/);
    const httpEntry = httpListing.body.entries[0];
    assert.equal(httpEntry.directUrl, '/api/media-libraries/http/proxy/a.mp4');
    const httpPlayed = await read(httpEntry.proxyUrl || httpEntry.directUrl);
    assert.equal(httpPlayed.status, 200, httpPlayed.text);
    assert.equal(httpPlayed.text, 'http-video');
    const listing = await get(`list?libraryId=local&path=${encodeURIComponent('/电影')}`);
    assert.equal(listing.status, 200);
    assert.deepEqual(listing.body.entries.map(item => item.name), ['测试.mp4']);
    assert.equal(listing.body.entries[0].directUrl, '/media/local/%E7%94%B5%E5%BD%B1/%E6%B5%8B%E8%AF%95.mp4');
    assert.equal(listing.body.entries[0].proxyUrl, '');
    assert.equal((await read(listing.body.entries[0].directUrl)).text, 'video');
    const taskRoot = path.join(root, 'tasks');
    const taskCode = path.join(taskRoot, 'local-only', 'web-manifest');
    await fs.mkdir(taskCode, { recursive: true });
    await fs.copyFile(path.resolve('res/tasks/local-only/web-manifest/task.js'), path.join(taskCode, 'task.js'));
    const tasks = new TaskManager({ tasksDir: taskRoot, taskCodeCatalog: null,
        registerMediaProvider: (owner, provider) => manager.taskMediaProviders.register(owner, provider) });
    const taskErrors = [];
    tasks.on('log', (id, stage, level, message) => { if (level === 'error') taskErrors.push(message); });
    await tasks.init();
    const submitted = await tasks.submit({ taskName: 'local-only.web-manifest', taskType: 'user', target: 'server', mode: 'service', entryFile: 'task.js', files: [] });
    t.after(() => tasks.stopInstance(submitted.taskName, submitted.instanceId));
    await tasks.runInstance(submitted.taskName, submitted.instanceId);
    for (let i = 0; i < 100 && !manager.taskMediaProviders.get('web-manifest'); i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(manager.taskMediaProviders.get('web-manifest'), taskErrors.join('; '));
    await manager.addLibraryFromConfig({ id: 'saved-task', name: '保存的任务', type: 'task', providerId: 'web-manifest', url: `${base}/manifest` });
    const libraries = await get('libraries');
    assert.deepEqual(libraries.body.libraries.map(item => item.id), ['local', 'http', 'saved-task']);
    const taskListing = await get('list?libraryId=saved-task');
    assert.equal(taskListing.status, 200);
    assert.equal(taskListing.body.entries[0].name, '任务.mp4');
    const taskEntry = taskListing.body.entries[0];
    assert.match((await manager.list('saved-task', '/'))[0].url, /^https:\/\/192\.168\.1\.10:/);
    assert.match(taskEntry.directUrl, /^\/api\/media-libraries\/saved-task\/proxy\//);
    const played = await read(taskEntry.proxyUrl || taskEntry.directUrl);
    assert.equal(played.status, 200, played.text);
    assert.equal(played.text, 'abcde');
    const ranged = await read(taskEntry.proxyUrl || taskEntry.directUrl, { Range: 'bytes=1-3' });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.text, 'bcd');
    assert.equal(ranged.headers['content-range'], 'bytes 1-3/5');
    await tasks.stopInstance(submitted.taskName, submitted.instanceId);
    assert.deepEqual((await get('libraries')).body.libraries.map(item => item.id), ['local', 'http']);
    for (const id of ['saved-task', 'task-auto:web-manifest']) {
        const stopped = await get(`list?libraryId=${encodeURIComponent(id)}`);
        assert.equal(stopped.status, 410);
        assert.deepEqual(stopped.body, { code: 'TASK_SOURCE_STOPPED', error: '任务媒体源已停止' });
    }
});

test('真实非回环连接即使伪造转发头仍被拒绝', async t => {
    const os = require('node:os');
    const address = Object.values(os.networkInterfaces()).flat().find(item => item.family === 'IPv4' && !item.internal)?.address;
    if (!address) return t.skip('无非回环 IPv4 网卡');
    const app = express();
    app.set('trust proxy', true);
    app.use('/api/display-local', createDisplayLocalRouter({ mediaLibraryManager: {
        listLibraries: () => { throw new Error('拒绝访问不应读取数据'); }
    } }));
    const server = await new Promise(resolve => { const instance = app.listen(0, '0.0.0.0', () => resolve(instance)); });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    for (const route of ['libraries', 'list?libraryId=local', 'unknown']) {
        const response = await fetch(`http://${address}:${server.address().port}/api/display-local/${route}`, {
            headers: { 'X-Forwarded-For': '127.0.0.1', Forwarded: 'for=127.0.0.1' }
        });
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), { error: '仅限本机访问' });
    }
});

test('目录查询失败不泄露内部错误，任务在查询期间停止返回 410', async t => {
    let running = true;
    const manager = {
        listLibraries: () => [{ id: 'local', type: 'local', name: '本地' }],
        listTaskMediaSources: () => running ? [{ id: 'task-a', libraryId: 'task-auto:task-a', name: '任务' }] : [],
        list: async id => {
            if (id === 'local') throw new Error('secret local filesystem path');
            running = false;
            return [];
        }
    };
    const app = express();
    app.use('/api/display-local', createDisplayLocalRouter({ mediaLibraryManager: manager }));
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const base = `http://127.0.0.1:${server.address().port}/api/display-local/list?libraryId=`;
    const failed = await fetch(`${base}local`);
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), { error: '媒体库加载失败，请稍后重试' });
    const stopped = await fetch(`${base}task-auto:task-a`);
    assert.equal(stopped.status, 410);
    assert.equal((await stopped.json()).code, 'TASK_SOURCE_STOPPED');
});

test('外部 HTTP(S) 媒体 URL 复用既有通用代理，不把远端路径误当本机资源', () => {
    for (const url of ['http://media.example/video.mp4', 'https://media.example/video.mp4']) {
        const [entry] = normalizeDisplayEntries([{ name: 'video', path: '/video', type: 'file', mediaType: 'video', url }], { isHttps: true });
        assert.equal(entry.directUrl, url);
        assert.equal(entry.proxyUrl, `/api/media-proxy?url=${encodeURIComponent(url)}`);
    }
});

test('真实 SMB 提供器的 HTTP/HTTPS LAN 地址均转换为已有同源库路由', async t => {
    const { SmbProvider } = require('../src/apps/web-mediacenter/modules/media/media-library-app-service');
    let secure = false;
    const provider = new SmbProvider({ id: 'smb', server: '192.168.1.20', share: 'media' }, {
        getLocalIP: () => '192.168.1.10', getPort: () => 8081, isHttps: () => secure
    });
    // 不要求可用的 SMB 服务器；此单元测试仅验证生产 URL 生成与接口转换契约。
    const manager = {
        listLibraries: () => [{ id: 'smb', name: 'NAS', type: 'smb' }],
        listTaskMediaSources: () => [],
        list: async () => [{ name: '测试.mp4', path: '/合集/测试.mp4', type: 'file', mediaType: 'video', url: provider.getPublicUrl('/合集/测试.mp4') }]
    };
    const app = express();
    app.use('/api/display-local', createDisplayLocalRouter({ mediaLibraryManager: manager, isHttps: () => secure }));
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    for (const value of [false, true]) {
        secure = value;
        assert.ok(provider.getPublicUrl('/合集/测试.mp4').startsWith(secure ? 'https://' : 'http://'));
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/display-local/list?libraryId=smb`);
        assert.equal(response.status, 200);
        const [entry] = (await response.json()).entries;
        assert.equal(entry.directUrl, '/api/media-libraries/smb/proxy/%E5%90%88%E9%9B%86/%E6%B5%8B%E8%AF%95.mp4');
        assert.equal(entry.proxyUrl, '');
    }
});
