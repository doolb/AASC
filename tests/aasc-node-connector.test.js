'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { AascNodeConnector } = require('../src/framework/aasc/node-connector');

class FakeWebSocket extends EventEmitter {
    static instances = [];
    static OPEN = 1;
    static CLOSED = 3;

    constructor(url, options) {
        super();
        this.url = url;
        this.options = options;
        this.readyState = 0;
        this.sent = [];
        FakeWebSocket.instances.push(this);
    }

    send(message) {
        this.sent.push(JSON.parse(message));
    }

    open() {
        this.readyState = FakeWebSocket.OPEN;
        this.emit('open');
    }

    receive(message) {
        this.emit('message', JSON.stringify(message));
    }

    close() {
        this.readyState = FakeWebSocket.CLOSED;
        this.emit('close');
    }
}

function createConnector(options = {}) {
    FakeWebSocket.instances.length = 0;
    const timers = [];
    const connector = new AascNodeConnector({
        WebSocketClass: FakeWebSocket,
        mainServerUrl: 'https://main.test:8081',
        nodeId: 'node-a',
        nodeName: '客厅服务器',
        advertisedUrl: 'https://node-a:8081',
        version: '1.0.0',
        capabilities: { mediaLibrary: true },
        metadata: { role: 'subserver' },
        heartbeatIntervalMs: 30000,
        getRuntime: () => ({ displayCount: 2, controlCount: 1, libraryCount: 3 }),
        reconnectMinMs: 1000,
        reconnectMaxMs: 30000,
        setInterval: (callback, delay) => {
            const timer = { callback, delay };
            timers.push(timer);
            return timer;
        },
        clearInterval: (timer) => {
            timer.cancelled = true;
        },
        schedule: (callback, delay) => ({ callback, delay }),
        ...options
    });
    return { connector, timers };
}

test('连接成功后发送注册，确认后按间隔发送心跳', () => {
    const { connector, timers } = createConnector();
    connector.start();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.receive({ type: 'node.registered', payload: { nodeId: 'node-a' } });
    timers[0].callback();

    assert.equal(socket.url, 'wss://main.test:8081/server');
    assert.equal(socket.sent[0].type, 'node.register');
    assert.equal(socket.sent[0].payload.nodeId, 'node-a');
    assert.deepEqual(socket.sent[0].payload.runtime, {
        displayCount: 2,
        controlCount: 1,
        libraryCount: 3
    });
    assert.equal(socket.sent[1].type, 'node.heartbeat');
    assert.deepEqual(socket.sent[1].payload.runtime, {
        displayCount: 2,
        controlCount: 1,
        libraryCount: 3
    });
    assert.equal(timers[0].delay, 30000);
});

test('收到主服务器请求后调用处理器并返回 node.response', async () => {
    const { connector } = createConnector({
        onRequest: async ({ type, payload }) => ({ type, accepted: payload.action === 'restart' })
    });
    connector.start();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.receive({ type: 'node.registered', payload: { nodeId: 'node-a' } });
    socket.receive({
        type: 'node.request',
        requestId: 'request-1',
        payload: { command: 'server.restart', action: 'restart' }
    });
    await new Promise(resolve => setImmediate(resolve));

    const response = socket.sent.at(-1);
    assert.equal(response.type, 'node.response');
    assert.equal(response.requestId, 'request-1');
    assert.deepEqual(response.payload, { type: 'server.restart', accepted: true });
});

test('连接断开后进入重连状态并清理心跳', () => {
    const { connector, timers } = createConnector();
    connector.start();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.receive({ type: 'node.registered', payload: { nodeId: 'node-a' } });
    socket.close();

    assert.equal(timers[0].cancelled, true);
    assert.equal(connector.getState().state, 'reconnecting');
    connector.stop();
    assert.equal(connector.getState().state, 'stopped');
});
