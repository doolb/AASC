import { parseReply, ACTIONS } from './mmd-reply-parser.mjs';
import { GESTURES } from './mmd-reply-gestures.mjs';

/** 单个显示端只持有自己的准备句柄，网络端只能引用随机ticket。 */
export function createChatActionPlayer({ api, send, hidden = () => document.hidden, report = () => {}, now = Date.now }) {
    let connected = false, active = null, publishedKey = '', closed = false, publishing = false;
    const cancelled = new Set();
    const owner = job => 'subai:' + job.id;
    function reply(job, op, extra = {}) { send({ type: 'chatAction', op, requestId: job.id, key: job.key, ...extra }); }
    function valid(job) {
        return !closed && active === job && connected && !hidden() && api() === job.human
            && job.human.actionKey() === job.key && !cancelled.has(job.id);
    }
    function cancel(message = '动作已取消') {
        const job = active; active = null;
        if (!job) return;
        cancelled.add(job.id); if (cancelled.size > 128) cancelled.delete(cancelled.values().next().value);
        job.human.stop(owner(job));
        reply(job, 'result', { status: 'cancelled', message }); report(message);
    }
    async function catalog() {
        if (!connected || closed || publishing || active?.saving) return;
        const human = api();
        const state = human?.getState();
        const key = human?.actionKey?.() || 'unsupported';
        const ready = Boolean(state?.ready && human?.prepareMpl && !hidden());
        const stamp = key + ':' + ready;
        if (publishedKey === stamp) return;
        publishing = true;
        try {
            const entries = ready ? await human.serverActions.load() : [];
            if (!connected || closed || api() !== human || (human?.actionKey?.() || 'unsupported') !== key) return;
            const capabilities = ready ? human.capabilities() : {};
            const actions = ready ? [...new Set([...state.actions.map(a => a.actionId), ...entries.map(a => a.name), ...GESTURES.keys()])].slice(0, 160) : [];
            send({ type: 'chatAction', op: 'catalog', catalog: { key, ready, actions,
                capabilities: ready ? { signature: state.signature, bindings: capabilities.bindings,
                    bones: capabilities.bones.slice(0, 512), morphs: capabilities.morphs.slice(0, 256) } : {} } });
            publishedKey = stamp;
        } catch (error) { report('动作目录读取失败：' + error.message); }
        finally { publishing = false; }
    }
    async function resolve(message) {
        if (cancelled.has(message.requestId)) return;
        cancel('新的动作请求');
        const human = api();
        if (!human?.getState().ready || message.key !== human.actionKey() || hidden()) return;
        const job = { id: message.requestId, key: message.key, description: message.description, parameters: message.parameters || {}, deadline: message.deadline, human };
        active = job;
        const entries = await human.serverActions.load();
        if (!valid(job)) return;
        const names = [...human.learn.list().map(a => a.actionId), ...entries.map(a => a.name)];
        const known = names.includes(job.description) || Object.entries(ACTIONS).some(([name, aliases]) => name === job.description || aliases.includes(job.description.toLowerCase()));
        const event = known ? parseReply('[动作:' + JSON.stringify(job.description) + ']', { actions: names }).events[0] : null;
        if (!event) { job.phase = 'missing'; reply(job, 'missing'); return; }
        job.prepared = await human.prepare({ action: event.name, ...job.parameters, owner: owner(job), priority: 40 });
        if (valid(job)) ready(job);
    }
    function ready(job) {
        job.phase = 'ready'; job.ticketId = globalThis.crypto?.randomUUID?.() || job.id + ':prepared';
        reply(job, 'ready', { ticketId: job.ticketId, duration: job.prepared.duration });
    }
    async function prepare(message) {
        const job = active;
        if (!job || message.requestId !== job.id || message.key !== job.key || !valid(job)
            || !['missing', 'invalid'].includes(job.phase)) return;
        job.phase = 'preparing'; job.artifact = message.artifact;
        try {
            job.prepared = await job.human.prepareMpl(message.artifact.source, { owner: owner(job) });
            if (valid(job)) ready(job);
        } catch (error) {
            if (valid(job)) { job.phase = 'invalid'; reply(job, 'invalid', { message: error.message }); }
        }
    }
    function start(message) {
        const job = active;
        if (!job || !valid(job) || job.phase !== 'ready' || message.requestId !== job.id
            || message.key !== job.key || message.ticketId !== job.ticketId || now() >= job.deadline) return;
        if (job.human.getState().layers.some(layer => layer.priority >= 50)) { cancel('手动动作优先，自动动作已跳过'); return; }
        job.motion = job.human.startPrepared(job.prepared, { owner: owner(job), priority: 40 });
        job.phase = 'playing'; report('正在播放：' + job.description);
    }
    async function tick() {
        const job = active;
        if (job && !job.saving) {
            if (!valid(job)) { cancel('角色、动作库或页面状态已变化'); }
            else if (job.phase !== 'playing' && now() >= job.deadline) { cancel('动作准备超时'); }
            else if (job.phase === 'playing') {
                const state = job.human.getRequest(job.motion.id);
                if (job.human.getState().layers.some(layer => layer.owner !== owner(job) && layer.priority >= 50)) { cancel('手动动作已接管'); }
                else if (!state.active) {
                    if (!state.completed) { cancel('动作被中断'); }
                    else {
                        job.saving = true;
                        let message = '动作播放完成';
                        try {
                            if (job.artifact) {
                                await job.human.candidates.save({ ...job.artifact, description: job.description, parameters: job.parameters, requestId: job.id }, job.key);
                                message += '，已保存候选版本';
                            }
                        } catch (error) { message += '；候选保存失败：' + error.message; }
                        if (active === job) { reply(job, 'result', { status: 'completed', message }); active = null; report(message); }
                    }
                }
            }
        }
        await catalog();
    }
    async function handle(message) {
        if (!connected || closed) return;
        if (message?.type === 'tts' && message.action === 'stop') { cancel('已停止'); return; }
        if (message?.type !== 'chatAction') return;
        if (message.op === 'cancel') { if (active?.id === message.requestId) cancel(); return; }
        const handler = { resolve, prepare, start }[message.op];
        if (!handler || typeof message.requestId !== 'string' || message.requestId.length > 80) return;
        try { await handler(message); }
        catch (error) {
            const job = active;
            if (job?.id === message.requestId) { reply(job, 'result', { status: 'failed', message: error.message }); cancel(error.message); }
        }
    }
    return { handle, tick, cancel, setConnected(value) {
        connected = value === true; publishedKey = '';
        if (!connected) cancel('连接已断开');
    }, dispose() { cancel(); closed = true; }, getState: () => ({ id: active?.id, phase: active?.phase }) };
}

export function attachChatActions({ bus, send, getState }) {
    const report = text => {
        const target = document.querySelector('[data-motion-status]');
        if (target) target.textContent = text;
    };
    const player = createChatActionPlayer({ api: () => window.DisplayMmd?.getHumanInterface?.(), send, report });
    bus.subscribe('server.message', message => { void player.handle(message); });
    bus.subscribe('transport.changed', event => player.setConnected(event.available));
    player.setConnected(Boolean(getState()?.transport));
    const timer = setInterval(() => { void player.tick().catch(error => report(error.message)); }, 250);
    document.addEventListener('visibilitychange', () => { if (document.hidden) player.cancel('页面已隐藏'); });
    window.addEventListener('pagehide', () => { clearInterval(timer); player.dispose(); }, { once: true });
    window.DisplayMmdChatActions = Object.freeze({ stop: () => player.cancel(), getState: player.getState });
    return player;
}
