'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const express = require('express');
const axios = require('axios');
const { createBilibiliStreamService, allowedStreamUrl } = require('../src/apps/server/modules/media/bilibili-stream-service');
const sourceUrl = 'https://www.bilibili.com/video/BV1B7411m7LV?p=2';

test('解析目标分集并通过代理传递 Range，缓存不泄露外部地址', async t => {
    let queries = 0, upstreamRange;
    const client = {
        async get(url, options) {
            queries++;
            if (url.includes('/view')) return { data: { code: 0, data: { pages: [{ page: 2, cid: 42 }], dimension: { width: 640, height: 360 } } } };
            assert.equal(options.params.cid, 42);
            return { data: { code: 0, data: { format: 'mp4', quality: 16, durl: [{ url: 'https://a.bilivideo.com/v' }] } } };
        },
        async request(options) {
            upstreamRange = options.headers.Range;
            return { status: 206, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-3/10', 'content-length': '4' }, data: Readable.from([Buffer.from('test')]) };
        }
    };
    const service = createBilibiliStreamService({ client });
    const video = await service.resolve(sourceUrl);
    assert.equal(video.page, 2);
    const app = express();
    app.get('/video', (req, res) => service.stream(sourceUrl, req, res).catch(() => res.status(502).end()));
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    t.after(() => server.close());
    const result = await axios.get(`http://127.0.0.1:${server.address().port}/video`, { headers: { Range: 'bytes=0-3' } });
    assert.equal(result.status, 206);
    assert.equal(result.data, 'test');
    assert.equal(upstreamRange, 'bytes=0-3');
    assert.equal(result.headers['content-range'], 'bytes 0-3/10');
    assert.equal(queries, 2);
});

test('拒绝非 B 站流和恶意重定向', async () => {
    assert.equal(allowedStreamUrl('https://foo.bilivideo.com.evil.test/x'), false);
    const client = {
        async get(url) { return url.includes('/view') ? { data: { code: 0, data: { pages: [{ page: 2, cid: 42 }] } } } : { data: { code: 0, data: { format: 'mp4', durl: [{ url: 'https://a.bilivideo.com/v' }] } } }; },
        async request() { return { status: 302, headers: { location: 'http://127.0.0.1:8080/' }, data: Readable.from([]) }; }
    };
    const service = createBilibiliStreamService({ client });
    await assert.rejects(service.stream(sourceUrl, { headers: {}, method: 'GET' }, {}), /不受支持/);
});

test('匿名 DASH 选择 480P AVC 与 AAC，清单只暴露本地代理', async () => {
    const track = (extra) => ({ base_url: 'https://a.bilivideo.com/a', bandwidth: 120000, segment_base: { initialization: '0-999', index_range: '1000-1999' }, ...extra });
    const client = {
        async get(url) {
            if (url.includes('/view')) return { data: { code: 0, data: { pages: [{ page: 2, cid: 42 }] } } };
            return { data: { code: 0, data: { dash: { duration: 123, video: [track({ id: 32, codecs: 'avc1.64001F', width: 852, height: 480 })], audio: [track({ codecs: 'mp4a.40.2' })] } } } };
        }
    };
    const service = createBilibiliStreamService({ client });
    const dash = await service.resolveDash(sourceUrl);
    assert.equal(dash.video.height, 480);
    const xml = await service.manifest(sourceUrl);
    assert.match(xml, /\/api\/bilibili\/dash\/BV1B7411m7LV\/video\?p=2/);
    assert.match(xml, /\/api\/bilibili\/dash\/BV1B7411m7LV\/audio\?p=2/);
    assert.match(xml, /indexRange="1000-1999"/);
    assert.doesNotMatch(xml, /bilivideo\.com/);
});

test('DASH 分段范围无效时拒绝生成清单', async () => {
    const item = { id: 32, codecs: 'avc1.64001F', base_url: 'https://a.bilivideo.com/x', bandwidth: 1, segment_base: { initialization: 'invalid', index_range: '1-2' } };
    const client = { async get(url) { return url.includes('/view') ? { data: { code: 0, data: { pages: [{ page: 2, cid: 1 }] } } } : { data: { code: 0, data: { dash: { duration: 1, video: [item], audio: [{ ...item, codecs: 'mp4a.40.2' }] } } } }; } };
    await assert.rejects(createBilibiliStreamService({ client }).resolveDash(sourceUrl), /分段信息无效/);
});

test('下载流只跟随受信任 B 站域名，拒绝恶意重定向', async () => {
    const { Readable } = require('node:stream');
    const seen = [];
    const service = createBilibiliStreamService({ client: { request: async options => {
        seen.push(options);
        if (seen.length === 1) return { status: 302, headers: { location: 'https://b.bilivideo.com/file' }, data: Readable.from([]) };
        return { status: 200, headers: {}, data: Readable.from(['video']) };
    } } });
    const stream = await service.openDownloadStream('https://a.bilivideo.com/file');
    assert.equal((await Array.fromAsync(stream)).join(''), 'video');
    assert.equal(seen[1].headers.Referer, 'https://www.bilibili.com/');
    const bad = createBilibiliStreamService({ client: { request: async () => ({ status: 302, headers: { location: 'https://evil.test/video' }, data: Readable.from([]) }) } });
    await assert.rejects(bad.openDownloadStream('https://a.bilivideo.com/file'), /不受支持/);
});

test('B站 Cookie 选择可用高画质并按账号隔离缓存，不发送给 CDN', async () => {
    let cookie = 'SESSDATA=account-one';
    const calls = [];
    const track = extra => ({ base_url: 'https://a.bilivideo.com/a', bandwidth: 1000, segment_base: { initialization: '0-10', index_range: '11-20' }, ...extra });
    const client = {
        async get(url, options) {
            calls.push(options);
            if (url.includes('/view')) return { data: { code: 0, data: { pages: [{ page: 2, cid: 42 }] } } };
            return { data: { code: 0, data: { dash: { duration: 10, video: [track({ id: 32, codecs: 'avc1.64001F', height: 480 }), track({ id: 80, codecs: 'avc1.640028', height: 1080 })], audio: [track({ codecs: 'mp4a.40.2' })] } } } };
        },
        async request(options) { assert.equal(options.headers.Cookie, undefined); return { status: 200, headers: {}, data: Readable.from(['data']) }; }
    };
    const service = createBilibiliStreamService({ client, getCookie: () => cookie });
    assert.equal((await service.resolveDash(sourceUrl)).video.height, 1080);
    assert.equal(calls[0].headers.Cookie, cookie);
    assert.equal(calls[1].params.qn, 127);
    cookie = 'SESSDATA=account-two';
    await service.resolveDash(sourceUrl);
    assert.equal(calls.length, 4);
    assert.equal(calls[2].headers.Cookie, cookie);
    await service.openDownloadStream('https://a.bilivideo.com/file');
});

test('DASH 主地址使用非标准端口时选择经过校验的备用 CDN', async () => {
    const track = extra => ({ base_url: 'https://p2p.bilivideo.cn:8082/a', backup_url: ['https://evil.test/a', 'https://cdn.bilivideo.com/backup'], bandwidth: 1000, segment_base: { initialization: '0-10', index_range: '11-20' }, ...extra });
    const client = { async get(url) {
        if (url.includes('/view')) return { data: { code: 0, data: { pages: [{ page: 2, cid: 42 }] } } };
        return { data: { code: 0, data: { dash: { duration: 10, video: [track({ id: 32, codecs: 'avc1.64001F' })], audio: [track({ codecs: 'mp4a.40.2' })] } } } };
    } };
    const result = await createBilibiliStreamService({ client }).resolveDash(sourceUrl);
    assert.equal(result.video.url, 'https://cdn.bilivideo.com/backup');
    assert.equal(result.audio.url, 'https://cdn.bilivideo.com/backup');
});
