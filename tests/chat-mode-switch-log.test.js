'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const chat = require('../src/external/llm/llm-service');

const serverSource = fs.readFileSync(
    path.resolve(__dirname, '../src/apps/server/boot/server-app.js'),
    'utf8'
);
const controlChatSource = fs.readFileSync(
    path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/chat.js'),
    'utf8'
);
const controlWebSocketSource = fs.readFileSync(
    path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/websocket.js'),
    'utf8'
);

function captureChatLogs(callback) {
    const originalLog = console.log;
    const messages = [];
    console.log = (...args) => messages.push(args.join(' '));
    try {
        callback(messages);
    } finally {
        console.log = originalLog;
    }
    return messages;
}

test('实际切换聊天模式时打印来源、目标和显示端', () => {
    const originalSession = chat.getSession();
    let messages = [];

    try {
        messages = captureChatLogs((logs) => {
            chat.setSession({
                ...originalSession,
                mode: 'group',
                privateTarget: null,
                privateSessionId: 'default'
            }, { source: 'testSetup' });
            logs.length = 0;
            chat.setMode('private', '小爱', {
                source: 'controlManual',
                displayId: 'display-test'
            });
        });
    } finally {
        captureChatLogs(() => chat.setSession(originalSession, { source: 'testRestore' }));
    }

    const modeLogs = messages.filter(message => message.includes('[Chat] 模式切换'));
    assert.equal(modeLogs.length, 1);
    assert.match(modeLogs[0], /group.*private/u);
    assert.match(modeLogs[0], /target=小爱/u);
    assert.match(modeLogs[0], /source=controlManual/u);
    assert.match(modeLogs[0], /displayId=display-test/u);
});

test('重复同步相同聊天模式时不打印模式切换日志', () => {
    const originalSession = chat.getSession();
    let messages = [];

    try {
        messages = captureChatLogs((logs) => {
            chat.setSession({
                ...originalSession,
                mode: 'private',
                privateTarget: '小爱',
                privateSessionId: 'default'
            }, { source: 'testSetup' });
            logs.length = 0;
            chat.setSession({
                ...chat.getSession(),
                mode: 'private',
                privateTarget: '小爱',
                privateSessionId: 'default'
            }, { source: 'serverSync' });
        });
    } finally {
        captureChatLogs(() => chat.setSession(originalSession, { source: 'testRestore' }));
    }

    assert.equal(messages.filter(message => message.includes('[Chat] 模式切换')).length, 0);
});

test('控制端和显示端切换都携带可追踪来源', () => {
    assert.match(controlChatSource, /setMode\(mode, target = null, source = ['"]controlManual['"]\)/u);
    assert.match(controlChatSource, /saveSession\(source = ['"]controlManual['"]\)/u);
    assert.match(controlChatSource, /source,\s*displayId:/u);
    assert.match(controlChatSource, /setMode\(['"]private['"], name, ['"]controlVoice['"]\)/u);
    assert.match(controlChatSource, /setMode\(['"]group['"], null, ['"]controlCommand['"]\)/u);
    assert.match(controlWebSocketSource, /setMode\(['"]private['"], data\.target, data\.source \|\| ['"]serverSync['"]\)/u);
    assert.match(controlWebSocketSource, /setMode\(['"]group['"], null, data\.source \|\| ['"]serverSync['"]\)/u);
    assert.match(serverSource, /chat\.setMode\(['"]private['"], result\.event\.target, \{\s*source: ['"]displayVoice['"],\s*displayId\s*\}/u);
    assert.match(serverSource, /chat\.setSession\(data\.session, \{\s*source: data\.source/u);
});
