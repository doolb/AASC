#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { createGameChatSession } = require('../../src/apps/server/modules/game/game-chat-session');

const stateOption = process.argv.find(value => value.startsWith('--state-file='));
const displayOption = process.argv.find(value => value.startsWith('--display-id='));
const temporaryDirectory = stateOption ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-game-chat-'));
const filePath = stateOption ? path.resolve(stateOption.slice('--state-file='.length))
    : path.join(temporaryDirectory, 'gomoku.json');
const displayId = displayOption?.slice('--display-id='.length) || 'demo-display';
const write = value => process.stdout.write(`${JSON.stringify(value)}\n`);
let pendingReply = null;
let activeTurn = false;

/** 每次模型请求都暂停，等待外部 AI 在下一条 JSON 行返回同一序号的原文。 */
const session = createGameChatSession({ filePath, displayId,
    onEvent: write,
    onModelRequest: request => new Promise((resolve, reject) => {
        pendingReply = { sequence: request.sequence, resolve, reject };
    })
});
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

input.on('line', line => {
    let message;
    try {
        message = JSON.parse(line);
    } catch (error) {
        write({ type: 'error', error: `JSON 行无效：${error.message}` });
        return;
    }
    if (!message || typeof message !== 'object') {
        write({ type: 'error', error: '消息必须是 JSON 对象' });
        return;
    }
    if (message.type === 'modelReply') {
        if (!pendingReply || message.sequence !== pendingReply.sequence) {
            write({ type: 'error', error: 'modelReply 序号与当前模型请求不匹配' });
            return;
        }
        if (typeof message.message !== 'string') {
            write({ type: 'error', error: 'modelReply.message 必须是字符串' });
            return;
        }
        const { resolve } = pendingReply;
        pendingReply = null;
        resolve({ message: message.message, reasoning: message.reasoning, speech: message.speech });
        return;
    }
    if (message.type === 'user') {
        if (activeTurn) {
            write({ type: 'error', error: '上一轮聊天尚未完成' });
            return;
        }
        activeTurn = true;
        session.sendUser(message.content, message.options || {})
            .then(({ result, snapshot }) => write({ type: 'chatResult', result, snapshot }))
            .catch(error => write({ type: 'error', error: error.message }))
            .finally(() => { activeTurn = false; });
        return;
    }
    if (message.type === 'snapshot') {
        write({ type: 'snapshot', snapshot: session.snapshot() });
        return;
    }
    write({ type: 'error', error: '未知消息类型' });
});

input.on('close', () => {
    if (pendingReply) pendingReply.reject(new Error('输入已关闭，目标 AI 未返回回复'));
});
if (temporaryDirectory) {
    process.on('exit', () => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
}
write({ type: 'ready', displayId, stateFile: stateOption ? filePath : null });
