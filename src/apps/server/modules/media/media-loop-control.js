'use strict';

const { randomUUID } = require('node:crypto');
const { normalize } = require('../../../web-mediacenter/ui/public/js/media-loop');

/** 区间设置复用显示端配置存储；广播服务端最终值，拒绝旧媒体的迟到拖动。 */
function createMediaLoopService({ persist, broadcast, send }) {
    const context = display => {
        const state = display.state;
        const item = state.currentPlaylist?.startData?.playlist?.[state.currentPlaylist.index || 0] || state.currentMedia;
        const duration = state.mediaLoopDuration ?? (state.currentPlaylist ? state.currentPlaylist.duration : state.currentMediaProgress?.duration);
        return { type: item?.mediaType, duration: Number.isFinite(duration) && duration > 0 ? duration : 0 };
    };
    const snapshot = (display, error) => ({ type: 'mediaLoopState', displayId: display.displayId,
        mediaLoop: normalize(display.state.mediaLoop), mediaLoopToken: display.state.mediaLoopToken,
        duration: ['audio', 'video'].includes(context(display).type) ? context(display).duration : 0,
        ...(error ? { error } : {}) });
    const reset = display => {
        if (!display) return;
        const partial = { mediaLoop: normalize(), mediaLoopToken: randomUUID(), mediaLoopDuration: 0 };
        Object.assign(display.state, partial);
        persist(display, partial);
        broadcast(snapshot(display));
    };
    return {
        reset,
        sent(display, data) {
            if (['url', 'base64', 'playlistStart'].includes(data.type) || (data.type === 'control' && data.action === 'clearMedia')) reset(display);
        },
        report(display, data) {
            if (!display) return;
            const playlist = display.state.currentPlaylist;
            if (data.type === 'playlistProgress' && playlist && (playlist.index !== data.index || ['finished', 'stopped'].includes(data.state))) reset(display);
            if (['audioProgress', 'videoProgress', 'playlistProgress'].includes(data.type)) {
                display.state.mediaLoopDuration = Number.isFinite(data.duration) && data.duration > 0 ? data.duration : 0;
            }
        },
        handle(display, data) {
            if (data.action !== 'mediaLoop') return false;
            const fail = message => { broadcast(snapshot(display, message)); return true; };
            if (!data.value || data.value.mediaLoopToken !== display.state.mediaLoopToken) return fail('媒体已切换，请重新调整循环区间');
            const current = context(display);
            if (data.value.enabled === true && (!['audio', 'video'].includes(current.type) || !current.duration)) return fail('当前媒体没有可用时长');
            const mediaLoop = normalize(data.value);
            try {
                persist(display, { mediaLoop, mediaLoopToken: display.state.mediaLoopToken }, { requireSave: true });
                display.state.mediaLoop = mediaLoop;
                send(display.displayId, { type: 'control', action: 'mediaLoop', value: mediaLoop });
                broadcast(snapshot(display));
            } catch { return fail('循环区间保存失败，请重试'); }
            return true;
        }
    };
}

module.exports = { createMediaLoopService, createMediaLoopToken: randomUUID, normalizeMediaLoop: normalize };
