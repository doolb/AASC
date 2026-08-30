'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizeAgentProfile,
    normalizeChatTemplate,
    resolvePermissionPolicy,
    normalizeOpenAiBaseUrl,
    buildChatSessionKey,
    normalizePiApiKey
} = require('./pi-runtime-policy');

test('缺少 mode 的 profile 默认按普通 LLM', () => {
    assert.deepStrictEqual(normalizeAgentProfile({ name: 'local' }).mode, 'llm');
});

test('Agent profile 只接受 Pi', () => {
    assert.equal(normalizeAgentProfile({ name: 'local', mode: 'agent' }).backend, 'pi');
    assert.throws(() => normalizeAgentProfile({ mode: 'agent', backend: 'codex' }), /Pi/);
});

test('只读权限只返回固定工具白名单', () => {
    assert.deepStrictEqual(resolvePermissionPolicy('readonly').tools, [
        'read', 'grep', 'aasc_find', 'ls', 'aasc_web_search', 'aasc_web_fetch'
    ]);
});

test('模板缺少权限时默认只读，且拒绝任意工具字段', () => {
    const template = normalizeChatTemplate({ name: '资料助手', content: '查资料' });
    assert.equal(template.permissionProfile, 'readonly');
    assert.equal('tools' in template, false);
});

test('OpenAI 接口地址转换为 provider base URL', () => {
    assert.equal(
        normalizeOpenAiBaseUrl('http://llm.example/v1/chat/completions'),
        'http://llm.example/v1'
    );
    assert.equal(normalizeOpenAiBaseUrl('http://llm.example/v1'), 'http://llm.example/v1');
});

test('Pi 本地兼容接口没有 API Key 时使用占位 Key，真实 Key 原样保留', () => {
    assert.equal(normalizePiApiKey(''), 'aasc-local-key');
    assert.equal(normalizePiApiKey(null), 'aasc-local-key');
    assert.equal(normalizePiApiKey('real-key'), 'real-key');
});

test('Chat session key 同时隔离 profile 和 template', () => {
    const key = buildChatSessionKey({
        profileName: 'qwen', templateId: 'researcher', mode: 'group'
    });
    assert.equal(key, 'profile:qwen:template:researcher:group');
});
