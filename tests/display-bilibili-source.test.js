'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { DISPLAY_BILIBILI_ID, createDisplayBilibiliSource } = require('../src/apps/server/modules/media/display-bilibili-source');
const { listDisplayLibraries, createDisplayLocalRouter, createDisplayPlaylistRequestHandler } = require('../src/apps/server/modules/media/display-local-media');

test('显示端首页和相关推荐使用有限快照，播放只解析权威列表视频', async () => {
    let calls = 0, now = 0;
    const service = { getVideos: () => [], handle: async (_ws, data) => { assert.equal(data.url, 'https://www.bilibili.com/video/BVabcdefghij?p=2'); } };
    const source = createDisplayBilibiliSource({ getService: () => service, getFolders: () => ({}), now: () => now,
        getDiscovery: () => ({ home: async () => { calls++; return { videos: [{ bvid: 'BVabcdefghij', title: '热门' }] }; },
            related: async () => ({ videos: [{ bvid: 'BVabcdefghij' }, { bvid: 'BVklmnopqrst', title: '推荐' }] }) }) });
    const home = await source.list('/d:home');
    assert.equal(home[0].name, '热门');
    assert.equal((await source.playlist('/d:home'))[0].url, '/api/bilibili/dash/BVabcdefghij?p=1');
    assert.equal(calls, 1);
    const related = await source.list('/d:related:BVabcdefghij:2');
    assert.equal(related.length, 2); assert.equal(related[0].page, 2); assert.equal(related[1].name, '推荐');
    await source.add('BVabcdefghij', 2);
    await assert.rejects(source.list('/d:related:invalid:1'), /不存在/);
    now = 60001; await source.playlist('/d:home'); assert.equal(calls, 1, '播放仍使用已展示的快照');
    await source.list('/d:home'); assert.equal(calls, 2);
    await assert.rejects(source.add('BVabcdefghij?p=3', 1), /ID 无效/);
});

