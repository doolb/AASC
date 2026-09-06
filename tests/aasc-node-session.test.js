'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { AascNodeSession } = require('../src/framework/aasc/node-session');

class FakeWebSocket extends EventEmitter {
    constructor() {
        super();
        this.readyState = 1;
        this.sent = [];
    }

    send(message) {
        this.sent.push(JSON.parse(message));
    }

    receive(message) {
        this.emit('message', JSON.stringify(message));
    }

    close() {
        this.readyState = 3;
        this.emit('close');
    }
}

test('服务端会话发送请求并匹配节点响应', async () => {
    const socket = new FakeWebSocket();
    const session = new AascNodeSession(socket);
    const resultPromise = session.request('media.index.local', { path: '/' });
    const request = socket.sent[0];

    socket.receive({
        type: 'node.response',
        requestId: request.requestId,
        payload: { nodeId: 'node-a', libraries: [] }
    });

    assert.deepEqual(await resultPromise, { nodeId: 'node-a', libraries: [] });
});

test('服务端会话收到业务消息后交给处理器，断开时拒绝待处理请求', async () => {
    const socket = new FakeWebSocket();
    const received = [];
    const session = new AascNodeSession(socket, {
        onMessage: async message => {
            received.push(message);
        }
    });
    const resultPromise = session.request('server.ping', {});
    socket.receive({ type: 'node.heartbeat', payload: { version: '1.0.0' } });
    socket.close();

    await assert.rejects(resultPromise, /节点连接已断开/);
    assert.equal(received[0].type, 'node.heartbeat');
});
