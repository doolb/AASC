'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTextMediaTtsService } = require('../src/apps/server/modules/media/text-media-tts-service');

test('合成单个请求分句并返回带播放定位标签的音频消息', async () => {
    const messages = [];
    const service = createTextMediaTtsService({
        generateTTS: async (text) => `/tmp/${text}.wav`,
        sendToDisplay: (displayId, message) => messages.push({ displayId, message }),
        logError: () => {}
    });

    await service.handleSentenceRequest('display-1', {
        playbackId: 'p1', pageIndex: 2, sentenceIndex: 1, text: '第二句。'
    });

    assert.deepEqual(messages, [{
        displayId: 'display-1',
        message: {
            type: 'tts', action: 'playAudio', textPlayback: true,
            playbackId: 'p1', pageIndex: 2, sentenceIndex: 1,
            audioUrl: '/uploads/tts/第二句。.wav', text: '第二句。'
        }
    }]);
});

test('取消播放后不会下发正在生成的过期音频', async () => {
    let resolveAudio;
    const messages = [];
    const service = createTextMediaTtsService({
        generateTTS: () => new Promise((resolve) => { resolveAudio = resolve; }),
        sendToDisplay: (_, message) => messages.push(message),
        logError: () => {}
    });
    const pending = service.handleSentenceRequest('display-1', {
        playbackId: 'old', pageIndex: 0, sentenceIndex: 0, text: '旧句。'
    });

    service.cancel('display-1', 'old');
    resolveAudio('/tmp/old.wav');
    await pending;

    assert.equal(messages.length, 0);
});

test('取消后恢复相同 playbackId 时仍会丢弃取消前的旧音频', async () => {
    let resolveFirst;
    const messages = [];
    const service = createTextMediaTtsService({
        generateTTS: (text) => {
            if (text === '旧句。') {
                return new Promise((resolve) => { resolveFirst = resolve; });
            }
            return Promise.resolve('/tmp/new.wav');
        },
        sendToDisplay: (_, message) => messages.push(message),
        logError: () => {}
    });

    const oldRequest = service.handleSentenceRequest('display-1', {
        playbackId: 'p1', pageIndex: 0, sentenceIndex: 0, text: '旧句。'
    });
    service.cancel('display-1', 'p1');
    const newRequest = service.handleSentenceRequest('display-1', {
        playbackId: 'p1', pageIndex: 0, sentenceIndex: 0, text: '新句。'
    });

    resolveFirst('/tmp/old.wav');
    await Promise.all([oldRequest, newRequest]);

    assert.deepEqual(messages.map((message) => message.text), ['新句。']);
});

