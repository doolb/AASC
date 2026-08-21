'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const chatFile = path.join(root, 'src/apps/web-mediacenter/ui/public/js/chat.js');
const uploadFile = path.join(root, 'src/apps/web-mediacenter/ui/public/upload.html');
const serverFile = path.join(root, 'src/apps/server/boot/server-app.js');

test('控制端聊天设置提供 Agent 后端选择并默认 Codex', () => {
    const chat = fs.readFileSync(chatFile, 'utf8');
    const upload = fs.readFileSync(uploadFile, 'utf8');
    assert.match(chat, /agentBackend:\s*'codex'/u);
    assert.match(chat, /assistantType:\s*mode\s*===\s*'role'\s*\?\s*'agent'\s*:\s*'llm'/u);
    assert.match(upload, /id="chatAgentBackend"/u);
    assert.match(upload, /value="codex"/u);
    assert.match(upload, /value="claude"/u);
});

test('系统设置提供关闭所有 Agent 按钮，角色列表显示在线状态', () => {
    const chat = fs.readFileSync(chatFile, 'utf8');
    const upload = fs.readFileSync(uploadFile, 'utf8');
    const server = fs.readFileSync(serverFile, 'utf8');
    assert.match(upload, /关闭所有 Agent/u);
    assert.match(upload, /stopAllAgents/u);
    assert.match(chat, /running/u);
    assert.match(chat, /在线|离线/u);
    assert.match(server, /api\/ai-roles\/stop-all/u);
    assert.match(server, /aiRoles\.stopAll\(\)/u);
});
