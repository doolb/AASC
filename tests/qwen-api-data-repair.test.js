'use strict';

// 对应.src/framework/qwen-api-data-repair.md：通过真实runner测试签名脚本，所有配置仅写临时目录。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDataRepairRunner, sha256Buffer } = require('../src/apps/server/modules/data-repair/data-repair-js-runner');
const { normalizeSettings, redactSettings } = require('../src/apps/server/modules/tts/tts-provider-settings');
const { prepareReleaseRepairs } = require('../scripts/ops/offline-data-repair-seeds');
const { readBaseline, verifyBaselineFiles } = require('../src/apps/server/modules/data-repair/data-repair-baseline');
const { DEFAULT_MODEL_MAPPINGS } = require('../src/apps/server/modules/chat2api/chat2api-default-model-mappings');
const catalog = require('../src/apps/server/modules/chat2api/qwen-audio-31-voices.json');

const script = path.resolve(__dirname, '../release/offline-update/repair-sources/qwen-api-defaults-v4/repair.js');
const targetModel = 'qwen-audio-3.1-tts-flash';
const targetVoice = 'qiaoxiaojiao_v3.1';
const clone = value => JSON.parse(JSON.stringify(value));

async function fixture(t, options = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-qwen-repair-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const configFile = path.join(root, 'config.json');
    const userFile = path.join(root, 'userconfig.json');
    const mappingFile = path.join(root, 'mappings.json');
    const stateFile = path.join(root, 'data-repair/state.json');
    const settings = normalizeSettings({
        providers: { 'qwen-api': { model: 'qwen3-tts-flash', defaultVoice: 'Cherry', credential: 'test-secret', defaultSpeed: 4 },
            'doubao-api': { defaultSpeed: -2, credential: 'other-secret' } },
        aiReplyDefault: { provider: 'qwen-api', voice: 'Cherry' },
        textMedia: { provider: 'qwen-api', voice: 'Serena' },
        systemBroadcast: { provider: 'system', voice: null }, defaultVolume: 63,
        ...options.settings
    });
    let current = settings;
    let saveCount = 0;
    const logs = [];
    const writeSettings = async () => {
        await fs.writeFile(configFile, JSON.stringify({ keep: 'main', aiReplyDefault: current.aiReplyDefault,
            textMedia: current.textMedia, systemBroadcast: current.systemBroadcast, defaultVolume: current.defaultVolume,
            voiceprint: { acceptVoiceInputDuringTtsWithoutVoiceprint: options.version !== 0 } }));
        await fs.writeFile(userFile, JSON.stringify({ keep: 'user', providers: current.providers,
            displayStates: { 'offline-display': { displayId: 'offline-display', showStatusBar: true } } }));
    };
    await writeSettings();
    await fs.writeFile(mappingFile, JSON.stringify(options.mappings || []));
    const metadata = { format: 'aasc-offline-data-repair', schemaVersion: 1,
        repairId: 'migrate-qwen-api-defaults-v4', repairVersion: 4, requiredCodeVersion: 104,
        requiredApkVersionCode: 46, requiredDataVersion: 0, targetDataVersion: 4,
        compatibleDataVersions: [0, 1, 2, 3], capabilities: ['config', 'user-config', 'chat2api.model-mappings'],
        script: 'repair.js', scriptSha256: sha256Buffer(await fs.readFile(script)) };
    await fs.copyFile(script, path.join(root, 'repair.js'));
    await fs.mkdir(path.dirname(stateFile));
    const version = options.version ?? 3;
    const state = { dataVersion: version, latestRepairVersion: version, appliedRepairs: [] };
    await fs.writeFile(stateFile, JSON.stringify(state));
    const writePending = () => fs.writeFile(path.join(root, 'data-repair/pending-repair.json'), JSON.stringify(metadata));
    await writePending();
    const readDisk = async () => ({ config: JSON.parse(await fs.readFile(configFile)), user: JSON.parse(await fs.readFile(userFile)),
        mappings: JSON.parse(await fs.readFile(mappingFile)), state: JSON.parse(await fs.readFile(stateFile)) });
    const config = {
        getPublicTtsProviderSettings: () => redactSettings(current),
        getTtsProviderSettings: () => { throw Error('禁止读取未脱敏配置'); },
        async setTtsProviderSettings(patch) {
            saveCount++;
            if (options.ignoreSave) return redactSettings(current);
            current = normalizeSettings(patch, current);
            await writeSettings();
            if (options.failSave) throw Error('模拟双配置写入后失败');
            return redactSettings(current);
        },
        async reloadForDataRepair() {
            const disk = await readDisk();
            current = { ...current, providers: disk.user.providers, aiReplyDefault: disk.config.aiReplyDefault,
                textMedia: disk.config.textMedia, systemBroadcast: disk.config.systemBroadcast, defaultVolume: disk.config.defaultVolume };
        },
        get(key) {
            if (key === 'voiceprint.acceptVoiceInputDuringTtsWithoutVoiceprint') return true;
            throw Error('意外读取字段');
        },
        async set(key, value) {
            assert.equal(key, 'voiceprint.acceptVoiceInputDuringTtsWithoutVoiceprint');
            const data = JSON.parse(await fs.readFile(configFile));
            data.voiceprint = { acceptVoiceInputDuringTtsWithoutVoiceprint: value };
            await fs.writeFile(configFile, JSON.stringify(data));
        },
        async updateDisplayStateById(id, unused, patch) {
            const data = JSON.parse(await fs.readFile(userFile));
            Object.assign(data.displayStates[id], patch);
            await fs.writeFile(userFile, JSON.stringify(data));
            return data.displayStates[id];
        }
    };
    const runner = createDataRepairRunner({ projectRoot: root, codeVersion: options.codeVersion ?? 104, apkVersionCode: 58,
        services: { config, chat2api: {
            async listModelMappings(query) { assert.equal(query.includeDefaults, false); return JSON.parse(await fs.readFile(mappingFile)); },
            async saveModelMapping(rule) { const values = JSON.parse(await fs.readFile(mappingFile)); values.push(rule); await fs.writeFile(mappingFile, JSON.stringify(values)); }
        } }, managedFiles: [configFile, userFile, mappingFile],
        logger: { info: value => logs.push(value), error: value => logs.push(value) } });
    return { root, runner, readDisk, writePending, logs, settings, saveCount: () => saveCount,
        current: () => clone(current), before: await readDisk() };
}

