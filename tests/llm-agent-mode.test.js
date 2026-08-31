'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const chat = require('../src/external/llm/llm-service');

const originalTemplates = chat.getTemplates();

function createAgentChatHarness() {
    const calls = [];
    const resets = [];
    const runtime = {
        async chatStream(profile, template, prompt, callbacks, options) {
            calls.push({ profile, template, prompt, options });
            callbacks.onChunk?.('Pi回复', 'Pi回复');
            callbacks.onComplete?.('Pi回复');
            return { success: true, message: 'Pi回复' };
        },
        resetSession(profile, template, conversationKey) {
            resets.push({ profile, template, conversationKey });
            return true;
        },
        async stopAll() {}
    };
    chat.init({
        systemPrompt: '默认助手',
        activeProfile: 'agent',
        llmProfiles: [{
            name: 'agent',
            mode: 'agent',
            backend: 'pi',
            apiUrl: 'http://127.0.0.1:9/v1/chat/completions',
            model: 'qwen',
            maxTokens: 1000,
            temperature: 0.7,
            contextCount: 10,
            apiKey: ''
        }]
    }, { piRuntimeManager: runtime });
    chat.setTemplates([{
        id: 'researcher',
        name: 'researcher',
        content: '只读助手',
        permissionProfile: 'readonly'
    }], { persist: false });
    return { calls, resets };
}

function createCodexChatHarness() {
    const calls = [];
    const runtime = {
        async chatStream(profile, template, prompt, callbacks, options) {
            calls.push({ profile, template, prompt, options });
            callbacks.onChunk?.('Codex回复', 'Codex回复');
            callbacks.onComplete?.('Codex回复');
            return { success: true, message: 'Codex回复' };
        },
        resetSession() {
            return true;
        },
        async stopAll() {}
    };
    chat.init({
        systemPrompt: '默认助手',
        activeProfile: 'codex',
        llmProfiles: [{
            name: 'codex',
            mode: 'agent',
            backend: 'codex',
            model: 'gpt-5.3-codex',
            contextCount: 10,
            apiKey: ''
        }]
    }, { codexRuntimeManager: runtime });
    chat.setTemplates([{
        id: 'researcher',
        name: 'researcher',
        content: '只读助手',
        permissionProfile: 'readonly'
    }], { persist: false });
    return { calls };
}

afterEach(() => {
    chat.setTemplates(originalTemplates, { persist: false });
});

test('测试模板可只更新内存而不写入用户配置', () => {
    const originalWriteFileSync = fs.writeFileSync;
    let persisted = false;
    fs.writeFileSync = (...args) => {
        persisted = true;
        throw new Error('测试不应写入用户模板配置');
    };

    try {
        assert.doesNotThrow(() => chat.setTemplates([
            { id: 'test-only', name: 'test-only', content: '测试模板' }
        ], { persist: false }));
    } finally {
        fs.writeFileSync = originalWriteFileSync;
    }

    assert.equal(persisted, false);
});

test('Agent profile 使用 Pi，不调用普通 LLM HTTP', async () => {
    const { calls } = createAgentChatHarness();
    const result = await chat.chatStream('查找文件', {
        templateTarget: 'researcher',
        mode: 'group',
        includeHistory: true,
        contextCount: 10
    }, {});
    assert.equal(result.success, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].profile.name, 'agent');
    assert.equal(calls[0].template.permissionProfile, 'readonly');
    assert.match(calls[0].prompt, /查找文件/u);
});

test('Agent profile 使用 Codex，并把系统提示与首轮历史分开传递', async () => {
    const { calls } = createCodexChatHarness();
    const result = await chat.chatStream('介绍今天安排', {
        templateTarget: 'researcher',
        mode: 'group',
        includeHistory: true,
        contextCount: 10
    }, {});
    assert.equal(result.success, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].profile.backend, 'codex');
    assert.match(calls[0].options.developerInstructions, /默认助手/u);
    assert.match(calls[0].prompt, /介绍今天安排/u);
    assert.doesNotMatch(calls[0].prompt, /^System:/u);
});

test('模板权限来自服务端模板，不能由请求 tools 字段覆盖', async () => {
    const { calls } = createAgentChatHarness();
    await chat.chatStream('搜索资料', {
        templateTarget: 'researcher',
        mode: 'group',
        tools: ['bash']
    }, {});
    assert.equal(calls[0].template.permissionProfile, 'readonly');
    assert.equal('tools' in calls[0].template, false);
});

test('Pi Agent 请求传递会话键和后续当前消息', async () => {
    const { calls } = createAgentChatHarness();
    const options = {
        templateTarget: 'researcher',
        mode: 'group',
        target: null,
        sessionId: 'default',
        includeHistory: true,
        contextCount: 10
    };
    await chat.chatStream('第一轮', options, {});
    await chat.chatStream('第二轮', options, {});
    assert.equal(calls[0].options.continuationPrompt, '第一轮');
    assert.equal(calls[1].options.continuationPrompt, '第二轮');
    assert.equal(calls[0].options.conversationKey, calls[1].options.conversationKey);
});

test('切换群聊和私聊角色时重置旧 Pi 会话', () => {
    const { resets } = createAgentChatHarness();
    chat.setSession({ ...chat.getSession(), mode: 'group', privateTarget: null, privateSessionId: 'default' });

    chat.setMode('private', '小爱');
    chat.setMode('private', '妲己');
    chat.setMode('group');

    assert.deepEqual(
        resets.map(item => item.conversationKey),
        [
            JSON.stringify({ mode: 'group', target: null, sessionId: 'default' }),
            JSON.stringify({ mode: 'private', target: '小爱', sessionId: 'default' }),
            JSON.stringify({ mode: 'private', target: '妲己', sessionId: 'default' })
        ]
    );
});

test('切换私聊会话时重置旧 Pi 会话', () => {
    const { resets } = createAgentChatHarness();
    chat.setSession({
        ...chat.getSession(),
        mode: 'private',
        privateTarget: '小爱',
        privateSessionId: 'default',
        sessions: {
            小爱: [
                { id: 'default', name: '默认会话' },
                { id: 'next', name: '新会话' }
            ]
        }
    });

    assert.equal(chat.switchSession('小爱', 'next'), true);
    assert.equal(
        resets.at(-1).conversationKey,
        JSON.stringify({ mode: 'private', target: '小爱', sessionId: 'default' })
    );
});
