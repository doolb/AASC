'use strict';

const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PiRuntimeManager } = require('./pi-runtime-manager');

function createFakePiChild() {
    const child = new EventEmitter();
    child.killed = false;
    child.prompts = [];
    child.stdin = {
        write(payload) {
            const request = JSON.parse(String(payload));
            child.prompts.push(request.message);
            queueMicrotask(() => {
                child.stdout.emit('data', Buffer.from(`${JSON.stringify({
                    id: request.id,
                    type: 'response',
                    success: true
                })}\n`));
                child.stdout.emit('data', Buffer.from(`${JSON.stringify({
                    type: 'message_update',
                    assistantMessageEvent: { type: 'text_delta', delta: '找到' }
                })}\n`));
                child.stdout.emit('data', Buffer.from(`${JSON.stringify({
                    type: 'message_update',
                    assistantMessageEvent: { type: 'text_delta', delta: '文件' }
                })}\n`));
                child.stdout.emit('data', Buffer.from(`${JSON.stringify({
                    type: 'agent_end',
                    messages: [{ role: 'assistant', content: [{ type: 'text', text: '找到文件' }] }]
                })}\n`));
            });
            return true;
        },
        end() {}
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {
        child.killed = true;
        queueMicrotask(() => child.emit('exit', 0, 'SIGTERM'));
    };
    return child;
}

function createFakePiChildWithEvents(events) {
    const child = new EventEmitter();
    child.killed = false;
    child.stdin = {
        write(payload) {
            const request = JSON.parse(String(payload));
            queueMicrotask(() => {
                child.stdout.emit('data', Buffer.from(`${JSON.stringify({
                    id: request.id,
                    type: 'response',
                    success: true
                })}\n`));
                for (const event of events) {
                    child.stdout.emit('data', Buffer.from(`${JSON.stringify(event)}\n`));
                }
            });
            return true;
        },
        end() {}
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {
        child.killed = true;
        queueMicrotask(() => child.emit('exit', 0, 'SIGTERM'));
    };
    return child;
}

test('Pi 默认 RPC 请求超时为 600 秒', () => {
    const manager = new PiRuntimeManager();
    assert.equal(manager.requestTimeoutMs, 600000);
});

test('Pi RPC 流式文本按增量回调并完成请求', async () => {
    const child = createFakePiChild();
    const spawnCalls = [];
    const manager = new PiRuntimeManager({
        projectRoot: '/project',
        extensionPath: '/project/pi-readonly-tools.mjs',
        spawn: (...args) => {
            spawnCalls.push(args);
            return child;
        }
    });
    const chunks = [];
    const result = await manager.chatStream(
        { name: 'local', mode: 'agent', backend: 'pi', apiUrl: 'http://llm/v1/chat/completions', model: 'qwen' },
        { id: 'researcher', permissionProfile: 'readonly', content: '只读助手' },
        '查找文件',
        { onChunk: (chunk) => chunks.push(chunk) }
    );
    assert.deepStrictEqual(chunks, ['找到', '文件']);
    assert.equal(result.message, '找到文件');
    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0][1].includes('bash'), false);
    assert.equal(spawnCalls[0][1].includes('edit'), false);
    assert.equal(spawnCalls[0][1].includes('write'), false);
    await manager.stopAll();
});

test('Pi Agent 错误型空 agent_end 必须拒绝请求', async () => {
    const child = createFakePiChildWithEvents([
        {
            type: 'agent_end',
            messages: [{
                role: 'assistant',
                content: [],
                stopReason: 'error',
                errorMessage: '模型连接中断'
            }]
        }
    ]);
    const errors = [];
    const manager = new PiRuntimeManager({
        projectRoot: '/project',
        extensionPath: '/project/pi-readonly-tools.mjs',
        spawn: () => child
    });
    await assert.rejects(
        manager.chatStream(
            { name: 'local', mode: 'agent', backend: 'pi', apiUrl: 'http://llm/v1', model: 'qwen' },
            { id: 'researcher', permissionProfile: 'readonly' },
            '继续处理',
            { onError: (error) => errors.push(error) }
        ),
        /模型连接中断/
    );
    assert.deepStrictEqual(errors, ['模型连接中断']);
    await manager.stopAll();
});

