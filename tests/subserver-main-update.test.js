'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { fixture } = require('./helpers/shared-update-fixture');
const feed = require('../src/apps/server/modules/aasc/main-server-update-feed');
const { createMainServerSubserverUpdater, readStartupContext, activeFile, writeJson, waitForHealth } = require('../src/apps/server/modules/aasc/subserver-main-update');
const { createServerLauncher } = require('../src/apps/server/boot/server-launcher');
const { requestManagedUpdate } = require('../src/apps/server/modules/aasc/subserver-update-request');
const { getRuntimeVersionInfo } = require('../src/apps/server/modules/aasc/runtime-version-info');
const shared = require('../src/apps/server/modules/aasc/shared-update-manifest');

test('共享清单验签并选择同源主服务器代码/common/linux64，不信任篡改或不兼容目标', async t => {
    const f = await fixture(t);
    assert.equal(feed.validateManifest({ manifest: f.manifest }, f.options.serverUrl, f.options).group, 'linux64');
    f.manifest.payload.components.code.size++;
    assert.throws(() => feed.validateManifest(f.manifest, f.options.serverUrl, f.options), /签名/);
    await f.sign();
    assert.throws(() => feed.validateManifest(f.manifest, f.options.serverUrl, { ...f.options, arch: 'arm64' }), /没有/);
    assert.throws(() => feed.normalizeServerUrl('file:///tmp/server'), /地址/);
    assert.throws(() => shared.assertRuntime({ os: 'linux', arch: 'x64', libc: 'musl' }), /不兼容/);
});

test('实际HTTP只向已配置主服务器获取签名清单/代码和两组依赖', async t => {
    const f = await fixture(t); const urls = [];
    const { ServerReleaseService } = require('../src/apps/server/modules/aasc/server-release-service');
    const release = new ServerReleaseService({ releaseRoot: f.published, publicKeyPem: f.publicKeyPem });
    const server = http.createServer(async (req, res) => {
        urls.push(req.url); const url = new URL(req.url, 'http://main');
        try {
            if (url.pathname === '/server') res.end(JSON.stringify({ manifest: await release.getManifest() }));
            else await release.streamPackage(res, Object.fromEntries(url.searchParams), url.pathname.endsWith('dependencies') ? url.searchParams.get('group') : null);
        } catch (error) { res.statusCode = 500; res.end(error.message); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
    const options = { ...f.options, serverUrl: `http://127.0.0.1:${server.address().port}` }; delete options.requestJson; delete options.download;
    const result = await createMainServerSubserverUpdater(options).update(); assert.equal(result.success, true, result.message);
    assert.equal(urls.length, 4); assert.equal(urls[0], '/server');
    assert.match(urls[1], /^\/server\/package\?version=2&sha256=/);
    assert.match(urls[2], /group=common/); assert.match(urls[3], /group=linux64/);
});

test('分层组装真实生产依赖，无npm，保护源码/配置/tasks/results/models/logs并回报v版本', async t => {
    const f = await fixture(t); const result = await createMainServerSubserverUpdater(f.options).update();
    assert.equal(result.success, true, result.message); assert.deepEqual(f.events, ['stop', ['start', 'v2']]);
    const context = readStartupContext(f.root);
    const versions = getRuntimeVersionInfo({ projectRoot: f.root, codeRoot: context.codeRoot, nodeModulesRoot: context.nodeModulesRoot });
    assert.equal(versions.code, 'v2'); assert.equal(versions.dependencies, 'v1'); assert.equal(versions.update.status, 'completed');
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'node_modules/express/package.json'))).version, '4.0.0');
    assert.equal(JSON.parse(fs.readFileSync(path.join(context.nodeModulesRoot, 'express/package.json'))).version, '4.21.2');
    for (const name of ['config/config.json', 'res/tasks/test/results/index.json', 'res/models/keep.bin', 'logs/keep.log']) assert.equal(fs.readFileSync(path.join(f.root, name), 'utf8'), 'keep');
});

test('仅平台组变更时复用common，幂等不下载；force只重新取代码并校验缓存', async t => {
    const f = await fixture(t); const updater = createMainServerSubserverUpdater(f.options);
    assert.equal((await updater.update()).success, true); assert.equal(f.downloads.length, 3);
    assert.equal((await updater.update()).current, true); assert.equal(f.downloads.length, 3);
    const previous = readStartupContext(f.root);
    await f.group('linux64', { 'platform/linux.txt': 'new platform' }, 2);
    f.manifest.payload.components.dependencies.version = 2; f.manifest.payload.components.code.requiredDependencyVersion = 2;
    await f.sign();
    const result = await updater.update(); assert.equal(result.success, true, result.message);
    assert.equal(f.downloads.length, 5); assert.equal(f.downloads[4].searchParams.get('group'), 'linux64');
    assert.equal(readStartupContext(f.root).dependencyGroups.common, previous.dependencyGroups.common);
    assert.equal((await updater.update({ force: true })).success, true); assert.equal(f.downloads.length, 6);
    assert.ok(f.downloads[5].searchParams.has('force'));
});

