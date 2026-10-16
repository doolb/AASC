'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { normalizeSettings, redactSettings, PROVIDER_CAPABILITIES, supportsNativeSpeed } = require('../src/apps/server/modules/tts/tts-provider-settings');
const { normalizeTemplateTts, resolveProviderConfig, BUSINESS_TYPES } = require('../src/apps/server/modules/tts/tts-provider-policy');

test('上游并发默认3，配置只接受豆包1至8整数，旧配置与普通音色更新保留额度', () => {
    assert.deepEqual(normalizeSettings().upstreamConcurrency, { 'doubao-chat': 3 });
    const configured = normalizeSettings({ upstreamConcurrency: { 'doubao-chat': '8' } });
    assert.deepEqual(configured.upstreamConcurrency, { 'doubao-chat': 8 });
    assert.deepEqual(normalizeSettings({ defaultVolume: 42 }, configured).upstreamConcurrency, configured.upstreamConcurrency);
    for (const value of [0, 9, 1.5, '', 'bad', null, true, NaN, Infinity]) {
        assert.throws(() => normalizeSettings({ upstreamConcurrency: { 'doubao-chat': value } }), /上游并发/u);
    }
    for (const value of [null, [], { 'qwen-chat': 3 }]) assert.throws(() => normalizeSettings({ upstreamConcurrency: value }), /上游并发/u);
});

// 对应.src/framework/qwen-tts-fixed-models.md：固定模型覆盖历史配置，禁止新补丁重新选择引擎。
test('两路千问固定模型：错误补丁拒绝，历史模型和映射标记恢复', () => {
    for (const [provider, fixed] of [['qwen-chat', 'QUARK_VOICE'], ['qwen-api', 'qwen-audio-3.1-tts-flash']]) {
        for (const model of ['qwen3-tts-flash', 'MINI_MAX', 'my-voice', '', null, 123]) {
            const patch = { providers: { [provider]: { model, mappedModel: true } } };
            assert.throws(() => normalizeSettings(patch), /固定/u);
            const recovered = normalizeSettings(patch, {}, { recoverLegacyModel: true }).providers[provider];
            assert.equal(recovered.model, fixed);
            assert.ok(!Object.hasOwn(recovered, 'mappedModel'));
        }
        assert.equal(normalizeSettings({ providers: { [provider]: { model: fixed } } }).providers[provider].model, fixed);
        assert.throws(() => normalizeSettings({ providers: { [provider]: { mappedModel: true } } }), /映射/u);
    }
});

test('旧模板继承、显式system、Agent与群聊、文本媒体业务隔离', () => {
    assert.deepEqual(normalizeTemplateTts({ voice: ' ' }), { voice: null });
    assert.throws(() => normalizeTemplateTts({ provider: false }));
    assert.throws(() => normalizeTemplateTts({ provider: 0 }));
    const options = { aiReplyDefault: { provider: 'qwen-api', voice: 'ai-voice' }, textMedia: { provider: 'doubao-api', voice: 'reader' },
        systemBroadcast: { provider: 'system', voice: null }, providers: { system: { defaultVoice: 'native' } } };
    assert.deepEqual(resolveProviderConfig({ ...options, businessType: BUSINESS_TYPES.AI_REPLY }), { provider: 'qwen-api', voice: 'ai-voice' });
    assert.deepEqual(resolveProviderConfig({ ...options, templateTts: { provider: 'system' }, businessType: BUSINESS_TYPES.AGENT_REPLY }), { provider: 'system', voice: null });
    assert.deepEqual(resolveProviderConfig({ ...options, templateTts: { provider: 'qwen-chat' }, businessType: BUSINESS_TYPES.TEXT_MEDIA }), { provider: 'doubao-api', voice: 'reader' });
    assert.deepEqual(resolveProviderConfig({ ...options, businessType: BUSINESS_TYPES.SYSTEM_BROADCAST }), { provider: 'system', voice: null });
    assert.equal(normalizeSettings({ textMedia: { provider: 'qwen-chat' } }).textMedia.provider, 'qwen-chat');
    assert.throws(() => normalizeSettings({ textMedia: { provider: 'doubao-chat' } }), /仅允许/u);
});

