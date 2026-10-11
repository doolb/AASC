import { parseReply } from './mmd-reply-parser.mjs';
import { createTextTimeline } from './mmd-lipsync-timeline.mjs';
import { replyExpressionWeights } from './mmd-reply-expressions.mjs';

// 两阶段调度：生成期间只准备；只有当前音频真正播放才能提交模型轨道。
export function createTtsActionPlayer({ audio, api, source, manual = () => 0,
    hidden = () => document.hidden, raf = requestAnimationFrame, caf = cancelAnimationFrame,
    timeline = createTextTimeline, report = error => console.warn('[MMD] TTS动作:', error.message) }) {
    const records = new Map(), cancelled = new Set();
    let chain = Promise.resolve(), current = null, frame = 0, closed = false, refreshSequence = 0, reason = '';
    const valid = record => !closed && records.get(record.id) === record && !record.cancelled;
    const token = human => human?.getState().token;
    const owner = record => 'tts:' + record.id;
    function release(record) {
        if (!record) return;
        record.cancelled = true;
        cancelled.add(record.id);
        if (cancelled.size > 128) cancelled.delete(cancelled.values().next().value);
        record.human?.stop(owner(record));
        record.human?.stop('tts-prepare:' + record.id);
        records.delete(record.id);
    }
    function stopCurrent(message = '') {
        if (message) reason = message;
        refreshSequence++;
        if (frame) caf(frame);
        frame = 0;
        release(current?.record); current = null;
    }
    function cancel(filter = {}) {
        const id = filter.id;
        if (id) { cancelled.add(id); if (cancelled.size > 128) cancelled.delete(cancelled.values().next().value); }
        const matches = record => id ? record.id === id : (!filter.conversationId || record.data.conversationId === filter.conversationId)
            && (!filter.phase || record.data.phase === filter.phase);
        if (current && matches(current.record)) stopCurrent();
        for (const record of [...records.values()]) if (matches(record)) release(record);
    }
    async function compile(record) {
        if (!valid(record) || hidden()) return;
        const human = api();
        if (!human?.getState().ready || !human.prepare || !human.startPrepared) return;
        record.human = human; record.token = token(human); record.manual = manual();
        const entries = await human.serverActions.load();
        if (!valid(record) || token(human) !== record.token) return;
        const actions = [...human.learn.list().map(item => item.actionId), ...entries.map(item => item.name)];
        const parsed = parseReply(record.data.text, { actions });
        const speech = typeof record.data.speech === 'string' ? record.data.speech : parsed.speech;
        record.speech = speech;
        record.events = parsed.events.filter(event => event.kind !== 'mpl').map((event, index) => {
            const supplied = record.data.events?.[index];
            const offset = supplied?.kind === event.kind && supplied.name === event.name && Number.isInteger(supplied.offset)
                && supplied.offset >= 0 && supplied.offset <= Array.from(speech).length ? supplied.offset : event.offset;
            return { ...event, offset, ...event.kind === 'emotion' ? human.face.resolve(event.name) : {} };
        });
        if (!record.events.length) return;
        try { record.timeline = await timeline(speech, { maxCharacters: 4000, maxBytes: 16384, maxDuration: 1500 }); }
        catch { record.timeline = { units: [], duration: Math.max(.2, Array.from(speech).length * .26) }; }
        for (const event of record.events.filter(event => event.kind === 'action')) {
            if (!valid(record) || token(human) !== record.token || hidden()) return;
            try {
                event.prepared = await human.prepare({ action: event.name, duration: event.duration,
                    strength: event.strength, count: event.count, owner: 'tts-prepare:' + record.id, priority: 40 });
            } catch (error) { if (valid(record)) report(error); }
        }
    }
    function prepare(data) {
        if (!data || data.phase !== 'answer' || typeof data.id !== 'string' || !/^[\w-]{1,50}$/u.test(data.id)
            || typeof data.text !== 'string' || new TextEncoder().encode(data.text).length > 65536
            || cancelled.has(data.id) || closed) return null;
        if (records.has(data.id)) return records.get(data.id);
        while (records.size >= 16) {
            // 后续句生成很快时只淘汰待播准备，不能打断当前正在发声的句子。
            const oldest = [...records.values()].find(record => record !== current?.record);
            if (oldest) release(oldest); else break;
        }
        const record = { id: data.id, data, events: [], created: Date.now(), cancelled: false };
        records.set(data.id, record);
        chain = chain.catch(() => {}).then(() => compile(record)).catch(error => { if (valid(record)) report(error); });
        record.ready = chain;
        return record;
    }
    async function ready(data) {
        const record = prepare(data);
        if (!record) return;
        let timer;
        // 资源准备有期限；缺失编译器/模型不能让原TTS队列永久等待。
        try { await Promise.race([record.ready, new Promise(resolve => {
            timer = setTimeout(() => { release(record); resolve(); }, 32000);
        })]); } finally { clearTimeout(timer); }
    }
    function at(event, record, duration) {
        const length = Array.from(record.speech || '').length;
        // 句尾Emoji代表这句的手势：放入末尾可播放窗口，不能排到音频ended之后永远不触发。
        if (event.offset >= length) return Math.max(0, duration - Math.min(duration, event.duration ?? event.prepared?.duration ?? 2));
        const estimated = record.timeline?.duration || 0;
        let cursor = 0, seconds = 0;
        for (const unit of record.timeline?.units || []) {
            const count = Array.from(unit.label).length;
            if (event.offset < cursor + count) {
                seconds = unit.start + (unit.end - unit.start) * (event.offset - cursor) / Math.max(1, count);
                return Math.min(duration, estimated ? duration * seconds / estimated : 0);
            }
            cursor += count;
        }
        return duration * Math.min(1, event.offset / Math.max(1, length));
    }
    function playing() {
        return !audio.paused && !audio.ended && !audio.error && !audio.seeking && audio.readyState >= 3;
    }
    function tick() {
        frame = 0;
        const session = current;
        if (!session) return;
        const record = session.record, human = record.human;
        if (!valid(record) || source() !== session.entry || api() !== human || token(human) !== record.token
            || hidden() || manual() !== record.manual) { stopCurrent('来源、模型或手动操作已变化'); return; }
        if (session.motion?.id && human.getRequest) {
            const request = human.getRequest(session.motion.id);
            if (!request.active && !request.completed) { stopCurrent('自动轨道已被停止'); return; }
        }
        if (!playing()) return;
        const duration = audio.duration, time = audio.currentTime;
        if (!Number.isFinite(duration) || duration <= 0) return;
        // 前跳不补播错过的动作，回拖不重复。自然帧间隔只影响首次触发，轨道时间由音频给定。
        const jumped = session.time !== null && time - session.time > .5 * (audio.playbackRate || 1);
        session.time = time;
        session.clock = time;
        const emotions = [];
        for (const [index, event] of record.events.entries()) {
            const start = at(event, record, duration);
            if (event.kind === 'emotion') { emotions.push({ ...event, at: start }); continue; }
            if (session.fired.has(index) || time < start) continue;
            session.fired.add(index);
            if (jumped && time - start > .15 || !event.prepared) continue;
            // 后来的手动动作优先；自动轨道不能中止MPL预览、手动高级动作或其他轨道。
            if (human.getState().layers.some(layer => layer.owner !== owner(record) && layer.priority >= 50)) continue;
            try { session.motion = human.startPrepared(event.prepared, { owner: owner(record), priority: 40,
                // 采样直接读取音频时钟，不让重型渲染帧延迟拖慢动作；未发声时保持最后位置。
                clock: () => {
                    if (playing()) session.clock = audio.currentTime;
                    return Math.max(0, session.clock - start);
                } }); }
            catch (error) { report(error); }
        }
        human.setExpressionWeights(owner(record), record.token, replyExpressionWeights(emotions, time));
        frame = raf(tick);
    }
    async function refresh() {
        const entry = source(), data = entry?.ttsAction;
        if (!entry || !data || hidden() || audio.getAttribute('src') !== entry.src) { stopCurrent(); return; }
        if (current?.entry === entry) { if (playing() && !frame) tick(); return; }
        stopCurrent();
        const request = refreshSequence;
        const record = prepare(data);
        if (!record) return;
        await record.ready;
        if (request !== refreshSequence || !valid(record) || source() !== entry || !record.human || token(record.human) !== record.token || hidden()) return;
        current = { entry, record, fired: new Set(), time: null, clock: audio.currentTime };
        if (playing()) tick();
    }
    const pause = () => {
        if (current) current.clock = audio.currentTime;
        if (frame) caf(frame); frame = 0;
    };
    function message(data) {
        if (data?.type !== 'tts') return false;
        if (data.action === 'prepareActions') { prepare(data.ttsAction); return true; }
        if (data.action === 'cancelActions') {
            if (typeof data.ttsAction?.id === 'string') cancel({ id: data.ttsAction.id });
            return true;
        }
        if (data.action === 'stop') cancel(data.chatOnly ? { conversationId: data.chatTtsConversationId, phase: data.chatTtsPhase } : {});
        return false;
    }
    return { prepare, ready, refresh, pause, cancel, message,
        getState: () => ({ prepared: records.size, id: current?.record.id || '', fired: current?.fired.size || 0, reason,
            readyActions: [...records.values()].reduce((count, record) => count + record.events.filter(event => event.prepared).length, 0) }),
        dispose() { closed = true; cancel(); } };
}

function init() {
    const audio = document.getElementById('ttsAudio');
    if (!audio) return;
    const player = createTtsActionPlayer({ audio, api: () => window.DisplayMmd?.getHumanInterface?.(),
        source: () => window.DisplayLipSyncAudio?.getState(audio),
        manual: () => window.DisplayMmdMplPlayback?.getState().pendingRequest ?? 0 });
    window.DisplayMmdTtsActions = player;
    const refresh = () => { void player.refresh().catch(error => console.warn('[MMD] TTS动作来源:', error)); };
    audio.addEventListener('mmd-tts-source-change', () => queueMicrotask(refresh));
    for (const event of ['playing', 'seeked', 'loadedmetadata', 'durationchange']) audio.addEventListener(event, refresh);
    for (const event of ['pause', 'waiting', 'seeking']) audio.addEventListener(event, player.pause);
    for (const event of ['ended', 'error']) audio.addEventListener(event, refresh);
    document.addEventListener('visibilitychange', () => { if (document.hidden) player.cancel(); else refresh(); });
    window.addEventListener('pagehide', () => player.dispose());
}
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
}
