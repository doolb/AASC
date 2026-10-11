import { encodeMorphName } from './web-mpl-morphs.mjs';

// 调试和回复只提交Human层；基础VMD和物理helper一直由原播放器持有。
function initMpl() {
    const panel = document.getElementById('mmdArMplPanel');
    if (!panel) return;
    const input = panel.querySelector('textarea'), message = panel.querySelector('[role="status"]');
    const buttons = Object.fromEntries(['play', 'stop', 'sample', 'expression-sample', 'save']
        .map(key => [key, panel.querySelector('[data-mpl="' + key + '"]')]));
    let desired = 0, owner = '', phase = '', session = null, lastResult = null, closed = false, automatic = true;
    let sourceRevision = 0, sourceName = '', sourceBlend = null;
    const downloadSource = document.createElement('button');
    downloadSource.type = 'button'; downloadSource.className = 'display-mmd-ar-action';
    downloadSource.dataset.mpl = 'download-source'; downloadSource.textContent = '下载 MPL';
    buttons.save.after(downloadSource);
    const human = () => window.DisplayMmd?.getHumanInterface?.();
    const status = text => { message.textContent = text; };
    const getState = () => {
        const current = session?.human.getRequest(session.id);
        return { phase, owner, pendingRequest: desired, request: session?.request, duration: current?.duration || 0,
            ownsMotion: !!current?.active, completed: !!current?.completed, closed,
            progress: current && { timeSeconds: current.time, durationSeconds: current.duration } };
    };
    async function launch(work, nextOwner) {
        if (closed) throw new Error('页面已关闭');
        const api = human();
        if (!api?.getState().ready) throw new Error('请等待PMX及Human动作库加载');
        const request = ++desired;
        if (owner && owner !== nextOwner) { api.stop(owner); session?.human.stop(owner); }
        owner = nextOwner; phase = 'compile'; status('正在准备Human动作层…');
        try {
            const result = await work(api);
            if (request !== desired || closed || api !== human()) {
                api.stop(nextOwner); throw new Error('动作请求已被取消或模型已切换');
            }
            session = { ...result, human: api, id: result.id, request };
            lastResult = result.buffer ? result : lastResult;
            status('动作层已播放：' + result.duration.toFixed(2) + '秒。基础VMD与物理继续运行。'
                + (result.warnings?.length ? '\n' + result.warnings.join('\n') : ''));
            return { ...result, request };
        } catch (error) { if (request === desired) status(error.message); throw error; }
        finally { if (request === desired) { phase = ''; sync(); } }
    }
    const play = (source, nextOwner = 'manual:mpl', once = true) => launch(async api => ({ ...await api.mpl.play(source,
        { owner: nextOwner, loop: !once, priority: nextOwner.startsWith('reply:') ? 50 : 100,
            ...(source === input.value && sourceBlend?.token === api.getState().token ? { gazeStrength: sourceBlend.gazeStrength,
                strength: sourceBlend.gazeStrength > 0 ? 1 : 0 } : {}) }), source }), nextOwner);
    const perform = (event, nextOwner) => launch(api => api.perform({ action: event.name,
        duration: event.duration, strength: event.strength, count: event.count,
        owner: nextOwner, priority: 50 }), nextOwner);
    async function stopOwned(target, request) {
        if ((target && target !== owner) || (request !== undefined && request !== session?.request)) return;
        ++desired;
        human()?.stop(target || owner);
        if (session?.human !== human()) session?.human.stop(target || owner);
        phase = ''; owner = ''; session = null; status('动作层已停止。基础VMD继续播放。'); sync();
    }
    function sample(withBones, auto = false) {
        if (!auto) automatic = false;
        try {
            const state = window.DisplayMmd?.getMplModelState?.();
            if (!state?.ready) throw new Error('请先加载PMX模型');
            const unique = state.morphs.filter(item => item.supported
                && state.morphs.filter(m => m.name === item.name).length === 1);
            const eligible = unique.filter(item => { try { encodeMorphName(item.name); return true; } catch { return false; } });
            const names = [3, 2, 1].map(panel => eligible.find(item => item.panel === panel)?.name).filter(Boolean);
            if (!names.length && !withBones) throw new Error('当前模型没有可写入VMD的表情');
            const pose = (name, angle, weight) => '@pose ' + name + ' {\n'
                + (withBones ? ' head ' + (angle ? 'bend forward 20' : 'reset') + ';\n' : '')
                + names.map(n => ' morph ' + JSON.stringify(n) + ' ' + weight + ';').join('\n') + '\n}\n';
            input.value = pose('normal', false, 0) + pose('expression', true, 0.7)
                + '@animation greet {\n 0: normal;\n 0.5: expression;\n 1.5: normal;\n}\nmain {\n greet;\n}';
            sourceRevision++; sourceName = ''; sourceBlend = null;
            status('已按当前PMX填入示例。MPL只覆盖代码涉及的骨骼和表情。');
        } catch (error) { status(error.message); }
    }
    function sync() {
        if (closed) return;
        const ready = human()?.getState().ready;
        if (automatic && !input.value && ready) { automatic = false; sample(true, true); }
        buttons.play.disabled = !!phase || !ready;
        buttons.sample.disabled = buttons['expression-sample'].disabled = !!phase || !ready;
        buttons.stop.disabled = !phase && !getState().ownsMotion;
        buttons.stop.textContent = phase ? '取消准备' : '停止MPL层';
        buttons.save.disabled = !lastResult || lastResult.source !== input.value;
        downloadSource.disabled = !input.value.trim();
        panel.setAttribute('aria-busy', String(!!phase));
    }
    function editSource(source, name, blend = null) {
        if (closed || typeof source !== 'string' || !source.trim() || new TextEncoder().encode(source).length > 65536) throw new Error('MPL需要1–64KiB代码');
        automatic = false; input.value = source; sourceName = name; sourceRevision++; sourceBlend = blend;
        // 静默填入源码并更新编辑状态，保留分类折叠、滚动和焦点；由用户手动打开预览。
        status('已载入「' + name + '」MPL。修改后可编译预览、下载；暂不保存高级动作。');
        sync();
    }
    window.MmdArMplPlayback = Object.freeze({ play, perform, stop: stopOwned, getState, editSource, getSourceRevision: () => sourceRevision });
    window.dispatchEvent(new Event('mmd-ar-mpl-ready'));
    input.addEventListener('input', () => { automatic = false; sourceRevision++; downloadSource.disabled = !input.value.trim(); });
    buttons.play.addEventListener('click', () => {
        const once = window.DisplayMmd?.getModelProfile?.()?.playMode === 'once';
        void play(input.value, 'manual:mpl', once).catch(error => status(error.message));
    });
    buttons.stop.addEventListener('click', () => { void stopOwned(); });
    buttons.sample.addEventListener('click', () => sample(true));
    buttons['expression-sample'].addEventListener('click', () => sample(false));
    buttons.save.addEventListener('click', () => {
        if (!lastResult || lastResult.source !== input.value) return;
        const url = URL.createObjectURL(new Blob([lastResult.buffer], { type: 'application/octet-stream' }));
        const link = document.createElement('a'); link.href = url; link.download = 'mpl-motion.vmd'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    downloadSource.addEventListener('click', () => {
        if (!input.value.trim()) return;
        const url = URL.createObjectURL(new Blob([input.value], { type: 'text/plain;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url;
        link.download = (sourceName || 'advanced-motion').replace(/[^\p{L}\p{N}_-]/gu, '_') + '.mpl'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    const timer = setInterval(() => { if (!document.hidden) sync(); }, 1000);
    window.addEventListener('pagehide', event => {
        void stopOwned();
        if (!event.persisted) { closed = true; clearInterval(timer); lastResult = session = null; }
    });
    sync();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initMpl, { once: true });
else initMpl();
