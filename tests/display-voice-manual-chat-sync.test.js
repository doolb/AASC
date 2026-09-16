'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
    buildManualChatVoiceConversationUpdates
} = require('../src/apps/server/modules/voice/display-voice-conversation');

test('offline 手动私聊为所有在线且监听开启的显示端绑定当前助手', () => {
    assert.equal(typeof buildManualChatVoiceConversationUpdates, 'function');

    const updates = buildManualChatVoiceConversationUpdates({
        offlineMode: true,
        source: 'controlManual',
        chatSession: { mode: 'private', privateTarget: '小爱' },
        displays: [
            { displayId: 'display-local', voiceRecordingEnabled: true },
            { displayId: 'display-muted', voiceRecordingEnabled: false }
        ],
        now: 1234
    });

    assert.deepEqual(updates, [{
        displayId: 'display-local',
        conversation: {
            state: 'activePrivate',
            target: '小爱',
            lastValidInputAt: 1234,
            windowType: 'conversation',
            expiresAt: null,
            timerPaused: false,
            remainingMs: null
        }
    }]);
});

test('offline 手动群聊为监听开启的显示端创建群聊会话', () => {
    assert.equal(typeof buildManualChatVoiceConversationUpdates, 'function');

    const updates = buildManualChatVoiceConversationUpdates({
        offlineMode: true,
        source: 'controlManual',
        chatSession: { mode: 'group', privateTarget: null },
        displays: [{ displayId: 'display-a', voiceRecordingEnabled: true }],
        now: 4321
    });

    assert.deepEqual(updates, [{
        displayId: 'display-a',
        conversation: {
            state: 'activeGroup',
            target: null,
            lastValidInputAt: 4321,
            windowType: 'conversation',
            expiresAt: null,
            timerPaused: false,
            remainingMs: null
        }
    }]);
});

test('非 offline、非手动来源、关闭监听或无效聊天模式不触发语音会话同步', () => {
    assert.equal(typeof buildManualChatVoiceConversationUpdates, 'function');

    const base = {
        offlineMode: true,
        source: 'controlManual',
        chatSession: { mode: 'private', privateTarget: '小爱' },
        displays: [{ displayId: 'display-a', voiceRecordingEnabled: true }],
        now: 5000
    };

    assert.deepEqual(buildManualChatVoiceConversationUpdates({ ...base, offlineMode: false }), []);
    assert.deepEqual(buildManualChatVoiceConversationUpdates({ ...base, source: 'serverSync' }), []);
    assert.deepEqual(buildManualChatVoiceConversationUpdates({
        ...base,
        chatSession: { mode: 'private', privateTarget: '' }
    }), []);
    assert.deepEqual(buildManualChatVoiceConversationUpdates({
        ...base,
        chatSession: { mode: 'role', privateTarget: null }
    }), []);
    assert.deepEqual(buildManualChatVoiceConversationUpdates({
        ...base,
        displays: [{ displayId: 'display-a', voiceRecordingEnabled: false }]
    }), []);
});
