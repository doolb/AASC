'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const formatter = require('../src/apps/server/modules/asr/asr-result-log-formatter');

test('asrResult 日志包含 ASR 和声纹模型耗时', () => {
    const message = formatter.formatAsrResultLog({
        requestId: 'timing-1',
        text: '你好',
        asrElapsedMs: 1234,
        voiceprintElapsedMs: 856
    }, true);

    assert.match(message, /"asrElapsedMs":1234/u);
    assert.match(message, /"voiceprintElapsedMs":856/u);
});

test('缺少或非法的识别耗时记录为 null', () => {
    const message = formatter.formatAsrResultLog({
        requestId: 'timing-2',
        text: '普通语音',
        asrElapsedMs: 'invalid',
        voiceprintElapsedMs: -1
    }, false);

    assert.match(message, /"asrElapsedMs":null/u);
    assert.match(message, /"voiceprintElapsedMs":null/u);
});

test('正式显示端透传原生 ASR 结果耗时', () => {
    const display = read('src/apps/web-mediacenter/ui/public/display.html');

    assert.match(display, /asrElapsedMs/u);
    assert.match(display, /voiceprintElapsedMs/u);
});

test('原生桥和服务端保留两类识别耗时', () => {
    const nativeBridge = read('src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt');
    const server = read('src/apps/server/boot/server-app.js');

    assert.match(nativeBridge, /asrElapsedMs/u);
    assert.match(nativeBridge, /voiceprintElapsedMs/u);
    assert.match(server, /asrElapsedMs/u);
    assert.match(server, /voiceprintElapsedMs/u);
});

console.log('asr-result-timing.test.js: passed');