test('同一显示端的请求按接收顺序逐句生成', async () => {
    const generatedTexts = [];
    let releaseFirst;
    const service = createTextMediaTtsService({
        generateTTS: async (text) => {
            generatedTexts.push(text);
            if (text === '第一句。') {
                await new Promise((resolve) => { releaseFirst = resolve; });
            }
            return `/tmp/${text}.wav`;
        },
        sendToDisplay: () => {},
        logError: () => {}
    });

    const first = service.handleSentenceRequest('display-1', {
        playbackId: 'p1', pageIndex: 0, sentenceIndex: 0, text: '第一句。'
    });
    const second = service.handleSentenceRequest('display-1', {
        playbackId: 'p1', pageIndex: 0, sentenceIndex: 1, text: '第二句。'
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(generatedTexts, ['第一句。']);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(generatedTexts, ['第一句。', '第二句。']);
});

test('无效分句请求返回带定位标签的错误消息且不进入 TTS', async () => {
    const messages = [];
    const service = createTextMediaTtsService({
        generateTTS: async () => {
            throw new Error('不应调用 TTS');
        },
        sendToDisplay: (_, message) => messages.push(message),
        logError: () => {}
    });

    await service.handleSentenceRequest('display-1', {
        playbackId: 'p1', pageIndex: 0, sentenceIndex: 0, text: '   '
    });

    assert.deepEqual(messages, [{
        type: 'textSentenceTtsError',
        playbackId: 'p1',
        pageIndex: 0,
        sentenceIndex: 0,
        message: 'text 不能为空'
    }]);
});

test('文本路由目标为远程显示端时仅向选中且在线启用语音的设备下发远程音频', async () => {
    const messages = [];
    const online = new Map([
        ['source', { voicePlayback: false }],
        ['speaker', { voicePlayback: true }],
        ['unselected', { voicePlayback: true }]
    ]);
    const service = createTextMediaTtsService({
        generateTTS: async () => '/tmp/remote.wav',
        sendToDisplay: (displayId, message) => messages.push({ displayId, message }),
        logError: () => {},
        getDisplayCapabilities: (displayId) => online.get(displayId) || null
    });

    service.setPlaybackContext('source', {
        playbackId: 'p-remote',
        selectedDisplayIds: ['source', 'speaker'],
        voiceTargetDisplayId: 'speaker'
    });
    await service.handleSentenceRequest('source', {
        playbackId: 'p-remote',
        pageIndex: 0,
        sentenceIndex: 0,
        text: '远程播报。',
        route: { voiceTargetDisplayId: 'unselected' }
    });

    assert.deepEqual(messages, [{
        displayId: 'speaker',
        message: {
            type: 'tts',
            action: 'playAudio',
            textPlaybackRemote: true,
            originDisplayId: 'source',
            voiceTargetDisplayId: 'speaker',
            playbackId: 'p-remote',
            pageIndex: 0,
            sentenceIndex: 0,
            audioUrl: '/uploads/tts/remote.wav',
            text: '远程播报。'
        }
    }]);
});

test('首次分句请求不能信任显示端伪造的远程 route', async () => {
    const messages = [];
    let generated = false;
    const service = createTextMediaTtsService({
        generateTTS: async () => {
            generated = true;
            return '/tmp/forged.wav';
        },
        sendToDisplay: (displayId, message) => messages.push({ displayId, message }),
        logError: () => {},
        getDisplayCapabilities: (displayId) => ({
            source: { voicePlayback: false },
            speaker: { voicePlayback: true }
        })[displayId] || null
    });

    await service.handleSentenceRequest('source', {
        playbackId: 'p-forged',
        pageIndex: 0,
        sentenceIndex: 0,
        text: '伪造远程播报。',
        route: {
            selectedDisplayIds: ['source', 'speaker'],
            selectedVoiceDisplayIds: ['speaker'],
            voiceTargetDisplayId: 'speaker'
        }
    });

    assert.equal(generated, false);
    assert.deepEqual(messages, [{
        displayId: 'source',
        message: {
            type: 'textSentenceTtsError',
            playbackId: 'p-forged',
            pageIndex: 0,
            sentenceIndex: 0,
            message: '未注册服务器语音路由'
        }
    }]);
});

test('远程播放结束回执必须匹配服务器已下发的句子定位', async () => {
    const messages = [];
    const service = createTextMediaTtsService({
        generateTTS: async () => '/tmp/remote.wav',
        sendToDisplay: (displayId, message) => messages.push({ displayId, message }),
        logError: () => {},
        getDisplayCapabilities: () => ({ voicePlayback: true })
    });

    service.setPlaybackContext('source', {
        playbackId: 'p-finished',
        selectedDisplayIds: ['source', 'speaker'],
        voiceTargetDisplayId: 'speaker'
    });
    await service.handleSentenceRequest('source', {
        playbackId: 'p-finished',
        pageIndex: 1,
        sentenceIndex: 2,
        text: '远程句子。'
    });

    service.handleSentenceFinished('speaker', {
        originDisplayId: 'source',
        playbackId: 'p-finished',
        pageIndex: 1,
        sentenceIndex: 3,
        status: 'ended'
    });
    assert.equal(messages.filter(({ displayId }) => displayId === 'source').length, 0);

    service.handleSentenceFinished('speaker', {
        originDisplayId: 'source',
        playbackId: 'p-finished',
        pageIndex: 1,
        sentenceIndex: 2,
        status: 'ended'
    });

    assert.deepEqual(messages, [{
        displayId: 'speaker',
        message: {
            type: 'tts',
            action: 'playAudio',
            textPlaybackRemote: true,
            originDisplayId: 'source',
            voiceTargetDisplayId: 'speaker',
            playbackId: 'p-finished',
            pageIndex: 1,
            sentenceIndex: 2,
            audioUrl: '/uploads/tts/remote.wav',
            text: '远程句子。'
        }
    }, {
        displayId: 'source',
        message: {
            type: 'textSentenceTtsFinished',
            originDisplayId: 'source',
            voiceTargetDisplayId: 'speaker',
            playbackId: 'p-finished',
            pageIndex: 1,
            sentenceIndex: 2,
            status: 'ended'
        }
    }]);
});

test('远程目标取消后旧上下文失效，不再接受迟到回执', () => {
    const messages = [];
    const service = createTextMediaTtsService({
        generateTTS: async () => '/tmp/unused.wav',
        sendToDisplay: (displayId, message) => messages.push({ displayId, message }),
        logError: () => {},
        getDisplayCapabilities: () => ({ voicePlayback: true })
    });

    service.setPlaybackContext('source', {
        playbackId: 'p-cancel',
        selectedDisplayIds: ['source', 'speaker'],
        voiceTargetDisplayId: 'speaker'
    });
    service.cancel('source', 'p-cancel');
    service.handleSentenceFinished('speaker', {
        originDisplayId: 'source',
        playbackId: 'p-cancel',
        pageIndex: 0,
        sentenceIndex: 0,
        status: 'ended'
    });

    assert.deepEqual(messages, []);
});
