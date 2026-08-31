'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const uploadHtmlFile = path.join(__dirname, '../src/apps/web-mediacenter/ui/public/upload.html');
const chatJsFile = path.join(__dirname, '../src/apps/web-mediacenter/ui/public/js/chat.js');
const html = fs.readFileSync(uploadHtmlFile, 'utf8');
const chatSource = fs.readFileSync(chatJsFile, 'utf8');

function loadChatForRoutingTest(routing, profile) {
    const sandbox = {
        window: { Settings: { routing } },
        document: {},
        console,
        setTimeout,
        clearTimeout
    };
    vm.runInNewContext(chatSource, sandbox, { filename: chatJsFile });
    sandbox.window.Chat.profiles = [profile];
    sandbox.window.Chat.activeProfile = profile.name;
    return sandbox.window.Chat;
}

test('profile 编辑器提供 llm/agent 模式', () => {
    assert.match(html, /id="profileEditMode"/u);
    assert.match(html, /value="agent"/u);
    assert.match(chatSource, /mode\s*:/u);
    assert.match(chatSource, /profileEditBackend/u);
});

test('Agent profile 编辑器提供 Pi/Codex 后端选择并按 profile 展示', () => {
    assert.match(html, /id="profileEditBackend"/u);
    assert.match(html, /value="pi"/u);
    assert.match(html, /value="codex"/u);
    assert.match(chatSource, /profileEditBackend/u);
    assert.match(chatSource, /backend\s*===\s*['"]codex['"]/u);
    assert.match(chatSource, /const backend = document\.getElementById\(['"]profileEditBackend['"]\)/u);
    assert.match(chatSource, /if \(mode === ['"]agent['"]\) profile\.backend = backend/u);
});

test('模板编辑器提供 readonly 权限并保存 permissionProfile', () => {
    assert.match(html, /id="templatePermissionProfile"/u);
    assert.match(html, /value="readonly"/u);
    assert.match(chatSource, /permissionProfile\s*:/u);
});

test('llm 路由下 Pi Agent 跳过天气和搜索旧处理器', () => {
    const chat = loadChatForRoutingTest(
        { weather: 'llm', search: 'llm' },
        { name: 'agent', mode: 'agent', backend: 'pi' }
    );
    assert.equal(JSON.stringify(chat.checkMultiHandlerKeywords('搜索天气')), '[]');
});

test('system 路由下 Pi Agent 仍保留天气和搜索旧处理器', () => {
    const chat = loadChatForRoutingTest(
        { weather: 'system', search: 'system' },
        { name: 'agent', mode: 'agent', backend: 'pi' }
    );
    assert.equal(JSON.stringify(chat.checkMultiHandlerKeywords('搜索天气')), '["weather","search"]');
});

test('普通 LLM 使用 llm 路由时保留原有处理器行为', () => {
    const chat = loadChatForRoutingTest(
        { weather: 'llm', search: 'llm' },
        { name: 'default', mode: 'llm' }
    );
    assert.equal(JSON.stringify(chat.checkMultiHandlerKeywords('搜索天气')), '["weather","search"]');
});
