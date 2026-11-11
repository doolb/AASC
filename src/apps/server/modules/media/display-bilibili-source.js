'use strict';

const { parseVideoUrl } = require('./bilibili-list-service');
const DISPLAY_BILIBILI_ID = 'display-bilibili';
const encode = value => Buffer.from(String(value), 'utf8').toString('base64url');

// 显示端虚拟目录仅引用已保存项目和发现服务快照，不接受客户端提交的外部播放地址。
function createDisplayBilibiliSource({ getService, getFolders, getDiscovery = () => null, now = Date.now }) {
    // 固定短时快照，播放校验重读同一目录时不会因上游刷新而丢失用户选中的视频。
    const discoveryCache = new Map();
    function saved() {
        const service = getService();
        const group = getFolders() || {};
        const folders = Array.isArray(group.folders) ? group.folders.filter(item => item && typeof item.id === 'string') : [];
        const ids = new Set(folders.map(item => item.id));
        const entries = group.entries && typeof group.entries === 'object' ? group.entries : {};
        const videos = service.getVideos().map(item => ({ ...item, folder: ids.has(entries[item.url]) ? entries[item.url] : '' }));
        return { service, folders, videos };
    }

    function videoEntry(video, dir) {
        const parsed = parseVideoUrl(`https://www.bilibili.com/video/${video.bvid}?p=${video.page || 1}`);
        const path = `${dir === '/' ? '' : dir}/v:${parsed.bvid}:${parsed.page}`;
        const suffix = `${parsed.bvid}?p=${parsed.page}`;
        return { name: String(video.title || parsed.bvid).slice(0, 200), fileName: String(video.title || parsed.bvid).slice(0, 200),
            path, type: 'file', mediaType: 'video', url: `/api/bilibili/dash/${suffix}`,
            bilibiliDash: true, bilibiliMp4: `/api/bilibili/video/${suffix}`,
            bvid: parsed.bvid, page: parsed.page, cover: video.cover || '', author: video.author || '' };
    }

    async function list(dirPath) {
        const dir = typeof dirPath === 'string' && dirPath ? dirPath : '/';
        const { service, folders, videos } = saved();
        const segments = dir.split('/').filter(Boolean);
        const candidate = segments.length === 1 ? segments[0].match(/^d:related:(BV[0-9A-Za-z]{10}):([1-9]\d{0,4})$/) : null;
        const related = candidate && Number(candidate[2]) <= 10000 ? candidate : null;
        if (segments.length === 1 && (segments[0] === 'd:home' || related)) {
            const discovery = getDiscovery();
            if (!discovery) throw new Error('B 站发现服务不可用');
            let cached = discoveryCache.get(dir);
            if (!cached || cached.expires <= now()) {
                let result;
                try { result = related ? await discovery.related(related[1]) : await discovery.home(1); }
                catch (error) { if (!related) throw error; result = { videos: [] }; }
                cached = { expires: now() + 60000, videos: Array.isArray(result.videos) ? result.videos : [] };
                if (related) {
                    const bvid = related[1];
                    cached.videos = [{ bvid, page: Number(related[2]), title: bvid }, ...cached.videos.filter(item => item.bvid !== bvid)];
                }
                if (discoveryCache.size >= 32) discoveryCache.delete(discoveryCache.keys().next().value);
                discoveryCache.set(dir, cached);
            }
            return cached.videos.map(item => videoEntry(item, dir));
        }
        let folder = '';
        if (segments[0]?.startsWith('f:')) {
            const match = folders.find(item => `f:${encode(item.id)}` === segments[0]);
            if (!match) throw new Error('B 站文件夹不存在');
            folder = match.id;
            segments.shift();
        }
        const assigned = videos.filter(item => item.folder === folder);
        if (segments.length === 1 && segments[0].startsWith('c:')) {
            const collection = assigned.find(item => item.collection && `c:${encode(item.url)}` === segments[0]);
            if (!collection) throw new Error('B 站收藏列表不存在');
            const result = await service.getCollection(collection.url);
            return (Array.isArray(result.videos) ? result.videos : []).map(item => videoEntry(item, dir));
        }
        if (segments.length) throw new Error('B 站目录不存在');
        const result = dir === '/' ? folders.map(item => ({ name: String(item.name || '文件夹'), path: `/f:${encode(item.id)}`, type: 'folder' })) : [];
        for (const item of assigned) {
            if (item.collection) result.push({ name: item.title, path: `${dir === '/' ? '' : dir}/c:${encode(item.url)}`, type: 'folder' });
            else result.push(videoEntry(item, dir));
        }
        return result;
    }
    return {
        list,
        async playlist(dir) {
            const snapshot = discoveryCache.get(dir);
            return snapshot ? snapshot.videos.map(item => videoEntry(item, dir)) : (await list(dir)).filter(item => item.type === 'file');
        },
        async add(bvid, page = 1) {
            if (!/^BV[0-9A-Za-z]{10}$/.test(String(bvid || ''))) throw new Error('B 站视频 ID 无效');
            const pageNumber = Number(page);
            if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > 10000) throw new Error('B 站分集参数无效');
            const video = parseVideoUrl(`https://www.bilibili.com/video/${bvid}?p=${pageNumber}`);
            let failure = '';
            await getService().handle({ send: message => { failure = JSON.parse(message).message || '保存失败'; } },
                { type: 'bilibiliListAdd', url: video.url });
            if (failure) throw new Error(failure);
        }
    };
}

module.exports = { DISPLAY_BILIBILI_ID, createDisplayBilibiliSource };
