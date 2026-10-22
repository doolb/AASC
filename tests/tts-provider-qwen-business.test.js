'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createTtsProviderService } = require('../src/apps/server/modules/tts/tts-provider-service');
const { normalizeSettings } = require('../src/apps/server/modules/tts/tts-provider-settings');
const { BUSINESS_TYPES } = require('../src/apps/server/modules/tts/tts-provider-policy');
const { createQwenChatProvider } = require('../src/apps/server/modules/tts/qwen-chat-tts');
const { filterQwenChatSpeechText } = require('../src/apps/server/modules/tts/qwen-chat-text-filter');
const { splitIntoSentences } = require('../src/core/utils/sentence-splitter');
const { wrapPcm } = require('../src/external/tts/tts-wav');
const { toSpeechText: stripMarkdown, splitSpeechSegments } = require('../src/core/utils/markdown-speech');
const source = fs.readFileSync(path.resolve(__dirname, '../src/apps/server/boot/server-app.js'), 'utf8');
const wav = wrapPcm(Buffer.from([1, 0, 2, 0]));
function fixture() {
    const calls = [], stores = [];
    const settings = normalizeSettings({ aiReplyDefault: { provider: 'qwen-chat' },
        textMedia: { provider: 'qwen-chat', voice: 'reading' }, systemBroadcast: { provider: 'qwen-chat', voice: 'broadcast' } });
    const registry = { 'qwen-chat': createQwenChatProvider({ speechService: { generate: async request => { calls.push(request); return { audio: wav }; } } }) };
    const service = createTtsProviderService({ getSettings: () => settings, registry,
        storeAudio: bytes => { stores.push(bytes); return `/tmp/${stores.length}.wav`; } });
    return { service, calls, stores };
}
function section(start, end) {
    const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
    assert.ok(first >= 0 && last > first, `正式入口存在：${start}`);
    return source.slice(first, last);
}
function harness(service) {
    const sent = [], errors = [];
    const context = { stripMarkdown, splitSpeechSegments, path, BUSINESS_TYPES, filterQwenChatSpeechText, ttsProviderService: service,
        normalizeTtsPauseText: text => text, chat: { splitIntoSentences }, generateCorrelationId: () => 'batch',
        beginDisplayConversationTtsGeneration: () => null, endDisplayConversationTtsGeneration() {},
        isRepairModeTtsSuppressed: () => false, resolveCurrentVoicePlaybackTarget: () => 'speaker',
        rememberVoicePlaybackTarget() {}, sendToDisplay: (_, value) => { sent.push(value); return true; },
        log() {}, logError: (...args) => errors.push(args), app: { post: (_, fn) => { context.generateHandler = fn; } } };
    vm.runInNewContext(section('async function generateTtsWithFallback(', '// 显示端语音输入的播报'), context);
    vm.runInNewContext(section('function getVoiceTtsBatchPayload(', '// 裁剪调试日志开关'), context);
    vm.runInNewContext(section("app.post('/api/tts/generate'", "app.get('/api/tts/config'"), context);
    return { context, sent, errors };
}
test('四种业务共用qwen薄层生成，非AI音色按各自业务选择，纯表情不请求/不缓存', async () => {
    const { service, calls, stores } = fixture();
    for (const businessType of Object.values(BUSINESS_TYPES)) await service.generate({ text: '您好✨', businessType });
    assert.equal(calls.length, 4);
    assert.equal(calls[2].voice, 'reading');
    assert.equal(calls[3].voice, 'broadcast');
    assert.ok(calls.every(call => call.input === '您好'));
    for (const businessType of Object.values(BUSINESS_TYPES)) assert.equal(await service.generate({ text: '✨', businessType }), null);
    assert.equal(calls.length, 4);
    assert.equal(stores.length, 4);
});
test('实际系统播报入口遇到null不构造URL或报失败，自定义API返回明确跳过', async () => {
    const { context, sent, errors } = harness({
        resolve: () => ({ selection: { provider: 'system' }, configuration: {} }),
        generate: async () => null
    });
    assert.equal(await context.sendVoiceInputTts('✨'), 0);
    assert.equal(await context.sendVoiceCommandTts('✨', 'speaker'), false);
    assert.equal(await context.sendMediaNameTts('speaker', '✨'), false);
    let result;
    const response = { json: value => { result = value; }, status: () => response };
    await context.generateHandler({ body: { text: '✨' } }, response);
    assert.equal(result.status, 'skipped');
    assert.equal(result.skipped, true);
    assert.equal(result.audioUrl, null);
    assert.deepEqual(sent, []);
    assert.deepEqual(errors, []);
});
test('语音命令末尾纯emoji不吞批次结束标记，全空不建批次，其它来源原文保留', async () => {
    const { service, calls } = fixture();
    const { context, sent } = harness(service);
    await context.sendVoiceCommandTtsSentences('第一句。✨', 'speaker');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].voiceTtsBatchEnd, true);
    assert.equal(calls.length, 1);
    await context.sendVoiceCommandTtsSentences('✨', 'speaker');
    assert.equal(sent.length, 1);
    const other = harness({ resolve: () => ({ selection: { provider: 'system' } }), generate: async () => '/tmp/native.wav' });
    await other.context.sendVoiceCommandTtsSentences('✨', 'speaker');
    assert.equal(other.sent[0].text, '✨');
});