test('Pi Agent 空成功 agent_end 必须报告空回复失败', async () => {
    const child = createFakePiChildWithEvents([
        { type: 'agent_end', messages: [{ role: 'assistant', content: [] }] }
    ]);
    const manager = new PiRuntimeManager({
        projectRoot: '/project',
        extensionPath: '/project/pi-readonly-tools.mjs',
        spawn: () => child
    });
    await assert.rejects(
        manager.chatStream(
            { name: 'local', mode: 'agent', backend: 'pi', apiUrl: 'http://llm/v1', model: 'qwen' },
            { id: 'researcher', permissionProfile: 'readonly' },
            '继续处理'
        ),
        /返回空回复/
    );
    await manager.stopAll();
});

test('Pi Agent 可重试的 agent_end 不会提前结束请求', async () => {
    const child = createFakePiChildWithEvents([
        { type: 'agent_end', willRetry: true, messages: [] },
        {
            type: 'message_update',
            assistantMessageEvent: { type: 'text_delta', delta: '重试成功' }
        },
        { type: 'agent_end', messages: [{ role: 'assistant', content: [{ type: 'text', text: '重试成功' }] }] }
    ]);
    const manager = new PiRuntimeManager({
        projectRoot: '/project',
        extensionPath: '/project/pi-readonly-tools.mjs',
        spawn: () => child
    });
    const result = await manager.chatStream(
        { name: 'local', mode: 'agent', backend: 'pi', apiUrl: 'http://llm/v1', model: 'qwen' },
        { id: 'researcher', permissionProfile: 'readonly' },
        '继续处理'
    );
    assert.equal(result.message, '重试成功');
    await manager.stopAll();
});

test('Pi 请求生命周期日志包含 requestId 和完成状态', async () => {
    const child = createFakePiChild();
    const logs = [];
    const manager = new PiRuntimeManager({
        projectRoot: '/project',
        extensionPath: '/project/pi-readonly-tools.mjs',
        spawn: () => child,
        logger: (message, details) => logs.push({ message, details })
    });
    await manager.chatStream(
        { name: 'local', mode: 'agent', backend: 'pi', apiUrl: 'http://llm/v1', model: 'qwen' },
        { id: 'researcher', permissionProfile: 'readonly' },
        '查找文件'
    );
    assert.ok(logs.some(entry => /Pi 请求入队 requestId=aasc-1/u.test(entry.message)));
    assert.ok(logs.some(entry => /Pi 请求开始 requestId=aasc-1/u.test(entry.message)));
    assert.ok(logs.some(entry => /Pi RPC 事件 requestId=aasc-1 type=agent_end/u.test(entry.message)));
    assert.ok(logs.some(entry => /Pi 请求完成 requestId=aasc-1/u.test(entry.message)));
    assert.ok(logs.every(entry => entry.details.requestId === 'aasc-1'));
    await manager.stopAll();
});

test('Pi 会话后续请求只发送当前消息，不重复发送初始化 prompt', async () => {
    const child = createFakePiChild();
    const manager = new PiRuntimeManager({
        projectRoot: '/project',
        extensionPath: '/project/pi-readonly-tools.mjs',
        spawn: () => child
    });
    const profile = { name: 'local', mode: 'agent', backend: 'pi', apiUrl: 'http://llm/v1', model: 'qwen' };
    const template = { id: 'researcher', permissionProfile: 'readonly' };
    await manager.chatStream(profile, template, '初始化上下文与历史', {}, {
        continuationPrompt: '第一轮消息',
        conversationKey: 'group:default'
    });
    await manager.chatStream(profile, template, '不应再次发送的完整历史', {}, {
        continuationPrompt: '第二轮消息',
        conversationKey: 'group:default'
    });
    assert.deepStrictEqual(child.prompts, ['初始化上下文与历史', 'User:第二轮消息']);
    await manager.stopAll();
});

test('Pi Agent 已带 User 前缀的续聊消息不会重复添加', async () => {
    const child = createFakePiChild();
    const manager = new PiRuntimeManager({ spawn: () => child });
    const profile = { name: 'local', mode: 'agent', backend: 'pi', apiUrl: 'http://llm/v1', model: 'qwen' };
    const template = { id: 'researcher', permissionProfile: 'readonly' };
    await manager.chatStream(profile, template, '初始化', {}, { conversationKey: 'group:default' });
    await manager.chatStream(profile, template, '历史内容', {}, {
        conversationKey: 'group:default',
        continuationPrompt: 'User:第二轮消息'
    });
    assert.deepStrictEqual(child.prompts, ['初始化', 'User:第二轮消息']);
    await manager.stopAll();
});

