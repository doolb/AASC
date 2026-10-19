'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const http = require('node:http');
const yazl = require('yazl');
const { once } = require('node:events');
const base = '../src/apps/server/boot/offline-launcher/';
const { Releases, validateLock } = require(base + 'releases');
const { Models, validateCatalog } = require(base + 'models');
const { Controller } = require(base + 'controller');
const { Supervisor, verifyCandidate, PREFIX } = require(base + 'supervisor');
const { restoreSeeds } = require(base + 'seeds');
const { extractZipSafely } = require(base + 'archive');
const files = require(base + 'files');
const network = require(base + 'network');
const shared = require('../src/apps/server/modules/aasc/shared-update-manifest');
const tree = require('../src/apps/server/modules/aasc/dependency-tree');
const { prepareOfflineLauncher } = require('../scripts/ops/prepare-offline-launcher');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const runtime = { abi: 'arm64-v8a', nodeMajor: 26, contractVersion: 1 };
async function write(root, relative, value) {
    const file = path.join(root, relative); await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)); return file;
}
async function zip(file, entries) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const zip = new yazl.ZipFile();
    for (const [name, value] of Object.entries(entries)) {
        if (value === null) zip.addEmptyDirectory(name, { mtime: new Date('2026-10-16T00:00:00Z') });
        else zip.addBuffer(Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)), name, { mode: 0o100600, mtime: new Date('2026-10-16T00:00:00Z') });
    }
    const output = fs.createWriteStream(file); const done = once(output, 'close');
    zip.outputStream.pipe(output); zip.end(); await done;
}
function sign(components) {
    const payload = { schemaVersion: 1, components };
    return { payload, signature: { algorithm: 'SHA256withRSA', value: crypto.sign('RSA-SHA256', Buffer.from(shared.canonicalJson(payload)), keys.privateKey).toString('base64') } };
}
async function fixture(t) {
    const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'aasc-js-launcher-')); const cleanup = [];
    const root = path.join(temp, 'files/aasc-server'); const remote = path.join(temp, 'remote'); await fsp.mkdir(root, { recursive: true }); await fsp.mkdir(remote);
    const requests = [];
    const server = http.createServer((req, res) => {
        requests.push(req.url); const file = path.join(remote, decodeURIComponent(req.url));
        if (!file.startsWith(remote + '/') || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'content-length': fs.statSync(file).size }); fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(async () => {
        for (const close of cleanup.reverse()) await close();
        await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
        await fsp.rm(temp, { recursive: true, force: true });
    });
    const source = `http://127.0.0.1:${server.address().port}/`;
    const catalog = { schemaVersion: 1, models: [{ modelId: 'tts', revision: 'r1', totalBytes: 5, files: [{ name: 'voice.bin', path: 'tts/voice.bin', size: 5, sha256: digest('voice') }] }] };
    const catalogPath = await write(temp, 'catalog.json', catalog);
    const config = { root, publicKey: keys.publicKey, apkVersion: 60, hostApi: 1, stateApi: 1, generation: 'test', updateOnly: true,
        catalogPath, updateSources: [source], modelSources: [source], runtime: { arch: 'arm64', nodeMajor: 26 }, healthTimeoutMs: 500, launcherTimeoutMs: 2000 };
    const lock = { lockfileVersion: 3, packages: { '': { name: 'fixture' }, 'node_modules/express': { version: '1.0.0' } } }; const lockBytes = JSON.stringify(lock); const lockSha = digest(lockBytes);
    async function release(version = 1, extra = {}, codeExtra = {}) {
        const codePath = `code/code-v${version}.zip`;
        await zip(path.join(remote, codePath), { 'package.json': '{}', 'package-lock.json': lockBytes, 'src/apps/server/boot/server-app.js': 'process.exit(0);', ...codeExtra });
        const depPath = 'dependencies/dependencies-v1.zip';
        if (!fs.existsSync(path.join(remote, depPath))) await zip(path.join(remote, depPath), { 'dependency-manifest.json': { version: 1, lockSha256: lockSha }, 'node_modules/express/package.json': { version: '1.0.0' } });
        const seedPath = 'node-min-seeds/node-min-seeds-v1.zip';
        if (!fs.existsSync(path.join(remote, seedPath))) await zip(path.join(remote, seedPath), { 'config/config.json': { custom: 'seed' }, 'userconfig/': null, 'task/demo/results/run-1/': null, 'task/demo/results/latest': 'run-1\n' });
        const entry = (relativeUrl, version) => ({ relativeUrl, version, size: fs.statSync(path.join(remote, relativeUrl)).size, sha256: digest(fs.readFileSync(path.join(remote, relativeUrl))) });
        const components = { code: { ...entry(codePath, version), requiredDependencyVersion: 1, requiredLockSha256: lockSha, runtimeCompatibility: runtime },
            dependencies: { ...entry(depPath, 1), lockSha256: lockSha }, nodeMinSeeds: entry(seedPath, 1), ...extra };
        const manifest = sign(components); await write(remote, 'manifest.json', manifest);
        return { manifest, components, baseUrl: source };
    }
    return { cleanup, temp, root, remote, config, catalog, source, requests, release, lockSha, lockBytes };
}

