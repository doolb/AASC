'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizeVoicePlaybackDisplayIds,
    resolveVoicePlaybackTarget
} = require('../src/apps/server/modules/media/voice-playback-router');

test('来源显示端具备语音播放能力时优先返回来源端', () => {
    const availableDisplayIds = normalizeVoicePlaybackDisplayIds([
        'display-backup',
        'display-source',
        'display-source',
        '',
        null,
        123
    ]);

    assert.deepEqual(availableDisplayIds, ['display-backup', 'display-source']);
    assert.equal(
        resolveVoicePlaybackTarget('display-source', availableDisplayIds),
        'display-source'
    );
});

test('来源显示端不可用时按在线列表顺序选择备用端', () => {
    assert.equal(
        resolveVoicePlaybackTarget('display-offline', ['display-backup-1', 'display-backup-2']),
        'display-backup-1'
    );
});

test('没有可用语音播放显示端时返回 null', () => {
    assert.equal(resolveVoicePlaybackTarget('display-source', []), null);
    assert.equal(resolveVoicePlaybackTarget('display-source', null), null);
});
