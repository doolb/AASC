'use strict';
const axios = require('axios');
const { axiosProxyOptions } = require('./web-proxy');

const HEADERS = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.bilibili.com/' };

// 清理标题/作者文本：去掉 HTML 标签、压缩空白并截断，避免超长内容破坏界面。
function clean(value, max = 200) {
    return String(value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// 只接受 hdslb.com 域名下的 https 封面，兼容 B 站返回的 // 开头协议相对地址。
function cover(value) {
    const text = String(value || '');
    const normalized = text.startsWith('//') ? `https:${text}` : text.replace(/^http:/, 'https:');
    try {
        const parsed = new URL(normalized);
        return parsed.protocol === 'https:' && /(^|\.)hdslb\.com$/.test(parsed.hostname) ? parsed.href : '';
    } catch { return ''; }
}

// 把首页/相关推荐条目统一成前端使用的视频结构，同时过滤无效 BV 号。
function normalizeRecommendList(list) {
    return (Array.isArray(list) ? list : [])
        .filter(item => /^BV[0-9A-Za-z]{10}$/.test(item?.bvid || ''))
        .map(item => ({ bvid: item.bvid, page: 1, url: `https://www.bilibili.com/video/${item.bvid}`, title: clean(item.title) || item.bvid, cover: cover(item.pic), author: clean(item.owner?.name || item.author, 80) }));
}

function createBilibiliDiscoveryService({ client = axios, getProxyUrl = () => '' } = {}) {
    // 外部请求统一设置 UA/Referer、超时与 maxRedirects: 0，代理只作用于服务端请求。
    const options = (params) => ({ params, headers: HEADERS, timeout: 10000, maxRedirects: 0, ...axiosProxyOptions(getProxyUrl()) });
    return {
        async home(page = 1) {
            const pn = Math.max(1, Math.min(50, Number(page) || 1));
            const response = await client.get('https://api.bilibili.com/x/web-interface/popular', options({ ps: 20, pn }));
            if (response.data?.code !== 0) throw new Error('B站首页暂不可用，请稍后重试');
            return { videos: normalizeRecommendList(response.data.data?.list) };
        },
        async related(bvid) {
            if (!/^BV[0-9A-Za-z]{10}$/.test(String(bvid || ''))) throw new Error('B站视频 ID 无效');
            const response = await client.get('https://api.bilibili.com/x/web-interface/archive/related', options({ bvid }));
            if (response.data?.code !== 0) throw new Error('B站相关推荐暂不可用，请稍后重试');
            return { videos: normalizeRecommendList(response.data.data) };
        }
    };
}

module.exports = { createBilibiliDiscoveryService, normalizeRecommendList };