test('签名/ZIP/锁/组冲突准备失败均不停止旧进程', async t => {
    for (const scenario of ['signature', 'download', 'lock', 'path', 'conflict']) await t.test(scenario, async t => {
        const f = await fixture(t, scenario === 'path' ? { 'config/leak.json': 'forbidden' } : {});
        const options = { ...f.options };
        if (scenario === 'signature') f.manifest.payload.components.dependencies.version++;
        if (scenario === 'download') options.download = async (_, target) => fs.promises.writeFile(target, 'bad zip');
        if (scenario === 'lock') { f.manifest.payload.components.code.requiredLockSha256 = 'a'.repeat(64); f.manifest.payload.components.dependencies.lockSha256 = 'a'.repeat(64); await f.sign(); }
        if (scenario === 'conflict') { await f.group('linux64', { 'express/package.json': '{"version":"4.21.2"}' }, 2); await f.sign(); }
        const result = await createMainServerSubserverUpdater(options).update(); assert.equal(result.success, false); assert.equal(result.rolledBack, false); assert.deepEqual(f.events, []);
    });
});

test('普通APK下载Android依赖且无npm；Node ABI不兼容时保留旧进程', async t => {
    const f = await fixture(t);
    const options = { ...f.options, android: true, arch: 'arm64', nodeMajor: 26, libc: 'bionic' };
    const result = await createMainServerSubserverUpdater(options).update(); assert.equal(result.success, true, result.message);
    assert.equal(f.downloads.at(-1).searchParams.get('group'), 'android');
    assert.equal((await createMainServerSubserverUpdater({ ...options, nodeMajor: 22 }).update({ force: true })).success, false);
});

test('新版本健康失败整组恢复上一代码和依赖目录', async t => {
    const f = await fixture(t); await createMainServerSubserverUpdater(f.options).update();
    const previous = readStartupContext(f.root); f.events.length = 0;
    await f.group('linux64', { 'platform/next.txt': 'next' }, 2); f.manifest.payload.components.dependencies.version = 2; f.manifest.payload.components.code.requiredDependencyVersion = 2; await f.sign();
    const result = await createMainServerSubserverUpdater({ ...f.options, healthCheck: async () => false }).update();
    assert.equal(result.rolledBack, true); assert.equal(result.success, false);
    const restored = readStartupContext(f.root); assert.equal(restored.codeRoot, previous.codeRoot); assert.equal(restored.nodeModulesRoot, previous.nodeModulesRoot);
});

test('意外退出pending恢复基线；缓存篡改和更新根链接拒绝', async t => {
    const f = await fixture(t); const updater = createMainServerSubserverUpdater(f.options); await updater.update();
    const state = JSON.parse(fs.readFileSync(activeFile(f.root)));
    fs.appendFileSync(path.join(f.root, state.dependencyGroups.common, 'node_modules/express/index.js'), 'tampered');
    f.events.length = 0; const result = await updater.update({ force: true }); assert.equal(result.success, false); assert.deepEqual(f.events, []);
    writeJson(activeFile(f.root), { ...state, pendingHealth: true, previous: null, ownerPid: 2000000000 });
    assert.equal(readStartupContext(f.root).codeVersion, null);
});

test('健康检查只认loopback本节点实际代码和依赖路径', async t => {
    const context = { codeVersion: '1.0.0+abc123', codeRoot: '/tmp/real-code', nodeModulesRoot: '/tmp/real-deps' };
    const server = http.createServer((req, res) => res.end(JSON.stringify({ versions: {
        code: context.codeVersion, codePath: context.codeRoot, dependenciesPath: context.nodeModulesRoot
    } })));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => server.close());
    const healthUrl = `http://127.0.0.1:${server.address().port}`;
    assert.equal(await waitForHealth(context, { healthUrl }), true);
    assert.equal(await waitForHealth({ ...context, codeVersion: 'other-version' }, { healthUrl, healthTimeoutMs: 1 }), false);
    await assert.rejects(waitForHealth(context, { healthUrl: 'https://main-server.example' }), /本节点/);
});

test('受管更新请求不将旧启动器误报accepted；IPC包含主服务器和本机地址', async () => {
    await assert.rejects(requestManagedUpdate({ environment: {}, send() {} }), /新版/);
    let message;
    const result = await requestManagedUpdate({ payload: { force: true }, mainServerUrl: 'https://main.test:8081', healthUrl: 'http://127.0.0.1:8081',
        environment: { AASC_SUBSERVER_UPDATE_IPC: '1' }, send(value, callback) { message = value; callback(); } });
    assert.equal(result.accepted, true); assert.equal(message.type, 'serverUpdateRequested');
    assert.equal(message.force, true); assert.equal(result.requestId, message.requestId);
    assert.equal(message.mainServerUrl, 'https://main.test:8081'); assert.equal(result.source, 'main-server');
});

