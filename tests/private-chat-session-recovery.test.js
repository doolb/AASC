'use strict';

const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const chat = require('../src/external/llm/llm-service');

test('保存不完整的会话快照时保留服务端已有的私聊会话', () => {
    const merged = chat.mergeSessionEntries(
        [
            { id: 'default', name: '默认会话', createdAt: 1 },
            { id: 'legacy-1', name: '妲己旧会话', createdAt: 2 }
        ],
        [{ id: 'default', name: '默认会话', createdAt: 3 }]
    );

    assert.deepEqual(merged, [
        { id: 'default', name: '默认会话', createdAt: 3 },
        { id: 'legacy-1', name: '妲己旧会话', createdAt: 2 }
    ]);
});

test('私聊历史存在但会话元数据丢失时自动恢复会话条目', () => {
    const sessions = chat.recoverSessionsFromHistory('妲己', [
        { id: 'default', name: '默认会话', createdAt: 1 }
    ], [
        { mode: 'private', target: '妲己', sessionId: 'history-1', timestamp: 20 },
        { mode: 'private', target: '妲己', sessionId: 'history-1', timestamp: 21 },
        { mode: 'private', target: '小爱', sessionId: 'other-target', timestamp: 22 },
        { mode: 'group', target: null, sessionId: 'group-1', timestamp: 23 }
    ]);

    assert.deepEqual(sessions, [
        { id: 'default', name: '默认会话', createdAt: 1 },
        { id: 'history-1', name: 'history-1', createdAt: 20 }
    ]);
});

test('前端保存会话状态时不提交会话元数据快照', () => {
    const sourcePath = path.join(__dirname, '../src/apps/web-mediacenter/ui/public/js/chat.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    assert.match(source, /const session = \{ \.\.\.this\.session \};\s+delete session\.sessions;/u);
    assert.match(source, /session: session/u);
});
