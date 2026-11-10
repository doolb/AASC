'use strict';
const axios = require('axios');
const crypto = require('node:crypto');
const { parseVideoUrl } = require('./bilibili-list-service');

const HEADERS = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.bilibili.com/' };
function allowedStreamUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.port
            && (url.hostname.endsWith('.bilivideo.com') || url.hostname.endsWith('.bilivideo.cn'));
    } catch { return false; }
}
// B 站有时将非标准端口的 P2P 地址放在首位，备用 CDN 仍须通过相同校验。
function selectStreamUrl(item) {
    const backups = item?.backup_url || item?.backupUrl;
    return [item?.base_url || item?.baseUrl, ...(Array.isArray(backups) ? backups : [])].find(allowedStreamUrl) || '';
}
function createBilibiliStreamService({ client = axios, now = Date.now, getCookie = () => '' } = {}) {
    function credentials() {
        const cookie = String(getCookie() || '').trim();
        if (cookie.length > 16384 || /[\r\n]/.test(cookie)) throw new Error('B站 Cookie 格式无效');
        return { cookie, key: crypto.createHash('sha256').update(cookie).digest('hex') };
    }
    const cache = new Map();
    const dashCache = new Map();
    async function resolve(value) {
        const video = parseVideoUrl(value);
        const auth = credentials();
        const key = `${video.bvid}:${video.page}:${auth.key}`;
        const cached = cache.get(key);
        if (cached && cached.until > now()) return cached.value;
        const options = { headers: { ...HEADERS, ...(auth.cookie ? { Cookie: auth.cookie } : {}) }, timeout: 12000, maxRedirects: 0 };
        const detail = await client.get('https://api.bilibili.com/x/web-interface/view', { ...options, params: { bvid: video.bvid } });
        const data = detail.data;
        const cid = data?.code === 0 && data.data?.pages?.find(item => Number(item.page) === video.page)?.cid;
        if (!cid) throw new Error('B站视频或分集不存在');
        const play = await client.get('https://api.bilibili.com/x/player/wbi/playurl', { ...options, params: { bvid: video.bvid, cid, qn: 80, fnval: 0 } });
        const streams = play.data?.data?.durl;
        if (play.data?.code !== 0 || play.data?.data?.format !== 'mp4' || !Array.isArray(streams) || streams.length !== 1 || !allowedStreamUrl(streams[0].url)) throw new Error('当前视频没有可用的单文件视频流');
        const result = { ...video, streamUrl: streams[0].url, quality: play.data.data.quality || null, width: Number(data.data?.dimension?.width) || 0, height: Number(data.data?.dimension?.height) || 0 };
        if (cache.size >= 200) cache.delete(cache.keys().next().value);
        cache.set(key, { until: now() + 120000, value: result });
        return result;
    }
    async function resolveDash(value) {
        const video = parseVideoUrl(value);
        const auth = credentials();
        const key = `${video.bvid}:${video.page}:${auth.key}`;
        const cached = dashCache.get(key);
        if (cached && cached.until > now()) return cached.value;
        const options = { headers: { ...HEADERS, ...(auth.cookie ? { Cookie: auth.cookie } : {}) }, timeout: 12000, maxRedirects: 0 };
        const info = (await client.get('https://api.bilibili.com/x/web-interface/view', { ...options, params: { bvid: video.bvid } })).data;
        const cid = info?.code === 0 && info.data?.pages?.find(item => Number(item.page) === video.page)?.cid;
        if (!cid) throw new Error('B站视频或分集不存在');
        const result = (await client.get('https://api.bilibili.com/x/player/wbi/playurl', { ...options, params: { bvid: video.bvid, cid, qn: 127, fnval: 16 } })).data;
        const dash = result?.data?.dash;
        const videoStream = (dash?.video || []).filter(item => /^avc1\.[a-zA-Z0-9]+$/.test(item.codecs || '') && selectStreamUrl(item)).sort((a, b) => Number(b.id) - Number(a.id) || Number(b.bandwidth) - Number(a.bandwidth))[0];
        const audioStream = (dash?.audio || []).filter(item => /^mp4a\.[a-zA-Z0-9.]+$/.test(item.codecs || '') && selectStreamUrl(item)).sort((a, b) => b.bandwidth - a.bandwidth)[0];
        function track(item) {
            const seg = item?.segment_base || item?.SegmentBase;
            const initialization = seg?.initialization || seg?.Initialization;
            const index = seg?.index_range || seg?.indexRange;
            if (!/^\d+-\d+$/.test(initialization || '') || !/^\d+-\d+$/.test(index || '') || !Number.isFinite(Number(item.bandwidth)) || Number(item.bandwidth) <= 0) throw new Error('B站 DASH 分段信息无效');
            return { url: selectStreamUrl(item), initialization, index, codecs: item.codecs, quality: Number(item.id) || null, bandwidth: Number(item.bandwidth), width: Number(item.width) || 0, height: Number(item.height) || 0 };
        }
        if (result?.code !== 0 || !videoStream || !audioStream || !Number.isFinite(Number(dash.duration)) || Number(dash.duration) <= 0) throw new Error('当前视频没有可用的 AVC 视频与 AAC 音轨，请检查账号权限或视频地区限制');
        const resolved = { ...video, duration: Number(dash.duration), video: track(videoStream), audio: track(audioStream) };
        if (dashCache.size >= 200) dashCache.delete(dashCache.keys().next().value);
        dashCache.set(key, { until: now() + 120000, value: resolved });
        return resolved;
    }
    async function manifest(value) {
        const item = await resolveDash(value);
        const prefix = `/api/bilibili/dash/${item.bvid}`;
        const videoUrl = `${prefix}/video?p=${item.page}`;
        const audioUrl = `${prefix}/audio?p=${item.page}`;
        const v = item.video, a = item.audio;
        return `<?xml version="1.0" encoding="UTF-8"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" type="static" mediaPresentationDuration="PT${item.duration}S" minBufferTime="PT1.5S"><Period><AdaptationSet mimeType="video/mp4" segmentAlignment="true"><Representation id="video" bandwidth="${v.bandwidth}" codecs="${v.codecs}" width="${v.width}" height="${v.height}"><BaseURL>${videoUrl}</BaseURL><SegmentBase indexRange="${v.index}"><Initialization range="${v.initialization}"/></SegmentBase></Representation></AdaptationSet><AdaptationSet mimeType="audio/mp4" segmentAlignment="true"><Representation id="audio" bandwidth="${a.bandwidth}" codecs="${a.codecs}"><BaseURL>${audioUrl}</BaseURL><SegmentBase indexRange="${a.index}"><Initialization range="${a.initialization}"/></SegmentBase></Representation></AdaptationSet></Period></MPD>`;
    }
    async function openDownloadStream(url) {
        for (let redirects = 0; redirects <= 3; redirects++) {
            if (!allowedStreamUrl(url)) throw new Error('B站视频地址不受支持');
            const upstream = await client.request({ url, method: 'GET', headers: HEADERS, responseType: 'stream', timeout: 20000, maxRedirects: 0, validateStatus: () => true });
            if ([301, 302, 303, 307, 308].includes(upstream.status)) {
                upstream.data?.destroy?.();
                if (!upstream.headers.location) throw new Error('B站视频重定向无效');
                url = new URL(upstream.headers.location, url).href;
                continue;
            }
            if (upstream.status !== 200) { upstream.data?.destroy?.(); throw new Error(`B站下载请求失败 (${upstream.status})`); }
            return upstream.data;
        }
        throw new Error('B站视频重定向次数过多');
    }
    async function stream(value, req, res, trackName = null) {
        let url;
        if (trackName) {
            if (!['video', 'audio'].includes(trackName)) throw new Error('B站流类型无效');
            url = (await resolveDash(value))[trackName].url;
        } else {
            url = (await resolve(value)).streamUrl;
        }
        for (let redirects = 0; redirects <= 3; redirects++) {
            if (!allowedStreamUrl(url)) throw new Error('B站视频地址不受支持');
            const headers = { ...HEADERS };
            if (req.headers.range) headers.Range = req.headers.range;
            const upstream = await client.request({ url, method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers, responseType: 'stream', timeout: 20000, maxRedirects: 0, validateStatus: () => true });
            if ([301, 302, 303, 307, 308].includes(upstream.status)) {
                upstream.data?.destroy?.();
                if (!upstream.headers.location) throw new Error('B站视频重定向无效');
                url = new URL(upstream.headers.location, url).href;
                continue;
            }
            if (![200, 206, 416].includes(upstream.status)) { upstream.data?.destroy?.(); throw new Error(`B站视频请求失败 (${upstream.status})`); }
            res.status(upstream.status);
            for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
                if (upstream.headers[name]) res.setHeader(name, upstream.headers[name]);
            }
            if (req.method === 'HEAD') { upstream.data?.destroy?.(); res.end(); return; }
            res.on('close', () => upstream.data?.destroy?.());
            upstream.data.on('error', () => res.destroy());
            upstream.data.pipe(res);
            return;
        }
        throw new Error('B站视频重定向次数过多');
    }
    return { resolve, resolveDash, manifest, stream, openDownloadStream };
}
module.exports = { createBilibiliStreamService, allowedStreamUrl };
