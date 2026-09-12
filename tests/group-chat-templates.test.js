'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const chat = require('../src/external/llm/llm-service');
const voiceCommand = require('../src/apps/web-mediacenter/modules/voice/voice-command-app-service');

const serverSource = fs.readFileSync('src/apps/server/boot/server-app.js', 'utf8');
const controlChatSource = fs.readFileSync('src/apps/web-mediacenter/ui/public/js/chat.js', 'utf8');
const originalTemplates = chat.getTemplates();
const originalSession = chat.getSession();
const originalChatConfig = chat.getConfig();
const originalAssistantConfig = voiceCommand.getAssistantConfig();

after(() => {
    chat.setTemplates(originalTemplates, { persist: false });
    chat.setSession(originalSession, { source: 'testRestore', persist: false });
    chat.setConfig(originalChatConfig);
    voiceCommand.init(originalAssistantConfig);
});

test('群聊系统提示词应包含全部角色模板和基础提示词', () => {
    chat.setConfig({ systemPrompt: '基础群聊规则' });
    chat.setTemplates([
        { id: 'xiaoa', name: '小爱', content: '负责活泼回答' },
        { id: 'daji', name: '妲己', content: '负责严谨分析' }
    ], { persist: false });

    const prompt = chat.getGroupSystemPrompt();

    assert.match(prompt, /基础群聊规则/u);
    assert.match(prompt, /小爱[\s\S]*负责活泼回答/u);
    assert.match(prompt, /妲己[\s\S]*负责严谨分析/u);
});

test('没有角色模板时群聊系统提示词仍返回基础提示词', () => {
    chat.setConfig({ systemPrompt: '无角色时的群聊规则' });
    chat.setTemplates([], { persist: false });

    assert.strictEqual(chat.getGroupSystemPrompt(), '无角色时的群聊规则');
});

test('控制端群聊应发送原始消息且不指定单角色模板', () => {
    const start = controlChatSource.indexOf('sendMessage() {');
    const end = controlChatSource.indexOf('\n    }\n};', start);
    const sendMessage = controlChatSource.slice(start, end);

    assert.doesNotMatch(sendMessage, /templateTarget\s*=\s*template\.name/u);
    assert.doesNotMatch(sendMessage, /sendMessage\s*=\s*message\.substring\(template\.name\.length\)/u);
    assert.match(sendMessage, /content:\s*sendMessage,/u);
});

test('控制端带角色名的群聊消息应跳过本地内置命令分流', () => {
    assert.match(controlChatSource, /isGroupRoleAddressedMessage\(message\)/u);
    assert.match(
        controlChatSource,
        /isGroupRoleAddressedMessage\(message\)[\s\S]*?handleSystemCommand\(message\)/u
    );
});

test('普通群聊路由应使用全部角色模板而不是语音传入的单角色提示词', () => {
    const start = serverSource.indexOf('async function handleChatMessage(options)');
    const end = serverSource.indexOf('\nconst deviceEventDebounce', start);
    const handler = serverSource.slice(start, end);

    assert.match(handler, /messageMode === 'group'[\s\S]*getGroupSystemPrompt\(\)/u);
    assert.match(handler, /effectiveTemplateTarget\s*=\s*messageMode === 'group'\s*\?\s*null/u);
});

test('语音中包含角色名时应保留完整原始文本并按群聊发送', async () => {
    voiceCommand.init({
        ...originalAssistantConfig,
        assistants: [
            { name: '小爱', template: '活泼角色设定' },
            { name: '妲己', template: '严谨角色设定' }
        ]
    });

    const input = '小爱，请介绍一下今天的安排';
    const result = await voiceCommand.processVoiceCommand(input, 'display-test');

    assert.strictEqual(result.type, 'chat');
    assert.strictEqual(result.mode, 'group');
    assert.strictEqual(result.message, input);
    assert.strictEqual(result.systemPrompt, undefined);
});

test('一次性群聊输入不受当前私聊会话模式影响', async () => {
    const originalSession = chat.getSession();
    chat.setSession({
        ...originalSession,
        mode: 'private',
        privateTarget: '妲己',
        privateSessionId: 'private-session'
    }, { source: 'test', persist: false });
    try {
        const input = '小爱，请介绍一下今天的安排';
        const result = await voiceCommand.processVoiceCommand(
            input,
            'display-test',
            {},
            false,
            {
                groupAssistantNames: ['小爱', '妲己'],
                oneShotGroup: true
            }
        );

        assert.deepStrictEqual(result, {
            type: 'chat',
            message: input,
            mode: 'group'
        });
    } finally {
        chat.setSession(originalSession, { source: 'testRestore', persist: false });
    }
});

