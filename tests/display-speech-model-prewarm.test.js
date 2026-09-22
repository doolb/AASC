'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const display = fs.readFileSync(
    'src/apps/web-mediacenter/ui/public/display.html',
    'utf8'
);

test('网页显示端在连接后预热当前需要的 ASR 和声纹模型', () => {
    assert.match(display, /function prewarmDisplaySpeechModels\(\)/);
    assert.match(display, /fetch\('\/api\/config\/asrDevice', \{ cache: 'no-store' \}\)/);
    assert.match(display, /fetch\('\/api\/voiceprint\/config', \{ cache: 'no-store' \}\)/);
    assert.match(display, /nativeBridge\.asrEnsureModel\(\)/);
    assert.match(display, /nativeBridge\.voiceprintConfigure\(/);

    const onOpenStart = display.indexOf('socket.onopen = function()');
    const prewarmCall = display.indexOf('void prewarmDisplaySpeechModels();', onOpenStart);
    assert.ok(onOpenStart >= 0);
    assert.ok(prewarmCall > onOpenStart);
});

test('网页显示端合并 HTTP 预热与 WebSocket 声纹配置，避免重复加载', () => {
    assert.match(display, /let voiceprintConfigKey = ''/);
    assert.match(display, /const nextConfigKey = buildVoiceprintConfigKey\(data\)/);
    assert.match(display, /if \(!changed\) return false;/);
    assert.match(display, /if \(displaySpeechPrewarmPromise\) return displaySpeechPrewarmPromise/);

    const messageHandlerStart = display.indexOf("if (data.type === 'voiceprintConfig')");
    const messageHandlerEnd = display.indexOf("if (data.type === 'speakerDbUpdated')", messageHandlerStart);
    const messageHandler = display.slice(messageHandlerStart, messageHandlerEnd);
    assert.match(messageHandler, /applyVoiceprintConfig\(data\)/);
});

console.log('display-speech-model-prewarm.test.js: contract checks passed');
