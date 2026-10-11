'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { normalizeSettings, redactSettings } = require('../src/apps/server/modules/tts/tts-provider-settings');
const { resolveQwenEndpoint } = require('../src/apps/server/modules/tts/qwen-api-contract');
const { createProviderRegistry } = require('../src/apps/server/modules/tts/tts-provider-registry');
const { createTtsProviderService } = require('../src/apps/server/modules/tts/tts-provider-service');
const { normalizeReplyUserText } = require('../src/apps/server/modules/tts/tts-reply-user-text');
const { resolveChatReplyTtsOptions } = require('../src/apps/server/modules/chat/chat-reply-tts-context');
const { normalizeQwenWav, wrapPcm, validateWav, adjustWav, MAX_AUDIO_BYTES } = require('../src/external/tts/tts-wav');
const pcm = Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]);
const wav = wrapPcm(pcm);
const audioPath = '/api/v1/services/audio/tts/SpeechSynthesizer';
const legacyPath = '/api/v1/services/aigc/multimodal-generation/generation';
function placeholder() {
    const value = Buffer.from(wav);
    value.writeUInt32LE(0x7fffffbf, 4);
    value.writeUInt32LE(0x7fffff9b, 40);
    return value;
}

test('三个Provider默认开启，Qwen31乔小娇默认，显式旧模型/音色/禁用/凭证保留', () => {
    const fresh = normalizeSettings();
    for (const id of ['qwen-chat', 'qwen-api', 'doubao-api']) assert.equal(fresh.providers[id].enabled, true);
    assert.equal(fresh.providers['qwen-api'].model, 'qwen-audio-3.1-tts-flash');
    assert.equal(fresh.providers['qwen-api'].defaultVoice, 'qiaoxiaojiao_v3.1');
    const old = { providers: { 'qwen-api': { model: 'qwen3-tts-flash', defaultVoice: 'Maia', credential: 'retained', enabled: false },
        'qwen-chat': { enabled: false }, 'doubao-api': { enabled: false } } };
    const result = normalizeSettings({}, old);
    for (const id of ['qwen-chat', 'qwen-api', 'doubao-api']) assert.equal(result.providers[id].enabled, false);
    assert.equal(result.providers['qwen-api'].model, 'qwen3-tts-flash');
    assert.equal(result.providers['qwen-api'].defaultVoice, 'Maia');
    assert.equal(result.providers['qwen-api'].credential, 'retained');
    assert.ok(result.providers['qwen-api'].endpoint.endsWith(legacyPath));
    assert.equal(redactSettings(result).providers['qwen-api'].credential, undefined);
});

test('Qwen官方路径随模型规范化，workspace支持，自定义代理地址保留', () => {
    for (const host of ['dashscope.aliyuncs.com', 'workspace.cn-beijing.maas.aliyuncs.com']) {
        for (const model of ['qwen-audio-3.1-tts-flash', 'qwen-audio-3.0-tts-flash', 'qwen-audio-3.0-tts-plus']) {
            assert.equal(resolveQwenEndpoint(`https://${host}${legacyPath}`, model), `https://${host}${audioPath}`);
        }
        assert.equal(resolveQwenEndpoint(`https://${host}${audioPath}`, 'qwen3-tts-flash'), `https://${host}${legacyPath}`);
    }
    for (const endpoint of [`https://proxy.example${legacyPath}`, 'http://127.0.0.1:9999/tts', 'https://dashscope.aliyuncs.com/custom']) {
        assert.equal(resolveQwenEndpoint(endpoint, 'qwen-audio-3.1-tts-flash'), endpoint);
    }
});

test('已知占位头按真实长度还原，PCM逐字节一致，语速调整仍生成合法WAV', () => {
    const raw = placeholder();
    assert.throws(() => validateWav(raw));
    const normalized = normalizeQwenWav(raw);
    assert.deepEqual(normalized, wav);
    assert.deepEqual(validateWav(normalized).samples, pcm);
    for (const speed of [0, 1]) validateWav(adjustWav(normalized, speed, 100));
    assert.equal(normalizeQwenWav(wav), wav);
    assert.equal(raw.readUInt32LE(4), 0x7fffffbf);
});

test('普通截断、未知占位、错误PCM格式、空/奇数PCM及超限仍拒绝', () => {
    const truncated = wav.subarray(0, wav.length - 2);
    assert.equal(normalizeQwenWav(truncated), truncated);
    assert.throws(() => validateWav(normalizeQwenWav(truncated)));
    const unknown = placeholder(); unknown.writeUInt32LE(0xffffffff, 4);
    assert.throws(() => validateWav(normalizeQwenWav(unknown)));
    for (const [offset, value, width] of [[20, 3, 2], [22, 2, 2], [24, 0, 4], [28, 1, 4], [32, 4, 2], [34, 8, 2]]) {
        const invalid = placeholder();
        if (width === 2) invalid.writeUInt16LE(value, offset); else invalid.writeUInt32LE(value, offset);
        assert.throws(() => normalizeQwenWav(invalid), /格式无效/u);
    }
    assert.throws(() => normalizeQwenWav(placeholder().subarray(0, 44)), /PCM/u);
    assert.throws(() => normalizeQwenWav(placeholder().subarray(0, 51)), /PCM/u);
    assert.throws(() => validateWav(normalizeQwenWav(Buffer.alloc(MAX_AUDIO_BYTES + 1))));
});

