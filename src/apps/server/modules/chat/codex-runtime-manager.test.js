'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CodexRuntimeManager } = require('./codex-runtime-manager');

function createFakeBridgeFactory(calls) {
    return (options) => {
        const bridge = {
            initialized: false,
            stopped: false,
            setPrompt(prompt) {
                bridge.prompt = prompt;
            },
            async chat(content, callbacks) {
                calls.push({ bridge, content, options });
                bridge.initialized = true;
                callbacks.onChunk?.('Codex', 'Codex');
                callbacks.onChunk?.('回复', 'Codex回复');
                callbacks.onComplete?.('Codex回复');
                return { success: true, message: 'Codex回复' };
            },
            stop() {
                bridge.stopped = true;
            }
        };
        return bridge;
    };
}

const profile = {
    name: 'codex',
    mode: 'agent',
    backend: 'codex',
    model: 'gpt-5.3-codex'
};
const template = {
    id: 'default',
    content: '你是普通聊天助手',
    permissionProfile: 'readonly'
};

test('Codex 首轮发送历史，后续复用同一个会话且只发送当前消息', async () => {
    const calls = [];
    const manager = new CodexRuntimeManager({
        projectRoot: '/project',
        runtimeRoot: '/tmp/aasc-codex-test',
        bridgeFactory: createFakeBridgeFactory(calls)
    });
    const first = await manager.chatStream(profile, template, 'Assistant:\n之前回答\n\nUser:\n第一轮', {}, {
        developerInstructions: '系统提示',
        continuationPrompt: '第一轮',
        conversationKey: 'group:default'
    });
    const second = await manager.chatStream(profile, template, '不应再次发送的历史', {}, {
        developerInstructions: '系统提示',
        continuationPrompt: '第二轮',
        conversationKey: 'group:default'
    });

    assert.equal(first.message, 'Codex回复');
    assert.equal(second.message, 'Codex回复');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].content, 'Assistant:\n之前回答\n\nUser:\n第一轮');
    assert.equal(calls[1].content, '第二轮');
    assert.equal(calls[0].bridge, calls[1].bridge);
    assert.equal(calls[0].bridge.prompt, '系统提示');
    assert.equal(manager.getSessionCount(), 1);
    await manager.stopAll();
    assert.equal(calls[0].bridge.stopped, true);
});

test('Codex 群聊和私聊隔离，重置后创建新会话', async () => {
    const calls = [];
    const manager = new CodexRuntimeManager({ bridgeFactory: createFakeBridgeFactory(calls) });
    await manager.chatStream(profile, template, '群聊', {}, { conversationKey: 'group' });
    await manager.chatStream(profile, template, '私聊', {}, { conversationKey: 'private:小爱' });
    assert.notEqual(calls[0].bridge, calls[1].bridge);
    assert.equal(manager.resetSession(profile, template, 'group'), true);
    await manager.chatStream(profile, template, '重建后的群聊', {}, { conversationKey: 'group' });
    assert.notEqual(calls[0].bridge, calls[2].bridge);
    assert.equal(calls[0].bridge.stopped, true);
    await manager.stopAll();
});
