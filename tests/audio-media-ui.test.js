'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const readPublic = (file) => fs.readFileSync(path.join(PUBLIC, file), 'utf8');

test('控制端上传入口允许 wav/ogg/mp3', () => {
    const html = readPublic('upload.html');
    const upload = readPublic('js/upload.js');
    assert.match(html, /audio\/\*,\.wav,\.ogg,\.mp3/);
    assert.match(upload, /\['wav', 'ogg', 'mp3'\]/);
});

test('控制端处理 audioProgress 并把播放控制称为媒体播放', () => {
    const websocket = readPublic('js/websocket.js');
    const controls = readPublic('js/controls.js');
    const html = readPublic('upload.html');
    const server = fs.readFileSync(path.resolve(__dirname, '../src/apps/server/boot/server-app.js'), 'utf8');
    assert.match(websocket, /data\.type === 'audioProgress'/);
    assert.match(controls, /sendControl\('seek'/);
    assert.match(html, />媒体播放</);
    assert.match(server, /'wav': 'audio\/wav'/);
    assert.match(server, /'ogg': 'audio\/ogg'/);
    assert.match(server, /'mp3': 'audio\/mpeg'/);
});

test('显示端提供 audio 节点和独立音频媒体分支', () => {
    const display = readPublic('display.html');
    assert.match(display, /id="mediaAudio"/);
    assert.match(display, /data\.mediaType === 'audio'/);
    assert.match(display, /audioProgress/);
});

test('裁剪预览对 audio 使用占位提示而不是图片解码', () => {
    const crop = readPublic('js/crop.js');
    assert.match(crop, /mediaType === 'audio'/);
    assert.match(crop, /showPreview\(url, mediaType, onReady, displayName\)/);
    assert.match(crop, /this\.placeholder\.textContent = fileName/);
    assert.match(crop, /_extractPreviewFileName\(url\)/);
});

test('批量音频预览使用当前文件名，睡眠自动 next 不推进而手动 next 临时激活', () => {
    const crop = readPublic('js/crop.js');
    const mediaLibrary = readPublic('js/media-library.js');
    const display = readPublic('display.html');
    const playlistNext = display.match(/function playlistNext\(\) \{([\s\S]*?)\n        \}/);
    const manualNext = display.match(/case 'next':([\s\S]*?)break;/);

    assert.ok(playlistNext, '应存在 playlistNext 函数');
    assert.ok(manualNext, '应存在批量手动 next 分支');
    assert.match(playlistNext[1], /isSleepPaused\(\)/);
    assert.match(manualNext[1], /activateTemporarily\(\)/);
    assert.match(manualNext[1], /playlistNext\(\)/);
    assert.match(mediaLibrary, /item\.fileName/);
    assert.match(crop, /displayName \|\| this\._extractPreviewFileName\(url\)/);
});

test('控制端刷新后从显示端当前播放状态恢复批量文件名', () => {
    const websocket = readPublic('js/websocket.js');
    const server = fs.readFileSync(path.resolve(__dirname, '../src/apps/server/boot/server-app.js'), 'utf8');
    const crop = readPublic('js/crop.js');

    assert.match(websocket, /data\.state\.currentPlaylist/);
    assert.match(websocket, /renderPlaylistPanel\(.*currentPlaylist/s);
    assert.match(server, /playlist\.map\(item => \(\{/);
    assert.match(server, /currentPlaylist[\s\S]*temp/);
    assert.match(crop, /decodeURIComponent\(rawName\)\.split\('\/'\)/);
});

test('音频自动播放绕过策略并在睡眠唤醒后恢复批量生命周期', () => {
    const display = readPublic('display.html');
    assert.match(display, /audio\.muted = true/);
    assert.match(display, /ps\.timer = null[\s\S]*isSleepPaused\(\)/);
    assert.match(display, /function resumePlaylistAfterSleep\(\)/);
});
