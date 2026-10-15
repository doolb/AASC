'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const contract = require('../src/apps/server/modules/aasc/task-code-contract');
const { stageTaskCode } = require('../scripts/ops/task-code-package');
const { TaskCodeCatalog } = require('../src/apps/server/modules/task-engine/task-code-catalog');
const TaskIO = require('../src/apps/server/modules/task-engine/task-io');
const NodeJsRunner = require('../src/apps/server/modules/task-engine/nodejs-runner');
const packaging = require('../scripts/ops/offline-update-package');
const shared = require('../src/apps/server/modules/aasc/shared-update-manifest');
const publishing = require('../scripts/ops/publish-offline-update');
const syncing = require('../scripts/ops/sync-offline-update');
const TaskManager = require('../src/apps/server/modules/task-engine/task-manager');
const LOCK = 'a'.repeat(64);

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-task-code-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const source = path.join(root, 'res/tasks/demo');
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(path.join(source, 'task.js'), 'exports.run = async ctx => ({ cwd: process.cwd(), workDir: ctx.workDir, value: require("./helper.js") });');
    await fs.writeFile(path.join(source, 'helper.js'), 'module.exports = 42;');
    await fs.writeFile(path.join(source, 'config.json'), '{"secret":"keep"}');
    await fs.mkdir(path.join(source, 'results'), { recursive: true });
    await fs.writeFile(path.join(source, 'results/keep.txt'), 'user data');
    const selection = { schemaVersion: 1, requiredApkVersionCode: 58, retiredTaskNames: ['old-demo'], tasks: [{
        taskName: 'demo', files: ['task.js', 'helper.js'],
        codeRequirement: { minimumVersion: 96, maximumVersion: 100, taskCodeApiVersion: 1 },
        dependencyRequirement: { version: 10, lockSha256: LOCK }
    }] };
    const staging = path.join(root, 'updates/task-code/task-code-v1');
    const manifest = await stageTaskCode(root, staging, 1, { selection });
    const context = { version: 1, sha256: 'b'.repeat(64), path: staging, codeVersion: 96, dependencyVersion: 10, lockSha256: LOCK };
    await fs.writeFile(path.join(staging, '.offline-update-verified.json'), JSON.stringify({ kind: 'taskCode', version: 1, sha256: context.sha256 }));
    const catalog = new TaskCodeCatalog(context, { projectRoot: root, apkVersionCode: 58 });
    return { root, source, selection, staging, manifest, context, catalog };
}

test('白名单只生成代码、revision和聚合依赖，种子/数据不入包', async t => {
    const f = await fixture(t);
    assert.deepEqual((await fs.readdir(path.join(f.staging, 'tasks/demo'))).sort(), ['helper.js', 'task.js']);
    assert.equal(f.manifest.requiredCodeVersion, 96);
    assert.equal(f.manifest.requiredDependencyVersion, 10);
    assert.equal(f.manifest.bundleSha256, contract.bundleHash(f.manifest));
    assert.deepEqual(contract.validateManifest(f.manifest), f.manifest);
    assert.equal(await fs.readFile(path.join(f.source, 'results/keep.txt'), 'utf8'), 'user data');
});

test('服务版本区间/API和精确依赖双重门控', async t => {
    const { manifest } = await fixture(t);
    const code = { version: 96, taskCodeApiVersion: 1, requiredDependencyVersion: 10, requiredLockSha256: LOCK };
    const dependencies = { version: 10, lockSha256: LOCK };
    contract.assertCombination(manifest, code, dependencies, 58);
    for (const invalid of [{ version: 95 }, { version: 101 }, { taskCodeApiVersion: 2 }]) {
        assert.throws(() => contract.assertCombination(manifest, { ...code, ...invalid }, dependencies, 58));
    }
    assert.throws(() => contract.assertCombination(manifest, code, { version: 11, lockSha256: LOCK }, 58));
    assert.throws(() => contract.assertCombination(manifest, code, dependencies, 57));
    const task = manifest.tasks[0];
    assert.throws(() => contract.aggregateRequirements([task, { ...task, codeRequirement: { minimumVersion: 101, taskCodeApiVersion: 1 } }]));
    assert.throws(() => contract.aggregateRequirements([task, { ...task, dependencyRequirement: { version: 11, lockSha256: LOCK } }]));
    assert.throws(() => contract.aggregateRequirements([{ ...task, dependencyRequirement: undefined }]));
});