test('部分选择保留Provider、显式空音色清除、范围与凭证保留/清除/脱敏', () => {
    const initial = normalizeSettings({ aiReplyDefault: { provider: 'qwen-api', voice: 'old' },
        providers: { 'qwen-api': { credential: 'test-secret', defaultSpeed: 999, defaultVolume: -1 } } });
    const changed = normalizeSettings({ aiReplyDefault: { voice: null }, providers: { 'qwen-api': { credential: '' } } }, initial);
    assert.deepEqual(changed.aiReplyDefault, { provider: 'qwen-api', voice: null });
    assert.equal(changed.providers['qwen-api'].credential, 'test-secret');
    assert.equal(initial.providers['qwen-api'].defaultSpeed, 10);
    assert.equal(initial.defaultVolume, 0);
    assert.equal(changed.providers['qwen-api'].defaultSpeed, 10);
    assert.equal(changed.defaultVolume, 0);
    assert.ok(Object.hasOwn(changed.providers['qwen-api'], 'defaultSpeed'));
    assert.ok(!Object.hasOwn(changed.providers['qwen-api'], 'defaultVolume'));
    const publicConfig = redactSettings(changed);
    assert.equal(publicConfig.providers['qwen-api'].credentialSource, 'chat2api');
    assert.ok(!JSON.stringify(publicConfig).includes('test-secret'));
    assert.equal(normalizeSettings({ providers: { 'qwen-api': { clearCredential: true } } }, initial).providers['qwen-api'].credential, '');
    for (const patch of [{ providers: null }, { providers: [] }, { providers: { bad: {} } }, { aiReplyDefault: [] },
        { defaultSpeed: 'NaN' }, { defaultVolume: 'NaN' }, { providers: { 'qwen-api': { defaultSpeed: 'NaN' } } }, { providers: { 'qwen-api': { enabled: 'true' } } },
        { providers: { 'qwen-api': { endpoint: 'https://key:secret@host/path' } } },
        { providers: { 'qwen-chat': { endpoint: 'https://other.example/tts' } } }]) assert.throws(() => normalizeSettings(patch));
});

test('原生无新增开关或音色ID，千问不保存旧凭证或账号引用', () => {
    const settings = normalizeSettings({ providers: {
        system: { enabled: false, defaultVoice: 'obsolete-id' },
        'qwen-chat': { chat2apiAccountId: 'old-account', credential: 'legacy-secret' }
    } });
    for (const key of ['enabled', 'defaultVoice']) assert.ok(!Object.hasOwn(settings.providers.system, key));
    for (const key of ['chat2apiAccountId', 'credential', 'credentialSource']) assert.ok(!Object.hasOwn(settings.providers['qwen-chat'], key));
    assert.ok(!JSON.stringify(redactSettings(settings)).includes('legacy-secret'));
    assert.ok(!JSON.stringify(redactSettings(settings)).includes('old-account'));
    assert.deepEqual(normalizeSettings({ aiReplyDefault: { provider: 'system', voice: 'old-id' } }).aiReplyDefault, { provider: 'system', voice: null });
});

function loadConfig(t, directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-tts-config-test-'))) {
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filename = path.resolve(__dirname, '../src/apps/server/modules/config/config-app-service.js');
    const realRequire = createRequire(filename);
    const instances = [];
    const Base = realRequire('../../../../core/data-snapshot');
    class Snapshot extends Base { constructor(file) { super(file); instances.push(this); } }
    const context = { module: { exports: {} }, __dirname: path.dirname(filename), process: { ...process, env: { ...process.env, AASC_PROJECT_ROOT: directory } },
        console: { log() {}, error() {} }, require(id) {
            if (id === '../../../../core/data-snapshot') return Snapshot;
            if (id === './user-config-paths') return { USER_CONFIG_DIR: path.join(directory, 'user') };
            if (id === '../../../../core/release-runtime-context') return {
                resolveReleaseRuntimeContext: () => ({ configFile: path.join(directory, 'config', 'config.json') }), validateReleaseRuntimeContext() {} };
            return realRequire(id);
        } };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    return { config: context.module.exports, instances, directory };
}

