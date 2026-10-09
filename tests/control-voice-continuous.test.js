'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createDisplayVoiceListeningConfig } = require('../src/apps/server/modules/voice/display-voice-listening-config');
const read = file => fs.readFileSync(`src/apps/web-mediacenter/ui/public/${file}`, 'utf8');

function harness() {
    const messages = [], notices = [], timers = new Map();
    let timerId = 0;
    const window = {
        WebSocket: { OPEN: 1 },
        WebSocketManager: { ws: { readyState: 1, send: raw => messages.push(JSON.parse(raw)) } },
        showToast: (...args) => notices.push(args)
    };
    const sandbox = vm.createContext({ window, document: { getElementById: () => null }, console,
        setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
        clearTimeout: id => timers.delete(id)
    });
    vm.runInContext(read('js/device-list.js'), sandbox);
    const api = window.DeviceList;
    api.render = () => {};
    api.list = [{ id: 'one', ip: '192.168.1.1', capabilities: {} },
        { id: 'two', ip: '192.168.1.2', capabilities: {}, voiceContinuousEnabled: false }];
    return { api, window, sandbox, messages, notices, timers };
}

test('控制端模式入口只在 VAD 卡片，默认实时、显式单次和断线禁用', () => {
    const h = harness();
    assert.match(h.api.renderVoiceVadCardHtml(h.api.list[0]), /data-voice-continuous-toggle[\s\S]*?aria-pressed="true"/);
    assert.match(h.api.renderVoiceVadCardHtml(h.api.list[1]), /aria-pressed="false"[\s\S]*?>单次监听<\/button>/);
    assert.doesNotMatch(h.api.renderVoiceControlHtml(h.api.list[0]), /data-voice-continuous-toggle/);
    h.window.WebSocketManager.ws.readyState = 3;
    assert.equal(h.api.toggleVoiceContinuous('one'), false);
    assert.equal(h.messages.length, 0);
    assert.equal(h.timers.size, 0);
    assert.match(h.api.renderVoiceVadCardHtml(h.api.list[0]), /aria-label="当前实时监听[^\n]*"\s+disabled/);
});

test('双向切换通过真实服务端保存与广播，回执前保留权威模式', () => {
    const h = harness();
    const saved = [], broadcasts = [], displayMessages = [];
    const controlSocket = { readyState: 1 };
    const displays = new Map([['one', { state: {}, ws: {} }]]);
    const service = createDisplayVoiceListeningConfig({ displays, isControl: ws => ws === controlSocket,
        persist: (display, patch) => { saved.push(patch.voiceContinuousEnabled); return true; },
        sendToDisplay: (id, data) => displayMessages.push(data), broadcast: data => broadcasts.push(data)
    });
    assert.equal(h.api.toggleVoiceContinuous('one'), true);
    assert.notEqual(h.api.list[0].voiceContinuousEnabled, false);
    assert.equal(h.api.toggleVoiceContinuous('one'), false, '重复点击不发送第二次请求');
    assert.equal(h.messages.length, 1);
    assert.equal(h.messages[0].type, 'setDisplayVoiceListeningConfig');
    assert.equal(h.messages[0].enabled, false);
    service.handle(h.messages[0], controlSocket);
    assert.equal(displayMessages[0].enabled, false);
    h.api.handleVoiceContinuousConfig(broadcasts[0]);
    assert.equal(h.api.list[0].voiceContinuousEnabled, false);
    assert.equal(h.timers.size, 0);
    h.api.toggleVoiceContinuous('one');
    service.handle(h.messages[1], controlSocket);
    h.api.handleVoiceContinuousConfig(broadcasts[1]);
    assert.equal(h.api.list[0].voiceContinuousEnabled, true);
    assert.deepEqual(saved, [false, true]);
    assert.equal(h.api.list[1].voiceContinuousEnabled, false, '另一台设备保持原值');
});

test('服务端保存失败回传旧权威值，发送异常和超时不虚构成功', () => {
    const h = harness();
    const ws = { readyState: 1, send: raw => h.api.handleVoiceContinuousConfig(JSON.parse(raw)) };
    const service = createDisplayVoiceListeningConfig({
        displays: new Map([['one', { state: { voiceContinuousEnabled: true } }]]),
        isControl: socket => socket === ws, persist: () => false,
        sendToDisplay() { assert.fail('保存失败不能下发成功'); }, broadcast() { assert.fail('保存失败不能广播成功'); }
    });
    h.api.toggleVoiceContinuous('one');
    service.handle(h.messages[0], ws);
    assert.equal(h.api.list[0].voiceContinuousEnabled, true);
    assert.equal(h.timers.size, 0);
    assert.match(h.notices.at(-1)[0], /保存失败/);
    h.window.WebSocketManager.ws.send = () => { throw new Error('连接已断'); };
    assert.equal(h.api.toggleVoiceContinuous('one'), false);
    assert.equal(h.timers.size, 0);
    h.window.WebSocketManager.ws.send = raw => h.messages.push(JSON.parse(raw));
    h.api.toggleVoiceContinuous('one');
    Array.from(h.timers.values())[0]();
    assert.equal(h.timers.size, 0);
    assert.equal(h.api.list[0].voiceContinuousEnabled, true);
    assert.match(h.notices.at(-1)[0], /重连确认/);
});

test('多端权威广播与迟到回执不误清新请求，离线及重连清理等待', () => {
    const h = harness();
    h.api.toggleVoiceContinuous('one');
    const oldRequest = h.messages[0].requestId;
    Array.from(h.timers.values())[0]();
    h.api.toggleVoiceContinuous('one');
    const currentRequest = h.messages[1].requestId;
    assert.notEqual(currentRequest, oldRequest);
    h.api.handleVoiceContinuousConfig({ displayId: 'one', enabled: false, requestId: oldRequest });
    assert.equal(h.api.voiceContinuousPending.get('one').requestId, currentRequest);
    h.api.handleVoiceContinuousConfig({ displayId: 'two', enabled: true });
    assert.equal(h.api.list[1].voiceContinuousEnabled, true);
    assert.equal(h.api.voiceContinuousPending.size, 1);
    h.api.handleVoiceContinuousDisconnected();
    assert.equal(h.timers.size, 0);
    h.api.setDisplayList([{ id: 'one', voiceContinuousEnabled: false }]);
    assert.equal(h.api.list[0].voiceContinuousEnabled, false);
    h.api.toggleVoiceContinuous('one');
    h.api.setDisplayList([]);
    assert.equal(h.api.voiceContinuousPending.size, 0);
    assert.equal(h.timers.size, 0);
});

test('WebSocket 路由权威配置，实际断线回调清除模式等待', () => {
    const h = harness();
    class Socket {
        constructor() { this.readyState = 1; }
        send() {}
    }
    h.window.location = { protocol: 'http:', host: 'localhost' };
    h.sandbox.WebSocket = Socket;
    vm.runInContext(read('js/websocket.js'), h.sandbox);
    const manager = h.window.WebSocketManager;
    manager.connect();
    h.api.toggleVoiceContinuous('one');
    manager.handleMessage({ type: 'displayVoiceListeningConfig', displayId: 'two', enabled: true });
    assert.equal(h.api.list[1].voiceContinuousEnabled, true);
    manager.ws.readyState = 3;
    manager.ws.onclose();
    assert.equal(h.api.voiceContinuousPending.size, 0);
});
