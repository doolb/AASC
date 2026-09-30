'use strict';

// 本地选择只进入独立网页副本；源锚点变动时拒绝静默生成不完整适配。
function once(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error(`本地资源适配缺少唯一锚点：${anchor.slice(0, 100)}`);
  return source.replace(anchor, replacement);
}

function addLocalRuntime(source, moduleUrl, motionModuleUrl = './web-motion-switch.mjs') {
  let output = `import { prepareMotionSwitch, clearPmxPhysicsMotion } from '${motionModuleUrl}';\nimport { configureLocalLoader, validateLocalModel } from '${moduleUrl}';\n${source}`;
  output = once(output, '    let pendingInitialMotionHelper = null;',
    '    let pendingInitialMotionHelper = null;\n    let motionSwitchMesh = null;');
  output = once(output, '        const frameHelper = helper.current;',
    '        const frameHelper = motionSwitchMesh === currentMesh ? null : helper.current;');
  output = once(output, "const createMotionHelper = async (mesh, clip, playMode = 'loop') => {",
    "const createMotionHelper = async (mesh, clip, playMode = 'loop', usePhysics = physicsEnabled) => {");
  output = once(output, '            physicsEnabled,', '            physicsEnabled: usePhysics,');
  output = once(output, '        if (physics) physics.unitStep = 1 / lightingState.physicsFps;', `        if (physics) {
            try { clearPmxPhysicsMotion(physics); }
            catch (error) { prepared.helper.remove(mesh); throw error; }
            physics.unitStep = 1 / lightingState.physicsFps;
        }`);
  output = once(output, '    const load = async (profile) => {',
    '    const load = async (profile, reportProgress = onProgress) => {');
  output = once(output, '        const report = (phase, percent) => {',
    '        const report = (phase, percent, indeterminate = false) => {');
  output = once(output, '            onProgress({ phase, percent: progressPercent });',
    '            reportProgress({ phase, percent: progressPercent, indeterminate: indeterminate === true });');
  output = once(output, "        report('下载 PMX', 1);", "        report('读取 PMX', 1, true);");
  output = once(output, "        report('初始化模型与物理', 95);",
    "        report('初始化模型与物理', 95, true);");
  output = once(output, "report('下载 VMD', 85 + Math.floor(9 * event.loaded / event.total));",
    "report('读取 VMD', 85 + Math.floor(9 * event.loaded / event.total), { loaded: event.loaded, total: event.total });");

  output = once(output,
    '(loader, resolve, reject, progress) => loader.load(url, resolve, progress, reject),',
    `async (loader, resolve, reject, progress) => {
                try {
                    await validateLocalModel(loader, url, () => {
                        report('校验 PMX 与贴图', 5, true);
                    });
                    configureLocalLoader(loader, url);
                    loader.load(url, resolve, progress, reject);
                } catch (error) { reject(error); }
            },`);
  output = once(output,
    '(loader, resolve, reject, progress) => loader.loadAnimation(url, mesh, resolve, progress, reject),',
    `(loader, resolve, reject, progress) => {
            configureLocalLoader(loader, url);
            loader.loadAnimation(url, mesh, resolve, progress, reject);
        },`);
  output = once(output, '    const playMotion = async (resourceId) => loadMotion(resourceId);', `
    // 先解析动作，再冻结旧 helper；从绑定姿态创建物理，下一实际动画帧才播放。
    const loadSelectedMotion = async (motion, reportProgress = onProgress) => {
        if (!currentMesh || !currentProfile) throw new Error('请先加载 PMX 模型');
        if (motionSwitchMesh === currentMesh) throw new Error('动作正在切换，请稍后再试');
        const profile = { ...currentProfile, motionUrl: motion.motionUrl,
            motionResourceId: motion.motionResourceId };
        if (profile.motionUrl) validateMotionResource(profile, profile.motionResourceId);
        const mesh = currentMesh;
        const sequence = ++motionSequence;
        const modelVersion = modelSequence;
        const isCurrent = () => !disposed && sequence === motionSequence
            && modelVersion === modelSequence && mesh === currentMesh;
        const report = (detail) => { if (isCurrent()) reportProgress(detail); };
        report({ phase: '读取/解析 VMD', indeterminate: true });
        const clip = profile.motionUrl ? await loadAnimationClip(profile.motionUrl, mesh,
            (_phase, _percent, file) => {
                if (file?.total > 0) report({ phase: '读取/解析 VMD',
                    percent: Math.floor(70 * file.loaded / file.total) });
            }) : null;
        if (!isCurrent()) return false;
        const previousHelper = helper.current;
        motionSwitchMesh = mesh;
        try {
            const prepared = await prepareMotionSwitch({
                mesh, oldHelper: previousHelper,
                createHelper: () => createMotionHelper(mesh, clip, profile.playMode, false),
                ensurePhysics: ensureAmmoPhysics, physicsEnabled,
                physicsFps: lightingState.physicsFps, playbackEnabled: motionPlaybackEnabled,
                isCurrent, canRestore: () => !disposed && mesh === currentMesh && helper.current === previousHelper,
                onStage: (phase) => report({ phase, indeterminate: true })
            });
            if (!prepared) return false;
            if (!isCurrent()) { prepared.rollback(); return false; }
            stopMotion();
            helper.current = prepared.helper;
            // 复用刷新/换模型的渲染门控：首帧仅物理，下一帧才推进 VMD。
            pendingInitialMotionHelper = prepared.helper;
            physicsGate.paused = false;
            setPmxMotionPlaybackEnabled(prepared.helper, motionPlaybackEnabled);
            currentMotionResourceId = profile.motionResourceId || null;
            currentProfile = profile;
            report({ phase: '动作已加载', percent: 99 });
            onStatus('VMD 动作已加载');
            return true;
        } finally {
            if (motionSwitchMesh === mesh) motionSwitchMesh = null;
        }
    };
    const playMotion = async (resourceId) => loadMotion(resourceId);`);
  output = once(output, '        loadMotion,', '        loadMotion,\n        loadSelectedMotion,');
  return output;
}