test('上游并发通过主config持久化，重载与失败回滚均保留权威值', t => {
    const { config, instances, directory } = loadConfig(t);
    assert.equal(config.getPublicTtsProviderSettings().upstreamConcurrency['doubao-chat'], 3);
    config.setTtsProviderSettings({ upstreamConcurrency: { 'doubao-chat': 5 } });
    const file = path.join(directory, 'config/config.json');
    assert.equal(JSON.parse(fs.readFileSync(file)).tts.upstreamConcurrency['doubao-chat'], 5);
    assert.equal(instances[1]._data.tts.upstreamConcurrency, undefined);
    // 重建配置服务模拟进程重启；不调用数据修复专用重载入口。
    assert.equal(loadConfig(t, directory).config.getTtsProviderSettings().upstreamConcurrency['doubao-chat'], 5);
    const save = instances[0]._save;
    instances[0]._save = () => false;
    assert.throws(() => config.setTtsProviderSettings({ upstreamConcurrency: { 'doubao-chat': 8 } }), /已恢复/u);
    assert.equal(config.getTtsProviderSettings().upstreamConcurrency['doubao-chat'], 5);
    assert.equal(JSON.parse(fs.readFileSync(file)).tts.upstreamConcurrency['doubao-chat'], 5);
    instances[0]._save = save;
});

test('迁移Qwen3到Audio3.1保留隐藏的已存语速，显式新语速优先', t => {
    // 对应.src/framework/qwen-api-data-repair.md：模型能力变化不应丢失持久化的调速偏好。
    for (const speedPatch of [undefined, -2]) {
        const { config, instances, directory } = loadConfig(t);
        instances[1]._data.tts = { providers: { 'qwen-api': {
            model: 'qwen3-tts-flash', defaultVoice: 'Cherry', defaultSpeed: 4, credential: 'keep-secret'
        } } };
        assert.equal(config.getPublicTtsProviderSettings().providers['qwen-api'].defaultSpeed, 4);
        const patch = { model: 'qwen-audio-3.1-tts-flash', defaultVoice: 'qiaoxiaojiao_v3.1',
            ...(speedPatch === undefined ? {} : { defaultSpeed: speedPatch }) };
        const saved = config.setTtsProviderSettings({ providers: { 'qwen-api': patch } });
        assert.equal(saved.providers['qwen-api'].defaultSpeed, speedPatch ?? 4);
        const user = JSON.parse(fs.readFileSync(path.join(directory, 'user/userconfig.json')));
        assert.equal(user.tts.providers['qwen-api'].defaultSpeed, speedPatch ?? 4);
        assert.equal(user.tts.providers['qwen-api'].credential, 'keep-secret');
    }
});

