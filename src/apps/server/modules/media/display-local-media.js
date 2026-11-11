'use strict';
const express = require('express');

const { DISPLAY_BILIBILI_ID } = require('./display-bilibili-source');
const LOCAL_LIBRARY_TYPES = new Set(['local', 'smb', 'http', 'webdav', 'android-saf', 'quark']);
const PLAYABLE_MEDIA_TYPES = new Set(['image', 'gif', 'video', 'audio', 'text']);
// 弱引用令牌只关联在线显示端，后续播放操作可取消尚未完成的目录扫描。
const DISPLAY_PLAYLIST_REQUESTS = new WeakMap();

function invalidateDisplayPlaylistRequest(displayData) {
    if (displayData) DISPLAY_PLAYLIST_REQUESTS.delete(displayData);
}

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1']);

function isLoopbackAddress(address) {
    return typeof address === 'string' && LOOPBACK_ADDRESSES.has(address);
}

// 显示端只公开当前已配置的库、B 站及活动任务源，不公开凭据。
function listDisplayLibraries(manager, { includeBilibili = false } = {}) {
    const local = manager.listLibraries()
        .filter(library => LOCAL_LIBRARY_TYPES.has(library.type))
        .map(library => ({
            id: library.id,
            name: library.name,
            type: library.type,
            readonly: library.readonly === true
        }));
    const tasks = manager.listTaskMediaSources().map(source => ({
        id: source.libraryId,
        name: source.name,
        type: 'task',
        taskId: source.id,
        region: source.region === 'overseas' ? 'overseas' : 'domestic'
    }));
    const bilibili = includeBilibili ? [{ id: DISPLAY_BILIBILI_ID, name: 'B 站', type: 'bilibili', readonly: true }] : [];
    return [...local, ...bilibili, ...tasks];
}

function parentPath(value) {
    const path = String(value || '/');
    if (path === '/' || !path.startsWith('/')) return '/';
    const index = path.lastIndexOf('/');
    return index <= 0 ? '/' : path.slice(0, index);
}

// 非库条目的绝对 HTTP(S) 地址复用通用代理及其既有地址校验，避免跨域和混合内容。
function displayUrls(item, isHttps) {
    const directUrl = typeof item.url === 'string' ? item.url : '';
    if (!directUrl) return { directUrl: '', proxyUrl: '' };
    const needsProxy = isHttps && /^https?:\/\//i.test(directUrl);
    return {
        directUrl,
        proxyUrl: needsProxy ? `/api/media-proxy?url=${encodeURIComponent(directUrl)}` : ''
    };
}

function normalizeDisplayEntries(items, { isHttps = false } = {}) {
    const entries = [];
    for (const item of Array.isArray(items) ? items : []) {
        if (!item || typeof item.path !== 'string') continue;
        if (item.type === 'folder' || item.type === 'directory') {
            entries.push({ name: item.name, path: item.path, type: 'directory' });
            continue;
        }
        if (!PLAYABLE_MEDIA_TYPES.has(item.mediaType)) continue;
        const urls = displayUrls(item, isHttps);
        entries.push({
            name: item.name,
            path: item.path,
            type: 'file',
            // GIF 归一化为 image，与显示端 showMedia 的图片分支一致。
            mediaType: item.mediaType === 'gif' ? 'image' : item.mediaType,
            directUrl: urls.directUrl,
            proxyUrl: urls.proxyUrl,
            ...(item.mediaType === 'text' ? { format: item.format === 'markdown' ? 'markdown' : 'plain' } : {})
        });
    }
    return entries;
}

