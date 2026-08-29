'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('TTS 将连续省略号转换为短停顿标点', () => {
    const { normalizeTtsPauseText } = require('../src/apps/server/modules/media/tts-text-normalizer');

    assert.equal(normalizeTtsPauseText('你好......世界'), '你好.世界');
    assert.equal(normalizeTtsPauseText('你好……世界'), '你好.世界');
});

test('TTS 短停顿转换不影响普通句点', () => {
    const { normalizeTtsPauseText } = require('../src/apps/server/modules/media/tts-text-normalizer');
    const { splitIntoSentences } = require('../src/core/utils/sentence-splitter');

    assert.equal(normalizeTtsPauseText('版本 1.2 可用。'), '版本 1.2 可用。');
    assert.deepEqual(splitIntoSentences('第一句。第二句。'), ['第一句。', '第二句。']);
});

test('统一 TTS 路由在显示端和服务端生成前使用短停顿文本', () => {
    const server = fs.readFileSync(
        path.join(root, 'src/apps/server/boot/server-app.js'),
        'utf8'
    );

    assert.match(server, /normalizeTtsPauseText/);
    assert.match(server, /sendTtsGenerateToDisplay\([^,]+, ttsText,/);
    assert.match(server, /tts\.generateTTS\(ttsText, voice, speed\)/);
});
