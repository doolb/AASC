'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { fixture, write, privateKeyPem } = require('./helpers/shared-update-fixture');
const shared = require('../src/apps/server/modules/aasc/shared-update-manifest');
const archive = require('../src/apps/server/modules/aasc/update-archive');
const closure = require('../src/apps/server/modules/aasc/dependency-closure');
const { buildDependencyGroups } = require('../scripts/ops/dependency-groups');
const { TaskDependencyManager } = require('../src/apps/server/modules/aasc/task-dependency-manager');
const { PiProfileConfig } = require('../src/apps/server/modules/chat/pi-profile-config');
const { normalizeAgentProfile } = require('../src/apps/server/modules/chat/pi-runtime-policy');

/** 使用真实三组ZIP、签名和Node ESM入口验证闭包，不依赖测试机的Pi模块回退。 */
async function piFixture(t) {
    const f = await fixture(t);
    const pkg = { dependencies: { express: '4.21.2' }, optionalDependencies: Object.fromEntries(closure.PI_PACKAGES.map(name => [name, '0.84.2'])) };
    const lock = { lockfileVersion: 3, packages: { '': pkg,
        'node_modules/express': { version: '4.21.2', dependencies: { 'pi-shared': '1.0.0' } },
        'node_modules/pi-shared': { version: '1.0.0' },
        'node_modules/@earendil-works/pi-ai': { version: '0.84.2', optional: true, dependencies: { 'pi-shared': '1.0.0' } },
        'node_modules/@earendil-works/pi-coding-agent': { version: '0.84.2', optional: true, dependencies: { '@earendil-works/pi-ai': '0.84.2' } }
    } };
    write(f.source, 'package.json', JSON.stringify(pkg));
    write(f.source, 'package-lock.json', JSON.stringify(lock));
    const lockSha256 = shared.hash(JSON.stringify(lock));
    f.manifest.payload.components.code.requiredLockSha256 = lockSha256;
    const built = await buildDependencyGroups({ projectRoot: f.source, outputDir: f.published,
        workDirectory: path.join(f.root, 'build'), dependencyVersion: 2, lockSha256, source: {},
        commandRunner: async (_file, _args, options) => {
            write(options.cwd, 'node_modules/express/package.json', JSON.stringify({ name: 'express', version: '4.21.2' }));
            write(options.cwd, 'node_modules/pi-shared/package.json', JSON.stringify({ name: 'pi-shared', type: 'module', version: '1.0.0', exports: './index.js' }));
            write(options.cwd, 'node_modules/pi-shared/index.js', 'export const marker = "isolated closure";');
            for (const name of closure.PI_PACKAGES) {
                write(options.cwd, `node_modules/${name}/package.json`, JSON.stringify({ name, type: 'module', version: '0.84.2', dependencies: lock.packages[`node_modules/${name}`].dependencies, exports: './dist/index.js' }));
            }
            write(options.cwd, 'node_modules/@earendil-works/pi-ai/dist/index.js', 'export {marker} from "pi-shared";');
            write(options.cwd, 'node_modules/@earendil-works/pi-coding-agent/dist/index.js', 'export {marker} from "@earendil-works/pi-ai";');
        } });
    for (const artifact of built.artifacts) {
        const destination = path.join(f.published, artifact.relativeUrl);
        fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(artifact.archivePath, destination);
    }
    f.manifest.payload.components.dependencies = built.dependencies;
    f.manifest.payload.components.code.requiredDependencyVersion = 2;
    f.manifest.payload.components.taskDependencies = built.taskDependencies;
    await f.sign();
    built.dependencies.sha256 = shared.hash(shared.canonicalJson(built.dependencies.groups));
    built.dependencies.size = Object.values(built.dependencies.groups).reduce((sum, entry) => sum + entry.size, 0);
    f.manifest.signature.value = require('node:crypto').sign('RSA-SHA256', Buffer.from(shared.canonicalJson(f.manifest.payload)), privateKeyPem).toString('base64');
    return { ...f, built, options: { projectRoot: f.root, codeRoot: f.source, publicKeyPem: f.publicKeyPem,
        runtime: { platform: 'linux', arch: 'x64', libc: 'glibc' }, baseUrls: ['http://fixture.test/'],
        requestJson: async () => f.manifest, download: async (url, destination) => {
            await fs.promises.copyFile(path.join(f.published, new URL(url).pathname.slice(1)), destination);
        } } };
}

