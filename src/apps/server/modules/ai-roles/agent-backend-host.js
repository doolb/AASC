'use strict';

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const ClaudeBridge = require('./claude-bridge');
const CodexBridge = require('./codex-bridge');
const { USER_CONFIG_DIR } = require('../config/user-config-paths');

const DEFAULT_SOCKET_PATH = path.join(USER_CONFIG_DIR, 'ai-roles', 'backend.sock');

function readPid(pidFile) {
    try {
        const pid = Number.parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
        return Number.isInteger(pid) && pid > 0 ? pid : null;
    } catch (_) {
        return null;
    }
}

function isProcessAlive(pid) {
    if (!pid) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (_) {
        return false;
    }
}

function ensureParentDir(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
}

function removeFile(file) {
    try { fs.rmSync(file, { force: true }); } catch (_) { /* 清理失败不阻断宿主退出 */ }
}

function createDefaultBridge(options) {
    if (options.backend === 'codex') {
        return new CodexBridge({
            dir: options.dir,
            name: options.name,
            commandPath: options.codexCommandPath || 'codex',
            commandArgs: options.codexCommandArgs || ['app-server', '--stdio'],
            cwd: options.cwd,
            env: options.env,
            proxy: options.proxy,
            readTimeoutMs: options.readTimeoutMs
        });
    }
    return new ClaudeBridge({
        dir: options.dir,
        name: options.name,
        command: options.command,
        commandPath: options.commandPath,
        commandArgs: options.commandArgs,
        cwd: options.cwd,
        keeperPath: options.keeperPath,
        promptFile: options.promptFile,
        readTimeoutMs: options.readTimeoutMs
    });
}

function normalizeError(error) {
    return error instanceof Error ? error.message : String(error || 'Agent 后端请求失败');
}