test('修复迁移旧默认和三个业务旧音色，保留凭证/独立语速/音量及非Qwen选择', async t => {
    const fx = await fixture(t);
    assert.equal((await fx.runner.applyPendingRepair()).status, 'applied');
    const after = fx.current();
    const expected = clone(fx.settings);
    Object.assign(expected.providers['qwen-api'], { model: targetModel, defaultVoice: targetVoice });
    // 此模拟服务没有休眠字段存储；原业务服务的已存语速保留由下方真实种子用例验证。
    expected.providers['qwen-api'].defaultSpeed = 0;
    // 模型切换会由原业务服务选择相应官方端点，不允许修复脚本直接改端点或凭证。
    expected.providers['qwen-api'].endpoint = after.providers['qwen-api'].endpoint;
    expected.aiReplyDefault.voice = targetVoice;
    expected.textMedia.voice = targetVoice;
    assert.deepEqual(after, expected);
    assert.equal((await fx.readDisk()).state.dataVersion, 4);
    await fx.writePending();
    assert.equal((await fx.runner.applyPendingRepair()).status, 'skipped');
    assert.equal(fx.saveCount(), 1);
});

test('三个Qwen业务显式旧音色全部替换，继承默认的空选择保持', async t => {
    const fx = await fixture(t, { settings: {
        aiReplyDefault: { provider: 'qwen-api', voice: 'Ethan' },
        textMedia: { provider: 'qwen-api', voice: null },
        systemBroadcast: { provider: 'qwen-api', voice: 'Chelsie' }
    } });
    await fx.runner.applyPendingRepair();
    assert.equal(fx.current().aiReplyDefault.voice, targetVoice);
    assert.equal(fx.current().systemBroadcast.voice, targetVoice);
    assert.equal(fx.current().textMedia.voice, null);
});

test('3.1残留旧业务音色修复，同时保留有效英文音色大小写', async t => {
    const fx = await fixture(t, { settings: { providers: { 'qwen-api': { model: targetModel, defaultVoice: 'Emily_v3.1' } } } });
    await fx.runner.applyPendingRepair();
    assert.equal(fx.current().providers['qwen-api'].defaultVoice, 'Emily_v3.1');
    assert.equal(fx.current().aiReplyDefault.voice, targetVoice);
});

test('空默认音色回填乔小娇', async t => {
    const fx = await fixture(t, { settings: { providers: { 'qwen-api': { model: 'qwen3-tts-flash', defaultVoice: null } } } });
    await fx.runner.applyPendingRepair();
    assert.equal(fx.current().providers['qwen-api'].defaultVoice, targetVoice);
});

test('旧模型已选有效3.1音色时只迁移模型，保留该音色', async t => {
    const fx = await fixture(t, { settings: { providers: { 'qwen-api': { model: 'qwen3-tts-flash', defaultVoice: 'Emily_v3.1' } },
        aiReplyDefault: { provider: 'qwen-api', voice: 'Luna_v3.1' } } });
    await fx.runner.applyPendingRepair();
    assert.equal(fx.current().providers['qwen-api'].model, targetModel);
    assert.equal(fx.current().providers['qwen-api'].defaultVoice, 'Emily_v3.1');
    assert.equal(fx.current().aiReplyDefault.voice, 'Luna_v3.1');
});

