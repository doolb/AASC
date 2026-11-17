const DEFAULT_BACKGROUND_MEDIA = Object.freeze({ url: '', mediaType: 'audio', playing: false, loop: true, volume: 50 });

// 将控制端传来的增量操作合并为可恢复的权威状态，拒绝不可播放的地址。
function updateBackgroundMedia(previous, change) {
    if (!change || typeof change !== 'object' || Array.isArray(change)) return null;
    const state = { ...DEFAULT_BACKGROUND_MEDIA, ...previous };
    if (Object.hasOwn(change, 'url')) {
        if (typeof change.url !== 'string' || change.url.length > 4096) return null;
        const url = change.url.trim();
        if (url && !/^https?:\/\//i.test(url) && !/^\/(?![\/\\])/.test(url)) return null;
        try {
            if (url && !['http:', 'https:'].includes(new URL(url, 'http://localhost').protocol)) return null;
        } catch (_) { return null; }
        if (url && !['audio', 'video'].includes(change.mediaType)) return null;
        state.url = url;
        if (url) state.mediaType = change.mediaType;
    }
    if (Object.hasOwn(change, 'playing')) {
        if (typeof change.playing !== 'boolean') return null;
        state.playing = change.playing;
    }
    if (Object.hasOwn(change, 'loop')) {
        if (typeof change.loop !== 'boolean') return null;
        state.loop = change.loop;
    }
    if (Object.hasOwn(change, 'volume')) {
        if (typeof change.volume !== 'number' || !Number.isFinite(change.volume)) return null;
        state.volume = Math.round(Math.max(0, Math.min(100, change.volume)));
    }
    if (!state.url) state.playing = false;
    return state;
}

module.exports = { DEFAULT_BACKGROUND_MEDIA, updateBackgroundMedia };
