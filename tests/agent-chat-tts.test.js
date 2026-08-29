'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    createAgentTtsStream,
    playAgentTts
} = require('../src/apps/server/modules/chat/agent-chat-tts');

function createHarness(overrides = {}) {
    const controlMessages = [];
    const displayMessages = [];
    const generatedTexts = [];
    const generatedAudio = overrides.generatedAudio || ((text) => `/uploads/tts/${text}.wav`);

    return {
        controlMessages,
        displayMessages,
        generatedTexts,
        options: {
            message: overrides.message || '第一句。第二句。',
            playOnControl: overrides.playOnControl === true,
            displayId: overrides.displayId,
            displayIds: overrides.displayIds || [],
            splitIntoSentences: (text) => {
                const sentences = [];
                let current = '';
                for (const char of text) {
                    current += char;
                    if (char === '。') {
                        sentences.push(current);
                        current = '';
                    }
                }
                if (current) sentences.push(current);
                return sentences;
            },
            stripMarkdown: (text) => text.replaceAll('**', ''),
            generateTTS: async (text) => {
                generatedTexts.push(text);
                return generatedAudio(text);
            },
            sendToControl: (data) => controlMessages.push(data),
            sendToDisplay: (displayId, data) => displayMessages.push({ displayId, data }),
            onError: overrides.onError
        }
    };
}

test('Agent 回复启用控制端播放时逐句发送 playOnControl', async () => {
    const harness = createHarness({ message: '**第一句**。第二句。', playOnControl: true });

    await playAgentTts(harness.options);

    assert.deepStrictEqual(harness.generatedTexts, ['第一句。', '第二句。']);
    assert.deepStrictEqual(harness.controlMessages, [
        { type: 'playOnControl', audioUrl: '/uploads/tts/第一句。.wav', text: '**第一句**。' },
        { type: 'playOnControl', audioUrl: '/uploads/tts/第二句。.wav', text: '第二句。' }
    ]);
    assert.deepStrictEqual(harness.displayMessages, []);
});

test('Agent 流式完整句子应立即进入 TTS，完成时只冲刷尾句', async () => {
    const harness = createHarness({
        message: '第一句。第二句。第三句。',
        playOnControl: true
    });
    const stream = createAgentTtsStream(harness.options);

    stream.onChunk('第一句。');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepStrictEqual(harness.generatedTexts, [], '单个完整句子暂存到下一段或完成事件前不应阻塞流式回调');

    stream.onChunk('第二句。第三');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepStrictEqual(harness.generatedTexts, ['第一句。', '第二句。'], '第二段到达后应立即播报已确认的完整句子');

    await stream.onComplete('第一句。第二句。第三');
    assert.deepStrictEqual(harness.generatedTexts, ['第一句。', '第二句。', '第三']);
    assert.deepStrictEqual(harness.controlMessages.map((item) => item.text), ['第一句。', '第二句。', '第三']);
});

test('Agent 双路生成完成顺序变化时仍按句子顺序发送', async () => {
    let releaseFirst;
    const firstReady = new Promise((resolve) => {
        releaseFirst = resolve;
    });
    const started = [];
    const harness = createHarness({
        message: '第一句。第二句。',
        displayId: 'display-1',
        generatedAudio: async (text) => {
            started.push(text);
            if (text === '第一句。') await firstReady;
            return `/uploads/tts/${text}.wav`;
        }
    });
    harness.options.ttsConcurrency = 2;

    const pending = playAgentTts(harness.options);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(started, ['第一句。', '第二句。']);
    assert.deepEqual(harness.displayMessages, []);

    releaseFirst();
    await pending;
    assert.deepEqual(harness.displayMessages.map((item) => item.data.text), ['第一句。', '第二句。']);
});

test('Agent TTS 直接跳过仅标点分句', async () => {
    const harness = createHarness({ displayId: 'display-1' });
    harness.options.splitIntoSentences = () => ['第一句。', '？', '第二句。'];

    await playAgentTts(harness.options);

    assert.deepEqual(harness.generatedTexts, ['第一句。', '第二句。']);
    assert.deepEqual(harness.displayMessages.map((item) => item.data.text), ['第一句。', '第二句。']);
});

test('Agent 回复按单显示端和多显示端选择下发 tts/playAudio', async () => {
    const single = createHarness({ message: '单显示端。', displayId: 'display-1' });
    await playAgentTts(single.options);
    assert.deepStrictEqual(single.displayMessages, [{
        displayId: 'display-1',
        data: {
            type: 'tts',
            action: 'playAudio',
            audioUrl: '/uploads/tts/单显示端。.wav',
            text: '单显示端。'
        }
    }]);

    const multiple = createHarness({ message: '多显示端。', displayIds: ['display-1', 'display-2'] });
    await playAgentTts(multiple.options);
    assert.deepStrictEqual(multiple.displayMessages.map((item) => item.displayId), ['display-1', 'display-2']);
    assert.ok(multiple.displayMessages.every((item) => item.data.action === 'playAudio'));
});

test('Agent TTS 失败时记录错误并继续处理后续句子', async () => {
    const errors = [];
    const harness = createHarness({
        message: '失败句。成功句。',
        displayId: 'display-1',
        generatedAudio: (text) => {
            if (text === '失败句。') throw new Error('TTS unavailable');
            return '/uploads/tts/success.wav';
        },
        onError: (error, sentence) => errors.push({ error: error.message, sentence })
    });

    await playAgentTts(harness.options);

    assert.deepStrictEqual(errors, [{ error: 'TTS unavailable', sentence: '失败句。' }]);
    assert.deepStrictEqual(harness.displayMessages.map((item) => item.data.text), ['成功句。']);
});
