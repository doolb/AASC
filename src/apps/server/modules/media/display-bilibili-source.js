'use strict';

const { parseVideoUrl } = require('./bilibili-list-service');
const DISPLAY_BILIBILI_ID = 'display-bilibili';
const encode = value => Buffer.from(String(value), 'utf8').toString('base64url');

// 显示端只读虚拟目录：路径只引用已保存项目，不接受客户端提交的外部 URL。
function createDisplayBilibiliSource({ getService, getFolders }) {
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
            bilibiliDash: true, bilibiliMp4: `/api/bilibili/video/${suffix}` };
    }

    async function list(dirPath) {
        const dir = typeof dirPath === 'string' && dirPath ? dirPath : '/';
        const { service, folders, videos } = saved();
        const segments = dir.split('/').filter(Boolean);
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
    return { list, async playlist(dir) { return (await list(dir)).filter(item => item.type === 'file'); } };
}

module.exports = { DISPLAY_BILIBILI_ID, createDisplayBilibiliSource };
