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

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((nextResolve, nextReject) => {
        resolve = nextResolve;
        reject = nextReject;
    });
    return { promise, resolve, reject };
}

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

test('暂停后切换到图片时，迟到的文本 URL 加载不得写入状态或请求 TTS', async () => {
    const delayedResponse = createDeferred();
    const requests = [];
    const player = createTextPlayerForTest({
        fetch() { return delayedResponse.promise; },
        send(message) { requests.push(message); }
    });

    const pendingLoad = player.load({ type: 'url', url: '/slow-a.txt', format: 'plain' });
    player.handleControl('pause');
    player.stop(); // 播放列表 next 切换到图片前会停止旧文本播放器。
    delayedResponse.resolve({ ok: true, text: async () => 'A 的迟到内容。' });
    await pendingLoad;

    assert.equal(player.getProgress().state, 'stopped');
    assert.equal(player.getProgress().pageTotal, 0);
    assert.equal(requests.filter((message) => message.type === 'textSentenceTts').length, 0);
});

test('文本 B 开始加载后，文本 A 的迟到结果不得覆盖 B 或触发额外 TTS', async () => {
    const responses = new Map([
        ['/slow-a.txt', createDeferred()],
        ['/fast-b.txt', createDeferred()]
    ]);
    const requests = [];
    const player = createTextPlayerForTest({
        fetch(url) { return responses.get(url).promise; },
        send(message) { requests.push(message); }
    });

    const loadA = player.load({ type: 'url', url: '/slow-a.txt', format: 'plain' });
    const loadB = player.load({ type: 'url', url: '/fast-b.txt', format: 'plain' });
    responses.get('/fast-b.txt').resolve({ ok: true, text: async () => 'B 的当前内容。' });
    await loadB;
    responses.get('/slow-a.txt').resolve({ ok: true, text: async () => 'A 的迟到内容。' });
    await loadA;

    const sentenceRequests = requests.filter((message) => message.type === 'textSentenceTts');
    assert.equal(player.getPageText(0), 'B 的当前内容。');
    assert.equal(sentenceRequests.length, 1);
    assert.equal(sentenceRequests[0].text, 'B 的当前内容。');
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
