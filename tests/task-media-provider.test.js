'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const TaskIO = require('../src/apps/server/modules/task-engine/task-io');
const TaskManager = require('../src/apps/server/modules/task-engine/task-manager');
const { MediaLibraryManager } = require('../src/apps/web-mediacenter/modules/media/media-library-app-service');
const { TaskMediaProviderRegistry } = require('../src/apps/web-mediacenter/modules/media/task-media-provider-registry');
const { stageTaskCode } = require('../scripts/ops/task-code-package');
const { listOfflineTaskFiles, copyDirectoryWithManifest } = require('../scripts/ops/prepare-android-node-runtime');

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(process.cwd(), 'tmp', 'task-media-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const tasks = path.join(root, 'tasks'); const local = path.join(tasks, 'local-only', 'web-manifest');
    await fs.mkdir(local, { recursive: true });
    await fs.copyFile(path.resolve('res/tasks/local-only/web-manifest/task.js'), path.join(local, 'task.js'));
    return { root, tasks, local };
}

test('本地任务命名空间可列出、运行并读写，不与普通任务混淆', async t => {
    const f = await fixture(t); const io = new TaskIO({ tasksDir: f.tasks, taskCodeCatalog: null });
    const tasks = await io.listTasks();
    assert.deepEqual(tasks.map(x => x.taskName), ['local-only.web-manifest']); assert.equal(tasks[0].localOnly, true);
    assert.equal(io.resolveCodePath('local-only.web-manifest', 'task.js'), path.join(f.local, 'task.js'));
    await assert.rejects(io.deleteTask('local-only'), /不是任务/);
    assert.throws(() => io.resolveCodePath('local-only.../escape', 'task.js'), /无效/);
    await io.setTaskConfig('local-only.web-manifest', { x: 1 });
    assert.deepEqual(await io.getTaskConfig('local-only.web-manifest'), { x: 1 });
});