test('三平台Pi制品包含完整闭包，基础四组保留共享包；真实ESM从签名独立缓存导入', async t => {
    const f = await piFixture(t);
    assert.deepEqual(Object.keys(f.built.taskDependencies), ['pi-agent-android', 'pi-agent-linux64', 'pi-agent-win64']);
    const common = path.join(f.root, 'common');
    await archive.extractZip(path.join(f.published, f.built.dependencies.groups.common.relativeUrl), common, 'dependencies');
    assert.equal(fs.existsSync(path.join(common, 'node_modules/@earendil-works')), false);
    assert.ok(fs.existsSync(path.join(common, 'node_modules/pi-shared')));
    const manager = new TaskDependencyManager(f.options);
    assert.equal(await manager.isReady('pi-agent-linux64'), false);
    await manager.ensure(['pi-agent-linux64']);
    const root = manager.moduleRoot('pi-agent-linux64');
    const loaded = await import(require('node:url').pathToFileURL(path.join(root, '@earendil-works/pi-coding-agent/dist/index.js')).href);
    assert.equal(loaded.marker, 'isolated closure');
    const restarted = new TaskDependencyManager({ ...f.options, requestJson: async () => { throw new Error('离线不得联网'); } });
    assert.equal(await restarted.isReady('pi-agent-linux64'), true);
    await restarted.ensure(['pi-agent-linux64']);
    assert.equal(restarted.moduleRoot('pi-agent-linux64'), root);
    assert.equal(fs.existsSync(path.join(f.root, 'node_modules/@earendil-works/pi-coding-agent')), false);
});

test('Pi目标契约错配、真实子包版本篡改和缺必需闭包都拒绝', async t => {
    const f = await piFixture(t);
    const manager = new TaskDependencyManager(f.options);
    await assert.rejects(manager.ensure(['pi-agent-android']), /平台\/Node ABI/);
    await manager.ensure(['pi-agent-linux64']);
    const root = manager.moduleRoot('pi-agent-linux64');
    const versions = f.built.taskDependencies['pi-agent-linux64'].packageVersions;
    const packageFile = path.join(root, 'pi-shared/package.json');
    fs.writeFileSync(packageFile, '{"version":"9.0.0"}');
    assert.throws(() => manager.verifyPiPackages(root, versions), /真实依赖版本/);
    const missing = { ...versions }; delete missing['node_modules/pi-shared'];
    assert.throws(() => manager.verifyPiPackages(root, missing), /必需依赖/);
    await assert.rejects(manager.isReady('pi-agent-linux64'), /内容指纹/);
});

function configFixture(profiles = [{ name: 'direct', mode: 'llm' }]) {
    let current = profiles.map(profile => ({ ...profile }));
    let active = current[0]?.name || 'default';
    let persisted = { llmProfiles: current, activeProfile: active };
    let ready = false;
    let prepares = 0;
    let writes = 0;
    const broadcasts = [];
    const chat = { getProfiles: () => current.map(profile => ({ ...profile })), getActiveProfile: () => active,
        normalizeLlmProfile: normalizeAgentProfile, getConfig: () => ({}), pickGlobalChatConfig: value => value,
        setProfiles: value => { current = value; }, switchProfile: name => { active = name; } };
    const config = { get: () => persisted, set: (_key, value) => { writes++; persisted = value; return true; } };
    const dependencies = { piDependencyId: () => 'pi-agent-linux64', isReady: async () => ready,
        ensure: async (_ids, notify) => { prepares++; notify({ percent: 100 }); ready = true; }, moduleRoot: () => '/isolated/node_modules' };
    const coordinator = new PiProfileConfig({ chat, config, dependencies, broadcast: message => broadcasts.push(message) });
    return { coordinator, chat, config, dependencies, broadcasts, counts: () => ({ writes, prepares }), persisted: () => persisted };
}
const pi = { name: 'agent', mode: 'agent', backend: 'pi' };

