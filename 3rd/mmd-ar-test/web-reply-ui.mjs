import { createReplyPlayer } from './web-reply-player.mjs';

const example = '😊你好，主人！*点头* 今天也很高兴见到你。\n[表情:眨眼 时长=1 强度=0.8]我们一起加油吧！\n[动作:挥手 时长=3 强度=0.6 次数=2]下次见！';
function initReply() {
    const panel = document.getElementById('mmdArReplyPanel');
    const advanced = document.getElementById('mmdArAdvancedMotionPanel');
    if (!panel || !advanced) return;
    const input = panel.querySelector('textarea'), message = panel.querySelector('[role="status"]');
    const speech = panel.querySelector('[data-reply-speech]'), tracks = panel.querySelector('[data-reply-tracks]');
    const progress = panel.querySelector('progress'), advancedStatus = advanced.querySelector('[role="status"]');
    const play = panel.querySelector('[data-reply="play"]'), stop = panel.querySelector('[data-reply="stop"]');
    let lastPaint = 0, lastEvents = null;
    const api = () => window.DisplayMmd;
    const busy = () => Boolean(document.querySelector('#mmdEditor [data-mode="edit"][aria-pressed="true"]')
        || document.querySelector('#edBlenderSession:not([hidden])')
        || document.getElementById('mmdEditor')?.getAttribute('aria-busy') === 'true');
    const label = event => {
        if (event.kind === 'mpl') return 'MPL 低级动作（编译后确定时长）';
        if (event.kind === 'action') return '高级动作：' + event.name + ' · ' + event.duration + '秒 / 强度' + event.strength + ' / ' + event.count + '次';
        return '表情：' + event.name + ' → ' + (event.missing ? event.reason : event.names?.join('、') || '恢复自动表情')
            + ' · ' + event.duration + '秒 / 强度' + event.strength;
    };
    function showEvents(events) {
        const fragment = document.createDocumentFragment();
        for (const event of events) {
            const row = document.createElement('li');
            row.textContent = (Number.isFinite(event.at) ? event.at.toFixed(2) + '秒 · ' : '文字位置' + event.offset + ' · ') + label(event);
            fragment.append(row);
        }
        if (!events.length) {
            const row = document.createElement('li');
            row.textContent = '没有识别到表情或动作，仍可播放文字口型。';
            fragment.append(row);
        }
        tracks.replaceChildren(fragment);
    }
    function changed(state) {
        const now = performance.now();
        if (state.phase === 'play' && now - lastPaint < 100 && state.events === lastEvents) return;
        lastPaint = now;
        if (state.events !== lastEvents) { lastEvents = state.events; showEvents(state.events); }
        if (state.speech !== undefined) speech.textContent = state.speech || '（无朗读文字）';
        progress.value = state.duration ? Math.min(1, state.time / state.duration) : 0;
        message.textContent = (state.message || '') + (state.phase === 'play' ? ' ' + state.time.toFixed(1) + ' / ' + state.duration.toFixed(1) + '秒' : '')
            + (state.warnings.length ? '\n' + state.warnings.join('\n') : '');
        advancedStatus.textContent = message.textContent;
        stop.disabled = !state.phase;
        panel.setAttribute('aria-busy', String(state.phase === 'prepare'));
    }
    const player = createReplyPlayer({ api, busy, lip: () => window.MmdArLipSyncPreview,
        body: () => window.MmdArMplPlayback, changed });
    function report(error) {
        message.textContent = error?.message || String(error);
        advancedStatus.textContent = message.textContent;
    }
    function parse() {
        try {
            const parsed = player.parse(input.value);
            speech.textContent = parsed.speech || '（无朗读文字）';
            showEvents(parsed.events);
            message.textContent = '已解析' + parsed.events.length + '个标记；净文字用于口型。'
                + (parsed.warnings.length ? '\n' + parsed.warnings.join('\n') : '');
        } catch (error) { report(error); }
    }
    input.value = example;
    panel.querySelector('[data-reply="parse"]').addEventListener('click', parse);
    panel.querySelector('[data-reply="sample"]').addEventListener('click', () => { input.value = example; parse(); });
    play.addEventListener('click', () => { void player.play(input.value).catch(report); });
    stop.addEventListener('click', () => { void player.stop().catch(report); });
    for (const button of advanced.querySelectorAll('[data-advanced]')) {
        button.addEventListener('click', () => {
            const options = { name: button.dataset.advanced, duration: Number(advanced.querySelector('[data-duration]').value),
                strength: Number(advanced.querySelector('[data-strength]').value), count: Number(advanced.querySelector('[data-count]').value) };
            advancedStatus.textContent = '准备' + options.name + '；原有手动表情与口型可同时播放。';
            void player.playAdvanced(options).catch(report);
        });
    }
    advanced.querySelector('[data-advanced-stop]').addEventListener('click', () => { void player.stop().catch(report); });
    // 外部只传完整回复；有id时去重，不把聊天历史或流式片段自动当成新动作。
    const seen = new Map();
    async function receive(detail) {
        if (!detail || typeof detail.text !== 'string') throw new Error('回复事件需要text字符串');
        if (detail.id !== undefined && (typeof detail.id !== 'string' || !detail.id || detail.id.length > 200)) throw new Error('回复id需要1–200字符的字符串');
        if (detail.id && seen.has(detail.id)) return;
        if (detail.id) {
            seen.set(detail.id, true);
            if (seen.size > 128) seen.delete(seen.keys().next().value);
        }
        try {
            input.value = detail.text;
            return await player.play(detail.text);
        } catch (error) { if (detail.id) seen.delete(detail.id); throw error; }
    }
    const listener = event => { void receive(event.detail).catch(report); };
    window.addEventListener('mmd-ar-ai-reply', listener);
    window.MmdArReplyPreview = Object.freeze({ ...player, receive });
    window.addEventListener('pagehide', event => {
        if (!event.persisted) window.removeEventListener('mmd-ar-ai-reply', listener);
    });
    parse();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initReply, { once: true });
else initReply();
