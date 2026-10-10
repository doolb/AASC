import { VOWELS } from './mmd-lipsync-timeline.mjs';
import { createLipSyncPlayer } from './mmd-lipsync-player.mjs';

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
    const panel = document.getElementById('displayMmdLipSyncPanel') || document.getElementById('mmdArLipSyncPanel');
    if (!panel) return;
    const input = panel.querySelector('textarea');
    const play = panel.querySelector('[data-lipsync-play]');
    const stop = panel.querySelector('[data-lipsync-stop]');
    const message = panel.querySelector('[role="status"]');
    const progress = panel.querySelector('progress');
    const mapping = panel.querySelector('[data-lipsync-mapping]');
    const motionPanel = panel.closest('#displayMmdMotionPanel, #mmdArMotionPanel');
    if (![input, play, stop, message, progress, mapping, motionPanel].every(Boolean)) return;
    const api = () => window.DisplayMmd;
    const modelState = () => api()?.getManualExpressions?.() || { token: '', ready: false, items: [] };
    const busy = () => document.getElementById('displayMmdPhysicsEnabled')?.disabled
        || document.getElementById('mmdArPhysicsEnabled')?.disabled
        || document.querySelector('#mmdEditor [data-mode="edit"][aria-pressed="true"]')
        || document.querySelector('#edBlenderSession:not([hidden])')
        || document.getElementById('mmdEditor')?.getAttribute('aria-busy') === 'true';
    const selectors = new Map();
    let token = null, timer = null, closed = false, player = null;
    const ttsSwitch = panel.querySelector('[data-lipsync-tts]');
    const status = text => { message.textContent = text; };

    function indexes() {
        return new Map(VOWELS.map(vowel => {
            const value = selectors.get(vowel)?.value;
            return [vowel, value === '' || value === undefined ? null : Number(value)];
        }));
    }

    function updateButtons(state = modelState()) {
        const phase = player?.phase;
        const hasMapping = [...indexes().values()].some(index => index !== null);
        play.disabled = Boolean(phase) || !state.ready || !hasMapping || Boolean(busy());
        stop.disabled = !phase;
        for (const select of selectors.values()) select.disabled = Boolean(phase) || !state.ready;
        panel.setAttribute('aria-busy', String(phase === 'prepare'));
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
                player?.stop();
                progress.value = 0;
                const missing = VOWELS.filter(key => indexes().get(key) === null);
                status(missing.length ? `未映射 ${missing.map(key => key.toUpperCase()).join('/')}，将使用其他已映射嘴型近似。` : '嘴型映射已更新，可播放文字口型。');
                player?.refreshTts();
                updateButtons();
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
        else status(`已识别 ${auto.join('/')} 嘴型；文字预览不发声，可与角色动作同时播放。${ttsSwitch ? 'TTS播放时自动同步口型。' : ''}`);
    }

    function sync() {
        if (closed) return;
        const state = modelState();
        if (state.token !== token) {
            player?.stop();
            token = state.token;
            rebuild(state);
        }
        updateButtons(state);
    }

    player = createLipSyncPlayer({ api, modelState, busy, getMapping: indexes, syncModel: sync,
        status, progress: value => { progress.value = value; }, changed: () => updateButtons(),
        audio: ttsSwitch ? document.getElementById('ttsAudio') : null });
    play.addEventListener('click', () => player.preview(input.value));
    stop.addEventListener('click', () => player.stop('口型已停止，恢复原有表情；角色动作与语音继续播放。', true));
    ttsSwitch?.addEventListener('change', () => {
        player.refreshTts();
        status(ttsSwitch.checked ? 'TTS口型同步已开启。' : 'TTS口型同步已关闭，可手动预览文字。');
    });
    input.addEventListener('input', () => {
        if (player.phase === 'prepare' && !player.isTts) player.stop('输入已改变，请重新播放。');
    });
    function watch() {
        clearInterval(timer);
        timer = null;
        if (document.hidden || motionPanel.hidden || closed) return;
        sync();
        timer = setInterval(sync, 500);
    }
    const observer = new MutationObserver(watch);
    observer.observe(motionPanel, { attributes: true, attributeFilter: ['hidden'] });
    document.addEventListener('visibilitychange', watch);
    const pageshow = () => { watch(); player.resume(); };
    window.addEventListener('pageshow', pageshow);
    window.addEventListener('pagehide', event => {
        player.suspend();
        clearInterval(timer);
        if (!event.persisted) {
            closed = true;
            player.dispose();
            observer.disconnect();
            document.removeEventListener('visibilitychange', watch);
            window.removeEventListener('pageshow', pageshow);
        }
    });
    sync();
    watch();
    player.resume();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initLipSync, { once: true });
else initLipSync();
