#!/usr/bin/env node
const WebSocket = require('ws');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
function option(name) {
    const prefix = `--${name}=`;
    return args.find(value => value.startsWith(prefix))?.slice(prefix.length) || null;
}

const requestedDisplayId = option('display-id');
const size = Number(option('size') || 15);
const duration = Number(option('duration') || 0);
const delayMs = Number(option('delay-ms') || 900);
const resultPauseMs = Number(option('result-pause-ms') || 2000);
const winner = option('winner') || 'both';
const localCert = path.resolve(__dirname, '../../res/certs/cert.pem');
const defaultScheme = fs.existsSync(localCert) ? 'wss' : 'ws';
const url = process.env.AASC_GOMOKU_SERVER_URL || `${defaultScheme}://127.0.0.1:8081/control`;
const parsedUrl = new URL(url);
if (![9, 15].includes(size)) throw new Error('演示仅支持 9 或 15 路棋盘');
if (!Number.isSafeInteger(duration) || duration < 0) throw new Error('--duration 必须是非负毫秒数');
if (!Number.isSafeInteger(delayMs) || delayMs < 100 || delayMs > 10000) {
    throw new Error('--delay-ms 必须是 100～10000 毫秒');
}
if (!Number.isSafeInteger(resultPauseMs) || resultPauseMs < 500 || resultPauseMs > 30000) {
    throw new Error('--result-pause-ms 必须是 500～30000 毫秒');
}
if (!['both', 'user', 'ai'].includes(winner)) throw new Error('--winner 必须是 both、user 或 ai');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsedUrl.hostname)) {
    throw new Error('演示仅允许连接本机服务');
}

const socket = new WebSocket(url, { handshakeTimeout: 8000,
    rejectUnauthorized: parsedUrl.protocol === 'wss:' ? false : undefined });
let displayId = null;
let started = false;
let stopping = false;
let timeout = setTimeout(() => fail('等待服务端响应超时；请确认服务已更新并运行'), 10000);

function fail(message) {
    clearTimeout(timeout);
    console.error(`[Game Demo] ${message}`);
    process.exitCode = 1;
    socket.close();
}

function stop() {
    if (stopping) return;
    stopping = true;
    clearTimeout(timeout);
    if (socket.readyState === WebSocket.OPEN && started) {
        socket.send(JSON.stringify({ type: 'gameDemoStop', displayId }));
        timeout = setTimeout(() => socket.close(), 3000);
    } else socket.close();
}

socket.on('message', raw => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch (_) { return; }
    if (message.type === 'displayList' && !displayId && !stopping) {
        const online = (message.list || []).filter(item => item && typeof item.id === 'string');
        const displays = online.filter(item => item.isSubDisplay !== true);
        if (requestedDisplayId) {
            displayId = online.find(item => item.id === requestedDisplayId)?.id || null;
            if (!displayId) {
                fail(`目标显示端不在线：${requestedDisplayId}`);
                return;
            }
        } else if (displays.length === 1) {
            displayId = displays[0].id;
        } else {
            fail(displays.length ? `有多个在线显示端，请加 --display-id=ID：${displays.map(item => item.id).join(', ')}`
                : '没有在线主显示端');
            return;
        }
        socket.send(JSON.stringify({ type: 'gameDemoStart', displayId, size,
            delayMs, resultPauseMs, winner }));
        return;
    }
    if (message.type !== 'gameDemoResult' || message.displayId !== displayId) return;
    if (message.action === 'gameDemoStart') {
        if (!message.ok) { fail(message.code || '启动演示失败'); return; }
        started = true;
        clearTimeout(timeout);
        process.stdout.write(`已在当前显示端 ${displayId} 演示 ${size} 路五子棋：${winner === 'both' ? '用户胜、AI 胜各一局' : winner === 'user' ? '用户胜' : 'AI 胜'}；每步间隔 ${delayMs} 毫秒。\n按 Ctrl+C 结束并恢复原棋盘。\n`);
        if (duration) timeout = setTimeout(stop, duration);
    }
    if (message.action === 'gameDemoStop') {
        clearTimeout(timeout);
        if (!message.ok) console.error(`[Game Demo] 恢复失败：${message.code}`);
        else process.stdout.write('演示结束，已恢复原棋盘。\n');
        socket.close();
    }
});

socket.on('error', error => fail(`连接失败：${error.message}`));
socket.on('close', () => {
    clearTimeout(timeout);
    if (!started && !process.exitCode) process.exitCode = 1;
});
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
