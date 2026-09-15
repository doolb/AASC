'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const chatSource = fs.readFileSync(
    path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/chat.js'),
    'utf8'
);

test('私聊清空请求带上当前 sessionId 并校验助手已就绪', () => {
    assert.match(chatSource, /const sessionId = String\(this\.session\.privateSessionId \|\| 'default'\)/u);
    assert.match(chatSource, /mode === 'private' && !target/u);
    assert.match(chatSource, /当前私聊助手未就绪/u);
});

test('私聊清空接口的 HTTP 或业务错误必须显示失败原因', () => {
    assert.match(chatSource, /!response\.ok \|\| data\.status !== 'success'/u);
    assert.match(chatSource, /data\.message \|\| data\.error \|\| `清空失败/u);
});

test('群聊清空请求不携带私聊 sessionId', () => {
    assert.match(chatSource, /const clearRequest = \{ mode, target: target \|\| null \}/u);
    assert.match(chatSource, /if \(mode === 'private'\) clearRequest\.sessionId = sessionId/u);
    assert.match(chatSource, /body: JSON\.stringify\(clearRequest\)/u);
});
