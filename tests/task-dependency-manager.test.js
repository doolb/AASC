'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { test } = require('node:test');
const { fixture, write } = require('./helpers/shared-update-fixture');
const shared = require('../src/apps/server/modules/aasc/shared-update-manifest');
const archive = require('../src/apps/server/modules/aasc/update-archive');
const { deterministicZip, buildDependencyGroups } = require('../scripts/ops/dependency-groups');
const { TaskDependencyManager } = require('../src/apps/server/modules/aasc/task-dependency-manager');

/** 夹具使用真实签名、ZIP和内容SHA，网络仅使用本机HTTP或明确注入的文件复制。 */
async function taskFixture(t, extraFiles = {}) {
    const f = await fixture(t);
    const lock = JSON.parse(f.lock);
    lock.packages[''].optionalDependencies = { 'onnxruntime-web': '^1.26.0' };
    lock.packages['node_modules/onnxruntime-web'] = { version: '1.26.0', optional: true };
    write(f.source, 'package-lock.json', JSON.stringify(lock));
    write(f.source, 'package.json', JSON.stringify({ dependencies: { express: '4.21.2' }, optionalDependencies: { 'onnxruntime-web': '^1.26.0' } }));
    f.manifest.payload.components.code.requiredLockSha256 = shared.hash(JSON.stringify(lock));
    f.manifest.payload.components.dependencies.lockSha256 = shared.hash(JSON.stringify(lock));
    f.makeCode();
    const directory = path.join(f.root, 'task-layer');
    write(directory, 'node_modules/onnxruntime-web/package.json', '{"name":"onnxruntime-web","version":"1.26.0"}');
    write(directory, 'node_modules/onnxruntime-web/dist/ort.webgpu.min.js', 'window.ort = {};');
    write(directory, 'node_modules/onnxruntime-web/dist/test.wasm', Buffer.alloc(256, 4));
    for (const [name, value] of Object.entries(extraFiles)) write(directory, name, value);
    const contentSha256 = await archive.contentHash(path.join(directory, 'node_modules'));
    const metadata = { group: 'task-onnxruntime-web', version: 1, contentSha256, target: null,
        packageName: 'onnxruntime-web', packageVersion: '1.26.0' };
    write(directory, 'dependency-group.json', JSON.stringify(metadata));
    const relativeUrl = 'dependencies/task-onnxruntime-web/dependencies-v1.zip';
    const zip = path.join(f.published, relativeUrl);
    fs.mkdirSync(path.dirname(zip), { recursive: true });
    await deterministicZip(directory, zip);
    const entry = { ...metadata, relativeUrl, size: fs.statSync(zip).size, sha256: await archive.hashFile(zip) };
    delete entry.group;
    f.manifest.payload.components.taskDependencies = { 'onnxruntime-web': entry };
    await f.sign();
    let requests = 0;
    let downloads = 0;
    const options = { projectRoot: f.root, codeRoot: f.source, publicKeyPem: f.publicKeyPem,
        baseUrls: ['http://fixture.test/'], requestJson: async () => { requests++; return f.manifest; },
        download: async (url, target) => { downloads++; await fs.promises.copyFile(zip, target); } };
    return { ...f, entry, zip, directory, options, counts: () => ({ requests, downloads }) };
}

test('任务首次准备并发去重；缓存独立于基础树，重启后无网络复用并验证内容', async t => {
    const f = await taskFixture(t);
    const manager = new TaskDependencyManager(f.options);
    assert.equal(manager.assetDirectory('onnxruntime-web'), null);
    const progress = [];
    await Promise.all([manager.ensure(['onnxruntime-web'], event => progress.push(event)), manager.ensure(['onnxruntime-web'])]);
    assert.deepEqual(f.counts(), { requests: 1, downloads: 1 });
    assert.ok(progress.some(event => event.percent === 100));
    assert.equal(fs.existsSync(path.join(f.root, 'node_modules/onnxruntime-web')), false);
    const assets = manager.assetDirectory('onnxruntime-web');
    assert.equal(fs.readFileSync(path.join(assets, 'ort.webgpu.min.js'), 'utf8'), 'window.ort = {};');
    const restarted = new TaskDependencyManager({ ...f.options, requestJson: async () => { throw new Error('禁止联网'); } });
    await restarted.ensure(['onnxruntime-web']);
    assert.equal(restarted.assetDirectory('onnxruntime-web'), assets);
    fs.appendFileSync(path.join(assets, 'ort.webgpu.min.js'), 'tampered');
    await assert.rejects(restarted.ensure(['onnxruntime-web']), /内容指纹/);
    assert.equal(restarted.assetDirectory('onnxruntime-web'), null);
});

