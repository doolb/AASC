'use strict';

// 本地选择只进入独立网页副本；源锚点变动时拒绝静默生成不完整适配。
function once(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error(`本地资源适配缺少唯一锚点：${anchor.slice(0, 100)}`);
  return source.replace(anchor, replacement);
}

function addLocalRuntime(source, moduleUrl, motionModuleUrl = './web-motion-switch.mjs') {
  let output = `import { prepareMotionSwitch } from '${motionModuleUrl}';\nimport { configureLocalLoader, validateLocalModel } from '${moduleUrl}';\n${source}`;
  output = once(output, '    let pendingInitialMotionHelper = null;',
    '    let pendingInitialMotionHelper = null;\n    let motionSwitchMesh = null;');
  output = once(output, '        const frameHelper = helper.current;',
    '        const frameHelper = motionSwitchMesh === currentMesh ? null : helper.current;');
  output = once(output, "const createMotionHelper = async (mesh, clip, playMode = 'loop') => {",
    "const createMotionHelper = async (mesh, clip, playMode = 'loop', usePhysics = physicsEnabled) => {");
  output = once(output, '            physicsEnabled,', '            physicsEnabled: usePhysics,');
  output = once(output,
    '(loader, resolve, reject, progress) => loader.load(url, resolve, progress, reject),',
    `async (loader, resolve, reject, progress) => {
                try {
                    await validateLocalModel(loader, url);
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
    // 先解析动作，再冻结旧 helper；应用新姿态后才建立物理，失败保留旧动作。
    const loadSelectedMotion = async (motion) => {
        if (!currentMesh || !currentProfile) throw new Error('请先加载 PMX 模型');
        if (motionSwitchMesh === currentMesh) throw new Error('动作正在切换，请稍后再试');
        const profile = { ...currentProfile, motionUrl: motion.motionUrl,
            motionResourceId: motion.motionResourceId };
        if (profile.motionUrl) validateMotionResource(profile, profile.motionResourceId);
        const mesh = currentMesh;
        const sequence = ++motionSequence;
        const modelVersion = modelSequence;
        const clip = profile.motionUrl ? await loadAnimationClip(profile.motionUrl, mesh) : null;
        if (disposed || sequence !== motionSequence || modelVersion !== modelSequence || mesh !== currentMesh) return false;
        const isCurrent = () => !disposed && sequence === motionSequence
            && modelVersion === modelSequence && mesh === currentMesh;
        const previousHelper = helper.current;
        motionSwitchMesh = mesh;
        try {
            const prepared = await prepareMotionSwitch({
                mesh, oldHelper: previousHelper,
                createHelper: () => createMotionHelper(mesh, clip, profile.playMode, false),
                ensurePhysics: ensureAmmoPhysics, physicsEnabled,
                physicsFps: lightingState.physicsFps, playbackEnabled: motionPlaybackEnabled,
                isCurrent, canRestore: () => !disposed && mesh === currentMesh && helper.current === previousHelper
            });
            if (!prepared) return false;
            if (!isCurrent()) { prepared.rollback(); return false; }
            stopMotion();
            helper.current = prepared.helper;
            // 起始姿态已在无物理状态完成；手动换动作无需首载的延迟动画帧。
            pendingInitialMotionHelper = null;
            physicsGate.paused = false;
            setPmxMotionPlaybackEnabled(prepared.helper, motionPlaybackEnabled);
            currentMotionResourceId = profile.motionResourceId || null;
            currentProfile = profile;
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
  let output = once(source, '        const sequence = ++state.loadSequence;', `        const previousProfile = state.modelProfile;
        const previousReady = state.modelReady;
        const sequence = ++state.loadSequence;`);
  output = once(output,
    '            await runtime.load(modelType === \'pmx\' ? resolvedProfile : resolvedProfile.modelUrl);',
    `            const loaded = await runtime.load(modelType === 'pmx' ? resolvedProfile : resolvedProfile.modelUrl);
            if (loaded === false) return false;`);
  output = once(output, `            state.modelReady = false;
            state.runtime?.showFallback?.();`, `            if (sequence !== state.loadSequence) return false;
            state.modelProfile = previousProfile;
            state.modelReady = previousReady;
            if (!previousReady) state.runtime?.showFallback?.();`);
  output = once(output, '    function handleActionPlan(plan) {', `    async function loadSelectedMotion(motion) {
        if (!state.modelReady || state.runtimeType !== 'pmx') throw new Error('请先加载 PMX 模型');
        const loaded = await state.runtime.loadSelectedMotion(motion);
        if (loaded) state.modelProfile = { ...state.modelProfile,
            motionUrl: motion.motionUrl, motionResourceId: motion.motionResourceId };
        return loaded;
    }

    function handleActionPlan(plan) {`);
  output = once(output, '        loadModel,', `        loadModel,
        loadSelectedMotion,
        getModelProfile: () => state.modelProfile ? { ...state.modelProfile } : null,
        restoreDefaultModel: () => loadModel(DEFAULT_MODEL_PROFILE),
        restoreDefaultMotion: async () => {
            const profile = await resolvePmxProfile(DEFAULT_MODEL_PROFILE);
            return loadSelectedMotion(profile);
        },`);
  return output;
}

module.exports = { addLocalRuntime, addLocalDisplay };
