'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createOrderedTaskScheduler } = require('../src/apps/server/modules/media/ordered-task-scheduler');
const { createTtsProviderService } = require('../src/apps/server/modules/tts/tts-provider-service');
const { createQwenChatProvider } = require('../src/apps/server/modules/tts/qwen-chat-tts');
const { normalizeSettings } = require('../src/apps/server/modules/tts/tts-provider-settings');
const { wrapPcm } = require('../src/external/tts/tts-wav');

const serverSource = fs.readFileSync(
    path.join(__dirname, '../src/apps/server/boot/server-app.js'),
    'utf8'
);

test('普通AI两条真实句子回调跳过qwen-chat纯emoji，正文继续播放且保留真实失败', async t => {
    for (const mode of ['legacy', 'current']) await t.test(mode, async () => {
        const inputs = [];
        const sent = [];
        const errors = [];
        const ttsScheduler = createOrderedTaskScheduler({ concurrency: 2 });
        const settings = normalizeSettings({ aiReplyDefault: { provider: 'qwen-chat' }, providers: { 'qwen-chat': { enabled: true } } });
        const service = createTtsProviderService({ getSettings: () => settings, storeAudio: () => 'reply.wav',
            registry: { 'qwen-chat': createQwenChatProvider({ speechService: { generate: async request => {
                inputs.push(request.input);
                if (request.input === '真实失败') throw new Error('真实失败');
                return { audio: wrapPcm(Buffer.from([1, 0])) };
            } } }) } });
        const start = serverSource.indexOf(mode === 'legacy' ? 'onSentence: (sentence) => {' : 'onSentence: (sentence, _fullMessage');
        const end = serverSource.indexOf('onComplete:', start);
        assert.ok(start > 0 && end > start);
        const context = { path, ttsScheduler, BUSINESS_TYPES: { AI_REPLY: 'ai_reply' },
            data: {}, displayId: 'display-a', preferredDisplayId: 'display-a', replyTemplateTts: null,
            chat: { getTemplateByName: () => null }, stripMarkdown: text => text,
            isPunctuationOnly: () => false, isTemporaryConversation: false, tts: true,
            isRepairModeTtsSuppressed: () => false, allowRepairModeTts: false,
            isCurrentChatTtsGeneration: () => true, ttsToken: null, ttsConversationId: null,
            playOnControl: false, routeVoiceToPreferredDisplay: false, displayIds: [], voiceOriginDisplayId: null,
            generateTtsWithFallback: (text, voice, speed, displayId, options) => service.generate({ text, ...options }),
            sendToDisplay: (displayId, message) => sent.push({ displayId, ...message }),
            logError: (category, message) => errors.push(message) };
        const onSentence = vm.runInNewContext(`({${serverSource.slice(start, end)}}).onSentence`, context);
        for (const text of ['✨', '你好🐱！', '❤️', '真实失败', '后续正文']) onSentence(text);
        await ttsScheduler.waitForIdle();
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(inputs, ['你好！', '真实失败', '后续正文']);
        assert.deepEqual(sent.map(message => message.text), ['你好🐱！', '后续正文']);
        assert.equal(sent[0].audioUrl, '/uploads/tts/reply.wav');
        assert.deepEqual(errors, ['TTS生成失败: 真实失败']);
    });
});

test('服务端普通 Chat 和手动 TTS 使用有序调度器', () => {
    assert.match(serverSource, /const \{ createOrderedTaskScheduler \} = require\('\.\.\/modules\/media\/ordered-task-scheduler'\)/u);
    assert.match(serverSource, /function createTtsGenerationScheduler\(preferredDisplayId = null\)/u);
    assert.match(serverSource, /const ttsScheduler = createTtsGenerationScheduler\(preferredDisplayId\);/u);
    assert.match(serverSource, /const ttsScheduler = createTtsGenerationScheduler\(displayId\);/u);
    assert.match(serverSource, /await ttsScheduler\.waitForIdle\(\);/u);
    assert.match(serverSource, /generateTtsWithFallback\(sentence, undefined, undefined, preferredDisplayId, replyTtsOptions\)/u);
    assert.match(serverSource, /generateTtsWithFallback\(cleanText, undefined, undefined, preferredDisplayId,\s*\{ businessType: BUSINESS_TYPES.AI_REPLY/u);
    assert.match(serverSource, /chat\.splitIntoSentences\(cleanText\)[\s\S]*?filter\(\(sentence\) => !isPunctuationOnly\(sentence\)\)/u);
    assert.match(serverSource, /if \(!tts \|\| isPunctuationOnly\(sentence\)\) return;/u);
    assert.doesNotMatch(serverSource, /let ttsQueue = Promise\.resolve\(\)/u);
});
