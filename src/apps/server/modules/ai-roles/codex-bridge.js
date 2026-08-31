'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn: defaultSpawn } = require('node:child_process');

const DEFAULT_PROXY = 'http://127.0.0.1:7899';
// Codex 可能执行较长的代码任务；超时按“连续无活动”计算，而不是整轮固定时长。
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

// Codex app-server 的 stdio JSON-RPC 桥。
// 每个角色只创建一个桥实例，桥实例内部只启动一个 app-server，
// 后续消息继续使用同一个 threadId，从而保留 Agent 的上下文。
class CodexBridge {
    constructor({
        dir,
        name,
        commandPath = 'codex',
        commandArgs = ['app-server', '--stdio'],
        cwd = process.cwd(),
        env = {},
        proxy = DEFAULT_PROXY,
        readTimeoutMs = DEFAULT_TIMEOUT_MS,
        spawn = defaultSpawn,
        approvalPolicy = 'never',
        sandboxPolicy = { type: 'dangerFullAccess' }
    } = {}) {
        this.dir = dir;
        this.name = name;
        this.commandPath = commandPath;
        this.commandArgs = commandArgs.length ? [...commandArgs] : ['app-server', '--stdio'];
        this.cwd = cwd;
        this.env = { ...env };
        this.proxy = proxy;
        this.readTimeoutMs = readTimeoutMs;
        this.spawn = spawn;
        this.approvalPolicy = approvalPolicy;
        this.sandboxPolicy = sandboxPolicy;
        this.child = null;
        this.threadId = null;
        this.nextRequestId = 1;
        this.pending = new Map();
        this.buffer = '';
        this.activeTurn = null;
        this.startPromise = null;
        this.pidFile = path.join(dir, 'codex.pid');
        this.errorFile = path.join(dir, 'codex.err.log');
        this.systemPrompt = '';
    }

    isAlive() {
        return !!this.child && this.child.exitCode === null && !this.child.killed;
    }

    _ensureDir() {
        fs.mkdirSync(this.dir, { recursive: true });
    }

    setPrompt(prompt) {
        this.systemPrompt = String(prompt || '');
    }

