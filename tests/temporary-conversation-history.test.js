'use strict';

const assert = require('assert');
const {
    normalizeTemporaryConversationHistoryConfig,
    groupTemporaryConversationMessages,
    selectTemporaryConversationHistory,
    getTemporaryConversationHistoryGroups
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

testHistoryConfigDefaultsAndBounds();
testContextContainsCurrentAndRecentTwoGroups();
testHistoryGroupsKeepMostRecentCompletedGroups();
testControlHistoryGroupsAreNewestFirstAndReadOnlyPayloadReady();
console.log('temporary-conversation-history.test.js: 4/4 passed');
