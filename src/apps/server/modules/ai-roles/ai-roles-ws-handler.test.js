'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const registerAiRoleHandlers = require('./ai-roles-ws-handler');

class FakeWsServer {
    constructor() {
        this.handlers = new Map();
    }

    registerHandler(type, handler) {
        this.handlers.set(type, handler);
    }

    async handleControlMessage(data, ws) {
        const handler = this.handlers.get(data.type);
        assert.ok(handler, `应注册 ${data.type} handler`);
        return handler(data, { ws, server: this });
    }
}

function makeWebSocket() {
    const sent = [];
    return {
        sent,
        send(message) {
            sent.push(JSON.parse(message));
        }
    };
}

function makeDependencies() {
    const roles = [{ name: '后端', createdAt: 1, running: false }];
    const broadcasts = [];
    const aiRoles = {
        list: () => roles.map((role) => ({ ...role })),
        add: (name) => {
            if (name === '重复') throw new Error('角色已存在');
            roles.push({ name, createdAt: 2, running: false });
        },
        remove: (name) => {
            const index = roles.findIndex((role) => role.name === name);
            if (index < 0) throw new Error('角色不存在');
            roles.splice(index, 1);
        },
        history: (name) => {
            if (!roles.some((role) => role.name === name)) throw new Error('角色不存在');
            return [{ role: 'assistant', name, content: '历史' }];
        }
    };
    return { aiRoles, broadcasts };
}

test('角色 WebSocket handler 注册四种角色管理消息', async () => {
    const server = new FakeWsServer();
    const { aiRoles, broadcasts } = makeDependencies();
    registerAiRoleHandlers(server, {
        aiRoles,
        broadcastToControls: (message) => broadcasts.push(message)
    });

    const listWs = makeWebSocket();
    await server.handleControlMessage({ type: 'roleList' }, listWs);
    assert.deepStrictEqual(listWs.sent, [{
        type: 'roleList',
        roles: [{ name: '后端', createdAt: 1, running: false }]
    }]);

    const addWs = makeWebSocket();
    await server.handleControlMessage({ type: 'roleAdd', name: '前端' }, addWs);
    assert.strictEqual(broadcasts.length, 1);
    assert.deepStrictEqual(broadcasts[0], {
        type: 'roleList',
        roles: [
            { name: '后端', createdAt: 1, running: false },
            { name: '前端', createdAt: 2, running: false }
        ]
    });

    const historyWs = makeWebSocket();
    await server.handleControlMessage({ type: 'roleHistory', role: '前端' }, historyWs);
    assert.deepStrictEqual(historyWs.sent, [{
        type: 'roleHistory',
        role: '前端',
        history: [{ role: 'assistant', name: '前端', content: '历史' }]
    }]);

    const deleteWs = makeWebSocket();
    await server.handleControlMessage({ type: 'roleDelete', role: '前端' }, deleteWs);
    assert.strictEqual(broadcasts.length, 2);
    assert.deepStrictEqual(broadcasts[1], {
        type: 'roleList',
        roles: [{ name: '后端', createdAt: 1, running: false }]
    });
});

test('角色 handler 将添加和删除异常返回 roleError', async () => {
    const server = new FakeWsServer();
    const { aiRoles, broadcasts } = makeDependencies();
    registerAiRoleHandlers(server, {
        aiRoles,
        broadcastToControls: (message) => broadcasts.push(message)
    });

    const addWs = makeWebSocket();
    await server.handleControlMessage({ type: 'roleAdd', name: '重复' }, addWs);
    assert.deepStrictEqual(addWs.sent, [{ type: 'roleError', message: '角色已存在' }]);

    const deleteWs = makeWebSocket();
    await server.handleControlMessage({ type: 'roleDelete', role: '不存在' }, deleteWs);
    assert.deepStrictEqual(deleteWs.sent, [{ type: 'roleError', message: '角色不存在' }]);
    assert.strictEqual(broadcasts.length, 0);
});

test('角色历史不存在时返回 roleError', async () => {
    const server = new FakeWsServer();
    const { aiRoles, broadcasts } = makeDependencies();
    registerAiRoleHandlers(server, {
        aiRoles,
        broadcastToControls: (message) => broadcasts.push(message)
    });

    const ws = makeWebSocket();
    await server.handleControlMessage({ type: 'roleHistory', role: '不存在' }, ws);
    assert.deepStrictEqual(ws.sent, [{ type: 'roleError', message: '角色不存在' }]);
});
