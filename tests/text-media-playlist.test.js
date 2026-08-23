'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createTextPlayerForTest } = require('../src/apps/web-mediacenter/ui/public/js/text-media-player.js');

const DISPLAY = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/display.html');
const SERVER = path.resolve(__dirname, '../src/apps/server/boot/server-app.js');
const WEBSOCKET = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/websocket.js');
const MEDIA_LIBRARY = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/media-library.js');

const read = (file) => fs.readFileSync(file, 'utf8');

test('文本项仅在最后一页完成后通知播放列表切换', async () => {
    let completed = 0;
    const player = createTextPlayerForTest({
        width: 160,
        height: 80,
        onFinished() { completed += 1; }
    });

    await player.loadText('第一页内容\n第二页内容\n第三页内容', 'plain');
    player.start();
    while (player.getProgress().state !== 'finished') player.finishCurrentSentence();

    assert.strictEqual(completed, 1, '只有文本最后一页完成时才可进入下一播放列表项');
});

test('暂停恢复的文本列表从当前页第一句重新请求，不会直接跳到下一页', async () => {
    const requests = [];
    const player = createTextPlayerForTest({
        width: 160,
        height: 80,
        send(message) { requests.push(message); }
    });
    const data = Buffer.from('暂停恢复后仍需播报当前页。', 'utf8').toString('base64');

    await player.load({ type: 'base64', data, format: 'plain' }, { paused: true, pageIndex: 0 });
    player.handleControl('play');

    const sentenceRequest = requests.find((message) => message.type === 'textSentenceTts');
    assert.ok(sentenceRequest, '恢复播放必须请求当前页第一句 TTS');
    assert.strictEqual(sentenceRequest.pageIndex, 0);
});

test('显示端将文本项附加播放列表上下文，并由完成回调推进列表', () => {
    const display = read(DISPLAY);

    assert.match(display, /TextMediaPlayer\.attachPlaylist\(\{[\s\S]*listId:[\s\S]*index:[\s\S]*total:/);
    assert.match(display, /onFinished\(context\)[\s\S]*playlistNext\(\)/);
});

test('文本播放列表进度包含页码、句子与格式字段，并由服务端持久化恢复', () => {
    const display = read(DISPLAY);
    const server = read(SERVER);

    assert.match(display, /pageIndex:[\s\S]*pageTotal:[\s\S]*sentenceIndex:[\s\S]*sentenceTotal:[\s\S]*format:/);
    assert.match(server, /currentTextPage/);
    assert.match(server, /resumeTextPage/);
    assert.match(server, /pageIndex: data\.pageIndex/);
});

test('控制端显示文本文件与页码进度，并保留非文本裁剪预览行为', () => {
    const websocket = read(WEBSOCKET);
    const mediaLibrary = read(MEDIA_LIBRARY);

    assert.match(websocket, /pageIndex: currentPlaylist\.currentTextPage/);
    assert.match(mediaLibrary, /媒体Type === 'text'|mediaType === 'text'/);
    assert.match(mediaLibrary, /第 .*\/.* 页|pageTotal/);
});
