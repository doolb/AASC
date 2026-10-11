'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateChatTtsActions } = require('../src/apps/server/modules/chat/chat-tts-actions');
const { playAgentTts } = require('../src/apps/server/modules/chat/agent-chat-tts');
const { createOrderedTaskScheduler } = require('../src/apps/server/modules/media/ordered-task-scheduler');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const plain = value => value;

test('生成请求开始时发送准备消息，动作标记不朗读，结果保留同句标识', async () => {
    const gate = deferred(), started = deferred(), events = [];
    const job = generateChatTtsActions({ sentence: '[动作:点头]你好❤️', stripMarkdown: plain,
        send: message => events.push(message), generate: async speech => {
            assert.equal(speech, '你好'); assert.equal(events.length, 1);
            assert.equal(events[0].action, 'prepareActions'); started.resolve();
            return gate.promise;
        } });
    await started.promise;
    assert.equal(events.length, 1); assert.equal(events[0].ttsAction.events.length, 2);
    gate.resolve('/audio.wav');
    const result = await job;
    assert.equal(result.ttsAction.id, events[0].ttsAction.id); assert.equal(result.audioPath, '/audio.wav');
});

test('生成失败释放准备，思考阶段保持原TTS路径且不准备动作', async () => {
    const messages = [];
    await assert.rejects(generateChatTtsActions({ sentence: '*点头*你好', stripMarkdown: plain,
        send: message => messages.push(message), generate: async () => { throw new Error('生成失败'); } }), /生成失败/);
    assert.deepEqual(messages.map(message => message.action), ['prepareActions', 'cancelActions']);
    assert.equal(messages[0].ttsAction.id, messages[1].ttsAction.id);
    messages.length = 0;
    await generateChatTtsActions({ sentence: '😊思考', phase: 'think', stripMarkdown: plain,
        send: message => messages.push(message), generate: async speech => { assert.equal(speech, '😊思考'); return '/think.wav'; } });
    assert.equal(messages.length, 0);
});

test('Agent两句并发生成，第二句先完成仍按原顺序播放且准备结果不串句', async () => {
    const first = deferred(), second = deferred(), messages = [], started = deferred(); let calls = 0;
    const job = playAgentTts({ message: '两句', displayId: 'display', splitIntoSentences: () => ['[动作:点头]一', '[动作:挥手]二'],
        stripMarkdown: plain, sendToDisplay: (id, message) => messages.push({ id, ...message }),
        ttsScheduler: createOrderedTaskScheduler({ concurrency: 2 }), generateTTS: async speech => {
            if (++calls === 2) started.resolve(); return speech === '一' ? first.promise : second.promise;
        } });
    await started.promise; assert.equal(messages.length, 2);
    second.resolve('/second.wav'); await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(messages.filter(message => message.action === 'playAudio').length, 0);
    first.resolve('/first.wav'); await job;
    const plays = messages.filter(message => message.action === 'playAudio');
    assert.deepEqual(plays.map(message => message.text), ['[动作:点头]一', '[动作:挥手]二']);
    for (const play of plays) assert.equal(messages.find(message => message.action === 'prepareActions'
        && message.ttsAction.id === play.ttsAction.id).ttsAction.text, play.text);
});

async function harness() {
    const { createTtsActionPlayer } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-tts-actions.mjs');
    const audio = { currentTime: 0, duration: 4, paused: true, ended: false, error: null, seeking: false,
        readyState: 4, playbackRate: 1, src: '', getAttribute() { return this.src; } };
    const starts = [], stops = [], clockFrames = new Map(), preparations = [], expressions = [];
    let entry = null, serial = 0, manual = 0, modelToken = 'model', compileGate = null;
    const human = { getState: () => ({ ready: true, token: modelToken, layers: [] }),
        serverActions: { load: async () => [] }, learn: { list: () => [] }, face: { resolve: () => ({ weights: [], missing: false }) },
        async prepare(intent) { preparations.push(intent); if (compileGate) await compileGate.promise; return { name: intent.action }; },
        startPrepared(prepared, options) { starts.push({ prepared, ...options }); }, stop: value => stops.push(value),
        setExpressionWeights(...args) { expressions.push(args); } };
    const player = createTtsActionPlayer({ audio, api: () => human, source: () => entry, manual: () => manual,
        hidden: () => false, raf: work => { clockFrames.set(++serial, work); return serial; }, caf: id => clockFrames.delete(id),
        timeline: async () => ({ duration: 4, units: [{ label: '你好', start: 0, end: 4 }] }), report: error => { throw error; } });
    return { audio, starts, stops, preparations, expressions, player,
        data: (id = 'sentence') => ({ id, phase: 'answer', conversationId: 'chat', text: '[动作:点头]你好', speech: '你好' }),
        gate: value => { compileGate = value; }, model: value => { modelToken = value; }, manual: value => { manual = value; },
        bind(data) { audio.src = '/' + data.id + '.wav'; entry = { src: audio.src, ttsAction: data }; },
        async step(seconds) { audio.currentTime = seconds; const frames = [...clockFrames.values()]; clockFrames.clear();
            for (const work of frames) work(); await Promise.resolve(); },
    };
}

