'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverSource = fs.readFileSync(
    path.join(__dirname, '../src/apps/server/boot/server-app.js'),
    'utf8'
);

test('服务端普通 Chat 和手动 TTS 使用有序调度器', () => {
    assert.match(serverSource, /const \{ createOrderedTaskScheduler \} = require\('\.\.\/modules\/media\/ordered-task-scheduler'\)/u);
    assert.match(serverSource, /function createTtsGenerationScheduler\(preferredDisplayId = null\)/u);
    assert.match(serverSource, /const ttsScheduler = createTtsGenerationScheduler\(preferredDisplayId\);/u);
    assert.match(serverSource, /const ttsScheduler = createTtsGenerationScheduler\(displayId\);/u);
    assert.match(serverSource, /await ttsScheduler\.waitForIdle\(\);/u);
    assert.match(serverSource, /generateTtsWithFallback\(sentence, undefined, undefined, preferredDisplayId\)/u);
    assert.match(serverSource, /generateTtsWithFallback\(cleanText, undefined, undefined, preferredDisplayId\)/u);
    assert.match(serverSource, /chat\.splitIntoSentences\(cleanText\)[\s\S]*?filter\(\(sentence\) => !isPunctuationOnly\(sentence\)\)/u);
    assert.match(serverSource, /if \(!tts \|\| isPunctuationOnly\(sentence\)\) return;/u);
    assert.doesNotMatch(serverSource, /let ttsQueue = Promise\.resolve\(\)/u);
});
