'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SERVER_FILE = path.resolve(__dirname, '../src/apps/server/boot/server-app.js');

function readChatHandler() {
    const source = fs.readFileSync(SERVER_FILE, 'utf8');
    const start = source.indexOf('async function handleChatMessage(options)');
    const end = source.indexOf('\nconst deviceEventDebounce', start);
    assert.ok(start >= 0 && end > start, '应能定位普通聊天处理函数');
    return source.slice(start, end);
}

test('普通 LLM 流式回包必须透传 requestId', () => {
    const handler = readChatHandler();

    // 控制端会按 activeRequestId 丢弃迟到或无归属的回包，三条路径都必须携带请求号。
    assert.match(handler, /requestId\s*,/u, 'handleChatMessage 应接收 requestId');
    assert.match(
        handler,
        /type:\s*'chatChunk'[\s\S]{0,180}requestId/u,
        'chatChunk 应包含 requestId'
    );
    assert.match(
        handler,
        /type:\s*'chatResponse'[\s\S]{0,220}requestId[\s\S]{0,220}success:\s*true/u,
        '成功 chatResponse 应包含 requestId'
    );
    assert.match(
        handler,
        /type:\s*'chatResponse'[\s\S]{0,180}requestId[\s\S]{0,180}success:\s*false/u,
        '失败 chatResponse 应包含 requestId'
    );
});

test('聊天消息显式区分 Agent 与普通 LLM，并兼容旧角色消息', () => {
    const source = fs.readFileSync(SERVER_FILE, 'utf8');
    assert.match(source, /data\.assistantType\s*===\s*'agent'/u);
    assert.match(source, /!data\.assistantType\s*&&\s*data\.mode\s*===\s*'role'/u);
    assert.match(source, /Agent 消息缺少角色/u);
});
