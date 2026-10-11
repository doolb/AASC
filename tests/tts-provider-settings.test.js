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
    assert.throws(() => normalizeSettings({ textMedia: { provider: 'qwen-chat' } }), /仅允许/u);
});

test('部分选择保留Provider、显式空音色清除、范围与凭证保留/清除/脱敏', () => {
    const initial = normalizeSettings({ aiReplyDefault: { provider: 'qwen-api', voice: 'old' },
        providers: { 'qwen-api': { credential: 'test-secret', defaultSpeed: 999, defaultVolume: -1 } } });
    const changed = normalizeSettings({ aiReplyDefault: { voice: null }, providers: { 'qwen-api': { credential: '' } } }, initial);
    assert.deepEqual(changed.aiReplyDefault, { provider: 'qwen-api', voice: null });
    assert.equal(changed.providers['qwen-api'].credential, 'test-secret');
    assert.equal(changed.providers['qwen-api'].defaultSpeed, 10);
    assert.equal(changed.providers['qwen-api'].defaultVolume, 0);
    const publicConfig = redactSettings(changed);
    assert.equal(publicConfig.providers['qwen-api'].credentialConfigured, true);
    assert.ok(!JSON.stringify(publicConfig).includes('test-secret'));
    assert.equal(normalizeSettings({ providers: { 'qwen-api': { clearCredential: true } } }, initial).providers['qwen-api'].credential, '');
    for (const patch of [{ providers: null }, { providers: [] }, { providers: { bad: {} } }, { aiReplyDefault: [] },
        { providers: { 'qwen-api': { defaultSpeed: 'NaN' } } }, { providers: { 'qwen-api': { enabled: 'true' } } },
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
    assert.equal(config.getTtsProviderSettings().providers.system.defaultSpeed, 3);
    const saved = config.setTtsProviderSettings({ aiReplyDefault: { provider: 'qwen-api' }, providers: { 'qwen-api': { enabled: true, credential: 'private-key' } } });
    assert.equal(saved.providers['qwen-api'].credentialConfigured, true);
    const mainFile = path.join(directory, 'config', 'config.json');
    const userFile = path.join(directory, 'user', 'userconfig.json');
    assert.ok(!fs.readFileSync(mainFile, 'utf8').includes('private-key'));
    assert.equal(JSON.parse(fs.readFileSync(userFile)).tts.providers['qwen-api'].credential, 'private-key');
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
    const beforeInvalid = JSON.stringify(config.getTtsProviderSettings());
    assert.throws(() => config.setTtsProviderSettings({ systemBroadcast: { provider: 'qwen-chat' } }), /仅允许/u);
    assert.equal(JSON.stringify(config.getTtsProviderSettings()), beforeInvalid);
});
