'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER_FILE = path.resolve(__dirname, '../src/apps/server/boot/server-app.js');

test('Pi Runtime 默认屏蔽服务器 Pi 详细分类日志', () => {
    const source = fs.readFileSync(SERVER_FILE, 'utf8');
    assert.doesNotMatch(source, /new PiRuntimeManager\(\{[\s\S]{0,180}logger:\s*\(message, details\)/u);
});

test('控制端聊天输入日志包含 content 和 requestId', () => {
    const source = fs.readFileSync(SERVER_FILE, 'utf8');
    const start = source.indexOf("if (data.type !== 'clientLog' && data.type !== 'setLogReport'");
    const end = source.indexOf('\n                }', start);
    assert.ok(start >= 0 && end > start, '应能定位控制端入站日志');
    const handler = source.slice(start, end);
    assert.match(handler, /data\.content/u);
    assert.match(handler, /data\.requestId/u);
});

test('控制端 chatResponse 日志包含 requestId 和成功状态', () => {
    const source = fs.readFileSync(SERVER_FILE, 'utf8');
    const start = source.indexOf('async function handleChatMessage(options)');
    const end = source.indexOf('\nconst deviceEventDebounce', start);
    assert.ok(start >= 0 && end > start, '应能定位普通聊天处理函数');
    const handler = source.slice(start, end);
    assert.match(handler, />> chatResponse requestId=/u);
    assert.match(handler, /success=\$\{payload\.success\}/u);
    assert.match(handler, /sendChatResponse\(\{/u);
});
