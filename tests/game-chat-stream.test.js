'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runGameAwareChat } = require('../src/apps/server/modules/game/game-chat-bridge');
const { createGomokuGameService, parseGameTag } = require('../src/apps/server/modules/game/gomoku-game-service');
const { splitIntoSentences } = require('../src/core/utils/sentence-splitter');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-chat-stream-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return createGomokuGameService({ filePath: path.join(dir, 'game.json') });
}

for (const active of [false, true]) test(`模型完成前文字和首段TTS已发布，收尾不重复：活动棋局=${active}`, async t => {
    const game = fixture(t);
    if (active) game.apply('display', parseGameTag('Game:五子棋,GameUser,开局,9'));
    const chunks = [], sentences = [];
    let finished = false;
    const chat = { splitIntoSentences, async chatStream(input, options, cb) {
        let message = '';
        for (const part of ['**早上好。', '今天适合', '散步**。尾句']) {
            message += part; cb.onChunk(part, message, ''); await tick();
        }
        assert.equal(chunks.length >= 2, true);
        assert.equal(sentences[0].text, '早上好。');
        assert.equal(sentences[0].finished, false);
        finished = true;
        return { success: true, message, speech: message, history: [] };
    } };
    const result = await runGameAwareChat({ chat, gameService: game, displayId: 'display', content: '早', options: {},
        callbacks: { onChunk: delta => chunks.push(delta),
            onSentence: (text, _m, _r, _s, _p, subtitle) => sentences.push({ text, subtitle, finished }) } });
    assert.equal(chunks.join(''), result.message);
    assert.deepEqual(sentences.map(s => s.text), ['早上好。', '今天适合散步。', '尾句']);
    assert.match(sentences[0].subtitle.markdown, /\*\*早上好。\*\*$/);
});

test('跨块游戏调用和失败操作叙述不显示或播报，原GM仍执行', async t => {
    const game = fixture(t);
    let calls = 0;
    const visible = [], speech = [], trace = [];
    const chat = { splitIntoSentences, async chatStream(input, options, cb) {
        calls++;
        const message = calls === 1 ? 'Game:五子棋,GameUser,开局,9\n棋盘打开。' : '棋盘已准备好，请先选择坐标。';
        let full = '';
        for (const char of message) { full += char; cb.onChunk(char, full, ''); }
        return { success: true, message, speech: message, history: [] };
    } };
    const result = await runGameAwareChat({ chat, gameService: game, displayId: 'display', content: '开始', options: {},
        callbacks: { onChunk: c => visible.push(c), onSentence: t => speech.push(t), onGameProtocol: e => trace.push(e) } });
    assert.equal(result.success, true);
    assert.equal(game.snapshot('display').size, 9);
    assert.ok(trace.some(e => e.kind === 'GM'));
    assert.doesNotMatch(visible.join('') + speech.join(''), /Game:|GameUser|开局,9/);
});

test('取消后迟到分块、尾段和完成不能继续发布', async t => {
    const game = fixture(t); const control = new AbortController(); const seen = [];
    const chat = { splitIntoSentences, async chatStream(input, options, cb) {
        cb.onChunk('早。', '早。', ''); control.abort();
        cb.onChunk('迟到。', '早。迟到。', '');
        return { success: true, message: '早。迟到。' };
    } };
    const result = await runGameAwareChat({ chat, gameService: game, displayId: 'display', content: '早',
        options: { signal: control.signal }, callbacks: { onChunk: c => seen.push(c), onSentence: t => seen.push(t) } });
    assert.equal(result.success, false);
    assert.ok(seen.length > 0);
    assert.ok(seen.every(s => !s.includes('迟到')));
});

test('重复的自然句不能被收尾去重误删，思考与答案各自保持阶段顺序', async t => {
    const game = fixture(t); const speech = [];
    const chat = { splitIntoSentences, async chatStream(_input, _options, cb) {
        cb.onChunk('', '', '先想一想。');
        cb.onChunk('早。', '早。', '先想一想。');
        cb.onChunk('早。', '早。早。', '先想一想。');
        return { success: true, message: '早。早。尾段', reasoning: '先想一想。', speech: '先想一想。早。早。尾段' };
    } };
    await runGameAwareChat({ chat, gameService: game, displayId: 'display', content: '早', options: {},
        callbacks: { onSentence: (text, _m, _r, _s, phase) => speech.push([phase, text]) } });
    assert.deepEqual(speech, [['think', '先想一想。'], ['answer', '早。'], ['answer', '早。'], ['answer', '尾段']]);
});

test('流式Markdown清洗保留有限字典动作，动作不读出且准备消息早于合成', async t => {
    const { generateChatTtsActions } = require('../src/apps/server/modules/chat/chat-tts-actions');
    const { toSpeechText } = require('../src/core/utils/markdown-speech');
    const game = fixture(t), sent = [], jobs = [], generated = [];
    const chat = { splitIntoSentences, async chatStream(_i, _o, cb) {
        cb.onChunk('*点头*你好。', '*点头*你好。', '');
        await tick();
        return { success: true, message: '*点头*你好。', speech: '*点头*你好。' };
    } };
    await runGameAwareChat({ chat, gameService: game, displayId: 'display', content: '早', options: {},
        callbacks: { onSentence: (sentence, _m, _r, _s, _p, subtitle) => jobs.push(generateChatTtsActions({ sentence,
            subtitle, stripMarkdown: toSpeechText, send: packet => sent.push(packet),
            generate: async text => { assert.ok(sent.some(p => p.action === 'prepareActions')); generated.push(text); return 'stub.wav'; } })) } });
    await Promise.all(jobs);
    assert.deepEqual(generated, ['你好。']);
    assert.equal(sent[0].ttsAction.events[0].kind, 'action');
});