test('语音批次中切换配置不改变当前Provider或丢失尾标记，下一批使用新值', async () => {
    let settings = normalizeSettings({ systemBroadcast: { provider: 'system' } });
    let nativeCalls = 0, qwenCalls = 0;
    const registry = {
        system: { generate: async () => {
            nativeCalls += 1;
            settings = normalizeSettings({ systemBroadcast: { provider: 'qwen-chat' } });
            return `/tmp/native-${nativeCalls}.wav`;
        } },
        'qwen-chat': createQwenChatProvider({ speechService: { generate: async () => { qwenCalls += 1; return { audio: wav }; } } })
    };
    const service = createTtsProviderService({ getSettings: () => settings, registry, storeAudio: () => '/tmp/qwen.wav' });
    const { context, sent } = harness(service);
    await context.sendVoiceCommandTtsSentences('第一句。✨', 'speaker');
    assert.equal(sent.length, 2);
    assert.equal(nativeCalls, 2);
    assert.equal(qwenCalls, 0);
    assert.equal(sent[0].voiceTtsBatchEnd, false);
    assert.equal(sent[1].voiceTtsBatchEnd, true);
    await context.sendVoiceCommandTtsSentences('✨', 'speaker');
    assert.equal(sent.length, 2);
    await context.sendVoiceCommandTtsSentences('下一批。', 'speaker');
    assert.equal(qwenCalls, 1);
    assert.equal(sent.at(-1).voiceTtsBatchEnd, true);
});

test('长播报在合成期间被取消后不下发当前和后续分段', async () => {
    let releaseGeneration;
    let generateCount = 0;
    let active = true;
    const pending = new Promise(resolve => { releaseGeneration = resolve; });
    const { context, sent } = harness({
        resolve: () => ({ selection: { provider: 'system' }, configuration: {} }),
        generate: async () => {
            generateCount++;
            await pending;
            return '/tmp/native.wav';
        }
    });
    const task = context.sendVoiceInputTtsSentences('第一句。第二句。', 'speaker', {
        shouldContinue: () => active
    });
    active = false;
    releaseGeneration();
    await task;
    assert.equal(generateCount, 1);
    assert.deepEqual(sent, []);
});

test('生成API跳过响应兼容正式显示端队列，继续下一句并收尾批次', async () => {
    const server = harness({ generate: async () => null });
    let apiResult;
    const response = { json: value => { apiResult = value; }, status: () => response };
    await server.context.generateHandler({ body: { text: '✨' } }, response);
    const display = fs.readFileSync(path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/display.html'), 'utf8');
    const audio = [], finished = [], errors = [];
    const context = { currentTtsItem: null, isPlayingTts: false, ttsQueue: [], ttsPlaybackToken: 0,
        ttsBatchPlaybackStates: new Map(), textTtsPlaybackActive: false, remoteTextPlayback: null,
        window: {}, console: { log() {}, error: (...args) => errors.push(args) },
        fetch: async () => ({ json: async () => apiResult }),
        clearTtsRecovery() {}, hideTtsText() {}, showTtsText() {}, pauseVoiceRecordingForTts() {},
        beginTtsVideoCoordination() {}, endTtsVideoCoordination() {}, scheduleTtsRecordingResume() {},
        sendVoiceConversationTtsFinished() {}, sendVoiceTtsPlaybackFinished: id => finished.push(id),
        startTtsAudio: (_, url) => audio.push(url) };
    const load = (first, next) => {
        const start = display.indexOf(first), end = display.indexOf(next, start + first.length);
        assert.ok(start >= 0 && end > start);
        vm.runInNewContext(display.slice(start, end), context);
    };
    load('function endTtsVideoCoordinationIfIdle()', 'function hasActiveTtsPlayback()');
    load('function registerTtsBatchItem(', 'function getRemoteTtsPlaybackKey(');
    load('function finishCurrentTts(', 'function stopTtsPlayback(');
    load('function playNextTts(', "ttsAudio.addEventListener('ended'");
    context.queueTts({ text: '✨', voiceTtsPlaybackId: 'empty', voiceTtsBatchId: 'same', voiceTtsBatchEnd: false });
    context.queueTts({ text: '下一句。', audioUrl: '/uploads/tts/next.wav', voiceTtsPlaybackId: 'next', voiceTtsBatchId: 'same', voiceTtsBatchEnd: true });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(audio, ['/uploads/tts/next.wav']);
    assert.deepEqual(finished, ['empty']);
    context.finishCurrentTts('ended');
    assert.equal(context.isPlayingTts, false);
    assert.equal(context.currentTtsItem, null);
    assert.equal(context.ttsBatchPlaybackStates.size, 0);
    assert.deepEqual(finished, ['empty', 'next']);
    assert.deepEqual(errors, []);
});

test('完整播报先清理Markdown再分句，链接地址不进入语音且字幕原文与批次尾保留', async () => {
    const { service, calls } = fixture();
    const h = harness(service);
    const source = '# 标题\n**你好。**\n[帮助](https://example.com)';
    await h.context.sendVoiceCommandTtsSentences(source, 'speaker');
    assert.deepEqual(calls.map(call => call.input), ['标题', '你好。', '帮助']);
    assert.ok(h.sent.every(message => message.subtitle?.markdown === source));
    assert.equal(h.sent.at(-1).voiceTtsBatchEnd, true);
    assert.ok(h.sent.slice(0, -1).every(message => message.voiceTtsBatchEnd === false));
});
