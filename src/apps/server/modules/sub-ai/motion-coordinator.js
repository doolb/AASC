'use strict';
const { randomUUID, createHash } = require('node:crypto');
// 上游即使未及时结束，也要在取消时释放本地并发槽；同一signal继续通知底层中止网络。
async function abortable(work, signal) {
    signal.throwIfAborted();
    let cancel;
    try {
        return await Promise.race([work(), new Promise((resolve, reject) => {
            cancel = () => reject(new Error('动作任务已取消'));
            signal.addEventListener('abort', cancel, { once: true });
            if (signal.aborted) cancel();
        })]);
    } finally { if (cancel) signal.removeEventListener('abort', cancel); }
}
function motionParameters(values = []) {
    if (!Array.isArray(values) || values.length > 3) throw new Error('动作只接受可选的时长、强度、次数');
    const limits = [['duration', 0.2, 15], ['strength', 0, 1], ['count', 1, 8]];
    return Object.fromEntries(values.map((value, index) => {
        const number = Number(value), [key, min, max] = limits[index];
        if (String(value).trim() === '' || !Number.isFinite(number) || number < min || number > max
            || (key === 'count' && !Number.isInteger(number))) throw new Error('动作时长/强度/次数超出范围');
        return [key, number];
    }));
}
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** 任务只接受登记连接的回执；服务端决定目标和owner，端侧拥有真实模型及准备句柄。 */
function createMotionCoordinator({ models, send, publish = () => {}, now = Date.now, timeoutMs = 20000 }) {
    const catalogs = new Map(), jobs = new Map(), turns = new Map(), cache = new Map();
    let generating = 0;
    const status = (job, state, message = '') => publish({ type: 'chatActionStatus', requestId: job.id,
        displayId: job.displayId, turnId: job.turnId, state, message });
    function finish(job, state, message = '') {
        if (jobs.get(job.displayId) !== job) return;
        jobs.delete(job.displayId); clearTimeout(job.timer); job.controller.abort();
        if (state !== 'completed') send(job.displayId, { type: 'chatAction', op: 'cancel', requestId: job.id });
        status(job, state, message);
    }
    function cancel(displayId, reason = '动作已取消') {
        const job = jobs.get(displayId); if (job) finish(job, 'cancelled', reason);
    }
    function begin(displayId, turnId, conversationId = turnId) {
        cancel(displayId, '新一轮对话'); turns.set(displayId, { id: turnId, conversationId, count: 0 });
    }
    function disconnect(displayId) { cancel(displayId, '显示端已断开'); catalogs.delete(displayId); turns.delete(displayId); }
    function current(job) { return jobs.get(job.displayId) === job && !job.controller.signal.aborted; }
    function prompt(displayId) {
        const catalog = catalogs.get(displayId);
        if (!catalog?.ready) return '';
        return '当前显示端支持角色动作。仅用户明确要求执行身体动作时输出独立调用行：SubAI,动作,"动作名称或完整描述"。'
            + '名称有匹配时原样使用。引用、否定、讨论动作不调用；动作代码不要写进正文，调用同一动作后不要重复[动作]标记。'
            + '可选位置参数为时长秒、强度0到1、次数1到8，例如SubAI,动作,"点头",2,0.7,2；仅末尾参数可省略。'
            + '这项指令独立播放，不等待TTS。当前动作名数据：' + JSON.stringify(catalog.actions);
    }
    function request(displayId, turnId, call) {
        const turn = turns.get(displayId), catalog = catalogs.get(displayId);
        const description = typeof call.prompt === 'string' ? call.prompt.trim() : '';
        const placeholder = { id: randomUUID(), displayId, turnId };
        if (!turn || turn.id !== turnId) return;
        let parameters;
        try { parameters = motionParameters(call.references); }
        catch (error) { status(placeholder, 'failed', error.message); return; }
        if (!catalog?.ready || !description || description.length > 500 || call.error) {
            status(placeholder, 'failed', call.error || (!catalog?.ready ? '目标显示端尚无可用Human/MPL角色' : '动作描述或参数无效')); return;
        }
        if (turn.count >= 2) { status(placeholder, 'failed', '每轮最多两次动作请求'); return; }
        turn.count++;
        cancel(displayId, '被新的动作请求替换');
        const job = { ...placeholder, conversationId: turn.conversationId, description, parameters, key: catalog.key, capabilities: catalog.capabilities,
            settings: structuredClone(models.selection()), state: 'resolving', repair: 0,
            controller: new AbortController(), deadline: now() + timeoutMs };
        jobs.set(displayId, job);
        job.timer = setTimeout(() => finish(job, 'failed', '动作准备超时'), timeoutMs);
        job.timer.unref?.();
        status(job, 'resolving', '正在查询当前角色动作库');
        send(displayId, { type: 'chatAction', op: 'resolve', requestId: job.id, key: job.key, description, parameters, deadline: job.deadline });
    }
    async function generate(job, diagnostic) {
        if (!current(job)) return;
        if (generating >= 2) { finish(job, 'failed', '动作生成忙，请稍后重试'); return; }
        job.state = 'generating'; generating++;
        status(job, 'generating', diagnostic ? '正在修正MPL' : '动作库未命中，正在生成MPL');
        try {
            const key = hash([job.description, job.parameters, job.capabilities, job.settings]);
            const cached = !diagnostic && cache.get(key);
            const artifact = cached && cached.expires > now() ? cached.value : await abortable(() => models.generate({
                description: job.description, parameters: job.parameters, capabilities: job.capabilities,
                ...(diagnostic ? { source: job.artifact.source, diagnostic } : {})
            }, { signal: job.controller.signal, settings: job.settings }), job.controller.signal);
            if (!current(job)) return;
            job.artifact = artifact; job.cacheKey = key; job.state = 'preparing';
            send(job.displayId, { type: 'chatAction', op: 'prepare', requestId: job.id, key: job.key,
                artifact, description: job.description, parameters: job.parameters, deadline: job.deadline });
        } catch (error) { if (current(job)) finish(job, 'failed', error.message); }
        finally { generating--; }
    }
    async function handle(displayId, message) {
        if (message?.type !== 'chatAction') return;
        if (message.op === 'catalog') {
            const value = message.catalog;
            if (!value || typeof value.key !== 'string' || value.key.length > 300 || typeof value.ready !== 'boolean'
                || !Array.isArray(value.actions) || value.actions.length > 160
                || value.actions.some(s => typeof s !== 'string' || s.length > 80)
                || Buffer.byteLength(JSON.stringify(value)) > 65536) return;
            if (catalogs.get(displayId)?.key !== value.key || !value.ready) cancel(displayId, '角色或动作库已变化');
            catalogs.set(displayId, { key: value.key, ready: value.ready, actions: value.actions,
                capabilities: value.capabilities || {} }); return;
        }
        const job = jobs.get(displayId);
        if (!job || message.requestId !== job.id || message.key !== job.key) return;
        if (message.op === 'missing' && job.state === 'resolving') { await generate(job); return; }
        if (message.op === 'invalid' && job.state === 'preparing') {
            if (job.repair++ < 1 && now() < job.deadline) await generate(job, String(message.message || '').slice(0, 1000));
            else finish(job, 'failed', String(message.message || '生成动作校验失败').slice(0, 1000));
            return;
        }
        if (message.op === 'ready' && ['resolving', 'preparing'].includes(job.state)) {
            if (typeof message.ticketId !== 'string' || message.ticketId.length > 80
                || !Number.isFinite(message.duration) || message.duration <= 0 || message.duration > 3600) return;
            if (job.artifact) {
                cache.set(job.cacheKey, { value: job.artifact, expires: now() + 600000 });
                while (cache.size > 16) cache.delete(cache.keys().next().value);
            }
            job.state = 'playing'; clearTimeout(job.timer);
            job.timer = setTimeout(() => finish(job, 'failed', '动作播放回执超时'), Math.min(3600000, message.duration * 1000) + 10000);
            job.timer.unref?.();
            send(displayId, { type: 'chatAction', op: 'start', requestId: job.id, key: job.key, ticketId: message.ticketId });
            status(job, 'playing', '正在播放动作'); return;
        }
        if (message.op === 'result' && ['completed', 'failed', 'cancelled'].includes(message.status)) {
            if (message.status === 'completed' && job.state !== 'playing') return;
            finish(job, message.status, String(message.message || '').slice(0, 1000));
        }
    }
    return { begin, request, handle, cancel, disconnect, prompt, cancelConversation(turnId) {
        for (const job of jobs.values()) if ((job.turnId === turnId || job.conversationId === turnId)) finish(job, 'cancelled', '对话已停止');
    }, dispose() { for (const id of [...jobs.keys()]) disconnect(id); catalogs.clear(); turns.clear(); cache.clear(); } };
}
module.exports = { createMotionCoordinator };
