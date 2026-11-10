'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBilibiliListService, parseVideoUrl, safeCover } = require('../src/apps/server/modules/media/bilibili-list-service');

test('持久化并广播 B 站视频、区分分集、去重与移除', async () => {
    const db = {};
    const messages = [];
    const config = { get: (key, fallback) => db[key] || fallback, set: (key, value) => { db[key] = value; } };
    const service = createBilibiliListService({ config, broadcast: x => messages.push(x), fetchMetadata: async () => ({ title: '测试视频', cover: 'http://i0.hdslb.com/test.jpg' }) });
    const ws = { send: text => messages.push(JSON.parse(text)) };
    const url = 'https://www.bilibili.com/video/BV1B7411m7LV?p=2';
    await service.handle(ws, { type: 'bilibiliListAdd', url });
    await service.handle(ws, { type: 'bilibiliListAdd', url });
    await service.handle(ws, { type: 'bilibiliListAdd', url: 'https://www.bilibili.com/video/BV1B7411m7LV' });
    await service.handle(ws, { type: 'bilibiliListGet' });
    assert.equal(messages.at(-1).videos.length, 2);
    assert.equal(messages.at(-1).videos[0].cover, 'https://i0.hdslb.com/test.jpg');
    assert.equal(messages.at(-1).videos[0].page, 2);
    await service.handle(ws, { type: 'bilibiliListRemove', url });
    assert.equal(messages.at(-1).videos.length, 1);
    assert.equal(messages.at(-1).videos[0].page, 1);
});

test('元数据不可用时可保存并保留已有封面，拒绝非 B 站链接和伪造封面', async () => {
    let saved = [];
    let fail = false;
    const msgs = [];
    const service = createBilibiliListService({ config: { get: () => saved, set: (key, value) => { saved = value; } }, broadcast: v => msgs.push(v), fetchMetadata: async () => { if (fail) throw Error('超时'); return { title: '标题', cover: 'https://i0.hdslb.com/a.jpg' }; } });
    const ws = { send: text => msgs.push(JSON.parse(text)) };
    const url = 'https://www.bilibili.com/video/BV1B7411m7LV';
    await service.handle(ws, { type: 'bilibiliListAdd', url });
    fail = true;
    await service.handle(ws, { type: 'bilibiliListAdd', url });
    assert.equal(saved[0].cover, 'https://i0.hdslb.com/a.jpg');
    await service.handle(ws, { type: 'bilibiliListAdd', url: 'https://evil.example/video/BV1B7411m7LV' });
    assert.equal(msgs.at(-1).type, 'bilibiliListError');
    assert.equal(safeCover('https://hdslb.com.evil/a.jpg'), '');
    assert.throws(() => parseVideoUrl('https://www.bilibili.com/video/BV1B7411m7LV?p=0'), /分集/);
});

test('按文件夹生成 B 站批量播放列表，保留分集并忽略失效分类', async () => {
    const first = 'https://www.bilibili.com/video/BV1B7411m7LV';
    const second = `${first}?p=2`;
    const third = 'https://www.bilibili.com/video/BV1B7411m7LW';
    const db = {
        'media.bilibiliVideos': [{ url: first, title: '视频 2' }, { url: second, title: '视频 1' }, { url: third, title: '未分类' }],
        'media.shareFolders': { bilibili: { folders: [{ id: 'a', name: '分类' }], entries: { [first]: 'a', [second]: 'a', [third]: 'deleted' } } }
    };
    const service = createBilibiliListService({ config: { get: (key, fallback) => db[key] || fallback }, broadcast() {} });
    const origin = 'http://192.168.1.2:3000';
    const playlist = await service.buildPlaylist({ folderId: 'a', origin, sortBy: 'name' });
    assert.deepEqual(playlist.map(item => item.fileName), ['视频 1 · P2', '视频 2']);
    assert.equal(playlist[0].url, `${origin}/api/bilibili/dash/BV1B7411m7LV?p=2`);
    assert.equal(playlist[0].bilibiliMp4, `${origin}/api/bilibili/video/BV1B7411m7LV?p=2`);
    assert.equal(playlist[0].bilibiliDash, true);
    assert.deepEqual((await service.buildPlaylist({ folderId: 'a', origin, sortBy: 'time', direction: 'desc' })).map(x => x.fileName), ['视频 1 · P2', '视频 2']);
    assert.deepEqual((await service.buildPlaylist({ folderId: '', origin })).map(x => x.fileName), ['未分类']);
    await assert.rejects(service.buildPlaylist({ folderId: 'deleted', origin }), /不存在/);
});

