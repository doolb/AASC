'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'src/apps/server/boot/server-app.js');
const DISPLAY = path.join(ROOT, 'src/apps/web-mediacenter/ui/public/display.html');
const DEVICE_LIST = path.join(ROOT, 'src/apps/web-mediacenter/ui/public/js/device-list.js');
const WEBSOCKET = path.join(ROOT, 'src/apps/web-mediacenter/ui/public/js/websocket.js');
const UPLOAD = path.join(ROOT, 'src/apps/web-mediacenter/ui/public/upload.html');

test('服务端注册三种显示端录音模式并定向转发回控制端', () => {
    const server = fs.readFileSync(SERVER, 'utf8');

    assert.match(server, /voiceRecordingMode\s*:\s*['"]asr['"]/);
    assert.match(server, /['"]asr['"]\s*,\s*['"]single['"]\s*,\s*['"]realtime['"]/);
    assert.match(server, /setVoiceRecordingMode/);
    assert.match(server, /requestDisplayRecording/);
    assert.match(server, /stopDisplayRecording/);
    assert.match(server, /displayRecordingStatus/);
    assert.match(server, /displayRecordingChunk/);
    assert.match(server, /displayRecordingResult/);
    assert.match(server, /60000/);
    assert.match(server, /displayRecordingSessions/);

    const resultHandler = server.match(/function handleDisplayRecordingMessage\([\s\S]*?\n}\n/);
    assert.ok(resultHandler, '应有独立的显示端录音消息处理函数');
    assert.doesNotMatch(resultHandler[0], /broadcastToControls\(/, '录音数据不能广播给所有控制端');
    assert.match(resultHandler[0], /sendDisplayRecordingToControl/);
    assert.match(server, /controlSocket:\s*ws/);
});

test('显示端按录音模式选择采集行为，单次和实时模式不进入 ASR', () => {
    const display = fs.readFileSync(DISPLAY, 'utf8');

    assert.match(display, /voiceRecordingMode/);
    assert.match(display, /voiceRecordingConfig/);
    assert.match(display, /displayRecordingRequest/);
    assert.match(display, /displayRecordingChunk/);
    assert.match(display, /displayRecordingResult/);
    assert.match(display, /streamOnly/);
    assert.match(display, /maxDurationMs|60000/);

    const recordingHandler = display.match(/function handleDisplayRecordingRequest\([\s\S]*?\n        }\n/);
    assert.ok(recordingHandler, '应有独立的显示端录音请求处理函数');
    assert.doesNotMatch(recordingHandler[0], /sendAudioForRecognition\(/, '非 ASR 录音不能调用 ASR 接口');
});

test('控制端显示录音模式选择、请求/停止按钮和回放消息处理', () => {
    const deviceList = fs.readFileSync(DEVICE_LIST, 'utf8');
    const websocket = fs.readFileSync(WEBSOCKET, 'utf8');
    const upload = fs.readFileSync(UPLOAD, 'utf8');

    assert.match(deviceList, /普通 ASR/);
    assert.match(deviceList, /单次录音/);
    assert.match(deviceList, /实时录音/);
    assert.match(deviceList, /requestDisplayRecording/);
    assert.match(deviceList, /stopDisplayRecording/);
    assert.match(deviceList, /audioData/);
    assert.match(deviceList, /AudioContext/);
    assert.match(websocket, /displayRecordingStatus/);
    assert.match(websocket, /displayRecordingChunk/);
    assert.match(websocket, /displayRecordingResult/);
    assert.match(upload, /pcm-audio-capture|device-list/);
});

test('录音模式控件只显示在 VAD 卡片，树形显示端节点不重复显示', () => {
    const deviceList = fs.readFileSync(DEVICE_LIST, 'utf8');
    const treeStart = deviceList.indexOf('renderVoiceControl(display)');
    const treeEnd = deviceList.indexOf('renderSettingControl(node)', treeStart);
    const vadStart = deviceList.indexOf('renderVoiceVadCardHtml(display)');
    const vadEnd = deviceList.indexOf('renderVoiceVadPanel()', vadStart);
    const treeVoiceBlock = deviceList.slice(treeStart, treeEnd);
    const vadCardBlock = deviceList.slice(vadStart, vadEnd);

    assert.doesNotMatch(treeVoiceBlock, /data-voice-recording-mode|display-recording-btn|display-recording-replay/);
    assert.match(vadCardBlock, /data-voice-recording-mode/);
    assert.match(vadCardBlock, /data-display-recording-action/);
    assert.match(vadCardBlock, /data-display-recording-replay/);
});
