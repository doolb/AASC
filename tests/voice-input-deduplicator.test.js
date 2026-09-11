'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    createSameSpeakerVoiceInputDeduplicator,
    normalizeVoiceInputText
} = require('../src/apps/server/modules/voice/voice-input-deduplicator');

test('同一注册声纹在不同显示端的短时相同 ASR 只保留首条', () => {
    const deduplicator = createSameSpeakerVoiceInputDeduplicator({ windowMs: 2000 });

    const first = deduplicator.check({
        displayId: 'display-a',
        speaker: 'z',
        text: '打开客厅灯。',
        isFinal: true
    }, 1000);
    const duplicate = deduplicator.check({
        displayId: 'display-b',
        speaker: 'z',
        text: '打开客厅灯',
        isFinal: true
    }, 2500);

    assert.equal(first.isDuplicate, false);
    assert.equal(duplicate.isDuplicate, true);
    assert.equal(duplicate.duplicateOfDisplayId, 'display-a');
});

test('同一注册声纹的文本略有差异且语音区间重叠时仍然去重', () => {
    const deduplicator = createSameSpeakerVoiceInputDeduplicator({
        textSimilarityThreshold: 0.65
    });

    deduplicator.check({
        displayId: 'display-a',
        speaker: 'z',
        text: '打开客厅灯',
        isFinal: true,
        speechStartAt: 1000,
        speechEndAt: 2400
    }, 3000);
    const duplicate = deduplicator.check({
        displayId: 'display-b',
        speaker: 'z',
        text: '请打开客厅灯',
        isFinal: true,
        speechStartAt: 1100,
        speechEndAt: 2500
    }, 3100);

    assert.equal(duplicate.isDuplicate, true);
    assert.equal(duplicate.textSimilarity >= 0.65, true);
});

test('文本相似但语音区间不重叠时不去重', () => {
    const deduplicator = createSameSpeakerVoiceInputDeduplicator();

    deduplicator.check({
        displayId: 'display-a',
        speaker: 'z',
        text: '打开客厅灯',
        isFinal: true,
        speechStartAt: 1000,
        speechEndAt: 1800
    }, 2000);
    const nextUtterance = deduplicator.check({
        displayId: 'display-b',
        speaker: 'z',
        text: '请打开客厅灯',
        isFinal: true,
        speechStartAt: 2500,
        speechEndAt: 3300
    }, 2100);

    assert.equal(nextUtterance.isDuplicate, false);
});

test('未匹配声纹、不同说话人、同一显示端和超时结果不去重', () => {
    const deduplicator = createSameSpeakerVoiceInputDeduplicator({ windowMs: 2000 });

    assert.equal(deduplicator.check({
        displayId: 'display-a', speaker: null, text: '你好', isFinal: true
    }, 1000).isDuplicate, false);
    assert.equal(deduplicator.check({
        displayId: 'display-a', speaker: 'z', text: '你好', isFinal: true
    }, 1100).isDuplicate, false);
    assert.equal(deduplicator.check({
        displayId: 'display-b', speaker: 'x', text: '你好', isFinal: true
    }, 1200).isDuplicate, false);
    assert.equal(deduplicator.check({
        displayId: 'display-a', speaker: 'z', text: '你好', isFinal: true
    }, 1300).isDuplicate, false);
    assert.equal(deduplicator.check({
        displayId: 'display-c', speaker: 'z', text: '你好', isFinal: true
    }, 3401).isDuplicate, false);
});

test('非最终结果不写入去重缓存，文本规范化只处理空白和常见标点', () => {
    const deduplicator = createSameSpeakerVoiceInputDeduplicator({ windowMs: 2000 });

    assert.equal(normalizeVoiceInputText('  打开，客厅灯。\n'), '打开客厅灯');
    assert.equal(deduplicator.check({
        displayId: 'display-a', speaker: 'z', text: '打开客厅灯', isFinal: false
    }, 1000).isDuplicate, false);
    assert.equal(deduplicator.check({
        displayId: 'display-b', speaker: 'z', text: '打开客厅灯', isFinal: true
    }, 1500).isDuplicate, false);
});