test('真实配置持久化、重载、旧system默认和保存失败内存/磁盘回滚', t => {
    const { config, instances, directory } = loadConfig(t);
    config.set('tts.defaultVoice', 'legacy-voice');
    config.set('tts.defaultSpeed', 3);
    assert.ok(!Object.hasOwn(config.getTtsProviderSettings().providers.system, 'defaultVoice'));
    assert.equal(config.get('tts.defaultVoice'), 'legacy-voice');
    assert.equal(config.getTtsProviderSettings().providers.system.defaultSpeed, 3);
    assert.equal(config.getTtsProviderSettings().defaultVolume, 100);
    const saved = config.setTtsProviderSettings({ aiReplyDefault: { provider: 'qwen-api' }, providers: { 'qwen-api': { enabled: true, credential: 'private-key' } } });
    assert.equal(saved.providers['qwen-api'].credentialSource, 'chat2api');
    const mainFile = path.join(directory, 'config', 'config.json');
    const userFile = path.join(directory, 'user', 'userconfig.json');
    assert.ok(!fs.readFileSync(mainFile, 'utf8').includes('private-key'));
    assert.equal(JSON.parse(fs.readFileSync(userFile)).tts.providers['qwen-api'].credential, 'private-key');
    assert.equal(JSON.parse(fs.readFileSync(mainFile)).tts.defaultSpeed, 3);
    assert.ok(!Object.hasOwn(JSON.parse(fs.readFileSync(mainFile)).tts.sharedParameters, 'defaultSpeed'));
    assert.equal(JSON.parse(fs.readFileSync(mainFile)).tts.sharedParameters.defaultVolume, 100);
    assert.equal(JSON.parse(fs.readFileSync(userFile)).tts.providers['qwen-api'].defaultSpeed, 3);
    assert.ok(!Object.hasOwn(JSON.parse(fs.readFileSync(userFile)).tts.providers['qwen-api'], 'defaultVolume'));
    const before = JSON.stringify(config.getTtsProviderSettings());
    const user = instances[1];
    const originalSave = user._save;
    user._save = () => false;
    assert.throws(() => config.setTtsProviderSettings({ providers: { 'qwen-api': { credential: 'rejected' } } }), /保存失败/u);
    assert.equal(JSON.stringify(config.getTtsProviderSettings()), before);
    user._save = originalSave;
    const mainSave = instances[0]._save;
    instances[0]._save = () => false;
    assert.throws(() => config.setTtsProviderSettings({ aiReplyDefault: { provider: 'system' }, providers: { 'qwen-api': { credential: 'rejected' } } }), /已恢复/u);
    assert.equal(JSON.stringify(config.getTtsProviderSettings()), before);
    assert.equal(JSON.parse(fs.readFileSync(userFile)).tts.providers['qwen-api'].credential, 'private-key');
    assert.equal(JSON.parse(fs.readFileSync(mainFile)).tts.aiReplyDefault.provider, 'qwen-api');
    instances[0]._save = mainSave;
    user._data.tts.providers['qwen-chat'] = { credential: 'obsolete-qwen-secret', enabled: true };
    const accountSaved = config.setTtsProviderSettings({ providers: { 'qwen-chat': { chat2apiAccountId: 'qwen:test' } } });
    assert.ok(!Object.hasOwn(accountSaved.providers['qwen-chat'], 'chat2apiAccountId'));
    assert.ok(!fs.readFileSync(userFile, 'utf8').includes('obsolete-qwen-secret'));
    assert.ok(!Object.hasOwn(JSON.parse(fs.readFileSync(userFile)).tts.providers['qwen-chat'], 'chat2apiAccountId'));
    const opened = config.setTtsProviderSettings({ systemBroadcast: { provider: 'qwen-chat', voice: 'system-voice' },
        textMedia: { provider: 'qwen-chat', voice: 'reading-voice' } });
    assert.equal(opened.systemBroadcast.provider, 'qwen-chat');
    assert.equal(opened.textMedia.voice, 'reading-voice');
    assert.equal(JSON.parse(fs.readFileSync(mainFile)).tts.systemBroadcast.provider, 'qwen-chat');
    assert.equal(config.getTtsProviderSettings().textMedia.provider, 'qwen-chat');
    const beforeInvalid = JSON.stringify(config.getTtsProviderSettings());
    assert.throws(() => config.setTtsProviderSettings({ systemBroadcast: { provider: 'doubao-chat' } }), /仅允许/u);
    assert.equal(JSON.stringify(config.getTtsProviderSettings()), beforeInvalid);
});

