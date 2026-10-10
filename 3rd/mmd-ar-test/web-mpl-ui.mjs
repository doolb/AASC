import { createLocalMotionSelection } from './web-local-assets.mjs';

const SAMPLE = `@pose normal {
    head reset;
}

@pose nod {
    head bend forward 20;
}

@animation nod_once {
    0: normal;
    0.5: nod;
    1.0: normal;
}

main {
    nod_once;
}`;

function normalizeSource(value) {
    const source = String(value).trim();
    // 仅去掉包裹整段代码的 Markdown 围栏，不猜测或执行 LLM 的其他输出。
    const fenced = source.match(/^```(?:mpl)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/iu);
    const text = fenced ? fenced[1].trim() : source;
    if (!text) throw new Error('请输入 MPL 代码');
    if (new TextEncoder().encode(text).length > 64 * 1024) throw new Error('MPL 输入不能超过64KiB');
    return text;
}

function initMpl() {
    const panel = document.getElementById('mmdArMplPanel');
    if (!panel) return;
    const input = panel.querySelector('textarea');
    const play = panel.querySelector('[data-mpl="play"]');
    const stop = panel.querySelector('[data-mpl="stop"]');
    const sample = panel.querySelector('[data-mpl="sample"]');
    const save = panel.querySelector('[data-mpl="save"]');
    const message = panel.querySelector('[role="status"]');
    const api = () => window.DisplayMmd;
    let phase = '', cancelCompile = null, session = null, lastResult = null;
    let closed = false;
    const resources = new Set();
    input.value = SAMPLE;

    const status = (text, error = false) => {
        message.textContent = text;
        message.dataset.error = String(error);
    };
    const modelKey = profile => `${profile?.modelUrl || ''}\0${profile?.resourceId || ''}`;
    const currentProfile = () => api()?.getModelProfile?.();
    const ownsCurrentMotion = () => session && modelKey(currentProfile()) === session.modelKey
        && currentProfile()?.motionUrl === session.motion.motionUrl
        && currentProfile()?.motionResourceId === session.motion.motionResourceId;
    const editorActive = () => document.querySelector('#mmdEditor [data-mode="edit"][aria-pressed="true"]')
        || document.querySelector('#edBlenderSession:not([hidden])')
        || document.getElementById('mmdEditor')?.getAttribute('aria-busy') === 'true';

    function readCurrent() {
        if (!api()?.getState?.().modelReady) throw new Error('请先加载 PMX 模型');
        if (editorActive()) throw new Error('请先退出编辑或 Blender 工程，切到预览再播放 MPL');
        if (document.getElementById('mmdArPhysicsEnabled')?.disabled) throw new Error('物理或模型正在加载，请稍后再试');
        const profile = currentProfile();
        const mesh = api().getEditorBridge?.()?.context?.mesh;
        if (profile?.modelType !== 'pmx' || !mesh?.isSkinnedMesh || !mesh.geometry?.userData?.MMD) {
            throw new Error('MPL 需要带 MMD 骨骼的 PMX 模型；静态角色不支持');
        }
        return { profile, mesh, playing: api().getState().motionPlaybackEnabled === true };
    }

    function collectResources() {
        // 换模型时可能继承当前 VMD，不能仅因模型变化就释放仍被 profile 引用的 File。
        const url = currentProfile()?.motionUrl;
        for (const resource of resources) {
            // 新模型可继承上一份 MPL；再次生成时，该资源就是需要恢复的原动作。
            if (resource.motionUrl === url || resource.motionUrl === session?.original.motionUrl) continue;
            resource.release();
            resources.delete(resource);
        }
    }

    function sync() {
        if (closed) return;
        if (!phase) {
            if (session && !ownsCurrentMotion()) {
                session = null;
                status('当前模型或动作已切换；可以重新编译 MPL。');
            }
            collectResources();
        }
        play.disabled = Boolean(phase);
        sample.disabled = Boolean(phase);
        save.disabled = !lastResult;
        stop.disabled = phase ? phase !== 'compile' : !ownsCurrentMotion();
        stop.textContent = phase === 'compile' ? '取消编译' : '停止并恢复原动作';
        panel.setAttribute('aria-busy', String(Boolean(phase)));
    }

    function compile(source) {
        return new Promise((resolve, reject) => {
            let worker, timer, settled = false;
            const finish = (error, result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                worker?.terminate();
                cancelCompile = null;
                if (error) reject(error);
                else resolve(result);
            };
            cancelCompile = () => finish(new Error('已取消编译；保留当前动作。'));
            try {
                worker = new Worker(new URL('__MPL_WORKER_URL__', import.meta.url), { type: 'module' });
                timer = setTimeout(() => finish(new Error('MPL 编译超过30秒，已终止；请缩短代码后重试')), 30000);
                worker.onmessage = ({ data }) => {
                    if (data?.error) return finish(new Error(data.error));
                    if (!(data?.buffer instanceof ArrayBuffer) || !Array.isArray(data.bones)) {
                        return finish(new Error('MPL 编译结果无效'));
                    }
                    finish(null, data);
                };
                worker.onerror = event => {
                    event.preventDefault();
                    finish(new Error(event.message || 'MPL Worker 加载失败；请检查编译器资源'));
                };
                worker.onmessageerror = () => finish(new Error('MPL 编译结果传输失败'));
                worker.postMessage({ source });
            } catch (error) {
                finish(error);
            }
        });
    }

    async function compileAndPlay() {
        if (phase || closed) return;
        let next;
        try {
            const source = normalizeSource(input.value);
            const before = readCurrent();
            const original = ownsCurrentMotion() ? session.original : {
                motionUrl: before.profile.motionUrl || '',
                motionResourceId: before.profile.motionResourceId || '', playing: before.playing,
            };
            phase = 'compile';
            status('正在加载 MPL 编译器并编译…');
            sync();
            const result = await compile(source);
            if (closed) return;
            const current = readCurrent();
            if (current.mesh !== before.mesh || modelKey(current.profile) !== modelKey(before.profile)
                || current.profile.motionUrl !== before.profile.motionUrl
                || current.profile.motionResourceId !== before.profile.motionResourceId) {
                throw new Error('编译期间模型或动作已变化；保留新选择，请重新播放 MPL');
            }
            const available = new Set(current.mesh.skeleton.bones.map(bone => bone.name));
            const matched = result.bones.filter(name => available.has(name));
            const missing = result.bones.filter(name => !available.has(name));
            lastResult = result;
            if (!matched.length) throw new Error(`MPL 骨骼与当前 PMX 不匹配：${result.bones.join('、')}`);
            phase = 'load';
            sync();
            const file = new File([result.buffer], 'mpl-motion.vmd', { type: 'application/octet-stream' });
            next = createLocalMotionSelection(file);
            resources.add(next);
            if (!await api().loadSelectedMotion(next, detail => status(detail.phase || '正在加载 MPL 动作…'))) {
                throw new Error('MPL 动作加载已取消；保留当前选择');
            }
            if (closed) return;
            // 外部换动作/换模型可能取消这次加载，只有本次结果仍是当前动作才更新播放状态。
            if (modelKey(currentProfile()) !== modelKey(before.profile) || currentProfile()?.motionUrl !== next.motionUrl) {
                throw new Error('当前选择已改变，MPL 未应用');
            }
            session = { modelKey: modelKey(before.profile), original, motion: next };
            api().setMotionPlaybackEnabled(true);
            status(`MPL 已播放：${result.duration.toFixed(2)}秒，${result.boneFrames}条骨骼帧，匹配${matched.length}个骨骼。`
                + (result.poseHold ? ' 纯姿势已生成1秒静态保持。' : '')
                + (missing.length ? ` 未匹配：${missing.join('、')}。` : ''));
        } catch (error) {
            if (!closed) status(error?.message || String(error), true);
        } finally {
            phase = '';
            // 失败时只清理未被 runtime 使用的资源；成功时释放上一份生成的动作。
            if (next && currentProfile()?.motionUrl !== next.motionUrl) {
                next.release();
                resources.delete(next);
            }
            sync();
        }
    }

    async function restore() {
        if (phase || !ownsCurrentMotion() || closed) return;
        const previous = session;
        try {
            readCurrent();
            phase = 'restore';
            status('正在恢复原动作…');
            sync();
            if (!await api().loadSelectedMotion(previous.original, detail => status(detail.phase || '正在恢复原动作…'))) {
                throw new Error('原动作恢复已取消');
            }
            if (closed) return;
            if (modelKey(currentProfile()) !== previous.modelKey
                || currentProfile()?.motionUrl !== previous.original.motionUrl) throw new Error('恢复期间当前选择已改变；保留新选择');
            api().setMotionPlaybackEnabled(previous.original.playing);
            session = null;
            status('MPL 已停止，已恢复原动作和播放开关。');
        } catch (error) {
            if (!closed) status(error?.message || String(error), true);
        } finally {
            phase = '';
            sync();
        }
    }

    play.addEventListener('click', () => { void compileAndPlay(); });
    sample.addEventListener('click', () => { input.value = SAMPLE; status('已填入点头示例，点击「编译并播放」。'); });
    stop.addEventListener('click', () => {
        if (phase === 'compile') cancelCompile?.();
        else void restore();
    });
    save.addEventListener('click', () => {
        if (!lastResult) return;
        const url = URL.createObjectURL(new Blob([lastResult.buffer], { type: 'application/octet-stream' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'mpl-motion.vmd';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    const timer = setInterval(sync, 1000);
    window.addEventListener('pagehide', event => {
        if (event.persisted) return;
        closed = true;
        clearInterval(timer);
        cancelCompile?.();
        for (const resource of resources) resource.release();
        resources.clear();
        lastResult = session = null;
    });
    sync();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initMpl, { once: true });
else initMpl();
