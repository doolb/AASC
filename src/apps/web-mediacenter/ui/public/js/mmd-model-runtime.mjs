/* PMX 运行时模块：状态由主实例访问器持有，资源不复制。 */
export function createPmxModelResources(context) {
    const { MMDAnimationHelper, THREE, applyShadowFlags, clearFallback, clearPmxPhysicsMotion, configureLocalLoader, createModelRotationPivot, createPmxMotionHelper, disposeCurrentModel, disposeObject, ensureAmmoPhysics, fitCameraToModel, fitShadowCamera, getWebPhysicsStepOptions, helper, isSameOriginMmdAsset, lightingState, normalizeModel, onProgress, onStatus, physicsGate, prepareMotionSwitch, preparePmxLightingMaterial, resetModelRotation, scene, setPmxFillShadowMode, setPmxMotionPlaybackEnabled, setPmxRimLights, stagePmxMesh, startRendering, stopMotion, syncPhysicsWind, validateLocalModel, waitForManagedLoad } = context;
/* aasc-module-body-begin */
    const loadModelMesh = (url, report) => {
        let modelDownloadComplete = false;
        return waitForManagedLoad(
            async (loader, resolve, reject, progress) => {
                try {
                    await validateLocalModel(loader, url, () => {
                        report('校验 PMX 与贴图', 5, true);
                    });
                    configureLocalLoader(loader, url);
                    loader.load(url, resolve, progress, reject);
                } catch (error) { reject(error); }
            },
            'PMX 模型',
            (event) => {
                // Three.js FileLoader 产生的 ProgressEvent 没有 target URL；首个完整下载事件后忽略纹理事件。
                if (modelDownloadComplete || !event?.lengthComputable || event.total <= 0) return;
                report('下载 PMX', 1 + Math.floor(69 * event.loaded / event.total));
                if (event.loaded >= event.total) modelDownloadComplete = true;
            },
            (resourceUrl, loaded, total) => {
                if (!/\.(?:png|jpe?g|bmp|tga)$/iu.test(resourceUrl) || total <= 0) return;
                report('加载纹理', 70 + Math.floor(14 * loaded / total));
            }
        );
    };

    const loadAnimationClip = (url, mesh, report = () => {}) => waitForManagedLoad(
        (loader, resolve, reject, progress) => {
            configureLocalLoader(loader, url);
            loader.loadAnimation(url, mesh, resolve, progress, reject);
        },
        'VMD 动作',
        (event) => {
            if (!event?.lengthComputable || event.total <= 0) return;
            report('读取 VMD', 85 + Math.floor(9 * event.loaded / event.total), { loaded: event.loaded, total: event.total });
        }
    );

    const createMotionHelper = async (mesh, clip, playMode = 'loop', usePhysics = context.physicsEnabled) => {
        const prepared = await createPmxMotionHelper({
            mesh,
            clip,
            playMode,
            MMDAnimationHelper,
            loopRepeat: THREE.LoopRepeat,
            loopOnce: THREE.LoopOnce,
            physicsEnabled: usePhysics,
            physicsSolver: context.physicsSolver,
            physicsFps: lightingState.physicsFps,
            // 仅刚体 PMX 才会在这里惰性初始化 Ammo；失败时 helper 自动回退为无物理解算。
            ensurePhysics: ensureAmmoPhysics
        });
        setPmxMotionPlaybackEnabled(prepared.helper, context.motionPlaybackEnabled);
        const physics = prepared.helper?.objects?.get(mesh)?.physics;
        syncPhysicsWind(physics);
        if (physics) {
            try { clearPmxPhysicsMotion(physics); }
            catch (error) { prepared.helper.remove(mesh); throw error; }
            Object.assign(physics, getWebPhysicsStepOptions(lightingState.physicsFps, context.physicsStabilityReferenceHz));
        }
        return prepared;
    };

    const validateMotionResource = (profile, resourceId) => {
        if (!profile || resourceId !== profile.motionResourceId) {
            throw new Error('动作资源不在当前 PMX profile 白名单中');
        }
        if (!isSameOriginMmdAsset(profile.motionUrl, '.vmd')) {
            throw new Error('VMD 地址必须是同源 MMD 资源');
        }
    };

    const preparePmxHelper = async (
        mesh,
        profile,
        resourceId = profile.motionResourceId,
        report = () => {}
    ) => {
        let clip = null;
        if (resourceId && profile.motionUrl) {
            validateMotionResource(profile, resourceId);
            report('下载 VMD', 85);
            clip = await loadAnimationClip(profile.motionUrl, mesh, report);
        }
        report('初始化模型与物理', 95, true);
        return createMotionHelper(mesh, clip, profile.playMode);
    };

    const disposeStagedResources = (mesh, stagedHelper, stagedPivot = null) => {
        if (stagedPivot) scene.remove(stagedPivot);
        if (stagedHelper && mesh) {
            try {
                stagedHelper.remove(mesh);
            } catch (error) {
                console.warn('[显示端 PMX] 释放待提交动作失败:', error);
            }
        }
        if (mesh) disposeObject(mesh);
    };

    const loadMotionInternal = async (resourceId) => {
        validateMotionResource(context.currentProfile, resourceId);
        if (!context.currentMesh) throw new Error('当前 PMX 模型尚未加载');
        const sequence = ++context.motionSequence;
        const mesh = context.currentMesh;
        const profile = context.currentProfile;
        const preparedHelper = await preparePmxHelper(mesh, profile, resourceId);
        const nextHelper = preparedHelper.helper;
        if (context.disposed || sequence !== context.motionSequence || mesh !== context.currentMesh || profile !== context.currentProfile) {
            disposeStagedResources(mesh, nextHelper);
            return false;
        }
        stopMotion();
        helper.current = nextHelper;
        context.currentMotionResourceId = resourceId;
        return preparedHelper;
    };

    const loadMotion = async (resourceId) => {
        try {
            const preparedHelper = await loadMotionInternal(resourceId);
            if (!preparedHelper) return false;
            onStatus(preparedHelper.physicsError
                ? `PMX 物理不可用，已回退骨骼动画：${preparedHelper.physicsError.message}`
                : 'VMD 动作已加载');
            return true;
        } catch (error) {
            onStatus(`VMD 动作加载失败：${error.message}`);
            return false;
        }
    };

    const load = async (profile, reportProgress = onProgress) => {
        if (!profile || profile.modelType !== 'pmx' || !isSameOriginMmdAsset(profile.modelUrl, '.pmx')) {
            throw new Error('PMX profile 或模型地址无效');
        }
        context.disposed = false;
        const sequence = ++context.modelSequence;
        let stagedMesh = null;
        let stagedHelper = null;
        let stagedPivot = null;
        let stagedPhysicsError = null;
        let progressPercent = 0;
        const report = (phase, percent, indeterminate = false) => {
            if (context.disposed || sequence !== context.modelSequence) return;
            progressPercent = Math.max(progressPercent, Math.min(99, Math.round(percent)));
            reportProgress({ phase, percent: progressPercent, indeterminate: indeterminate === true });
        };
        onStatus('正在加载 PMX 模型…');
        report('读取 PMX', 1, true);
        try {
            stagedMesh = await loadModelMesh(profile.modelUrl, report);
            report('加载纹理', 84);
            // MMDLoader 把 PMX 材质的环境色映射成 emissive；按显示端规则始终忽略这部分亮度。
            stagedMesh.traverse((object) => {
                if (!object.isMesh) return;
                const materials = Array.isArray(object.material) ? object.material : [object.material];
                for (const material of materials) {
                    if (!material?.isMMDToonMaterial) continue;
                    material.emissive.setRGB(0, 0, 0);
                    preparePmxLightingMaterial(material, lightingState.pmxToonEnabled, context.webFillShadowMode);
                }
            });
            setPmxRimLights(stagedMesh, lightingState.rimLights);
            normalizeModel(stagedMesh);
            const staged = await stagePmxMesh({
                scene,
                mesh: stagedMesh,
                createPivot: createModelRotationPivot,
                prepareHelper: () => preparePmxHelper(
                    stagedMesh,
                    profile,
                    profile.motionResourceId,
                    report
                )
            });
            stagedPivot = staged.pivot;
            stagedHelper = staged.preparedHelper.helper;
            stagedPhysicsError = staged.preparedHelper.physicsError;
            if (context.disposed || sequence !== context.modelSequence) {
                disposeStagedResources(stagedMesh, stagedHelper, stagedPivot);
                return false;
            }

            // 暂存枢轴已在最终场景中完成初始状态准备，提交后下一帧才推进物理。
            clearFallback();
            disposeCurrentModel();
            context.currentMesh = stagedMesh;
            setPmxFillShadowMode(context.currentMesh, context.webFillShadowMode && context.keyShadowEnabled
                && lightingState.fillEnabled && context.shadowSource === 'key');
            context.currentRotationPivot = stagedPivot;
            resetModelRotation();
            context.currentRotationPivot.updateWorldMatrix(true, true);
            context.currentProfile = profile;
            helper.current = stagedHelper;
            context.pendingInitialMotionHelper = stagedHelper;
            context.currentMotionResourceId = profile.motionResourceId || null;
            applyShadowFlags(context.currentMesh);
            stagedPivot.visible = true;
            fitCameraToModel(context.currentRotationPivot);
            fitShadowCamera(context.currentRotationPivot);
            stagedMesh = null;
            stagedHelper = null;
            stagedPivot = null;
            report('模型就绪', 99);
            onStatus(stagedPhysicsError
                ? `PMX 物理不可用，已回退骨骼动画：${stagedPhysicsError.message}`
                : 'PMX 模型已加载');
            startRendering();
            return true;
        } catch (error) {
            const partialMesh = error?.partialResult;
            if (!stagedMesh && partialMesh?.isObject3D) stagedMesh = partialMesh;
            disposeStagedResources(stagedMesh, stagedHelper, stagedPivot);
            throw error instanceof Error ? error : new Error('PMX 模型加载失败');
        }
    };


    // 先解析动作，再冻结旧 helper；从绑定姿态创建物理，下一实际动画帧才播放。
    const loadSelectedMotion = async (motion, reportProgress = onProgress) => {
        if (!context.currentMesh || !context.currentProfile) throw new Error('请先加载 PMX 模型');
        if (context.motionSwitchMesh === context.currentMesh) throw new Error('动作正在切换，请稍后再试');
        const profile = { ...context.currentProfile, motionUrl: motion.motionUrl,
            motionResourceId: motion.motionResourceId };
        if (profile.motionUrl) validateMotionResource(profile, profile.motionResourceId);
        const mesh = context.currentMesh;
        const sequence = ++context.motionSequence;
        const modelVersion = context.modelSequence;
        const isCurrent = () => !context.disposed && sequence === context.motionSequence
            && modelVersion === context.modelSequence && mesh === context.currentMesh;
        const report = (detail) => { if (isCurrent()) reportProgress(detail); };
        report({ phase: '读取/解析 VMD', indeterminate: true });
        const clip = profile.motionUrl ? await loadAnimationClip(profile.motionUrl, mesh,
            (_phase, _percent, file) => {
                if (file?.total > 0) report({ phase: '读取/解析 VMD',
                    percent: Math.floor(70 * file.loaded / file.total) });
            }) : null;
        if (!isCurrent()) return false;
        const previousHelper = helper.current;
        context.motionSwitchMesh = mesh;
        try {
            const prepared = await prepareMotionSwitch({
                mesh, oldHelper: previousHelper,
                createHelper: () => createMotionHelper(mesh, clip, profile.playMode, false),
                ensurePhysics: context.physicsSolver === 'xpbd' ? async () => {} : ensureAmmoPhysics, physicsEnabled: context.physicsEnabled, physicsSolver: context.physicsSolver,
                physicsFps: lightingState.physicsFps, playbackEnabled: context.motionPlaybackEnabled,
                isCurrent, canRestore: () => !context.disposed && mesh === context.currentMesh && helper.current === previousHelper,
                onStage: (phase) => report({ phase, indeterminate: true })
            });
            if (!prepared) return false;
            if (!isCurrent()) { prepared.rollback(); return false; }
            stopMotion();
            helper.current = prepared.helper;
            // 复用刷新/换模型的渲染门控：首帧仅物理，下一帧才推进 VMD。
            context.pendingInitialMotionHelper = prepared.helper;
            physicsGate.paused = false;
            setPmxMotionPlaybackEnabled(prepared.helper, context.motionPlaybackEnabled);
            context.currentMotionResourceId = profile.motionResourceId || null;
            context.currentProfile = profile;
            report({ phase: '动作已加载', percent: 99 });
            onStatus('VMD 动作已加载');
            return true;
        } finally {
            if (context.motionSwitchMesh === mesh) context.motionSwitchMesh = null;
        }
    };
/* aasc-module-body-end */
    return { load, loadSelectedMotion, loadMotion, validateMotionResource };
}