test('实际配置读取错误网页模型不崩溃；拒绝新错误模型不落盘，合法保存清除旧值', t => {
    const { config, instances, directory } = loadConfig(t);
    instances[1]._data.tts = { providers: { 'qwen-chat': { enabled: true, model: 'qwen3-tts-flash', defaultVoice: 'saved-voice' } } };
    assert.equal(config.getTtsProviderSettings().providers['qwen-chat'].model, 'QUARK_VOICE');
    assert.equal(config.getTtsProviderSettings().providers['qwen-chat'].defaultVoice, 'saved-voice');
    assert.throws(() => config.setTtsProviderSettings({ providers: { 'qwen-chat': { model: 'qwen3-tts-flash' } } }), /固定为 QUARK_VOICE/u);
    assert.equal(instances[1]._data.tts.providers['qwen-chat'].model, 'qwen3-tts-flash');
    config.setTtsProviderSettings({ providers: { 'qwen-chat': { defaultSpeed: 2 } } });
    const saved = JSON.parse(fs.readFileSync(path.join(directory, 'user', 'userconfig.json')));
    assert.equal(saved.tts.providers['qwen-chat'].model, undefined);
    assert.equal(saved.tts.providers['qwen-chat'].defaultVoice, 'saved-voice');
    assert.equal(saved.tts.providers['qwen-chat'].defaultSpeed, 2);
});

test('旧共享语速迁移到支持语速Provider，Provider旧值优先，音量继续共享', t => {
    const { config, instances } = loadConfig(t);
    config.setTtsProviderConfig('aiReplyDefault', { provider: 'qwen-api', voice: null });
    instances[1]._data.tts = { providers: { 'qwen-api': { defaultSpeed: -4, defaultVolume: 72 } } };
    assert.equal(config.getTtsProviderSettings().providers['qwen-api'].defaultSpeed, -4);
    assert.equal(config.getTtsProviderSettings().providers['qwen-chat'].defaultSpeed, -4);
    assert.ok(!Object.hasOwn(config.getTtsProviderSettings().providers['doubao-chat'], 'defaultSpeed'));
    assert.equal(config.getTtsProviderSettings().defaultVolume, 72);
    config.setTtsProviderSettings({ aiReplyDefault: { provider: 'qwen-api', voice: null } });
    const shared = config.get('tts.sharedParameters');
    assert.ok(!Object.hasOwn(shared, 'defaultSpeed'));
    assert.equal(shared.defaultVolume, 72);
    const fresh = loadConfig(t).config;
    assert.equal(fresh.getTtsProviderSettings().providers['qwen-api'].defaultSpeed, 0);
    assert.equal(fresh.getTtsProviderSettings().defaultVolume, 100);
});

test('语速能力声明与不支持Provider的历史语速清理一致', () => {
    assert.equal(PROVIDER_CAPABILITIES['doubao-chat'].supportsSpeed, false);
    for (const id of ['system', 'qwen-chat', 'qwen-api', 'doubao-api']) assert.equal(PROVIDER_CAPABILITIES[id].supportsSpeed, true);
    const settings = normalizeSettings({ defaultSpeed: 8, providers: { 'doubao-chat': { defaultSpeed: -5 } } });
    assert.ok(!Object.hasOwn(settings.providers['doubao-chat'], 'defaultSpeed'));
    assert.equal(settings.providers['qwen-api'].defaultSpeed, 8);
});

test('Qwen API只对原生声明rate的Qwen-Audio模型保存语速', () => {
    assert.equal(supportsNativeSpeed('qwen-api', 'qwen-audio-3.1-tts-flash'), true);
    assert.equal(supportsNativeSpeed('qwen-api', 'qwen-audio-3.0-tts-plus'), true);
    assert.equal(supportsNativeSpeed('qwen-api', 'qwen3-tts-flash'), false);
    assert.equal(supportsNativeSpeed('qwen-api', 'custom-qwen-alias'), false);
    const audioModel = normalizeSettings({ providers: { 'qwen-api': { defaultSpeed: 4 } } });
    assert.equal(audioModel.providers['qwen-api'].defaultSpeed, 4);
    assert.throws(() => normalizeSettings({ providers: { 'qwen-api': { model: 'qwen3-tts-flash', defaultSpeed: 4 } } }), /固定/u);
    const switched = normalizeSettings({}, { providers: { 'qwen-api': { model: 'qwen3-tts-flash', defaultSpeed: 7 } } });
    assert.equal(switched.providers['qwen-api'].defaultSpeed, 7);
});


