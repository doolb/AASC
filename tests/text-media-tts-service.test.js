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

test('批量控制取消远程上下文时即使没有 playbackId 也会下发可定位 stop', async () => {
    const messages = [];
    const service = createTextMediaTtsService({
        generateTTS: async () => '/tmp/remote.wav',
        sendToDisplay: (displayId, message) => messages.push({ displayId, message }),
        logError: () => {},
        getDisplayCapabilities: (displayId) => displayId === 'speaker' ? { voicePlayback: true } : { voicePlayback: false }
    });

    service.setPlaybackContext('source', {
        playbackId: 'batch-pause',
        selectedDisplayIds: ['source', 'speaker'],
        voiceTargetDisplayId: 'speaker'
    });
    await service.handleSentenceRequest('source', {
        playbackId: 'batch-pause', pageIndex: 0, sentenceIndex: 0, text: '批量暂停。'
    });

    service.cancel('source');

    assert.deepEqual(messages.at(-1), {
        displayId: 'speaker',
        message: {
            type: 'tts',
            action: 'stop',
            textPlaybackRemote: true,
            originDisplayId: 'source',
            voiceTargetDisplayId: 'speaker',
            playbackId: 'batch-pause'
        }
    });
});

test('远程语音目标超时后向源端发送可定位错误并清理上下文', async () => {
    const messages = [];
    const service = createTextMediaTtsService({
        generateTTS: async () => '/tmp/remote.wav',
        sendToDisplay: (displayId, message) => messages.push({ displayId, message }),
        logError: () => {},
        remoteSentenceTimeoutMs: 10,
        getDisplayCapabilities: (displayId) => displayId === 'speaker' ? { voicePlayback: true } : { voicePlayback: false }
    });

    service.setPlaybackContext('source', {
        playbackId: 'remote-timeout',
        selectedDisplayIds: ['source', 'speaker'],
        voiceTargetDisplayId: 'speaker'
    });
    await service.handleSentenceRequest('source', {
        playbackId: 'remote-timeout', pageIndex: 1, sentenceIndex: 2, text: '等待远程回执。'
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.deepEqual(messages.at(-1), {
        displayId: 'source',
        message: {
            type: 'textSentenceTtsError',
            playbackId: 'remote-timeout',
            pageIndex: 1,
            sentenceIndex: 2,
            message: '远程语音设备未在规定时间内完成播放'
        }
    });
    await service.handleSentenceFinished('speaker', {
        originDisplayId: 'source', playbackId: 'remote-timeout', pageIndex: 1, sentenceIndex: 2
    });
    assert.equal(messages.filter(({ message }) => message.type === 'textSentenceTtsFinished').length, 0);
});

test('当前句超时后迟到的远程预取生成结果不会再次下发', async () => {
    let releasePrefetch;
    const messages = [];
    const service = createTextMediaTtsService({
        generateTTS: async (text) => {
            if (text === '迟到预取。') {
                return new Promise((resolve) => { releasePrefetch = resolve; });
            }
            return '/tmp/current-timeout.wav';
        },
        sendToDisplay: (displayId, message) => messages.push({ displayId, message }),
        logError: () => {},
        remoteSentenceTimeoutMs: 10,
        getDisplayCapabilities: (displayId) => displayId === 'speaker' ? { voicePlayback: true } : { voicePlayback: false }
    });

    service.setPlaybackContext('source', {
        playbackId: 'timeout-prefetch-race',
        selectedDisplayIds: ['source', 'speaker'],
        voiceTargetDisplayId: 'speaker'
    });
    await service.handleSentenceRequest('source', {
        playbackId: 'timeout-prefetch-race', pageIndex: 0, sentenceIndex: 0, text: '当前句。'
    });
    const prefetchRequest = service.handleSentenceRequest('source', {
        playbackId: 'timeout-prefetch-race', pageIndex: 0, sentenceIndex: 1, text: '迟到预取。', prefetch: true
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    releasePrefetch('/tmp/late-prefetch.wav');
    await prefetchRequest;

    assert.equal(messages.some(({ message }) => message.prefetch === true), false);
    assert.equal(messages.filter(({ message }) => message.text === '迟到预取。').length, 0);
});

test('远程语音目标断连后立即结束当前句和预取句', async () => {
    const messages = [];
    const service = createTextMediaTtsService({
        generateTTS: async () => '/tmp/remote.wav',
        sendToDisplay: (displayId, message) => messages.push({ displayId, message }),
        logError: () => {},
        remoteSentenceTimeoutMs: 1000,
        getDisplayCapabilities: (displayId) => displayId === 'speaker' ? { voicePlayback: true } : { voicePlayback: false }
    });

    service.setPlaybackContext('source', {
        playbackId: 'remote-disconnect',
        selectedDisplayIds: ['source', 'speaker'],
        voiceTargetDisplayId: 'speaker'
    });
    await service.handleSentenceRequest('source', {
        playbackId: 'remote-disconnect', pageIndex: 0, sentenceIndex: 0, text: '当前句。'
    });
    await service.handleSentenceRequest('source', {
        playbackId: 'remote-disconnect', pageIndex: 0, sentenceIndex: 1, text: '预取句。', prefetch: true
    });
    service.handleDisplayDisconnect('speaker');

    const errors = messages.filter(({ message }) => message.type === 'textSentenceTtsError');
    assert.deepEqual(errors.map(({ message }) => [message.pageIndex, message.sentenceIndex, message.prefetch]), [
        [0, 0, undefined],
        [0, 1, true]
    ]);
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

test('没有可用语音播放设备时返回专用错误码', async () => {
    const messages = [];
    const service = createTextMediaTtsService({
        generateTTS: async () => '/tmp/should-not-generate.wav',
        sendToDisplay: (_, message) => messages.push(message),
        logError: () => {},
        getVoicePlaybackDisplayIds: () => [],
        getDisplayCapabilities: () => null
    });

    await service.handleSentenceRequest('display-1', {
        playbackId: 'no-voice', pageIndex: 0, sentenceIndex: 0, text: '无设备时等待阅读。'
    });

    assert.deepEqual(messages, [{
        type: 'textSentenceTtsError',
        playbackId: 'no-voice',
        pageIndex: 0,
        sentenceIndex: 0,
        message: '没有可用的语音播放显示端',
        errorCode: 'noVoicePlaybackDevice'
    }]);
});

test('文本路由目标为远程显示端时仅向服务器确认的在线语音设备下发远程音频', async () => {
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

test('源端不能播放声音时允许从未选中的在线语音设备选择目标', async () => {
    const messages = [];
    const availableVoiceDisplays = ['speaker-unselected'];
    const service = createTextMediaTtsService({
        generateTTS: async () => '/tmp/unselected-speaker.wav',
        sendToDisplay: (displayId, message) => messages.push({ displayId, message }),
        logError: () => {},
        getVoicePlaybackDisplayIds: () => availableVoiceDisplays,
        getDisplayCapabilities: (displayId) => availableVoiceDisplays.includes(displayId)
            ? { voicePlayback: true }
            : { voicePlayback: false }
    });

    service.setPlaybackContext('source', {
        playbackId: 'p-all-displays',
        selectedDisplayIds: ['source'],
        voiceTargetDisplayId: null
    });
    await service.handleSentenceRequest('source', {
        playbackId: 'p-all-displays',
        pageIndex: 0,
        sentenceIndex: 0,
        text: '未选中的设备也应播报。'
    });

    assert.equal(messages[0].displayId, 'speaker-unselected');
    assert.equal(messages[0].message.textPlaybackRemote, true);
    assert.equal(messages[0].message.voiceTargetDisplayId, 'speaker-unselected');
});

test('连续实际句子播放前重新检查设备并允许切换语音目标', async () => {
    const messages = [];
    let availableVoiceDisplays = ['speaker-a'];
    const service = createTextMediaTtsService({
        generateTTS: async (text) => `/tmp/${text}.wav`,
        sendToDisplay: (displayId, message) => messages.push({ displayId, message }),
        logError: () => {},
        getVoicePlaybackDisplayIds: () => availableVoiceDisplays,
        getDisplayCapabilities: (displayId) => availableVoiceDisplays.includes(displayId)
            ? { voicePlayback: true }
            : { voicePlayback: false }
    });

    service.setPlaybackContext('source', {
        playbackId: 'p-refresh-device',
        selectedDisplayIds: ['source'],
        voiceTargetDisplayId: null
    });
    await service.handleSentenceRequest('source', {
        playbackId: 'p-refresh-device', pageIndex: 0, sentenceIndex: 0, text: '第一句。'
    });

    availableVoiceDisplays = ['speaker-b'];
    await service.handleSentenceRequest('source', {
        playbackId: 'p-refresh-device', pageIndex: 0, sentenceIndex: 1, text: '第二句。'
    });

    assert.deepEqual(
        messages.filter(({ message }) => message.textPlaybackRemote).map(({ displayId }) => displayId),
        ['speaker-a', 'speaker-b']
    );
});

test('当前句的远程预取沿用当前实际语音目标', async () => {
    const messages = [];
    const service = createTextMediaTtsService({
        generateTTS: async (text) => `/tmp/${text}.wav`,
        sendToDisplay: (displayId, message) => messages.push({ displayId, message }),
        logError: () => {},
        getVoicePlaybackDisplayIds: () => ['speaker-a', 'speaker-b'],
        getDisplayCapabilities: (displayId) => ({
            'speaker-a': { voicePlayback: true },
            'speaker-b': { voicePlayback: true }
        })[displayId] || { voicePlayback: false }
    });

    service.setPlaybackContext('source', {
        playbackId: 'p-prefetch-target',
        selectedDisplayIds: ['source'],
        voiceTargetDisplayId: null
    });
    await service.handleSentenceRequest('source', {
        playbackId: 'p-prefetch-target', pageIndex: 0, sentenceIndex: 0, text: '当前句。'
    });
    await service.handleSentenceRequest('source', {
        playbackId: 'p-prefetch-target', pageIndex: 0, sentenceIndex: 1, text: '预取句。', prefetch: true
    });

    assert.deepEqual(
        messages.filter(({ message }) => message.textPlaybackRemote).map(({ displayId, message }) => [displayId, message.prefetch]),
        [['speaker-a', undefined], ['speaker-a', true]]
    );
});

test('当前句目标失效时取消预取，不把缓存改投到另一台设备', async () => {
    const messages = [];
    let availableVoiceDisplays = ['speaker-a', 'speaker-b'];
    const service = createTextMediaTtsService({
        generateTTS: async (text) => `/tmp/${text}.wav`,
        sendToDisplay: (displayId, message) => messages.push({ displayId, message }),
        logError: () => {},
        getVoicePlaybackDisplayIds: () => availableVoiceDisplays,
        getDisplayCapabilities: (displayId) => availableVoiceDisplays.includes(displayId)
            ? { voicePlayback: true }
            : { voicePlayback: false }
    });

    service.setPlaybackContext('source', {
        playbackId: 'p-prefetch-target-lost',
        selectedDisplayIds: ['source'],
        voiceTargetDisplayId: null
    });
    await service.handleSentenceRequest('source', {
        playbackId: 'p-prefetch-target-lost', pageIndex: 0, sentenceIndex: 0, text: '当前句。'
    });
    availableVoiceDisplays = ['speaker-b'];
    await service.handleSentenceRequest('source', {
        playbackId: 'p-prefetch-target-lost', pageIndex: 0, sentenceIndex: 1, text: '失效预取。', prefetch: true
    });

    assert.deepEqual(messages.at(-1), {
        displayId: 'source',
        message: {
            type: 'textSentenceTtsError',
            playbackId: 'p-prefetch-target-lost',
            pageIndex: 0,
            sentenceIndex: 1,
            prefetch: true,
            message: '当前语音设备不可用，取消预取'
        }
    });
    assert.equal(messages.some(({ displayId, message }) => displayId === 'speaker-b' && message.prefetch), false);
});

test('句子排队等待时语音设备失效，真正发送前改用最新可用设备', async () => {
    const messages = [];
    let releaseFirst;
    let availableVoiceDisplays = ['speaker-a'];
    const service = createTextMediaTtsService({
        generateTTS: async (text) => {
            if (text === '第一句。') await new Promise((resolve) => { releaseFirst = resolve; });
            return `/tmp/${text}.wav`;
        },
        sendToDisplay: (displayId, message) => {
            messages.push({ displayId, message });
            if (message.sentenceIndex === 0 && message.textPlaybackRemote) {
                availableVoiceDisplays = ['speaker-b'];
            }
        },
        logError: () => {},
        getVoicePlaybackDisplayIds: () => availableVoiceDisplays,
        getDisplayCapabilities: (displayId) => availableVoiceDisplays.includes(displayId)
            ? { voicePlayback: true }
            : { voicePlayback: false }
    });

    service.setPlaybackContext('source', {
        playbackId: 'p-queued-refresh',
        selectedDisplayIds: ['source'],
        voiceTargetDisplayId: null
    });
    const first = service.handleSentenceRequest('source', {
        playbackId: 'p-queued-refresh', pageIndex: 0, sentenceIndex: 0, text: '第一句。'
    });
    const second = service.handleSentenceRequest('source', {
        playbackId: 'p-queued-refresh', pageIndex: 0, sentenceIndex: 1, text: '第二句。'
    });
    await new Promise((resolve) => setImmediate(resolve));
    releaseFirst();
    await Promise.all([first, second]);

    assert.deepEqual(
        messages.filter(({ message }) => message.textPlaybackRemote).map(({ displayId }) => displayId),
        ['speaker-a', 'speaker-b']
    );
});

test('语音设备在合成期间失效，音频发送前重新选择设备', async () => {
    const messages = [];
    let releaseAudio;
    let availableVoiceDisplays = ['speaker-a'];
    const service = createTextMediaTtsService({
        generateTTS: () => new Promise((resolve) => { releaseAudio = resolve; }),
        sendToDisplay: (displayId, message) => messages.push({ displayId, message }),
        logError: () => {},
        getVoicePlaybackDisplayIds: () => availableVoiceDisplays,
        getDisplayCapabilities: (displayId) => availableVoiceDisplays.includes(displayId)
            ? { voicePlayback: true }
            : { voicePlayback: false }
    });

    service.setPlaybackContext('source', {
        playbackId: 'p-generation-refresh',
        selectedDisplayIds: ['source'],
        voiceTargetDisplayId: null
    });
    const request = service.handleSentenceRequest('source', {
        playbackId: 'p-generation-refresh', pageIndex: 0, sentenceIndex: 0, text: '合成期间切换。'
    });
    await new Promise((resolve) => setImmediate(resolve));
    availableVoiceDisplays = ['speaker-b'];
    releaseAudio('/tmp/generation-refresh.wav');
    await request;

    assert.equal(messages[0].displayId, 'speaker-b');
    assert.equal(messages[0].message.voiceTargetDisplayId, 'speaker-b');
});

test('远程音频已下发后设备能力关闭，仍接受该句的合法完成回执', async () => {
    const messages = [];
    let availableVoiceDisplays = ['speaker-a'];
    const service = createTextMediaTtsService({
        generateTTS: async () => '/tmp/already-sent.wav',
        sendToDisplay: (displayId, message) => messages.push({ displayId, message }),
        logError: () => {},
        getVoicePlaybackDisplayIds: () => availableVoiceDisplays,
        getDisplayCapabilities: (displayId) => availableVoiceDisplays.includes(displayId)
            ? { voicePlayback: true }
            : { voicePlayback: false }
    });

    service.setPlaybackContext('source', {
        playbackId: 'p-finished-after-disable',
        selectedDisplayIds: ['source'],
        voiceTargetDisplayId: null
    });
    await service.handleSentenceRequest('source', {
        playbackId: 'p-finished-after-disable', pageIndex: 0, sentenceIndex: 0, text: '已下发句子。'
    });
    availableVoiceDisplays = [];
    service.handleSentenceFinished('speaker-a', {
        originDisplayId: 'source',
        playbackId: 'p-finished-after-disable',
        pageIndex: 0,
        sentenceIndex: 0,
        status: 'ended'
    });

    assert.equal(messages.at(-1).displayId, 'source');
    assert.equal(messages.at(-1).message.type, 'textSentenceTtsFinished');
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

test('远程目标取消后旧上下文失效，不再接受迟到回执转发', () => {
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

    assert.deepEqual(messages, [{
        displayId: 'speaker',
        message: {
            type: 'tts',
            action: 'stop',
            textPlaybackRemote: true,
            originDisplayId: 'source',
            voiceTargetDisplayId: 'speaker',
            playbackId: 'p-cancel'
        }
    }]);
});

test('远程目标取消时先向语音设备下发可定位 stop 并失效旧上下文', () => {
    const messages = [];
    const service = createTextMediaTtsService({
        generateTTS: async () => '/tmp/unused.wav',
        sendToDisplay: (displayId, message) => messages.push({ displayId, message }),
        logError: () => {},
        getDisplayCapabilities: () => ({ voicePlayback: true })
    });

    service.setPlaybackContext('source', {
        playbackId: 'p-remote-cancel',
        selectedDisplayIds: ['source', 'speaker'],
        voiceTargetDisplayId: 'speaker'
    });
    service.cancel('source', 'p-remote-cancel');
    service.handleSentenceFinished('speaker', {
        originDisplayId: 'source',
        playbackId: 'p-remote-cancel',
        pageIndex: 0,
        sentenceIndex: 0,
        status: 'ended'
    });

    assert.deepEqual(messages, [{
        displayId: 'speaker',
        message: {
            type: 'tts',
            action: 'stop',
            textPlaybackRemote: true,
            originDisplayId: 'source',
            voiceTargetDisplayId: 'speaker',
            playbackId: 'p-remote-cancel'
        }
    }]);
});

test('本地目标取消不会下发远程 stop 消息', () => {
    const messages = [];
    const service = createTextMediaTtsService({
        generateTTS: async () => '/tmp/unused.wav',
        sendToDisplay: (displayId, message) => messages.push({ displayId, message }),
        logError: () => {},
        getDisplayCapabilities: () => ({ voicePlayback: true })
    });

    service.setPlaybackContext('source', {
        playbackId: 'p-local-cancel',
        selectedDisplayIds: ['source'],
        voiceTargetDisplayId: 'source'
    });
    service.cancel('source', 'p-local-cancel');

    assert.deepEqual(messages, []);
});

test('远程 route replacement、clear 和新 playbackId 会停止旧远程上下文', async () => {
    const messages = [];
    const service = createTextMediaTtsService({
        generateTTS: async () => '/tmp/new.wav',
        sendToDisplay: (displayId, message) => messages.push({ displayId, message }),
        logError: () => {},
        getDisplayCapabilities: () => ({ voicePlayback: true })
    });

    service.setPlaybackContext('source', {
        playbackId: 'p-replace',
        selectedDisplayIds: ['source', 'speaker'],
        voiceTargetDisplayId: 'speaker'
    });
    service.setDisplayRoute('source', {
        selectedDisplayIds: ['source'],
        voiceTargetDisplayId: 'source'
    });

    service.setPlaybackContext('source', {
        playbackId: 'p-clear',
        selectedDisplayIds: ['source', 'speaker'],
        voiceTargetDisplayId: 'speaker'
    });
    service.clearDisplayRoute('source');

    service.setDisplayRoute('source', {
        selectedDisplayIds: ['source', 'speaker'],
        voiceTargetDisplayId: 'speaker'
    });
    await service.handleSentenceRequest('source', {
        playbackId: 'p-old',
        pageIndex: 0,
        sentenceIndex: 0,
        text: '旧句。'
    });
    await service.handleSentenceRequest('source', {
        playbackId: 'p-new',
        pageIndex: 0,
        sentenceIndex: 0,
        text: '新句。'
    });

    assert.deepEqual(messages.filter(({ message }) => message.action === 'stop'), [{
        displayId: 'speaker',
        message: {
            type: 'tts',
            action: 'stop',
            textPlaybackRemote: true,
            originDisplayId: 'source',
            voiceTargetDisplayId: 'speaker',
            playbackId: 'p-replace'
        }
    }, {
        displayId: 'speaker',
        message: {
            type: 'tts',
            action: 'stop',
            textPlaybackRemote: true,
            originDisplayId: 'source',
            voiceTargetDisplayId: 'speaker',
            playbackId: 'p-clear'
        }
    }, {
        displayId: 'speaker',
        message: {
            type: 'tts',
            action: 'stop',
            textPlaybackRemote: true,
            originDisplayId: 'source',
            voiceTargetDisplayId: 'speaker',
            playbackId: 'p-old'
        }
    }]);
});

test('本地预取回包带 prefetch 定位且重复预取只占一个生成槽', async () => {
    let releasePrefetch;
    const generated = [];
    const messages = [];
    const service = createTextMediaTtsService({
        generateTTS: async (text) => {
            generated.push(text);
            if (generated.length === 1) {
                await new Promise((resolve) => { releasePrefetch = resolve; });
            }
            return '/tmp/prefetch.wav';
        },
        sendToDisplay: (displayId, message) => messages.push({ displayId, message }),
        logError: () => {}
    });

    const first = service.handleSentenceRequest('source', {
        playbackId: 'p-prefetch',
        pageIndex: 0,
        sentenceIndex: 1,
        text: '预取句。',
        prefetch: true
    });
    const duplicate = service.handleSentenceRequest('source', {
        playbackId: 'p-prefetch',
        pageIndex: 0,
        sentenceIndex: 1,
        text: '预取句。',
        prefetch: true
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(generated, ['预取句。']);
    releasePrefetch();
    await first;
    await new Promise((resolve) => setImmediate(resolve));
    await duplicate;

    assert.deepEqual(messages, [{
        displayId: 'source',
        message: {
            type: 'tts',
            action: 'playAudio',
            textPlayback: true,
            prefetch: true,
            playbackId: 'p-prefetch',
            pageIndex: 0,
            sentenceIndex: 1,
            audioUrl: '/uploads/tts/prefetch.wav',
            text: '预取句。'
        }
    }]);
});

test('远程预取下发到目标缓存并向源端发送可定位 ready', async () => {
    const messages = [];
    const service = createTextMediaTtsService({
        generateTTS: async () => '/tmp/remote-prefetch.wav',
        sendToDisplay: (displayId, message) => messages.push({ displayId, message }),
        logError: () => {},
        getDisplayCapabilities: () => ({ voicePlayback: true })
    });

    service.setPlaybackContext('source', {
        playbackId: 'p-remote-prefetch',
        selectedDisplayIds: ['source', 'speaker'],
        voiceTargetDisplayId: 'speaker'
    });
    await service.handleSentenceRequest('source', {
        playbackId: 'p-remote-prefetch',
        pageIndex: 0,
        sentenceIndex: 1,
        text: '远程预取句。',
        prefetch: true
    });

    assert.deepEqual(messages, [{
        displayId: 'speaker',
        message: {
            type: 'tts',
            action: 'playAudio',
            textPlaybackRemote: true,
            prefetch: true,
            originDisplayId: 'source',
            voiceTargetDisplayId: 'speaker',
            playbackId: 'p-remote-prefetch',
            pageIndex: 0,
            sentenceIndex: 1,
            audioUrl: '/uploads/tts/remote-prefetch.wav',
            text: '远程预取句。'
        }
    }, {
        displayId: 'source',
        message: {
            type: 'textSentenceTtsReady',
            prefetch: true,
            originDisplayId: 'source',
            voiceTargetDisplayId: 'speaker',
            playbackId: 'p-remote-prefetch',
            pageIndex: 0,
            sentenceIndex: 1,
            text: '远程预取句。'
        }
    }]);
});

test('预取生成失败带 prefetch 标志且不影响当前句定位', async () => {
    const messages = [];
    const service = createTextMediaTtsService({
        generateTTS: async () => {
            throw new Error('预取生成失败');
        },
        sendToDisplay: (displayId, message) => messages.push({ displayId, message }),
        logError: () => {}
    });

    await service.handleSentenceRequest('source', {
        playbackId: 'p-prefetch-error',
        pageIndex: 2,
        sentenceIndex: 3,
        text: '失败句。',
        prefetch: true
    });

    assert.deepEqual(messages, [{
        displayId: 'source',
        message: {
            type: 'textSentenceTtsError',
            playbackId: 'p-prefetch-error',
            pageIndex: 2,
            sentenceIndex: 3,
            prefetch: true,
            message: '预取生成失败'
        }
    }]);
});
