'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const serverApp = fs.readFileSync(
    path.join(__dirname, '..', 'src/apps/server/boot/server-app.js'),
    'utf8'
);

test('LLM chunk 只聚合不逐片段写入 WS 日志，完成时记录完整文本', () => {
    assert.match(serverApp, /const llmLogBuffers = new Map\(\)/);
    assert.match(serverApp, /appendLlmLogChunk\(displayId, data\.requestId, data\.text\)/);
    assert.match(serverApp, /const shouldSkipLlmChunkLog = data\.type === 'llm\.chunk'/);
    assert.match(serverApp, /consumeLlmLogText\(displayId, data\.requestId, data\.text\)/);
    assert.match(serverApp, /&& !shouldSkipLlmChunkLog\)/);
});