test('遍历、测试文件、符号链接和额外文件拒绝，受管缺失文件不回退', async t => {
    const f = await fixture(t);
    for (const value of ['../task.js', '/task.js', 'a/../../task.js', 'results/task.js', 'render.smoke.js', 'test/a.js', 'config.json']) {
        assert.throws(() => contract.validateCodePath(value), value);
    }
    await fs.unlink(path.join(f.staging, 'tasks/demo/helper.js'));
    assert.throws(() => new TaskCodeCatalog(f.context, { projectRoot: f.root, apkVersionCode: 58 }));
    await fs.symlink(path.join(f.source, 'helper.js'), path.join(f.staging, 'tasks/demo/helper.js'));
    assert.throws(() => new TaskCodeCatalog(f.context, { projectRoot: f.root, apkVersionCode: 58 }));
    await fs.unlink(path.join(f.staging, 'tasks/demo/helper.js'));
    await fs.copyFile(path.join(f.source, 'helper.js'), path.join(f.staging, 'tasks/demo/helper.js'));
    await fs.writeFile(path.join(f.staging, 'extra.js'), 'extra');
    assert.throws(() => new TaskCodeCatalog(f.context, { projectRoot: f.root, apkVersionCode: 58 }));
    assert.throws(() => f.catalog.resolve('demo', 'stale.js'));
    assert.throws(() => f.catalog.files('old-demo'));
});

test('有效读取/任务列表/官方代码只读，配置和实例数据保留', async t => {
    const f = await fixture(t);
    const io = new TaskIO({ tasksDir: path.join(f.root, 'res/tasks'), taskCodeCatalog: f.catalog });
    const files = await io.readTaskFiles('demo');
    assert.deepEqual(files.map(file => file.name), ['helper.js', 'task.js']);
    const tasks = await io.listTasks();
    assert.equal(tasks.find(task => task.taskName === 'demo').managed, true);
    assert.equal(tasks.some(task => task.taskName === 'old-demo'), false);
    await assert.rejects(io.saveTaskFiles('demo', [{ name: 'task.js', data: 'eA==' }]));
    await assert.rejects(io.deleteTask('demo'));
    await assert.rejects(io.deleteTaskFiles('demo', ['helper.js']));
    await io.setTaskConfig('demo', { changed: true });
    assert.deepEqual(await io.getTaskConfig('demo'), { changed: true });
    assert.equal(await fs.readFile(path.join(f.source, 'results/keep.txt'), 'utf8'), 'user data');
});

test('Node入口和相对require从代码目录加载，cwd/workDir仍写数据目录', async t => {
    const f = await fixture(t);
    const result = await new NodeJsRunner().run({ entryFile: 'task.js', entryPath: f.catalog.resolve('demo', 'task.js'),
        codeDir: path.join(f.staging, 'tasks/demo'), workDir: f.source, context: { workDir: f.source } });
    assert.equal(result.success, true, result.error);
    assert.deepEqual(result.data, { cwd: f.source, workDir: f.source, value: 42 });
});

test('显示端重发忽略缓存files，受管写入拒绝发生在实例状态变化之前', async t => {
    const f = await fixture(t);
    const manager = new TaskManager({ tasksDir: path.join(f.root, 'res/tasks'), taskCodeCatalog: f.catalog, serverExecutionDisabled: true });
    const sentinel = { taskName: 'demo', instanceId: 'keep', status: 'running' };
    manager.instances.set('keep', sentinel);
    await assert.rejects(manager.deleteTask('demo'));
    await assert.rejects(manager.submit({ taskName: 'demo', files: [{ name: 'task.js', data: 'b2xk' }] }));
    await assert.rejects(manager.updateTask('demo', { files: [{ name: 'config.json', action: 'delete' }, { name: 'task.js', data: 'b2xk' }] }));
    assert.equal(manager.instances.size, 1); assert.equal(manager.instances.get('keep'), sentinel);
    assert.match(await fs.readFile(path.join(f.source, 'config.json'), 'utf8'), /keep/);
    let sent;
    manager.setSendToDisplay((_id, message) => { sent = message; return true; });
    await manager._forwardToDisplay({ taskName: 'demo', taskType: 'user', entryFile: 'task.js', displayId: 'display',
        files: [{ name: 'task.js', data: 'b2xk' }] }, 'keep', {});
    assert.equal(sent.payload.revision, f.manifest.tasks[0].revision);
    assert.equal(sent.payload.taskCodeVersion, 1);
    assert.match(Buffer.from(sent.payload.files.find(file => file.name === 'task.js').data, 'base64').toString(), /helper.js/);
});

test('Puppeteer读取独立入口并给浏览器任务保留数据workDir', async t => {
    const f = await fixture(t);
    const entryPath = path.join(f.root, 'browser-code/task.js');
    await fs.mkdir(path.dirname(entryPath));
    await fs.writeFile(entryPath, 'async function run(ctx) { return {workDir: ctx.workDir, value: 7}; }');
    const runner = new (require('../src/apps/server/modules/task-engine/puppeteer-runner'))();
    const callbacks = {};
    const page = { on() {}, close: async () => {}, exposeFunction: async (name, fn) => { callbacks[name] = fn; },
        evaluate: async (fn, ...args) => vm.runInNewContext(`(${fn.toString()})(...${JSON.stringify(args)})`,
            { navigator: {}, document: { createElement: () => ({ getContext: () => null }) }, ...callbacks }) };
    runner.browser = { isConnected: () => true, newPage: async () => page };
    const result = await runner.run({ entryFile: 'task.js', entryPath, codeDir: path.dirname(entryPath),
        workDir: f.source, context: { workDir: f.source } });
    assert.equal(result.success, true, result.error);
    assert.deepEqual(JSON.parse(JSON.stringify(result.data)), { workDir: f.source, value: 7 });
});

