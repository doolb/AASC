'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createManualChatTtsService } = require('../src/apps/server/modules/chat/chat-manual-tts');

function setup(generate) {
    const audio = [], status = [], contexts = [];
    const ws = { send: raw => status.push(JSON.parse(raw)) };
    const service = createManualChatTtsService({
        split: text => text.split('|'), strip: text => text.replace(/\*/g, ''),
        resolveOptions: value => { contexts.push(value); return { captured: true }; },
        scheduler: () => ({ enqueue: async work => work() }),
        generate: generate || (async text => `${text}.wav`), toAudioUrl: value => `/uploads/tts/${value}`,
        send: (id, message) => audio.push({ id, ...message }), capabilities: () => ({ voicePlayback: true }),
        broadcast: message => audio.push({ broadcast: true, ...message }), suppressed: () => false, onError() {}
    });
    return { service, ws, audio, status, contexts };
}

test('显示端重播固定自身目标、保留来源上下文和顺序分句，发送生成状态回执', async () => {
    const h = setup();
    await h.service.play({ text: '**甲**|乙', requestId: 'r', displayIds: ['victim'], broadcastAll: true, playOnControl: true,
        chatReplyContext: { businessType: 'agent_reply', templateName: '原Agent' } }, { ws: h.ws, sourceDisplayId: 'self' });
    assert.deepEqual(h.audio.map(a => a.id), ['self', 'self']);
    assert.deepEqual(h.audio.map(a => a.text), ['甲', '乙']);
    assert.equal(h.audio.at(-1).manualTtsLast, true);
    assert.equal(h.contexts[0].templateName, '原Agent');
    assert.deepEqual(h.status.map(s => s.status), ['generating', 'queued']);
});

test('停止或断线取消在途结果，失败回执不能伪装完成', async () => {
    let release;
    const h = setup(() => new Promise(resolve => { release = resolve; }));
    const pending = h.service.play({ text: '等待', requestId: 'r' }, { ws: h.ws, sourceDisplayId: 'self' });
    h.service.stop(h.ws);
    release('late.wav');
    await pending;
    assert.equal(h.audio.length, 0);
    assert.equal(h.status.at(-1).status, 'cancelled');
    const failure = setup(async () => { throw Error('failed'); });
    await failure.service.play({ text: '失败', requestId: 'f' }, { ws: failure.ws, sourceDisplayId: 'self' });
    assert.equal(failure.status.at(-1).status, 'error');
    assert.equal(failure.audio.length, 0);
});

test('控制端继续支持多显示端与控制端播放原有路由', async () => {
    const h = setup();
    await h.service.play({ text: '多端' }, { ws: h.ws, displayId: 'one' });
    await h.service.play({ text: '控制', playOnControl: true }, { ws: h.ws });
    assert.equal(h.audio[0].id, 'one');
    assert.equal(h.status.at(-1).type, 'playOnControl');
});

test('远程按目标和会话停止只取消匹配的显示端在途重播', async () => {
    const releases = [];
    const h = setup(() => new Promise(resolve => releases.push(resolve)));
    const other = { send() {} };
    const first = h.service.play({ text: '甲', requestId: 'r', chatTtsConversationId: 'chat-a' }, { ws: h.ws, sourceDisplayId: 'self' });
    const second = h.service.play({ text: '乙', requestId: 's', chatTtsConversationId: 'chat-b' }, { ws: other, sourceDisplayId: 'other' });
    h.service.stopTargets(['self'], { conversationId: 'chat-a' });
    releases.forEach(resolve => resolve('late.wav'));
    await Promise.all([first, second]);
    assert.deepEqual(h.audio.map(item => item.id), ['other']);
    assert.equal(h.status.at(-1).status, 'cancelled');
});