test('Pi 不同 conversationKey 不共享内存上下文', async () => {
    const children = [];
    const manager = new PiRuntimeManager({
        projectRoot: '/project',
        extensionPath: '/project/pi-readonly-tools.mjs',
        spawn: () => {
            const child = createFakePiChild();
            children.push(child);
            return child;
        }
    });
    const profile = { name: 'local', mode: 'agent', backend: 'pi', apiUrl: 'http://llm/v1', model: 'qwen' };
    const template = { id: 'researcher', permissionProfile: 'readonly' };
    await manager.chatStream(profile, template, '群聊', {}, { conversationKey: 'group:default', continuationPrompt: '群聊' });
    await manager.chatStream(profile, template, '私聊A', {}, { conversationKey: 'private:a:default', continuationPrompt: '私聊A' });
    assert.equal(children.length, 2);
    await manager.stopAll();
});

test('删除对话后可以重置指定 Pi 会话', async () => {
    const child = createFakePiChild();
    const manager = new PiRuntimeManager({
        projectRoot: '/project',
        extensionPath: '/project/pi-readonly-tools.mjs',
        spawn: () => child
    });
    const profile = { name: 'local', mode: 'agent', backend: 'pi', apiUrl: 'http://llm/v1', model: 'qwen' };
    const template = { id: 'researcher', permissionProfile: 'readonly' };
    await manager.chatStream(profile, template, '旧上下文', {}, { conversationKey: 'group:default', continuationPrompt: '旧上下文' });
    assert.equal(manager.resetSession(profile, template, 'group:default'), true);
    assert.equal(manager.getSessionCount(), 0);
    await manager.stopAll();
});

test('profile、模板和权限变化会创建独立 Pi 会话', async () => {
    const children = [];
    const manager = new PiRuntimeManager({
        projectRoot: '/project',
        extensionPath: '/project/pi-readonly-tools.mjs',
        spawn: () => {
            const child = createFakePiChild();
            children.push(child);
            return child;
        }
    });
    const profile = { name: 'local', mode: 'agent', backend: 'pi', apiUrl: 'http://llm/v1', model: 'qwen' };
    await manager.chatStream(profile, { id: 'one', permissionProfile: 'readonly' }, 'a');
    await manager.chatStream(profile, { id: 'two', permissionProfile: 'readonly' }, 'b');
    await manager.chatStream({ ...profile, name: 'other' }, { id: 'one', permissionProfile: 'readonly' }, 'c');
    await manager.chatStream({ ...profile, model: 'other-model' }, { id: 'one', permissionProfile: 'readonly' }, 'd');
    assert.equal(children.length, 4);
    await manager.stopAll();
});

test('子进程退出会拒绝请求并清理会话', async () => {
    const child = createFakePiChild();
    child.stdin.write = () => true;
    const manager = new PiRuntimeManager({
        projectRoot: '/project',
        extensionPath: '/project/pi-readonly-tools.mjs',
        spawn: () => child,
        requestTimeoutMs: 1000
    });
    const pending = manager.chatStream(
        { name: 'local', mode: 'agent', backend: 'pi', apiUrl: 'http://llm/v1', model: 'qwen' },
        { id: 'one', permissionProfile: 'readonly' },
        'a'
    );
    child.emit('exit', 1, null);
    await assert.rejects(pending, /退出/);
    assert.equal(manager.getSessionCount(), 0);
});

test('请求超时会终止子进程并清理会话', async () => {
    const child = createFakePiChild();
    child.stdin.write = () => true;
    const manager = new PiRuntimeManager({
        projectRoot: '/project',
        extensionPath: '/project/pi-readonly-tools.mjs',
        spawn: () => child,
        requestTimeoutMs: 10
    });
    await assert.rejects(
        manager.chatStream(
            { name: 'local', mode: 'agent', backend: 'pi', apiUrl: 'http://llm/v1', model: 'qwen' },
            { id: 'one', permissionProfile: 'readonly' },
            'a'
        ),
        /超时/
    );
    assert.equal(child.killed, true);
    assert.equal(manager.getSessionCount(), 0);
});
