import { parseReply } from './web-reply-parser.mjs';
import { resolveReplyExpression, replyExpressionWeights } from './web-reply-expressions.mjs';
import { createHighLevelMpl } from './web-reply-actions.mjs';
import { createTextTimeline } from './mmd-lipsync-timeline.mjs';

// 回复调度只持有自动表情与自己的口型/身体请求。后来启动的手动操作不属于它。
export function createReplyPlayer({ api, lip, body, busy, changed }) {
    let sequence = 0, session = null, frame = 0, closed = false;
    let state = { phase: '', time: 0, duration: 0, warnings: [], events: [] };
    const model = () => api()?.getManualExpressions?.() || { ready: false, token: '', items: [] };
    const live = current => !closed && session === current && current.sequence === sequence;
    const update = patch => { state = { ...state, ...patch }; changed(state); };
    const cancelFrame = () => { if (frame) cancelAnimationFrame(frame); frame = 0; };
    function clearExpressions(current) {
        if (!current?.token) return;
        try { api()?.setReplyExpressions?.(current.token, []); }
        catch (error) { console.warn('[MMD] 释放回复表情失败:', error); }
    }
    async function release(current) {
        if (!current) return;
        clearExpressions(current);
        if (current.mouthSequence !== undefined) lip()?.stop(current.mouthSequence);
        await body()?.stop(current.owner);
    }
    async function stop(message = '已停止回复预览。') {
        const stopping = ++sequence, previous = session;
        session = null;
        cancelFrame();
        update({ phase: 'stop', message });
        try { await release(previous); }
        catch (error) { message = '预览已停止，原动作恢复失败：' + error.message; }
        if (stopping === sequence) update({ phase: '', message });
    }
    function ensureModel() {
        const current = model();
        if (!current.ready || !current.token) throw new Error('请先加载 PMX 模型；静态角色不支持回复动作。');
        if (document.hidden || busy()) throw new Error('请切到前台预览，等待模型或编辑操作完成。');
        if (!body() || !lip()) throw new Error('动作与口型模块尚未加载，请稍后重试。');
        return current;
    }
    // 字符位置对应口型时间线；拉丁单词/空白组按字符比例插值，保持同一文字时钟。
    function eventTime(offset, units, duration, length) {
        let cursor = 0;
        for (const unit of units) {
            const count = Array.from(unit.label).length;
            if (offset < cursor + count) return unit.start + (unit.end - unit.start) * (offset - cursor) / Math.max(1, count);
            cursor += count;
        }
        return length ? Math.min(duration, duration * offset / length) : 0;
    }
    async function runBody(current, event) {
        current.compiling = true;
        try {
            const result = await body().play(event.kind === 'mpl' ? event.source : createHighLevelMpl(event), current.owner, true);
            if (!live(current)) return;
            current.motion = result;
            current.lastMotionUrl = result.motionUrl;
            current.warnings.push(...(result.warnings || []));
            current.motionStarted = performance.now();
        } catch (error) {
            if (live(current)) current.warnings.push('身体动作未播放：' + error.message);
        } finally {
            current.compiling = false;
        }
    }
    function tick(now) {
        frame = 0;
        const current = session;
        if (!current || !live(current)) return;
        try {
            const latest = model();
            if (!latest.ready || latest.token !== current.token || document.hidden || busy()) {
                void stop('模型已变化、进入编辑或页面后台，回复预览已停止。');
                return;
            }
            const elapsed = Math.max(0, (now - current.startAt) / 1000);
            const mouth = lip()?.getState();
            if (current.mouthSequence !== undefined && mouth?.sequence !== current.mouthSequence) {
                // 自然结束会清空口型并递增序号；提前停止或新预览则取消旧回复。
                if (mouth?.phase || elapsed < current.mouthDuration - 0.05) {
                    void stop('口型已被手动停止或替换，回复预览已停止。');
                    return;
                }
                current.mouthSequence = undefined;
            }
            const time = mouth?.phase === 'preview' && mouth.sequence === current.mouthSequence ? mouth.time : elapsed;
            api().setReplyExpressions(current.token, replyExpressionWeights(current.emotions, time));
            const motionState = body()?.getState();
            const profile = api().getModelProfile?.();
            if (!current.bodyOwned && (profile?.motionUrl !== current.initialMotionUrl
                || profile?.motionResourceId !== current.initialMotionId
                || motionState?.pendingRequest !== current.initialBodyRequest)) {
                void stop('当前动作已由手动操作切换，回复预览已停止。');
                return;
            }
            if (current.bodyOwned && motionState?.owner !== current.owner) {
                void stop('身体动作已由新操作接管，回复预览已停止。');
                return;
            }
            if (current.bodyOwned && !current.compiling && current.lastMotionUrl
                && profile?.motionUrl !== current.lastMotionUrl) {
                void stop('当前动作已手动切换，回复预览已停止。');
                return;
            }
            if (current.motion) {
                if (!motionState?.ownsMotion) {
                    void stop('当前动作或模型已切换，回复预览已停止。');
                    return;
                }
                const progress = api().getMotionProgress?.();
                if (progress && progress.timeSeconds >= progress.durationSeconds - 1 / 60) current.motion = null;
                // 没有进度时拒绝永久占用；暂停动作也最多等待两分钟。
                if (now - current.motionStarted > 120000) throw new Error('身体动作等待超过两分钟，请检查动作播放开关。');
            }
            const next = current.actions[current.nextAction];
            if (!current.compiling && !current.motion && next && next.at <= time) {
                current.nextAction++;
                current.bodyOwned = true;
                if (time - next.at > 0.5) current.warnings.push('身体动作按队列延后：' + (next.name || 'MPL'));
                void runBody(current, next);
            }
            update({ phase: 'play', time, duration: current.duration, warnings: [...current.warnings],
                message: current.compiling ? '正在编译身体动作；表情和口型继续播放。' : '表情、身体动作与口型并行预览。' });
            if (time >= current.duration && !current.compiling && !current.motion && current.nextAction >= current.actions.length) {
                void stop('回复预览结束，已恢复原动作和表情。');
                return;
            }
            frame = requestAnimationFrame(tick);
        } catch (error) { void stop('回复已停止：' + error.message); }
    }
    async function playParsed(parsed) {
        const currentModel = ensureModel();
        const request = ++sequence, previous = session;
        session = null;
        cancelFrame();
        await release(previous);
        if (closed || request !== sequence) return;
        if (model().token !== currentModel.token) throw new Error('模型已变化，请重新播放。');
        const current = { sequence: request, token: currentModel.token, owner: 'reply:' + request,
            warnings: [...parsed.warnings], nextAction: 0, compiling: false, bodyOwned: false, motion: null,
            initialMotionUrl: api().getModelProfile?.()?.motionUrl,
            initialMotionId: api().getModelProfile?.()?.motionResourceId,
            initialBodyRequest: body().getState().pendingRequest };
        session = current;
        update({ phase: 'prepare', time: 0, duration: 0, events: [], speech: parsed.speech,
            warnings: [...current.warnings], message: '正在准备回复预览…' });
        try {
            let units = [], duration = 0;
            if (parsed.speech) {
                const pending = lip().play(parsed.speech);
                current.mouthSequence = lip().getState().sequence;
                const prepared = await pending;
                if (!live(current)) return;
                if (prepared?.phase === 'preview' && prepared.sequence === current.mouthSequence) {
                    units = prepared.units;
                    duration = prepared.duration;
                    current.mouthDuration = duration;
                    current.startAt = performance.now() - prepared.time * 1000;
                } else {
                    current.mouthSequence = undefined;
                    current.warnings.push('未播放口型，请检查口型映射或文字长度；表情和动作仍可预览。');
                    // 只有估算时间线，没有第二个Morph写入者。
                    try { const estimated = await createTextTimeline(parsed.speech); units = estimated.units; duration = estimated.duration; }
                    catch { duration = Math.min(150, Array.from(parsed.speech).length * 0.26); }
                }
            }
            if (!live(current)) return;
            current.startAt ??= performance.now();
            const length = Array.from(parsed.speech).length;
            const events = parsed.events.map(event => ({ ...event, at: eventTime(event.offset, units, duration, length),
                ...(event.kind === 'emotion' ? resolveReplyExpression(currentModel.items, event.name) : {}) }));
            for (const event of events.filter(event => event.missing)) current.warnings.push(event.name + '：' + event.reason);
            current.emotions = events.filter(event => event.kind === 'emotion');
            current.actions = events.filter(event => event.kind !== 'emotion');
            current.duration = Math.max(0.2, duration, ...events.map(event => event.at + (event.duration || 0)));
            update({ events, duration: current.duration, warnings: [...current.warnings] });
            frame = requestAnimationFrame(tick);
            return { speech: parsed.speech, events, sequence: request };
        } catch (error) {
            if (live(current)) await stop('回复未播放：' + error.message);
            throw error;
        }
    }
    const visibility = () => { if (document.hidden) void stop('页面已转入后台，回复预览已停止。'); };
    const pagehide = event => { void stop('页面已离开，回复预览已停止。'); if (!event.persisted) closed = true; };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pagehide);
    return Object.freeze({
        play: async value => playParsed(parseReply(value)),
        playAdvanced: async options => {
            const event = { name: options.name, duration: options.duration ?? 2,
                strength: options.strength ?? 0.7, count: options.count ?? 1 };
            createHighLevelMpl(event);
            return playParsed({ speech: '', warnings: [], events: [{ kind: 'action', offset: 0, ...event }] });
        },
        parse: value => {
            const parsed = parseReply(value);
            return { ...parsed, events: parsed.events.map(event => ({ ...event,
                ...(event.kind === 'emotion' ? resolveReplyExpression(model().items, event.name) : {}) })) };
        },
        stop,
        getState: () => ({ ...state, warnings: [...state.warnings], events: [...state.events] }),
    });
}
