'use strict';

/**
 * 生成主服务器向显示端重发的普通播放消息。
 *
 * 这里不定义新的显示端协议：单媒体仍返回原媒体消息，播放列表仍返回
 * playlistStart。主服务器只在 AASC 节点就绪后重新走现有 sendToDisplay 流程。
 */
function buildNormalReplayMessages(displayState = {}, node = {}, previousNodeUrl = '') {
    const currentPlaylist = displayState.currentPlaylist;
    if (currentPlaylist?.startData?.playlist?.length) {
        const playlist = currentPlaylist.startData.playlist;
        const currentIndex = normalizePlaylistIndex(currentPlaylist.index, playlist.length);
        if (!isMediaFromNode(playlist[currentIndex], node, previousNodeUrl)) return [];

        return [{
            type: 'playlistStart',
            ...currentPlaylist.startData,
            playlist: playlist.map(item => rewriteMediaForNode(item, node, previousNodeUrl)),
            resumeIndex: currentIndex,
            resumeTime: normalizeResumeTime(currentPlaylist.currentTime),
            resumeState: currentPlaylist.state || 'playing'
        }];
    }

    const currentMedia = displayState.currentMedia;
    if (!isMediaFromNode(currentMedia, node, previousNodeUrl)) return [];
    return [rewriteMediaForNode(currentMedia, node, previousNodeUrl)];
}

function isMediaFromNode(media, node = {}, previousNodeUrl = '') {
    if (!media || typeof media !== 'object' || !node.nodeId) return false;
    const sourceNodeId = getSourceNodeId(media);
    if (sourceNodeId === node.nodeId) return true;

    const proxyNodeId = getProxyNodeId(media.fallbackUrl) || getProxyNodeId(media.url);
    if (proxyNodeId === node.nodeId) return true;

    const nodeOrigins = [node.url, previousNodeUrl]
        .map(normalizeOrigin)
        .filter(Boolean);
    return [media.directUrl, media.url]
        .map(normalizeOrigin)
        .some(origin => origin && nodeOrigins.includes(origin));
}

function rewriteMediaForNode(media, node = {}, previousNodeUrl = '') {
    if (!media || typeof media !== 'object' || !node.url) return media;
    const result = { ...media };
    const sourceMatches = isMediaFromNode(media, node, previousNodeUrl);
    if (!sourceMatches) return result;

    if (typeof result.directUrl === 'string') {
        result.directUrl = rewriteDirectUrl(result.directUrl, node);
    }
    if (typeof result.url === 'string') {
        result.url = rewriteDirectUrl(result.url, node);
    }
    return result;
}

function rewriteDirectUrl(value, node) {
    if (!value || isProxyUrl(value, node.nodeId)) return value;
    let parsed;
    let target;
    try {
        parsed = new URL(value);
        target = new URL(node.url);
    } catch (_error) {
        return value;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return value;
    parsed.protocol = target.protocol;
    parsed.host = target.host;
    return parsed.toString();
}

function getSourceNodeId(media) {
    const value = media?.sourceNodeId || media?.ownerNodeId;
    return typeof value === 'string' ? value.trim() : '';
}

function getProxyNodeId(value) {
    if (typeof value !== 'string') return '';
    const match = value.match(/\/api\/aasc\/servers\/([^/]+)\/media-libraries\//);
    if (!match) return '';
    try {
        return decodeURIComponent(match[1]);
    } catch (_error) {
        return '';
    }
}

function isProxyUrl(value, nodeId) {
    return getProxyNodeId(value) === nodeId;
}

function normalizeOrigin(value) {
    if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) return '';
    try {
        return new URL(value.trim()).origin;
    } catch (_error) {
        return '';
    }
}

function normalizePlaylistIndex(value, length) {
    const index = Number.isSafeInteger(value) ? value : 0;
    return Math.min(Math.max(index, 0), Math.max(length - 1, 0));
}

function normalizeResumeTime(value) {
    return Number.isFinite(value) && value > 0 ? value : 0;
}

module.exports = {
    buildNormalReplayMessages,
    isMediaFromNode,
    rewriteMediaForNode
};
