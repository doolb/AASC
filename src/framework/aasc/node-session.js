'use strict';

const { randomUUID } = require('node:crypto');
const {
    createNodeMessage,
    isNodeMessage
} = require('./node-protocol');

const DEFAULT_REQUEST_TIMEOUT_MS = 10000;

/**
 * AASC 主服务器侧的单个子服务器 WebSocket 会话。
 *
 * 会话层只负责消息编解码、请求响应匹配和断开清理，具体的媒体、任务、
 * 更新命令由 onMessage 或上层注册的业务处理器负责，避免把协议细节散落
 * 到主服务器的路由代码中。
 */
class AascNodeSession {
    constructor(socket, options = {}) {
        if (!socket || typeof socket.send !== 'function') {
            throw new TypeError('AASC 节点会话需要可发送消息的 WebSocket');
        }

        this.socket = socket;
        this.requestTimeoutMs = normalizeTimeout(options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
        this.onMessage = options.onMessage || (() => {});
        this.onError = options.onError || (() => {});
        this.pendingRequests = new Map();
        this.closed = false;

        this._handleMessage = this._handleMessage.bind(this);
        this._handleClose = this._handleClose.bind(this);
        this._handleError = this._handleError.bind(this);
        this.socket.on('message', this._handleMessage);
        this.socket.once('close', this._handleClose);
        this.socket.once('error', this._handleError);
    }

    send(type, payload = {}, requestId = null) {
        if (this.closed || !this._isOpen()) {
            return false;
        }
        const message = createNodeMessage(type, payload, requestId);
        this.socket.send(JSON.stringify(message));
        return true;
    }

    request(command, payload = {}, timeoutMs = this.requestTimeoutMs) {
        if (this.closed || !this._isOpen()) {
            return Promise.reject(new Error('AASC 节点连接不可用'));
        }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return Promise.reject(new TypeError('节点请求 payload 必须是对象'));
        }

        const requestId = randomUUID();
        const requestTimeout = normalizeTimeout(timeoutMs, this.requestTimeoutMs);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new Error(`节点请求超时: ${command}`));
            }, requestTimeout);
            this.pendingRequests.set(requestId, { resolve, reject, timer });

            try {
                const sent = this.send('node.request', { ...payload, command }, requestId);
                if (!sent) {
                    clearTimeout(timer);
                    this.pendingRequests.delete(requestId);
                    reject(new Error('AASC 节点连接不可用'));
                }
            } catch (error) {
                clearTimeout(timer);
                this.pendingRequests.delete(requestId);
                reject(error);
            }
        });
    }

    close(code = 1000, reason = 'node session closed') {
        if (this.closed) return;
        this.closed = true;
        this._rejectPending(new Error('节点连接已断开'));
        if (typeof this.socket.close === 'function' && this._isOpen()) {
            this.socket.close(code, reason);
        }
    }

    _handleMessage(rawMessage) {
        let message;
        try {
            message = JSON.parse(Buffer.isBuffer(rawMessage) ? rawMessage.toString('utf8') : String(rawMessage));
        } catch (error) {
            this.onError(new Error(`AASC 节点消息解析失败: ${error.message}`));
            return;
        }

        if (!isNodeMessage(message)) {
            this.onError(new Error('AASC 节点消息格式无效'));
            return;
        }

        if (message.type === 'node.response' || message.type === 'node.error') {
            this._resolvePending(message);
            return;
        }

        Promise.resolve(this.onMessage(message)).catch(error => this.onError(error));
    }

    _resolvePending(message) {
        if (!message.requestId) return;
        const pending = this.pendingRequests.get(message.requestId);
        if (!pending) return;

        this.pendingRequests.delete(message.requestId);
        clearTimeout(pending.timer);
        if (message.type === 'node.error') {
            pending.reject(new Error(message.payload.message || '节点请求失败'));
            return;
        }
        pending.resolve(message.payload);
    }

    _handleClose() {
        if (this.closed) {
            this._rejectPending(new Error('节点连接已断开'));
            return;
        }
        this.closed = true;
        this._rejectPending(new Error('节点连接已断开'));
    }

    _handleError(error) {
        this.onError(error);
    }

    _rejectPending(error) {
        for (const [requestId, pending] of this.pendingRequests) {
            clearTimeout(pending.timer);
            this.pendingRequests.delete(requestId);
            pending.reject(error);
        }
    }

    _isOpen() {
        return this.socket.readyState === 1;
    }
}

function normalizeTimeout(value, fallback) {
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

module.exports = {
    AascNodeSession,
    DEFAULT_REQUEST_TIMEOUT_MS
};
