'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const chat = require('./llm-service');
const { getConversationRoundRemoval } = chat;

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