test('显示端唤醒后的普通群聊文本不受指令模式过滤', async () => {
    const originalSession = chat.getSession();
    chat.setSession(
        { ...originalSession, mode: 'group', commandMode: true },
        { source: 'test', persist: false }
    );
    try {
        const result = await voiceCommand.processVoiceCommand(
            '你在做什么吗？',
            'display-test',
            {},
            false,
            { conversationActive: true }
        );
        assert.deepStrictEqual(result, {
            type: 'chat',
            message: '你在做什么吗？',
            mode: 'group',
            systemPrompt: undefined
        });
    } finally {
        chat.setSession(originalSession, { source: 'testRestore', persist: false });
    }
});

test('显示端 active 群聊中的搜索文本应作为普通聊天保留原文', async () => {
    const originalSession = chat.getSession();
    chat.setSession(
        { ...originalSession, mode: 'group', commandMode: true },
        { source: 'test', persist: false }
    );
    try {
        const input = '搜索北京新闻';
        const result = await voiceCommand.processVoiceCommand(
            input,
            'display-test',
            {},
            false,
            { conversationActive: true }
        );

        assert.strictEqual(result.type, 'chat');
        assert.strictEqual(result.mode, 'group');
        assert.strictEqual(result.message, input);
        assert.strictEqual(result.systemPrompt, undefined);
    } finally {
        chat.setSession(originalSession, { source: 'testRestore', persist: false });
    }
});

test('私聊语音聊天应携带当前角色和会话元数据', async () => {
    const originalSession = chat.getSession();
    chat.setSession({
        ...originalSession,
        mode: 'private',
        privateTarget: '小爱',
        privateSessionId: 'default',
        commandMode: true
    }, { source: 'test', persist: false });
    try {
        const result = await voiceCommand.processVoiceCommand(
            '你在做什么吗？',
            'display-test',
            {},
            false,
            { conversationActive: true }
        );
        assert.equal(result.type, 'chat');
        assert.equal(result.mode, 'private');
        assert.equal(result.target, '小爱');
        assert.equal(result.sessionId, 'default');
        assert.equal(result.templateTarget, '小爱');
    } finally {
        chat.setSession(originalSession, { source: 'testRestore', persist: false });
    }
});

test('显示端 active 私聊中的搜索文本应保留当前会话元数据', async () => {
    const originalSession = chat.getSession();
    chat.setSession({
        ...originalSession,
        mode: 'private',
        privateTarget: '小爱',
        privateSessionId: 'session-search',
        commandMode: true
    }, { source: 'test', persist: false });
    try {
        const input = '搜索北京新闻';
        const result = await voiceCommand.processVoiceCommand(
            input,
            'display-test',
            {},
            false,
            { conversationActive: true }
        );

        assert.strictEqual(result.type, 'chat');
        assert.strictEqual(result.mode, 'private');
        assert.strictEqual(result.message, input);
        assert.strictEqual(result.target, '小爱');
        assert.strictEqual(result.sessionId, 'session-search');
        assert.strictEqual(result.templateTarget, '小爱');
    } finally {
        chat.setSession(originalSession, { source: 'testRestore', persist: false });
    }
});

test('等待唤醒状态的搜索命令仍保留独立搜索路由', async () => {
    const originalSession = chat.getSession();
    const originalRouting = voiceCommand.getCommandRouting();
    chat.setSession(
        { ...originalSession, mode: 'group', commandMode: true },
        { source: 'test', persist: false }
    );
    voiceCommand.setCommandRouting({ search: 'llm' });
    try {
        const result = await voiceCommand.processVoiceCommand(
            '搜索北京新闻',
            'display-test',
            {},
            false,
            { conversationActive: false }
        );

        assert.strictEqual(result.type, 'search');
        assert.strictEqual(result.route, 'llm');
        assert.strictEqual(result.query, '北京新闻');
    } finally {
        voiceCommand.setCommandRouting(originalRouting);
        chat.setSession(originalSession, { source: 'testRestore', persist: false });
    }
});