test('普通APK启动器接收主服务器更新并串行stop/start抑制自动重启', async () => {
    let spawned = 0;
    const children = [];
    const launcher = createServerLauncher({ environment: { AASC_ANDROID_NODE: '1' }, spawnChild() {
        const child = new EventEmitter(); child.kill = signal => child.emit('exit', 143, signal); children.push(child); spawned++; return child;
    }, createUpdater({ serviceController, serverUrl, android }) { assert.equal(serverUrl, 'https://main.test:8081'); assert.equal(android, true); return { async update() {
        await serviceController.stop(); assert.equal(spawned, 1);
        await serviceController.start({ codeVersion: null }); return { success: true };
    } }; } });
    launcher.start();
    launcher.handleChildMessage({ type: 'serverUpdateRequested', requestId: 'request-2', force: true, mainServerUrl: 'https://main.test:8081' });
    await launcher.getUpdatePromise();
    assert.equal(spawned, 2);
});


test('真实双进程经主服务器下载ZIP/依赖，停旧进程并用本节点API确认新版本', async t => {
    const { fork } = require('node:child_process');
    const f = await fixture(t);
    const release = new (require('../src/apps/server/modules/aasc/server-release-service').ServerReleaseService)({ releaseRoot: f.published, publicKeyPem: f.publicKeyPem });
    const main = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://main');
        try {
            if (url.pathname === '/server') res.end(JSON.stringify({ manifest: await release.getManifest() }));
            else await release.streamPackage(res, Object.fromEntries(url.searchParams), url.pathname.endsWith('dependencies') ? url.searchParams.get('group') : null);
        } catch (error) { res.statusCode = 500; res.end(error.message); }
    });
    await new Promise(resolve => main.listen(0, '127.0.0.1', resolve)); t.after(() => main.close());
    const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
    const versionsModule = require.resolve('../src/apps/server/modules/aasc/runtime-version-info');
    const newSource = `const http=require('node:http');const {getRuntimeVersionInfo}=require(${JSON.stringify(versionsModule)});http.createServer((req,res)=>res.end(JSON.stringify({versions:getRuntimeVersionInfo({projectRoot:process.env.AASC_PROJECT_ROOT,codeRoot:__dirname.replace(/[/\\\\]src[/\\\\]apps[/\\\\]server[/\\\\]boot$/, ''),nodeModulesRoot:process.env.AASC_NODE_MODULES_DIR})}))).listen(${port},'127.0.0.1',()=>process.send({type:'serverReady'}));`;
    f.write('src/apps/server/boot/server-app.js', `require('node:http').createServer((req,res)=>res.end('{}')).listen(${port},'127.0.0.1',()=>process.send({type:'serverReady'}));`);
    fs.writeFileSync(path.join(f.source, 'src/apps/server/boot/server-app.js'), newSource); f.makeCode(); await f.sign();
    let child; const launcher = createServerLauncher({ projectRoot: f.root, serverPath: path.join(f.root, 'src/apps/server/boot/server-app.js'), environment: { ...process.env }, exit() {},
        spawnChild(file, args, options) { child = fork(file, args, { ...options, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }); return child; },
        createUpdater(options) { return createMainServerSubserverUpdater({ ...options, publicKeyPem: f.publicKeyPem, healthTimeoutMs: 8000 }); } });
    t.after(() => launcher.requestStop()); launcher.start();
    await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('old child never ready')), 5000); child.once('message', () => { clearTimeout(timeout); resolve(); }); });
    launcher.handleChildMessage({ type: 'serverUpdateRequested', requestId: 'real-process-test', force: false,
        mainServerUrl: `http://127.0.0.1:${main.address().port}`, healthUrl: `http://127.0.0.1:${port}` });
    const result = await launcher.getUpdatePromise(); assert.equal(result.success, true, result.message);
    const status = await feed.requestJson(`http://127.0.0.1:${port}/api/status`); assert.equal(status.versions.code, 'v2'); assert.equal(status.versions.dependencies, 'v1');
    assert.equal(status.versions.codePath, readStartupContext(f.root).codeRoot); assert.equal(status.versions.update.status, 'completed');
});

test('健康检查以真实目录比较Android数据路径别名，仍拒绝另一代码目录', async t => {
    const f = await fixture(t); const alias = path.join(f.root, 'android-data-alias'); fs.symlinkSync(f.source, alias);
    const context = { codeVersion: 'v9', codeRoot: alias, nodeModulesRoot: alias };
    const server = http.createServer((req, res) => res.end(JSON.stringify({ versions: { code: 'v9', codePath: f.source, dependenciesPath: f.source } })));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
    assert.equal(await waitForHealth(context, { healthUrl: `http://127.0.0.1:${server.address().port}` }), true);
    assert.equal(await waitForHealth({ ...context, codeRoot: f.root }, { healthUrl: `http://127.0.0.1:${server.address().port}`, healthTimeoutMs: 1 }), false);
});
