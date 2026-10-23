// 浏览器与 Node 共用区间规范化，确保控制端、服务端和播放器的边界一致。
(function(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.MediaLoop = api;
})(typeof globalThis === 'object' ? globalThis : this, function() {
    const GAP = 0.1;
    function normalize(value = {}) {
        const source = value && typeof value === 'object' ? value : {};
        const number = (candidate, fallback) => typeof candidate === 'number' && Number.isFinite(candidate)
            ? Math.round(Math.max(0, Math.min(100, candidate)) * 10) / 10 : fallback;
        const startPercent = Math.min(100 - GAP, number(source.startPercent, 0));
        const endPercent = Math.max(Math.round((startPercent + GAP) * 10) / 10, number(source.endPercent, 100));
        return { enabled: source.enabled === true, startPercent, endPercent };
    }

    function seconds(value, duration) {
        const range = normalize(value);
        if (!range.enabled || !Number.isFinite(duration) || duration <= 0) return null;
        return { start: duration * range.startPercent / 100, end: duration * range.endPercent / 100 };
    }

    // 持久监听不占用页面的 ontimeupdate；切换媒体时由调用方显式清除区间。
    function attach(media) {
        let range = normalize();
        let previousLoop = null;
        let playing = !media.paused;
        const enforce = (force = false) => {
            const bounds = seconds(range, media.duration);
            if (!bounds || (!force && media.paused)) return;
            if (media.currentTime < bounds.start || media.currentTime >= bounds.end) {
                media.currentTime = bounds.start;
            }
        };
        const onTime = () => enforce();
        const onPlay = () => { playing = true; enforce(true); };
        const onPause = () => { if (!media.ended) playing = false; };
        // 捕获 ended，避免浏览器抵达文件结尾时播放列表同时切到下一项。
        const onEnded = event => {
            if (!seconds(range, media.duration)) return;
            event.stopImmediatePropagation();
            if (!playing) return;
            enforce(true);
            try { const playing = media.play(); playing?.catch?.(() => {}); } catch { /* 播放限制交由页面原有恢复机制处理。 */ }
        };
        media.addEventListener('timeupdate', onTime);
        media.addEventListener('play', onPlay);
        media.addEventListener('pause', onPause);
        media.addEventListener('loadedmetadata', onTime);
        media.addEventListener('ended', onEnded, true);
        return {
            set(value) {
                const next = normalize(value);
                if (next.enabled && !range.enabled) previousLoop = media.loop;
                if (!next.enabled && range.enabled && previousLoop !== null) media.loop = previousLoop;
                range = next;
                if (range.enabled) media.loop = false;
                enforce();
                return range;
            },
            reset() { this.set(); previousLoop = null; },
            get value() { return { ...range }; }
        };
    }
    return { GAP, normalize, seconds, attach };
});