test('无关自定义映射不阻止迁移且保留原数据', async t => {
    const fx = await fixture(t, { mappings: [{ model: 'my-text-model', actualModel: 'private-text', providerId: 'qwen' }] });
    await fx.runner.applyPendingRepair();
    assert.equal(fx.current().providers['qwen-api'].model, targetModel);
    assert.deepEqual((await fx.readDisk()).mappings, fx.before.mappings);
});

test('修复上下文只开放脱敏TTS读取，原始配置getter不暴露', async t => {
    const fx = await fixture(t);
    const source = `module.exports = async ({ services, assert }) => {
        assert(typeof services.config.getTtsProviderSettings === 'undefined', '原始getter不应开放');
        const settings = await services.config.getPublicTtsProviderSettings();
        assert(!JSON.stringify(settings).includes('test-secret'), '脱敏配置泄漏凭证');
        assert(typeof services.config.setTtsProviderSettings === 'function', '业务保存未开放');
    };`;
    await fs.writeFile(path.join(fx.root, 'repair.js'), source);
    const pendingFile = path.join(fx.root, 'data-repair/pending-repair.json');
    const pending = JSON.parse(await fs.readFile(pendingFile));
    pending.scriptSha256 = sha256Buffer(Buffer.from(source));
    await fs.writeFile(pendingFile, JSON.stringify(pending));
    assert.equal((await fx.runner.applyPendingRepair()).status, 'applied');
    assert.equal(fx.saveCount(), 0);
});

for (const [name, settings, status] of [
    ['有效3.1选择', { providers: { 'qwen-api': { model: targetModel, defaultVoice: 'Emily_v3.1' } },
        aiReplyDefault: { provider: 'qwen-api', voice: 'Luna_v3.1' }, textMedia: { provider: 'system', voice: null } }, 'already-current'],
    ['自定义模型', { providers: { 'qwen-api': { model: 'qwen-audio-3.0-tts-flash', defaultVoice: 'custom' } } }, 'skipped-custom-model'],
    ['未知默认音色', { providers: { 'qwen-api': { model: 'qwen3-tts-flash', defaultVoice: 'my-voice' } } }, 'skipped-custom-voice'],
    ['未知业务音色', { aiReplyDefault: { provider: 'qwen-api', voice: 'my-voice' } }, 'skipped-custom-voice'],
    ['大小写不符的英文音色', { aiReplyDefault: { provider: 'qwen-api', voice: 'emily_v3.1' } }, 'skipped-custom-voice']
]) {
    test(`${name}整体保留，记录明确跳过原因`, async t => {
        const fx = await fixture(t, { settings });
        assert.equal((await fx.runner.applyPendingRepair()).status, 'applied');
        assert.deepEqual(fx.current(), fx.settings);
        assert.equal(fx.saveCount(), 0);
        assert.ok(fx.logs.some(value => value.includes(status)));
    });
}

for (const model of ['qwen3-tts-flash', targetModel, 'QWEN*', '*']) {
    test(`自定义映射${model}保留，不自动改变实际模型或音色`, async t => {
        const fx = await fixture(t, { mappings: [{ model, actualModel: 'my-model', providerId: 'qwenapi' }] });
        await fx.runner.applyPendingRepair();
        assert.deepEqual(fx.current(), fx.settings);
        assert.deepEqual((await fx.readDisk()).mappings, fx.before.mappings);
        assert.ok(fx.logs.some(value => value.includes('skipped-custom-mapping')));
    });
}

for (const failure of ['failSave', 'ignoreSave']) {
    test(`${failure}导致修复失败时双配置/内存/数据版本均回滚`, async t => {
        const fx = await fixture(t, { [failure]: true });
        const result = await fx.runner.applyPendingRepair();
        assert.equal(result.status, 'rolled-back');
        assert.deepEqual(await fx.readDisk(), fx.before);
        assert.deepEqual(fx.current(), fx.settings);
        assert.equal(await fs.stat(path.join(fx.root, 'data-repair/pending-repair.json')).then(() => true), true);
    });
}

test('未知数据版本和未升级配套服务均不写配置', async t => {
    for (const options of [{ version: 9 }, { codeVersion: 103 }]) {
        const fx = await fixture(t, options);
        assert.equal((await fx.runner.applyPendingRepair()).status, options.version ? 'rejected-data-version' : 'waiting-code-version');
        assert.deepEqual(await fx.readDisk(), fx.before);
        assert.equal(fx.saveCount(), 0);
    }
});

test('签名脚本的固定3.1音色集合与官方68项源完全一致', async () => {
    const source = await fs.readFile(script, 'utf8');
    const match = source.match(/const validVoices = (\[[\s\S]*?\]);/u);
    assert.ok(match);
    assert.deepEqual(JSON.parse(match[1]), catalog.voices.map(item => item.id));
});

