'use strict';

const axios = require('axios');
const KEY = 'media.bilibiliVideos';

function parseVideoUrl(value) {
    let url;
    try { url = new URL(String(value || '').trim()); } catch { throw new Error('请输入有效的 B 站 BV 视频链接'); }
    if (!['https:', 'http:'].includes(url.protocol) || !['www.bilibili.com', 'm.bilibili.com', 'bilibili.com'].includes(url.hostname.toLowerCase())) throw new Error('请输入有效的 B 站 BV 视频链接');
    const match = /^\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)/.exec(url.pathname);
    if (!match) throw new Error('暂不支持此链接，请输入 BV 视频页面链接');
    const rawPage = url.searchParams.get('p');
    if (rawPage && (!/^[1-9]\d*$/.test(rawPage) || Number(rawPage) > 10000)) throw new Error('B 站分集参数无效');
    const page = rawPage ? Number(rawPage) : 1;
    return { bvid: match[1], page, url: `https://www.bilibili.com/video/${match[1]}${page > 1 ? `?p=${page}` : ''}` };
}

function parseCollectionUrl(value) {
    let url;
    try { url = new URL(String(value || '').trim()); } catch { return null; }
    if (!['http:', 'https:'].includes(url.protocol) || !['www.bilibili.com', 'm.bilibili.com', 'bilibili.com'].includes(url.hostname.toLowerCase()) || url.username || url.password) return null;
    const match = /^\/list\/ml([1-9]\d{0,19})\/?$/.exec(url.pathname);
    return match ? { id: match[1], url: `https://www.bilibili.com/list/ml${match[1]}` } : null;
}

function safeCover(value) {
    try {
        const u = new URL(String(value || '').replace(/^http:/, 'https:'));
        if (u.protocol === 'https:' && !u.username && !u.password && (u.hostname === 'hdslb.com' || u.hostname.endsWith('.hdslb.com'))) return u.href;
    } catch {}
    return '';
}

function normalizeItem(item) {
    try {
        const collection = parseCollectionUrl(item.url);
        if (collection) return { url: collection.url, collection: true, title: String(item.title || `收藏列表 ${collection.id}`).trim().slice(0, 200), cover: safeCover(item.cover) };
        const video = parseVideoUrl(item.url);
        const title = String(item.title || video.bvid).trim().slice(0, 200) || video.bvid;
        return { ...video, title, cover: safeCover(item.cover) };
    } catch { return null; }
}

