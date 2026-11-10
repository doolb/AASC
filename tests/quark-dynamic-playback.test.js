'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../src/apps/web-mediacenter/ui/public/display.html'), 'utf8');
const start = html.indexOf('function requestNextPlaylistDirectory(');
const end = html.indexOf('function playlistPrev(', start);

test('显示端到达目录末尾仅请求一次下一目录，暂停时不发送请求', () => {
    const messages = [];
    const state = { active: true, paused: false, dynamic: true, dynamicBatch: 0, waitingNext: false, listId: 'pl-1', playlist: [{fileName: 'a'}], index: 0 };
    const context = vm.createContext({ playlistState: state, displayWs: { readyState: 1, send: data => messages.push(JSON.parse(data)) }, WebSocket: { OPEN: 1 }, isSleepPaused: () => false, cancelPlaylistCache: () => {}, clearTimeout, setTimeout, playCurrentItem: () => {}, finishPlaylist: () => { throw Error('不应结束'); } });
    vm.runInContext(html.slice(start, end), context);
    context.playlistNext();
    context.playlistNext();
    assert.deepEqual(messages, [{ type: 'playlistNeedNext', listId: 'pl-1', dynamicBatch: 0, index: 0 }]);
    state.waitingNext = false;
    state.paused = true;
    context.playlistNext();
    assert.equal(messages.length, 1);
});

test('服务端收到显示端请求后保存下一目录，停止后的异步结果不会继续播放', async () => {
    const server = fs.readFileSync(path.join(__dirname, '../src/apps/server/boot/server-app.js'), 'utf8');
    const begin = server.indexOf('const dynamicPlaylistLoading = new WeakSet();');
    const finish = server.indexOf('function sendToDisplay(', begin);
    const sent = [];
    const ws = {};
    const state = { index: 0, state: 'playing', startData: { listId: 'pl', dynamicBatch: 0, dynamicCursor: { stack: ['/next'] } } };
    const display = { ws, state: { currentPlaylist: state } };
    let resolveBatch;
    const context = vm.createContext({ displayClients: new Map([['d', display]]), nextDynamicPlaylistBatch: () => new Promise(resolve => { resolveBatch = resolve; }), persistDisplayState: () => {}, sendToDisplay: (id, msg) => sent.push(msg), logError: () => {} });
    vm.runInContext(server.slice(begin, finish), context);
    const pending = context.advanceDynamicPlaylist('d', { listId: 'pl', dynamicBatch: 0, index: 0 }, ws);
    resolveBatch({ playlist: [{fileName: 'next.jpg'}], cursor: { stack: [] } });
    await pending;
    assert.equal(state.startData.dynamicBatch, 1);
    assert.equal(sent[0].type, 'playlistStart');
    assert.equal(sent[0].playlist[0].fileName, 'next.jpg');
    const pendingStopped = context.advanceDynamicPlaylist('d', { listId: 'pl', dynamicBatch: 1, index: 0 }, ws);
    display.state.currentPlaylist = null;
    resolveBatch({ playlist: [{fileName: 'late.jpg'}], cursor: { stack: [] } });
    await pendingStopped;
    assert.equal(sent.length, 1);
});
