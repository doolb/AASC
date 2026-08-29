'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DISPLAY = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/display.html');
const PCM_CAPTURE = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/pcm-audio-capture.js');

test('录音显示端使用原始 PCM 公共 ASR，APK 提供端保留原生入口', () => {
    const display = fs.readFileSync(DISPLAY, 'utf8');
    const pcmCapture = fs.readFileSync(PCM_CAPTURE, 'utf8');

    assert.match(display, /js\/pcm-audio-capture\.js/);
    assert.match(display, /function startRawPcmCapture\(/);
    assert.match(pcmCapture, /class PcmAudioCapture/);
    assert.match(pcmCapture, /createScriptProcessor\(/);
    assert.match(pcmCapture, /encodeWav\(/);
    assert.match(display, /sampleRate: 16000/);
    assert.match(display, /fetch\('\/api\/asr\/recognize'/);
    assert.match(display, /nativeAsrAvailable/);
    assert.match(display, /handleAsrAudio/);
    assert.doesNotMatch(display, /new MediaRecorder\(/);
});

test('APK 录音不主动启用浏览器回声消除和噪声抑制', () => {
    const display = fs.readFileSync(DISPLAY, 'utf8');
    const recordingBlock = display.match(/micStream = await navigator\.mediaDevices\.getUserMedia\(\{([\s\S]*?)\}\);/);

    assert.ok(recordingBlock);
    assert.match(recordingBlock[1], /echoCancellation:\s*false/);
    assert.match(recordingBlock[1], /noiseSuppression:\s*false/);
});

test('正式显示端所有录音上传统一为 WAV', () => {
    const display = fs.readFileSync(DISPLAY, 'utf8');

    assert.doesNotMatch(display, /new MediaRecorder\(/);
    assert.doesNotMatch(display, /audio\/webm/);
    assert.match(display, /function startRawPcmCapture\(/);
    assert.match(display, /recording\.wav/);
});
