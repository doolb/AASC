'use strict';

const WebSocket = require('ws');
const {
    createNodeMessage,
    isNodeMessage,
    normalizeNodeRuntime,
    toNodeWebSocketUrl
} = require('./node-protocol');

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30000;
const DEFAULT_RECONNECT_MIN_MS = 1000;
const DEFAULT_RECONNECT_MAX_MS = 30000;

/**
 * AASC 子服务器主动连接客户端。
 *
 * 客户端只负责连接生命周期、注册、心跳和请求响应，不直接耦合媒体、任务
 * 或热更新业务。业务层通过 onRequest 回调处理主服务器发来的白名单命令。
 */
class AascNodeConnector {
    constructor(options = {}) {
        this.WebSocketClass = options.WebSocketClass || WebSocket;
        this.mainServerUrl = options.mainServerUrl;
        this.nodeId = options.nodeId;
        this.nodeName = options.nodeName || this.nodeId;
        this.advertisedUrl = options.advertisedUrl;
        this.getAdvertisedUrl = options.getAdvertisedUrl || (() => this.advertisedUrl);
        this.version = options.version || 'unknown';
        this.capabilities = cloneObject(options.capabilities || {});
        this.metadata = cloneObject(options.metadata || { role: 'subserver' });
        this.getRuntime = options.getRuntime || (() => ({}));
        this.heartbeatIntervalMs = normalizePositiveInteger(
            options.heartbeatIntervalMs,
            DEFAULT_HEARTBEAT_INTERVAL_MS
        );
        this.reconnectMinMs = normalizePositiveInteger(options.reconnectMinMs, DEFAULT_RECONNECT_MIN_MS);
        this.reconnectMaxMs = Math.max(
            this.reconnectMinMs,
            normalizePositiveInteger(options.reconnectMaxMs, DEFAULT_RECONNECT_MAX_MS)
        );
        this.setInterval = options.setInterval || ((callback, delay) => setInterval(callback, delay));
        this.clearInterval = options.clearInterval || ((timer) => clearInterval(timer));
        this.schedule = options.schedule || ((callback, delay) => setTimeout(callback, delay));
        this.cancelSchedule = options.cancelSchedule || ((timer) => clearTimeout(timer));
        this.onRequest = options.onRequest || (async () => ({ accepted: false, message: '未配置节点请求处理器' }));
        this.onStateChange = options.onStateChange || (() => {});
        this.onError = options.onError || (() => {});

        this.socket = null;
        this.heartbeatTimer = null;
        this.reconnectTimer = null;
        this.nextReconnectDelayMs = this.reconnectMinMs;
        this.state = 'idle';
        this.registered = false;
        this.stopping = false;
    }

    start() {
        if (this.stopping) {
            return this.getState();
        }
        if (this.socket && this._isSocketActive()) {
            return this.getState();
        }
        this._clearReconnectTimer();
        this._connect();
        return this.getState();
    }

    stop() {
        this.stopping = true;
        this._clearReconnectTimer();
        this._clearHeartbeatTimer();
        const socket = this.socket;
        this.socket = null;
        this.registered = false;
        if (socket && typeof socket.close === 'function' && this._isSocketOpen(socket)) {
            socket.close(1000, 'connector stopped');
        }
        this._setState('stopped');
        return this.getState();
    }

    send(type, payload = {}, requestId = null) {
        if (!this._isSocketOpen()) {
            return false;
        }
        const message = createNodeMessage(type, payload, requestId);
        this.socket.send(JSON.stringify(message));
        return true;
    }

    getState() {
        return {
            state: this.state,
            nodeId: this.nodeId,
            connected: this._isSocketOpen(),
            registered: this.registered,
            reconnectDelayMs: this.nextReconnectDelayMs
        };
    }

