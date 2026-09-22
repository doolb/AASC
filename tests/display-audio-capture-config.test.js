'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (filePath) => fs.readFileSync(filePath, 'utf8');

const SERVER = read('src/apps/server/boot/server-app.js');
const DISPLAY = read('src/apps/web-mediacenter/ui/public/display.html');
const DEVICE_LIST = read('src/apps/web-mediacenter/ui/public/js/device-list.js');
const WEBSOCKET = read('src/apps/web-mediacenter/ui/public/js/websocket.js');
const PCM = read('src/apps/web-mediacenter/ui/public/js/pcm-audio-capture.js');
const BRIDGE = read('src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt');
const NATIVE_CAPTURE = read(
    'src/apps/android-display/app/src/main/java/com/aasc/display/NativeAudioCaptureController.kt'
);
const INPUT_DEVICE = read(
    'src/apps/android-display/app/src/main/java/com/aasc/display/AudioInputDevice.kt'
);

test('服务端注册双录音方式的 WebSocket 配置和设备状态消息', () => {
    assert.match(SERVER, /setVoiceCaptureConfig/);
    assert.match(SERVER, /requestAudioInputDevices/);
    assert.match(SERVER, /voiceCaptureConfig/);
    assert.match(SERVER, /displayVoiceCaptureConfigChanged/);
    assert.match(SERVER, /audioInputDevices/);
    assert.match(SERVER, /voiceCaptureStatus/);
    assert.match(SERVER, /persistDisplayState\(displayData, \{[\s\S]*voiceCaptureMode/);
    assert.match(SERVER, /normalizeVoiceCaptureMode/);
    assert.match(SERVER, /normalizeVoiceInputDeviceKey/);
});

test('控制端提供采集方式、设备选择和设备刷新入口', () => {
    assert.match(DEVICE_LIST, /data-voice-capture-mode/);
    assert.match(DEVICE_LIST, /data-voice-input-device/);
    assert.match(DEVICE_LIST, /data-audio-input-refresh/);
    assert.match(DEVICE_LIST, /setVoiceCaptureConfig\(/);
    assert.match(DEVICE_LIST, /requestAudioInputDevices\(/);
    assert.match(WEBSOCKET, /displayVoiceCaptureConfigChanged/);
    assert.match(WEBSOCKET, /audioInputDevices/);
    assert.match(WEBSOCKET, /voiceCaptureStatus/);
});

test('显示端按配置选择 WebView 或 Native 录音并回报实际状态', () => {
    assert.match(DISPLAY, /voiceCaptureMode = 'webview'/);
    assert.match(DISPLAY, /getUserMedia\([\s\S]*deviceId: \{ exact:/);
    assert.match(DISPLAY, /NativePcmAudioCapture/);
    assert.match(DISPLAY, /startNativeAudioCapture/);
    assert.match(DISPLAY, /stopNativeAudioCapture/);
    assert.match(DISPLAY, /window\.onNativeAudioChunk/);
    assert.match(DISPLAY, /type: 'audioInputDevices'/);
    assert.match(DISPLAY, /type: 'voiceCaptureStatus'/);
});

test('Native PCM 采集复用 JS VAD/WAV 链路，原生桥枚举并选择输入设备', () => {
    assert.match(PCM, /class NativePcmAudioCapture/);
    assert.match(PCM, /feedPcm16\(/);
    assert.match(PCM, /global\.NativePcmAudioCapture/);
    assert.match(BRIDGE, /fun listAudioInputDevices\(\): String/);
    assert.match(BRIDGE, /fun startNativeAudioCapture\(configJson: String\): String/);
    assert.match(BRIDGE, /fun stopNativeAudioCapture\(\): String/);
    assert.match(NATIVE_CAPTURE, /AudioRecord\.Builder/);
    assert.match(NATIVE_CAPTURE, /setPreferredDevice/);
    assert.match(NATIVE_CAPTURE, /window\.onNativeAudioChunk/);
    assert.match(INPUT_DEVICE, /GET_DEVICES_INPUTS/);
    assert.match(INPUT_DEVICE, /native:\$\{device\.type\}/);
});

console.log('display-audio-capture-config.test.js: contract checks passed');
