'use strict';

const MEDIA_URL_TYPES = new Set(['url', 'media']);

function normalizeUrl(value) {
    if (typeof value !== 'string') return '';
    const url = value.trim();
    return url && !['null', 'undefined'].includes(url.toLowerCase()) ? url : '';
}

function unwrapMediaProxyUrl(value) {
    const url = normalizeUrl(value);
    // 旧服务端只生成相对代理路径；不解码外部绝对地址，避免信任第三方代理参数。
    if (!url || !url.startsWith('/') || url.startsWith('//')) return '';
    try {
        const parsed = new URL(url, 'http://aasc.local');
        if (parsed.pathname !== '/api/media-proxy') return '';
        const sourceUrl = normalizeUrl(parsed.searchParams.get('url'));
        return /^https?:\/\//i.test(sourceUrl) ? sourceUrl : '';
    } catch (_error) {
        return '';
    }
}

function buildMediaProxyUrl(url) {
    return `/api/media-proxy?url=${encodeURIComponent(url)}`;
}

function normalizeMediaItem(media, useHttps) {
    if (!media || typeof media !== 'object' || Array.isArray(media)
        || media.temp || media.type === 'base64' || media.data) {
        return media;
    }

    const originalUrl = normalizeUrl(media.url);
    const declaredDirectUrl = normalizeUrl(media.directUrl);
    const legacyDirectUrl = declaredDirectUrl || unwrapMediaProxyUrl(originalUrl);
    const directUrl = legacyDirectUrl || originalUrl;
    let fallbackUrl = normalizeUrl(media.fallbackUrl);

    // 旧版可能已把主地址改成代理地址；从代理查询参数恢复直连地址，代理只留作备用。
    if (!declaredDirectUrl && legacyDirectUrl && originalUrl !== legacyDirectUrl && !fallbackUrl) {
        fallbackUrl = originalUrl;
    }

    if (useHttps && /^http:\/\//i.test(fallbackUrl)) {
        fallbackUrl = buildMediaProxyUrl(fallbackUrl);
    }
    if (useHttps && /^http:\/\//i.test(directUrl) && !fallbackUrl) {
        fallbackUrl = buildMediaProxyUrl(directUrl);
    }

    if (!directUrl) return media;
    const normalized = { ...media, url: directUrl };
    if (fallbackUrl && fallbackUrl !== directUrl) normalized.fallbackUrl = fallbackUrl;
    else delete normalized.fallbackUrl;
    return normalized;
}

function normalizePlaylist(playlist, useHttps) {
    if (!Array.isArray(playlist)) return playlist;
    return playlist.map(item => normalizeMediaItem(item, useHttps));
}

/**
 * 为显示端媒体消息生成不污染持久状态的下发副本。
 * HTTPS 页面始终先加载原始 HTTP 地址，失败后才由显示端尝试同源媒体代理。
 */
function normalizeDisplayMediaMessage(message, useHttps) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return message;

    if (MEDIA_URL_TYPES.has(message.type)) {
        return normalizeMediaItem(message, useHttps);
    }
    if (message.type === 'playlistStart') {
        return { ...message, playlist: normalizePlaylist(message.playlist, useHttps) };
    }
    if (message.type === 'restoreState' && message.state && typeof message.state === 'object') {
        const state = { ...message.state };
        if (state.currentMedia) state.currentMedia = normalizeMediaItem(state.currentMedia, useHttps);
        const currentPlaylist = state.currentPlaylist;
        if (currentPlaylist?.startData) {
            state.currentPlaylist = {
                ...currentPlaylist,
                startData: {
                    ...currentPlaylist.startData,
                    playlist: normalizePlaylist(currentPlaylist.startData.playlist, useHttps)
                }
            };
        }
        return { ...message, state };
    }

    // 兼容既有单媒体消息类型：同样只克隆并规范化，不再覆盖 url 为代理地址。
    if (message.url && !message.type && /^https?:\/\//i.test(normalizeUrl(message.url))) {
        return normalizeMediaItem(message, useHttps);
    }
    return message;
}

module.exports = { normalizeDisplayMediaMessage };
