'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('实际显示页全停及会话停止通知对应重播结束，保留其它会话队列', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/display.html'), 'utf8');
    const events = [];
    const noop = () => {};
    const context = { Set, window: { dispatchEvent: event => events.push(event.detail) },
        CustomEvent: class { constructor(type, value) { this.type = type; this.detail = value.detail; } },
        clearTtsRecovery: noop, hideTtsText: noop, sendVoiceTtsPlaybackFinished: noop,
        endTtsVideoCoordinationIfIdle: noop, scheduleTtsRecordingResume: noop, playNextTts: noop,
        ttsAudio: { pause: noop }, ttsBatchPlaybackStates: new Map(), ttsPlaybackToken: 0,
        currentTtsItem: { manualTtsRequestId: 'first', chatTtsConversationId: 'a' },
        ttsQueue: [{ manualTtsRequestId: 'first', chatTtsConversationId: 'a' },
            { manualTtsRequestId: 'second', chatTtsConversationId: 'b' }] };
    vm.createContext(context);
    for (const name of ['stopTtsPlayback', 'isChatTtsItemMatch', 'notifyStoppedManualTts', 'stopChatTtsPlayback']) {
        const start = source.indexOf(`        function ${name}(`);
        const end = source.indexOf('\n        function ', start + 1);
        let code = source.slice(start, end);
        // 最后一个函数后紧接公开播放器赋值，只保留该函数定义。
        code = code.slice(0, code.lastIndexOf('\n        }') + 10);
        vm.runInContext(code, context);
    }
    context.stopChatTtsPlayback('a');
    assert.equal(events.length, 1);
    assert.equal(events[0].requestId, 'first');
    assert.equal(events[0].status, 'cancelled');
    assert.equal(context.ttsQueue.length, 1);
    assert.equal(context.ttsQueue[0].manualTtsRequestId, 'second');
    context.stopTtsPlayback();
    assert.equal(events.at(-1).requestId, 'second');
    assert.equal(context.ttsQueue.length, 0);
});
