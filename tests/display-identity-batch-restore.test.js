'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const childProcess = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('显示端状态提供按 displayId 读取和更新的接口', () => {
    const config = read('src/apps/server/modules/config/config-app-service.js');
    const server = read('src/apps/server/boot/server-app.js');

    assert.match(config, /getDisplayStateById\s*\(/);
    assert.match(config, /updateDisplayStateById\s*\(/);
    assert.match(config, /states\[displayId\]/);
    assert.match(server, /config\.getDisplayStateById\(displayId, clientIP\)/);
    assert.match(server, /config\.updateDisplayStateById\(displayData\.displayId, displayData\.ip/);
});

test('同一 IP 的 Agent 和真实显示端状态按 displayId 分离', () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-display-state-'));
    const script = [
        "const config = require('./src/apps/server/modules/config/config-app-service');",
        "config.updateDisplayState('127.0.0.1', { currentMedia: { url: 'agent-media' } });",
        "const agent = config.getDisplayStateById('agent-local', '127.0.0.1');",
        "const display = config.updateDisplayStateById('display-main', '192.168.1.39', { fit: 'cover' });",
        "const agentAfterDisplay = config.getDisplayStateById('agent-local', '127.0.0.1');",
        "process.stdout.write(JSON.stringify({ agent, display, agentAfterDisplay }));"
    ].join('\n');
    const result = childProcess.spawnSync(process.execPath, ['-e', script], {
        cwd: ROOT,
        env: { ...process.env, HOME: tempHome },
        encoding: 'utf8'
    });

    assert.strictEqual(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.agent.displayId, 'agent-local');
    assert.strictEqual(output.agent.currentMedia.url, 'agent-media');
    assert.strictEqual(output.display.displayId, 'display-main');
    assert.strictEqual(output.display.fit, 'cover');
    assert.strictEqual(output.agentAfterDisplay.currentMedia.url, 'agent-media');
});

test('批量重连先恢复通用设置再恢复播放列表断点', () => {
    const server = read('src/apps/server/boot/server-app.js');
    const connectionBlockStart = server.indexOf('        // 批量播放也必须先恢复通用显示设置');
    const connectionBlockEnd = server.indexOf('        broadcastDisplayList();', connectionBlockStart);
    const connectionBlock = server.slice(connectionBlockStart, connectionBlockEnd);

    assert.ok(connectionBlockStart >= 0, '应存在显示端重连恢复分支');
    assert.match(connectionBlock, /type: 'restoreState'/);
    assert.match(connectionBlock, /type: 'playlistStart'/);
    assert.ok(
        connectionBlock.indexOf("type: 'restoreState'") < connectionBlock.indexOf("type: 'playlistStart'"),
        '通用设置必须在批量列表之前恢复'
    );
});

test('控制端切换显示端时清理旧批量状态并按当前状态恢复', () => {
    const deviceList = read('src/apps/web-mediacenter/ui/public/js/device-list.js');
    const websocket = read('src/apps/web-mediacenter/ui/public/js/websocket.js');
    const mediaLibrary = read('src/apps/web-mediacenter/ui/public/js/media-library.js');

    assert.match(deviceList, /clearPlaylistPanel\(\)/);
    assert.match(websocket, /currentPlaylist[\s\S]*clearPlaylistPanel\(\)/);
    assert.match(mediaLibrary, /clearPlaylistPanel\s*\(\)/);
    assert.match(mediaLibrary, /clearPlaylistPanel[\s\S]*renderPlaylistPanel/);
});

test('显示端列表同时展示稳定身份和连接 IP，便于区分本机 Agent', () => {
    const deviceList = read('src/apps/web-mediacenter/ui/public/js/device-list.js');
    const server = read('src/apps/server/boot/server-app.js');

    assert.match(server, /id: displayId/);
    assert.match(server, /ip: data\.ip/);
    assert.match(deviceList, /display\.id/);
    assert.match(deviceList, /display\.ip/);
});
