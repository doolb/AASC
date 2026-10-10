import { VOWELS, createTextTimeline, sampleTimeline } from './mmd-lipsync-timeline.mjs';

// 文字预览与TTS共用一个临时Morph写入者。任何异步回包都必须仍拥有当前请求。
export function createLipSyncPlayer({ api, modelState, busy, getMapping, syncModel, status, progress, changed, audio }) {
    let generation = 0, sourceSequence = 0, frame = 0, timer = null, phase = '', ownedToken = '';
    let entry = null, timeline = null, selected = null, fallback = null, startAt = 0;
    let waiting = false, closed = false, suppressedEntry = null;
    const snapshot = () => window.DisplayLipSyncAudio?.getState(audio) || null;
    const sourceMatches = next => next && audio?.getAttribute('src') === next.src;
    const cancelFrame = () => { if (frame) cancelAnimationFrame(frame); frame = 0; };

    function stop(text = '', suppress = false) {
        generation++;
        cancelFrame();
        if (suppress) suppressedEntry = snapshot();
        const previous = ownedToken;
        ownedToken = '';
        phase = '';
        entry = timeline = selected = null;
        if (previous) {
            try { api()?.setLipSyncExpressions?.(previous, []); }
            catch (error) { console.warn('[MMD] 释放口型失败:', error); }
        }
        changed();
        if (text) status(text);
    }

    function apply(weights) {
        const batch = new Map();
        // 相同Morph被映射多个元音时取最大值；全0也必须覆盖动作中的张嘴。
        for (const key of VOWELS) {
            const index = selected.get(key) ?? fallback;
            batch.set(index, Math.max(batch.get(index) || 0, weights[key]));
        }
        if (!api()?.setLipSyncExpressions?.(ownedToken, [...batch])) throw new Error('当前模型口型接口尚未就绪');
    }

    function closeMouth() {
        if (!selected || !ownedToken) return;
        try { apply(Object.fromEntries(VOWELS.map(key => [key, 0]))); }
        catch (error) { stop(error?.message || String(error)); }
    }

    function tick(now) {
        frame = 0;
        if (closed || !timeline || document.hidden) return;
        try {
            const current = modelState();
            if (!current.ready || current.token !== ownedToken || busy()) {
                stop('模型已变化或进入编辑，口型已停止。');
                syncModel();
                return;
            }
            let elapsed = (now - startAt) / 1000, duration = timeline.duration;
            if (entry) {
                if (snapshot() !== entry || !sourceMatches(entry) || audio.ended || audio.error) { stop(); return; }
                duration = audio.duration;
                elapsed = audio.currentTime;
                // 未真正发声、缓冲或拖动时不靠墙钟继续张嘴。
                if (audio.paused || waiting || audio.seeking || audio.readyState < 3
                    || !Number.isFinite(duration) || duration <= 0) {
                    closeMouth();
                    return;
                }
            } else if (elapsed >= duration) {
                progress(1);
                stop('口型播放结束，已恢复原有表情；角色动作继续播放。');
                return;
            }
            const ratio = Math.max(0, Math.min(1, elapsed / duration));
            apply(sampleTimeline(timeline, ratio * timeline.duration));
            progress(ratio);
            frame = requestAnimationFrame(tick);
        } catch (error) { stop(error?.message || String(error), Boolean(entry)); }
    }

    async function start(text, nextEntry = null) {
        stop();
        let request = generation;
        try {
            syncModel();
            request = generation;
            // syncModel可能发现新模型并取消旧请求，此时捕获更新后的序号。
            const current = modelState();
            selected = getMapping();
            fallback = VOWELS.map(key => selected.get(key)).find(index => index !== null && index !== undefined);
            if (!current.ready || fallback === undefined || busy()) {
                if (!nextEntry) status('请先加载PMX并设置至少一种嘴型。');
                return;
            }
            request = generation;
            const mine = request;
            entry = nextEntry;
            ownedToken = current.token;
            phase = 'prepare';
            changed();
            closeMouth();
            if (mine !== generation) return;
            status(nextEntry ? '正在准备TTS口型…' : '正在准备文字口型…');
            const next = await createTextTimeline(text, nextEntry
                ? { maxCharacters: 4000, maxBytes: 16384, maxDuration: 1500 } : {});
            if (closed || mine !== generation || (nextEntry && snapshot() !== nextEntry)) return;
            const latest = modelState();
            if (!latest.ready || latest.token !== ownedToken || busy()) { stop(); return; }
            if (document.hidden) { stop(); return; }
            timeline = next;
            phase = nextEntry ? 'tts' : 'preview';
            startAt = performance.now();
            changed();
            const missing = VOWELS.filter(key => selected.get(key) === null);
            const note = (missing.length ? ` ${missing.map(key => key.toUpperCase()).join('/')} 使用已映射嘴型近似。` : '')
                + (next.unknown ? ` ${next.unknown}个字符按张嘴近似。` : '')
                + (next.latin ? ' 拉丁文本按拼写元音近似。' : '');
            status((nextEntry ? 'TTS口型随音频播放进度同步，字音节奏为估算；角色动作同时播放。'
                : '正在无声预览文字口型；角色动作同时播放。') + note);
            frame = requestAnimationFrame(tick);
        } catch (error) {
            // 旧字典加载失败不能中止后来的TTS或新一轮预览。
            if (request !== generation) return;
            stop(`口型未播放：${error?.message || String(error)}，语音播放不受影响。`, Boolean(nextEntry));
        }
    }

    function enabled() {
        return document.querySelector('[data-lipsync-tts]')?.checked !== false;
    }

    function reconcile() {
        if (!audio || closed || document.hidden) return;
        const next = snapshot();
        if (!next || !sourceMatches(next) || audio.ended || audio.error || !enabled()) {
            if (entry) stop();
            return;
        }
        if (next === suppressedEntry) return;
        if (entry === next) {
            if (phase === 'tts' && !audio.paused && !waiting && !audio.seeking && !frame) frame = requestAnimationFrame(tick);
            return;
        }
        // 音频开始前可按需准备字典，真正开合始终在tick中按播放状态判定。
        if (!next.text.trim()) return;
        if (phase) stop();
        void start(next.text, next);
    }

    function sourceChanged() {
        waiting = false;
        if (entry || enabled()) stop();
        clearInterval(timer);
        timer = null;
        // prepare事件在src赋值前发出；微任务中读取赋值后的来源。
        const request = ++sourceSequence;
        queueMicrotask(() => {
            if (closed || request !== sourceSequence) return;
            reconcile();
            if (snapshot()) timer = setInterval(() => {
                if (document.hidden || audio.paused) return;
                reconcile();
            }, 500);
        });
    }

    const pause = () => { if (entry) { cancelFrame(); closeMouth(); } };
    const stalled = () => { waiting = true; pause(); };
    // 网络未继续下载不代表已停止发声；缓冲仍足够时保留按音频时钟驱动。
    const networkStalled = () => { if (audio.readyState < 3) stalled(); };
    const resume = () => { waiting = false; reconcile(); };
    const finished = () => { if (audio.ended || audio.error) stop(); };
    const events = { 'mmd-tts-source-change': sourceChanged, pause, waiting: stalled,
        stalled: networkStalled, seeking: pause, playing: resume, canplay: resume, seeked: resume,
        loadedmetadata: reconcile, durationchange: reconcile, ended: finished, error: finished };
    for (const [name, handler] of Object.entries(events)) audio?.addEventListener(name, handler);
    const visibility = () => {
        if (document.hidden) stop();
        else reconcile();
    };
    document.addEventListener('visibilitychange', visibility);
    return {
        get phase() { return phase; },
        get isTts() { return Boolean(entry); },
        preview(text) {
            if (audio && snapshot() && !audio.paused && !audio.ended && enabled()) {
                status('TTS正在播放，请结束语音或关闭「同步TTS口型」后预览文字。');
                return;
            }
            void start(text);
        },
        stop,
        reconcile,
        refreshTts() { suppressedEntry = null; stop(); reconcile(); },
        suspend() { sourceSequence++; stop(); clearInterval(timer); timer = null; },
        resume: sourceChanged,
        dispose() {
            closed = true;
            sourceSequence++;
            stop();
            clearInterval(timer);
            for (const [name, handler] of Object.entries(events)) audio?.removeEventListener(name, handler);
            document.removeEventListener('visibilitychange', visibility);
        }
    };
}