function createDisplayLocalRouter({
    mediaLibraryManager,
    bilibiliSource = null,
    isHttps = () => false,
    getRemoteAddress = req => req.socket.remoteAddress
}) {
    const router = express.Router();
    // 任务源停止与未知库分别响应，面板据此回根并显示明确提示。
    const isStoppedTask = libraryId => libraryId.startsWith('task-auto:')
        || mediaLibraryManager.listLibraries().some(library => library.id === libraryId && library.type === 'task');
    const sendStoppedTask = res => res.status(410).json({ code: 'TASK_SOURCE_STOPPED', error: '任务媒体源已停止' });
    router.use((req, res, next) => {
        if (!isLoopbackAddress(getRemoteAddress(req))) {
            res.status(403).json({ error: '仅限本机访问' });
            return;
        }
        next();
    });
    router.get('/libraries', (req, res) => {
        try {
            res.json({ libraries: listDisplayLibraries(mediaLibraryManager, { includeBilibili: !!bilibiliSource }) });
        } catch (error) {
            res.status(500).json({ error: '媒体库加载失败，请稍后重试' });
        }
    });
    router.get('/list', async (req, res) => {
        let libraryId = '';
        try {
            libraryId = typeof req.query.libraryId === 'string' ? req.query.libraryId : '';
            const dirPath = typeof req.query.path === 'string' ? req.query.path : '/';
            const library = listDisplayLibraries(mediaLibraryManager, { includeBilibili: !!bilibiliSource }).find(library => library.id === libraryId);
            const allowed = Boolean(library);
            if (!allowed) {
                if (isStoppedTask(libraryId)) {
                    sendStoppedTask(res);
                    return;
                }
                res.status(400).json({ error: '媒体库不存在' });
                return;
            }
            const items = library.type === 'bilibili' ? await bilibiliSource.list(dirPath) : await mediaLibraryManager.list(libraryId, dirPath);
            // 异步列目录期间若任务已停止，即使扫描刚返回也不能展示过期来源。
            if (library.type === 'task'
                && !listDisplayLibraries(mediaLibraryManager).some(current => current.id === libraryId)) {
                sendStoppedTask(res);
                return;
            }
            // SMB、HTTP、SAF 与任务提供器的公共 URL 可能指向 LAN 的 HTTP 或 HTTPS。
            // 从已允许的库 ID 和条目路径构造既有代理路由，不把外部 URL 去掉域名后当本机路径，
            // 也不经通用代理绕回 LAN（自签证书、主机名及回环拦截均可能使其失败）。
            const displayItems = items.map(item => {
                if (!item || typeof item.path !== 'string' || ['folder', 'directory'].includes(item.type)) return item;
                if (library.type === 'bilibili') return item;
                if (library.type === 'local') {
                    if (typeof item.url !== 'string' || !/^https?:\/\//i.test(item.url)) return item;
                    const url = new URL(item.url);
                    return { ...item, url: `${url.pathname}${url.search}` };
                }
                const encodedPath = item.path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
                return { ...item, url: `/api/media-libraries/${encodeURIComponent(libraryId)}/proxy/${encodedPath}` };
            });
            res.json({
                path: dirPath,
                parent: parentPath(dirPath),
                entries: normalizeDisplayEntries(displayItems, { isHttps: isHttps() })
            });
        } catch (error) {
            // 目录加载期间任务可能停止，再读一次权威注册表以覆盖竞态。
            if (libraryId && isStoppedTask(libraryId)
                && !listDisplayLibraries(mediaLibraryManager).some(library => library.id === libraryId)) {
                sendStoppedTask(res);
                return;
            }
            res.status(500).json({ error: '媒体库加载失败，请稍后重试' });
        }
    });
    return router;
}

// 本地媒体仍使用原始同源路径；远端提供器统一通过已有媒体库代理取流。
function displayPlaylistUrl(item, library) {
    if (library.type === 'bilibili') return item.url;
    if (library.type !== 'local') {
        const encodedPath = String(item.path || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
        return `/api/media-libraries/${encodeURIComponent(library.id)}/proxy/${encodedPath}`;
    }
    if (typeof item.url !== 'string' || !/^https?:\/\//i.test(item.url)) return item.url;
    const url = new URL(item.url);
    return `${url.pathname}${url.search}`;
}

// 显示端发起的批量播放固定单层顺序、播完即停，只路由给发起请求的显示端。
function buildDisplayPlaylistStart({ playlist, displayId }) {
    return {
        listId: 'pl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        playlist,
        interval: 5,
        loop: false,
        announceName: false,
        selectedDisplayIds: [displayId],
        selectedVoiceDisplayIds: [],
        voiceRouteByDisplayId: {}
    };
}

function createDisplayPlaylistRequestHandler({ buildPlaylist, getDisplayData, persist, sendToDisplay, getLibraries = () => [],
    getVoiceRoute = displayId => ({ selectedDisplayIds: [displayId], selectedVoiceDisplayIds: [], voiceTargetDisplayId: null }),
    setDisplayRoute = () => {}
}) {
    return async function handleDisplayPlaylistRequest(displayId, data, ws) {
        if (!isLoopbackAddress(ws?._socket?.remoteAddress)) {
            ws.send(JSON.stringify({ type: 'displayPlaylistError', message: '仅限本机使用' }));
            return;
        }
        const displayData = getDisplayData(displayId);
        if (!displayData || displayData.ws !== ws) return;
        // 本地单文件播放必须同步取消服务端扫描及已保存列表，避免重连复活。
        if (data.type === 'displayPlaylistCancel') {
            invalidateDisplayPlaylistRequest(displayData);
            if (typeof data.libraryId !== 'string' || typeof data.path !== 'string') {
                displayData.state.currentPlaylist = null;
                persist(displayData, { currentPlaylist: null });
                return;
            }
            const token = {};
            DISPLAY_PLAYLIST_REQUESTS.set(displayData, token);
            try {
                const library = getLibraries().find(item => item.id === data.libraryId);
                if (!library) throw new Error('source stopped');
                // 从权威来源重新按完整路径匹配文件，绝不信任客户端提交的 URL 和播放字段。
                const items = await buildPlaylist(library.id, parentPath(data.path));
                if (getDisplayData(displayId) !== displayData || displayData.ws !== ws
                    || DISPLAY_PLAYLIST_REQUESTS.get(displayData) !== token) return;
                if (!getLibraries().some(item => item.id === library.id)) throw new Error('source stopped');
                const item = items.find(entry => entry.path === data.path && PLAYABLE_MEDIA_TYPES.has(entry.mediaType));
                if (!item) throw new Error('file missing');
                const route = getVoiceRoute(displayId);
                const media = {
                    type: 'url', url: displayPlaylistUrl(item, library), fileName: item.fileName,
                    mediaType: item.mediaType === 'gif' ? 'image' : item.mediaType,
                    ...(library.type === 'bilibili' ? { bilibiliDash: true, bilibiliMp4: item.bilibiliMp4 } : {}),
                    ...(item.mediaType === 'text' ? { format: item.format === 'markdown' ? 'markdown' : 'plain' } : {}),
                    ...route
                };
                if (!media.url) throw new Error('file url missing');
                const playback = { currentMedia: media, currentPlaylist: null, currentMediaProgress: null };
                Object.assign(displayData.state, playback);
                persist(displayData, playback);
                setDisplayRoute(displayId, route);
                sendToDisplay(displayId, { type: 'displayMediaStart', requestId: data.requestId, media });
            } catch (error) {
                if (getDisplayData(displayId) !== displayData || displayData.ws !== ws
                    || DISPLAY_PLAYLIST_REQUESTS.get(displayData) !== token) return;
                ws.send(JSON.stringify({ type: 'displayPlaylistError', requestId: data.requestId, message: '媒体库加载失败，请稍后重试', authoritativePlaylist: displayData.state.currentPlaylist || null }));
            }
            return;
        }
        const token = {};
        DISPLAY_PLAYLIST_REQUESTS.set(displayData, token);
        const previousMedia = displayData.state.currentMedia;
        const previousPlaylist = displayData.state.currentPlaylist;
        const isCurrent = () => getDisplayData(displayId) === displayData && displayData.ws === ws
            && DISPLAY_PLAYLIST_REQUESTS.get(displayData) === token
            && displayData.state.currentMedia === previousMedia
            && displayData.state.currentPlaylist === previousPlaylist;
        try {
            const libraryId = String(data.libraryId || '');
            const dirPath = typeof data.path === 'string' ? data.path : '/';
            // 与只读浏览接口共用权威白名单，禁止绕过面板请求夸克库或停止的任务源。
            const library = getLibraries().find(item => item.id === libraryId);
            if (!library) {
                ws.send(JSON.stringify({ type: 'displayPlaylistError', message: '媒体库不存在或任务媒体源已停止' }));
                return;
            }
            const builtPlaylist = await buildPlaylist(libraryId, dirPath);
            // 扫描期间断线、换连接或任务停止时丢弃结果，不覆盖新连接的播放状态。
            if (!isCurrent()) return;
            if (!getLibraries().some(item => item.id === libraryId)) {
                ws.send(JSON.stringify({ type: 'displayPlaylistError', message: '任务媒体源已停止' }));
                return;
            }
            const playlist = (Array.isArray(builtPlaylist) ? builtPlaylist : [])
                .filter(item => item && ['image', 'gif', 'video', 'audio', 'text'].includes(item.mediaType))
                .map(item => ({
                    // 与浏览接口使用同源媒体库代理，兼容 LAN HTTPS/HTTP 和服务任务，
                    // 不将提供器原始 URL 中可能携带的认证信息发送到显示端。
                    url: displayPlaylistUrl(item, library), path: item.path, fileName: item.fileName,
                    mediaType: item.mediaType === 'gif' ? 'image' : item.mediaType,
                    ...(library.type === 'bilibili' ? { bilibiliDash: true, bilibiliMp4: item.bilibiliMp4 } : {}),
                    ...(item.mediaType === 'text' ? { format: item.format } : {})
                }));
            if (!Array.isArray(playlist) || playlist.length === 0) {
                ws.send(JSON.stringify({ type: 'displayPlaylistError', message: '该目录没有可播放的媒体' }));
                return;
            }
            const startData = buildDisplayPlaylistStart({ playlist, displayId });
            if (typeof data.requestId === 'string') startData.requestId = data.requestId;
            const route = getVoiceRoute(displayId);
            Object.assign(startData, route, { voiceRouteByDisplayId: { [displayId]: route } });
            const currentPlaylist = {
                startData,
                index: 0,
                state: 'playing',
                currentTime: 0,
                duration: 0,
                currentTextPage: 0,
                currentTextPageTotal: 0,
                currentTextSentence: 0,
                currentTextSentenceTotal: 0,
                currentTextFormat: null,
                temp: false
            };
            displayData.state.currentPlaylist = currentPlaylist;
            displayData.state.currentMediaProgress = null;
            persist(displayData, { currentPlaylist, currentMediaProgress: null });
            // 注册路由同时终止旧文本上下文和远端预取；保存相同路由供重连恢复。
            setDisplayRoute(displayId, route);
            sendToDisplay(displayId, { type: 'playlistStart', ...startData, temp: false });
        } catch (error) {
            if (getDisplayData(displayId) !== displayData || displayData.ws !== ws
                || DISPLAY_PLAYLIST_REQUESTS.get(displayData) !== token) return;
            ws.send(JSON.stringify({ type: 'displayPlaylistError', message: '媒体库加载失败，请稍后重试' }));
        }
    };
}

module.exports = {
    isLoopbackAddress, listDisplayLibraries, normalizeDisplayEntries, createDisplayLocalRouter,
    buildDisplayPlaylistStart, createDisplayPlaylistRequestHandler, invalidateDisplayPlaylistRequest
};
