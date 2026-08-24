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

test('临时批量播放由服务端回传最终 playlist 元数据，并按 tempPreviewKey 对齐控制端预览顺序', () => {
    const server = read('src/apps/server/boot/server-app.js');
    const websocket = read('src/apps/web-mediacenter/ui/public/js/websocket.js');
    const mediaLibrary = read('src/apps/web-mediacenter/ui/public/js/media-library.js');
    const tempPreviewHelper = read('src/apps/web-mediacenter/ui/public/js/temp-playlist-preview.js');
    const uploadHtml = read('src/apps/web-mediacenter/ui/public/upload.html');

    assert.match(server, /const tempPlaylistMetadata = data\.temp \? playlist\.map\(item => \(\{/);
    assert.match(server, /type: 'playlistStarted'[\s\S]*temp: !!data\.temp[\s\S]*playlist: tempPlaylistMetadata/);
    assert.match(server, /tempPreviewKey: item\.tempPreviewKey/);
    assert.match(websocket, /data\.type === 'playlistStarted'[\s\S]*data\.temp[\s\S]*data\.playlist/);
    assert.match(uploadHtml, /js\/temp-playlist-preview\.js/);
    assert.match(mediaLibrary, /handleTempPlaylistStarted\(playlist\)/);
    assert.match(mediaLibrary, /TempPlaylistPreview\.buildServerOrderedFiles/);
    assert.match(mediaLibrary, /TempPlaylistPreview\.findCachedFile/);
    assert.match(tempPreviewHelper, /tempPreviewKey/);
    assert.match(tempPreviewHelper, /buildServerOrderedFiles/);
    assert.match(tempPreviewHelper, /findCachedFile/);
});