test('本机npm已有正确版本时不下载，版本不符时使用独立正确版本', async t => {
    const f = await taskFixture(t);
    write(f.root, 'node_modules/onnxruntime-web/package.json', '{"name":"onnxruntime-web","version":"1.26.0"}');
    write(f.root, 'node_modules/onnxruntime-web/dist/ort.webgpu.min.js', 'local runtime');
    const manager = new TaskDependencyManager(f.options);
    await manager.ensure(['onnxruntime-web']);
    assert.deepEqual(f.counts(), { requests: 0, downloads: 0 });
    write(f.root, 'node_modules/onnxruntime-web/package.json', '{"name":"onnxruntime-web","version":"1.25.0"}');
    await manager.ensure(['onnxruntime-web']);
    assert.deepEqual(f.counts(), { requests: 1, downloads: 1 });
    assert.ok(manager.assetDirectory('onnxruntime-web').includes('updates/task-dependencies'));
});

test('HTTP真实传输校验ZIP；摘要失败不激活，清理暂存后可重试', async t => {
    const f = await taskFixture(t);
    let broken = true;
    const server = http.createServer((req, res) => {
        if (req.url === '/manifest.json') { res.end(JSON.stringify(f.manifest)); return; }
        if (broken) { res.end('bad zip'); return; }
        fs.createReadStream(f.zip).pipe(res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const manager = new TaskDependencyManager({ ...f.options, requestJson: undefined, download: undefined,
        baseUrls: [`http://127.0.0.1:${server.address().port}/`] });
    await assert.rejects(manager.ensure(['onnxruntime-web']), /大小\/SHA-256/);
    assert.equal(manager.assetDirectory('onnxruntime-web'), null);
    const cache = path.join(f.root, 'updates/task-dependencies/onnxruntime-web');
    assert.deepEqual(fs.readdirSync(cache), []);
    broken = false;
    await manager.ensure(['onnxruntime-web']);
    assert.ok(manager.assetDirectory('onnxruntime-web'));
});

test('签名篡改、锁版本不符、未注册ID都拒绝且不下载', async t => {
    const f = await taskFixture(t);
    const manager = new TaskDependencyManager(f.options);
    await assert.rejects(manager.ensure(['constructor']), /未注册/);
    f.entry.packageVersion = '1.25.0';
    await assert.rejects(manager.ensure(['onnxruntime-web']), /签名验证失败/);
    await f.sign();
    await assert.rejects(manager.ensure(['onnxruntime-web']), /兼容/);
    assert.equal(f.counts().downloads, 0);
});

test('签名ZIP夹带其他生产包或元数据不一致时拒绝激活', async t => {
    const f = await taskFixture(t, { 'node_modules/other/package.json': '{}' });
    const manager = new TaskDependencyManager(f.options);
    await assert.rejects(manager.ensure(['onnxruntime-web']), /其他生产包/);
    assert.equal(manager.assetDirectory('onnxruntime-web'), null);
    assert.deepEqual(fs.readdirSync(path.join(f.root, 'updates/task-dependencies/onnxruntime-web')), []);
});

test('签名包内组元数据不符或缓存出现符号链接时拒绝复用', async t => {
    const f = await taskFixture(t);
    const metadataFile = path.join(f.directory, 'dependency-group.json');
    const metadata = JSON.parse(fs.readFileSync(metadataFile));
    metadata.group = 'common'; fs.writeFileSync(metadataFile, JSON.stringify(metadata));
    fs.unlinkSync(f.zip); await deterministicZip(f.directory, f.zip);
    f.entry.size = fs.statSync(f.zip).size; f.entry.sha256 = await archive.hashFile(f.zip); await f.sign();
    const manager = new TaskDependencyManager(f.options);
    await assert.rejects(manager.ensure(['onnxruntime-web']), /元数据/);
    metadata.group = 'task-onnxruntime-web'; fs.writeFileSync(metadataFile, JSON.stringify(metadata));
    fs.unlinkSync(f.zip); await deterministicZip(f.directory, f.zip);
    f.entry.size = fs.statSync(f.zip).size; f.entry.sha256 = await archive.hashFile(f.zip); await f.sign();
    await manager.ensure(['onnxruntime-web']);
    const script = path.join(manager.assetDirectory('onnxruntime-web'), 'ort.webgpu.min.js');
    const outside = path.join(f.root, 'outside-keep'); fs.writeFileSync(outside, 'keep');
    fs.unlinkSync(script); fs.symlinkSync(outside, script);
    await assert.rejects(manager.ensure(['onnxruntime-web']), /链接/);
    assert.equal(fs.readFileSync(outside, 'utf8'), 'keep');
});

test('基础common排除ORT，独立包三平台一致并复用独立版本', async t => {
    const f = await taskFixture(t);
    const commandRunner = async (file, args, options) => {
        write(options.cwd, 'node_modules/express/package.json', '{"version":"4.21.2"}');
        write(options.cwd, 'node_modules/express/index.js', 'base JS');
        await archive.mergeTree(path.join(f.directory, 'node_modules'), path.join(options.cwd, 'node_modules'));
    };
    const options = { projectRoot: f.source, outputDir: f.published, workDirectory: path.join(f.root, 'build1'),
        dependencyVersion: 2, lockSha256: shared.hash(fs.readFileSync(path.join(f.source, 'package-lock.json'))), source: {}, commandRunner };
    const built = await buildDependencyGroups(options);
    assert.deepEqual(Object.keys(built.dependencies.groups), shared.GROUPS);
    assert.deepEqual(Object.keys(built.taskDependencies), ['onnxruntime-web']);
    for (const artifact of built.artifacts) {
        const name = artifact.relativeUrl.split('/')[1];
        const folder = path.join(f.root, `expanded-${name}`);
        await archive.extractZip(artifact.archivePath, folder, 'dependencies');
        assert.equal(fs.existsSync(path.join(folder, 'node_modules/onnxruntime-web')), name === 'task-onnxruntime-web');
        const output = path.join(f.published, artifact.relativeUrl);
        fs.mkdirSync(path.dirname(output), { recursive: true }); fs.copyFileSync(artifact.archivePath, output);
    }
    const again = await buildDependencyGroups({ ...options, workDirectory: path.join(f.root, 'build2'), dependencyVersion: 3,
        currentDependencies: built.dependencies, currentTaskDependencies: built.taskDependencies });
    assert.deepEqual(again.taskDependencies, built.taskDependencies);
    assert.equal(again.artifacts.length, 0);
});

test('publish/sync包含独立包；code-only验证保留包，清理只删除严格数字旧版本', async t => {
    const f = await taskFixture(t);
    const publish = require('../scripts/ops/publish-offline-update');
    const sync = require('../scripts/ops/sync-offline-update');
    assert.equal(publish.getPublishComponents(f.manifest, 'all').length, 6);
    assert.equal(sync.selectSyncComponents(f.manifest).length, 6);
    const target = path.join(f.root, 'target');
    const options = { artifactRoot: f.published, manifestPath: path.join(f.published, 'manifest.json'), publicKeyPem: f.publicKeyPem, localRoot: target };
    await publish.publishOfflineUpdate({ ...options, mode: 'all' });
    write(target, 'dependencies/task-onnxruntime-web/dependencies-v0.zip', 'old');
    write(target, 'dependencies/task-onnxruntime-web/dependencies-vcustom.zip', 'keep');
    const cleaned = await publish.cleanupLocalPublishedArtifacts(target, f.manifest);
    assert.ok(cleaned.removedRelativePaths.includes('dependencies/task-onnxruntime-web/dependencies-v0.zip'));
    assert.ok(fs.existsSync(path.join(target, 'dependencies/task-onnxruntime-web/dependencies-vcustom.zip')));
    await publish.publishOfflineUpdate({ ...options, mode: 'code-only' });
    fs.unlinkSync(path.join(target, f.entry.relativeUrl));
    await assert.rejects(publish.publishOfflineUpdate({ ...options, mode: 'code-only' }), /已有匹配资源/);
});

test('发布服务流式分发任务包并拒绝过期ID；HTTP验收包含任务包SHA', async t => {
    const f = await taskFixture(t);
    const { ServerReleaseService } = require('../src/apps/server/modules/aasc/server-release-service');
    const service = new ServerReleaseService({ releaseRoot: f.published, publicKeyPem: f.publicKeyPem });
    assert.deepEqual(await service.getManifest(), f.manifest);
    const { Writable } = require('node:stream'); const chunks = [];
    const response = new Writable({ write(chunk, encoding, done) { chunks.push(chunk); done(); } }); response.setHeader = () => {};
    await service.streamPackage(response, { version: f.entry.version, sha256: f.entry.sha256 }, null, 'onnxruntime-web');
    assert.deepEqual(Buffer.concat(chunks), fs.readFileSync(f.zip));
    await assert.rejects(service.streamPackage({}, {}, null, 'other'), /未知任务依赖/);
    await assert.rejects(service.streamPackage({}, { version: 0 }, null, 'onnxruntime-web'), { statusCode: 409 });
    let broken = false;
    const server = http.createServer((req, res) => {
        if (req.url === '/manifest.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(f.manifest)); return; }
        if (broken && req.url.includes('/task-onnxruntime-web/')) { res.end('bad'); return; }
        fs.createReadStream(path.join(f.published, req.url.slice(1))).pipe(res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const { verifyHttpTarget } = require('../scripts/ops/publish-offline-update');
    const url = `http://127.0.0.1:${server.address().port}/`;
    await verifyHttpTarget(url, f.manifest, f.publicKeyPem);
    broken = true;
    await assert.rejects(verifyHttpTarget(url, f.manifest, f.publicKeyPem), /taskDependencies.*SHA-256/);
});

test('TaskManager等待依赖再转发，停止等待实例不会被派发或被失败覆盖', async t => {
    const f = await taskFixture(t);
    const TaskManager = require('../src/apps/server/modules/task-engine/task-manager');
    let finish;
    let started;
    const begun = new Promise(resolve => { started = resolve; });
    const manager = new TaskManager({ tasksDir: path.join(f.root, 'tasks'), serverExecutionDisabled: true,
        ensureTaskDependencies: async (ids, progress) => {
            assert.deepEqual(ids, ['onnxruntime-web']); progress({ percent: 10, message: '下载中' }); started();
            await new Promise(resolve => { finish = resolve; });
        } });
    const messages = [];
    manager.setSendToDisplay((id, message) => { messages.push(message); return true; });
    const draft = await manager.submit({ taskName: 'model.inference', taskType: 'builtin', builtinId: 'model.inference',
        target: 'display', displayId: 'display-a', params: { _serverImage: '/input.jpg' } });
    const running = manager.runInstance(draft.taskName, draft.instanceId);
    await begun;
    assert.equal(messages.length, 0);
    await manager.stopInstance(draft.taskName, draft.instanceId);
    finish();
    assert.equal((await running).status, 'stopped');
    assert.equal(messages.filter(message => message.type === 'task:execute').length, 0);
    assert.equal((await manager.getInstanceStatus(draft.taskName, draft.instanceId)).status, 'stopped');
    const next = await manager.submit({ taskName: 'model.inference', taskType: 'builtin', builtinId: 'model.inference',
        target: 'display', displayId: 'display-a', params: { _serverImage: '/input.jpg' } });
    manager._ensureTaskDependencies = async () => {};
    assert.equal((await manager.runInstance(next.taskName, next.instanceId)).status, 'pending_forward');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(messages.filter(message => message.type === 'task:execute').length, 1);
});

test('ORT脚本只在任务加载时请求，同页去重、失败后重试并固定WASM同源目录', async () => {
    const scripts = [];
    const sandbox = { window: { location: { href: 'https://local.test/display' } }, URL, setTimeout, clearTimeout,
        document: { createElement: () => ({ remove() {} }), head: { appendChild(script) { scripts.push(script); } } } };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/task-onnx-runtime.js'), 'utf8'), sandbox);
    assert.equal(scripts.length, 0);
    const failed = sandbox.window.TaskOnnxRuntime.load();
    scripts[0].onerror(); await assert.rejects(failed, /加载失败/);
    const first = sandbox.window.TaskOnnxRuntime.load();
    const second = sandbox.window.TaskOnnxRuntime.load();
    assert.equal(scripts.length, 2);
    assert.equal(scripts[1].src, '/js/lib/ort.webgpu.min.js');
    sandbox.window.ort = { InferenceSession: {}, env: { wasm: {} } };
    scripts[1].onload();
    assert.equal(await first, await second);
    assert.equal(sandbox.window.ort.env.wasm.wasmPaths, 'https://local.test/js/lib/');
    const page = fs.readFileSync(path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/display.html'), 'utf8');
    assert.equal(/<script[^>]+src="\/js\/lib\/ort/.test(page), false);
});
