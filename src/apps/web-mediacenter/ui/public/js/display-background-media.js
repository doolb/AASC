// 背景层独立于主媒体；异步播放结果只能更新发起该请求时的状态。
window.DisplayBackgroundMedia = (() => {
    const video = document.getElementById('backgroundMediaVideo');
    const audio = document.getElementById('backgroundMediaAudio');
    const image = document.getElementById('backgroundMediaImage');
    const player = { onStatus: null };
    let state = null;
    let sleeping = false;
    let source = '';
    let active = null;
    let generation = 0;
    let imageReady = false;

    function report(status, message = '') {
        player.onStatus?.({ status, message, url: source });
    }

    function clear(element) {
        if (!element) return;
        element.onload = null;
        element.onerror = null;
        if (element !== image) element.pause();
        element.removeAttribute('src');
        if (element !== image) element.load();
    }

    function syncPlayback() {
        const request = ++generation;
        if (!active) { report('stopped'); return; }
        if (active === image) {
            report(sleeping ? 'sleeping' : !imageReady ? 'loading' : state.playing ? 'playing' : 'paused');
            return;
        }
        if (!state.playing || sleeping) {
            active.pause();
            report(sleeping ? 'sleeping' : 'paused');
            return;
        }
        const element = active;
        // 直接申请有声播放，避免静音启动后因设备策略未恢复声音。
        element.muted = false;
        element.volume = Math.max(0, Math.min(100, Number(state.volume) || 0)) / 100;
        if (element.paused === false) { report('playing'); return; }
        report('loading');
        try {
            Promise.resolve(element.play()).then(() => {
                if (request === generation && active === element) report('playing');
            }).catch(error => {
                if (request !== generation || active !== element) return;
                report(error?.name === 'NotAllowedError' ? 'blocked' : 'error',
                    error?.name === 'NotAllowedError' ? '显示端阻止自动播放，请在显示端允许播放后重试' : '背景媒体播放失败，请检查地址和格式');
            });
        } catch (error) {
            if (request === generation) report('error', '背景媒体播放失败，请检查地址和格式');
        }
    }

    player.apply = value => {
        state = value || { url: '', mediaType: 'audio', playing: false, loop: true, volume: 50 };
        const next = state.url ? ({ audio, video, image, gif: image }[state.mediaType] || null) : null;
        if (next !== active || source !== state.url) {
            ++generation;
            clear(active);
            imageReady = false;
            active = next;
            source = state.url || '';
            video.style.display = active === video ? 'block' : 'none';
            image.style.display = active === image ? 'block' : 'none';
            if (active) {
                const element = active;
                const loadedSource = source;
                element.onerror = () => {
                    if (active === element && source === loadedSource) report('error', '背景媒体加载失败，请检查地址和格式');
                };
                if (active === image) element.onload = () => {
                    if (active === element && source === loadedSource) {
                        imageReady = true;
                        report(sleeping ? 'sleeping' : state.playing ? 'playing' : 'paused');
                    }
                };
                active.src = source;
                if (active !== image) active.load();
            }
        }
        if (active && active !== image) {
            active.loop = state.loop !== false;
            active.volume = Math.max(0, Math.min(100, Number(state.volume) || 0)) / 100;
        }
        syncPlayback();
    };
    player.setSleeping = value => { sleeping = value; syncPlayback(); };
    return player;
})();