test('显示端本机加入 B 站视频接口读取并校验 JSON', async t => {
    const service = { getVideos: () => [], handle: async (_ws, data) => { assert.equal(data.url, 'https://www.bilibili.com/video/BVabcdefghij?p=2'); } };
    const source = createDisplayBilibiliSource({ getService: () => service, getFolders: () => ({}) });
    const app = express();
    app.use('/api/display-local', createDisplayLocalRouter({ mediaLibraryManager: { listLibraries: () => [], listTaskMediaSources: () => [] }, bilibiliSource: source }));
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const post = body => fetch(`http://127.0.0.1:${server.address().port}/api/display-local/bilibili/add`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    assert.equal((await post({ bvid: 'BVabcdefghij', page: 2 })).status, 200);
    assert.equal((await post({ bvid: 'invalid', page: 1 })).status, 400);
});

test('显示端浏览已保存 B 站分类与收藏，单项和批量使用权威同源地址', async t => {
    const collection = 'https://www.bilibili.com/list/ml123';
    const service = {
        getVideos: () => [
            { bvid: 'BVabcdefghij', page: 1, title: '根视频', url: 'https://www.bilibili.com/video/BVabcdefghij' },
            { bvid: 'BVklmnopqrst', page: 2, title: '分类视频', url: 'https://www.bilibili.com/video/BVklmnopqrst?p=2' },
            { collection: true, title: '收藏', url: collection }
        ],
        getCollection: async url => { assert.equal(url, collection); return { videos: [{ bvid: 'BVuvwxyz1234', page: 3, title: '收藏分集' }] }; }
    };
    const source = createDisplayBilibiliSource({ getService: () => service, getFolders: () => ({
        folders: [{ id: 'group/1', name: '分类' }], entries: { 'https://www.bilibili.com/video/BVklmnopqrst?p=2': 'group/1', [collection]: 'group/1' }
    }) });
    const root = await source.list('/');
    assert.deepEqual(root.map(item => item.name), ['分类', '根视频']);
    const folder = await source.list(root[0].path);
    assert.deepEqual(folder.map(item => item.name), ['分类视频', '收藏']);
    const collectionItems = await source.list(folder[1].path);
    assert.equal(collectionItems[0].url, '/api/bilibili/dash/BVuvwxyz1234?p=3');
    await assert.rejects(source.list('/c:aHR0cHM6Ly9ldmlsLnRlc3Q'), /不存在/);

    const manager = { listLibraries: () => [{ id: 'q', name: '夸克', type: 'quark', readonly: true }], listTaskMediaSources: () => [] };
    assert.deepEqual(listDisplayLibraries(manager, { includeBilibili: true }).map(item => item.type), ['quark', 'bilibili']);
    const app = express();
    app.use('/api/display-local', createDisplayLocalRouter({ mediaLibraryManager: manager, bilibiliSource: source }));
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const base = `http://127.0.0.1:${server.address().port}/api/display-local`;
    const result = await (await fetch(`${base}/list?libraryId=${DISPLAY_BILIBILI_ID}&path=${encodeURIComponent(folder[1].path)}`)).json();
    assert.equal(result.entries[0].directUrl, '/api/bilibili/dash/BVuvwxyz1234?p=3');

    const ws = { _socket: { remoteAddress: '127.0.0.1' }, send: () => {} };
    const display = { ws, state: {} };
    const sent = [];
    const handler = createDisplayPlaylistRequestHandler({
        getLibraries: () => listDisplayLibraries(manager, { includeBilibili: true }),
        buildPlaylist: (id, path) => source.playlist(path), getDisplayData: () => display,
        persist: () => {}, sendToDisplay: (id, message) => sent.push(message)
    });
    await handler('display1', { type: 'displayPlaylistCancel', libraryId: DISPLAY_BILIBILI_ID, path: collectionItems[0].path, requestId: 'single', url: 'https://evil.test' }, ws);
    assert.equal(sent[0].media.url, '/api/bilibili/dash/BVuvwxyz1234?p=3');
    assert.equal(sent[0].media.bilibiliMp4, '/api/bilibili/video/BVuvwxyz1234?p=3');
    assert.equal(sent[0].media.bilibiliDash, true);
    await handler('display1', { type: 'displayPlaylistRequest', libraryId: DISPLAY_BILIBILI_ID, path: folder[1].path, requestId: 'batch' }, ws);
    assert.equal(sent[1].playlist[0].bilibiliDash, true);
});

test('夸克分享目录和播放仅暴露服务端同源代理，不泄露源地址', async t => {
    const manager = {
        listLibraries: () => [{ id: 'quark1', name: '分享', type: 'quark', readonly: true }],
        listTaskMediaSources: () => [],
        list: async () => [{ name: '电影.mp4', path: '/电影.mp4', type: 'file', mediaType: 'video', url: 'https://secret.example/video?token=secret' }]
    };
    const app = express();
    app.use('/api/display-local', createDisplayLocalRouter({ mediaLibraryManager: manager }));
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const response = await (await fetch(`http://127.0.0.1:${server.address().port}/api/display-local/list?libraryId=quark1&path=%2F`)).json();
    assert.equal(response.entries[0].directUrl, '/api/media-libraries/quark1/proxy/%E7%94%B5%E5%BD%B1.mp4');
    assert.doesNotMatch(JSON.stringify(response), /secret/);
    const ws = { _socket: { remoteAddress: '127.0.0.1' }, send: () => {} };
    const display = { ws, state: {} };
    const sent = [];
    const handler = createDisplayPlaylistRequestHandler({ getLibraries: () => listDisplayLibraries(manager),
        buildPlaylist: async () => [{ path: '/电影.mp4', fileName: '电影.mp4', mediaType: 'video', url: 'https://secret.example/video' }],
        getDisplayData: () => display, persist: () => {}, sendToDisplay: (id, message) => sent.push(message) });
    await handler('display1', { type: 'displayPlaylistCancel', libraryId: 'quark1', path: '/电影.mp4', requestId: 'q' }, ws);
    assert.equal(sent[0].media.url, '/api/media-libraries/quark1/proxy/%E7%94%B5%E5%BD%B1.mp4');
});
