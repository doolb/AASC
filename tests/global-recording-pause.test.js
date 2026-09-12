'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('全局录音暂停使用独立运行时 WebSocket 状态并同步初始状态', () => {
    const server = read('src/apps/server/boot/server-app.js');

    assert.match(server, /globalRecordingPaused\s*=\s*false/);
    assert.match(server, /setGlobalRecordingPause/);
    assert.match(server, /globalRecordingPauseState/);
    assert.match(server, /typeof data\.paused !== 'boolean'/);
    assert.match(server, /globalRecordingPaused\s*=\s*data\.paused/);
    assert.match(server, /displayClients\.forEach[\s\S]*globalRecordingPauseState/);
    assert.match(server, /url === '\/control'[\s\S]*globalRecordingPauseState/);
    assert.match(server, /url === '\/display'[\s\S]*globalRecordingPauseState/);
});

test('服务端在新请求和异步 ASR 完成后都丢弃暂停期间结果', () => {
    const server = read('src/apps/server/boot/server-app.js');
    const asrStart = server.indexOf("app.post('/api/asr/recognize'");
    const asrEnd = server.indexOf("app.get('/api/asr/status'", asrStart);
    const asrHandler = server.slice(asrStart, asrEnd);
    const voiceInputStart = server.indexOf('function processDisplayVoiceInput(');
    const voiceInputEnd = server.indexOf('async function handleControlMessageFallback', voiceInputStart);
    const voiceInputHandler = server.slice(voiceInputStart, voiceInputEnd);

    assert.match(asrHandler, /globalRecordingPaused/);
    assert.match(asrHandler, /await sendAudioToDisplayAsr[\s\S]*globalRecordingPaused/);
    assert.match(asrHandler, /await asr\.recognize[\s\S]*globalRecordingPaused/);
    assert.match(server, /audioChunkSessions[\s\S]*globalRecordingPaused/);
    assert.match(voiceInputHandler, /globalRecordingPaused/);
    assert.match(server, /processRecognizedAsrResultForDisplay[\s\S]*globalRecordingPaused/);
});

test('暂停会终止临时录音且不自动恢复，能力和录音模式保持独立', () => {
    const server = read('src/apps/server/boot/server-app.js');
    const display = read('src/apps/web-mediacenter/ui/public/display.html');
    const node = read('src/apps/voice-display-node/main.js');

    assert.match(server, /displayRecordingSessions[\s\S]*discard/);
    assert.match(server, /globalRecordingPaused[\s\S]*requestDisplayRecording/);
    assert.match(display, /globalRecordingPauseState/);
    assert.match(display, /finalizeDisplayRecording\(false[\s\S]*全局录音已暂停/);
    assert.match(display, /startVoiceRecording[\s\S]*globalRecordingPaused/);
    assert.match(node, /globalRecordingPauseState/);
    assert.match(node, /globalRecordingPaused/);
    assert.match(node, /onAudioData[\s\S]*globalRecordingPaused/);
    const pauseHandlerStart = server.indexOf("if (data.type === 'setGlobalRecordingPause')");
    const pauseHandlerEnd = server.indexOf("if (data.type === 'updateDisplayVersionConfig')", pauseHandlerStart);
    assert.doesNotMatch(server.slice(pauseHandlerStart, pauseHandlerEnd), /updateCapabilities/);
});

test('控制端使用右下角圆形图标浮动按钮并接收权威状态', () => {
    const upload = read('src/apps/web-mediacenter/ui/public/upload.html');
    const floating = read('src/apps/web-mediacenter/ui/public/js/floating-control.js');
    const websocket = read('src/apps/web-mediacenter/ui/public/js/websocket.js');

    assert.match(upload, /globalRecordingPause/);
    assert.match(upload, /floating-recording-pause/);
    assert.match(floating, /globalRecordingPauseState/);
    assert.match(floating, /setGlobalRecordingPause/);
    assert.match(floating, /aria-label/);
    assert.match(floating, /暂停所有录音/);
    assert.match(floating, /恢复所有录音/);
    assert.match(websocket, /globalRecordingPauseState/);
    assert.match(websocket, /FloatingControl/);
});

test('录音状态按钮位于自测按钮上方并使用麦克风斜杠图标', () => {
    const upload = read('src/apps/web-mediacenter/ui/public/upload.html');
    const css = read('src/apps/web-mediacenter/ui/public/css/upload.css');
    const floating = read('src/apps/web-mediacenter/ui/public/js/floating-control.js');

    assert.match(upload, /mic-icon/);
    assert.match(upload, /mic-slash/);
    assert.match(css, /\.floating-recording-pause\s*\{[\s\S]*right:\s*0[;\s]*[\s\S]*bottom:\s*120px/);
    assert.match(css, /\.floating-recording-pause\.paused[\s\S]*color:\s*#e53935/);
    assert.match(floating, /const nextPaused = !this\.globalRecordingPaused/);
    assert.match(floating, /this\.globalRecordingPaused = nextPaused/);
    assert.match(floating, /this\.renderGlobalRecordingPause\(\)[\s\S]*socket\.send/);
    assert.match(floating, /this\.globalRecordingPaused = previousPaused/);
    assert.match(floating, /发送全局录音状态失败/);
});
