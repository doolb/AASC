'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { normalizeSettings, redactSettings } = require('../src/apps/server/modules/tts/tts-provider-settings');
const { normalizeTemplateTts, resolveProviderConfig, BUSINESS_TYPES } = require('../src/apps/server/modules/tts/tts-provider-policy');

test('qwen-chat模型保存校验、别名规范化与历史不兼容模型恢复，API模型规则保持', () => {
    for (const model of ['qwen3-tts-flash', 'QUARK_VOCIE', '']) {
        const patch = { providers: { 'qwen-chat': { model } } };
        assert.throws(() => normalizeSettings(patch), /网页模型仅支持/u);
        assert.equal(normalizeSettings(patch, {}, { recoverLegacyModel: true }).providers['qwen-chat'].model, 'QUARK_VOICE');
    }
    assert.equal(normalizeSettings({ providers: { 'qwen-chat': { model: 'qwen-chat' } } }).providers['qwen-chat'].model, 'QUARK_VOICE');
    assert.equal(normalizeSettings({ providers: { 'qwen-chat': { model: 'MINI_MAX' } } }).providers['qwen-chat'].model, 'MINI_MAX');
    assert.equal(normalizeSettings({ providers: { 'qwen-api': { model: 'qwen3-tts-flash' } } }).providers['qwen-api'].model, 'qwen3-tts-flash');
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
    assert.equal(initial.defaultSpeed, 10);
    assert.equal(initial.defaultVolume, 0);
    assert.equal(changed.defaultSpeed, 10);
    assert.equal(changed.defaultVolume, 0);
    assert.ok(!Object.hasOwn(changed.providers['qwen-api'], 'defaultSpeed'));
    assert.ok(!Object.hasOwn(changed.providers['qwen-api'], 'defaultVolume'));
    const publicConfig = redactSettings(changed);
    assert.equal(publicConfig.providers['qwen-api'].credentialSource, 'chat2api');
    assert.ok(!JSON.stringify(publicConfig).includes('test-secret'));
    assert.equal(normalizeSettings({ providers: { 'qwen-api': { clearCredential: true } } }, initial).providers['qwen-api'].credential, '');
    for (const patch of [{ providers: null }, { providers: [] }, { providers: { bad: {} } }, { aiReplyDefault: [] },
        { defaultSpeed: 'NaN' }, { defaultVolume: 'NaN' }, { providers: { 'qwen-api': { enabled: 'true' } } },
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

function loadConfig(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-tts-config-test-'));
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

test('真实配置持久化、重载、旧system默认和保存失败内存/磁盘回滚', t => {
    const { config, instances, directory } = loadConfig(t);
    config.set('tts.defaultVoice', 'legacy-voice');
    config.set('tts.defaultSpeed', 3);
    assert.ok(!Object.hasOwn(config.getTtsProviderSettings().providers.system, 'defaultVoice'));
    assert.equal(config.get('tts.defaultVoice'), 'legacy-voice');
    assert.equal(config.getTtsProviderSettings().defaultSpeed, 3);
    assert.equal(config.getTtsProviderSettings().defaultVolume, 100);
    const saved = config.setTtsProviderSettings({ aiReplyDefault: { provider: 'qwen-api' }, providers: { 'qwen-api': { enabled: true, credential: 'private-key' } } });
    assert.equal(saved.providers['qwen-api'].credentialSource, 'chat2api');
    const mainFile = path.join(directory, 'config', 'config.json');
    const userFile = path.join(directory, 'user', 'userconfig.json');
    assert.ok(!fs.readFileSync(mainFile, 'utf8').includes('private-key'));
    assert.equal(JSON.parse(fs.readFileSync(userFile)).tts.providers['qwen-api'].credential, 'private-key');
    assert.equal(JSON.parse(fs.readFileSync(mainFile)).tts.sharedParameters.defaultSpeed, 3);
    assert.equal(JSON.parse(fs.readFileSync(mainFile)).tts.sharedParameters.defaultVolume, 100);
    assert.ok(!Object.hasOwn(JSON.parse(fs.readFileSync(userFile)).tts.providers['qwen-api'], 'defaultSpeed'));
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
    assert.throws(() => config.setTtsProviderSettings({ providers: { 'qwen-chat': { model: 'qwen3-tts-flash' } } }), /Qwen API/u);
    assert.equal(instances[1]._data.tts.providers['qwen-chat'].model, 'qwen3-tts-flash');
    config.setTtsProviderSettings({ providers: { 'qwen-chat': { defaultSpeed: 2 } } });
    const saved = JSON.parse(fs.readFileSync(path.join(directory, 'user', 'userconfig.json')));
    assert.equal(saved.tts.providers['qwen-chat'].model, 'QUARK_VOICE');
    assert.equal(saved.tts.providers['qwen-chat'].defaultVoice, 'saved-voice');
    assert.ok(!Object.hasOwn(saved.tts.providers['qwen-chat'], 'defaultSpeed'));
});

test('首次全局参数迁移取当前AI默认Provider旧值，缺省参数使用0和100', t => {
    const { config, instances } = loadConfig(t);
    config.setTtsProviderConfig('aiReplyDefault', { provider: 'qwen-api', voice: null });
    instances[1]._data.tts = { providers: { 'qwen-api': { defaultSpeed: -4, defaultVolume: 72 } } };
    assert.equal(config.getTtsProviderSettings().defaultSpeed, -4);
    assert.equal(config.getTtsProviderSettings().defaultVolume, 72);
    config.setTtsProviderSettings({ aiReplyDefault: { provider: 'qwen-api', voice: null } });
    const shared = config.get('tts.sharedParameters');
    assert.equal(shared.defaultSpeed, -4);
    assert.equal(shared.defaultVolume, 72);
    const fresh = loadConfig(t).config;
    assert.equal(fresh.getTtsProviderSettings().defaultSpeed, 0);
    assert.equal(fresh.getTtsProviderSettings().defaultVolume, 100);
});


test('新保存的网页映射别名重载不恢复为QUARK，旧错误配置仍恢复',()=>{
 const updated=normalizeSettings({providers:{'qwen-chat':{model:'my-voice'}}});
 assert.equal(normalizeSettings(updated,{}, {recoverLegacyModel:true}).providers['qwen-chat'].model,'my-voice');
 assert.equal(normalizeSettings({providers:{'qwen-chat':{model:'unknown'}}},{},{recoverLegacyModel:true}).providers['qwen-chat'].model,'QUARK_VOICE');
});
