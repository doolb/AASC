'use strict';

const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PiRuntimeManager } = require('./pi-runtime-manager');

function createFakePiChild() {
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