// 同时覆盖真实业务服务/worker/种子提交：不以模拟getter代替配置实际落盘。
for (const version of [0, 1, 2, 3]) {
    test(`数据${version}真实业务种子累计到4，保留用户凭据与已完成历史偏好`, async t => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-qwen-seed-'));
        t.after(() => fs.rm(root, { recursive: true, force: true }));
        const releaseRoot = path.join(root, 'release');
        for (const name of ['config', 'userconfig', 'task']) await fs.mkdir(path.join(releaseRoot, name), { recursive: true });
        const configuration = { keep: 'main', voiceprint: { acceptVoiceInputDuringTtsWithoutVoiceprint: version > 0 },
            tts: { aiReplyDefault: { provider: 'qwen-api', voice: 'Cherry' }, textMedia: { provider: 'qwen-api', voice: 'Serena' },
                systemBroadcast: { provider: 'system', voice: null }, sharedParameters: { defaultVolume: 63 } } };
        const user = { keep: 'user', displayStates: { 'offline-display': { displayId: 'offline-display', showStatusBar: true } },
            tts: { providers: { 'qwen-api': { model: 'qwen3-tts-flash', defaultVoice: 'Cherry', defaultSpeed: 4, credential: 'seed-test-secret' },
                'doubao-api': { credential: 'other-test-secret', defaultSpeed: -2 } } } };
        await fs.writeFile(path.join(releaseRoot, 'config/config.json'), JSON.stringify(configuration));
        await fs.writeFile(path.join(releaseRoot, 'userconfig/userconfig.json'), JSON.stringify(user));
        const files = [];
        for (const name of ['config/config.json', 'userconfig/userconfig.json']) {
            const bytes = await fs.readFile(path.join(releaseRoot, name));
            files.push({ path: name, size: bytes.length, sha256: sha256Buffer(bytes) });
        }
        await fs.writeFile(path.join(releaseRoot, 'config/data-repair-state.json'), JSON.stringify({
            format: 'aasc-offline-data-baseline', schemaVersion: 1, dataVersion: version,
            latestRepairVersion: version, includedRepairs: [], files }));
        const metadata = { repairId: 'migrate-qwen-api-defaults-v4', repairVersion: 4, requiredCodeVersion: 104,
            requiredApkVersionCode: 46, requiredDataVersion: 0, targetDataVersion: 4, compatibleDataVersions: [0, 1, 2, 3],
            capabilities: ['config', 'user-config', 'chat2api.model-mappings'], scriptSha256: sha256Buffer(await fs.readFile(script)) };
        const transaction = await prepareReleaseRepairs({ projectRoot: root, repairs: [{ script, metadata }] });
        t.after(transaction.dispose);
        assert.equal((await readBaseline(releaseRoot)).dataVersion, version);
        await transaction.commit();
        const saved = JSON.parse(await fs.readFile(path.join(releaseRoot, 'userconfig/userconfig.json')));
        const savedConfig = JSON.parse(await fs.readFile(path.join(releaseRoot, 'config/config.json')));
        assert.equal(saved.tts.providers['qwen-api'].model, targetModel);
        assert.equal(saved.tts.providers['qwen-api'].defaultVoice, targetVoice);
        assert.equal(saved.tts.providers['qwen-api'].credential, 'seed-test-secret');
        assert.equal(saved.tts.providers['qwen-api'].defaultSpeed, 4);
        assert.equal(saved.tts.providers['doubao-api'].credential, 'other-test-secret');
        assert.equal(saved.tts.providers['doubao-api'].defaultSpeed, -2);
        assert.equal(savedConfig.tts.aiReplyDefault.voice, targetVoice);
        assert.equal(savedConfig.tts.textMedia.voice, targetVoice);
        assert.equal(savedConfig.tts.sharedParameters.defaultVolume, 63);
        assert.equal(saved.displayStates['offline-display'].showStatusBar, version >= 2);
        assert.equal(savedConfig.voiceprint.acceptVoiceInputDuringTtsWithoutVoiceprint, true);
        assert.equal(saved.keep, 'user'); assert.equal(savedConfig.keep, 'main');
        const baseline = await readBaseline(releaseRoot);
        assert.equal(baseline.dataVersion, 4);
        await verifyBaselineFiles(releaseRoot, baseline);
        if (version < 3) {
            assert.deepEqual(JSON.parse(await fs.readFile(path.join(releaseRoot, 'userconfig/chat2api/model-mappings.json'))), DEFAULT_MODEL_MAPPINGS);
        }
        await assert.rejects(fs.stat(path.join(releaseRoot, 'userconfig/chat2api/accounts.json')), { code: 'ENOENT' });
    });
}
