'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PiRuntimeManager } = require('../src/apps/server/modules/chat/pi-runtime-manager');

function createFakeSession(options = {}) {
    const listeners = new Set();
    const prompts = [];
    const state = {
        disposed: false,
        aborted: false
    };
    return {
        prompts,
        state,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        prompt(message) {
            prompts.push(message);
            if (typeof options.onPrompt === 'function') {
                options.onPrompt(message, (event) => {
                    for (const listener of listeners) listener(event);
                });
            }
            return Promise.resolve();
        },
        async abort() {
            state.aborted = true;
        },
        dispose() {
            state.disposed = true;
            listeners.clear();
        }
    };
}

function createProfile(overrides = {}) {
    return {
        name: 'local',
        mode: 'agent',
        backend: 'pi',
        apiUrl: 'http://llm/v1/chat/completions',
        model: 'qwen',
        ...overrides
    };
}

function createTemplate(overrides = {}) {
    return {
        id: 'researcher',
        permissionProfile: 'readonly',
        ...overrides
    };
}

function createManager(createSdkSession, options = {}) {
    return new PiRuntimeManager({
        projectRoot: '/project',
        createSdkSession,
        ...options
    });
}

test('Pi SDK Runtime 使用默认超时且不暴露子进程启动接口', () => {
    const manager = new PiRuntimeManager();
    assert.equal(manager.requestTimeoutMs, 600000);
    assert.equal(manager.requestQueueTimeoutMs, 30000);
    assert.equal('spawn' in manager, false);
    assert.equal(typeof manager.buildSpawnArgs, 'undefined');
});

test('Pi SDK AgentSession 流式事件转换为增量回调和完成结果', async () => {
    const fakeSession = createFakeSession({
        onPrompt(_message, emit) {
            queueMicrotask(() => {
                emit({
                    type: 'message_update',
                    assistantMessageEvent: { type: 'text_delta', delta: '找到' }
                });
                emit({
                    type: 'message_update',
                    assistantMessageEvent: { type: 'text_delta', delta: '文件' }
                });
                emit({
                    type: 'agent_end',
                    messages: [{ role: 'assistant', content: [{ type: 'text', text: '找到文件' }] }]
                });
            });
        }
    });
    const manager = createManager(() => fakeSession);
    const chunks = [];
    const result = await manager.chatStream(
        createProfile(),
        createTemplate(),
        '查找文件',
        { onChunk: (chunk) => chunks.push(chunk) }
    );

    assert.deepEqual(chunks, ['找到', '文件']);
    assert.equal(result.message, '找到文件');
    assert.deepEqual(fakeSession.prompts, ['查找文件']);
    await manager.stopAll();
    assert.equal(fakeSession.state.disposed, true);
});

test('Pi SDK 会话复用并只向后续请求发送 User 续聊消息', async () => {
    const sessions = [];
    const manager = createManager(() => {
        const fakeSession = createFakeSession({
            onPrompt(message, emit) {
                queueMicrotask(() => emit({
                    type: 'agent_end',
                    messages: [{ role: 'assistant', content: [{ type: 'text', text: message }] }]
                }));
            }
        });
        sessions.push(fakeSession);
        return fakeSession;
    });
    const profile = createProfile();
    const template = createTemplate();

    await manager.chatStream(profile, template, '初始化上下文', {}, {
        conversationKey: 'group:default'
    });
    await manager.chatStream(profile, template, '完整历史不应重复发送', {}, {
        conversationKey: 'group:default',
        continuationPrompt: '第二轮消息'
    });

    assert.equal(sessions.length, 1);
    assert.deepEqual(sessions[0].prompts, ['初始化上下文', 'User:第二轮消息']);
    await manager.stopAll();
});

test('Pi SDK 空回复会销毁会话并自动重建一次', async () => {
    const sessions = [];
    const manager = createManager(() => {
        const index = sessions.length;
        const fakeSession = createFakeSession({
            onPrompt(_message, emit) {
                queueMicrotask(() => emit(index === 0
                    ? { type: 'agent_end', messages: [{ role: 'assistant', content: [] }] }
                    : {
                        type: 'agent_end',
                        messages: [{ role: 'assistant', content: [{ type: 'text', text: '重试成功' }] }]
                    }));
            }
        });
        sessions.push(fakeSession);
        return fakeSession;
    });

    const result = await manager.chatStream(
        createProfile(),
        createTemplate(),
        '继续处理'
    );

    assert.equal(result.message, '重试成功');
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].state.disposed, true);
    await manager.stopAll();
});

test('Pi SDK 排队超时不会调用后续 session.prompt', async () => {
    const sessions = [];
    const manager = createManager(() => {
        const fakeSession = createFakeSession({
            onPrompt() {}
        });
        sessions.push(fakeSession);
        return fakeSession;
    }, {
        requestTimeoutMs: 1000,
        requestQueueTimeoutMs: 20
    });
    const profile = createProfile();
    const template = createTemplate();
    const firstRequest = manager.chatStream(profile, template, '第一个请求');
    const errors = [];
    const secondRequest = manager.chatStream(profile, template, '第二个请求', {
        onError: (error) => errors.push(error)
    });

    await assert.rejects(secondRequest, /排队超时/);
    assert.deepEqual(errors, ['Pi 请求排队超时']);
    assert.equal(sessions.length, 1);
    assert.deepEqual(sessions[0].prompts, ['第一个请求']);
    const stopPromise = manager.stopAll();
    assert.equal(sessions[0].state.aborted, true);
    await stopPromise;
    await assert.rejects(firstRequest, /已停止/);
});
test('Pi SDK 默认工厂可以在同一 Node 进程创建只读 AgentSession', async () => {
    const manager = new PiRuntimeManager({
        projectRoot: '/mnt/AASC',
        agentDir: '/tmp/aasc-pi-runtime-test'
    });
    const session = await manager.createDefaultSdkSession(
        createProfile({ model: 'qwen' }),
        createTemplate(),
        'pi_sdk_smoke'
    );

    assert.equal(typeof session.prompt, 'function');
    assert.deepEqual(session.getActiveToolNames(), [
        'read', 'grep', 'aasc_find', 'ls', 'aasc_web_search', 'aasc_web_fetch'
    ]);
    session.dispose();
});
