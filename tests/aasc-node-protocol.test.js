'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
    NODE_WS_PATH,
    createNodeMessage,
    isNodeMessage,
    normalizeNodeRegistration,
    normalizeNodeRuntime,
    toNodeWebSocketUrl
} = require('../src/framework/aasc/node-protocol');

test('将主服务器 HTTPS 地址转换为 /server WebSocket 地址', () => {
    assert.equal(
        toNodeWebSocketUrl('https://192.168.1.39:8081/'),
        'wss://192.168.1.39:8081/server'
    );
    assert.equal(NODE_WS_PATH, '/server');
});

test('节点注册消息只保留受控字段', () => {
    const result = normalizeNodeRegistration({
        nodeId: 'node-a',
        name: '客厅',
        url: 'https://node-a:8081',
        version: '1.0.0',
        capabilities: { mediaLibrary: true },
        metadata: { role: 'subserver' },
        secret: 'drop'
    });

    assert.deepEqual(result, {
        nodeId: 'node-a',
        name: '客厅',
        url: 'https://node-a:8081',
        version: '1.0.0',
        capabilities: { mediaLibrary: true },
        metadata: { role: 'subserver' }
    });
});

test('节点注册信息保留规范化后的运行数据', () => {
    const result = normalizeNodeRegistration({
        nodeId: 'node-a',
        url: 'https://node-a:8081',
        runtime: { displayCount: 2, controlCount: 1, libraryCount: 3, ignored: 9 }
    });

    assert.deepEqual(result.runtime, {
        displayCount: 2,
        controlCount: 1,
        libraryCount: 3
    });
    assert.deepEqual(normalizeNodeRuntime({ displayCount: -1 }), {});
});

test('节点消息包含类型、请求 ID、时间戳和负载', () => {
    const message = createNodeMessage('node.heartbeat', { version: '1.0.0' }, 'request-1');

    assert.equal(message.type, 'node.heartbeat');
    assert.equal(message.requestId, 'request-1');
    assert.equal(message.payload.version, '1.0.0');
    assert.equal(typeof message.timestamp, 'number');
    assert.equal(isNodeMessage(message), true);
    assert.equal(isNodeMessage({ type: 'unknown', payload: [] }), false);
});
