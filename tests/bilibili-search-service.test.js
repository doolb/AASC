'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBilibiliSearchService } = require('../src/apps/server/modules/media/bilibili-search-service');

function response(data, status = 200) { return { status, data }; }
function video(bvid = 'BV1xx411c7mD', pic = '//i0.hdslb.com/a.jpg') {
    return { bvid, title: '<em>测试</em>视频', pic, author: '作者' };
}

test('无签名通道成功时不请求 WBI', async () => {
    const calls = [];
    const client = { get: async (url, options) => { calls.push(url); return response({ code: 0, data: { result: [video()], numPages: 3 } }); } };
    const search = createBilibiliSearchService({ client });
    const result = await search('测试', 1);
    assert.equal(result.videos[0].bvid, 'BV1xx411c7mD');
    assert.equal(result.videos[0].title, '测试视频');
    assert.equal(result.videos[0].cover, 'https://i0.hdslb.com/a.jpg');
    assert.equal(result.totalPages, 3);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /search\/type/);
});

test('http 封面地址升级为 https', async () => {
    const client = { get: async () => response({ code: 0, data: { result: [video('BV1xx411c7mD', 'http://i0.hdslb.com/bfs/archive/x.jpg')], numPages: 1 } }) };
    const result = await createBilibiliSearchService({ client })('封面', 1);
    assert.match(result.videos[0].cover, /^https:\/\//);
});

test('无签名通道 412 时回退 WBI 签名搜索', async () => {
    const client = { get: async (url, options) => {
        // 无签名与 WBI 通道共用同一个接口地址，按参数中是否带 w_rid 区分通道。
        if (url.includes('search/type') && !options?.params?.w_rid) return response('<html>412</html>', 412);
        if (url.includes('/x/web-interface/nav')) return response({ code: 0, data: { wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png' } } });
        if (url.includes('/x/frontend/finger/spi')) return response({ code: 0, data: { b_3: 'b3', b_4: 'b4' } });
        return response({ code: 0, data: { result: [video()], numPages: 1 } });
    } };
    const result = await createBilibiliSearchService({ client })('测试', 1);
    assert.equal(result.videos.length, 1);
});

test('搜索成功结果缓存 60 秒', async () => {
    let count = 0;
    const client = { get: async () => { count++; return response({ code: 0, data: { result: [video()], numPages: 1 } }); } };
    const search = createBilibiliSearchService({ client, now: () => 1000 });
    await search('缓存', 1);
    await search('缓存', 1);
    assert.equal(count, 1);
});

test('两条通道都失败时返回中文提示并退避', async () => {
    let count = 0;
    const client = { get: async url => {
        count++;
        if (url.includes('search/type')) return response('', 412);
        if (url.includes('/x/web-interface/nav')) return response({ code: 0, data: { wbi_img: { img_url: 'https://i0.hdslb.com/a.png', sub_url: 'https://i0.hdslb.com/b.png' } } });
        if (url.includes('/x/frontend/finger/spi')) return response({ code: 0, data: {} });
        return response('', 412);
    } };
    const search = createBilibiliSearchService({ client, now: () => 1000 });
    await assert.rejects(search('失败', 1), /B站搜索暂不可用/);
    const before = count;
    await assert.rejects(search('失败', 1), /请稍后重试/);
    assert.equal(count, before);
});