function startAgentBackendHost({
    socketPath = DEFAULT_SOCKET_PATH,
    pidFile = path.join(path.dirname(socketPath), 'backend.pid'),
    bridgeFactory = null
} = {}) {
    ensureParentDir(socketPath);
    const lockFile = `${socketPath}.lock`;
    const existingPid = readPid(pidFile);
    if (existingPid && isProcessAlive(existingPid)) {
        const error = new Error('Agent 后端宿主已运行');
        error.code = 'EADDRINUSE';
        throw error;
    }
    removeFile(lockFile);
    removeFile(socketPath);
    fs.writeFileSync(lockFile, String(process.pid), { mode: 0o600 });
    fs.writeFileSync(pidFile, String(process.pid), { mode: 0o600 });

    const bridges = new Map();
    const createBridge = bridgeFactory || createDefaultBridge;

    function getBridge(options) {
        const existing = bridges.get(options.name);
        if (existing && existing.backend === options.backend) return existing;
        if (existing) {
            try { existing.stop(); } catch (_) { /* 后端切换时旧 bridge 失败不阻断新 bridge */ }
            bridges.delete(options.name);
        }
        const bridge = createBridge(options);
        bridge.backend = bridge.backend || options.backend;
        bridges.set(options.name, bridge);
        return bridge;
    }

    function send(socket, message) {
        if (socket.destroyed) return;
        try { socket.write(`${JSON.stringify(message)}\n`); } catch (_) { /* 服务器重启时连接可能已关闭 */ }
    }

    async function dispatch(socket, request) {
        const { id, op, role, options = {} } = request;
        const bridgeOptions = { ...options, name: role || options.name };
        try {
            if (!role || !op) throw new Error('Agent 后端请求缺少 role 或 op');
            if (op === 'status') {
                const bridge = getBridge(bridgeOptions);
                const running = typeof bridge.reconnect === 'function'
                    ? await bridge.reconnect()
                    : bridge.isAlive();
                send(socket, { id, ok: true, result: { running: !!running, backend: bridge.backend } });
                return;
            }
            if (op === 'ensureStarted') {
                const bridge = getBridge(bridgeOptions);
                if (bridgeOptions.prompt && typeof bridge.setPrompt === 'function') bridge.setPrompt(bridgeOptions.prompt);
                if (bridgeOptions.promptFile) bridge.promptFile = bridgeOptions.promptFile;
                await bridge.ensureStarted();
                send(socket, { id, ok: true, result: { running: bridge.isAlive(), backend: bridge.backend } });
                return;
            }
            if (op === 'chat') {
                const bridge = getBridge(bridgeOptions);
                if (bridgeOptions.prompt && typeof bridge.setPrompt === 'function') bridge.setPrompt(bridgeOptions.prompt);
                if (bridgeOptions.promptFile) bridge.promptFile = bridgeOptions.promptFile;
                const result = await bridge.chat(request.content, {
                    onChunk: (chunk, message) => send(socket, { id, event: 'chunk', payload: { chunk, message } }),
                    onComplete: (message) => send(socket, { id, event: 'complete', payload: { message } }),
                    onError: (error) => send(socket, { id, event: 'error', payload: { error: normalizeError(error) } })
                });
                send(socket, { id, ok: true, result: { ...result, running: bridge.isAlive(), backend: bridge.backend } });
                return;
            }
            if (op === 'stopRole') {
                const bridge = bridges.get(role);
                if (bridge) {
                    bridge.stop();
                    bridges.delete(role);
                }
                send(socket, { id, ok: true, result: { running: false, backend: bridge?.backend || bridgeOptions.backend } });
                return;
            }
            if (op === 'stopAll') {
                let stopped = 0;
                for (const [name, bridge] of bridges) {
                    if (bridge.isAlive()) stopped += 1;
                    try { bridge.stop(); } catch (error) { console.warn(`[agent-backend] 停止 ${name} 失败: ${normalizeError(error)}`); }
                }
                bridges.clear();
                send(socket, { id, ok: true, result: { stopped } });
                return;
            }
            throw new Error(`未知 Agent 后端操作: ${op}`);
        } catch (error) {
            send(socket, { id, ok: false, error: normalizeError(error) });
        }
    }

    const clients = new Set();
    const server = net.createServer((socket) => {
        clients.add(socket);
        socket.once('close', () => clients.delete(socket));
        socket.setEncoding('utf8');
        let buffer = '';
        socket.on('data', (chunk) => {
            buffer += chunk;
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const request = JSON.parse(line);
                    void dispatch(socket, request);
                } catch (error) {
                    send(socket, { id: null, ok: false, error: normalizeError(error) });
                }
            }
        });
    });

    const ready = new Promise((resolve, reject) => {
        server.once('listening', () => {
            try { fs.chmodSync(socketPath, 0o600); } catch (_) { /* 权限调整失败不阻断已建立的本地 Socket */ }
            resolve();
        });
        server.once('error', reject);
    });
    server.listen(socketPath);

    const close = async () => {
        for (const bridge of bridges.values()) {
            try { bridge.stop(); } catch (_) { /* 测试或宿主关闭不阻断资源清理 */ }
        }
        bridges.clear();
        for (const socket of clients) socket.destroy();
        clients.clear();
        await new Promise((resolve) => {
            if (!server.listening) return resolve();
            server.close(resolve);
        });
        removeFile(socketPath);
        removeFile(pidFile);
        removeFile(lockFile);
    };

    return { server, ready, close, bridges };
}

function parseArg(name, fallback = '') {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

if (require.main === module) {
    const socketPath = parseArg('--socket', DEFAULT_SOCKET_PATH);
    const pidFile = parseArg('--pid', path.join(path.dirname(socketPath), 'backend.pid'));
    try {
        const host = startAgentBackendHost({ socketPath, pidFile });
        host.ready.catch((error) => {
            console.error(`[agent-backend] 启动失败: ${normalizeError(error)}`);
            process.exitCode = 1;
        });
        process.on('SIGTERM', () => { void host.close().finally(() => process.exit(0)); });
        process.on('SIGINT', () => { void host.close().finally(() => process.exit(0)); });
    } catch (error) {
        if (error.code !== 'EADDRINUSE') console.error(`[agent-backend] 启动失败: ${normalizeError(error)}`);
        process.exitCode = error.code === 'EADDRINUSE' ? 0 : 1;
    }
}

module.exports = { startAgentBackendHost };
