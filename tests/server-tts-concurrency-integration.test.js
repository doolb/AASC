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
const { generateChatTtsActions } = require('../src/apps/server/modules/chat/chat-tts-actions');

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
        const context = { path, ttsScheduler, generateChatTtsActions, BUSINESS_TYPES: { AI_REPLY: 'ai_reply' },
            data: { message: '旧聊天问题' }, content: '本轮问题', displayContent: '本轮显示问题',
            displayId: 'display-a', preferredDisplayId: 'display-a', replyTemplateTts: null,
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
        const played = sent.filter(message => message.action === 'playAudio');
        assert.deepEqual(played.map(message => message.text), ['你好🐱！', '后续正文']);
        assert.equal(played[0].audioUrl, '/uploads/tts/reply.wav');
        assert.equal(played[0].ttsAction.id, sent.find(message => message.action === 'prepareActions'
            && message.ttsAction.text === played[0].text).ttsAction.id);
        assert.deepEqual(errors, ['TTS生成失败: 真实失败']);
    });
});

test('服务端普通 Chat 和手动 TTS 使用有序调度器', () => {
    assert.match(serverSource, /const \{ createOrderedTaskScheduler \} = require\('\.\.\/modules\/media\/ordered-task-scheduler'\)/u);
    assert.match(serverSource, /function createTtsGenerationScheduler\(preferredDisplayId = null, ttsOptions = \{\}\)/u);
    assert.match(serverSource, /const ttsScheduler = createTtsGenerationScheduler\(preferredDisplayId, replyTtsOptions\);/u);
    assert.match(serverSource, /const ttsScheduler = createTtsGenerationScheduler\(displayId,\s*\{ businessType: BUSINESS_TYPES.AI_REPLY/u);
    assert.match(serverSource, /await ttsScheduler\.waitForIdle\(\);/u);
    assert.match(serverSource, /generateTtsWithFallback\(sentence, undefined, undefined, preferredDisplayId, replyTtsOptions\)/u);
    assert.match(serverSource, /generateTtsWithFallback\(cleanText, undefined, undefined, preferredDisplayId,\s*\{ businessType: BUSINESS_TYPES.AI_REPLY/u);
    assert.match(serverSource, /chat\.splitIntoSentences\(cleanText\)[\s\S]*?filter\(\(sentence\) => !isPunctuationOnly\(sentence\)\)/u);
    assert.match(serverSource, /if \(!tts \|\| isPunctuationOnly\(sentence\)\) return;/u);
    assert.doesNotMatch(serverSource, /let ttsQueue = Promise\.resolve\(\)/u);
});

test('实际调度入口按权威模板让豆包分句单路_Qwen及原生显示槽位保持双路且发送有序', async () => {
    const {BUSINESS_TYPES}=require('../src/apps/server/modules/tts/tts-provider-policy');
    const {getDisplayTtsConcurrency}=require('../src/apps/server/modules/media/display-cpu-status');
    const start=serverSource.indexOf('function createTtsGenerationScheduler(');
    const end=serverSource.indexOf('const pendingDisplayTtsRequests',start);
    const settings=normalizeSettings({aiReplyDefault:{provider:'doubao-chat'}});
    const providerService=createTtsProviderService({getSettings:()=>settings,registry:{}});
    const factory=vm.runInNewContext(`${serverSource.slice(start,end)};createTtsGenerationScheduler`,{
        BUSINESS_TYPES,ttsProviderService:providerService,createOrderedTaskScheduler,getDisplayTtsConcurrency,
        config:{get:()=> 'display'},findDisplayWithTts:()=>({id:'display'}),
        displayClients:new Map([['display',{state:{cpuStatus:{tts:{totalCoreCount:2}}}}]])});
    for(const [templateProvider,expected] of [[undefined,1],['qwen-chat',2],['system',2]]) {
        const scheduler=factory('display',{businessType:BUSINESS_TYPES.AI_REPLY,
            ...(templateProvider?{templateTts:{provider:templateProvider}}:{})});
        let active=0,max=0;const delivered=[];
        await Promise.all([1,2,3].map(index=>scheduler.enqueue(async()=>{
            active++;max=Math.max(max,active);await new Promise(resolve=>setImmediate(resolve));active--;return index;
        }).then(index=>delivered.push(index))));
        assert.equal(max,expected);assert.deepEqual(delivered,[1,2,3]);
    }
});

test('普通AI真实句子回调和Agent生成回调向豆包传本轮原输入，不串并发回合', async () => {
    const seen = [];
    const settings = normalizeSettings({ aiReplyDefault: { provider: 'doubao-api' } });
    const service = createTtsProviderService({ getSettings: () => settings, storeAudio: () => 'reply.wav',
        registry: { 'doubao-api': { generate: async request => { seen.push(request); return wrapPcm(Buffer.from([1, 0])); } } } });
    const schedulers = [];
    for (const [mode, input] of [['legacy', '旧入口问题'], ['current', '当前第一轮'], ['current', '当前第二轮']]) {
        const ttsScheduler = createOrderedTaskScheduler({ concurrency: 2 }); schedulers.push(ttsScheduler);
        const start = serverSource.indexOf(mode === 'legacy' ? 'onSentence: (sentence) => {' : 'onSentence: (sentence, _fullMessage');
        const end = serverSource.indexOf('onComplete:', start);
        const context = { path, ttsScheduler, generateChatTtsActions, BUSINESS_TYPES: { AI_REPLY: 'ai_reply' },
            data: { message: input }, content: input, displayContent: input, displayId: 'display-a', preferredDisplayId: 'display-a', replyTemplateTts: null,
            chat: { getTemplateByName: () => null }, stripMarkdown: text => text, isPunctuationOnly: () => false,
            isTemporaryConversation: false, tts: true, isRepairModeTtsSuppressed: () => false, allowRepairModeTts: false,
            isCurrentChatTtsGeneration: () => true, ttsToken: null, ttsConversationId: null, playOnControl: false,
            routeVoiceToPreferredDisplay: false, displayIds: [], voiceOriginDisplayId: null,
            generateTtsWithFallback: (text, voice, speed, displayId, options) => service.generate({ text, ...options }),
            sendToDisplay() {}, logError: (category, message) => { throw new Error(message); } };
        const callback = vm.runInNewContext(`({${serverSource.slice(start, end)}}).onSentence`, context);
        callback(`${input}句一`); callback(`${input}句二`);
    }
    await Promise.all(schedulers.map(scheduler => scheduler.waitForIdle()));
    assert.deepEqual(seen.map(request => request.userText), ['旧入口问题', '旧入口问题', '当前第一轮', '当前第一轮', '当前第二轮', '当前第二轮']);
    const start = serverSource.indexOf('generateTTS: (text) => generateTtsWithFallback(text, undefined, undefined, preferredDisplayId');
    assert.ok(start >= 0);
    const end = serverSource.indexOf('sendToControl:', start);
    const callbackSource = serverSource.slice(start, end).trim().replace(/,$/u, '');
    const agentCallback = vm.runInNewContext(`({${callbackSource}}).generateTTS`, {
        preferredDisplayId: 'display-a', BUSINESS_TYPES: { AGENT_REPLY: 'agent_reply' },
        data: { content: 'Agent处理文本', displayContent: 'Agent原问题', role: 'Agent' }, chat: { getTemplateByName: () => null },
        generateTtsWithFallback: (text, voice, speed, displayId, options) => service.generate({ text, ...options })
    });
    await agentCallback('Agent回答');
    assert.equal(seen.at(-1).userText, 'Agent原问题');
    assert.equal(seen.at(-1).businessType, 'agent_reply');
});
