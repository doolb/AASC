'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createTtsProviderService } = require('../src/apps/server/modules/tts/tts-provider-service');
const { createProviderRegistry } = require('../src/apps/server/modules/tts/tts-provider-registry');
const { normalizeSettings } = require('../src/apps/server/modules/tts/tts-provider-settings');
const { normalizeTtsPauseText } = require('../src/apps/server/modules/media/tts-text-normalizer');
const { adjustWavVolume, decodeAudio, wrapPcm } = require('../src/apps/server/modules/tts/tts-provider-http');
const cache = require('../src/external/tts/tts-audio-cache');
const { toSpeechText: stripMarkdown, splitSpeechSegments } = require('../src/core/utils/markdown-speech');
const source = fs.readFileSync(path.resolve(__dirname, '../src/apps/server/boot/server-app.js'), 'utf8');
const start = source.indexOf('async function generateTtsWithFallback(');
const end = source.indexOf('// 显示端语音输入的播报', start);

function fixture({ device = 'server', serverEnabled = true, generationError = null, noDisplay = false,
    provider = 'system', speed = 0, volume = 100, store = cache.storeAudio } = {}) {
    const pcm = Buffer.alloc(16);
    for (let i = 0; i < 8; i++) pcm.writeInt16LE(1000, i * 2);
    const audio = wrapPcm(pcm);
    const calls = [];
    const context = { stripMarkdown, normalizeTtsPauseText, adjustWavVolume, decodeAudio, BUSINESS_TYPES: { SYSTEM_BROADCAST: 'system_broadcast' },
        pendingDisplayTtsRequestId: 0, log() {},
        config: { get: () => device }, isServerTtsEnabled: () => serverEnabled,
        findDisplayWithTts: id => noDisplay ? null : { id },
        sendTtsGenerateToDisplay: async (display, text, requestId, nativeSpeed) => { calls.push({ type: 'display', display, text, nativeSpeed }); if (generationError) throw generationError; return { audioData: audio.toString('base64') }; },
        ttsAudioCache: { storeAudio: store },
        tts: { generateTTS: async (...args) => { calls.push({ type: 'server', args }); return 'server-reference.wav'; } }
    };
    vm.runInNewContext(`${source.slice(start, end)}; this.generate = generateTtsWithFallback;`, context);
    const settings = normalizeSettings({ systemBroadcast: { provider }, providers: { system: { enabled: false, defaultVoice: 'server-voice', defaultSpeed: speed, defaultVolume: volume } } });
    context.ttsProviderService = createTtsProviderService({ getSettings: () => settings, registry: createProviderRegistry({
        systemGenerate: request => context.generate(request.text, request.voice, request.speed, request.preferredDisplayId,
            { systemRoute: true, volume: request.volume })
    }) });
    return { generate: context.generate, calls };
}

test('实际原生system生成路由保留优先目标、参数、短停顿与原缓存引用', async () => {
    const server = fixture({ speed: 4, volume: 60 });
    assert.equal(await server.generate('测试……', undefined, undefined, 'preferred'), 'server-reference.wav');
    assert.deepEqual(Array.from(server.calls[0].args), ['测试.', null, 4, 60]);
    // 旧调用的原生音色名称仍由既有接口传入，不被新增Provider音色ID覆盖。
    assert.equal(await server.generate('原生接口', 'legacy-native-voice', 1), 'server-reference.wav');
    assert.deepEqual(Array.from(server.calls[1].args), ['原生接口', 'legacy-native-voice', 1, 60]);
    const display = fixture({ device: 'display', speed: 10, volume: 50 });
    const reference = await display.generate('测试...', undefined, undefined, 'preferred');
    assert.equal(display.calls[0].display.id, 'preferred');
    assert.equal(display.calls[0].text, '测试.');
    assert.equal(display.calls[0].nativeSpeed, 10);
    assert.equal(display.calls.length, 1);
    const result = cache.getAudio(reference).buffer;
    assert.equal(result.length, 60, 'WAV 语速处理不得改变样本数或时长');
    assert.equal(result.readInt16LE(44), 500);
});

test('显示端失败/不可用仅按旧服务器开关回退；缓存满不会重新合成', async () => {
    for (const options of [{ generationError: new Error('display unavailable') }, { noDisplay: true }]) {
        const value = fixture({ device: 'display', ...options });
        assert.equal(await value.generate('测试'), 'server-reference.wav');
        const closed = fixture({ device: 'display', serverEnabled: false, ...options });
        await assert.rejects(closed.generate('测试'), /服务器 TTS 已关闭/u);
        assert.ok(!closed.calls.some(call => call.type === 'server'));
    }
    const full = fixture({ device: 'display', store: () => { throw Object.assign(new Error('cache full'), { code: 'TTS_AUDIO_CACHE_FULL' }); } });
    await assert.rejects(full.generate('测试'), error => error.code === 'TTS_AUDIO_CACHE_FULL');
    assert.equal(full.calls.length, 1);
});

test('原生合成同样只接收Markdown正文，空代码块不会请求引擎', async () => {
    const native = fixture();
    await native.generate('**你好** [帮助](https://example.com)');
    assert.equal(native.calls[0].args[0], '你好 帮助');
    assert.equal(await native.generate('```js\n不应合成\n```'), null);
    assert.equal(native.calls.length, 1);
});
