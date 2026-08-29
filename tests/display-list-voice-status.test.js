'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('控制端显示列表直接提供监听开关和监听状态', () => {
    const deviceList = read('src/apps/web-mediacenter/ui/public/js/device-list.js');
    const uploadCss = read('src/apps/web-mediacenter/ui/public/css/upload.css');

    assert.match(deviceList, /data-voice-listening-toggle/);
    assert.match(deviceList, /toggleVoiceListening/);
    assert.match(deviceList, /getVoiceListeningStatus/);
    assert.match(deviceList, /监听中/);
    assert.match(deviceList, /等待唤醒/);
    assert.match(deviceList, /已关闭/);
    assert.match(deviceList, /不可用/);
    assert.match(uploadCss, /display-voice-control/);
});

test('控制端按显示端展示最近一次 ASR 回传文本', () => {
    const deviceList = read('src/apps/web-mediacenter/ui/public/js/device-list.js');
    const websocket = read('src/apps/web-mediacenter/ui/public/js/websocket.js');
    const server = read('src/apps/server/boot/server-app.js');

    assert.match(deviceList, /voiceInputByDisplay/);
    assert.match(deviceList, /最近识别/);
    assert.match(deviceList, /handleVoiceInput/);
    assert.match(websocket, /DeviceList\.handleVoiceInput\(data\)/);
    assert.match(websocket, /DeviceList\.updateVoiceConversationState\(data\)/);
    assert.match(server, /voiceConversation: data\.state\.voiceConversation/);
});

test('监听开关绑定独立 change 事件，并处理 WebSocket 未连接', () => {
    const deviceList = read('src/apps/web-mediacenter/ui/public/js/device-list.js');
    const websocket = read('src/apps/web-mediacenter/ui/public/js/websocket.js');
    const server = read('src/apps/server/boot/server-app.js');
    const uploadCss = read('src/apps/web-mediacenter/ui/public/css/upload.css');
    const renderVoiceControl = deviceList.match(/renderVoiceControl\(display\) \{([\s\S]*?)\n    \},\n\n    renderSettingControl/);

    assert.ok(renderVoiceControl, '应能定位树形视图监听控件渲染函数');
    assert.match(renderVoiceControl[1], /input\.addEventListener\(['"]change['"]/, '监听复选框必须绑定 change 事件');
    assert.match(renderVoiceControl[1], /updateCapability\(display\.id, ['"]voiceRecording['"], event\.target\.checked\)/);
    assert.match(deviceList, /监听开关发送失败/);
    assert.match(deviceList, /发送中/);
    assert.match(websocket, /DeviceList\.handleCapabilitiesUpdated\(data\)/);
    assert.match(websocket, /DeviceList\.handleCapabilitiesUpdateError\(data\)/);
    assert.match(server, /capabilitiesUpdateError/);
    assert.match(uploadCss, /display-voice-state\.pending/);
});
