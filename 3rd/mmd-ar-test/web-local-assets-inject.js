'use strict';

// 本地选择只进入独立网页副本；源锚点变动时拒绝静默生成不完整适配。
function once(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error(`本地资源适配缺少唯一锚点：${anchor.slice(0, 100)}`);
  return source.replace(anchor, replacement);
}

function addLocalRuntime(source, moduleUrl) {
  let output = `import { configureLocalLoader, validateLocalModel } from '${moduleUrl}';\n${source}`;
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
    // 先解析动作，再替换 helper；失败或过期结果不能销毁仍在使用的网格。
    const loadSelectedMotion = async (motion) => {
        if (!currentMesh || !currentProfile) throw new Error('请先加载 PMX 模型');
        const profile = { ...currentProfile, motionUrl: motion.motionUrl,
            motionResourceId: motion.motionResourceId };
        if (profile.motionUrl) validateMotionResource(profile, profile.motionResourceId);
        const mesh = currentMesh;
        const sequence = ++motionSequence;
        const modelVersion = modelSequence;
        const clip = profile.motionUrl ? await loadAnimationClip(profile.motionUrl, mesh) : null;
        if (disposed || sequence !== motionSequence || modelVersion !== modelSequence || mesh !== currentMesh) return false;
        const prepared = await createMotionHelper(mesh, clip, profile.playMode);
        if (disposed || sequence !== motionSequence || modelVersion !== modelSequence || mesh !== currentMesh) {
            prepared.helper?.remove(mesh);
            return false;
        }
        stopMotion();
        helper.current = prepared.helper;
        pendingInitialMotionHelper = prepared.helper;
        currentMotionResourceId = profile.motionResourceId || null;
        currentProfile = profile;
        onStatus(prepared.physicsError ? '动作已加载；物理不可用，使用骨骼动画' : 'VMD 动作已加载');
        return true;
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
