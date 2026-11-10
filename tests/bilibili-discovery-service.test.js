'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBilibiliDiscoveryService, normalizeRecommendList } = require('../src/apps/server/modules/media/bilibili-discovery-service');

test('normalizeRecommendList 过滤非 BV 条目并规范封面', () => {
    const videos = normalizeRecommendList([
        { bvid: 'BV1xx411c7mD', title: '正常', pic: '//i0.hdslb.com/a.jpg', owner: { name: 'UP' } },
        { bvid: 'BV1yy411c7mE', title: 'HTTP', pic: 'http://i1.hdslb.com/b.jpg', owner: { name: 'UP2' } },
        { bvid: 'av123', title: '无效' }
    ]);
    assert.equal(videos.length, 2);
    assert.equal(videos[0].cover, 'https://i0.hdslb.com/a.jpg');
    assert.equal(videos[0].author, 'UP');
    assert.equal(videos[1].cover, 'https://i1.hdslb.com/b.jpg');
});

test('home 与 related 请求正确接口', async () => {
    const calls = [];
    // 按接口区分返回结构：首页 popular 的列表在 data.list，相关推荐 archive/related 的列表直接是 data 数组。
    const client = { get: async (url, options) => {
        calls.push({ url, options });
        const item = { bvid: 'BV1xx411c7mD', title: '视频', pic: 'https://i0.hdslb.com/a.jpg', owner: { name: 'UP' } };
        if (url.includes('popular')) return { status: 200, data: { code: 0, data: { list: [item] } } };
        return { status: 200, data: { code: 0, data: [item] } };
    } };
    const service = createBilibiliDiscoveryService({ client });
    assert.equal((await service.home(1)).videos.length, 1);
    assert.equal((await service.related('BV1xx411c7mD')).videos.length, 1);
    assert.match(calls[0].url, /popular/);
    assert.match(calls[1].url, /archive\/related/);
});
