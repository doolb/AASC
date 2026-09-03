'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER_FILE = path.resolve(__dirname, '../src/apps/server/boot/server-app.js');
const CHAT_FILE = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/chat.js');
const SERVICE_FILE = path.resolve(__dirname, '../src/external/llm/llm-service.js');

test('服务端提供删除单轮对话接口', () => {
    const source = fs.readFileSync(SERVER_FILE, 'utf8');
    assert.match(source, /chat\.deleteConversationRound\(req\.body\s*\|\|\s*\{\}\)/u);
    assert.match(source, /app\.post\('\/api\/chat\/round'/u);
});

test('聊天服务按消息 ID 删除单轮并重置 Pi 会话', () => {
    const source = fs.readFileSync(SERVICE_FILE, 'utf8');
    assert.match(source, /function deleteConversationRound\(options = \{\}\)/u);
    assert.match(source, /const runtimeManager = profile\.backend === 'codex' \? codexRuntimeManager : piRuntimeManager/u);
    assert.match(source, /runtimeManager\?\.resetSession/u);
    assert.match(source, /runtimeManager\.resetSession/u);
    assert.match(source, /String\(message\.id\s*\|\|\s*''\) === String\(messageId\)/u);
});

test('用户消息气泡提供删除本轮操作', () => {
    const source = fs.readFileSync(CHAT_FILE, 'utf8');
    assert.match(source, /deleteConversationRound\('\$\{this\.escapeHtml\(String\(item\.id\)\)\}'\)/u);
    assert.match(source, /删除本轮/u);
});