    _connect() {
        if (this.stopping) return;
        this._setState('connecting');
        let socket;
        try {
            socket = new this.WebSocketClass(toNodeWebSocketUrl(this.mainServerUrl), {
                rejectUnauthorized: false
            });
        } catch (error) {
            this._handleConnectionError(error);
            this._scheduleReconnect();
            return;
        }

        this.socket = socket;
        socket.once('open', () => this._handleOpen(socket));
        socket.on('message', (message) => this._handleMessage(message, socket));
        socket.once('close', () => this._handleClose(socket));
        socket.once('error', (error) => this._handleConnectionError(error));
    }

    _handleOpen(socket) {
        if (this.stopping || socket !== this.socket) return;
        this.nextReconnectDelayMs = this.reconnectMinMs;
        this.registered = false;
        this._setState('connected');
        this.send('node.register', {
            nodeId: this.nodeId,
            name: this.nodeName,
            url: this._getAdvertisedUrl(),
            version: this.version,
            capabilities: this.capabilities,
            metadata: this.metadata,
            runtime: this._getRuntime()
        });
    }

    async _handleMessage(rawMessage, socket) {
        if (socket !== this.socket) return;
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

        if (message.type === 'node.registered') {
            this.registered = true;
            this._startHeartbeatTimer();
            this._setState('connected');
            return;
        }
        if (message.type !== 'node.request' || !this.registered) {
            return;
        }

        try {
            const result = await this.onRequest({
                type: message.payload.command || message.payload.type,
                requestId: message.requestId,
                payload: message.payload
            });
            this.send('node.response', result || {}, message.requestId);
        } catch (error) {
            this.send('node.error', { message: error.message }, message.requestId);
        }
    }

    _handleClose(socket) {
        if (socket !== this.socket) return;
        this.socket = null;
        this.registered = false;
        this._clearHeartbeatTimer();
        if (this.stopping) {
            this._setState('stopped');
            return;
        }
        this._setState('reconnecting');
        this._scheduleReconnect();
    }

    _handleConnectionError(error) {
        this.onError(error);
    }

    _scheduleReconnect() {
        if (this.stopping || this.reconnectTimer) return;
        const delay = this.nextReconnectDelayMs;
        this.nextReconnectDelayMs = Math.min(this.reconnectMaxMs, delay * 2);
        this.reconnectTimer = this.schedule(() => {
            this.reconnectTimer = null;
            this._connect();
        }, delay);
    }

    _startHeartbeatTimer() {
        this._clearHeartbeatTimer();
        this.heartbeatTimer = this.setInterval(() => {
            this.send('node.heartbeat', {
                nodeId: this.nodeId,
                url: this._getAdvertisedUrl(),
                version: this.version,
                capabilities: this.capabilities,
                metadata: this.metadata,
                runtime: this._getRuntime()
            });
        }, this.heartbeatIntervalMs);
    }

    _clearHeartbeatTimer() {
        if (this.heartbeatTimer === null) return;
        this.clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
    }

    _clearReconnectTimer() {
        if (this.reconnectTimer === null) return;
        this.cancelSchedule(this.reconnectTimer);
        this.reconnectTimer = null;
    }

    _isSocketActive() {
        return this._isSocketOpen() || this.socket?.readyState === 0;
    }

    _isSocketOpen(socket = this.socket) {
        return Boolean(socket) && socket.readyState === 1;
    }

    _setState(state) {
        this.state = state;
        this.onStateChange(this.getState());
    }

    _getRuntime() {
        try {
            return normalizeNodeRuntime(this.getRuntime());
        } catch (error) {
            this.onError(new Error(`AASC 节点运行数据采集失败: ${error.message}`));
            return {};
        }
    }

    _getAdvertisedUrl() {
        try {
            return this.getAdvertisedUrl() || this.advertisedUrl;
        } catch (error) {
            this.onError(new Error(`AASC 节点地址采集失败: ${error.message}`));
            return this.advertisedUrl;
        }
    }
}

function normalizePositiveInteger(value, fallback) {
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function cloneObject(value) {
    return JSON.parse(JSON.stringify(value));
}

module.exports = {
    AascNodeConnector,
    DEFAULT_HEARTBEAT_INTERVAL_MS,
    DEFAULT_RECONNECT_MIN_MS,
    DEFAULT_RECONNECT_MAX_MS
};
