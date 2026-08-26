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