test('HTTP受管代码使用同一版本并禁止旧目录回退，业务结果仍可访问', async t => {
    const f = await fixture(t);
    const express = require('express');
    await fs.writeFile(path.join(f.source, 'stale.html'), '<h1>old seed</h1>');
    const app = express();
    app.use('/res/tasks', f.catalog.middleware(), express.static(path.join(f.root, 'res/tasks')));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}/res/tasks/demo/`;
    const code = await fetch(url + 'task.js');
    assert.equal(code.status, 200); assert.equal(code.headers.get('cache-control'), 'no-store');
    assert.match(await code.text(), /helper.js/);
    assert.equal((await fetch(url + 'stale.html')).status, 404);
    assert.equal(await (await fetch(url + 'results/keep.txt')).text(), 'user data');
    await fs.unlink(path.join(f.staging, 'tasks/demo/task.js'));
    assert.equal((await fetch(url + 'task.js')).status, 404);
});

test('独立ZIP构建签名、发布与同步只选择任务组件，保留完整候选', async t => {
    const f = await fixture(t);
    const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
    const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' });
    const codeBytes = Buffer.from('existing-code');
    const dependencyBytes = Buffer.from('existing-dependencies');
    const payload = { schemaVersion: 1, components: {
        code: { version: 96, taskCodeApiVersion: 1, requiredDependencyVersion: 10, requiredLockSha256: LOCK,
            relativeUrl: 'code/code-v96.zip', size: codeBytes.length, sha256: contract.hash(codeBytes) },
        dependencies: { version: 10, lockSha256: LOCK, relativeUrl: 'dependencies/dependencies-v10.zip',
            size: dependencyBytes.length, sha256: contract.hash(dependencyBytes) }
    } };
    const currentManifest = { payload, signature: packaging.signManifestPayload(payload, privateKeyPem) };
    const outputDir = path.join(f.root, 'output');
    const result = await packaging.createOfflineUpdateArtifacts({ projectRoot: f.root, outputDir, currentManifest,
        mode: 'task-code-only', taskCodeVersion: 1, selection: f.selection, privateKeyPem, publicKeyPem });
    packaging.verifySignedManifest(result.manifest, publicKeyPem);
    shared.verifyManifest(result.manifest, publicKeyPem);
    assert.equal(result.manifest.payload.components.code.sha256, payload.components.code.sha256);
    assert.deepEqual(publishing.getPublishComponents(result.manifest, 'task-code-only'), [result.manifest.payload.components.taskCode]);
    assert.ok(syncing.SYNC_COMPONENT_NAMES.includes('taskCode'));
    assert.equal(syncing.selectSyncComponents(result.manifest).find(item => item.name === 'taskCode').component.sha256,
        result.manifest.payload.components.taskCode.sha256);
    const entries = execFileSync('unzip', ['-Z1', result.taskCodeArchivePath], { encoding: 'utf8' });
    assert.match(entries, /task-code-manifest.json/);
    assert.doesNotMatch(entries, /config.json|results|node_modules/);
    const target = path.join(f.root, 'published');
    for (const [name, bytes] of [['code/code-v96.zip', codeBytes], ['dependencies/dependencies-v10.zip', dependencyBytes]]) {
        await fs.mkdir(path.dirname(path.join(target, name)), { recursive: true });
        await fs.writeFile(path.join(target, name), bytes);
    }
    await fs.writeFile(path.join(target, 'manifest.json'), JSON.stringify(currentManifest));
    await fs.mkdir(path.join(target, 'task-code'));
    await fs.writeFile(path.join(target, 'task-code/task-code-v0.zip'), 'old');
    await fs.writeFile(path.join(target, 'task-code/keep.zip'), 'keep');
    const published = await publishing.publishOfflineUpdate({ mode: 'task-code-only', artifactRoot: outputDir,
        manifestPath: result.manifestPath, publicKeyPem, localRoot: target });
    assert.deepEqual(published.publishedRelativePaths, ['task-code/task-code-v1.zip', 'manifest.json']);
    await assert.rejects(fs.stat(path.join(target, 'task-code/task-code-v0.zip')));
    assert.equal(await fs.readFile(path.join(target, 'task-code/keep.zip'), 'utf8'), 'keep');
    const changed = structuredClone(currentManifest);
    changed.payload.components.code.version = 97;
    changed.signature = packaging.signManifestPayload(changed.payload, privateKeyPem);
    await fs.writeFile(path.join(target, 'manifest.json'), JSON.stringify(changed));
    await assert.rejects(publishing.publishOfflineUpdate({ mode: 'task-code-only', artifactRoot: outputDir,
        manifestPath: result.manifestPath, publicKeyPem, localRoot: target }), /基线已变化/);
});
