'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const chat = require('./llm-service');

test('Agent 后端默认 Codex，并只接受 Claude/Codex', () => {
    const original = chat.getConfig().agentBackend;
    assert.strictEqual(original, 'codex');
    chat.setConfig({ agentBackend: 'claude' });
    assert.strictEqual(chat.getConfig().agentBackend, 'claude');
    assert.throws(() => chat.setConfig({ agentBackend: 'other' }), /Agent 后端不合法/);
    chat.setConfig({ agentBackend: original });
});
