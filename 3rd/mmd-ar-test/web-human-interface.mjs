import { GESTURES } from './web-reply-gestures.mjs';
import { createHumanModel } from './web-human-model.mjs';
import { createHumanMixer } from './web-human-mixer.mjs';
import { createHumanPhysiology } from './web-human-physiology.mjs';
import { createHumanGaze, normalizeHumanGaze, DEFAULT_GAZE, attachHumanGazePointer } from './web-human-gaze.mjs';
import { createHumanReflex, DEFAULT_REFLEXES, normalizeHumanReflex } from './web-human-reflex.mjs';
import { compileHumanMpl } from './web-human-compiler.mjs';
import { createHumanSampler, readHumanVmd, inspectHumanVmd } from './web-human-vmd.mjs';
import { emptyHumanLibrary, loadHumanLibrary, saveHumanLibrary, validateHumanLibrary,
    exportHumanLibrary, importHumanLibrary } from './web-human-storage.mjs';
import { createHighLevelMpl } from './web-reply-actions.mjs';
import { serverActions } from './web-human-server-actions.mjs';
import { createHumanArmAvoidance, readArmAvoidancePreference, ARM_AVOIDANCE_KEY } from './web-human-arm-avoidance.mjs';
import { createHumanIK } from './web-human-ik.mjs';
import { readActualPose } from './web-human-pose-projection.mjs';