test('用户服务任务注册媒体源，浏览原始清单、读取 Range、停止与重新启动', async t => {
    const f = await fixture(t); let port;
    const server = http.createServer((req, res) => {
        if (req.url === '/manifest') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ items: [{ name: '教学.mp4', url: `http://127.0.0.1:${port}/video`, mediaType: 'video', size: 5 }] })); return; }
        if (req.url === '/video') { res.writeHead(req.headers.range ? 206 : 200, { 'Content-Type': 'video/mp4', ...(req.headers.range ? { 'Content-Range': 'bytes 1-3/5', 'Content-Length': '3' } : { 'Content-Length': '5' }) }); res.end(req.headers.range ? 'bcd' : 'abcde'); return; }
        res.writeHead(404).end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); port = server.address().port;
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const registry = new TaskMediaProviderRegistry();
    const libraries = new MediaLibraryManager({ configPath: path.join(f.root, 'libraries.json'), taskMediaProviders: registry, getPort: () => 8081, getLocalIP: () => '127.0.0.1' });
    const tasks = new TaskManager({ tasksDir: f.tasks, taskCodeCatalog: null, registerMediaProvider: (owner, provider) => registry.register(owner, provider) });
    await tasks.init();
    const submitted = await tasks.submit({ taskName: 'local-only.web-manifest', taskType: 'user', target: 'server', mode: 'service', entryFile: 'task.js', files: [] });
    await tasks.runInstance(submitted.taskName, submitted.instanceId);
    for (let i = 0; i < 100 && !registry.get('web-manifest'); i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(registry.get('web-manifest'));
    await libraries.addLibraryFromConfig({ id: 'demo', name: '测试', type: 'task', providerId: 'web-manifest', url: `http://127.0.0.1:${port}/manifest` });
    const items = await libraries.list('demo', '/'); assert.equal(items.length, 1); assert.equal(items[0].name, '教学.mp4');
    assert.match(items[0].url, /\/api\/media-libraries\/demo\/proxy\//);
    const result = await libraries.getFileStream('demo', items[0].path, { start: 1, end: 3 });
    assert.equal(result.statusCode, 206); assert.equal((await Array.fromAsync(result.stream)).join(''), 'bcd');
    await tasks.stopInstance(submitted.taskName, submitted.instanceId);
    await assert.rejects(libraries.list('demo', '/'), /任务媒体源未运行/);
    const saved = JSON.parse(await fs.readFile(path.join(f.root, 'libraries.json'), 'utf8'));
    assert.equal(saved.libraries[0].providerId, 'web-manifest'); assert.equal(saved.libraries[0].readonly, true);
    const restarted = new MediaLibraryManager({ configPath: path.join(f.root, 'libraries.json'), taskMediaProviders: registry });
    await restarted.init(); assert.equal(restarted.listLibraries().length, 1);
    await assert.rejects(restarted.list('demo', '/'), /任务媒体源未运行/);
    const again = await tasks.submit({ taskName: 'local-only.web-manifest', taskType: 'user', target: 'server', mode: 'service', entryFile: 'task.js', files: [] });
    await tasks.runInstance(again.taskName, again.instanceId);
    for (let i = 0; i < 100 && !registry.get('web-manifest'); i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal((await restarted.list('demo', '/'))[0].name, '教学.mp4');
    await tasks.stopInstance(again.taskName, again.instanceId);
});

test('本地任务目录不进入离线任务文件和代码包', async t => {
    const f = await fixture(t); await fs.mkdir(path.join(f.tasks, 'normal'), { recursive: true });
    await fs.writeFile(path.join(f.tasks, 'normal', 'task.js'), 'module.exports = {}');
    await fs.symlink('/does-not-exist', path.join(f.local, 'local-link'));
    assert.deepEqual(await listOfflineTaskFiles(f.tasks), [path.join('normal', 'task.js')]);
    const packageRoot = path.join(f.root, 'package'); await fs.mkdir(path.join(packageRoot, 'res', 'tasks'), { recursive: true });
    await fs.cp(path.join(f.tasks, 'local-only'), path.join(packageRoot, 'res', 'tasks', 'local-only'), { recursive: true });
    const files = await copyDirectoryWithManifest(packageRoot, path.join(f.root, 'output'), '', { excludedPrefixes: [path.join('res', 'tasks', 'local-only')] });
    assert.equal(files.length, 0);
    const project = path.join(f.root, 'project'); await fs.mkdir(path.join(project, 'res', 'tasks', 'local-only'), { recursive: true });
    await assert.rejects(stageTaskCode(project, path.join(f.root, 'stage'), 1, { selection: { schemaVersion: 1, tasks: [{ taskName: 'local-only', files: ['task.js'], dependencyRequirement: null, codeRequirement: { minimumVersion: 1, taskCodeApiVersion: 1 } }] } }), /任务名或文件清单无效/);
});

test('服务任务启动期间被停止，晚到的媒体源注册会清理', async t => {
    const f = await fixture(t);
    const code = `module.exports = { mode: 'service', async run(ctx) { await new Promise(r => setTimeout(r, 80)); const unregister = ctx.registerMediaProvider({ id: 'slow-source', create: () => ({}) }); return { stop: async () => unregister() }; } };`;
    await fs.writeFile(path.join(f.local, 'task.js'), code);
    const registry = new TaskMediaProviderRegistry();
    const manager = new TaskManager({ tasksDir: f.tasks, taskCodeCatalog: null, registerMediaProvider: (owner, provider) => registry.register(owner, provider) });
    await manager.init();
    const item = await manager.submit({ taskName: 'local-only.web-manifest', taskType: 'user', target: 'server', mode: 'service', entryFile: 'task.js', files: [] });
    await manager.runInstance(item.taskName, item.instanceId);
    await manager.stopInstance(item.taskName, item.instanceId);
    await new Promise(r => setTimeout(r, 150));
    assert.equal(registry.get('slow-source'), undefined);
    assert.equal((await manager.getInstanceStatus(item.taskName, item.instanceId)).status, 'stopped');
});

test('release 模式仍从本机 res/tasks/local-only 发现任务，不使用 release 目录', async t => {
    const f = await fixture(t);
    const project = path.join(f.root, 'project');
    const localDir = path.join(project, 'res', 'tasks', 'local-only', 'example');
    await fs.mkdir(localDir, { recursive: true }); await fs.writeFile(path.join(localDir, 'task.js'), 'module.exports = {}');
    const beforeRoot = process.env.AASC_PROJECT_ROOT, beforeRelease = process.env.AASC_RELEASE_MODE;
    try {
        process.env.AASC_PROJECT_ROOT = project; process.env.AASC_RELEASE_MODE = '1';
        const io = new TaskIO({ taskCodeCatalog: null });
        assert.equal(io.tasksDir, path.join(project, 'release', 'task'));
        assert.equal(io.resolveCodePath('local-only.example', 'task.js'), path.join(localDir, 'task.js'));
        assert.ok((await io.listTasks()).some(task => task.taskName === 'local-only.example'));
    } finally {
        if (beforeRoot === undefined) delete process.env.AASC_PROJECT_ROOT; else process.env.AASC_PROJECT_ROOT = beforeRoot;
        if (beforeRelease === undefined) delete process.env.AASC_RELEASE_MODE; else process.env.AASC_RELEASE_MODE = beforeRelease;
    }
});

test('运行中的媒体任务自动创建临时媒体库，复用已保存配置且停止后不可访问', async t => {
    const f = await fixture(t);
    const registry = new TaskMediaProviderRegistry();
    const manager = new MediaLibraryManager({ configPath: path.join(f.root, 'libraries.json'), taskMediaProviders: registry });
    const unregister = registry.register('instance-a', { id: 'source-a', name: '媒体来源', defaultConfig: { url: 'https://example.test/' }, create: config => ({
        list: async () => [{ type: 'folder', name: config.url, path: '/folder' }],
        getFile: async () => ({ size: 0 }), getFileStream: async () => ({})
    }) });
    const sources = manager.listTaskMediaSources();
    assert.equal(sources[0].libraryId, 'task-auto:source-a');
    assert.equal((await manager.list(sources[0].libraryId, '/'))[0].name, 'https://example.test/');
    assert.equal(manager.listLibraries().length, 0);
    manager.saveConfig();
    assert.equal(JSON.parse(await fs.readFile(path.join(f.root, 'libraries.json'))).libraries.length, 0);
    await manager.addLibraryFromConfig({ id: 'saved-source', name: '旧媒体库', type: 'task', providerId: 'source-a', url: 'https://saved.test/' });
    assert.equal(manager.listTaskMediaSources()[0].libraryId, 'saved-source');
    assert.equal((await manager.list('saved-source', '/'))[0].name, 'https://saved.test/');
    unregister();
    assert.deepEqual(manager.listTaskMediaSources(), []);
    await assert.rejects(manager.list('task-auto:source-a', '/'), /不存在/);
});
