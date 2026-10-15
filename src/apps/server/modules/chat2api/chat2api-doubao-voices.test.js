'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { listDoubaoVoices, validateDoubaoVoice } = require('./chat2api-doubao-voices');
const { createTextTtsSession } = require('./chat2api-doubao-speech-protocol');
const { normalizeSpeechRequest, createChat2ApiSpeechService } = require('./chat2api-speech-service');
const { createChat2ApiProxyService } = require('./chat2api-proxy-service');

test('官网实际94项共享目录按性别分组，返回副本且严格验证合成音色', () => {
    const voices = listDoubaoVoices();
    assert.equal(voices.length, 94);
    assert.equal(voices.filter(v => v.gender === 'female').length, 32);
    assert.equal(voices.filter(v => v.gender === 'male').length, 62);
    assert.equal(new Set(voices.map(v => v.id)).size, 94);
    for (const voice of voices) {
        assert.equal(voice.id, voice.style_id);
        assert.ok(voice.name && voice.tags.length);
        assert.equal(validateDoubaoVoice(voice.id), voice.id);
    }
    voices[0].tags.push('污染');
    assert.ok(!listDoubaoVoices()[0].tags.includes('污染'));
    assert.throws(() => validateDoubaoVoice('unknown'), /音色/);
});

test('非默认官网音色进入语音参数及Frontier会话，缺省保持原音色', () => {
    const voice = listDoubaoVoices().find(v => v.gender === 'male').id;
    assert.equal(normalizeSpeechRequest({ model: 'doubao-chat', input: '测试', voice }).voice, voice);
    assert.equal(createTextTtsSession({ voice }).tts.speaker, voice);
    assert.equal(createTextTtsSession().tts.speaker, normalizeSpeechRequest({ model: 'doubao-chat', input: '测试' }).voice);
    assert.throws(() => createTextTtsSession({ voice: 'unknown' }), /音色/);
});

test('静态目录无账号可读，代理查询沿用鉴权且拒绝缺失重复模型参数', async t => {
    const speech = createChat2ApiSpeechService({ dataStore: {}, providerRegistry: {}, modelMapper: {}, loadBalancer: {} });
    assert.equal((await speech.voices('doubao-chat')).length, 94);
    const service = createChat2ApiProxyService({ host: '127.0.0.1', port: 0, config: { enableApiKey: true },
        dataStore: { validateApiKey: async key => key === 'test-voices' }, coreAdapter: {}, speechService: speech });
    await service.start();
    t.after(() => service.stop());
    const base = `http://127.0.0.1:${service.address().port}`;
    const headers = { Authorization: 'Bearer test-voices' };
    assert.equal((await fetch(`${base}/v1/audio/voices?model=doubao-chat`)).status, 401);
    for (const query of ['', '?model=doubao-chat&model=doubao-chat', '?model=unknown']) {
        assert.equal((await fetch(`${base}/v1/audio/voices${query}`, { headers })).status, 400);
    }
    const response = await fetch(`${base}/v1/audio/voices?model=doubao-chat`, { headers });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.object, 'list');
    assert.equal(result.model, 'doubao-chat');
    assert.deepEqual(result.data, listDoubaoVoices());
});

test('目录查询支持映射到豆包的语音别名且不读取账号', async () => {
    const service = createChat2ApiSpeechService({ dataStore: {}, providerRegistry: {}, loadBalancer: {},
        modelMapper: { resolveModel: async () => ({ actualModel: 'doubao-chat', preferredProviderId: 'doubaochat', application: 'tts' }) } });
    assert.deepEqual(await service.voices('my-doubao-voice'), listDoubaoVoices());
});
