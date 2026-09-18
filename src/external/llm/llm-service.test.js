'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const chat = require('./llm-service');
const {
    buildAgentPrompt,
    getConversationRoundRemoval,
    validateHistoryScope,
    pickGlobalChatConfig
} = chat;

test('Pi 历史重建使用 Assistant 标记而不是旧 AI 标记', () => {
    const prompt = buildAgentPrompt([
        { role: 'system', content: '系统设定' },
        { role: 'user', content: '用户问题' },
        { role: 'assistant', content: '助手回复' }
    ]);
    assert.match(prompt, /Assistant:\n助手回复/u);
    assert.doesNotMatch(prompt, /AI:\n助手回复/u);
});

test('Agent 后端默认 Codex，并只接受 Claude/Codex', () => {
    const original = chat.getConfig().agentBackend;
    assert.strictEqual(original, 'codex');
    chat.setConfig({ agentBackend: 'claude' });
    assert.strictEqual(chat.getConfig().agentBackend, 'claude');
    assert.throws(() => chat.setConfig({ agentBackend: 'other' }), /Agent 后端不合法/);
    chat.setConfig({ agentBackend: original });
});

test('删除中间对话轮次只移除目标用户及其紧随的助手', () => {
    const messages = [
        { id: 'u1', role: 'control', content: '第一轮' },
        { id: 'a1', role: 'assistant', content: '第一轮回复' },
        { id: 'u2', role: 'control', content: '中间轮' },
        { id: 'a2', role: 'assistant', content: '中间回复' },
        { id: 'u3', role: 'control', content: '未回复' }
    ];
    const removal = getConversationRoundRemoval(messages, 'u2');
    assert.equal(removal.index, 2);
    assert.equal(removal.removeCount, 2);
    assert.equal(removal.isUserMessage, true);
});

test('删除没有助手回复的轮次只移除用户消息', () => {
    const removal = getConversationRoundRemoval([
        { id: 'u1', role: 'control', content: '未回复' }
    ], 'u1');
    assert.equal(removal.removeCount, 1);
});

test('群聊清空兼容前端统一携带的默认 sessionId', () => {
    assert.deepStrictEqual(
        validateHistoryScope({ mode: 'group', target: null, sessionId: 'default' }),
        { mode: 'group', target: null, sessionId: null }
    );
});

test('私聊清空仍要求助手和具体 sessionId', () => {
    assert.throws(
        () => validateHistoryScope({ mode: 'private', target: '小爱' }),
        /必须指定群聊或具体私聊会话/u
    );
    assert.throws(
        () => validateHistoryScope({ mode: 'private', sessionId: 'default' }),
        /必须指定群聊或具体私聊会话/u
    );
});

test('外部聊天配置保存只保留全局字段', () => {
    assert.deepStrictEqual(
        pickGlobalChatConfig({
            systemPrompt: '新的提示词',
            agentBackend: 'codex',
            codexProxy: 'http://127.0.0.1:7899',
            llmProfiles: [{ name: 'internal', protocol: 'openai-completions' }],
            activeProfile: 'internal',
            mode: 'agent',
            backend: 'pi'
        }),
        {
            systemPrompt: '新的提示词',
            agentBackend: 'codex',
            codexProxy: 'http://127.0.0.1:7899'
        }
    );
});

test('外部保存全局字段不会改动 profile 协议', () => {
    const originalConfig = chat.getConfig();
    const originalProfiles = chat.getProfiles();
    const originalActiveProfile = chat.getActiveProfile();
    const profiles = [
        {
            name: 'internal-completions',
            protocol: 'openai-completions',
            apiUrl: 'http://127.0.0.1:8080/v1/chat/completions',
            model: 'internal-model',
            mode: 'llm'
        },
        {
            name: 'external-responses',
            protocol: 'openai-responses',
            apiUrl: 'https://example.test/v1/chat/completions',
            model: 'external-model',
            mode: 'llm'
        }
    ];

    try {
        chat.setProfiles(profiles);
        chat.setConfig(pickGlobalChatConfig({
            systemPrompt: '仅更新全局字段',
            agentBackend: originalConfig.agentBackend
        }));
        assert.deepStrictEqual(
            chat.getProfiles().map(({ name, protocol }) => ({ name, protocol })),
            profiles.map(({ name, protocol }) => ({ name, protocol }))
        );
    } finally {
        chat.setConfig({ ...originalConfig, llmProfiles: originalProfiles, activeProfile: originalActiveProfile });
    }
});
