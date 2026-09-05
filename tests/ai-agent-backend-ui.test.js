'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const chatFile = path.join(root, 'src/apps/web-mediacenter/ui/public/js/chat.js');
const chatCssFile = path.join(root, 'src/apps/web-mediacenter/ui/public/css/chat.css');
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
    assert.match(upload, /!r\.ok|response\.ok|res\.ok/u);
    assert.match(server, /onStatus/u);
});

test('Agent 请求进行中收到 roleList 只更新在线状态，不重建聊天 DOM', () => {
    const chat = fs.readFileSync(chatFile, 'utf8');
    const websocket = fs.readFileSync(path.join(root, 'src/apps/web-mediacenter/ui/public/js/websocket.js'), 'utf8');
    assert.match(chat, /updateRoleStatuses\s*\(\s*\)/u);
    assert.match(websocket, /Chat\.isLoading[\s\S]{0,180}updateRoleStatuses/u);
    assert.match(websocket, /Chat\.isLoading[\s\S]{0,180}Chat\.render\s*\(\s*\)/u);
});

test('聊天助手自动显示已保存角色，并通过加号打开 workgroup 成员选择窗口', () => {
    const chat = fs.readFileSync(chatFile, 'utf8');
    const upload = fs.readFileSync(uploadFile, 'utf8');
    const websocket = fs.readFileSync(path.join(root, 'src/apps/web-mediacenter/ui/public/js/websocket.js'), 'utf8');

    assert.match(chat, /roleCatalog/u);
    assert.match(chat, /showAddRoles*\(\)/u);
    assert.match(chat, /renderRoleCatalogs*\(\)/u);
    assert.doesNotMatch(chat, /addManualRole\s*\(/u);
    assert.match(upload, /chatRoleCatalogModal/u);
    assert.match(upload, /chatRoleCatalogList/u);
    assert.doesNotMatch(upload, /chatRoleNameInput|手动添加角色/u);
    assert.match(websocket, /data\.type === ['"]roleCatalog['"]/u);
});

test('工作 AI 角色选择弹窗使用控制端主题颜色', () => {
    const chatCss = fs.readFileSync(chatCssFile, 'utf8');

    assert.match(chatCss, /\.chat-modal-content\s*\{[\s\S]{0,220}background:\s*var\(--bg-surface-strong(?:,\s*[^)]*)?\)/u);
    assert.match(chatCss, /\.chat-modal-header h3\s*\{[\s\S]{0,180}color:\s*var\(--text-primary(?:,\s*[^)]*)?\)/u);
    assert.match(chatCss, /\.chat-role-catalog-item\s*\{[\s\S]{0,220}background:\s*var\(--bg-surface(?:,\s*[^)]*)?\)/u);
    assert.match(chatCss, /\.chat-role-catalog-name\s*\{[\s\S]{0,180}color:\s*var\(--text-primary(?:,\s*[^)]*)?\)/u);
    assert.match(chatCss, /\.chat-role-catalog-meta,[\s\S]{0,80}\.chat-role-catalog-empty\s*\{[\s\S]{0,160}color:\s*var\(--text-secondary(?:,\s*[^)]*)?\)/u);
    assert.match(chatCss, /\.chat-role-catalog-action\s*\{[\s\S]{0,220}var\(--accent-secondary(?:,\s*[^)]*)?\)[\s\S]{0,80}var\(--accent-color(?:,\s*[^)]*)?\)/u);
    assert.match(chatCss, /\.chat-role-catalog-action:disabled\s*\{[\s\S]{0,180}background:\s*var\(--bg-surface-strong(?:,\s*[^)]*)?\)[\s\S]{0,120}color:\s*var\(--text-secondary(?:,\s*[^)]*)?\)/u);
});

test('聊天群聊页签应能退出私聊和工作组模式', () => {
    const chat = fs.readFileSync(chatFile, 'utf8');

    assert.match(
        chat,
        /data-chat-tab=["']group["'][\s\S]{0,500}addEventListener\(['"]click['"][\s\S]{0,180}setMode\(['"]group['"],\s*null\)/u,
        '群聊页签应绑定回到群聊的点击事件'
    );
    assert.match(chat, /退出私聊/u);
    assert.match(chat, /退出工作组/u);
});

test('Agent 流式回复和 TTS 沿用 LLM 的 chunk、句子队列和完成冲刷链路', () => {
    const server = fs.readFileSync(serverFile, 'utf8');
    assert.match(server, /createAgentTtsStream/u);
    assert.match(server, /agentTtsStream\.onChunk\(chunk\)/u);
    assert.match(server, /void agentTtsStream\.onComplete\(message\)/u);
});

test('服务器 TTS 下发支持按调用方选择是否检查显示端睡眠', () => {
    const server = fs.readFileSync(serverFile, 'utf8');
    const timeAnnounce = fs.readFileSync(
        path.join(root, 'src/apps/server/modules/task-engine/builtin-tasks/time-announce.js'),
        'utf8'
    );
    assert.match(server, /sendToDisplay\(displayId, data, options\s*=\s*\{\s*\}\)/u);
    assert.match(server, /shouldSkipDisplayTts\(displayData, options\)/u);
    assert.match(timeAnnounce, /broadcastToDisplays\(announceData,\s*\{\s*checkSleep:\s*true\s*\}\)/u);
});
