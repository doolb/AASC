'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { PlaylistManager } = require('../src/apps/web-mediacenter/modules/media/playlist-app-service');

const source = fs.readFileSync(require.resolve('../src/apps/server/boot/server-app.js'), 'utf8');
const branch = source.indexOf("} else if (data.type === 'playlistRequest' || data.type === 'playlistUrlRequest') {");
const start = source.indexOf('(async () => {', branch);
const end = source.indexOf('\n                    return;\n                } else if (data.type === \'playlistControl\')', start);
if (branch < 0 || start < 0 || end < 0) throw new Error('未找到播放列表消息处理分支');
const handler = source.slice(start, end).trim();

async function dispatch(data) {
    const display = { state: {} }, sent = [], replies = [], persisted = [];
    const context = {
        data, ws: { send: value => replies.push(JSON.parse(value)) },
        displayClients: new Map([['screen-1', display]]),
        playlistManager: new PlaylistManager({ list: async () => [] }),
        buildTextPlaylistVoiceRoutes: ids => ({ selectedDisplayIds: ids, selectedVoiceDisplayIds: [], voiceRouteByDisplayId: {} }),
        buildTextVoiceRoute: () => ({ selectedDisplayIds: [], selectedVoiceDisplayIds: [] }),
        textMediaTtsService: { setDisplayRoute() {} },
        persistDisplayState: (_display, state) => persisted.push(state),
        sendToDisplay: (id, message) => sent.push({ id, message }), logError() {},
        Date, Math, JSON
    };
    await vm.runInNewContext(handler, context);
    return { display, sent, replies, persisted };
}

test('URL 列表按顺序启动并保存普通播放列表状态', async () => {
    const urls = [
        { url: 'http://192.168.1.39:3089/api/proxy?url=https%3A%2F%2Fexample.com%2Fone.jpg', fileName: '图片', mediaType: 'image' },
        { url: 'http://192.168.1.39:3089/api/storage/file?path=site%2Fvideo.mp4', fileName: '视频', mediaType: 'video' }
    ];
    const result = await dispatch({ type: 'playlistUrlRequest', displayIds: ['screen-1'], urls, loop: true, interval: 5 });
    assert.equal(result.replies[0].type, 'playlistStarted'); assert.equal(result.replies[0].total, 2);
    assert.equal(result.sent[0].message.type, 'playlistStart'); assert.equal(result.sent[0].message.loop, true);
    assert.deepEqual(Array.from(result.sent[0].message.playlist, item => item.url), urls.map(item => item.url));
    assert.equal(result.display.state.currentPlaylist.temp, false);
    assert.equal(result.persisted.at(-1).currentPlaylist.startData.playlist[1].url, urls[1].url);
    assert.equal(result.sent[0].message.playlist.some(item => 'data' in item), false);
});

test('URL 列表无效或混入临时文件时不会启动或持久化', async () => {
    for (const data of [
        { type: 'playlistUrlRequest', displayIds: ['screen-1'], urls: [{ url: 'file:///secret', mediaType: 'image' }] },
        { type: 'playlistUrlRequest', displayIds: ['screen-1'], urls: [{ url: 'https://example.com/a', mediaType: 'image' }], temp: true },
        { type: 'playlistUrlRequest', displayIds: ['screen-1'] }
    ]) {
        const result = await dispatch(data);
        assert.equal(result.replies[0].type, 'playlistError');
        assert.equal(result.sent.length, 0); assert.equal(result.persisted.length, 0);
    }
});
