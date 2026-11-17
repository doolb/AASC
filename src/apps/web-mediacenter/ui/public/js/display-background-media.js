// 背景元素与主媒体分离，避免切换主媒体时销毁背景播放状态。
window.DisplayBackgroundMedia = (() => {
    const video = document.getElementById('backgroundMediaVideo');
    const audio = document.getElementById('backgroundMediaAudio');
    let state = null;
    let sleeping = false;
    let source = '';
    let active = null;

    function syncPlayback() {
        if (!active) return;
        if (!state.playing || sleeping) {
            active.pause();
            return;
        }
        const element = active;
        // WebView 常要求先静音启动；成功后恢复声音，同时允许与文本朗读混音。
        element.muted = true;
        const result = element.play();
        if (result && typeof result.then === 'function') {
            result.then(() => { element.muted = false; }).catch(error => {
                element.muted = false;
                console.warn('[背景媒体] 播放失败:', error);
            });
        } else element.muted = false;
    }

    return {
        apply(value) {
            state = value || { url: '', mediaType: 'audio', playing: false, loop: true, volume: 50 };
            const next = state.url ? (state.mediaType === 'video' ? video : audio) : null;
            if (next !== active || source !== state.url) {
                if (active) { active.pause(); active.removeAttribute('src'); active.load(); }
                active = next;
                source = state.url || '';
                video.style.display = active === video ? 'block' : 'none';
                if (active) { active.src = source; active.load(); }
            }
            if (active) {
                active.loop = state.loop !== false;
                active.volume = Math.max(0, Math.min(100, Number(state.volume) || 0)) / 100;
            }
            syncPlayback();
        },
        setSleeping(value) { sleeping = value; syncPlayback(); }
    };
})();