const number = (value, fallback, min, max, label) => {
    const result = value ?? fallback;
    if (!Number.isFinite(result) || result < min || result > max) throw new Error(label + '超出范围');
    return result;
};
const name = value => {
    if (typeof value !== 'string' || !value.trim() || value.length > 80
        || Object.hasOwn(Object.prototype, value) || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error('名称需要1–80字符且不能是保留名');
    return value.trim();
};
const id = () => crypto.randomUUID();
function patchOptions(value = {}) {
    const mode = value.mode || 'override';
    if (!['override', 'additive'].includes(mode)) throw new Error('混合方式无效');
    const mask = value.mask ?? [];
    if (!Array.isArray(mask) || mask.length > 64 || mask.some(p => typeof p !== 'string' || p.length > 120)) throw new Error('部位遮罩无效');
    return { mode, mask, start: number(value.start, 0, 0, 3600, '起始时间'),
        duration: value.duration == null ? null : number(value.duration, null, 1 / 30, 3600, '持续时间'),
        strength: number(value.strength, 1, 0, 1, '强度'),
        ...(value.gazeStrength == null ? {} : { gazeStrength: number(value.gazeStrength, 1, 0, 1, '跟随混合强度') }) };
}
function validateDefinitions(record) {
    validateHumanLibrary(record);
    const actions = new Set();
    for (const asset of record.assets) inspectHumanVmd(asset.buffer);
    for (const action of record.actions) {
        name(action.actionId);
        if (actions.has(action.actionId)) throw new Error('行为名称重复');
        actions.add(action.actionId);
        const versions = new Set();
        for (const version of action.versions) {
            name(version.id);
            if (versions.has(version.id) || (!version.assetId && !version.source)
                || !Array.isArray(version.patches) || version.patches.length > 8) throw new Error('行为版本定义无效');
            versions.add(version.id); patchOptions(version);
            for (const patch of version.patches) { patchOptions(patch); validateSource(patch.source); }
            if (version.source) validateSource(version.source);
            if (version.expression) name(version.expression);
        }
    }
    for (const [key, weights] of Object.entries(record.presets)) {
        name(key);
        if (!weights || Array.isArray(weights) || typeof weights !== 'object' || Object.keys(weights).length > 64) throw new Error('组合表情格式无效');
        for (const [key, value] of Object.entries(weights)) { name(key); number(value, null, 0, 1, '表情权重'); }
    }
    record.rules.forEach(normalizeHumanReflex);
    for (const choices of Object.values(record.mappings)) {
        if (!choices || typeof choices !== 'object' || Array.isArray(choices)) throw new Error('模型映射无效');
        Object.entries(choices).forEach(([key, value]) => { name(key); if (value) name(value); });
    }
    createHumanPhysiology().set(record.physiology);
    normalizeHumanGaze(record.gaze ?? {});
    return record;
}
function validateSource(source) {
    if (typeof source !== 'string' || !source.trim() || new TextEncoder().encode(source).length > 65536) throw new Error('MPL需要1–64KiB代码');
    return source;
}

// 一个实例属于一个显示runtime。名称映射、异步令牌和动作所有权都绑定当前PMX。
export function createHumanInterfaceElement({ getMesh, getHelper, getProfile, getCamera, getScene, getImageCameraControl, canvas, manualExpressions, startRendering }) {
    const mixer = createHumanMixer(), physiology = createHumanPhysiology(), external = new Map();
    const gaze = createHumanGaze();
    const armAvoidance = createHumanArmAvoidance();
    let armAvoidanceEnabled = readArmAvoidancePreference();
    let frameDelta = 0;
    const pending = new Map(), cache = new Map();
    let model = null, library = emptyHumanLibrary(), generation = 0, revision = 0, ready = false;
    let warning = '', disposed = false, helperBound = null, motionKey = '', suspended = false, rendererVisible = true, saveQueue = Promise.resolve();
    const wake = () => startRendering?.();
    const requireModel = () => {
        bind();
        if (!model || !ready) throw new Error('请等待PMX及动作库加载');
        if (suspended || blocked()) throw new Error('请返回前台预览后操作Human控制');
        return model;
    };
    const blocked = () => !rendererVisible || document.hidden || Boolean(
        document.querySelector('#mmdEditor [data-mode="edit"][aria-pressed="true"]')
        || document.querySelector('#edBlenderSession:not([hidden])')
        || document.getElementById('mmdEditor')?.getAttribute('aria-busy') === 'true');
    // 先注册IK控制点指针，再注册轻触注视；命中控制点时阻断后续注视事件。
    const interactiveIK = createHumanIK({ getScene, getCamera, canvas, onChange: wake });
    const releasePointer = attachHumanGazePointer(canvas, (x, y) => {
        if (!model || !ready || suspended || blocked() || disposed) return;
        if (gaze.point(model, getCamera?.(), x, y)) wake();
    });
    const reflex = createHumanReflex({ clock: () => mixer.clock, rules: () => library.rules, perform });
    function clearInteractiveIK() {
        // 避让基线是在IK之后保存的，必须先撤销避让，再撤销IK，避免上帧增量回写。
        armAvoidance.restore(); interactiveIK.reset();
    }
    function stop(owner) {
        for (const [key, controller] of pending) if (!owner || owner === key) { controller.abort(); pending.delete(key); }
        mixer.stop(owner);
        for (const key of external.keys()) if (!owner || owner === key) external.delete(key);
        if (!owner && model) manualExpressions.setHuman(model.token, []);
        wake();
    }
    function detach() {
        if (helperBound?.onHumanPose === mixPose) delete helperBound.onHumanPose;
        if (helperBound?.onHumanAfterIK === avoidArms) delete helperBound.onHumanAfterIK;
        if (helperBound?.onHumanAfterPhysics === observeArms) delete helperBound.onHumanAfterPhysics;
        armAvoidance.reset(); interactiveIK.reset();
        helperBound = null;
    }
    function bind() {
        if (disposed) return;
        const mesh = getMesh();
        if (mesh === model?.mesh || (!mesh && !model)) return;
        stop(); mixer.clear(); cache.clear(); physiology.reset(); reflex.reset(); detach();
        gaze.set(DEFAULT_GAZE);
        physiology.set({ breathing: true, blinking: true, strength: 0.35 });
        generation++; ready = false; warning = ''; external.clear();
        model = mesh?.skeleton && mesh.geometry?.userData?.MMD ? createHumanModel(mesh, manualExpressions.getState()) : null;
        library = emptyHumanLibrary(); revision++;
        if (!model) return;
        const token = generation, signature = model.signature;
        void loadHumanLibrary(signature).then(record => {
            if (token !== generation || disposed) return;
            library = validateDefinitions(record); configure();
        }).catch(error => {
            if (token !== generation || disposed) return;
            warning = '动作库仅保存在本次页面：' + error.message;
            configure();
        });
        function configure() {
            // 空库提供可删除的示例规则，已有库的空规则列表代表用户选择不启用。
            if (!library.initialized) { library.rules = structuredClone(DEFAULT_REFLEXES); library.initialized = true; }
            model = createHumanModel(mesh, manualExpressions.getState(), library.mappings);
            physiology.set(library.physiology); gaze.set({ ...DEFAULT_GAZE, ...library.gaze }); ready = true; revision++; wake();
        }
    }
    function persist(next) {
        validateDefinitions(next);
        library = next; revision++; wake();
        const signature = model.signature, copy = structuredClone(next), token = generation;
        saveQueue = saveQueue.catch(() => {}).then(() => saveHumanLibrary(signature, copy)).catch(error => {
            if (token === generation) { warning = '保存失败，当前页面仍可使用；请导出备份：' + error.message; revision++; }
            throw error;
        });
        // 返回具体保存错误，同时让下一次保存有机会重试。
        return saveQueue;
    }
    async function operation(owner, work) {
        const bound = requireModel(), token = generation, baseMotion = getProfile()?.motionUrl,
            baseHelper = getHelper();
        pending.get(owner)?.abort(); pending.delete(owner);
        if (pending.size >= 2) throw new Error('最多同时准备两组动作，请稍候');
        const controller = new AbortController(); pending.set(owner, controller);
        const check = () => {
            if (controller.signal.aborted || token !== generation || disposed || suspended || blocked()
                || baseMotion !== getProfile()?.motionUrl || baseHelper !== getHelper()) throw new Error('模型或动作已切换，请求已取消');
        };
        try { const result = await work(bound, controller.signal, check); check(); return result; }
        finally { if (pending.get(owner) === controller) pending.delete(owner); }
    }
    async function mplSampler(source, bound, signal, check) {
        validateSource(source);
        const key = 'mpl:' + source, cached = cache.get(key);
        if (cached) return cached;
        const compiled = await compileHumanMpl(source, bound.morphs, signal);
        check();
        const result = { sampler: createHumanSampler(compiled.buffer, bound, compiled.source), buffer: compiled.buffer };
        cache.set(key, result);
        if (cache.size > 8) cache.delete(cache.keys().next().value);
        return result;
    }
    function vmdSampler(asset, bound) {
        const key = 'vmd:' + asset.id, cached = cache.get(key);
        if (cached) return cached.sampler;
        const sampler = createHumanSampler(asset.buffer, bound);
        cache.set(key, { sampler });
        if (cache.size > 8) cache.delete(cache.keys().next().value);
        return sampler;
    }
    function layer(sampler, options) {
        const value = patchOptions(options);
        const duration = value.duration ?? sampler.duration;
        if (!sampler.tracks.some(track => model.allowed(track, value.mask))) throw new Error('所选部位没有可控制轨道（动态刚体骨骼由物理控制）');
        return { ...value, duration, sampler, speed: sampler.duration / duration };
    }
    function resolveExpression(expression) {
        bind();
        if (!model) return { weights: [], names: [], missing: true, reason: '请先加载PMX' };
        if (expression === '平静') return { weights: [], names: [], missing: false };
        const definition = library.presets[expression] || { [expression]: 1 }, weights = new Map();
        for (const [semantic, strength] of Object.entries(definition)) {
            const match = model.expression(semantic);
            for (const pair of match.weights || []) weights.set(pair[0], Math.max(weights.get(pair[0]) || 0, pair[1] * strength));
        }
        return { weights: [...weights], names: [...weights.keys()].map(index => model.morphs.find(m => m.index === index)?.name),
            missing: !weights.size, reason: !weights.size ? '当前PMX没有匹配表情：' + expression : '' };
    }
    function expressionSampler(expression, duration) {
        const resolved = resolveExpression(expression);
        if (resolved.missing) throw new Error(resolved.reason);
        return { duration, tracks: resolved.weights.map(([index, value]) => ({ kind: 'morph', index, evaluate: () => [value] })) };
    }
    async function perform(intent = {}) {
        const owner = name(intent.owner || 'ai');
        return operation(owner, async (bound, signal, check) => {
            const layers = [], warnings = [];
            let buffer, baseDuration = number(intent.duration, 2, 1 / 30, 3600, '动作时长');
            const action = intent.action && library.actions.find(a => a.actionId === intent.action);
            const version = action?.versions.find(v => v.id === (intent.version || action.active));
            // 本地登记优先；目录失败不阻止内置模板。异步目录结果仍受当前operation令牌约束。
            const entries = intent.action && !version ? await serverActions.load() : [];
            check();
            const remote = entries.find(entry => entry.name === intent.action);
            if (action && !version) throw new Error('动作版本不存在');
            if (version) {
                let sampler;
                if (version.assetId) sampler = vmdSampler(library.assets.find(a => a.id === version.assetId), bound);
                else { const result = await mplSampler(version.source, bound, signal, check); sampler = result.sampler; buffer = result.buffer; }
                check();
                const base = layer(sampler, { ...version, duration: intent.duration ?? version.duration,
                    strength: intent.strength ?? version.strength, mask: intent.mask ?? version.mask });
                layers.push(base); baseDuration = base.start + base.duration;
                for (const patch of version.patches) {
                    const result = await mplSampler(patch.source, bound, signal, check); check();
                    layers.push(layer(result.sampler, patch));
                }
                warnings.push(...sampler.warnings);
            }
            if (remote && !version) {
                const key = 'server:' + remote.id + ':' + remote.url;
                let sampler = cache.get(key)?.sampler;
                if (!sampler) {
                    const bytes = await readHumanVmd(remote.url, signal); check();
                    sampler = createHumanSampler(bytes, bound);
                    cache.set(key, { sampler });
                    if (cache.size > 8) cache.delete(cache.keys().next().value);
                }
                const base = layer(sampler, { ...remote, ...intent, duration: intent.duration ?? remote.duration,
                    strength: intent.strength ?? remote.strength, mask: intent.mask ?? remote.mask });
                layers.push(base); baseDuration = base.duration; warnings.push(...sampler.warnings);
            }
            if (intent.action && !version && !remote) {
                const source = createHighLevelMpl({ name: intent.action, duration: Math.min(15, baseDuration), strength: intent.strength ?? 0.7, count: intent.count ?? 1 }, bound.morphs);
                const gesture = GESTURES.get(intent.action);
                if (gesture?.expression && gesture.expression !== '平静' && bound.expression(gesture.expression).missing) {
                    warnings.push('当前PMX缺少' + gesture.expression + '表情，仅播放骨骼动作');
                }
                const result = await mplSampler(source, bound, signal, check); check(); buffer = result.buffer;
                layers.push(layer(result.sampler, { ...intent, strength: (intent.strength ?? 0.7) > 0 ? 1 : 0,
                    gazeStrength: intent.strength ?? 0.7, duration: baseDuration }));
                warnings.push(...result.sampler.warnings);
            }
            const cycleDuration = Math.max(baseDuration, ...layers.map(l => l.start + l.duration));
            const count = number(intent.count, remote?.count ?? 1, 1, 8, '重复次数');
            if (!Number.isInteger(count)) throw new Error('重复次数需为整数');
            if ((version || remote) && count > 1) {
                const originals = [...layers];
                for (let i = 1; i < count; i++) for (const item of originals) layers.push({ ...item, start: item.start + cycleDuration * i });
            }
            const duration = cycleDuration * (version || remote ? count : 1);
            const expression = intent.expression || version?.expression;
            if (expression) layers.push(layer(expressionSampler(expression, duration),
                { strength: intent.strength ?? 1, mask: ['face'], duration }));
            if (!layers.length) throw new Error('需要动作或表情');
            check();
            const result = mixer.start({ owner, layers, duration, loop: intent.loop ?? version?.loop ?? false,
                priority: number(intent.priority, 50, 0, 100, '优先级') });
            wake(); return { ...result, buffer, warnings };
        });
    }
    async function playMpl(source, options = {}) {
        const owner = name(options.owner || 'manual:mpl');
        return operation(owner, async (bound, signal, check) => {
            const result = await mplSampler(source, bound, signal, check); check();
            const patch = layer(result.sampler, options);
            const request = mixer.start({ owner, layers: [patch], duration: patch.start + patch.duration,
                loop: !!options.loop, priority: number(options.priority, 100, 0, 100, '优先级') });
            wake(); return { ...request, buffer: result.buffer, warnings: result.sampler.warnings };
        });
    }
    function mixPose(mesh) {
        if (mesh !== model?.mesh || !ready || suspended || disposed) return;
        const state = manualExpressions.getState();
        const eyes = mixer.occupiedEyes(model) || [...external.values()].some(weights =>
            [...weights.keys()].some(index => model.morphs.find(m => m.index === index)?.panel === 2));
        const weights = mixer.mix(model, physiology.sample(model, mixer.clock, eyes, state.items),
            [...external.values()].map(weights => ({ id: 0, priority: 50, weights })),
            (save, occupied, rotations) => gaze.apply(model, getCamera?.(), frameDelta, save, occupied, rotations));
        manualExpressions.setHuman(model.token, [...weights]);
    }
    function avoidArms(mesh, delta, physics) {
        if (mesh !== model?.mesh || !ready || suspended || disposed) return;
        interactiveIK.apply(model, delta);
        // 人体代理在物理世界处理自身碰撞；原几何手臂避让不能再覆写同一批身体骨骼。
        if (interactiveIK.isPhysicsEnabled()) return;
        armAvoidance.apply(model, physics, delta, armAvoidanceEnabled, { paused: helperBound?.enabled.physics === false });
    }
    function observeArms(mesh, physics) {
        if (mesh === model?.mesh && ready && !suspended && armAvoidanceEnabled && !interactiveIK.isPhysicsEnabled()) armAvoidance.observe(physics, helperBound?.enabled.physics === false);
    }
    function before(delta, helper) {
        bind();
        const key = getProfile()?.motionUrl || '';
        if (motionKey && key !== motionKey) stop();
        motionKey = key;
        const paused = blocked();
        if (paused && !suspended) { stop(); gaze.reset(); clearInteractiveIK(); }
        suspended = paused;
        frameDelta = Math.max(0, Math.min(0.1, delta));
        armAvoidance.restore(); interactiveIK.restore(); mixer.restore();
        if (!paused) mixer.advance(delta);
        if (helper !== helperBound) {
            detach();
            if (helper && model) {
                helper.onHumanPose = mixPose; helper.onHumanAfterIK = avoidArms;
                helper.onHumanAfterPhysics = observeArms; helperBound = helper;
            }
        }
    }
    function lifecycle() { if (document.hidden) { suspended = true; stop(); gaze.reset(); clearInteractiveIK(); } else { suspended = !rendererVisible; wake(); } }
    const pagehide = () => { stop(); gaze.reset(); clearInteractiveIK(); };
    document.addEventListener('visibilitychange', lifecycle);
    window.addEventListener('pagehide', pagehide);
    const learn = {
        list: () => structuredClone(library.actions),
        async register(value) {
            requireModel();
            const actionId = name(value.actionId);
            return operation('learn', async (bound, signal, check) => {
                const initialRevision = revision;
                const next = structuredClone(library), old = next.actions.find(a => a.actionId === actionId);
                if (old?.versions.length >= 16) throw new Error('每个行为最多16版本');
                const version = { id: id(), parent: old?.active || null, ...patchOptions(value), patches: [],
                    loop: !!value.loop, expression: value.expression || '', createdAt: new Date().toISOString() };
                if (value.source) version.source = validateSource(value.source);
                else {
                    const buffer = await readHumanVmd(value.vmd || getProfile()?.motionUrl, signal); check();
                    const sampler = createHumanSampler(buffer, bound);
                    if (!sampler.tracks.some(track => bound.allowed(track, version.mask))) throw new Error('当前VMD没有可控制轨道');
                    version.assetId = id(); next.assets.push({ id: version.assetId, buffer });
                }
                if (version.source) await mplSampler(version.source, bound, signal, check);
                check();
                if (old) { old.versions.push(version); old.active = version.id; }
                else next.actions.push({ actionId, active: version.id, versions: [version] });
                if (initialRevision !== revision) throw new Error('准备期间动作库已改变，请重新登记');
                await persist(next); check(); return version;
            });
        },
        async revise(actionId, patch) {
            requireModel();
            return operation('learn', async (bound, signal, check) => {
                const initialRevision = revision;
                const next = structuredClone(library), action = next.actions.find(a => a.actionId === actionId);
                if (!action || action.versions.length >= 16) throw new Error('行为不存在或已达到16版本');
                const base = action.versions.find(v => v.id === action.active);
                if (base.patches.length >= 8) throw new Error('每个版本最多8层修正');
                const result = await mplSampler(patch.source, bound, signal, check); check();
                layer(result.sampler, patch);
                const version = { ...base, id: id(), parent: base.id, patches: [...base.patches,
                    { ...patchOptions(patch), source: patch.source }], createdAt: new Date().toISOString() };
                action.versions.push(version); action.active = version.id;
                if (initialRevision !== revision) throw new Error('编译期间动作库已改变，请重新修正');
                await persist(next); check(); return version;
            });
        },
        selectVersion(actionId, versionId) {
            requireModel(); const next = structuredClone(library), action = next.actions.find(a => a.actionId === actionId);
            if (!action?.versions.some(v => v.id === versionId)) throw new Error('行为版本不存在');
            action.active = versionId; return persist(next);
        },
        expression(presetName, weights) {
            requireModel(); const next = structuredClone(library); next.presets[name(presetName)] = weights; return persist(next);
        },
        reflex(rule) {
            requireModel(); const next = structuredClone(library), normalized = normalizeHumanReflex(rule);
            next.rules = next.rules.filter(r => r.id !== normalized.id); next.rules.push(normalized); return persist(next);
        },
        removeReflex(ruleId) {
            requireModel(); const next = structuredClone(library); next.rules = next.rules.filter(r => r.id !== ruleId); return persist(next);
        },
        mappings(value) {
            const bound = requireModel(), next = structuredClone(library); next.mappings = structuredClone(value);
            validateDefinitions(next); stop(); mixer.restore(); cache.clear();
            model = createHumanModel(bound.mesh, manualExpressions.getState(), next.mappings);
            gaze.reset();
            return persist(next);
        },
        export() { requireModel(); return exportHumanLibrary(library); },
        async import(file) {
            return operation('learn', async (bound, signal, check) => {
                const initialRevision = revision;
                const next = validateDefinitions(await importHumanLibrary(file)); check();
                if (initialRevision !== revision) throw new Error('读取期间动作库已改变，请重新导入');
                for (const [owner, controller] of pending) if (owner !== 'learn') { controller.abort(); pending.delete(owner); }
                mixer.clear(); cache.clear(); external.clear(); physiology.reset(); reflex.reset();
                model = createHumanModel(bound.mesh, manualExpressions.getState(), next.mappings);
                gaze.set({ ...DEFAULT_GAZE, ...next.gaze });
                physiology.set({ breathing: true, blinking: true, strength: 0.35, ...next.physiology }); await persist(next); check();
            });
        }
    };
    return Object.freeze({
        capabilities() { bind(); return model?.snapshot() || { missing: ['尚未加载PMX'], bones: [], morphs: [], bindings: {} }; },
        getState() { bind(); return { ready, token: model?.token, signature: model?.signature, revision, warning,
            physiology: physiology.get(), gaze: gaze.get(), gazeStatus: gaze.status(model), interactiveIK: interactiveIK.getState(),
            layers: mixer.snapshot(), pending: pending.size,
            actions: learn.list(), presets: structuredClone(library.presets), rules: structuredClone(library.rules),
            mappings: structuredClone(library.mappings) }; },
        physiology: {
            get: physiology.get,
            set(value) {
                requireModel(); const next = structuredClone(library);
                next.physiology = physiology.set(value); return persist(next);
            }
        },
        gaze: {
            get: gaze.get,
            set(value) {
                requireModel(); const next = structuredClone(library);
                next.gaze = gaze.set(value); return persist(next);
            },
            point(x, y) { requireModel(); const changed = gaze.point(model, getCamera?.(), x, y); if (changed) wake(); return changed; },
            reset() { gaze.returnToCamera(); wake(); }
        },
        reflex, learn, serverActions, perform, mpl: { play: playMpl,
            // 使用与实际播放相同的模型能力，编辑器不根据缺少英文别名的能力摘要再次猜表情。
            advancedSource: options => createHighLevelMpl(options, requireModel().morphs)
        }, stop, getRequest: mixer.state,
        setArmAvoidanceEnabled(value) {
            armAvoidanceEnabled = value === true;
            try { localStorage.setItem(ARM_AVOIDANCE_KEY, String(armAvoidanceEnabled)); }
            catch (error) { /* 存储受限仍在当前页面生效。 */ }
            wake(); return armAvoidanceEnabled;
        },
        getArmAvoidanceState: () => ({ enabled: armAvoidanceEnabled, ...armAvoidance.getState(),
            ...(interactiveIK.isPhysicsEnabled() ? { reason: '身体物理模式使用人体代理碰撞；此开关在PBD模式生效' } : {}) }),
        setInteractiveIKEnabled(value) {
            const bound = requireModel();
            armAvoidance.restore();
            const result = interactiveIK.setEnabled(value, bound);
            wake(); return result;
        },
        resetInteractiveIK() { requireModel(); armAvoidance.restore(); interactiveIK.resetTargets(); wake(); return interactiveIK.getState(); },
        getInteractiveIKState: () => interactiveIK.getState(),
        getImagePoseSnapshot() {
            const bound = requireModel();
            // GPU直连模式沿用既有同步入口，避免把上一帧CPU骨架误画成当前实际姿态。
            getHelper?.()?.objects?.get(bound.mesh)?.physics?.syncGpuPose?.();
            return readActualPose(bound, getCamera?.(), window.DisplayStage?.getRotationGeometry?.());
        },
        getImageCameraState() { const bound = requireModel(); return getImageCameraControl?.()?.read(bound.token)
            || { available: false, reason: '当前运行时不支持图片相机匹配', canRestore: false }; },
        applyImageCamera(view, revision, expectedToken) {
            const bound = requireModel(); if (bound.token !== expectedToken) throw new Error('模型已经切换，请重新匹配');
            if (!getImageCameraControl?.()) throw new Error('当前运行时不支持图片相机匹配');
            return getImageCameraControl().apply(view, revision, bound.token);
        },
        restoreImageCamera() {
            const bound = requireModel(); if (!getImageCameraControl?.()) throw new Error('当前运行时不支持图片相机恢复');
            return getImageCameraControl().restore(bound.token);
        },
        setInteractiveMarkerDiameter(value) { const result = interactiveIK.setMarkerDiameter(value); wake(); return result; },
        async setInteractiveIKMode(value) {
            const bound = requireModel(); armAvoidance.restore();
            const result = await interactiveIK.setMode(value, bound); wake(); return result;
        },
        setInteractiveBodySettings(value) { requireModel(); return interactiveIK.setBodySettings(value); },
        setInteractiveTargetState(key, position, rotation) { requireModel(); return interactiveIK.setTargetState(key, position, rotation); },
        setInteractiveTarget(key, position, rotation) { requireModel(); return interactiveIK.setTarget(key, position, rotation); },
        applyInteractiveImagePose(pose, expectedToken, options = {}) {
            const bound = requireModel();
            if (expectedToken !== bound.token) throw new Error('模型已经切换，请重新识别或选择图片');
            const isCurrent = () => {
                try { return requireModel().token === expectedToken && options.isCurrent?.() !== false; }
                catch (error) { return false; }
            };
            const result = interactiveIK.applyImagePose(pose, { ...options, isCurrent });
            if (typeof result?.then === 'function') return (async () => {
                const completed = await result; wake(); return completed;
            })();
            wake(); return result;
        },
        face: { set: (...args) => manualExpressions.set(...args), clear: (...args) => manualExpressions.clear(...args), resolve: resolveExpression },
        mouth: {
            setWeights: (token, weights) => manualExpressions.setTransient(token, weights),
            play(text) {
                if (!window.MmdArLipSyncPreview) throw new Error('口型模块尚未加载');
                return window.MmdArLipSyncPreview.play(text);
            },
            stop(sequence) { window.MmdArLipSyncPreview?.stop(sequence); },
            getState: () => window.MmdArLipSyncPreview?.getState() || { phase: '', sequence: 0 }
        },
        setExpressionWeights(owner, token, entries) {
            bind();
            if (!model || token !== model.token) return false;
            const allowed = new Set(model.morphs.map(m => m.index)), weights = new Map();
            for (const [index, value] of entries || []) {
                if (!allowed.has(index) || !Number.isFinite(value)) return false;
                weights.set(index, Math.max(0, Math.min(1, value)));
            }
            if (weights.size) external.set(owner, weights); else external.delete(owner);
            wake(); return true;
        },
        before,
        setVisible(value) { rendererVisible = value === true; suspended = !rendererVisible || document.hidden; if (suspended) { stop(); gaze.reset(); clearInteractiveIK(); } },
        dispose() {
            disposed = true; generation++; stop(); mixer.clear(); detach(); cache.clear();
            gaze.reset(); armAvoidance.dispose(); interactiveIK.dispose(); releasePointer();
            document.removeEventListener('visibilitychange', lifecycle); window.removeEventListener('pagehide', pagehide);
        }
    });
}
