'use strict';
const zlib = require('node:zlib');
const axios = require('axios');
const { axiosProxyOptions } = require('./web-proxy');

const HEADERS = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.bilibili.com/' };
const MAX_COMPRESSED = 1024 * 1024;
const MAX_XML = 4 * 1024 * 1024;
const MAX_ITEMS = 10000;

function decodeEntities(text) {
    return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function parseDanmakuXml(xml) {
    const items = [];
    const pattern = /<d\s+p="([^"]*)"[^>]*>([\s\S]*?)<\/d>/g;
    let match;
    while ((match = pattern.exec(xml)) && items.length < MAX_ITEMS) {
        const fields = match[1].split(',');
        const time = Number(fields[0]);
        const mode = Number(fields[1]);
        const fontSize = Number(fields[2]) || 25;
        const rawColor = Number(fields[3]);
        const color = Number.isInteger(rawColor) && rawColor >= 0 && rawColor <= 0xFFFFFF ? rawColor : 0xFFFFFF;
        if (!Number.isFinite(time) || !Number.isInteger(mode)) continue;
        if (![1, 4, 5].includes(mode)) continue;
        const text = decodeEntities(match[2]).trim();
        if (!text) continue;
        items.push({ time, mode, fontSize, color, text: text.slice(0, 200) });
    }
    return items;
}

function decompress(buffer) {
    // 接口可能直接返回明文 XML（首字节 '<'），也可能返回 gzip/raw-deflate 压缩数据。
    if (buffer[0] === 0x3c) return buffer;
    if (buffer.length > MAX_COMPRESSED) throw new Error('B站弹幕数据过大');
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) return zlib.gunzipSync(buffer);
    try { return zlib.inflateRawSync(buffer); } catch { return zlib.inflateSync(buffer); }
}

function createBilibiliDanmakuService({ client = axios, getProxyUrl = () => '', now = Date.now } = {}) {
    const cidCache = new Map();
    const xmlCache = new Map();

    async function resolveCid(bvid, page) {
        if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) throw new Error('B站视频 ID 无效');
        const key = `${bvid}:${page}`;
        const cached = cidCache.get(key);
        if (cached && cached.until > now()) return cached.cid;
        const response = await client.get('https://api.bilibili.com/x/web-interface/view', {
            params: { bvid }, headers: HEADERS, timeout: 10000, maxRedirects: 0, ...axiosProxyOptions(getProxyUrl())
        });
        if (response.data?.code !== 0) throw new Error('B站视频信息暂不可用');
        const target = (response.data.data?.pages || []).find(item => item.page === page);
        if (!target?.cid) throw new Error('B站视频分集不存在');
        cidCache.set(key, { cid: target.cid, until: now() + 3600000 });
        return target.cid;
    }

    return {
        async get(bvid, page = 1) {
            const pageNumber = Number(page);
            if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > 10000) throw new Error('B站视频分集无效');
            const cid = await resolveCid(bvid, pageNumber);
            const cached = xmlCache.get(cid);
            if (cached && cached.until > now()) return cached.value;
            const response = await client.get(`https://comment.bilibili.com/${cid}.xml`, {
                headers: HEADERS, responseType: 'arraybuffer', timeout: 10000, maxRedirects: 0,
                maxContentLength: MAX_XML + 1, ...axiosProxyOptions(getProxyUrl())
            });
            if (response.status !== 200) throw new Error('B站弹幕暂不可用');
            const xml = decompress(Buffer.from(response.data));
            if (xml.length > MAX_XML) throw new Error('B站弹幕数据过大');
            const value = { cid, items: parseDanmakuXml(xml.toString('utf8')) };
            xmlCache.set(cid, { value, until: now() + 600000 });
            return value;
        }
    };
}

module.exports = { createBilibiliDanmakuService, parseDanmakuXml };
