'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { QWEN_AUDIO_31_MODEL, listQwenAudio31Voices } = require('./chat2api-qwen-audio-voices');
const { createApiSpeechAdapters } = require('./chat2api-api-speech-adapters');
const { createChat2ApiSpeechService } = require('./chat2api-speech-service');
const { createProviderRegistry } = require('../tts/tts-provider-registry');
const { createTtsProviderService } = require('../tts/tts-provider-service');
const { createTtsProviderWs } = require('../tts/tts-provider-ws');
const { normalizeSettings, redactSettings } = require('../tts/tts-provider-settings');

// 对应.src/framework/tts-provider-configuration.md：模型专属目录、复制隔离和真实查询接线。
test('Qwen Audio 3.1官方68音色、47女21男、四分组和区分大小写的ID保持', () => {
    const voices = listQwenAudio31Voices();
    assert.equal(QWEN_AUDIO_31_MODEL, 'qwen-audio-3.1-tts-flash');
    assert.equal(voices.length, 68);
    assert.equal(new Set(voices.map(v => v.id)).size, 68);
    assert.equal(voices.filter(v => v.gender === 'female').length, 47);
    assert.equal(voices.filter(v => v.gender === 'male').length, 21);
    assert.deepEqual(Object.values(voices.reduce((counts, v) => { counts[v.category] = (counts[v.category] || 0) + 1; return counts; }, {})), [4, 22, 15, 27]);
    assert.ok(voices.every(v => v.id.endsWith('_v3.1') && v.name && v.available && v.tags.length));
    assert.equal(voices.find(v => v.id === 'qiaoxiaojiao_v3.1').name, '乔小娇');
    assert.equal(voices.find(v => v.id === 'Emily_v3.1').name, 'Emily');
    assert.ok(!voices.some(v => v.id === 'emily_v3.1' || v.id === 'Cherry'));
    assert.ok(voices[0].tags.includes('宁波话'));
    assert.equal(voices[0].languages.length, 8);
    assert.deepEqual(voices.find(v => v.id === 'Emily_v3.1').languages, ['英语']);
    assert.deepEqual(voices.find(v => v.id === 'longanyuanfei_v3.1').languages, [], '官网未明确的语言不猜测');
    voices[0].name = '污染'; voices[0].tags.push('污染'); voices[0].languages.push('污染');
    assert.ok(!JSON.stringify(listQwenAudio31Voices()).includes('污染'));
});

test('Qwen 3.1目录经统一映射、业务Registry及WS查询一致，旧false保存回传常开权威值', async () => {
    const speech = createChat2ApiSpeechService({ dataStore: {}, providerRegistry: {}, loadBalancer: {},
        modelMapper: { resolveModel: async () => ({ actualModel: 'qwen-api/' + QWEN_AUDIO_31_MODEL, preferredProviderId: 'qwen-api', application: 'tts' }) } });
    assert.deepEqual(await speech.voices('mapped-voice'), listQwenAudio31Voices());
    let settings = normalizeSettings();
    const service = createTtsProviderService({ getSettings: () => settings,
        registry: createProviderRegistry({ chat2ApiSpeechService: speech }) });
    assert.deepEqual(await service.voices('qwen-api'), listQwenAudio31Voices());
    const replies = [], broadcasts = [];
    const control = { send: raw => replies.push(JSON.parse(raw)) };
    const handler = createTtsProviderWs({ config: {
        getPublicTtsProviderSettings: () => redactSettings(settings),
        setTtsProviderSettings: patch => { settings = normalizeSettings(patch, settings); }
    }, service, isControl: ws => ws === control, broadcast: message => broadcasts.push(message) });
    await handler.handle(control, { type: 'getTtsProviderVoices', provider: 'qwen-api', requestId: 'catalog' });
    assert.equal(replies[0].success, true);
    assert.deepEqual(replies[0].voices, listQwenAudio31Voices());
    await handler.handle(control, { type: 'setTtsProviderConfig', requestId: 'legacy-off', config: { providers:
        Object.fromEntries(['qwen-chat', 'qwen-api', 'doubao-api', 'doubao-chat'].map(id => [id, { enabled: false }])) } });
    assert.equal(broadcasts[0].success, true);
    for (const id of ['qwen-chat', 'qwen-api', 'doubao-api', 'doubao-chat']) {
        assert.equal(broadcasts[0].config.providers[id].enabled, true);
        assert.equal(handler.snapshot().config.providers[id].enabled, true);
    }
});

test('3.1音色不混入其它Qwen模型目录，目录查询不发生成请求', async () => {
    const api = createApiSpeechAdapters({ httpRequest: () => assert.fail('查询不下载'), jsonRequest: () => assert.fail('查询不合成') });
    assert.equal((await api['qwen-api'].voices({ model: QWEN_AUDIO_31_MODEL })).length, 68);
    assert.equal((await api['qwen-api'].voices()).length, 68);
    for (const model of ['qwen-audio-3.0-tts-flash', 'qwen-audio-3.0-tts-plus', 'qwen3-tts-flash', 'custom']) {
        await assert.rejects(api['qwen-api'].voices({ model }), error => error.code === 'unsupported_speech_model');
    }
});

// 对应.src/framework/qwen-tts-fixed-models.md：目录不能宣传已被禁止的映射；内部计划同样受最终约束。
test('目录过滤旧Qwen模型映射，内部伪造计划在账号读取前拒绝', async () => {
    const mappings = [
        { model: 'old-api', actualModel: 'qwen-api/qwen3-tts-flash' },
        { model: 'old-web', actualModel: 'MINI_MAX' },
        { model: 'valid-voice', actualModel: 'qwen-api/' + QWEN_AUDIO_31_MODEL, parameters: { voice: 'Emily_v3.1' } }
    ];
    const speech = createChat2ApiSpeechService({
        dataStore: { listAccounts: async () => ['qwen-api', 'qwen'].map(providerId => ({ providerId, secretConfigured: true })), readCollection: async () => mappings },
        providerRegistry: { listProviders: async () => [{ id: 'qwen-api' }, { id: 'qwen' }] },
        modelMapper: { resolveModel: async model => ({ actualModel: model }) },
        loadBalancer: { selectAccount: () => assert.fail('非法模型不读取账号') }
    });
    const models = await speech.listModels();
    assert.ok(models.some(model => model.id === 'valid-voice'));
    assert.ok(!models.some(model => ['old-api', 'old-web', 'MINI_MAX', 'qwen-api/qwen3-tts-flash'].includes(model.id)));
    for (const [providerId, upstreamModel] of [['qwen-api', 'qwen3-tts-flash'], ['qwen', 'MINI_MAX']]) {
        await assert.rejects(speech.generate({ input: '你好' }, { resolvedPlan: { providerId, upstreamModel, application: 'tts' } }), e => e.code === 'unsupported_speech_model');
    }
});
