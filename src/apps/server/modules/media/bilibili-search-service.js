'use strict';
const crypto = require('node:crypto');
const axios = require('axios');
const { axiosProxyOptions } = require('./web-proxy');

// WBI 签名所需的字符重排表。
const MIXIN = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];
const SEARCH_API = 'https://api.bilibili.com/x/web-interface/search/type';
const CACHE_TTL = 60000;
const BACKOFF_TTL = 30000;
const HEADERS = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://search.bilibili.com/' };
// 这些业务错误码代表风控/限流，需要触发 WBI 回退或退避。
const RATE_CODES = new Set([-352, -403, -412, -509]);

// 去除标题中的 HTML 标签与实体，压缩空白并限制长度。
function cleanTitle(value) {
    return String(value || '').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

// 仅接受 hdslb.com 的 https 封面地址，兼容 // 协议相对与 http 地址，其余返回空字符串。
function safeCover(value) {
    const text = String(value || '');
    const normalized = text.startsWith('//') ? `https:${text}` : text.replace(/^http:/, 'https:');
    try {
        const parsed = new URL(normalized);
        return parsed.protocol === 'https:' && /(^|\.)hdslb\.com$/.test(parsed.hostname) ? parsed.href : '';
    } catch { return ''; }
}

// 将 B 站搜索响应规范化为统一结构，附带当前页码。
function normalize(payload, page = 1) {
    if (payload?.code !== 0 || !Array.isArray(payload?.data?.result)) throw new Error('B站搜索暂不可用，请稍后重试');
    const videos = payload.data.result
        .filter(item => /^BV[0-9A-Za-z]{10}$/.test(item?.bvid || ''))
        .map(item => ({ bvid: item.bvid, page: 1, url: `https://www.bilibili.com/video/${item.bvid}`, title: cleanTitle(item.title) || item.bvid, cover: safeCover(item.pic), author: cleanTitle(item.author) }));
    const totalPages = Math.max(1, Math.min(50, Number(payload.data.numPages || 1)));
    return { videos, page, totalPages };
}

function createBilibiliSearchService({ client = axios, now = Date.now, getProxyUrl = () => '' } = {}) {
    const cache = new Map();
    const backoff = new Map();
    let session = null;
    let pending = null;

    // 统一请求参数：超时、禁止重定向、代理与状态码放行范围。
    function requestOptions(extra = {}) {
        return { headers: HEADERS, timeout: 10000, maxRedirects: 0, validateStatus: status => status >= 200 && status < 500, ...axiosProxyOptions(getProxyUrl()), ...extra };
    }

    // 主通道：不携带 WBI 签名的 search/type 接口。
    async function unsigned(keyword, page) {
        const response = await client.get(SEARCH_API, requestOptions({ params: { search_type: 'video', keyword, page } }));
        if (response.status === 412 || RATE_CODES.has(response.data?.code)) throw new Error('RATE_LIMIT');
        if (response.status !== 200) throw new Error('SEARCH_HTTP');
        return normalize(response.data, page);
    }

    // 获取并缓存 WBI 密钥与匿名指纹 Cookie，会话有效期为 1 小时。
    async function getSession() {
        if (session && session.until > now()) return session;
        if (!pending) pending = (async () => {
            const [nav, spi] = await Promise.all([
                client.get('https://api.bilibili.com/x/web-interface/nav', requestOptions()),
                client.get('https://api.bilibili.com/x/frontend/finger/spi', requestOptions())
            ]);
            const keys = [nav.data?.data?.wbi_img?.img_url, nav.data?.data?.wbi_img?.sub_url]
                .map(value => String(value || '').split('/').pop().split('.')[0]).join('');
            const cookie = [['buvid3', spi.data?.data?.b_3], ['buvid4', spi.data?.data?.b_4]]
                .filter(([, value]) => value).map(([key, value]) => `${key}=${value}`).join('; ');
            session = {
                key: MIXIN.map(index => keys[index]).join('').slice(0, 32),
                cookie, until: now() + 3600000
            };
            return session;
        })().finally(() => { pending = null; });
        return pending;
    }

    // 回退通道：带 WBI 签名与匿名 Cookie 的搜索请求。
    async function signed(keyword, page) {
        const current = await getSession();
        const params = { search_type: 'video', keyword, page, wts: Math.floor(now() / 1000) };
        const query = Object.keys(params).sort().map(key => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]).replace(/[!'()*]/g, ''))}`).join('&');
        params.w_rid = crypto.createHash('md5').update(query + current.key).digest('hex');
        const response = await client.get(SEARCH_API, requestOptions({ params, headers: { ...HEADERS, Cookie: current.cookie } }));
        if (response.status === 412 || RATE_CODES.has(response.data?.code)) throw new Error('RATE_LIMIT');
        if (response.status !== 200) throw new Error('SEARCH_HTTP');
        return normalize(response.data, page);
    }

    return async function search(keyword, page = 1) {
        const text = String(keyword || '').trim();
        const pageNumber = Number(page);
        // 参数校验统一使用中文文案。
        if (!text || text.length > 100 || !Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > 50) throw new Error('B站搜索参数无效');
        const key = `${text}:${pageNumber}`;
        const cached = cache.get(key);
        if (cached && cached.until > now()) return cached.value;
        // 同一关键词失败后 30 秒内直接快速失败，避免放大风控。
        const blockedUntil = backoff.get(text) || 0;
        if (blockedUntil > now()) throw new Error('B站搜索暂不可用，请稍后重试');
        try {
            const value = await unsigned(text, pageNumber).catch(() => signed(text, pageNumber));
            cache.set(key, { value, until: now() + CACHE_TTL });
            backoff.delete(text);
            return value;
        } catch {
            backoff.set(text, now() + BACKOFF_TTL);
            throw new Error('B站搜索暂不可用，请稍后重试');
        }
    };
}

module.exports = { createBilibiliSearchService, normalize, safeCover };