test('Qwen适配器新旧实际请求契约、占位修复、目录及非零速度下普通截断校验', async () => {
    const seen = [];
    let audio = placeholder();
    const registry = createProviderRegistry({ jsonRequest: async (endpoint, options) => {
        seen.push({ endpoint, body: options.body }); return { output: { audio: { url: 'https://audio.example/test' } } };
    }, httpRequest: async () => ({ buffer: audio }) });
    const newSettings = normalizeSettings({ providers: { 'qwen-api': { credential: 'test' } } }).providers['qwen-api'];
    validateWav(await registry['qwen-api'].generate({ text: '你好', voice: newSettings.defaultVoice, speed: 1, volume: 100, timeoutMs: 1000 }, newSettings));
    assert.ok(seen[0].endpoint.endsWith(audioPath));
    assert.deepEqual(seen[0].body.input, { text: '你好', voice: 'qiaoxiaojiao_v3.1', format: 'wav', sample_rate: 24000 });
    const oldSettings = { ...newSettings, model: 'qwen3-tts-flash', defaultVoice: 'Maia' };
    await registry['qwen-api'].generate({ text: '旧模型', voice: 'Maia', speed: 0, volume: 100, timeoutMs: 1000 }, oldSettings);
    assert.ok(seen[1].endpoint.endsWith(legacyPath));
    assert.deepEqual(seen[1].body.input, { text: '旧模型', voice: 'Maia', language_type: 'Auto' });
    assert.deepEqual(await registry['qwen-api'].voices(newSettings), [{ id: 'qiaoxiaojiao_v3.1', name: '乔小娇', available: true }]);
    assert.ok((await registry['qwen-api'].voices(oldSettings)).some(voice => voice.id === 'Cherry'));
    audio = wav.subarray(0, wav.length - 2);
    await assert.rejects(registry['qwen-api'].generate({ text: '截断', voice: 'Maia', speed: 1, volume: 100, timeoutMs: 1000 }, oldSettings), /截断/u);
});

test('上一句输入有界Unicode快照、非法来源拒绝，模板仍由服务端权威读取', () => {
    assert.equal(Array.from(normalizeReplyUserText('😀'.repeat(2200))).length, 2000);
    assert.equal(normalizeReplyUserText('  '), null);
    assert.throws(() => normalizeReplyUserText({ text: '非法' }), /必须为文本/u);
    const options = resolveChatReplyTtsOptions({ businessType: 'ai_reply', templateName: '角色', userText: '  原输入\n下一行  ', provider: 'system' },
        { getTemplateByName: () => ({ tts: { provider: 'doubao-api', voice: 'voice' } }) });
    assert.deepEqual(options, { businessType: 'ai_reply', templateTts: { provider: 'doubao-api', voice: 'voice' }, userText: '原输入\n下一行' });
});

test('其他Provider和非AI业务均不接收上一句；AI/Agent豆包接收受限副本', async () => {
    const seen = [];
    const registry = Object.fromEntries(['system', 'qwen-api', 'qwen-chat', 'doubao-api'].map(id => [id, {
        generate: async request => { seen.push({ id, request }); return id === 'system' ? 'native.wav' : wav; }
    }]));
    for (const provider of Object.keys(registry)) {
        const settings = normalizeSettings({ aiReplyDefault: { provider } });
        const service = createTtsProviderService({ registry, getSettings: () => settings, storeAudio: () => 'test.wav' });
        await service.generate({ text: '回复', businessType: 'ai_reply', userText: '原问题' });
        assert.equal(seen.at(-1).request.userText, provider === 'doubao-api' ? '原问题' : undefined);
    }
    const settings = normalizeSettings({ aiReplyDefault: { provider: 'doubao-api' }, textMedia: { provider: 'doubao-api' }, systemBroadcast: { provider: 'doubao-api' } });
    const service = createTtsProviderService({ registry, getSettings: () => settings, storeAudio: () => 'test.wav' });
    for (const businessType of ['agent_reply', 'text_media', 'system_broadcast']) {
        await service.generate({ text: '回复', businessType, userText: '原问题' });
        assert.equal(seen.at(-1).request.userText, businessType === 'agent_reply' ? '原问题' : undefined);
    }
});

test('实际历史写入保存对应用户id，JSON重载保留引用，不复制任意上下文字段', () => {
    const source = fs.readFileSync(require.resolve('../src/external/llm/llm-service'), 'utf8');
    const start = source.indexOf('function addMessage(message)');
    const end = source.indexOf('function estimateTokens', start);
    const histories = {};
    let persisted;
    const context = { MAX_MESSAGE_LENGTH: 10000, chatSession: {}, activeProfile: 'profile', chatHistories: histories,
        sessionKey: () => 'history', trimHistory() {}, saveHistory: () => { persisted = JSON.stringify(histories); },
        historyStore: { getHistoryFileName: () => 'history.json' } };
    const addMessage = vm.runInNewContext(`(${source.slice(start, end).trim()})`, context);
    const user = addMessage({ role: 'control', content: '第一轮问题', mode: 'group' });
    addMessage({ role: 'control', content: '并发第二轮', mode: 'group' });
    const reply = addMessage({ role: 'assistant', content: '第一轮回复', replyToMessageId: user.id, chatReplyContext: { credential: 'ignored' } });
    assert.equal(reply.replyToMessageId, user.id);
    assert.equal(JSON.parse(persisted).history[2].replyToMessageId, user.id);
    assert.equal(reply.chatReplyContext, undefined);
});
