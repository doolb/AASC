const test = require('node:test');
const assert = require('node:assert/strict');

const { filterHistoryByScope } = require('../src/external/llm/llm-service');

const history = [
    { mode: 'group', role: 'user', content: '群聊消息' },
    { mode: 'private', target: '小爱', sessionId: 'default', role: 'user', content: '小爱默认会话' },
    { mode: 'private', target: '小爱', sessionId: 'session-2', role: 'user', content: '小爱第二会话' },
    { mode: 'private', target: '小美', sessionId: 'default', role: 'user', content: '小美默认会话' },
    { mode: 'role', target: '前端', role: 'user', content: '角色消息' },
    { role: 'user', content: '旧版本群聊消息' }
];

test('历史范围筛选保留群聊兼容记录且不混入私聊', () => {
    const result = filterHistoryByScope(history, { mode: 'group', target: null, sessionId: 'default' });
    assert.deepEqual(result.map((item) => item.content), ['群聊消息', '旧版本群聊消息']);
});

test('多个助手和同一助手不同会话的历史彼此隔离', () => {
    const xiaoAi = filterHistoryByScope(history, {
        mode: 'private',
        target: '小爱',
        sessionId: 'default'
    });
    const xiaoMei = filterHistoryByScope(history, {
        mode: 'private',
        target: '小美',
        sessionId: 'default'
    });
    const secondSession = filterHistoryByScope(history, {
        mode: 'private',
        target: '小爱',
        sessionId: 'session-2'
    });
    assert.deepEqual(xiaoAi.map((item) => item.content), ['小爱默认会话']);
    assert.deepEqual(xiaoMei.map((item) => item.content), ['小美默认会话']);
    assert.deepEqual(secondSession.map((item) => item.content), ['小爱第二会话']);
});
