'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { shouldSkipDisplayTts } = require('../src/apps/server/modules/tts/display-tts-policy');

test('TTS 下发显式检查睡眠时，sleep/deep 显示端被跳过', () => {
    assert.strictEqual(
        shouldSkipDisplayTts({ state: { sleepState: 'sleep' } }, { checkSleep: true }),
        true
    );
    assert.strictEqual(
        shouldSkipDisplayTts({ state: { sleepState: 'deep' } }, { checkSleep: true }),
        true
    );
});

test('TTS 下发未要求检查睡眠时，睡眠显示端仍允许播放', () => {
    assert.strictEqual(
        shouldSkipDisplayTts({ state: { sleepState: 'deep' } }, { checkSleep: false }),
        false
    );
    assert.strictEqual(
        shouldSkipDisplayTts({ state: { sleepState: 'deep' } }),
        false
    );
});

test('TTS 下发检查状态未知时按允许播放处理', () => {
    assert.strictEqual(shouldSkipDisplayTts({}, { checkSleep: true }), false);
    assert.strictEqual(shouldSkipDisplayTts(null, { checkSleep: true }), false);
});
