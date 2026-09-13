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
const WINDOWS_DISPLAY = path.join(ROOT, 'src/apps/voice-display-node/main.js');

test('服务端转发摄像头列表、拍照、实时帧和停止请求，并限制帧大小', () => {
    const server = fs.readFileSync(SERVER, 'utf8');

    assert.match(server, /listDisplayCameras/);
    assert.match(server, /requestDisplayCamera/);
    assert.match(server, /stopDisplayCamera/);
    assert.match(server, /displayCameraDevices/);
    assert.match(server, /displayCameraResult/);
    assert.match(server, /displayCameraFrame/);
    assert.match(server, /MAX_CAMERA.*SIZE|CAMERA.*MAX.*SIZE/);
});

test('显示端使用单路 getUserMedia，实时预览停止后释放轨道', () => {
    const display = fs.readFileSync(DISPLAY, 'utf8');

    assert.match(display, /cameraCapture/);
    assert.match(display, /enumerateDevices/);
    assert.match(display, /getUserMedia\(\{[\s\S]*video/);
    assert.match(display, /displayCameraFrame/);
    assert.match(display, /displayCameraResult/);
    assert.match(display, /stopCameraStream|cameraStream.*getTracks/);
});

test('单次拍照等待摄像头首帧后再绘制，避免 Android WebView 黑帧', () => {
    const display = fs.readFileSync(DISPLAY, 'utf8');

    assert.match(display, /function cameraPhotoFromTrack\(\)/);
    assert.match(display, /new ImageCapture\(track\)/);
    assert.match(display, /imageCapture\.takePhoto\(\)/);
    assert.match(display, /function captureSingleCameraImage\(video\)/);
    assert.match(display, /function waitForCameraFrame\(video/);
    assert.match(display, /readyState\s*<\s*2/);
    assert.match(display, /requestVideoFrameCallback/);
    assert.match(display, /await captureSingleCameraImage\(cameraVideo\)/);
});

test('控制端显示摄像头卡片支持选择、拍照、实时预览和加入聊天', () => {
    const deviceList = fs.readFileSync(DEVICE_LIST, 'utf8');
    const websocket = fs.readFileSync(WEBSOCKET, 'utf8');

    assert.match(deviceList, /display-camera-card|data-camera-device/);
    assert.match(deviceList, /listDisplayCameras/);
    assert.match(deviceList, /requestDisplayCamera/);
    assert.match(deviceList, /stopDisplayCamera/);
    assert.match(deviceList, /attachImage/);
    assert.match(websocket, /displayCameraDevices/);
    assert.match(websocket, /displayCameraFrame/);
    assert.match(websocket, /displayCameraResult/);
});

test('控制端首次显示摄像头卡片自动刷新列表，不再要求先手动刷新', () => {
    const deviceList = fs.readFileSync(DEVICE_LIST, 'utf8');

    assert.match(deviceList, /requestDisplayCameraDevicesIfNeeded/);
    assert.match(deviceList, /autoRefreshRequested/);
    assert.match(deviceList, /正在自动刷新摄像头/);
});

test('LLM 状态更新只刷新模型面板，不重建摄像头列表', () => {
    const deviceList = fs.readFileSync(DEVICE_LIST, 'utf8');
    const handler = deviceList.match(/handleLlmStatus\(data\) \{([\s\S]*?)\n    \},\n\n    selectLlmModel/);

    assert.ok(handler, '应找到 LLM 状态处理函数');
    assert.match(handler[1], /renderLlmModelPanel\(\)/);
    assert.doesNotMatch(handler[1], /this\.render\(\)/);
});

test('显示端在摄像头操作期间显示拍照和实时预览状态', () => {
    const display = fs.readFileSync(DISPLAY, 'utf8');

    assert.match(display, /cameraStatusDisplay/);
    assert.match(display, /正在刷新摄像头/);
    assert.match(display, /正在拍照/);
    assert.match(display, /实时预览中/);
    assert.match(display, /实时预览已停止/);
    assert.match(display, /updateCameraStatus\('error'/);
});

test('Windows 语音显示端明确声明不支持摄像头', () => {
    const display = fs.readFileSync(WINDOWS_DISPLAY, 'utf8');
    assert.match(display, /cameraCapture\s*:\s*false/);
});
