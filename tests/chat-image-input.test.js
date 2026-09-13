'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CHAT = path.join(ROOT, 'src/apps/web-mediacenter/ui/public/js/chat.js');
const SERVER = path.join(ROOT, 'src/apps/server/boot/server-app.js');
const LLM = path.join(ROOT, 'src/external/llm/llm-service.js');

test('聊天界面支持图片选择、预览、移除和发送附件', () => {
    const chat = fs.readFileSync(CHAT, 'utf8');

    assert.match(chat, /accept=["']image\/\*["']/);
    assert.match(chat, /pendingImages/);
    assert.match(chat, /attachImage/);
    assert.match(chat, /removeImage/);
    assert.match(chat, /images\s*:/);
});

test('服务端校验聊天图片并传入 LLM', () => {
    const server = fs.readFileSync(SERVER, 'utf8');
    const llm = fs.readFileSync(LLM, 'utf8');

    assert.match(server, /normalizeChatImages|validateChatImages/);
    assert.match(server, /images\s*:/);
    assert.match(llm, /image_url/);
    assert.match(llm, /options\.images|images\s*=\s*\[\]/);
});
