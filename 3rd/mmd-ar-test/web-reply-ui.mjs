import { ADVANCED_GESTURES, GESTURES } from './web-reply-gestures.mjs';
import { createReplyPlayer } from './web-reply-player.mjs';
import { serverActions } from './web-human-server-actions.mjs';
import { getAdvancedMpl } from './web-reply-source.mjs';

const example = '😊你好，主人！*点头* 🐾今天也很高兴见到你。❤️\n[表情:眨眼 时长=1 强度=0.8]我们一起加油吧！\n[动作:挥手 时长=3 强度=0.6 次数=2]下次见！';
function initReply() {
    const panel = document.getElementById('mmdArReplyPanel');
    const advanced = document.getElementById('mmdArAdvancedMotionPanel');
    if (!panel || !advanced) return;
    const input = panel.querySelector('textarea'), message = panel.querySelector('[role="status"]');
    const speech = panel.querySelector('[data-reply-speech]'), tracks = panel.querySelector('[data-reply-tracks]');
    const progress = panel.querySelector('progress'), advancedStatus = advanced.querySelector('[role="status"]');
    const play = panel.querySelector('[data-reply="play"]'), stop = panel.querySelector('[data-reply="stop"]');
    let lastPaint = 0, lastEvents = null;
    let sourceRequest = 0, sourceMessage = '', closed = false;
    const invalidateSource = () => { sourceRequest++; sourceMessage = ''; };
    const sourceStatus = text => { sourceMessage = text; advancedStatus.textContent = text; };
    const api = () => window.DisplayMmd;
    const busy = () => Boolean(document.querySelector('#mmdEditor [data-mode="edit"][aria-pressed="true"]')
        || document.querySelector('#edBlenderSession:not([hidden])')
        || document.getElementById('mmdEditor')?.getAttribute('aria-busy') === 'true');
    const label = event => {
        if (event.kind === 'mpl') return 'MPL 低级动作（编译后确定时长）';
        if (event.kind === 'action') return '高级动作：' + event.name + ' · ' + (event.duration == null ? '默认原时长' : event.duration + '秒') + ' / 强度' + (event.strength ?? '默认') + ' / ' + (event.count ?? '默认') + '次';
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
        advancedStatus.textContent = message.textContent + (sourceMessage ? '\n' + sourceMessage : '');
        stop.disabled = !state.phase;
        panel.setAttribute('aria-busy', String(state.phase === 'prepare'));
    }
    const player = createReplyPlayer({ api, busy, lip: () => api()?.getHumanInterface?.()?.mouth,
        body: () => window.MmdArMplPlayback, changed });
    function report(error) {
        message.textContent = error?.message || String(error);
        advancedStatus.textContent = message.textContent + (sourceMessage ? '\n' + sourceMessage : '');
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
    play.addEventListener('click', () => { invalidateSource(); void player.play(input.value).catch(report); });
    stop.addEventListener('click', () => { invalidateSource(); void player.stop().catch(report); });
    advanced.addEventListener('click', event => {
            const sourceButton = event.target.closest('[data-advanced-source]');
            if (sourceButton && advanced.contains(sourceButton)) {
                void editSource(sourceButton.dataset.advancedSource).catch(error => { sourceStatus(error.message); });
                return;
            }
            const button = event.target.closest('[data-advanced]');
            if (!button || !advanced.contains(button)) return;
            const options = parameters(button.dataset.advanced), request = ++sourceRequest;
            sourceMessage = '';
            advancedStatus.textContent = '准备' + options.name + '…';
            // 加载源码与播放各自负责结果，VMD没有源码也不能阻止播放；同次点击固定参数。
            void editSource(options.name, options, request).catch(report);
            void player.playAdvanced(options).catch(error => { if (request === sourceRequest) report(error); });
    });
    function parameters(name) {
        const value = key => { const text = advanced.querySelector('[data-' + key + ']').value.trim(); return text ? Number(text) : undefined; };
        return { name, duration: value('duration'), strength: value('strength'), count: value('count') };
    }
    async function editSource(name, options = parameters(name), request = ++sourceRequest) {
        const editor = window.MmdArMplPlayback;
        if (!editor?.editSource) { sourceStatus('MPL编辑器尚未就绪，请稍后重试'); return; }
        const human = api()?.getHumanInterface?.(), token = human?.getState?.().token, revision = editor.getSourceRevision();
        const current = () => !closed && !document.hidden && request === sourceRequest
            && human === api()?.getHumanInterface?.() && token === human?.getState?.().token
            && revision === editor.getSourceRevision();
        sourceStatus('正在读取' + name + '的MPL源码…');
        try {
            const source = await getAdvancedMpl(options, human, serverActions);
            // 新选择、用户输入和模型token均高于迟到结果；替换完整代码，不拼接多个main块。
            if (!current()) return;
            const builtin = GESTURES.has(name) && !human?.learn.list().some(action => action.actionId === name)
                && !serverActions.list().some(action => action.name === name);
            editor.editSource(source, name, builtin ? { gazeStrength: options.strength ?? 0.7, token } : null);
            sourceStatus('已载入' + name + '源码，可编辑、预览和下载。');
        } catch (error) { if (current()) sourceStatus(error.message); }
    }
    const sourceButton = name => {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'display-mmd-ar-action';
        button.dataset.advancedSource = name; button.textContent = name + ' · 编辑MPL';
        return button;
    };
    const builtins = document.createDocumentFragment();
    for (const entry of ADVANCED_GESTURES) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'display-mmd-ar-action';
        button.dataset.advanced = entry.name; button.textContent = entry.icon + ' ' + entry.name;
        button.title = entry.aliases.join('、');
        builtins.append(button, sourceButton(entry.name));
    }
    advanced.querySelector('[data-builtin-actions]').replaceChildren(builtins);
    void serverActions.load().then(entries => {
        const fragment = document.createDocumentFragment();
        for (const entry of entries) {
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'display-mmd-ar-action';
            button.dataset.advanced = entry.name; button.textContent = entry.name;
            fragment.append(button, sourceButton(entry.name));
        }
        advanced.querySelector('[data-server-actions]').replaceChildren(fragment);
        advanced.querySelector('[data-server-status]').textContent = serverActions.getState().warning
            || ('服务器动作：' + entries.length + '个');
        parse();
    });
    advanced.querySelector('[data-advanced-stop]').addEventListener('click', () => { invalidateSource(); void player.stop().catch(report); });
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
            invalidateSource(); input.value = detail.text;
            return await player.play(detail.text);
        } catch (error) { if (detail.id) seen.delete(detail.id); throw error; }
    }
    const listener = event => { void receive(event.detail).catch(report); };
    window.addEventListener('mmd-ar-ai-reply', listener);
    window.MmdArReplyPreview = Object.freeze({ ...player, receive });
    document.addEventListener('visibilitychange', () => { if (document.hidden) invalidateSource(); });
    window.addEventListener('pagehide', event => {
        invalidateSource(); closed = !event.persisted;
        if (!event.persisted) window.removeEventListener('mmd-ar-ai-reply', listener);
    });
    parse();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initReply, { once: true });
else initReply();