function addLocalDisplay(source) {
  let output = once(source, '    async function loadModel(profile) {',
    '    async function loadModel(profile, reportProgress = state.onLoadProgress) {');
  output = once(output, "state.onLoadProgress?.({ phase: '模型已加载', percent: 100 });",
    "reportProgress?.({ phase: '模型已加载', percent: 100 });");
  output = once(output, "state.onLoadProgress?.({ phase: '加载失败', error: error.message });",
    "reportProgress?.({ phase: '加载失败', error: error.message });");
  output = once(output, '        const sequence = ++state.loadSequence;', `        const previousProfile = state.modelProfile;
        const previousReady = state.modelReady;
        const sequence = ++state.loadSequence;`);
  output = once(output,
    '            await runtime.load(modelType === \'pmx\' ? resolvedProfile : resolvedProfile.modelUrl);',
    `            const loaded = await runtime.load(modelType === 'pmx' ? resolvedProfile : resolvedProfile.modelUrl, reportProgress || undefined);
            if (loaded === false) return false;`);
  output = once(output, `            state.modelReady = false;
            state.runtime?.showFallback?.();`, `            if (sequence !== state.loadSequence) return false;
            state.modelProfile = previousProfile;
            state.modelReady = previousReady;
            if (!previousReady) state.runtime?.showFallback?.();`);
  output = once(output, '    function handleActionPlan(plan) {', `    async function loadSelectedMotion(motion, reportProgress = state.onLoadProgress) {
        if (!state.modelReady || state.runtimeType !== 'pmx') throw new Error('请先加载 PMX 模型');
        const loaded = await state.runtime.loadSelectedMotion(motion, reportProgress || undefined);
        if (loaded) state.modelProfile = { ...state.modelProfile,
            motionUrl: motion.motionUrl, motionResourceId: motion.motionResourceId };
        return loaded;
    }

    function handleActionPlan(plan) {`);
  output = once(output, '        loadModel,', `        loadModel,
        loadSelectedMotion,
        getModelProfile: () => state.modelProfile ? { ...state.modelProfile } : null,
        restoreDefaultModel: (reportProgress) => loadModel(DEFAULT_MODEL_PROFILE, reportProgress),
        restoreDefaultMotion: async (reportProgress) => {
            const profile = await resolvePmxProfile(DEFAULT_MODEL_PROFILE);
            return loadSelectedMotion(profile, reportProgress);
        },`);
  return output;
}

module.exports = { addLocalRuntime, addLocalDisplay };
