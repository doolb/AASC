'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = path.resolve(__dirname, '../src/apps/server/boot/server-app.js');
const DISPLAY = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/display.html');
const DEVICE_LIST = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/device-list.js');
const WEBSOCKET = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/websocket.js');
const UPLOAD = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/upload.html');

const read = file => fs.readFileSync(file, 'utf8');
const server = read(SERVER);
const display = read(DISPLAY);
const deviceList = read(DEVICE_LIST);
const websocket = read(WEBSOCKET);
const upload = read(UPLOAD);

assert.match(server, /DEFAULT_VAD_THRESHOLD\s*=\s*0\.01/, '服务端应定义统一的默认 VAD 阈值');
assert.match(server, /normalizeVadThreshold/, '服务端应校验并限制控制端设置的 VAD 阈值');
assert.match(server, /vadThreshold:\s*DEFAULT_VAD_THRESHOLD/, '显示端状态应保存每台设备的 VAD 阈值');
assert.match(server, /type:\s*'voiceVadConfig'/, '服务端应向显示端下发 VAD 配置');
assert.match(server, /setVoiceVad/, '服务端应处理控制端设置 VAD 的消息');
assert.match(server, /detectVoiceNoise/, '服务端应处理控制端底噪检测请求');
assert.match(server, /voiceVadNoiseResult/, '服务端应接收显示端底噪检测结果');
assert.match(server, /voiceVadNoiseResult.*broadcastToControls|broadcastToControls[\s\S]*voiceVadNoiseResult/, '底噪检测结果应返回控制端');

assert.match(display, /let\s+vadThreshold\s*=\s*0\.01|let\s+vadThreshold\s*=/, '显示端应使用可更新的 VAD 阈值');
assert.doesNotMatch(display, /const\s+SILENCE_THRESHOLD\s*=\s*0\.01/, '显示端不应把 VAD 阈值固定在检测函数内部');
assert.match(display, /voiceVadConfig/, '显示端应处理服务端下发的 VAD 配置');
assert.match(display, /voiceVadNoiseTest/, '显示端应处理底噪检测指令');
assert.match(display, /voiceVadNoiseResult/, '显示端应回传底噪检测结果');
assert.match(display, /p95Rms|recommendedThreshold/, '底噪检测应计算统计值并给出建议阈值');

assert.match(deviceList, /data-vad-threshold/, '控制端设备列表应显示 VAD 阈值设置');
assert.match(deviceList, /data-vad-noise-test/, '控制端设备列表应提供底噪检测入口');
assert.match(deviceList, /setVoiceVad|detectVoiceNoise/, '控制端应发送 VAD 配置和底噪检测消息');
assert.match(deviceList, /voiceVadNoiseResult|recommendedThreshold/, '控制端应展示底噪检测结果');

const listVoiceHtmlStart = deviceList.indexOf('renderVoiceControlHtml(display)');
const listVoiceHtmlEnd = deviceList.indexOf('bindVoiceListeningControls(container)', listVoiceHtmlStart);
assert.doesNotMatch(
    deviceList.slice(listVoiceHtmlStart, listVoiceHtmlEnd),
    /data-vad-threshold|data-vad-noise-test/,
    '设备列表语音控制区域不应包含 VAD 配置和底噪检测控件'
);
const treeVoiceStart = deviceList.indexOf('renderVoiceControl(display)');
const treeVoiceEnd = deviceList.indexOf('renderSettingControl(node)', treeVoiceStart);
assert.doesNotMatch(
    deviceList.slice(treeVoiceStart, treeVoiceEnd),
    /display-vad-noise-test|display-vad-threshold/,
    '树形设备列表语音控制区域不应包含 VAD 配置和底噪检测控件'
);
assert.match(upload, /id="voiceVadPanel"/, '显示控制页应提供独立 VAD 卡片容器');
assert.match(deviceList, /renderVoiceVadPanel/, '控制端应独立渲染 VAD 卡片');
const vadPanelStart = deviceList.indexOf('renderVoiceVadPanel()');
const vadPanelEnd = deviceList.indexOf('bindVoiceVadControls(container)', vadPanelStart);
const vadPanelBody = deviceList.slice(vadPanelStart, vadPanelEnd);
assert.match(vadPanelBody, /window\.currentDisplayId/, 'VAD 卡片应读取当前选中的显示端');
assert.match(vadPanelBody, /find\(/, 'VAD 卡片应定位当前选中的显示端');
assert.doesNotMatch(vadPanelBody, /this\.list\.map/, 'VAD 卡片不应同时渲染全部显示端');

assert.match(websocket, /voiceVadConfig/, '控制端 WebSocket 应处理 VAD 配置消息');
assert.match(websocket, /voiceVadNoiseTest|voiceVadNoiseResult/, '控制端 WebSocket 应处理底噪检测消息');

console.log('display-vad-config.test.js: contract checks passed');