test('保存Pi先返回下载确认且不写配置；确认后准备成功才持久化并广播权威值', async () => {
    const f = configFixture();
    const candidate = { type: 'chatProfilesSave', profiles: [pi] };
    const preview = await f.coordinator.update(candidate);
    assert.equal(preview.status, 'downloadRequired');
    assert.deepEqual(f.counts(), { writes: 0, prepares: 0 });
    assert.equal(f.chat.getProfiles()[0].name, 'direct');
    const saved = await f.coordinator.update({ ...candidate, revision: preview.revision, downloadConfirmed: true });
    assert.equal(saved.status, 'success');
    assert.deepEqual(f.counts(), { writes: 1, prepares: 1 });
    assert.equal(f.persisted().llmProfiles[0].backend, 'pi');
    assert.ok(f.broadcasts.some(message => message.type === 'chatProfilesConfig' && message.activeProfile === 'agent'));
    const again = await f.coordinator.update(candidate);
    assert.equal(again.status, 'success');
});

test('下载失败和下载期间另一控制端改配置时保留旧权威值；失败允许下次重试', async () => {
    const f = configFixture();
    const ensure = f.dependencies.ensure;
    f.dependencies.ensure = async () => { throw new Error('下载失败'); };
    const candidate = { type: 'chatProfilesSave', profiles: [pi], downloadConfirmed: true };
    const failed = await f.coordinator.update(candidate);
    assert.equal(failed.status, 'error');
    assert.equal(failed.profiles[0].name, 'direct');
    assert.equal(f.counts().writes, 0);
    f.dependencies.ensure = async () => { f.chat.setProfiles([{ name: 'other', mode: 'llm' }]); await ensure([], () => {}); };
    const conflict = await f.coordinator.update(candidate);
    assert.equal(conflict.status, 'error');
    assert.match(conflict.message, /配置已发生变化/);
    assert.equal(conflict.profiles[0].name, 'other');
    assert.equal(f.counts().writes, 0);
});

test('启动检查已保存Pi并共享准备，普通LLM/Codex不下载，磁盘失败不改变聊天内存', async () => {
    for (const profile of [{ name: 'llm', mode: 'llm' }, { ...pi, backend: 'codex' }]) {
        const f = configFixture([profile]); await f.coordinator.startup(); assert.equal(f.counts().prepares, 0);
    }
    const f = configFixture([pi]);
    await Promise.all([f.coordinator.startup(), f.coordinator.prepare()]);
    assert.equal(f.counts().prepares, 1);
    const old = f.chat.getProfiles();
    f.config.set = () => false;
    const failed = await f.coordinator.update({ type: 'chatProfilesSave', profiles: [{ name: 'new', mode: 'llm' }] });
    assert.equal(failed.status, 'error'); assert.deepEqual(f.chat.getProfiles(), old);
});

test('启动和保存普通LLM不因未使用Pi配置下载；主动保存或切换Pi才提示', async () => {
    const f = configFixture([{ name: 'direct', mode: 'llm' }, pi]);
    await f.coordinator.startup();
    assert.equal(f.counts().prepares, 0);
    const direct = await f.coordinator.update({ type: 'chatProfilesSave', profileName: 'direct',
        profiles: [{ name: 'direct', mode: 'llm', model: 'new' }, pi] });
    assert.equal(direct.status, 'success'); assert.equal(f.counts().prepares, 0);
    const savedPi = await f.coordinator.update({ type: 'chatProfilesSave', profileName: 'agent', profiles: f.chat.getProfiles() });
    assert.equal(savedPi.status, 'downloadRequired');
    const switched = await f.coordinator.update({ type: 'chatProfileSwitch', name: 'agent' });
    assert.equal(switched.status, 'downloadRequired');
    assert.equal(f.chat.getActiveProfile(), 'direct');
});

