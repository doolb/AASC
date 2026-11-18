'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const {
    normalizeTemporaryConversationHistoryConfig,
    groupTemporaryConversationMessages,
    selectTemporaryConversationHistory,
    getTemporaryConversationHistoryGroups,
    getContinuousTemporaryConversationHistory
} = require('../src/apps/server/modules/voice/temporary-conversation-history');

const createMessage = (sessionId, timestamp, role, content) => ({
    id: `${sessionId}-${timestamp}-${role}`,
    sessionId,
    timestamp,
    mode: 'temporary',
    role,
    content
});

function testHistoryConfigDefaultsAndBounds() {
    assert.deepStrictEqual(normalizeTemporaryConversationHistoryConfig({}), {
        temporaryHistoryGroups: 10,
        temporaryContextGroups: 3
    });
    assert.deepStrictEqual(normalizeTemporaryConversationHistoryConfig({
        temporaryHistoryGroups: 0,
        temporaryContextGroups: 99
    }), {
        temporaryHistoryGroups: 1,
        temporaryContextGroups: 20
    });
}

function testContextContainsCurrentAndRecentTwoGroups() {
    const messages = [
        createMessage('old', 100, 'control', '旧会话'),
        createMessage('old', 101, 'assistant', '旧回复'),
        createMessage('recent-1', 200, 'control', '最近一组'),
        createMessage('recent-1', 201, 'assistant', '最近回复'),
        createMessage('recent-2', 300, 'control', '第二组'),
        createMessage('recent-2', 301, 'assistant', '第二回复'),
        createMessage('current', 400, 'control', '当前消息')
    ];
    const selected = selectTemporaryConversationHistory(messages, 'current', {
        temporaryHistoryGroups: 10,
        temporaryContextGroups: 3
    });

    assert.deepStrictEqual(selected.contextGroups.map(group => group.sessionId), [
        'recent-1',
        'recent-2',
        'current'
    ]);
    assert.deepStrictEqual(selected.messages.map(message => message.content), [
        '最近一组',
        '最近回复',
        '第二组',
        '第二回复',
        '当前消息'
    ]);
}

function testHistoryGroupsKeepMostRecentCompletedGroups() {
    const messages = [
        createMessage('one', 100, 'control', '一'),
        createMessage('two', 200, 'control', '二'),
        createMessage('three', 300, 'control', '三'),
        createMessage('current', 400, 'control', '当前')
    ];
    const selected = selectTemporaryConversationHistory(messages, 'current', {
        temporaryHistoryGroups: 2,
        temporaryContextGroups: 3
    });

    assert.deepStrictEqual(selected.historicalGroups.map(group => group.sessionId), ['two', 'three']);
    assert.deepStrictEqual(selected.contextGroups.map(group => group.sessionId), [
        'two',
        'three',
        'current'
    ]);
    assert.strictEqual(groupTemporaryConversationMessages(messages).length, 4);
}

function testControlHistoryGroupsAreNewestFirstAndReadOnlyPayloadReady() {
    const messages = [
        { ...createMessage('one', 100, 'control', '一'), roleName: '小爱' },
        { ...createMessage('one', 101, 'assistant', '一答'), roleName: '小爱' },
        { ...createMessage('two', 200, 'control', '二'), roleName: '妲己' },
        { ...createMessage('two', 201, 'assistant', '二答'), roleName: '妲己' },
        createMessage('current', 300, 'control', '当前')
    ];
    const groups = getTemporaryConversationHistoryGroups(messages, 'current', {
        temporaryHistoryGroups: 2
    });

    assert.deepStrictEqual(groups.map(group => group.sessionId), ['two', 'one']);
    assert.strictEqual(groups[0].roleName, '妲己');
    assert.strictEqual(groups[0].messageCount, 2);
    assert.deepStrictEqual(groups[0].messages.map(message => message.content), ['二', '二答']);
}

function testContinuousHistoryIncludesOldAndCurrentAcrossGroups() {
    const messages = [
        createMessage('current', 300, 'control', '当前'),
        { mode: 'group', timestamp: 150, content: '群聊不可混入' },
        createMessage('old', 100, 'control', '旧问题'),
        createMessage('old', 101, 'assistant', '旧回答'),
        createMessage('recent', 200, 'control', '新角色问题')
    ];
    const history = getContinuousTemporaryConversationHistory(messages);
    assert.deepStrictEqual(history.map(item => item.content), ['旧问题', '旧回答', '新角色问题', '当前']);
    assert.deepStrictEqual(history.map(item => item.sessionId), ['old', 'old', 'recent', 'current']);
    assert.deepStrictEqual(getContinuousTemporaryConversationHistory([]), []);
}

function testOrdinaryTrimDoesNotDeleteTemporaryMessages() {
    const source = fs.readFileSync('src/external/llm/llm-service.js', 'utf8');
    const start = source.indexOf('function trimHistory() {');
    const end = source.indexOf('\n}\n', start) + 2;
    assert.ok(start >= 0 && end > start);
    const temporary = Array.from({ length: 150 }, (_, index) => createMessage(`old-${index}`, index, 'control', String(index)));
    const group = Array.from({ length: 150 }, (_, index) => ({ mode:'group', content:String(index) }));
    const buckets = { temporary, group };
    vm.runInNewContext(`${source.slice(start, end)}; trimHistory();`, { chatHistories:buckets, MAX_HISTORY_PER_SESSION:100 });
    assert.strictEqual(buckets.temporary.length, 150);
    assert.strictEqual(buckets.group.length, 100);
}

testHistoryConfigDefaultsAndBounds();
testContextContainsCurrentAndRecentTwoGroups();
testHistoryGroupsKeepMostRecentCompletedGroups();
testControlHistoryGroupsAreNewestFirstAndReadOnlyPayloadReady();
testContinuousHistoryIncludesOldAndCurrentAcrossGroups();
testOrdinaryTrimDoesNotDeleteTemporaryMessages();
console.log('temporary-conversation-history.test.js: 6/6 passed');