test('WAN热更先解析域名再以IP URL请求，模型来源保留域名', async t => {
    let actualHost = '';
    const server = http.createServer((request, response) => {
        actualHost = request.headers.host;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"ok":true}');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));
    const port = server.address().port;
    let lookups = 0;
    const lookup = async (host, options) => {
        lookups++;
        assert.equal(host, 'c.aasc.us');
        assert.deepEqual(options, { family: 4 });
        return { address: '127.0.0.1', family: 4 };
    };
    const stream = await network.response(`http://c.aasc.us:${port}/mnt/aasc-offline/manifest.json`, undefined, 1000, lookup);
    let body = '';
    for await (const chunk of stream) body += chunk;
    assert.equal(body, '{"ok":true}');
    assert.equal(actualHost, `127.0.0.1:${port}`);
    assert.equal(lookups, 1);
    const modelUrl = await network.resolveRequestUrl('https://c.aasc.us/mnt/aimodel/manifest.json', lookup);
    assert.equal(modelUrl.hostname, 'c.aasc.us');
    assert.equal(lookups, 1);
});

test('空min仅靠内置模块预览/首装，恢复种子、空目录与latest，健康后提交', async t => {
    const f = await fixture(t); const source = await f.release(); const releases = new Releases(f.config);
    const preview = await releases.preview(); assert.equal(preview.baseUrl, f.source); assert.ok(preview.downloadBytes > 0); assert.equal(releases.current(), null);
    const events = []; const service = { async start(context) { assert.equal(context.codeVersion, 1); await this.onHealthy(); }, async stop() {} };
    const controller = new Controller({ ...f.config, service }, value => events.push(value));
    await controller.boot(); assert.equal(controller.snapshot.phase, 'awaiting_confirmation');
    assert.equal((await controller.handle({ type: 'bootstrap.install', requestId: 'install', payload: preview })).applied, true);
    assert.equal(releases.current().pendingHealth, false); assert.equal(files.read(f.root, 'config/config.json').custom, 'seed');
    assert.ok(fs.statSync(path.join(f.root, 'home/.config/aasc-user')).isDirectory());
    assert.equal(fs.readlinkSync(path.join(f.root, 'res/tasks/demo/results/latest')), 'run-1');
    assert.ok(events.some(value => value.payload?.status === 'ready'));
    assert.equal((await releases.check()).hasUpdate, false);
    assert.equal(source.components.code.version, 1);
});

test('首装取消/验签/运行契约失败保留空环境，不信任预览外来源', async t => {
    const f = await fixture(t); const source = await f.release(); const releases = new Releases(f.config);
    const changed = structuredClone(source.manifest); changed.payload.components.code.version = 2;
    assert.throws(() => releases.source({ baseUrl: f.source, signedManifest: JSON.stringify(changed) }), /签名/);
    assert.throws(() => releases.source({ baseUrl: 'http://elsewhere/', signedManifest: JSON.stringify(source.manifest) }), /来源/);
    const abort = new AbortController(); abort.abort(new Error('取消'));
    await assert.rejects(releases.prepare(source, true, abort.signal), /取消/); assert.equal(releases.current(), null);
    const wrong = { ...source, components: { ...source.components, code: { ...source.components.code, runtimeCompatibility: undefined } } };
    assert.throws(() => releases.plan(wrong, true), /运行契约/);
});

test('服务候选失败/断电pending回滚，拒绝同版本不同身份，并保留配置', async t => {
    const f = await fixture(t); const releases = new Releases(f.config); await releases.prepare(await f.release(), true); await releases.healthy();
    await write(f.root, 'config/config.json', { custom: 'user' });
    const second = await f.release(2); await releases.prepare(second, false); assert.equal(releases.current().codeVersion, 2);
    await new Releases(f.config).rollback(); assert.equal(releases.current().codeVersion, 1); assert.equal(files.read(f.root, 'config/config.json').custom, 'user');
    assert.equal((await releases.check()).hasUpdate, false); assert.equal((await releases.check(true)).hasUpdate, true);
    const altered = structuredClone(second); altered.components.code.sha256 = 'f'.repeat(64);
    await assert.rejects(releases.prepare(altered, false), /下载|身份/);
});

test('整包根的任务/依赖变化物化代码版本，回退仍恢复整包根', async t => {
    const f = await fixture(t); const first = await f.release();
    await extractZipSafely(path.join(f.remote, first.components.code.relativeUrl), path.join(f.temp, 'code'), 'code');
    await files.copy(path.join(f.temp, 'code'), f.root);
    await write(f.root, 'offline-update-client.json', { codeVersion: 1, dependencyVersion: 1, lockSha256: f.lockSha });
    await write(f.root, 'node_modules/express/package.json', { version: '1.0.0' });
    const release = new Releases(f.config); const second = await f.release(2);
    await release.prepare(second, false); assert.equal(release.context().codeRoot, path.join(f.root, 'updates/code/code-v2'));
    await release.rollback(); assert.equal(release.context().codeRoot, f.root); assert.equal(fs.existsSync(path.join(f.root, 'updates/active-release.json')), false);
});

test('生产锁验证必需包版本，忽略可选/dev包，拒绝锁路径越界', async t => {
    const f = await fixture(t); await write(f.root, 'package-lock.json', JSON.parse(f.lockBytes));
    await assert.rejects(validateLock(f.root, f.root), /生产包/);
    await write(f.root, 'node_modules/express/package.json', { version: '1.0.0' }); await validateLock(f.root, f.root);
    await write(f.root, 'package-lock.json', { packages: { '../bad': { version: '1' } } }); await assert.rejects(validateLock(f.root, f.root), /路径/);
});

test('Android仅下载common/android依赖，校验平台、内容与缓存元数据', async t => {
    const f = await fixture(t); let source = await f.release(); const groups = {};
    for (const name of shared.GROUPS) {
        const relativeUrl = `dependencies/${name}/dependencies-v1.zip`; const layer = path.join(f.temp, name);
        await fsp.mkdir(path.join(layer, 'node_modules'), { recursive: true });
        if (name === 'common') await write(layer, 'node_modules/express/package.json', { version: '1.0.0' });
        const contentSha256 = await tree.contentHash(path.join(layer, 'node_modules'));
        const target = name === 'common' ? null : shared.TARGETS[name];
        await zip(path.join(f.remote, relativeUrl), { 'dependency-group.json': { group: name, version: 1, target, contentSha256 }, 'node_modules/': null,
            ...(name === 'common' ? { 'node_modules/express/package.json': { version: '1.0.0' } } : {}) });
        groups[name] = { version: 1, relativeUrl, size: fs.statSync(path.join(f.remote, relativeUrl)).size, sha256: digest(fs.readFileSync(path.join(f.remote, relativeUrl))), target, contentSha256 };
    }
    const deps = { version: 1, lockSha256: f.lockSha, groups, sha256: digest(shared.canonicalJson(groups)), size: shared.GROUPS.reduce((sum, name) => sum + groups[name].size, 0) };
    source = { ...source, components: { ...source.components, dependencies: deps } }; source.manifest = sign(source.components);
    const phases = []; const releases = new Releases(f.config, value => phases.push(value)); await releases.prepare(source, true); await releases.healthy();
    for (const phase of ['downloading', 'extracting', 'verifying', 'merging']) assert.ok(phases.some(row => row.phase === phase), phase);
    assert.ok(phases.some(row => row.phase === 'extracting' && row.completedFiles === row.totalFiles && row.totalFiles > 0));
    assert.ok(phases.some(row => row.phase === 'verifying' && row.indeterminate === true));
    assert.ok(f.requests.some(url => url.includes('/common/'))); assert.ok(f.requests.some(url => url.includes('/android/')));
    assert.equal(f.requests.some(url => /linux64|win64/.test(url)), false);
    const cache = path.join(f.root, `updates/dependency-groups/common/dependencies-v1-${groups.common.sha256.slice(0, 12)}`);
    const metadata = files.read(cache, 'dependency-group.json'); await write(cache, 'dependency-group.json', { ...metadata, target: { os: 'linux' } });
    await fsp.mkdir(path.join(f.temp, 'stage'));
    await assert.rejects(releases.dependencies(source, path.join(f.temp, 'stage')), /缓存/);
});

test('模型状态只读/下载明确授权/可信缓存/组进度与取消', async t => {
    const f = await fixture(t); const models = new Models(f.config);
    assert.equal(models.status()[0].filesPresent, false); assert.equal(f.requests.length, 0);
    await assert.rejects(models.prepare('tts', false), /确认/); assert.equal(f.requests.length, 0);
    await write(f.remote, 'manifest.json', { schemaVersion: 1, files: f.catalog.models[0].files }); await write(f.remote, 'tts/voice.bin', 'voice');
    const progress = []; const ready = await models.prepare('tts', true, value => progress.push(value));
    assert.equal(fs.readFileSync(path.join(ready, 'voice.bin'), 'utf8'), 'voice'); assert.equal(models.status()[0].filesReady, true); assert.ok(progress.includes(100));
    const count = f.requests.length; await models.prepare('tts', false); assert.equal(f.requests.length, count);
    await write(ready, 'voice.bin', 'wrong'); await fsp.utimes(path.join(ready, 'voice.bin'), new Date(), new Date(Date.now() + 2000));
    assert.equal(models.status()[0].filesReady, false); await assert.rejects(models.require('tts'), /校验/);
    await models.prepare('tts', true); assert.equal(models.status()[0].filesReady, true);
    const events = []; const controller = new Controller({ ...f.config, service: { async start() {}, async stop() {} } }, message => events.push(message));
    await controller.handle({ type: 'models.prepareGroup', requestId: 'group', payload: { modelIds: ['tts'], allowDownload: false } });
    assert.ok(events.some(event => event.type === 'model.prepared' && event.payload.progress === 100));
    assert.throws(() => validateCatalog({ ...f.catalog, models: [{ ...f.catalog.models[0], modelId: '../x' }] }), /无效/);
});

test('取消流式下载不发布目标文件/part，已有模型备份可恢复', async t => {
    const f = await fixture(t); const body = Buffer.alloc(200000, 65); const abort = new AbortController();
    await write(f.remote, 'file.bin', body); const target = path.join(f.root, 'download.bin');
    await assert.rejects(network.download(f.root, [f.source], { relativeUrl: 'file.bin', size: body.length, sha256: digest(body) }, target, abort.signal, () => abort.abort()), /abort/i);
    assert.equal(fs.existsSync(target), false); assert.equal(fs.existsSync(target + '.part'), false);
    const models = new Models(f.config); await write(path.dirname(f.root), 'models/.model-backup-tts-123/voice.bin', 'voice');
    await models.recover('tts'); assert.equal(models.status()[0].filesPresent, true);
});

test('首装提示等待前台/健康/显示，实际展示令牌才消费', async t => {
    const f = await fixture(t); const controller = new Controller({ ...f.config, service: { async stop() {} } }, () => {});
    const p = { front: true, displayReady: true };
    assert.equal((await controller.firstRun(p)).show, false); controller.snapshot = { status: 'ready' };
    assert.equal((await controller.firstRun({ ...p, front: false })).show, false);
    const decision = await controller.firstRun(p); assert.equal(decision.show, true);
    await assert.rejects(controller.handle({ type: 'ui.firstRunShown', payload: { token: 'wrong' } }), /过期/);
    await controller.handle({ type: 'ui.firstRunShown', payload: { token: decision.token, visible: true } });
    assert.equal((await controller.firstRun(p)).handled, true);
});

test('受管路径拒绝链接，锁恢复死进程/空锁且拒绝活进程', async t => {
    const f = await fixture(t); await fsp.symlink(f.remote, path.join(f.root, 'link'));
    assert.throws(() => files.safe(f.root, path.join(f.root, 'link/file')), /链接/);
    assert.throws(() => files.safe(f.root, path.join(f.root, '../outside')), /越界/);
    const unlock = files.lock(f.root); assert.throws(() => files.lock(f.root), /正在执行/); unlock();
    await write(f.root, 'updates/.offline-js-lock/owner.json', { pid: 2147483647 }); files.lock(f.root)();
    await fsp.mkdir(path.join(f.root, 'updates/.offline-js-lock')); files.lock(f.root)();
});

test('ZIP禁止跨组件/链接/损坏CRC，不允许覆盖已有目标', async t => {
    const f = await fixture(t); const file = path.join(f.temp, 'invalid.zip');
    await zip(file, { 'config/secret.json': '{}' }); await assert.rejects(extractZipSafely(file, path.join(f.temp, 'invalid'), 'code'), /非组件/);
    await zip(file, { 'src/plain.js': 'const value = 1;' }); const bytes = fs.readFileSync(file); bytes[40] ^= 0xff; fs.writeFileSync(file, bytes);
    await assert.rejects(extractZipSafely(file, path.join(f.temp, 'crc'), 'code'), /CRC|头|invalid|不匹配/);
});

test('APK基线独立收集builtin闭包和HTML，源码无node_modules依赖', async t => {
    const f = await fixture(t); const result = await prepareOfflineLauncher(path.resolve(__dirname, '..'), path.join(f.temp, 'assets'));
    assert.ok(result.files.some(file => file.path === PREFIX + 'ui/index.html')); assert.ok(result.files.some(file => file.path.endsWith('shared-update-manifest.js')));
    for (const file of result.files.filter(file => file.path.startsWith(PREFIX) && file.path.endsWith('.js'))) {
        const code = fs.readFileSync(path.join(f.temp, 'assets/offline-launcher', file.path), 'utf8');
        for (const match of code.matchAll(/require\(['"]([^'"]+)['"]\)/g)) assert.ok(match[1].startsWith('.') || match[1].startsWith('node:'), match[1]);
    }
});

async function candidate(f, version, entry) {
    const source = await f.release(version, {}, { [PREFIX + 'entry.js']: entry, [PREFIX + 'host-api.json']: { hostApi: 1, stateApi: 1 }, [PREFIX + 'ui/index.html']: '<!doctype html><title>test</title>' });
    const releases = new Releases(f.config); return releases.stageLauncher(source);
}
async function until(check, timeout = 5000) { const end = Date.now() + timeout; while (Date.now() < end) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('等待条件超时'); }
const mockEntry = `process.send({type:'launcher.ready',payload:{hostApi:1,stateApi:1}}); process.send({type:'launcher.healthy'}); process.on('message',m=>{if(m.type==='host.stop')process.exit(0);else process.send({type:'rpc.result',requestId:m.requestId,result:{version:JSON.parse(process.env.AASC_LAUNCH_CONTEXT).launcherVersion}});});`;

test('固定supervisor重新核验签名ZIP/文件字节，拒绝候选篡改', async t => {
    const f = await fixture(t); const value = await candidate(f, 2, mockEntry); const root = await verifyCandidate(f.config, value);
    await write(root, PREFIX + 'entry.js', mockEntry + '\n// changed'); await assert.rejects(verifyCandidate(f.config, value), /不一致/);
});

test('启动器自身热更健康提交并重放原请求，不先切换服务指针', async t => {
    const f = await fixture(t); const value = await candidate(f, 2, mockEntry);
    const bundleRoot = path.join(f.temp, 'baseline'); await write(bundleRoot, PREFIX + 'entry.js', mockEntry);
    const events = []; const supervisor = new Supervisor({ ...f.config, bundleRoot }, event => events.push(event)); f.cleanup.push(() => supervisor.close());
    await supervisor.start(); await until(() => events.some(event => event.type === 'launcher.ready'));
    const request = { type: 'service.apply', requestId: 'switch-1', generation: 'test', payload: {} };
    supervisor.requests.add(request.requestId);
    await supervisor.message({ type: 'launcher.switch', payload: { candidate: value, resume: request } });
    await until(() => events.some(event => event.type === 'rpc.result' && event.requestId === request.requestId));
    assert.equal(events.find(event => event.requestId === request.requestId).result.version, 2);
    assert.equal(files.read(f.root, 'updates/launcher-state.json').active.version, 2); assert.equal(fs.existsSync(path.join(f.root, 'updates/active-release.json')), false);
});

test('候选语法/健康失败恢复原健康启动器并明确结束原请求', async t => {
    const f = await fixture(t); const old = await candidate(f, 1, mockEntry); const bad = await candidate(f, 2, 'throw new Error("broken");');
    await files.atomic(f.root, 'updates/launcher-state.json', { active: old, previous: null });
    const bundleRoot = path.join(f.temp, 'baseline'); await write(bundleRoot, PREFIX + 'entry.js', mockEntry);
    const events = []; const supervisor = new Supervisor({ ...f.config, bundleRoot }, event => events.push(event)); f.cleanup.push(() => supervisor.close());
    await supervisor.start(); await until(() => events.some(event => event.type === 'launcher.ready'));
    const request = { type: 'service.apply', requestId: 'switch-bad', generation: 'test', payload: {} }; supervisor.requests.add(request.requestId);
    await supervisor.message({ type: 'launcher.switch', payload: { candidate: bad, resume: request } });
    await until(() => events.some(event => event.requestId === request.requestId));
    await until(() => files.read(f.root, 'updates/launcher-state.json')?.active?.version === 1 && supervisor.child?.connected);
    assert.match(events.find(event => event.requestId === request.requestId).error, /回退/);
    assert.equal(files.read(f.root, 'updates/launcher-state.json').active.version, 1);
});

test('健康清理同时保留活动/上一启动器与服务引用，跳过未知名称并拒绝链接', async t => {
    const f = await fixture(t); const { cleanup } = require(base + 'cleanup');
    await files.atomic(f.root, 'updates/active-release.json', { codeVersion: 3, dependencyVersion: 1, taskCodeVersion: 2, pendingHealth: false });
    await files.atomic(f.root, 'updates/launcher-state.json', { active: { version: 4 }, previous: { version: 2 }, pending: { version: 5 } });
    for (const name of ['code-v1', 'code-v2', 'code-v3', 'code-v4', 'code-v5', 'code-v7', 'code-custom']) await write(f.root, `updates/code/${name}/file`, 'keep');
    await fsp.symlink(f.remote, path.join(f.root, 'updates/code/code-v6'));
    await fsp.symlink(f.remote, path.join(f.root, 'updates/code/code-v7/link'));
    const errors = await cleanup(f.root); assert.equal(errors.length, 2);
    assert.equal(fs.existsSync(path.join(f.root, 'updates/code/code-v1')), false);
    for (const name of ['code-v2', 'code-v3', 'code-v4', 'code-v5', 'code-v6', 'code-v7', 'code-custom']) assert.equal(fs.existsSync(path.join(f.root, 'updates/code', name)), true);
    await files.atomic(f.root, 'updates/active-release.json', { pendingHealth: true });
    assert.deepEqual(await cleanup(f.root), []);
});

test('独立任务包任务字节校验，task-only复用代码依赖且不覆盖任务结果', async t => {
    const f = await fixture(t); const contract = require('../src/apps/server/modules/aasc/task-code-contract');
    async function taskSource(version) {
        const task = { taskName: 'demo', codeRequirement: { minimumVersion: 1, taskCodeApiVersion: 1 }, dependencyRequirement: null,
            files: [{ path: 'main.js', size: 20, sha256: digest('module.exports = {};') }] };
        task.revision = contract.taskRevision(task);
        const inner = { format: 'aasc-task-code', schemaVersion: 1, version, taskCodeApiVersion: 1, requiredCodeVersion: 1, requiredApkVersionCode: 57, tasks: [task], retiredTaskNames: [] };
        inner.bundleSha256 = contract.bundleHash(inner);
        const relativeUrl = `task-code/task-code-v${version}.zip`;
        await zip(path.join(f.remote, relativeUrl), { 'task-code-manifest.json': inner, 'tasks/demo/main.js': 'module.exports = {};' });
        const taskCode = { ...contract.compatibility(inner), version, relativeUrl, bundleSha256: inner.bundleSha256,
            size: fs.statSync(path.join(f.remote, relativeUrl)).size, sha256: digest(fs.readFileSync(path.join(f.remote, relativeUrl))) };
        const source = await f.release(1, { taskCode }); source.components.code.taskCodeApiVersion = 1;
        source.manifest = sign(source.components); await write(f.remote, 'manifest.json', source.manifest);
        return source;
    }
    const releases = new Releases(f.config); await releases.prepare(await taskSource(1), true); await releases.healthy();
    await write(f.root, 'res/tasks/demo/results/user-file.txt', 'user data');
    const source = await taskSource(2); await releases.manifest(); assert.equal(releases.plan(source).plan, 'TASK_CODE_ONLY');
    await releases.prepare(source, false); assert.equal(releases.current().taskCodeVersion, 2);
    assert.equal(fs.readFileSync(path.join(f.root, 'res/tasks/demo/results/user-file.txt'), 'utf8'), 'user data');
    const directory = path.join(f.root, 'updates/task-code/task-code-v2'); await write(directory, 'tasks/demo/main.js', 'bad');
    await assert.rejects(releases.validateTask(directory, source.components.taskCode), /摘要/);
});

test('真正HTTP健康必须匹配版本/实际代码依赖路径和任务契约', async t => {
    const f = await fixture(t); const { health } = require(base + 'service-process');
    await fsp.mkdir(path.join(f.root, 'node_modules')); const context = { codeVersion: 1, dependencyVersion: 1, codeRoot: f.root, dependenciesRoot: f.root };
    let versions = { code: 'v1', dependencies: 'v1', codePath: f.root, dependenciesPath: path.join(f.root, 'node_modules') };
    const server = http.createServer((req, res) => { res.end(JSON.stringify({ status: 'ok', versions })); }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    f.cleanup.push(() => new Promise(resolve => server.close(resolve)));
    await write(f.root, 'config/config.json', { server: { port: server.address().port } });
    assert.equal(await health(f.config, context), true); versions = { ...versions, code: 'v2' }; assert.equal(await health(f.config, context), false);
    versions = { ...versions, code: 'v1', dependenciesPath: f.root }; assert.equal(await health(f.config, context), false);
    versions = { ...versions, dependenciesPath: path.join(f.root, 'node_modules') };
    assert.equal(await health(f.config, { ...context, taskCodeVersion: 1, taskCodeSha256: 'a'.repeat(64) }), false);
});

test('服务候选健康失败回到上一组合并回传失败，取消不提交候选', async t => {
    const f = await fixture(t); const releases = new Releases(f.config); await releases.prepare(await f.release(1), true); await releases.healthy(); await f.release(2);
    const events = []; const starts = [];
    const service = { async start(context) { starts.push(context.codeVersion); if (context.codeVersion === 2) throw new Error('健康失败'); await this.onHealthy(); }, async stop() {} };
    const controller = new Controller({ ...f.config, service, launcherVersion: 2 }, event => events.push(event));
    await assert.rejects(controller.handle({ type: 'service.apply', requestId: 'apply', payload: {} }), /健康失败/);
    assert.deepEqual(starts, [2, 1]); assert.equal(releases.current().codeVersion, 1);
    assert.ok(events.some(event => event.type === 'service.result' && event.payload.status === 'service_update_failed'));
});

test('种子基线只初始化真正首装，已有配置不覆盖；中断journal可继续', async t => {
    const f = await fixture(t); const seed = path.join(f.temp, 'seeds'); const config = JSON.stringify({ custom: 'baseline' });
    const baseline = { format: 'aasc-offline-data-baseline', schemaVersion: 1, dataVersion: 4, latestRepairVersion: 4, includedRepairs: [],
        files: [{ path: 'config/config.json', size: Buffer.byteLength(config), sha256: digest(config) }] };
    await write(seed, 'config/config.json', config); await write(seed, 'config/data-repair-state.json', baseline);
    await fsp.mkdir(path.join(seed, 'userconfig')); await fsp.mkdir(path.join(seed, 'task'));
    await restoreSeeds(seed, f.root); assert.equal(files.read(f.root, 'data-repair/state.json').dataVersion, 4);
    await write(f.root, 'config/config.json', { custom: 'user' }); await restoreSeeds(seed, f.root);
    assert.equal(files.read(f.root, 'config/config.json').custom, 'user');
    const fresh = path.join(f.temp, 'fresh'); await fsp.mkdir(fresh);
    await files.atomic(fresh, 'data-repair/seed-initializing.json', baseline); await restoreSeeds(seed, fresh);
    assert.equal(files.read(fresh, 'data-repair/state.json').dataVersion, 4); assert.equal(files.read(fresh, 'data-repair/seed-initializing.json'), null);
});

test('数据修复遵守数据/APK门槛与敏感声明，已包含修复不重复', async t => {
    const f = await fixture(t); const repair = { repairVersion: 1, repairId: 'repair-1', relativeUrl: 'data/data-repair-v1.zip', size: 1, sha256: 'a'.repeat(64),
        requiredCodeVersion: 1, requiredApkVersionCode: 57, requiredDataVersion: 0, targetDataVersion: 1, scriptSha256: 'b'.repeat(64), capabilities: ['config'], sensitive: false };
    const source = await f.release(1, { dataRepair: repair }); const releases = new Releases(f.config); await releases.manifest();
    assert.equal(releases.repairNeeded(repair), true);
    await files.atomic(f.root, 'data-repair/state.json', { dataVersion: 1, includedRepairs: [{ repairId: repair.repairId, repairVersion: 1, scriptSha256: repair.scriptSha256 }] });
    assert.equal(releases.repairNeeded(repair), false);
    await files.atomic(f.root, 'data-repair/state.json', { dataVersion: 5 }); assert.throws(() => releases.plan(source), /数据版本不兼容/);
    source.components.dataRepair.capabilities = ['chat2api.accounts']; await write(f.remote, 'manifest.json', sign(source.components));
    await assert.rejects(releases.manifest(), /授权/);
});

test('活动和上一启动器均失败时回到APK内置基线，不保留悬挂请求', async t => {
    const f = await fixture(t); const first = await candidate(f, 1, 'process.exit(9);'); const second = await candidate(f, 2, 'process.exit(8);');
    await files.atomic(f.root, 'updates/launcher-state.json', { active: second, previous: first });
    const bundleRoot = path.join(f.temp, 'baseline'); await write(bundleRoot, PREFIX + 'entry.js', mockEntry);
    const events = []; const supervisor = new Supervisor({ ...f.config, bundleRoot }, value => events.push(value)); f.cleanup.push(() => supervisor.close());
    await supervisor.start(); await until(() => events.some(event => event.type === 'launcher.ready'));
    assert.equal(files.read(f.root, 'updates/launcher-state.json').active, null);
    supervisor.request({ type: 'state.get', requestId: 'baseline-state', generation: 'test', payload: {} });
    await until(() => events.some(event => event.requestId === 'baseline-state'));
    assert.equal(events.find(event => event.requestId === 'baseline-state').result.version, 0);
});

test('候选未握手超时回退；进程重启忽略未提交候选并保留上一健康选择', async t => {
    const f = await fixture(t); const old = await candidate(f, 1, mockEntry);
    const waiting = await candidate(f, 2, "process.on('message',m=>{if(m.type==='host.stop')process.exit(0);}); setInterval(()=>{},1000);");
    await files.atomic(f.root, 'updates/launcher-state.json', { active: old, previous: null, pending: waiting });
    const bundleRoot = path.join(f.temp, 'baseline'); await write(bundleRoot, PREFIX + 'entry.js', mockEntry);
    const events = []; const supervisor = new Supervisor({ ...f.config, bundleRoot, launcherTimeoutMs: 300 }, value => events.push(value)); f.cleanup.push(() => supervisor.close());
    await supervisor.start(); await until(() => events.some(event => event.type === 'launcher.ready'));
    assert.equal(files.read(f.root, 'updates/launcher-state.json').pending, null);
    const request = { type: 'service.apply', requestId: 'timeout-switch', generation: 'test', payload: {} }; supervisor.requests.add(request.requestId);
    await supervisor.message({ type: 'launcher.switch', payload: { candidate: waiting, resume: request } });
    await until(() => events.some(event => event.requestId === request.requestId));
    assert.match(events.find(event => event.requestId === request.requestId).error, /回退/);
    assert.equal(files.read(f.root, 'updates/launcher-state.json').active.version, 1);
});

test('旧legacy-root指针只在已有版本依赖校验通过时修复，不联网且保留健康字段', async t => {
    const f = await fixture(t); const releases = new Releases(f.config); await releases.prepare(await f.release(), true); await releases.healthy();
    const pointer = files.read(f.root, 'updates/active-release.json'); await files.atomic(f.root, 'updates/active-release.json', { ...pointer, legacyDependencies: true, pendingHealth: true, previous: pointer });
    const count = f.requests.length; await releases.repairLegacy(); const current = files.read(f.root, 'updates/active-release.json');
    assert.equal(current.legacyDependencies, false); assert.equal(current.pendingHealth, true); assert.deepEqual(current.previous, pointer); assert.equal(f.requests.length, count);
});


test('健康首装开放启动页模型确认，旧安装不提前导入false或重复提示', async t => {
    const f = await fixture(t); await f.release();
    const service = { async start() { await this.onHealthy(); }, async stop() {} };
    const events = []; const controller = new Controller({ ...f.config, service }, row => events.push(row));
    const query = { front: true, launcherReady: true };
    assert.equal((await controller.firstRun(query)).show, false);
    assert.equal(files.read(f.root, 'updates/js-ui-state.json'), null);
    const preview = await controller.releases.preview();
    const installs = await Promise.all(['fresh', 'reloaded-page'].map(requestId => controller.handle({ type: 'bootstrap.install', requestId, payload: preview })));
    assert.equal(installs.length, 2);
    assert.equal(f.requests.filter(url => url === '/dependencies/dependencies-v1.zip').length, 1);
    assert.equal(files.read(f.root, 'updates/js-ui-state.json').launcherEligible, true);
    const decision = await controller.firstRun(query);
    assert.equal(decision.show, true);
    assert.equal((await controller.firstRun(query)).token, decision.token);
    await assert.rejects(controller.handle({ type: 'ui.firstRunShown', payload: { token: decision.token } }), /可见/);
    assert.equal(files.read(f.root, 'updates/js-ui-state.json').handled, false);
    await controller.handle({ type: 'ui.firstRunShown', payload: { token: decision.token, visible: true } });
    assert.equal((await controller.firstRun(query)).handled, true);
    assert.equal((await controller.handle({ type: 'state.get' })).progress, null);
    assert.equal(f.requests.some(url => url.includes('voice.bin')), false);
    const old = new Controller({ ...f.config, root: path.join(f.temp, 'old'), service }, () => {});
    old.snapshot = { status: 'ready' };
    assert.equal((await old.firstRun(query)).show, false);
    assert.equal((await old.firstRun({ front: true, displayReady: true, handled: true })).show, false);
    assert.equal(files.read(old.config.root, 'updates/js-ui-state.json').handled, true);
});

test('首装健康失败不开放提示资格，文件阶段心跳与失败清理', async t => {
    const f = await fixture(t); await f.release();
    const controller = new Controller({ ...f.config, service: { async start() { throw new Error('健康失败'); }, async stop() {} } }, () => {});
    await assert.rejects(controller.handle({ type: 'bootstrap.install', payload: await controller.releases.preview() }), /健康失败/);
    assert.equal(files.read(f.root, 'updates/js-ui-state.json'), null);
    assert.equal(controller.snapshot.phase, 'awaiting_confirmation');
    const events = []; const releases = new Releases(f.config, row => events.push(row));
    await assert.rejects(releases.operation('verifying', 'common', async () => { await new Promise(resolve => setTimeout(resolve, 1100)); throw new Error('校验失败'); }), /校验失败/);
    assert.ok(events.some(row => row.elapsedSeconds >= 1 && row.indeterminate));
    const count = events.length; await new Promise(resolve => setTimeout(resolve, 1100));
    assert.equal(events.length, count);
});
