import { VOWELS, validateText, createTextTimeline, sampleTimeline } from './web-lipsync-timeline.mjs';

// 只用名称识别默认映射；真正控制始终使用当前模型原始索引，保留空格/重名差异。
const ALIASES = {
    a: ['あ', 'a', 'aa', 'mouth_a', 'moutha', '口_a'],
    i: ['い', 'i', 'ih', 'mouth_i', 'mouthi', '口_i'],
    u: ['う', 'u', 'ou', 'mouth_u', 'mouthu', '口_u'],
    e: ['え', 'e', 'ee', 'mouth_e', 'mouthe', '口_e'],
    o: ['お', 'o', 'oh', 'mouth_o', 'moutho', '口_o'],
};
const nameKey = name => String(name || '').trim().toLowerCase();

function initLipSync() {
    const panel = document.getElementById('mmdArLipSyncPanel');
    if (!panel) return;
    const input = panel.querySelector('textarea');
    const play = panel.querySelector('[data-lipsync-play]');
    const stop = panel.querySelector('[data-lipsync-stop]');
    const message = panel.querySelector('[role="status"]');
    const progress = panel.querySelector('progress');
    const mapping = panel.querySelector('[data-lipsync-mapping]');
    const motionPanel = panel.closest('#mmdArMotionPanel');
    if (![input, play, stop, message, progress, mapping, motionPanel].every(Boolean)) return;
    const api = () => window.DisplayMmd;
    const modelState = () => api()?.getManualExpressions?.() || { token: '', ready: false, items: [] };
    const busy = () => document.getElementById('mmdArPhysicsEnabled')?.disabled
        || document.querySelector('#mmdEditor [data-mode="edit"][aria-pressed="true"]')
        || document.querySelector('#edBlenderSession:not([hidden])')
        || document.getElementById('mmdEditor')?.getAttribute('aria-busy') === 'true';
    const selectors = new Map();
    let token = null, generation = 0, frame = 0, timer = null, closed = false;
    let phase = '', ownedToken = '', timeline = null, startAt = 0, lastUnit = -1;
    const status = text => { message.textContent = text; };

    function indexes() {
        return new Map(VOWELS.map(vowel => {
            const value = selectors.get(vowel)?.value;
            return [vowel, value === '' || value === undefined ? null : Number(value)];
        }));
    }

    function updateButtons(state = modelState()) {
        const hasMapping = [...indexes().values()].some(index => index !== null);
        play.disabled = Boolean(phase) || !state.ready || !hasMapping || Boolean(busy());
        stop.disabled = !phase;
        for (const select of selectors.values()) select.disabled = Boolean(phase) || !state.ready;
        panel.setAttribute('aria-busy', String(phase === 'prepare'));
    }

    function stopPlayback(text = '') {
        generation++;
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        const previousToken = ownedToken;
        ownedToken = '';
        phase = '';
        timeline = null;
        if (previousToken) {
            try { api()?.setLipSyncExpressions?.(previousToken, []); }
            catch (error) { console.warn('[MMD] 释放口型失败:', error); }
        }
        updateButtons();
        if (text) status(text);
    }

    function rebuild(state) {
        const fragment = document.createDocumentFragment();
        selectors.clear();
        const supported = state.items.filter(item => item.supported);
        // 优先列出模型嘴型，其他可用Morph放在后面供非标准模型手动映射。
        const choices = [...supported.filter(item => item.panel === 3), ...supported.filter(item => item.panel !== 3)];
        const auto = [];
        for (const vowel of VOWELS) {
            const label = document.createElement('label');
            label.className = 'mind-basic-field';
            const title = document.createElement('span');
            title.textContent = `${vowel.toUpperCase()} 嘴型`;
            const select = document.createElement('select');
            select.setAttribute('aria-label', `${vowel.toUpperCase()} 嘴型映射`);
            const none = document.createElement('option');
            none.value = '';
            none.textContent = '未映射（使用其他已映射嘴型近似）';
            select.append(none);
            for (const item of choices) {
                const option = document.createElement('option');
                option.value = String(item.index);
                option.textContent = `${item.name || '未命名'} · #${item.index + 1}`;
                select.append(option);
            }
            for (const alias of ALIASES[vowel]) {
                const matches = supported.filter(item => nameKey(item.name) === alias);
                // 名称重复时不要猜选哪个；用户可按原始索引手工选择。
                if (matches.length === 1) {
                    select.value = String(matches[0].index);
                    auto.push(vowel.toUpperCase());
                    break;
                }
            }
            select.addEventListener('change', () => {
                stopPlayback();
                progress.value = 0;
                const missing = VOWELS.filter(key => indexes().get(key) === null);
                status(missing.length ? `未映射 ${missing.map(key => key.toUpperCase()).join('/')}，将使用其他已映射嘴型近似。` : '嘴型映射已更新，可播放文字口型。');
            });
            label.append(title, select);
            fragment.append(label);
            selectors.set(vowel, select);
        }
        mapping.replaceChildren(fragment);
        progress.value = 0;
        if (!state.ready) status('请先加载 PMX 模型。');
        else if (!supported.length) status('当前 PMX 没有可用表情，无法播放口型。');
        else if (!auto.length) status('未识别标准嘴型，请展开「嘴型映射」选择对应表情后播放。');
        else status(`已识别 ${auto.join('/')} 嘴型；文字按估算节奏预览，不发声，可与角色动作同时播放。`);
    }

    function sync() {
        if (closed) return;
        const state = modelState();
        if (state.token !== token) {
            stopPlayback();
            token = state.token;
            rebuild(state);
        }
        updateButtons(state);
    }

    async function startPlayback() {
        if (phase || closed) return;
        let currentGeneration = null;
        try {
            const text = validateText(input.value);
            sync();
            const state = modelState(), selected = indexes();
            const fallback = VOWELS.map(key => selected.get(key)).find(index => index !== null);
            if (!state.ready || fallback === undefined) throw new Error('请先加载PMX并设置至少一种嘴型');
            if (busy()) throw new Error('模型正在加载或编辑，请切换到预览后再试');
            currentGeneration = ++generation;
            phase = 'prepare';
            updateButtons(state);
            status('正在准备文字口型…');
            const next = await createTextTimeline(text);
            if (closed || currentGeneration !== generation) return;
            const latest = modelState();
            if (latest.token !== state.token || !latest.ready || busy()) throw new Error('模型已变化，请重新播放口型');
            if (document.hidden) throw new Error('页面已进入后台，请回到页面重新播放');
            timeline = next;
            phase = 'play';
            ownedToken = state.token;
            startAt = performance.now();
            lastUnit = -1;
            progress.value = 0;
            updateButtons(latest);
            const missing = VOWELS.filter(key => selected.get(key) === null);
            const note = (missing.length ? ` ${missing.map(key => key.toUpperCase()).join('/')} 使用已映射嘴型近似。` : '')
                + (next.unknown ? ` ${next.unknown}个字符按张嘴近似。` : '')
                + (next.latin ? ' 拉丁文本按拼写元音近似。' : '');
            function tick(now) {
                frame = 0;
                try {
                    if (closed || currentGeneration !== generation) return;
                    const current = modelState();
                    if (!current.ready || current.token !== ownedToken || busy()) {
                        stopPlayback('模型已变化或进入编辑，口型已停止。');
                        sync();
                        return;
                    }
                    const elapsed = (now - startAt) / 1000;
                    if (elapsed >= next.duration) {
                        progress.value = 1;
                        stopPlayback('口型播放结束，已恢复原有表情；角色动作继续播放。');
                        return;
                    }
                    const weights = sampleTimeline(next, elapsed), batch = new Map();
                    // 同一Morph可用于多个元音，取最大权重避免后写零值覆盖前一元音。
                    for (const key of VOWELS) {
                        const index = selected.get(key) ?? fallback;
                        batch.set(index, Math.max(batch.get(index) || 0, weights[key]));
                    }
                    if (!api()?.setLipSyncExpressions?.(ownedToken, [...batch])) throw new Error('当前模型口型接口尚未就绪');
                    progress.value = elapsed / next.duration;
                    const unitIndex = next.units.findIndex(unit => unit.end > elapsed);
                    if (unitIndex !== lastUnit) {
                        lastUnit = unitIndex;
                        const unit = next.units[unitIndex];
                        status(`口型预览 ${elapsed.toFixed(1)} / ${next.duration.toFixed(1)}秒 · ${unit?.label || '闭嘴'}${unit?.sound ? ` (${unit.sound})` : ' · 停顿'}。${note}`);
                    }
                    frame = requestAnimationFrame(tick);
                } catch (error) { stopPlayback(error?.message || String(error)); }
            }
            frame = requestAnimationFrame(tick);
        } catch (error) {
            // 取消后的旧字典请求失败也不能中止用户后来开始的新一轮播放。
            if (currentGeneration !== null && currentGeneration !== generation) return;
            stopPlayback(error?.message || String(error));
        }
    }

    play.addEventListener('click', () => { void startPlayback(); });
    stop.addEventListener('click', () => stopPlayback('口型已停止，恢复原有表情；角色动作继续播放。'));
    input.addEventListener('input', () => {
        if (phase === 'prepare') stopPlayback('输入已改变，请重新播放。');
    });
    function watch() {
        clearInterval(timer);
        timer = null;
        if (document.hidden) { if (phase) stopPlayback('页面进入后台，口型已停止。'); return; }
        if (motionPanel.hidden || closed) return;
        sync();
        timer = setInterval(sync, 500);
    }
    const observer = new MutationObserver(watch);
    observer.observe(motionPanel, { attributes: true, attributeFilter: ['hidden'] });
    document.addEventListener('visibilitychange', watch);
    window.addEventListener('pageshow', watch);
    window.addEventListener('pagehide', event => {
        stopPlayback();
        clearInterval(timer);
        if (!event.persisted) {
            closed = true;
            observer.disconnect();
            document.removeEventListener('visibilitychange', watch);
            window.removeEventListener('pageshow', watch);
        }
    });
    sync();
    watch();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initLipSync, { once: true });
else initLipSync();
