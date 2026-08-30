'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DISPLAY = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/display.html');

const readDisplay = () => fs.readFileSync(DISPLAY, 'utf8');

test('显示端重连只保留一个定时器并隔离过期 WebSocket 回调', () => {
    const display = readDisplay();

    assert.match(display, /let displayReconnectTimer = null/);
    assert.match(display, /displayReconnectTimer !== null/);
    assert.match(display, /socket = new WebSocket\(wsUrl\)/);
    assert.match(display, /function isCurrentDisplaySocket\(socket\)/);
    assert.match(display, /displayWs === socket/);
    assert.match(display, /displayReconnectTimer = null/);
});

test('显示端页面离开时取消重连并关闭当前连接', () => {
    const display = readDisplay();

    assert.match(display, /addEventListener\(['"]pagehide['"]/);
    assert.match(display, /clearTimeout\(displayReconnectTimer\)/);
    assert.match(display, /displayReconnectTimer = null/);
    assert.match(display, /socket\.close\(/);
});

test('显示端每次 WebSocket 重连后重新检查 ASR 并在未就绪时重试', () => {
    const display = readDisplay();
    const onOpenStart = display.indexOf('socket.onopen = function()');
    const onMessageStart = display.indexOf('socket.onmessage = function(event)', onOpenStart);
    const onOpen = display.slice(onOpenStart, onMessageStart);
    const asrCheckStart = display.indexOf('async function checkAsrStatus()');
    const asrCheckEnd = display.indexOf('// 所有网页端 ASR/声纹录音统一使用共享 PCM 采集器', asrCheckStart);
    const asrCheck = display.slice(asrCheckStart, asrCheckEnd);

    assert.match(onOpen, /checkAsrStatus\(\)/, 'WebSocket 重连成功后应重新检查 ASR');
    assert.match(asrCheck, /scheduleAsrStatusRetry\(\)/, 'ASR 未就绪时应安排重试');
    assert.match(display, /function clearAsrStatusRetryTimer\(\)/);
    assert.match(display, /setTimeout\(\(\) => checkAsrStatus\(\),/);
});

test('显示端 WebSocket error 事件也会清理连接并进入重连', () => {
    const display = readDisplay();
    const onErrorStart = display.indexOf('socket.onerror = function(error)');
    const onErrorEnd = display.indexOf('\n        }\n\n        window.addEventListener(\'pagehide\'', onErrorStart);
    const onError = display.slice(onErrorStart, onErrorEnd);

    assert.match(onError, /displayWs = null/);
    assert.match(onError, /scheduleDisplayReconnect\(\)/);
    assert.match(display, /clearAsrStatusRetryTimer\(\)/);
});