test('准备阶段不接管模型；真正播放提交一次，暂停和缓冲不推进自动动作时钟', async () => {
    const h = await harness(), data = h.data();
    try {
        await h.player.ready(data); assert.equal(h.preparations.length, 1); assert.equal(h.starts.length, 0);
        h.bind(data); await h.player.refresh(); await h.step(0); assert.equal(h.starts.length, 0);
        h.audio.paused = false; await h.player.refresh(); await h.step(.1);
        assert.equal(h.starts.length, 1); assert.equal(h.starts[0].clock(), .1);
        h.audio.paused = true; h.player.pause(); await h.step(.3); assert.equal(h.starts[0].clock(), .1);
        h.audio.paused = false; await h.player.refresh(); await h.step(.4); assert.equal(h.starts[0].clock(), .4);
        h.audio.readyState = 2; await h.step(.5); assert.equal(h.starts[0].clock(), .4);
        h.audio.readyState = 4; await h.player.refresh(); await h.step(.55); assert.equal(h.starts[0].clock(), .55);
        await h.step(.2); assert.equal(h.starts.length, 1);
    } finally { h.player.dispose(); }
});

test('准备尚未结束时取消/换模型，迟到编译不会接管；旧句不可重新准备', async () => {
    const h = await harness(), gate = deferred(), data = h.data(); h.gate(gate);
    const record = h.player.prepare(data);
    await new Promise(resolve => setTimeout(resolve, 0)); h.player.cancel({ id: data.id }); gate.resolve();
    await record.ready; assert.equal(h.player.prepare(data), null); assert.equal(h.starts.length, 0);
    assert.equal(h.player.getState().prepared, 0); h.player.dispose();
});

test('多次音频就绪事件只创建一个会话，手动动作接管只释放自动轨道', async () => {
    const h = await harness(), data = h.data(); await h.player.ready(data); h.bind(data); h.audio.paused = false;
    await Promise.all([h.player.refresh(), h.player.refresh(), h.player.refresh()]); await h.step(.1);
    assert.equal(h.starts.length, 1); h.manual(1); await h.step(.2);
    assert.equal(h.player.getState().id, ''); assert.ok(h.stops.includes('tts:sentence'));
    assert.ok(h.stops.every(value => value.startsWith('tts:') || value.startsWith('tts-prepare:'))); h.player.dispose();
});

test('前跳跳过过期动作，后退不重复；模型变化阻止旧句播放', async () => {
    const h = await harness(); const data = { ...h.data(), text: '你[动作:点头]好' };
    await h.player.ready(data); h.bind(data); h.audio.paused = false; await h.player.refresh(); await h.step(.1);
    await h.step(3); assert.equal(h.starts.length, 0); await h.step(1); await h.step(2.1); assert.equal(h.starts.length, 0);
    h.model('new'); await h.step(2.2); assert.equal(h.player.getState().id, ''); h.player.dispose();
});

test('Human外部音频时钟只控制本轨道，渲染时钟推进不影响暂停轨道', async () => {
    const { createHumanMixer } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-human-mixer.mjs');
    const mixer = createHumanMixer(); let audioTime = .2;
    const automatic = mixer.start({ owner: 'tts', layers: [], duration: 2, clock: () => audioTime });
    const manual = mixer.start({ owner: 'manual', layers: [], duration: 2 });
    for (let i = 0; i < 10; i++) mixer.advance(.1);
    assert.equal(mixer.state(automatic.id).time, .2); assert.ok(mixer.state(manual.id).time > .9);
    audioTime = .5; assert.equal(mixer.state(automatic.id).time, .5); mixer.stop('tts');
    assert.equal(mixer.state(manual.id).active, true);
});

test('句尾爱心在语音末尾窗口播放，不遗漏到ended之后', async () => {
    const h = await harness(), data = { ...h.data('heart'), text: '你好❤️' };
    await h.player.ready(data); h.bind(data); h.audio.paused = false; await h.player.refresh();
    await h.step(1.9); assert.equal(h.starts.length, 0);
    await h.step(2.1); assert.equal(h.starts.length, 1); assert.equal(h.starts[0].prepared.name, '比心'); h.player.dispose();
});
