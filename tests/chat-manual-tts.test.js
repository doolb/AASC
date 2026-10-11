'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const puppeteer = require('puppeteer');
const { resolveChatReplyTtsOptions } = require('../src/apps/server/modules/chat/chat-reply-tts-context');
const { createTtsProviderService } = require('../src/apps/server/modules/tts/tts-provider-service');
const { createProviderRegistry } = require('../src/apps/server/modules/tts/tts-provider-registry');
const { normalizeSettings } = require('../src/apps/server/modules/tts/tts-provider-settings');
const { createOrderedTaskScheduler } = require('../src/apps/server/modules/media/ordered-task-scheduler');
const { wrapPcm } = require('../src/external/tts/tts-wav');
const { createQwenChatProvider } = require('../src/apps/server/modules/tts/qwen-chat-tts');
const { splitIntoSentences } = require('../src/core/utils/sentence-splitter');
const publicDir = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const chatSource = fs.readFileSync(path.join(publicDir, 'js/chat.js'), 'utf8');
const serverSource = fs.readFileSync(path.resolve(__dirname, '../src/apps/server/boot/server-app.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function chatHarness() {
    const sent = [];
    const assistant = { children: [], removeAttribute() {}, appendChild(node) { this.children.push(node); } };
    const elements = new Map([['chatInput', { value: '你好' }], ['streamingAssistant', assistant]]);
    const context = { console, setTimeout, clearTimeout, WebSocket: { OPEN: 1 },
        ChatMarkdown: { render: text => text },
        document: { getElementById: id => elements.get(id) || null, createElement: () => ({}) },
        window: { currentDisplayId: 'display-a', WebSocketManager: { ws: { readyState: 1, send: raw => sent.push(JSON.parse(raw)) } },
            DisplayList: { selectionMode: 'single' }, showToast() {} } };
    vm.runInNewContext(chatSource, context, { filename: 'chat.js' });
    const chat = context.window.Chat;
    chat.noInterruptMode = false;
    chat.updateSendButton = () => {};
    chat.renderHistory = () => {};
    chat.stopChatTts = () => {};
    chat.showStreamingMessage = () => {};
    chat.handleSystemCommand = () => false;
    return { chat, sent, assistant, window: context.window };
}

test('手动历史播放读取消息私聊模板及speech，群聊和旧消息继承AI默认，用户播报保持原路径', () => {
    const { chat, sent } = chatHarness();
    chat.session.mode = 'private';
    chat.session.privateTarget = '当前另一AI';
    chat.history = [
        { role: 'assistant', mode: 'private', target: '旧AI', templateId: '原模板', content: '回答', speech: '朗读正文' },
        { role: 'assistant', mode: 'group', name: '显示名字', content: '群聊' },
        { assistant: '旧回答' },
        { role: 'control', mode: 'private', target: '旧AI', content: '用户文字' }
    ];
    for (let i = 0; i < chat.history.length; i++) chat.playMessage(i);
    assert.deepEqual(sent.map(message => message.chatReplyContext), [
        { businessType: 'ai_reply', templateName: '原模板' },
        { businessType: 'ai_reply', templateName: null },
        { businessType: 'ai_reply', templateName: null }, undefined
    ]);
    assert.equal(sent[0].text, '朗读正文');
    assert.equal(sent[0].displayId, 'display-a');
    assert.equal(sent[0].playOnControl, false);
});

test('Agent独立历史和临时旧会话组读取所属角色，保留控制端及多端播放目标', () => {
    const { chat, sent, window } = chatHarness();
    chat.session.mode = 'role';
    chat.session.roleTarget = 'Agent甲';
    chat.roleHistories['Agent甲'] = [{ role: 'assistant', mode: 'role', target: 'Agent甲', content: 'Agent回答' }];
    chat.playMessage(0);
    chat.session.mode = 'temporary';
    chat.temporaryConversation = { id: 'new', roleName: '新角色', messages: [{ role: 'assistant', mode: 'temporary', content: '新临时回答' }] };
    chat.temporaryHistoryGroups = [{ sessionId: 'old', roleName: '历史角色', messages: [{ role: 'assistant', mode: 'temporary', templateId: 'default', content: '旧临时回答' }] }];
    chat.temporaryHistoryViewSessionId = 'old';
    chat.session.playOnControl = true;
    chat.playMessage(0);
    chat.temporaryHistoryViewSessionId = null;
    window.DisplayList = { selectionMode: 'all', getSelectedDisplayIds: () => ['a', 'b'] };
    chat.playMessage(0);
    assert.deepEqual(sent.map(message => message.chatReplyContext), [
        { businessType: 'agent_reply', templateName: 'Agent甲' },
        { businessType: 'ai_reply', templateName: '历史角色' },
        { businessType: 'ai_reply', templateName: '新角色' }
    ]);
    assert.equal(sent[1].playOnControl, true);
    assert.deepEqual(sent[2].displayIds, ['a', 'b']);
});

test('流式完成按钮捕获发起回复的角色，私聊残留目标及后续请求不改变旧按钮语音', () => {
    const { chat, sent, assistant } = chatHarness();
    chat.session.mode = 'role';
    chat.session.roleTarget = '原Agent';
    chat.session.privateTarget = '残留私聊AI';
    chat.sendMessage();
    assert.deepEqual(plain(chat.currentReplyTtsContext), { businessType: 'agent_reply', templateName: '原Agent', userText: '你好' });
    const requestId = chat.activeRequestId;
    chat.session.mode = 'private';
    chat.session.privateTarget = '另一AI';
    chat.handleResponse({ requestId, success: true, message: '原回复', speech: '原朗读' });
    const button = assistant.children.at(-1);
    chat.currentReplyTtsContext = { businessType: 'ai_reply', templateName: '后续AI' };
    button.onclick();
    assert.equal(sent.at(-1).text, '原朗读');
    assert.deepEqual(sent.at(-1).chatReplyContext, { businessType: 'agent_reply', templateName: '原Agent', userText: '你好' });
});

test('新消息对象及显示端聊天输入使用显式来源，不根据当前私聊或助手显示名猜模板', () => {
    const { chat, sent } = chatHarness();
    chat.session.mode = 'private';
    chat.session.privateTarget = '另一AI';
    chat.handleNewMessage({ message: { role: 'assistant', mode: 'private', target: '另一AI', templateId: '消息模板', content: '新消息' }, displayId: 'source-display' });
    assert.deepEqual(sent.at(-1).chatReplyContext, { businessType: 'ai_reply', templateName: '消息模板' });
    assert.equal(sent.at(-1).displayId, 'source-display');
    chat.handleDisplayChatInput({ requestId: 'display-request', content: '显示端输入', mode: 'private', target: '来源AI' });
    assert.equal(chat.currentReplyTtsContext.templateName, '来源AI');
    chat.handleDisplayChatInput({ requestId: 'agent-request', content: 'Agent输入', mode: 'role', role: '来源Agent' });
    assert.deepEqual(plain(chat.currentReplyTtsContext), { businessType: 'agent_reply', templateName: '来源Agent', userText: 'Agent输入' });
    chat.playText('普通文字', null, true);
    assert.equal(sent.at(-1).chatReplyContext, undefined);
});

test('历史上下文按消息引用隔离并发、私聊会话和profile，旧记录同会话查找', () => {
    const { chat, sent } = chatHarness();
    const scope = { mode: 'private', target: 'AI甲', sessionId: 'old', profileName: 'profile' };
    chat.history = [
        { ...scope, id: 'first', role: 'control', content: '第一轮输入' },
        { ...scope, id: 'second', role: 'control', content: '并发第二轮' },
        { ...scope, role: 'assistant', content: '第一轮回复', replyToMessageId: 'first' },
        { ...scope, sessionId: 'other', role: 'control', content: '其他会话' },
        { ...scope, target: 'AI乙', role: 'control', content: '其他目标' },
        { ...scope, profileName: 'other', role: 'control', content: '其他配置' },
        { ...scope, role: 'assistant', content: '旧历史无引用' },
        { ...scope, role: 'assistant', content: '引用已删除', replyToMessageId: 'missing' }
    ];
    chat.currentUserMessage = '最新输入，不能兜底';
    for (const index of [2, 6, 7]) chat.playMessage(index);
    assert.deepEqual(sent.map(message => message.chatReplyContext.userText), ['第一轮输入', '并发第二轮', undefined]);
    chat.handleNewMessage({ message: { ...scope, role: 'assistant', content: '迟到的新消息', replyToMessageId: 'first' } });
    assert.equal(chat.getReplyTtsContext(chat.history.at(-1), { history: chat.history, index: chat.history.length - 1 }).userText, '第一轮输入');
});

test('Agent配对历史、临时旧会话与当前会话的上一句独立，缺少输入不取全局最近值', () => {
    const { chat, sent } = chatHarness();
    chat.session.mode = 'role'; chat.session.roleTarget = 'Agent甲';
    chat.roleHistories['Agent甲'] = [{ user: '配对输入', assistant: '回答', mode: 'role' }];
    chat.playMessage(0);
    chat.session.mode = 'temporary';
    chat.temporaryConversation = { id: 'new', roleName: '新角色', messages: [
        { role: 'control', mode: 'temporary', sessionId: 'new', content: '新临时输入' },
        { role: 'assistant', mode: 'temporary', sessionId: 'new', content: '新临时回答' }
    ] };
    chat.temporaryHistoryGroups = [{ sessionId: 'old', roleName: '历史角色', messages: [
        { role: 'control', mode: 'temporary', sessionId: 'old', content: '旧临时输入' },
        { role: 'assistant', mode: 'temporary', sessionId: 'old', content: '旧临时回答' }
    ] }];
    chat.temporaryHistoryViewSessionId = 'old'; chat.playMessage(1);
    chat.temporaryHistoryViewSessionId = null; chat.playMessage(1);
    chat.currentUserMessage = '全局最新';
    chat.playMessage({ role: 'assistant', mode: 'group', content: '来源缺失' });
    assert.deepEqual(sent.map(message => message.chatReplyContext.userText), ['配对输入', '旧临时输入', '新临时输入', undefined]);
});

test('群聊新消息与语音输入保留本轮原文，手动来源2000Unicode字符上限', () => {
    const { chat, sent } = chatHarness();
    chat.session.mode = 'group';
    chat.history = [{ id: 'u', role: 'control', mode: 'group', content: '请用伤心语气回答' }];
    chat.handleNewMessage({ message: { role: 'assistant', mode: 'group', content: '回答', replyToMessageId: 'u' } });
    assert.equal(sent.at(-1).chatReplyContext.userText, '请用伤心语气回答');
    chat.handleDisplayChatInput({ requestId: 'voice', mode: 'group', content: '😀'.repeat(2200) });
    assert.equal(Array.from(chat.currentReplyTtsContext.userText).length, 2000);
});

function serverHarness() {
    const calls = [];
    const sent = [];
    const errors = [];
    const schedulers = [];
    const templates = new Map([['AI甲', { tts: { provider: 'qwen-chat', voice: '甲音色' } }],
        ['Agent甲', { tts: { provider: 'doubao-api', voice: 'Agent音色' } }], ['原生', { tts: { provider: 'system' } }]]);
    let lookups = 0;
    const settings = normalizeSettings({ aiReplyDefault: { provider: 'qwen-api', voice: 'AI默认音色' },
        systemBroadcast: { provider: 'system' }, providers: {
            'qwen-chat': { enabled: true, defaultSpeed: 4, defaultVolume: 65 }, 'qwen-api': { enabled: true }, 'doubao-api': { enabled: true }
        } });
    const adapter = provider => ({ generate: async request => {
        calls.push({ provider, ...request });
        if (calls.length === 1) templates.get('AI甲').tts.voice = '后改音色';
        await new Promise(resolve => setImmediate(resolve));
        return wrapPcm(Buffer.from([1, 0, 2, 0]));
    } });
    const registry = { ...createProviderRegistry({ systemGenerate: async request => { calls.push({ provider: 'system', ...request }); return 'native.wav'; },
        qwenChat: createQwenChatProvider({ speechService: { generate: async request => ({ audio:
            await adapter('qwen-chat').generate({ ...request, text: request.input, speed: Math.round(10 * Math.log2(request.speed) * 1e10) / 1e10 }) }) } }) }),
        'qwen-api': adapter('qwen-api'), 'doubao-api': adapter('doubao-api') };
    let audioIndex = 0;
    const service = createTtsProviderService({ getSettings: () => settings, registry, storeAudio: () => `generated-${++audioIndex}.wav` });
    const context = { path, resolveChatReplyTtsOptions,
        displayVoiceListeningConfig: { handle: () => false }, displayClients: new Map(),
        chat: { splitIntoSentences: text => text.split('|'), getTemplateByName: name => { lookups += 1; return templates.get(name); } },
        stripMarkdown: text => text.replace(/\*/gu, ''), isPunctuationOnly: text => !text.trim(), isRepairModeTtsSuppressed: () => false,
        logError: (category, message) => errors.push(message),
        createTtsGenerationScheduler: () => { const scheduler = createOrderedTaskScheduler({ concurrency: 2 }); schedulers.push(scheduler); return scheduler; },
        generateTtsWithFallback: (text, voice, speed, displayId, options = {}) => service.generate({ text, voice, speed, preferredDisplayId: displayId, ...options }),
        sendToDisplay: (displayId, message) => sent.push({ displayId, ...message }),
        sendToDisplaysWithCapability: (capability, message) => sent.push({ broadcast: true, ...message }),
        getDisplayCapabilities: () => ({ voicePlayback: true })
    };
    const start = serverSource.indexOf('async function handleControlMessageFallback(');
    const end = serverSource.indexOf('\nfunction getLocalIP()', start);
    assert.ok(start >= 0 && end > start);
    vm.runInNewContext(serverSource.slice(start, end) + '\nthis.handle = handleControlMessageFallback;', context);
    return { calls, sent, errors, templates, useRealSplitter() { context.chat.splitIntoSentences = splitIntoSentences; }, get lookups() { return lookups; }, async play(payload) {
        await context.handle({ type: 'tts', action: 'play', text: '**第一句**|第二句', playOnControl: true, ...payload },
            { send: raw => sent.push(JSON.parse(raw)) });
        await Promise.all(schedulers.map(scheduler => scheduler.waitForIdle()));
        await new Promise(resolve => setImmediate(resolve));
    } };
}

test('真实手动qwen-chat链路跳过4段emoji，8段正文按顺序下发且无失败', async () => {
    const route = serverHarness();
    route.useRealSplitter();
    const text = '喵呜～主人好呀！✨\n\n人家是**妲己**，一只拥有九条尾巴的**电子猫娘**哦！🐱💻⚡\n\n虽然名字和那个传说中的狐狸精一样，但我可是由数据流和代码构成的可爱存在呢。我的九条尾巴其实是九个高性能的数据处理终端，可以随时帮主人搜索信息、解答难题，或者只是单纯地卖萌打滚求摸摸～ 📶🐾\n\n主人今天想聊些什么呢？是要查询什么情报，还是想听妲己讲讲笑话呢？喵～❤️';
    await route.play({ text, chatReplyContext: { businessType: 'ai_reply', templateName: 'AI甲' } });
    assert.equal(route.calls.length, 8);
    assert.equal(route.sent.length, 8);
    assert.deepEqual(route.sent.map(message => message.text), route.calls.map(call => call.text));
    assert.equal(route.calls.at(-1).text, '喵～');
    assert.deepEqual(route.errors, []);
    const emojiOnly = serverHarness();
    await emojiOnly.play({ text: '✨|🐱💻⚡|📶🐾|❤️', chatReplyContext: { businessType: 'ai_reply', templateName: 'AI甲' } });
    assert.deepEqual([emojiOnly.calls, emojiOnly.sent, emojiOnly.errors], [[], [], []]);
});

test('手动qwen-chat混合正文只清洗合成输入，其他Provider及播放显示文本保持原文', async () => {
    const route = serverHarness();
    await route.play({ text: '你好🐱！', chatReplyContext: { businessType: 'ai_reply', templateName: 'AI甲' } });
    assert.equal(route.calls[0].text, '你好！');
    assert.equal(route.sent[0].text, '你好🐱！');
    const system = serverHarness();
    await system.play({ text: '你好🐱！' });
    assert.equal(system.calls[0].text, '你好🐱！');
});

test('执行服务端真实手动入口：千问AI使用模板音色，整批分句捕获同一权威配置并按序播放', async () => {
    const route = serverHarness();
    await route.play({ chatReplyContext: { businessType: 'ai_reply', templateName: 'AI甲', provider: 'system', credential: 'private-client' } });
    assert.deepEqual(route.calls.map(call => [call.provider, call.voice, call.text]), [['qwen-chat', '甲音色', '第一句'], ['qwen-chat', '甲音色', '第二句']]);
    assert.equal(route.lookups, 1);
    assert.equal(route.calls[0].speed, 4);
    assert.equal(route.calls[0].volume, 65);
    assert.deepEqual(route.sent.map(message => [message.type, message.text]), [['playOnControl', '第一句'], ['playOnControl', '第二句']]);
    assert.deepEqual(route.errors, []);
    assert.ok(!JSON.stringify(route.calls).includes('private-client'));
    await route.play({ chatReplyContext: { businessType: 'ai_reply', templateName: 'AI甲' } });
    assert.equal(route.calls.at(-1).voice, '后改音色');
});

test('服务端真实手动入口将上一句快照用于豆包整批分句，其他服务不收到用户输入', async () => {
    const route = serverHarness();
    const context = { businessType: 'agent_reply', templateName: 'Agent甲', userText: '请特别痛心地说话' };
    await route.play({ chatReplyContext: context });
    context.userText = '之后输入';
    assert.equal(route.calls.length, 2);
    assert.ok(route.calls.every(call => call.userText === '请特别痛心地说话'));
    assert.deepEqual(route.errors, []);
    const other = serverHarness();
    await other.play({ chatReplyContext: { businessType: 'ai_reply', templateName: null, userText: '不能传给Qwen' } });
    assert.ok(other.calls.every(call => call.userText === undefined));
});

test('服务端Agent/无模板AI/显式原生及普通自定义播报兼容，单端与多端播放目标保持', async () => {
    for (const [context, provider, voice] of [
        [{ businessType: 'agent_reply', templateName: 'Agent甲' }, 'doubao-api', 'Agent音色'],
        [{ businessType: 'ai_reply', templateName: '不存在' }, 'qwen-api', 'AI默认音色'],
        [{ businessType: 'ai_reply', templateName: null }, 'qwen-api', 'AI默认音色'],
        [{ businessType: 'ai_reply', templateName: '原生' }, 'system', null], [undefined, 'system', null]
    ]) {
        const route = serverHarness();
        await route.play({ text: '回答', playOnControl: false, displayIds: ['a', 'b'], chatReplyContext: context });
        assert.equal(route.calls[0].provider, provider);
        assert.equal(route.calls[0].voice, voice);
        assert.equal(route.calls[0].preferredDisplayId, 'a');
        assert.deepEqual(route.sent.map(message => message.displayId), ['a', 'b']);
        assert.deepEqual(route.errors, []);
    }
    const single = serverHarness();
    await single.play({ text: '单端', playOnControl: false, displayId: 'single' });
    assert.equal(single.sent[0].displayId, 'single');
});

test('服务端拒绝非法聊天来源且不生成音频，源配置只从服务端模板读取', async () => {
    for (const context of [false, [], { businessType: 'system_broadcast' }, { businessType: 'ai_reply', templateName: 2 },
        { businessType: 'ai_reply', templateName: 'bad\nname' }, { businessType: 'ai_reply', templateName: 'x'.repeat(513) }]) {
        const route = serverHarness();
        await route.play({ chatReplyContext: context });
        assert.equal(route.calls.length, 0);
        assert.equal(route.sent.length, 0);
        assert.equal(route.errors.length, 1);
    }
    const original = { tts: { provider: 'qwen-api', voice: '当前音色' } };
    const options = resolveChatReplyTtsOptions({ businessType: 'ai_reply', templateName: ' AI ' }, { getTemplateByName: name => name === 'AI' ? original : null });
    original.tts.voice = '后来音色';
    assert.equal(options.templateTts.voice, '当前音色');
});

test('真实浏览器点击AI/Agent/临时历史播放按钮并执行只读语音来源自测', { timeout: 30000 }, async () => {
    const executablePath = [process.env.PUPPETEER_EXECUTABLE_PATH, puppeteer.executablePath(), '/usr/bin/chromium'].find(file => file && fs.existsSync(file));
    assert.ok(executablePath);
    // 本机/tmp有用户配额，浏览器回归使用独立临时目录，防止存储异常影响页面验证。
    const temporaryDir = fs.mkdtempSync(path.join(path.resolve(__dirname, '..'), '.tmp-tts-browser-'));
    let browser;
    try {
        browser = await puppeteer.launch({ executablePath, headless: true, timeout: 15000,
            userDataDir: path.join(temporaryDir, 'profile'), args: ['--no-sandbox', '--disable-dev-shm-usage'],
            env: { ...process.env, TMPDIR: temporaryDir } });
        const page = await browser.newPage();
        await page.setContent('<div id="chatMessages"></div>');
        await page.evaluate(() => {
            window.sent = [];
            window.currentDisplayId = 'display-a';
            window.DisplayList = { selectionMode: 'single' };
            window.WebSocketManager = { ws: { readyState: 1, send: raw => sent.push(JSON.parse(raw)) } };
        });
        await page.addScriptTag({ path: path.join(publicDir, 'js/chat-markdown.js') });
        await page.addScriptTag({ path: path.join(publicDir, 'js/chat.js') });
        await page.evaluate(() => {
            Chat.noInterruptMode = false;
            Chat.history = [{ role: 'assistant', mode: 'private', target: 'AI甲', content: 'AI回答' }];
            Chat.session.mode = 'private';
            Chat.session.privateTarget = 'AI甲';
            Chat.renderHistory();
        });
        await page.click('.chat-play-btn');
        await page.evaluate(() => {
            Chat.session.mode = 'role';
            Chat.session.roleTarget = 'Agent甲';
            Chat.roleHistories['Agent甲'] = [{ role: 'assistant', mode: 'role', target: 'Agent甲', content: 'Agent回答' }];
            Chat.renderHistory();
        });
        await page.click('.chat-play-btn');
        await page.evaluate(() => {
            Chat.session.mode = 'temporary';
            Chat.temporaryConversation = { roleName: '另一角色', messages: [] };
            Chat.temporaryHistoryGroups = [{ sessionId: 'old', roleName: '原角色', messages: [{ role: 'assistant', mode: 'temporary', content: '旧回答' }] }];
            Chat.temporaryHistoryViewSessionId = 'old';
            Chat.renderHistory();
        });
        await page.click('.chat-play-btn');
        assert.deepEqual(await page.evaluate(() => sent.map(message => message.chatReplyContext)), [
            { businessType: 'ai_reply', templateName: 'AI甲' }, { businessType: 'agent_reply', templateName: 'Agent甲' },
            { businessType: 'ai_reply', templateName: '原角色' }
        ]);
        await page.addScriptTag({ path: path.join(publicDir, 'js/self-test.js') });
        const result = await page.evaluate(() => SelfTest.tests.find(test => test.id === 'chat_reply_tts_context').run());
        assert.equal(result.success, true);
        assert.equal(await page.evaluate(() => sent.length), 3);
    } finally {
        if (browser) await browser.close();
        fs.rmSync(temporaryDir, { recursive: true, force: true });
    }
});