    _send(message) {
        if (!this.isAlive() || !this.child.stdin.writable) throw new Error('Codex app-server 未运行');
        this.child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    _request(method, params) {
        const id = this.nextRequestId++;
        const promise = new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
        });
        try {
            this._send({ jsonrpc: '2.0', id, method, params });
        } catch (error) {
            this.pending.delete(id);
            throw error;
        }
        return promise;
    }

    _notify(method, params) {
        this._send({ jsonrpc: '2.0', method, params });
    }

    _handleLine(line) {
        let message;
        try { message = JSON.parse(line); } catch (_) { return; }

        if (message.id !== undefined && message.id !== null) {
            const request = this.pending.get(message.id);
            if (!request) return;
            this.pending.delete(message.id);
            if (message.error) request.reject(new Error(this._formatRpcError(message.error)));
            else request.resolve(message.result || {});
            return;
        }

        const params = message.params || {};
        if (message.method === 'item/agentMessage/delta' && this.activeTurn) {
            this._resetTurnTimeout();
            const delta = typeof params.delta === 'string' ? params.delta : '';
            if (!delta) return;
            this.activeTurn.message += delta;
            if (this.activeTurn.callbacks.onChunk) {
                this.activeTurn.callbacks.onChunk(delta, this.activeTurn.message);
            }
            return;
        }

        if (message.method === 'turn/completed' && this.activeTurn) {
            this._finishTurn(params.turn && params.turn.status === 'completed' ? null : new Error('Codex turn 未完成'));
        }
    }

    _formatRpcError(error) {
        if (typeof error === 'string') return error;
        if (error && error.message) return error.message;
        return 'Codex app-server 请求失败';
    }

    _rejectPending(error) {
        for (const request of this.pending.values()) request.reject(error);
        this.pending.clear();
    }

    _finishTurn(error) {
        const turn = this.activeTurn;
        if (!turn) return;
        this.activeTurn = null;
        clearTimeout(turn.timer);
        if (error) {
            if (turn.callbacks.onError) turn.callbacks.onError(error);
            turn.reject(error);
            return;
        }
        if (turn.callbacks.onComplete) turn.callbacks.onComplete(turn.message);
        turn.resolve({ success: true, message: turn.message });
    }

    // 只要 Agent 仍在持续输出，就延长当前轮次的等待时间；真正连续无活动才判定超时。
    _resetTurnTimeout() {
        if (!this.activeTurn) return;
        if (this.activeTurn.timer) clearTimeout(this.activeTurn.timer);
        this.activeTurn.timer = setTimeout(() => {
            this._finishTurn(new Error(`Codex 响应超时（${this.readTimeoutMs}ms 无活动）`));
            this.stop();
        }, this.readTimeoutMs);
    }

    _handleExit(error) {
        const failure = error || new Error('Codex app-server 已退出');
        this._rejectPending(failure);
        this._finishTurn(failure);
        this.child = null;
        this.threadId = null;
        this.startPromise = null;
    }

    _attachChild(child) {
        this.child = child;
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            this.buffer += chunk;
            const lines = this.buffer.split('\n');
            this.buffer = lines.pop() || '';
            for (const line of lines) if (line.trim()) this._handleLine(line.trim());
        });
        child.stderr.on('data', (chunk) => {
            this._ensureDir();
            fs.appendFileSync(this.errorFile, chunk);
        });
        child.on('error', (error) => this._handleExit(error));
        child.on('close', (code, signal) => {
            if (this.child === child) this._handleExit(new Error(`Codex app-server 已退出 (${code || signal || '未知'})`));
        });
    }

    async _start() {
        this._ensureDir();
        const childEnv = {
            ...process.env,
            ...this.env,
            HTTPS_PROXY: this.proxy
        };
        const child = this.spawn(this.commandPath, this.commandArgs, {
            cwd: this.cwd,
            env: childEnv,
            stdio: ['pipe', 'pipe', 'pipe'],
            // stdio transport需要由当前服务器持有输入输出句柄；服务器退出时让该会话自然结束，
            // 避免留下无法重新接管的孤儿 app-server 进程。
            detached: false
        });
        this._attachChild(child);
        fs.writeFileSync(this.pidFile, String(child.pid));

        await this._request('initialize', {
            clientInfo: { name: 'aasc-control-agent', version: '1.0.0' }
        });
        this._notify('initialized', {});
        const result = await this._request('thread/start', {
            cwd: this.cwd,
            approvalPolicy: this.approvalPolicy,
            sandboxPolicy: this.sandboxPolicy,
            developerInstructions: this.systemPrompt || null
        });
        this.threadId = result.thread?.id || result.threadId || result.id;
        if (!this.threadId) throw new Error('Codex app-server 未返回 threadId');
    }

    async ensureStarted() {
        if (this.isAlive() && this.threadId) return;
        if (this.startPromise) return this.startPromise;
        this.startPromise = this._start().catch((error) => {
            this._handleExit(error);
            throw error;
        }).finally(() => {
            this.startPromise = null;
        });
        return this.startPromise;
    }

    async chat(content, callbacks = {}) {
        await this.ensureStarted();
        if (this.activeTurn) throw new Error('Codex 角色仍在处理上一条消息');
        const active = {
            callbacks,
            message: '',
            timer: null,
            resolve: null,
            reject: null
        };
        const result = new Promise((resolve, reject) => {
            active.resolve = resolve;
            active.reject = reject;
        });
        this.activeTurn = active;
        this._resetTurnTimeout();
        try {
            await this._request('turn/start', {
                threadId: this.threadId,
                input: [{ type: 'text', text: String(content) }],
                approvalPolicy: this.approvalPolicy,
                sandboxPolicy: this.sandboxPolicy
            });
        } catch (error) {
            this._finishTurn(error);
            this.stop();
        }
        return result;
    }

    reconnect() {
        // stdio transport的输入输出句柄不能跨父进程重新接管；服务重启后由下一条消息重建。
        return this.isAlive() && !!this.threadId;
    }

    stop() {
        const child = this.child;
        this._handleExit(new Error('Codex app-server 已停止'));
        if (child && child.exitCode === null) {
            try { child.kill('SIGTERM'); } catch (_) { /* 进程已退出 */ }
        }
        try { fs.rmSync(this.pidFile, { force: true }); } catch (_) { /* 清理失败不阻断退出 */ }
    }
}

module.exports = CodexBridge;
