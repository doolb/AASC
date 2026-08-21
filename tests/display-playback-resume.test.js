'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DISPLAY = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/display.html');
const SERVER = path.resolve(__dirname, '../src/apps/server/boot/server-app.js');
const CONFIG = path.resolve(__dirname, '../src/apps/server/modules/config/config-app-service.js');

const read = (file) => fs.readFileSync(file, 'utf8');

test('单媒体恢复状态携带并应用缓存播放进度', () => {
    const display = read(DISPLAY);
    const server = read(SERVER);
    const config = read(CONFIG);

    assert.match(config, /currentMediaProgress/);
    assert.match(server, /currentMediaProgress/);
    assert.match(server, /data\.currentTime/);
    assert.match(display, /state\.currentMediaProgress/);
    assert.match(display, /showMedia\(\s*state\.currentMedia,[\s\S]*currentMediaProgress/);
    assert.match(display, /loadedmetadata[\s\S]*currentTime/);
});

test('批量重连恢复当前项时间和暂停状态', () => {
    const display = read(DISPLAY);
    const server = read(SERVER);

    assert.match(server, /resumeIndex:[\s\S]*currentPlaylist\.index/);
    assert.match(server, /resumeTime:[\s\S]*currentPlaylist\.currentTime/);
    assert.match(server, /resumeState:[\s\S]*currentPlaylist\.state/);
    assert.match(server, /currentPlaylist\.currentTime/);
    assert.match(display, /data\.resumeTime/);
    assert.match(display, /data\.resumeState/);
    assert.match(display, /playlistProgress[\s\S]*currentTime[\s\S]*duration/);
    assert.match(display, /showMedia\(mediaData, true, ps\.paused/);
});

test('播放进度更新有节流持久化并在暂停时强制同步', () => {
    const server = read(SERVER);

    assert.match(server, /displayProgressPersistAt/);
    assert.match(server, /Date\.now\(\)/);
    assert.match(server, /force[\s\S]*config\.updateDisplayState/);
});