function createBilibiliListService({ config, broadcast, fetchMetadata = defaultMetadata, fetchCollection = defaultCollection }) {
    function list() {
        const input = config.get(KEY, []);
        const seen = new Set();
        return (Array.isArray(input) ? input : []).map(normalizeItem).filter(item => {
            if (!item) return false;
            const key = item.collection ? item.url : `${item.bvid}:${item.page}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }).slice(0, 500);
    }
    function snapshot() { return { type: 'bilibiliList', videos: list() }; }
    return {
        async buildPlaylist({ folderId = '', collectionUrl, mode, sortBy, direction, origin, danmaku = false }) {
            const group = config.get('media.shareFolders', {})?.bilibili || {};
            const folders = Array.isArray(group.folders) ? group.folders : [];
            if (typeof folderId !== 'string' || (folderId && !folders.some(folder => folder.id === folderId))) {
                throw new Error('B 站视频文件夹不存在');
            }
            const validIds = new Set(folders.map(folder => folder.id));
            const entries = group.entries || {};
            let videos = list().filter(item => {
                const assigned = entries[item.url];
                return (validIds.has(assigned) ? assigned : '') === folderId;
            });
            if (collectionUrl) {
                const collection = parseCollectionUrl(collectionUrl);
                if (!collection) throw new Error('B 站收藏列表链接无效');
                videos = [{ ...collection, collection: true }];
            }
            if (mode === 'random') {
                for (let i = videos.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [videos[i], videos[j]] = [videos[j], videos[i]];
                }
            } else {
                if (sortBy !== 'time') videos.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN', { numeric: true }));
                if (direction === 'desc') videos.reverse();
            }
            const expanded = [];
            for (const item of videos) {
                if (item.collection) {
                    const collection = parseCollectionUrl(item.url);
                    const result = await fetchCollection(collection.id);
                    expanded.push(...result.videos);
                } else expanded.push(item);
                if (expanded.length > 500) throw new Error('播放列表超过 500 个视频分集，请缩小范围');
            }
            if (mode === 'random') {
                for (let i = expanded.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [expanded[i], expanded[j]] = [expanded[j], expanded[i]];
                }
            }
            return expanded.map(item => {
                const suffix = `${item.bvid}?p=${item.page}`;
                return { url: `${origin}/api/bilibili/dash/${suffix}`,
                    bilibiliDash: true, bilibiliMp4: `${origin}/api/bilibili/video/${suffix}`,
                    // 仅在弹幕开关开启时附加弹幕地址，关闭时不拉取弹幕。
                    ...(danmaku ? { bilibiliDanmakuUrl: `${origin}/api/bilibili/danmaku/${item.bvid}/${item.page}`, bilibiliDanmaku: true } : {}),
                    fileName: `${item.title}${item.page > 1 ? ` · P${item.page}` : ''}`, mediaType: 'video' };
            });
        },
        async handle(ws, data) {
            if (data.type === 'bilibiliListGet') { ws.send(JSON.stringify(snapshot())); return; }
            if (data.type === 'bilibiliCollectionGet') {
                const requestId = typeof data.requestId === 'string' ? data.requestId.slice(0, 80) : '';
                try {
                    const collection = parseCollectionUrl(data.url);
                    if (!collection) throw new Error('B 站收藏列表链接无效');
                    const result = await fetchCollection(collection.id);
                    ws.send(JSON.stringify({ type: 'bilibiliCollection', requestId, url: collection.url, ...result }));
                } catch (error) {
                    ws.send(JSON.stringify({ type: 'bilibiliCollection', requestId, error: error.message || '无法读取收藏列表' }));
                }
                return;
            }
            try {
                const collection = parseCollectionUrl(data.url);
                if (collection) {
                    if (data.type === 'bilibiliListAdd') {
                        const result = await fetchCollection(collection.id);
                        const updated = list().filter(item => item.url !== collection.url);
                        if (updated.length >= 500) throw new Error('B 站视频列表已达上限');
                        updated.push({ url: collection.url, collection: true, title: result.title, cover: result.cover });
                        if (config.set(KEY, updated) === false) throw new Error('B 站视频列表保存失败');
                    } else if (data.type === 'bilibiliListRemove') {
                        if (config.set(KEY, list().filter(item => item.url !== collection.url)) === false) throw new Error('B 站视频列表保存失败');
                    } else return;
                    broadcast(snapshot());
                    return;
                }
                const video = parseVideoUrl(data.url);
                if (data.type === 'bilibiliListAdd') {
                    let metadata = {};
                    try { metadata = await fetchMetadata(video.bvid); } catch {}
                    const current = list();
                    const existing = current.find(item => item.bvid === video.bvid && item.page === video.page);
                    const title = String(metadata.title || existing?.title || video.bvid).trim().slice(0, 200) || video.bvid;
                    const cover = safeCover(metadata.cover) || existing?.cover || '';
                    const updated = current.filter(item => item.bvid !== video.bvid || item.page !== video.page);
                    if (updated.length >= 500) throw new Error('B 站视频列表已达上限');
                    updated.push({ ...video, title, cover });
                    if (config.set(KEY, updated) === false) throw new Error('B 站视频列表保存失败');
                } else if (data.type === 'bilibiliListRemove') {
                    if (config.set(KEY, list().filter(item => item.bvid !== video.bvid || item.page !== video.page)) === false) throw new Error('B 站视频列表保存失败');
                } else return;
                broadcast(snapshot());
            } catch (error) {
                ws.send(JSON.stringify({ type: 'bilibiliListError', message: error.message }));
            }
        }
    };
}

async function defaultCollection(id) {
    const videos = [];
    let title = `收藏列表 ${id}`;
    let cover = '';
    for (let pn = 1; pn <= 25; pn++) {
        const response = await axios.get('https://api.bilibili.com/x/v3/fav/resource/list', {
            params: { media_id: id, pn, ps: 20 },
            headers: { Referer: 'https://www.bilibili.com/', 'User-Agent': 'Mozilla/5.0' },
            timeout: 10000, maxRedirects: 0
        });
        if (response.data?.code !== 0 || !response.data?.data) throw new Error('无法读取 B 站收藏列表，可能未公开或暂时不可用');
        const data = response.data.data;
        title = String(data.info?.title || title).trim().slice(0, 200);
        cover = safeCover(data.info?.cover) || cover;
        if (!Array.isArray(data.medias)) {
            if (data.info?.media_count === 0) return { title, cover, videos };
            throw new Error('B 站收藏列表返回的数据无效');
        }
        for (const media of data.medias) {
            if (media.type !== 2 || !/^BV[0-9A-Za-z]{10}$/.test(media.bvid || '')) continue;
            const count = Number(media.page);
            if (!Number.isSafeInteger(count) || count < 1 || count > 10000) continue;
            if (videos.length + count > 500) throw new Error('B 站收藏列表超过 500 个视频分集');
            for (let page = 1; page <= count; page++) videos.push({ bvid: media.bvid, page, title: String(media.title || media.bvid).trim().slice(0, 200), cover: safeCover(media.cover) });
        }
        if (!data.has_more) return { title, cover, videos };
        if (!data.medias.length) throw new Error('B 站收藏列表分页数据无效');
    }
    throw new Error('B 站收藏列表超过 500 条内容');
}

async function defaultMetadata(bvid) {
    const response = await axios.get('https://api.bilibili.com/x/web-interface/view', {
        params: { bvid }, headers: { Referer: 'https://www.bilibili.com/', 'User-Agent': 'Mozilla/5.0' }, timeout: 8000, maxRedirects: 0
    });
    if (response.data?.code !== 0) throw new Error('B 站元数据暂不可用');
    return { title: response.data.data?.title, cover: response.data.data?.pic };
}

module.exports = { createBilibiliListService, parseVideoUrl, parseCollectionUrl, defaultCollection, safeCover };
