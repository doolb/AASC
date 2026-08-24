'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    registerTextMediaDisplayHandlers,
    handleTextMediaDisplayMessage,
    handleTextMediaControlMessage
} = require('../src/apps/server/modules/media/text-media-ws-integration');

test('服务器为分句 TTS 注册专用路由并调用服务', async () => {
    const handlers = new Map();
    const routed = [];
    const wsServer = {
        registerHandler(type, handler) {
            handlers.set(type, handler);
        }
    };
    const textMediaTtsService = {
        async handleSentenceRequest(displayId, data) {
            routed.push({ displayId, data });
        }
    };

    registerTextMediaDisplayHandlers({
        wsServer,
        displayTypes: ['canvasSize', 'textProgress'],
        handleDisplayMessage: () => {}
    }, textMediaTtsService);

    assert.equal(typeof handlers.get('textSentenceTts'), 'function');
    await handlers.get('textSentenceTts')({ playbackId: 'p-1', text: '第一句' }, { displayId: 'display-1' });
    assert.deepEqual(routed, [{
        displayId: 'display-1',
        data: { playbackId: 'p-1', text: '第一句' }
    }]);
});

test('服务器注册远程文本播放回执路由并调用文本 TTS 服务', () => {
    const handlers = new Map();
    const finished = [];
    const wsServer = {
        registerHandler(type, handler) {
            handlers.set(type, handler);
        }
    };
    const textMediaTtsService = {
        async handleSentenceRequest() {},
        handleSentenceFinished(displayId, data) {
            finished.push({ displayId, data });
        }
    };

    registerTextMediaDisplayHandlers({
        wsServer,
        displayTypes: [],
        handleDisplayMessage: () => {}
    }, textMediaTtsService);

    assert.equal(typeof handlers.get('textSentenceTtsFinished'), 'function');
    handlers.get('textSentenceTtsFinished')(
        { originDisplayId: 'source', playbackId: 'p-1', pageIndex: 0, sentenceIndex: 0, status: 'ended' },
        { displayId: 'speaker' }
    );
    assert.deepEqual(finished, [{
        displayId: 'speaker',
        data: { originDisplayId: 'source', playbackId: 'p-1', pageIndex: 0, sentenceIndex: 0, status: 'ended' }
    }]);
});

test('文本进度仅持久化恢复字段并转发给控制端', () => {
    const displayData = { state: {} };
    const persisted = [];
    const broadcasts = [];

    const handled = handleTextMediaDisplayMessage({
        displayId: 'display-1',
        data: {
            type: 'textProgress', playbackId: 'p-1', pageIndex: 1, pageTotal: 3,
            sentenceIndex: 2, sentenceTotal: 4, state: 'paused', format: 'markdown',
            encodedContent: '不能持久化'
        },
        displayData,
        persistDisplayState: (_, partialState) => persisted.push(partialState),
        broadcastToControls: (message) => broadcasts.push(message)
    });

    const expectedProgress = {
        playbackId: 'p-1', pageIndex: 1, pageTotal: 3,
        sentenceIndex: 2, sentenceTotal: 4, state: 'paused', format: 'markdown'
    };
    assert.equal(handled, true);
    assert.deepEqual(displayData.state.currentTextProgress, expectedProgress);
    assert.deepEqual(persisted, [{ currentTextProgress: expectedProgress }]);
    assert.deepEqual(broadcasts, [{ displayId: 'display-1', type: 'textProgress', ...expectedProgress }]);
});

test('文本样式持久化，暂停播放取消旧音频并仍转发控制消息', () => {
    const displayData = { state: { currentTextProgress: { playbackId: 'p-1' } } };
    const persisted = [];
    const cancelled = [];
    const sent = [];
    const dependencies = {
        displayId: 'display-1',
        displayData,
        persistDisplayState: (_, partialState) => persisted.push(partialState),
        sendToDisplay: (displayId, message) => sent.push({ displayId, message }),
        textMediaTtsService: { cancel: (displayId, playbackId) => cancelled.push({ displayId, playbackId }) }
    };

    assert.equal(handleTextMediaControlMessage({
        ...dependencies,
        data: { type: 'control', action: 'textStyle', value: { fontSize: 32 } }
    }), true);
    assert.deepEqual(persisted, [{ textStyle: { fontSize: 32 } }]);

    assert.equal(handleTextMediaControlMessage({
        ...dependencies,
        data: { type: 'control', action: 'textPlayback', value: { action: 'pause' } }
    }), true);
    assert.deepEqual(cancelled, [{ displayId: 'display-1', playbackId: 'p-1' }]);
    assert.deepEqual(sent, [
        { displayId: 'display-1', message: { type: 'control', action: 'textStyle', value: { fontSize: 32 } } },
        { displayId: 'display-1', message: { type: 'control', action: 'textPlayback', value: { action: 'pause' } } }
    ]);
});

test('文本播放停止时按源显示端和播放标识取消远程路由上下文', () => {
    const cancelled = [];
    const sent = [];

    const handled = handleTextMediaControlMessage({
        displayId: 'source',
        data: { type: 'control', action: 'textPlayback', value: { action: 'stop', playbackId: 'p-stop' } },
        displayData: { state: { currentTextProgress: { playbackId: 'fallback' } } },
        persistDisplayState: () => {},
        sendToDisplay: (displayId, message) => sent.push({ displayId, message }),
        textMediaTtsService: {
            cancel: (displayId, playbackId) => cancelled.push({ displayId, playbackId })
        }
    });

    assert.equal(handled, true);
    assert.deepEqual(cancelled, [{ displayId: 'source', playbackId: 'p-stop' }]);
    assert.equal(sent.length, 1);
});