test('API已知旧音色在默认和三个业务恢复，有效及未知用户音色保持', () => {
    for (const voice of ['Cherry', 'Ethan', 'Chelsie', 'Serena', 'Emily_v3.1', 'my-voice']) {
        const settings = normalizeSettings({ providers: { 'qwen-api': { defaultVoice: voice } },
            ...Object.fromEntries(['aiReplyDefault', 'textMedia', 'systemBroadcast'].map(key => [key, { provider: 'qwen-api', voice }])) });
        const expected = ['Cherry', 'Ethan', 'Chelsie', 'Serena'].includes(voice) ? 'qiaoxiaojiao_v3.1' : voice;
        assert.equal(settings.providers['qwen-api'].defaultVoice, expected);
        for (const key of ['aiReplyDefault', 'textMedia', 'systemBroadcast']) assert.equal(settings[key].voice, expected);
    }
});

// 对应.src/framework/qwen-tts-fixed-models.md：五种方式常开，两路千问旧模型不再决定引擎。
test('五种TTS方式默认可用，旧false规范化为true且默认Qwen为3.1和乔小娇', () => {
    const ids = ['qwen-chat', 'qwen-api', 'doubao-api', 'doubao-chat'];
    const defaults = normalizeSettings();
    assert.equal(defaults.providers['qwen-api'].model, 'qwen-audio-3.1-tts-flash');
    assert.equal(defaults.providers['qwen-api'].defaultVoice, 'qiaoxiaojiao_v3.1');
    assert.ok(!Object.hasOwn(defaults.providers.system, 'enabled'));
    const old = { providers: Object.fromEntries(ids.map(id => [id, { enabled: false }])) };
    for (const settings of [defaults, normalizeSettings({}, old), normalizeSettings(old, defaults),
        normalizeSettings(old, old, { recoverLegacyModel: true })]) {
        for (const id of ids) assert.equal(settings.providers[id].enabled, true, id);
        assert.equal(normalizeSettings(settings).providers['doubao-chat'].enabled, true);
    }
    assert.equal(normalizeSettings({}, { providers: { 'qwen-api': { model: 'qwen3-tts-flash', defaultVoice: 'Cherry' } } }).providers['qwen-api'].model, 'qwen-audio-3.1-tts-flash');
});

test('两路历史模型保存后不落盘，重启仍返回固定模型，凭据和速度保留', t => {
    const { config, instances, directory } = loadConfig(t);
    instances[1]._data.tts = { providers: {
        'qwen-api': { model: 'custom-engine', mappedModel: true, defaultVoice: 'Emily_v3.1', defaultSpeed: 4, credential: 'keep' },
        'qwen-chat': { model: 'MINI_MAX', mappedModel: true, defaultSpeed: -2 }
    } };
    config.setTtsProviderSettings({ defaultVolume: 70 });
    const saved = JSON.parse(fs.readFileSync(path.join(directory, 'user/userconfig.json')));
    for (const id of ['qwen-api', 'qwen-chat']) for (const key of ['model', 'mappedModel']) assert.ok(!Object.hasOwn(saved.tts.providers[id], key));
    assert.equal(saved.tts.providers['qwen-api'].credential, 'keep');
    const reopened = loadConfig(t, directory).config.getPublicTtsProviderSettings();
    assert.equal(reopened.providers['qwen-api'].model, 'qwen-audio-3.1-tts-flash');
    assert.equal(reopened.providers['qwen-api'].defaultVoice, 'Emily_v3.1');
    assert.equal(reopened.providers['qwen-api'].defaultSpeed, 4);
    assert.equal(reopened.providers['qwen-chat'].model, 'QUARK_VOICE');
    assert.equal(reopened.providers['qwen-chat'].defaultSpeed, -2);
});
