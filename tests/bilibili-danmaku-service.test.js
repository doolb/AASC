'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { createBilibiliDanmakuService, parseDanmakuXml } = require('../src/apps/server/modules/media/bilibili-danmaku-service');

test('parseDanmakuXml 解析滚动、顶部、底部弹幕并转义文本', () => {
    const xml = '<?xml version="1.0"?><i><d p="1.2,1,25,16777215,0,0,0,0">你好&amp;世界</d><d p="2,5,18,255,0,0,0,0">顶部</d><d p="3,4,18,255,0,0,0,0">底部</d></i>';
    const items = parseDanmakuXml(xml);
    assert.deepEqual(items.map(item => item.mode), [1, 5, 4]);
    assert.equal(items[0].text, '你好&世界');
    assert.equal(items[0].time, 1.2);
});

test('get 先解析 cid，再解压弹幕 XML 并缓存', async () => {
    let xmlCalls = 0;
    const xml = Buffer.from('<i><d p="1,1,25,16777215,0,0,0,0">弹幕</d></i>');
    const compressed = zlib.deflateRawSync(xml);
    const client = { get: async url => {
        if (url.includes('/x/web-interface/view')) return { status: 200, data: { code: 0, data: { pages: [{ page: 1, cid: 123 }] } } };
        xmlCalls++;
        return { status: 200, data: compressed, headers: { 'content-type': 'text/xml' } };
    } };
    const service = createBilibiliDanmakuService({ client });
    assert.equal((await service.get('BV1xx411c7mD', 1)).items[0].text, '弹幕');
    await service.get('BV1xx411c7mD', 1);
    assert.equal(xmlCalls, 1);
});

test('明文 XML 响应无需解压即可解析', async () => {
    const plain = Buffer.from('<i><d p="2,1,25,16777215,0,0,0,0">明文弹幕</d></i>');
    const client = { get: async url => {
        if (url.includes('/x/web-interface/view')) return { status: 200, data: { code: 0, data: { pages: [{ page: 1, cid: 456 }] } } };
        return { status: 200, data: plain, headers: { 'content-type': 'text/xml' } };
    } };
    const result = await createBilibiliDanmakuService({ client }).get('BV1xx411c7mD', 1);
    assert.equal(result.items[0].text, '明文弹幕');
});

test('parseDanmakuXml 保留黑色弹幕颜色', () => {
    const items = parseDanmakuXml('<i><d p="1,1,25,0,0,0,0,0">黑</d></i>');
    assert.equal(items[0].color, 0);
});
