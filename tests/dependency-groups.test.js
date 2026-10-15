'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { test } = require('node:test');
const { fixture, write } = require('./helpers/shared-update-fixture');
const shared = require('../src/apps/server/modules/aasc/shared-update-manifest');
const { buildDependencyGroups, selectFiles } = require('../scripts/ops/dependency-groups');
const { getPublishComponents, cleanupLocalPublishedArtifacts } = require('../scripts/ops/publish-offline-update');
const { selectSyncComponents } = require('../scripts/ops/sync-offline-update');
const { prepareGroupedDependencies } = require('../release/allserver-min');

async function buildFixture(t) {
    const f = await fixture(t); write(f.root, 'package.json', '{"dependencies":{"express":"4.21.2"}}'); write(f.root, 'package-lock.json', f.lock);
    let platformRevision = 'first'; let calls = 0;
    const options = { projectRoot: f.root, outputDir: f.published, workDirectory: path.join(f.root, 'build1'), dependencyVersion: 2, lockSha256: shared.hash(f.lock), source: {}, commandRunner: async (file, args, options) => {
        calls++; const os = args.find(arg => arg.startsWith('--os=')).slice(5);
        write(options.cwd, 'node_modules/express/package.json', '{"version":"4.21.2"}'); write(options.cwd, 'node_modules/express/index.js', 'same JS');
        write(options.cwd, 'node_modules/platform/package.json', JSON.stringify({ name: 'platform', version: '1.0.0', os: [os] }));
        write(options.cwd, 'node_modules/platform/resource.txt', os === 'linux' ? platformRevision : 'same platform resource');
        // 二进制目录随普通包分发，当前平台之外的prebuild必须过滤。
        write(options.cwd, 'node_modules/loader/package.json', '{"version":"1.0.0"}');
        write(options.cwd, 'node_modules/loader/prebuilds/darwin-x64/metadata.json', 'darwin');
        write(options.cwd, `node_modules/loader/prebuilds/${os}-${os === 'android' ? 'arm64' : 'x64'}/metadata.json`, os);
    } };
    return { ...f, options, calls: () => calls, revise: () => { platformRevision = 'second'; } };
}
test('三个目标安装并按声明/预编译路径拆分，不把平台包相同JS移入common', async t => {
    const f = await buildFixture(t); const first = await buildDependencyGroups(f.options); assert.equal(f.calls(), 3);
    assert.deepEqual(Object.keys(first.dependencies.groups), shared.GROUPS);
    const zip = require('../src/apps/server/modules/aasc/update-archive');
    for (const artifact of first.artifacts) {
        const name = artifact.relativeUrl.split('/')[1]; const folder = path.join(f.root, `expanded-${name}`);
        await zip.extractZip(artifact.archivePath, folder, 'dependencies');
        assert.equal(fs.existsSync(path.join(folder, 'node_modules/express/index.js')), name === 'common');
        assert.equal(fs.existsSync(path.join(folder, 'node_modules/platform/resource.txt')), name !== 'common');
        assert.equal(fs.existsSync(path.join(folder, 'node_modules/loader/prebuilds/darwin-x64')), false);
    }
});
test('仅linux64内容改变，common/android/win64保留版本及SHA，锁指纹变化不重打无关组', async t => {
    const f = await buildFixture(t); const first = await buildDependencyGroups(f.options);
    for (const artifact of first.artifacts) { const target = path.join(f.published, artifact.relativeUrl); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(artifact.archivePath, target); }
    f.revise(); const second = await buildDependencyGroups({ ...f.options, workDirectory: path.join(f.root, 'build2'), currentDependencies: first.dependencies, dependencyVersion: 3, lockSha256: 'e'.repeat(64) });
    for (const name of ['common', 'android', 'win64']) assert.deepEqual(second.dependencies.groups[name], first.dependencies.groups[name]);
    assert.equal(second.dependencies.groups.linux64.version, first.dependencies.groups.linux64.version + 1); assert.equal(second.artifacts.length, 1);
});
test('ELF x64不进入Android ARM64，即使使用无平台声明的普通包', async t => {
    const f = await fixture(t); const modules = path.join(f.root, 'native');
    write(modules, 'example/package.json', '{}'); const elf = Buffer.alloc(32); Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(elf); elf[5] = 1; elf.writeUInt16LE(62, 18); write(modules, 'example/lib.so', elf);
    assert.equal((await selectFiles(modules, shared.TARGETS.android)).has('example/lib.so'), false);
    assert.equal((await selectFiles(modules, shared.TARGETS.linux64)).has('example/lib.so'), true);
});
test('publish/sync展开四组；清理只删对应目录的数字旧版本并保留清单引用', async t => {
    const f = await fixture(t);
    assert.equal(getPublishComponents(f.manifest, 'all').length, 5); assert.equal(selectSyncComponents(f.manifest).length, 5);
    for (const group of shared.GROUPS) { write(f.published, `dependencies/${group}/dependencies-v0.zip`, 'old'); write(f.published, `dependencies/${group}/dependencies-vcustom.zip`, 'keep'); }
    write(f.published, 'dependencies/other/dependencies-v0.zip', 'keep');
    const cleanup = await cleanupLocalPublishedArtifacts(f.published, f.manifest); assert.equal(cleanup.removedRelativePaths.length, 4);
    for (const group of shared.GROUPS) { assert.ok(fs.existsSync(path.join(f.published, f.manifest.payload.components.dependencies.groups[group].relativeUrl))); assert.ok(fs.existsSync(path.join(f.published, `dependencies/${group}/dependencies-vcustom.zip`))); }
    assert.ok(fs.existsSync(path.join(f.published, 'dependencies/other/dependencies-v0.zip')));
});
test('分组清理不跟随dependencies父目录链接', async t => {
    const f = await fixture(t); const outside = path.join(f.root, 'outside'); fs.renameSync(path.join(f.published, 'dependencies'), outside);
    write(outside, 'common/dependencies-v0.zip', 'keep'); fs.symlinkSync(outside, path.join(f.published, 'dependencies'));
    await cleanupLocalPublishedArtifacts(f.published, f.manifest); assert.equal(fs.readFileSync(path.join(outside, 'common/dependencies-v0.zip'), 'utf8'), 'keep');
});
test('Node min从Offline直接安装common+linux64，后续复用缓存，无目标机npm', async t => {
    const f = await fixture(t); const codeRoot = f.source;
    for (const file of ['shared-update-manifest.js', 'task-code-contract.js', 'dependency-tree.js']) write(codeRoot, `src/apps/server/modules/aasc/${file}`, fs.readFileSync(path.resolve(__dirname, '../src/apps/server/modules/aasc', file)));
    const requests = []; const server = http.createServer((req, res) => {
        requests.push(req.url); const relative = new URL(req.url, 'http://localhost').pathname.slice(1);
        const entry = Object.values(f.manifest.payload.components.dependencies.groups).find(item => item.relativeUrl === relative);
        if (!entry) { res.statusCode = 404; res.end(); return; } fs.createReadStream(path.join(f.published, relative)).pipe(res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
    const baseUrl = `http://127.0.0.1:${server.address().port}/`;
    const candidate = { manifest: f.manifest, baseUrl };
    await prepareGroupedDependencies(candidate, codeRoot, f.root, { publicKeyPem: f.publicKeyPem, baseUrls: [baseUrl] });
    assert.equal(requests.length, 2); assert.ok(requests[0].includes('/common/')); assert.ok(requests[1].includes('/linux64/'));
    await prepareGroupedDependencies(candidate, codeRoot, f.root, { publicKeyPem: f.publicKeyPem, baseUrls: [baseUrl] });
    assert.equal(requests.length, 2); assert.equal(JSON.parse(fs.readFileSync(path.join(codeRoot, 'node_modules/express/package.json'))).version, '4.21.2');
});

test('真实发布all和code-only保留分组，镜像第二次只复用已校验文件', async t => {
    const f = await fixture(t); const { publishOfflineUpdate } = require('../scripts/ops/publish-offline-update');
    const target = path.join(f.root, 'release-target');
    const options = { artifactRoot: f.published, manifestPath: path.join(f.published, 'manifest.json'), publicKeyPem: f.publicKeyPem, localRoot: target };
    const first = await publishOfflineUpdate({ ...options, mode: 'all' }); assert.equal(first.localPublishedPaths.length, 6); assert.deepEqual(first.cleanupErrors, []);
    const second = await publishOfflineUpdate({ ...options, mode: 'code-only' }); assert.deepEqual(second.localPublishedPaths.sort(), ['code/code-v2.zip', 'manifest.json']);
    const server = http.createServer((req, res) => {
        const relative = new URL(req.url, 'http://localhost').pathname.slice(1);
        const entries = ['manifest.json', ...getPublishComponents(f.manifest, 'all').map(item => item.relativeUrl)];
        if (!entries.includes(relative)) { res.statusCode = 404; res.end(); return; } fs.createReadStream(path.join(target, relative)).pipe(res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
    const { syncOfflineUpdate } = require('../scripts/ops/sync-offline-update');
    const syncOptions = { sourceUrl: `http://127.0.0.1:${server.address().port}/`, localRoot: path.join(f.root, 'mirror'), publicKeyPem: f.publicKeyPem };
    const synced = await syncOfflineUpdate(syncOptions); assert.equal(synced.installed.length, 5);
    const repeated = await syncOfflineUpdate(syncOptions); assert.equal(repeated.installed.length, 0); assert.equal(repeated.skipped.length, 5);
});

test('控制端自测读取实际版本目录并明确暴露受管更新失败', async () => {
    const vm = require('node:vm'); let payload = { versions: { code: 'v79', dependencies: 'v9', codePath: '/data/code', dependenciesPath: '/data/dependencies/node_modules', dependencySource: 'target-node' } };
    const sandbox = { window: {}, fetch: async () => ({ ok: true, json: async () => payload }), setTimeout, clearTimeout };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/self-test.js'), 'utf8'), sandbox);
    const test = sandbox.window.SelfTest.tests.find(item => item.id === 'server_runtime_version');
    assert.equal((await test.run()).success, true);
    payload.versions.update = { status: 'failed', message: '依赖组不兼容，已回滚' };
    const result = await test.run(); assert.equal(result.success, false); assert.match(result.details, /已回滚/);
});

test('Node26流式ZIP展开覆盖超过64KiB压缩数据的大文件背压，不停在未完成Promise', async t => {
    const crypto = require('node:crypto'); const f = await fixture(t);
    const directory = path.join(f.root, 'large-source'); const content = crypto.randomBytes(2 * 1024 * 1024);
    write(directory, 'node_modules/large/data.bin', content);
    const archive = path.join(f.root, 'large.zip'); await require('../scripts/ops/dependency-groups').deterministicZip(directory, archive);
    const output = path.join(f.root, 'large-extracted');
    const { extractZip } = require('../src/apps/server/modules/aasc/update-archive');
    const timeout = setTimeout(() => { throw new Error('大ZIP展开超时'); }, 8000);
    try { await extractZip(archive, output, 'dependencies'); assert.deepEqual(fs.readFileSync(path.join(output, 'node_modules/large/data.bin')), content); }
    finally { clearTimeout(timeout); }
});
