'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('批量设置弹窗提供五类 mediaTypes 复选框且默认全选', () => {
    const mediaLibrary = read('src/apps/web-mediacenter/ui/public/js/media-library.js');

    assert.match(mediaLibrary, /媒体类型/);
    assert.match(mediaLibrary, /value="text"[\s\S]*checked/);
    assert.match(mediaLibrary, /value="audio"[\s\S]*checked/);
    assert.match(mediaLibrary, /value="image"[\s\S]*checked/);
    assert.match(mediaLibrary, /value="video"[\s\S]*checked/);
    assert.match(mediaLibrary, /value="web"[\s\S]*checked/);
});

test('控制端 playlistRequest 只上报 mediaTypes，不在弹窗确认阶段做文件筛选', () => {
    const mediaLibrary = read('src/apps/web-mediacenter/ui/public/js/media-library.js');
    const dialogStart = mediaLibrary.indexOf('showPlaylistSettingsDialog(options = {})');
    const dialogEnd = mediaLibrary.indexOf('// 媒体面板「发送 HTML」', dialogStart);
    const dialogBlock = mediaLibrary.slice(dialogStart, dialogEnd);

    assert.match(dialogBlock, /mediaTypes:\s*Array\.from\(mask\.querySelectorAll\('input\[name="plMediaType"\]:checked'\)\)/);
    assert.doesNotMatch(dialogBlock, /onConfirm[\s\S]*filter\(/);
});

test('server-app 将 mediaTypes 透传给 library 与 temp 两条 PlaylistManager 路径', () => {
    const server = read('src/apps/server/boot/server-app.js');

    assert.match(server, /playlistManager\.buildFromTemp\(data\.files \|\| \[\], \{[\s\S]*mediaTypes: data\.mediaTypes/);
    assert.match(server, /playlistManager\.buildFromLibrary\(data\.libraryId, data\.path, \{[\s\S]*mediaTypes: data\.mediaTypes/);
});
