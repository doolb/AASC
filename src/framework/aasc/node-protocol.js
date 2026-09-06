'use strict';

const { URL } = require('node:url');

const NODE_WS_PATH = '/server';
const NODE_MESSAGE_TYPES = new Set([
    'node.register',
    'node.registered',
    'node.heartbeat',
    'node.heartbeatAck',
    'node.request',
    'node.response',
    'node.error'
]);

/**
 * AASC 节点消息协议工具。
 *
 * /server 同时提供 HTTP 代码下发和 WebSocket 节点连接，协议工具只负责
 * WebSocket 消息的结构、节点注册字段和地址转换，不处理具体业务命令。
 */
function createNodeMessage(type, payload = {}, requestId = null) {
    if (!NODE_MESSAGE_TYPES.has(type)) {
        throw new TypeError(`未知 AASC 节点消息类型: ${type}`);
    }
    if (!isPlainObject(payload)) {
        throw new TypeError('AASC 节点消息 payload 必须是对象');
    }
    return {
        type,
        requestId: requestId || null,
        timestamp: Date.now(),
        payload: cloneObject(payload)
    };
}

function isNodeMessage(value) {
    return isPlainObject(value)
        && NODE_MESSAGE_TYPES.has(value.type)
        && (value.requestId === undefined || value.requestId === null || typeof value.requestId === 'string')
        && isPlainObject(value.payload);
}

function normalizeNodeRegistration(input = {}) {
    if (!isPlainObject(input)) {
        throw new TypeError('节点注册信息必须是对象');
    }

    const nodeId = normalizeText(input.nodeId, 'nodeId', 128);
    if (!nodeId) {
        throw new TypeError('nodeId 必填');
    }

    const result = {
        nodeId,
        name: normalizeText(input.name, 'name', 256) || nodeId,
        url: normalizeHttpUrl(input.url),
        version: normalizeText(input.version, 'version', 256) || 'unknown',
        capabilities: normalizeMap(input.capabilities, 'capabilities'),
        metadata: normalizeMap(input.metadata, 'metadata')
    };

    if (input.runtime !== undefined) {
        result.runtime = normalizeNodeRuntime(input.runtime);
    }

    return result;
}

function normalizeNodeRuntime(value) {
    if (!isPlainObject(value)) {
        return {};
    }

    const runtime = {};
    for (const field of ['displayCount', 'controlCount', 'libraryCount']) {
        const count = value[field];
        if (Number.isSafeInteger(count) && count >= 0) {
            runtime[field] = count;
        }
    }
    return runtime;
}

function toNodeWebSocketUrl(baseUrl) {
    const url = new URL(String(baseUrl || '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new TypeError('AASC 主服务器地址只允许使用 http 或 https');
    }
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = NODE_WS_PATH;
    url.search = '';
    url.hash = '';
    return url.toString();
}

function normalizeText(value, fieldName, maxLength) {
    if (value === undefined || value === null) {
        return '';
    }
    if (typeof value !== 'string') {
        throw new TypeError(`${fieldName} 必须是字符串`);
    }
    return value.trim().slice(0, maxLength);
}

function normalizeHttpUrl(value) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new TypeError('url 必填');
    }
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new TypeError('url 只允许使用 http 或 https');
    }
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
}

function normalizeMap(value, fieldName) {
    if (value === undefined || value === null) {
        return {};
    }
    if (!isPlainObject(value)) {
        throw new TypeError(`${fieldName} 必须是对象`);
    }
    try {
        return cloneObject(value);
    } catch (error) {
        throw new TypeError(`${fieldName} 必须是可序列化对象`);
    }
}

function cloneObject(value) {
    return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

module.exports = {
    NODE_MESSAGE_TYPES,
    NODE_WS_PATH,
    createNodeMessage,
    isNodeMessage,
    normalizeNodeRegistration,
    normalizeNodeRuntime,
    toNodeWebSocketUrl
};
