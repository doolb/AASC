'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeDisplayMediaMessage } = require('../src/apps/server/modules/media/display-media-payload');

const ROOT = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const proxyUrl = url => `/api/media-proxy?url=${encodeURIComponent(url)}`;

test('HTTPS 单媒体保持原始 HTTP 直连，代理只作为备用且不修改输入', () => {
    const input = { type: 'url', url: 'http://media.example/video.mp4', mediaType: 'video' };
    const output = normalizeDisplayMediaMessage(input, true);

    assert.notStrictEqual(output, input);
    assert.equal(output.url, input.url);
    assert.equal(output.fallbackUrl, proxyUrl(input.url));
    assert.equal(input.fallbackUrl, undefined);
});

test('保留有效的 HTTPS 或相对备用地址，并把 HTTP 备用地址转为同源代理', () => {
    const httpsFallback = normalizeDisplayMediaMessage({
        type: 'url', url: 'http://media.example/a.mp4', fallbackUrl: 'https://backup.example/a.mp4'
    }, true);
    const relativeFallback = normalizeDisplayMediaMessage({
        type: 'url', url: 'http://media.example/b.mp4', fallbackUrl: '/library/proxy/b.mp4'
    }, true);
    const httpFallback = normalizeDisplayMediaMessage({
        type: 'url', url: 'https://media.example/c.mp4', fallbackUrl: 'http://backup.example/c.mp4'
    }, true);

    assert.equal(httpsFallback.url, 'http://media.example/a.mp4');
    assert.equal(httpsFallback.fallbackUrl, 'https://backup.example/a.mp4');
    assert.equal(relativeFallback.fallbackUrl, '/library/proxy/b.mp4');
    assert.equal(httpFallback.url, 'https://media.example/c.mp4');
    assert.equal(httpFallback.fallbackUrl, proxyUrl('http://backup.example/c.mp4'));
});

test('恢复旧版已重写的代理主地址时还原直连优先顺序', () => {
    const oldProxy = proxyUrl('http://media.example/old.mp4');
    const output = normalizeDisplayMediaMessage({ type: 'url', url: oldProxy }, true);
    const externalProxy = 'https://other.example/api/media-proxy?url=http%3A%2F%2Fprivate.example%2Fsecret.mp4';
    const external = normalizeDisplayMediaMessage({ type: 'url', url: externalProxy }, true);

    assert.equal(output.url, 'http://media.example/old.mp4');
    assert.equal(output.fallbackUrl, oldProxy);
    assert.equal(external.url, externalProxy);
    assert.equal(external.fallbackUrl, undefined);
});

test('playlistStart 的 URL 条目逐项规范化，Base64 和临时媒体保持不变', () => {
    const input = {
        type: 'playlistStart',
        playlist: [
            { type: 'url', url: 'http://media.example/a.mp4' },
            { type: 'base64', data: 'data:video/mp4;base64,AA==' },
            { type: 'url', url: 'http://media.example/temp.mp4', temp: true }
        ]
    };
    const output = normalizeDisplayMediaMessage(input, true);

    assert.equal(output.playlist[0].url, input.playlist[0].url);
    assert.equal(output.playlist[0].fallbackUrl, proxyUrl(input.playlist[0].url));
    assert.deepEqual(output.playlist[1], input.playlist[1]);
    assert.deepEqual(output.playlist[2], input.playlist[2]);
    assert.equal(input.playlist[0].fallbackUrl, undefined);
});

test('restoreState 的当前媒体与播放列表都规范化，但不污染原状态', () => {
    const input = {
        type: 'restoreState',
        state: {
            currentMedia: { type: 'url', url: 'http://media.example/current.mp4' },
            currentPlaylist: {
                index: 1,
                startData: {
                    playlist: [
                        { type: 'url', url: 'http://media.example/one.mp4' },
                        { type: 'url', url: 'https://media.example/two.mp4' }
                    ]
                }
            }
        }
    };
    const output = normalizeDisplayMediaMessage(input, true);

    assert.equal(output.state.currentMedia.url, input.state.currentMedia.url);
    assert.equal(output.state.currentMedia.fallbackUrl, proxyUrl(input.state.currentMedia.url));
    assert.equal(output.state.currentPlaylist.startData.playlist[0].fallbackUrl,
        proxyUrl(input.state.currentPlaylist.startData.playlist[0].url));
    assert.equal(output.state.currentPlaylist.startData.playlist[1].fallbackUrl, undefined);
    assert.equal(input.state.currentMedia.fallbackUrl, undefined);
    assert.equal(input.state.currentPlaylist.startData.playlist[0].fallbackUrl, undefined);
});

test('HTTP 服务器和非 HTTP 地址不生成不必要代理', () => {
    const httpServer = normalizeDisplayMediaMessage({ type: 'url', url: 'http://media.example/a.mp4' }, false);
    const secure = normalizeDisplayMediaMessage({ type: 'url', url: 'https://media.example/b.mp4' }, true);
    const relative = normalizeDisplayMediaMessage({ type: 'url', url: '/library/a.mp4' }, true);

    assert.equal(httpServer.url, 'http://media.example/a.mp4');
    assert.equal(httpServer.fallbackUrl, undefined);
    assert.equal(secure.fallbackUrl, undefined);
    assert.equal(relative.fallbackUrl, undefined);
});

test('清除与直连相同或无效的备用地址', () => {
    const duplicate = normalizeDisplayMediaMessage({
        type: 'url', url: 'https://media.example/a.mp4', fallbackUrl: 'https://media.example/a.mp4'
    }, true);
    const invalid = normalizeDisplayMediaMessage({
        type: 'url', url: 'https://media.example/b.mp4', fallbackUrl: 'null'
    }, true);

    assert.equal(duplicate.fallbackUrl, undefined);
    assert.equal(invalid.fallbackUrl, undefined);
});

test('实时下发和重连恢复都使用同一媒体消息规范化入口', () => {
    const server = read('src/apps/server/boot/server-app.js');
    const sendToDisplayStart = server.indexOf('function sendToDisplay(');
    const sendToDisplayEnd = server.indexOf('\n}', sendToDisplayStart);
    const sendBlock = server.slice(sendToDisplayStart, sendToDisplayEnd);
    const reconnectStart = server.indexOf('// 批量播放也必须先恢复通用显示设置');
    const reconnectEnd = server.indexOf('broadcastDisplayList();', reconnectStart);
    const reconnectBlock = server.slice(reconnectStart, reconnectEnd);

    assert.match(sendBlock, /normalizeDisplayMediaMessage\(data, useHttps\)/);
    assert.match(reconnectBlock, /normalizeDisplayMediaMessage\(\{[\s\S]*type: 'restoreState'/);
    assert.match(reconnectBlock, /normalizeDisplayMediaMessage\(\{[\s\S]*type: 'playlistStart'/);
});