test('收藏列表作为分类链接保存，每次播放重新读取并展开分集', async () => {
    const db = { 'media.shareFolders': { bilibili: { folders: [{ id: 'a', name: '分类' }], entries: { 'https://www.bilibili.com/list/ml3316957636': 'a' } } } };
    const config = { get: (key, fallback) => db[key] || fallback, set: (key, value) => { db[key] = value; } };
    let calls = 0;
    const fetchCollection = async id => { assert.equal(id, '3316957636'); calls++; return { title: '学习', cover: 'https://i0.hdslb.com/a.jpg', videos: Array.from({ length: calls }, (_, i) => ({ bvid: 'BV1B7411m7LV', page: i + 1, title: '课程' })) }; };
    const messages = [];
    const service = createBilibiliListService({ config, broadcast: m => messages.push(m), fetchCollection });
    const input = 'https://www.bilibili.com/list/ml3316957636?oid=123&bvid=BV1B7411m7LV';
    await service.handle({ send: text => messages.push(JSON.parse(text)) }, { type: 'bilibiliListAdd', url: input });
    assert.equal(messages.at(-1).videos[0].url, 'https://www.bilibili.com/list/ml3316957636');
    assert.equal(messages.at(-1).videos[0].collection, true);
    const options = { folderId: 'a', origin: 'http://server', sortBy: 'time' };
    const first = await service.buildPlaylist(options);
    assert.equal(first.length, 2);
    assert.match(first[1].url, /p=2$/);
    const next = await service.buildPlaylist(options);
    assert.equal(next.length, 3);
    assert.equal((await service.buildPlaylist({ folderId: '', origin: 'http://server' })).length, 0);
    assert.equal((await service.buildPlaylist({ folderId: '', collectionUrl: input, origin: 'http://server' })).length, 4);
    await service.handle({ send: text => messages.push(JSON.parse(text)) }, { type: 'bilibiliListRemove', url: input });
    assert.equal(messages.at(-1).videos.length, 0);
});

test('收藏列表只接受可信域名，分页读取并展开分集，对上限和访问失败报错', async () => {
    const { parseCollectionUrl, defaultCollection } = require('../src/apps/server/modules/media/bilibili-list-service');
    const axios = require('axios');
    assert.equal(parseCollectionUrl('https://www.bilibili.com.evil.test/list/ml1'), null);
    assert.equal(parseCollectionUrl('https://user@www.bilibili.com/list/ml1'), null);
    assert.equal(parseCollectionUrl('https://www.bilibili.com/list/ml12?bvid=BV1B7411m7LV').url, 'https://www.bilibili.com/list/ml12');
    const original = axios.get;
    try {
        axios.get = async (url, options) => ({ data: { code: 0, data: { info: { title: '列表' }, has_more: options.params.pn === 1, medias: [{ type: 2, bvid: 'BV1B7411m7LV', title: '视频', page: options.params.pn }] } } });
        const result = await defaultCollection('12');
        assert.deepEqual(result.videos.map(x => x.page), [1, 1, 2]);
        axios.get = async () => ({ data: { code: 0, data: { medias: [{ type: 2, bvid: 'BV1B7411m7LV', page: 501 }] } } });
        await assert.rejects(defaultCollection('12'), /超过 500/);
        axios.get = async () => ({ data: { code: -403 } });
        await assert.rejects(defaultCollection('12'), /无法读取/);
    } finally { axios.get = original; }
});

test('收藏列表浏览返回视频分集和封面，错误带原请求标识', async () => {
    const messages = [];
    const service = createBilibiliListService({ config: { get: (key, fallback) => fallback }, broadcast() {}, fetchCollection: async id => {
        if (id === '2') throw new Error('列表不可访问');
        return { title: '课程', videos: [{ bvid: 'BV1B7411m7LV', page: 2, title: '课程', cover: 'https://i0.hdslb.com/a.jpg' }] };
    } });
    const ws = { send: text => messages.push(JSON.parse(text)) };
    await service.handle(ws, { type: 'bilibiliCollectionGet', url: 'https://www.bilibili.com/list/ml1?oid=2', requestId: 'r1' });
    assert.equal(messages[0].url, 'https://www.bilibili.com/list/ml1');
    assert.equal(messages[0].videos[0].page, 2);
    assert.equal(messages[0].videos[0].cover, 'https://i0.hdslb.com/a.jpg');
    await service.handle(ws, { type: 'bilibiliCollectionGet', url: 'https://www.bilibili.com/list/ml2', requestId: 'r2' });
    assert.equal(messages[1].requestId, 'r2');
    assert.equal(messages[1].error, '列表不可访问');
    await service.handle(ws, { type: 'bilibiliCollectionGet', url: 'https://evil.test/list/ml1', requestId: 'r3' });
    assert.match(messages[2].error, /无效/);
});
