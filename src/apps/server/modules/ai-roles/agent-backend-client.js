'use strict';

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { USER_CONFIG_DIR } = require('../config/user-config-paths');

const DEFAULT_SOCKET_PATH = path.join(USER_CONFIG_DIR, 'ai-roles', 'backend.sock');
const DEFAULT_HOST_PATH = path.join(__dirname, 'agent-backend-host.js');
const CONNECT_TIMEOUT_MS = 5000;

function errorMessage(error) {
    return error instanceof Error ? error.message : String(error || 'Agent 后端连接失败');
}

function isRetryableConnectionError(error) {
    return ['ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE'].includes(error?.code);
}

class AgentBackendClientBridge {
    constructor(client, options) {
        this.client = client;
        this.options = { ...options };
        this.backend = options.backend;
        this.promptFile = options.promptFile || null;
        this.prompt = '';
        this.alive = false;
    }

    isAlive() {
        return this.alive;
    }

    setPrompt(prompt) {
        this.prompt = String(prompt || '');
    }

    _requestOptions() {
        return {
            ...this.options,
            prompt: this.prompt,
            promptFile: this.promptFile
        };
    }

    async ensureStarted() {
        const result = await this.client.request({
            op: 'ensureStarted',
            role: this.options.name,
            options: this._requestOptions()
        });
        this.alive = !!result.running;
        this.backend = result.backend || this.backend;
        return result;
    }

    async reconnect() {
        try {
            const result = await this.client.request({
                op: 'status',
                role: this.options.name,
                options: this._requestOptions()
            });
            this.alive = !!result.running;
            this.backend = result.backend || this.backend;
            return this.alive;
        } catch (_) {
            this.alive = false;
            return false;
        }
    }

    async chat(content, callbacks = {}) {
        try {
            const result = await this.client.request({
                op: 'chat',
                role: this.options.name,
                content: String(content),
                options: this._requestOptions()
            }, (event) => {
                if (event.event === 'chunk') callbacks.onChunk?.(event.payload.chunk, event.payload.message);
                if (event.event === 'complete') callbacks.onComplete?.(event.payload.message);
                if (event.event === 'error') callbacks.onError?.(new Error(event.payload.error));
            });
            this.alive = result.running !== false;
            this.backend = result.backend || this.backend;
            return result;
        } catch (error) {
            this.alive = false;
            callbacks.onError?.(error);
            throw error;
        }
    }

    async stop() {
        try {
            const result = await this.client.request({
                op: 'stopRole',
                role: this.options.name,
                options: this._requestOptions()
            });
            this.alive = false;
            return result;
        } catch (error) {
            this.alive = false;
            throw error;
        }
    }
}

class AgentBackendClient {
    constructor({
        socketPath = DEFAULT_SOCKET_PATH,
        hostPath = DEFAULT_HOST_PATH,
        pidFile = path.join(path.dirname(socketPath), 'backend.pid'),
        spawnHost = null,
        connectTimeoutMs = CONNECT_TIMEOUT_MS
    } = {}) {
        this.socketPath = socketPath;
        this.hostPath = hostPath;
        this.pidFile = pidFile;
        this.spawnHost = spawnHost;
        this.connectTimeoutMs = connectTimeoutMs;
        this.socket = null;
        this.buffer = '';
        this.pending = new Map();
        this.nextRequestId = 1;
        this.connectPromise = null;
        this.spawnPromise = null;
    }

    createBridge(options) {
        return new AgentBackendClientBridge(this, options);
    }

    async _connectOnce() {
        if (this.socket && !this.socket.destroyed) return;
        await new Promise((resolve, reject) => {
            const socket = net.createConnection({ path: this.socketPath });
            let connected = false;
            const timer = setTimeout(() => {
                const error = new Error('Agent 后端 Socket 连接超时');
                error.code = 'ETIMEDOUT';
                socket.destroy(error);
            }, this.connectTimeoutMs);
            const onError = (error) => {
                clearTimeout(timer);
                if (!connected) reject(error);
                this._handleDisconnect(socket, error);
            };
            socket.setEncoding('utf8');
            socket.on('error', onError);
            socket.on('close', () => this._handleDisconnect(socket, new Error('Agent 后端 Socket 已断开')));
            socket.on('data', (chunk) => this._handleData(chunk));
            socket.once('connect', () => {
                connected = true;
                clearTimeout(timer);
                this.socket = socket;
                resolve();
            });
        });
    }

    _handleData(chunk) {
        this.buffer += chunk;
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';
        for (const line of lines) {
            if (!line.trim()) continue;
            try { this._handleMessage(JSON.parse(line)); } catch (error) { console.warn(`[ai-roles] IPC 响应解析失败: ${errorMessage(error)}`); }
        }
    }

    _handleMessage(message) {
        const request = this.pending.get(message.id);
        if (!request) return;
        if (message.event) {
            request.onEvent?.(message);
            return;
        }
        this.pending.delete(message.id);
        if (message.ok) request.resolve(message.result || {});
        else request.reject(new Error(message.error || 'Agent 后端请求失败'));
    }

    _handleDisconnect(socket, error) {
        if (this.socket === socket) this.socket = null;
        for (const [id, request] of this.pending) {
            request.reject(error);
            this.pending.delete(id);
        }
    }

    async _spawnHost() {
        if (this.spawnPromise) return this.spawnPromise;
        this.spawnPromise = (async () => {
            if (this.spawnHost) {
                await this.spawnHost();
                return;
            }
            fs.mkdirSync(path.dirname(this.socketPath), { recursive: true });
            const errorFile = path.join(path.dirname(this.socketPath), 'backend.err.log');
            const errorFd = fs.openSync(errorFile, 'a');
            const child = spawn(process.execPath, [this.hostPath, '--socket', this.socketPath, '--pid', this.pidFile], {
                detached: true,
                stdio: ['ignore', errorFd, errorFd]
            });
            fs.closeSync(errorFd);
            child.unref();
        })().finally(() => { this.spawnPromise = null; });
        return this.spawnPromise;
    }

    async ensureReady() {
        if (this.socket && !this.socket.destroyed) return;
        if (this.connectPromise) return this.connectPromise;
        this.connectPromise = (async () => {
            try {
                await this._connectOnce();
                return;
            } catch (error) {
                if (!isRetryableConnectionError(error)) throw error;
            }
            await this._spawnHost();
            const deadline = Date.now() + this.connectTimeoutMs;
            let lastError;
            while (Date.now() < deadline) {
                try {
                    await this._connectOnce();
                    return;
                } catch (error) {
                    lastError = error;
                    await new Promise((resolve) => setTimeout(resolve, 50));
                }
            }
            throw lastError || new Error('Agent 后端宿主启动超时');
        })().finally(() => { this.connectPromise = null; });
        return this.connectPromise;
    }

    async request(message, onEvent = null) {
        await this.ensureReady();
        const id = this.nextRequestId++;
        const promise = new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject, onEvent });
        });
        try {
            this.socket.write(`${JSON.stringify({ ...message, id })}\n`);
        } catch (error) {
            this.pending.delete(id);
            throw error;
        }
        return promise;
    }

    async close() {
        const socket = this.socket;
        this.socket = null;
        for (const [id, request] of this.pending) {
            request.reject(new Error('Agent 后端客户端已关闭'));
            this.pending.delete(id);
        }
        if (socket && !socket.destroyed) socket.destroy();
    }
}

module.exports = AgentBackendClient;
