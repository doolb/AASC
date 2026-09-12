'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const server = read('src/apps/server/boot/server-app.js');
const config = read('src/apps/server/modules/config/config-app-service.js');
const upload = read('src/apps/web-mediacenter/ui/public/upload.html');
const websocket = read('src/apps/web-mediacenter/ui/public/js/websocket.js');
const display = read('src/apps/web-mediacenter/ui/public/display.html');

test('服务端通过 AASC WebSocket 持久化并广播显示端代码检测配置', () => {
    assert.match(config, /display:\s*\{[\s\S]*versionCheckIntervalMs:\s*30000/u);
    assert.match(server, /DEFAULT_DISPLAY_VERSION_INTERVAL_MS\s*=\s*30000/u);
    assert.match(server, /MIN_DISPLAY_VERSION_INTERVAL_MS\s*=\s*5000/u);
    assert.match(server, /MAX_DISPLAY_VERSION_INTERVAL_MS\s*=\s*300000/u);
    assert.match(server, /updateDisplayVersionConfig/u);
    assert.match(server, /displayVersionConfig/u);
    assert.match(server, /config\.set\(['"]display\.versionCheckIntervalMs['"]/u);
    assert.match(server, /displayClients\.forEach\([\s\S]*sendToDisplay[\s\S]*displayVersionConfig/u);
    assert.doesNotMatch(server, /app\.(get|post)\(['"]\/api\/display-version-config['"]/u);
});

test('控制端通过 WebSocket 展示并保存显示端代码检测间隔', () => {
    assert.match(upload, /displayVersionIntervalInput/u);
    assert.match(upload, /saveDisplayVersionConfig/u);
    assert.match(upload, /type:\s*['"]updateDisplayVersionConfig['"]/u);
    assert.match(websocket, /data\.type === ['"]displayVersionConfig['"]/u);
    assert.match(websocket, /Settings\.handleDisplayVersionConfig/u);
    assert.doesNotMatch(upload, /fetch\(['"]\/api\/display-version-config['"]/u);
});

test('显示端接收远端配置后按新间隔重新调度版本检查', () => {
    assert.match(display, /data\.type === ['"]displayVersionConfig['"]/u);
    assert.match(display, /clearTimeout\(displayVersionWatchTimer\)/u);
    assert.match(display, /displayVersionIntervalMs\s*=\s*normalize/u);
    assert.match(display, /setTimeout\(watchDisplayVersion, displayVersionIntervalMs\)/u);
});
