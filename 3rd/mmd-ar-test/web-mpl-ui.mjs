import { createLocalMotionSelection } from './web-local-assets.mjs';

// 示例使用当前PMX真实名称；同一时间点同时定义点头和表情。
function createSample(names, withBones) {
    const statements = weight => names.map(name => `    morph ${JSON.stringify(name)} ${weight};`);
    const normal = [...(withBones ? ['    head reset;'] : []), ...statements(0)].join('\n');
    const expression = [...(withBones ? ['    head bend forward 20;'] : []), ...statements(0.7)].join('\n');
    return `@pose normal {\n${normal}\n}\n\n@pose expression {\n${expression}\n}\n\n@animation greet {\n    0: normal;\n    0.5: expression;\n    1.5: normal;\n}\n\nmain {\n    greet;\n}`;
}

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
    const expressionSample = panel.querySelector('[data-mpl="expression-sample"]');
    const save = panel.querySelector('[data-mpl="save"]');
    const message = panel.querySelector('[role="status"]');
    const api = () => window.DisplayMmd;
    let phase = '', cancelCompile = null, session = null, lastResult = null;
    let closed = false, defaultSamplePending = true, sampleGeneration = 0;
    const resources = new Set();
    input.value = '';
    input.placeholder = 'PMX 模型加载后自动填入动作＋表情示例，也可直接粘贴 MPL。';
    input.addEventListener('input', () => { defaultSamplePending = false; sampleGeneration++; });

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
            throw new Error('MPL 需要 PMX 模型；静态角色不支持');
        }
        return { profile, mesh, playing: api().getState().motionPlaybackEnabled === true };
    }

    function morphMetadata(mesh) {
        const dictionary = mesh.morphTargetDictionary || {};
        return (mesh.geometry.userData.MMD.morphs || []).map((item, index) => ({
            name: item.name, type: item.type,
            supported: item.supported === true && index < (mesh.morphTargetInfluences?.length || 0)
                && Object.hasOwn(dictionary, item.name) && dictionary[item.name] === index,
        }));
    }

    async function fillExpressionSample(withBones = false, automatic = false) {
        if (phase || closed) return;
        if (!automatic) defaultSamplePending = false;
        const generation = ++sampleGeneration;
        try {
            const before = readCurrent(), originalText = input.value;
            const { encodeMorphName } = await import('__MPL_MORPHS_URL__');
            if (phase || closed || generation !== sampleGeneration || input.value !== originalText) return;
            const current = readCurrent();
            if (current.mesh !== before.mesh) throw new Error('模型已变化，请重新填入表情示例');
            const items = morphMetadata(current.mesh);
            const counts = new Map();
            for (const item of items) counts.set(item.name, (counts.get(item.name) || 0) + 1);
            const eligible = new Set();
            for (const item of items) {
                if (!item.supported || counts.get(item.name) !== 1) continue;
                try { encodeMorphName(item.name); eligible.add(item.name); }
                catch { /* 示例跳过无法写入VMD的名称；手动输入仍会得到明确错误。 */ }
            }
            const metadata = current.mesh.geometry.userData.MMD.morphs;
            const selected = [];
            // 从模型自身分类各取一项，不把米娅名称作为其他模型的预设。
            for (const group of [3, 2, 1, 4, 0]) {
                const item = metadata.find(item => item.panel === group && eligible.has(item.name));
                if (item && selected.length < 3) selected.push(item.name);
            }
            if (!selected.length && !withBones) throw new Error('当前 PMX 没有可生成 VMD 的表情');
            input.value = createSample(selected, withBones);
            const description = selected.length ? (withBones ? '动作＋表情' : '纯表情') : '点头（当前模型无可写入 VMD 的表情）';
            status(`已按当前 PMX 填入${description}示例；点击「编译并播放」。表情名称和强度可按「表情」分类调整。`);
        } catch (error) {
            if (!closed) status(error?.message || String(error), true);
        }
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
            // 仅首次模型就绪后自动填入；用户编辑、粘贴或选择示例后不再覆盖输入。
            if (defaultSamplePending && !input.value && api()?.getState?.().modelReady
                && currentProfile()?.modelType === 'pmx' && !editorActive()
                && !document.getElementById('mmdArPhysicsEnabled')?.disabled) {
                defaultSamplePending = false;
                void fillExpressionSample(true, true);
            }
        }
        play.disabled = Boolean(phase);
        sample.disabled = Boolean(phase);
        expressionSample.disabled = Boolean(phase);
        save.disabled = !lastResult;
        stop.disabled = phase ? phase !== 'compile' : !ownsCurrentMotion();
        stop.textContent = phase === 'compile' ? '取消编译' : '停止并恢复原动作';
        panel.setAttribute('aria-busy', String(Boolean(phase)));
    }

    function compile(source, morphs) {
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
                    if (!(data?.buffer instanceof ArrayBuffer) || !Array.isArray(data.bones) || !Array.isArray(data.morphs)) {
                        return finish(new Error('MPL 编译结果无效'));
                    }
                    finish(null, data);
                };
                worker.onerror = event => {
                    event.preventDefault();
                    finish(new Error(event.message || 'MPL Worker 加载失败；请检查编译器资源'));
                };
                worker.onmessageerror = () => finish(new Error('MPL 编译结果传输失败'));
                worker.postMessage({ source, morphs });
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
            const result = await compile(source, morphMetadata(before.mesh));
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
            const availableMorphs = new Set(morphMetadata(current.mesh).filter(item => item.supported).map(item => item.name));
            const matchedMorphs = result.morphs.filter(name => availableMorphs.has(name));
            lastResult = result;
            if (!matched.length && !matchedMorphs.length) throw new Error(`MPL 骨骼/表情与当前 PMX 不匹配：${[...result.bones, ...result.morphs].join('、')}`);
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
            const selectedMorphs = new Set((api().getManualExpressions?.()?.items || [])
                .filter(item => item.selected).map(item => item.name));
            const overridden = matchedMorphs.filter(name => selectedMorphs.has(name));
            status(`MPL 已播放：${result.duration.toFixed(2)}秒，${result.boneFrames}条骨骼帧、${result.morphFrames}条表情帧，匹配${matched.length}个骨骼、${matchedMorphs.length}个表情。`
                + (result.poseHold ? ' 纯姿势已生成1秒静态保持。' : '')
                + (missing.length ? ` 未匹配骨骼：${missing.join('、')}。` : '')
                + (overridden.length ? ` 手动选择正覆盖表情：${overridden.join('、')}；取消手动选择可查看 MPL 表情。` : ''));
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
    sample.addEventListener('click', () => { void fillExpressionSample(true); });
    expressionSample.addEventListener('click', () => { void fillExpressionSample(); });
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