test('模型快选把当前 LLM 模型名和 Provider 档位偏好一次写入同一配置', async () => {
    const f = configFixture([{ name: 'direct', mode: 'llm', model: 'old' }, pi]);
    const preference = { providerId: 'qwen', tiersByProvider: { qwen: 'mini', doubaochat: 'mini' } };
    await f.coordinator.updateActiveModel('Qwen3.6-Flash', preference);
    assert.deepEqual(f.counts(), { writes: 1, prepares: 0 });
    assert.equal(f.persisted().llmProfiles[0].model, 'Qwen3.6-Flash');
    assert.equal(f.persisted().model, 'Qwen3.6-Flash');
    assert.deepEqual(f.persisted().modelTierSelection, preference);
    assert.equal(f.chat.getProfiles()[0].model, 'Qwen3.6-Flash');
    assert.ok(f.broadcasts.some(message => message.type === 'chatProfilesConfig'
        && message.profiles[0].model === 'Qwen3.6-Flash'));
    const failure = configFixture([{ name: 'direct', mode: 'llm', model: 'old' }]);
    failure.config.set = () => false;
    await assert.rejects(failure.coordinator.updateActiveModel('doubao', preference), /持久化失败/);
    assert.equal(failure.chat.getProfiles()[0].model, 'old');
    await f.coordinator.update({ type: 'chatProfileSwitch', name: 'agent', downloadConfirmed: true });
    await assert.rejects(f.coordinator.updateActiveModel('doubao', preference), /不是普通 LLM/);
});

function browserFixture(confirmDownload, errorAfterConfirm = false) {
    const fields = new Map();
    const document = { getElementById: id => {
        if (!fields.has(id)) fields.set(id, { value: '', style: {} }); return fields.get(id);
    } };
    const old = { name: 'direct', apiUrl: 'http://model.test', model: 'test', mode: 'llm' };
    const sent = [];
    let chat;
    const window = { confirm: () => confirmDownload, showToast: () => {}, WebSocketManager: { ws: { readyState: 1,
        send: text => {
            const data = JSON.parse(text); sent.push(data);
            queueMicrotask(() => chat.handleProfilesConfig({ requestId: data.requestId, revision: 'old', activeProfile: 'direct',
                profiles: !data.downloadConfirmed || errorAfterConfirm ? [old] : data.profiles,
                status: data.downloadConfirmed ? errorAfterConfirm ? 'error' : 'success' : 'downloadRequired', message: '下载？' }));
        } } } };
    const context = vm.createContext({ window, document, console, setTimeout, clearTimeout });
    vm.runInContext(fs.readFileSync('src/apps/web-mediacenter/ui/public/js/chat.js', 'utf8'), context);
    chat = window.Chat; chat.renderProfileSelector = () => {}; chat.profiles = [old]; chat.activeProfile = 'direct'; chat.profileRevision = 'old';
    chat.editProfile('direct'); document.getElementById('profileEditMode').value = 'agent';
    return { chat, fields, sent, old };
}

test('实际控制端saveProfile取消确认恢复原表单与配置，不发送下载确认', async () => {
    const f = browserFixture(false); await f.chat.saveProfile();
    assert.equal(f.sent.length, 1);
    assert.equal(f.chat.profiles[0].mode, 'llm');
    assert.equal(f.fields.get('profileEditMode').value, 'llm');
    assert.equal(f.chat.profileRequests.size, 0);
});

test('实际控制端确认携带旧指纹；失败恢复表单，成功才应用Pi配置', async () => {
    for (const fail of [false, true]) {
        const f = browserFixture(true, fail); await f.chat.saveProfile();
        assert.equal(f.sent.length, 2); assert.equal(f.sent[1].downloadConfirmed, true); assert.equal(f.sent[1].revision, 'old');
        assert.equal(f.chat.profiles[0].mode, fail ? 'llm' : 'agent');
        assert.equal(f.chat.profileSaving, false);
    }
});
