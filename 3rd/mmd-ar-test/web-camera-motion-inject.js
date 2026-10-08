'use strict';

// 相机动作（MMD 相机 VMD）只进入独立网页副本：普通预览驱动虚拟相机，定位期间暂停。
// 每个注入点都必须唯一命中正式源码文本，避免源锚点变动时静默生成不完整适配。
function once(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error(`相机动作适配缺少唯一锚点：${anchor.slice(0, 100)}`);
  return source.replace(anchor, replacement);
}

// 注入 PMX runtime 副本：状态、加载/播放/暂停/进度/清理，以及渲染循环接入。
// 别名导入避免与本地资源注入的同名绑定冲突（两者共用同一模块实例）。
function addCameraMotionRuntime(source, moduleUrl) {
  let output = `import { configureLocalLoader as configureCameraMotionLoader } from '${moduleUrl}';\n${source}`;
  output = once(output, '    const dispose = () => {', `    // 相机动作独立于角色动作：解析相机 VMD、循环驱动预览相机，定位期间不推进。
    let cameraMotionHelper = null;
    let cameraMotionState = null;
    let cameraMotionEnabled = false;
    let cameraMotionSequence = 0;
    const cameraMotionDefaultFov = camera.fov;

    // 关闭或清除相机动作后回到原来的预览视角；定位激活时由定位接管，不写相机。
    const restorePreviewCamera = () => {
        if (arCameraState.active) return;
        camera.up.set(0, 1, 0);
        camera.fov = cameraMotionDefaultFov;
        fitCameraToModel(currentRotationPivot || currentMesh);
    };

    const releaseCameraMotionBinding = () => {
        if (cameraMotionHelper?.camera === camera) {
            try { cameraMotionHelper.remove(camera); }
            catch (error) { console.warn('[显示端 PMX] 释放相机动作失败:', error); }
        }
        cameraMotionState = null;
    };

    // 只推进 mixer，不改物理/骨骼；未开启、无文件或定位中（含失锁冻结）都不推进。
    const advanceCameraMotion = (delta) => {
        if (!cameraMotionEnabled || !cameraMotionState?.hasClip) return false;
        // 相机 VMD 机位可远于模型适配距离：播放期间按加载时算出的最远机位放宽远裁面。
        camera.near = PMX_CAMERA_NEAR;
        camera.far = cameraMotionState.farLimit;
        cameraMotionHelper.update(delta);
        return true;
    };

    const loadCameraMotion = async (motion, reportProgress = onProgress) => {
        if (!currentMesh || !currentProfile) throw new Error('请先加载 PMX 模型');
        if (!motion?.motionUrl || !motion?.motionResourceId) throw new Error('请选择相机 VMD 文件');
        validateMotionResource({ motionUrl: motion.motionUrl, motionResourceId: motion.motionResourceId },
            motion.motionResourceId);
        const sequence = ++cameraMotionSequence;
        reportProgress({ phase: '读取/解析相机 VMD', indeterminate: true });
        const parsed = await waitForManagedLoad(
            (loader, resolve, reject, progress) => {
                configureCameraMotionLoader(loader, motion.motionUrl);
                loader.loadVMD(motion.motionUrl, (data) => {
                    try {
                        if (!Array.isArray(data?.cameras) || data.cameras.length === 0) {
                            throw new Error('所选 VMD 不含相机关键帧，请选择相机动画文件');
                        }
                        resolve({ vmd: data, clip: loader.animationBuilder.buildCameraAnimation(data) });
                    } catch (error) { reject(error); }
                }, progress, reject);
            },
            '相机 VMD',
            (event) => {
                if (!event?.lengthComputable || event.total <= 0) return;
                reportProgress({ phase: '读取/解析相机 VMD',
                    percent: Math.min(99, Math.floor(90 * event.loaded / event.total)) });
            }
        );
        if (disposed || sequence !== cameraMotionSequence) return false;
        reportProgress({ phase: '初始化相机动作', indeterminate: true });
        const bounds = getModelBounds(currentRotationPivot || currentMesh);
        const radius = Math.max(0.01, bounds.getSize(new THREE.Vector3()).length() / 2);
        const reach = parsed.vmd.cameras.reduce((max, key) => {
            const [x, y, z] = key.position || [];
            return Math.max(max, Math.hypot(x || 0, y || 0, z || 0) + Math.abs(Number(key.distance) || 0));
        }, 0);
        if (!cameraMotionHelper) cameraMotionHelper = new MMDAnimationHelper({ sync: false });
        // 换文件先解绑旧相机再绑定新 clip；循环播放由 helper 内部 mixer 默认行为提供。
        releaseCameraMotionBinding();
        cameraMotionHelper.add(camera, { animation: parsed.clip });
        cameraMotionState = { hasClip: true, farLimit: Math.max(reach + radius * 2 + 1, camera.far) };
        reportProgress({ phase: '相机动作已加载', percent: 99 });
        onStatus('相机 VMD 已加载');
        startRendering();
        return true;
    };

    const setCameraMotionPlaybackEnabled = (enabled) => {
        const next = enabled === true;
        const previous = cameraMotionEnabled;
        cameraMotionEnabled = next;
        if (previous && !next && cameraMotionState?.hasClip) restorePreviewCamera();
        startRendering();
        return next;
    };

    // 与角色动作进度同款：只读当前 mixer action 的时间与总时长。
    const getCameraMotionProgress = () => {
        const action = cameraMotionHelper?.objects?.get(camera)?.mixer?._actions?.[0];
        const durationSeconds = action?.getClip?.()?.duration;
        const timeSeconds = action?.time;
        return Number.isFinite(durationSeconds) && durationSeconds > 0 && Number.isFinite(timeSeconds)
            ? { timeSeconds, durationSeconds } : null;
    };

    const clearCameraMotion = () => {
        const hadClip = cameraMotionState?.hasClip === true;
        cameraMotionSequence += 1;
        releaseCameraMotionBinding();
        restorePreviewCamera();
        startRendering();
        return hadClip;
    };

    const dispose = () => {`);
  output = once(output, '            updateCameraView(delta);',
    '            if (!advanceCameraMotion(delta)) updateCameraView(delta);');
  output = once(output, '        getMotionPlaybackEnabled: () => motionPlaybackEnabled,',
    `        getMotionPlaybackEnabled: () => motionPlaybackEnabled,
        loadCameraMotion,
        setCameraMotionPlaybackEnabled,
        getCameraMotionProgress,
        clearCameraMotion,`);
  return output;
}

// 独立MMD-AR生成运行时专用：resize只更新显示投影，不按角色包围盒重置相机。
// AR跟踪器提供自定义projectionMatrix时保留它；普通预览更新垂直FOV对应的aspect投影。
function preserveCameraOnResize(source) {
  return once(source,
    '        camera.aspect = safeWidth / safeHeight;\n        if (!arCameraState.active) fitCameraToModel(currentRotationPivot || currentMesh);',
    '        camera.aspect = safeWidth / safeHeight;\n        if (!arCameraState.active) camera.updateProjectionMatrix();');
}

// 注入显示模块副本：网页端相机动作入口与状态透传（经典脚本，不能新增 import）。
function addCameraMotionDisplay(source) {
  let output = once(source, '    function handleActionPlan(plan) {', `    async function loadSelectedCameraMotion(motion, reportProgress = state.onLoadProgress) {
        if (!state.modelReady || state.runtimeType !== 'pmx') throw new Error('请先加载 PMX 模型');
        const loaded = await state.runtime.loadCameraMotion(motion, reportProgress || undefined);
        return loaded;
    }

    function setCameraMotionPlaybackEnabled(enabled) {
        state.cameraMotionPlaybackEnabled = enabled === true;
        state.runtime?.setCameraMotionPlaybackEnabled?.(state.cameraMotionPlaybackEnabled);
        return state.cameraMotionPlaybackEnabled;
    }

    function getCameraMotionProgress() {
        return state.runtime?.getCameraMotionProgress?.() ?? null;
    }

    function clearCameraMotion() {
        return state.runtime?.clearCameraMotion?.() === true;
    }

    function handleActionPlan(plan) {`);
  output = once(output, '        getModelProfile: () => state.modelProfile ? { ...state.modelProfile } : null,',
    `        getModelProfile: () => state.modelProfile ? { ...state.modelProfile } : null,
        loadSelectedCameraMotion,
        setCameraMotionPlaybackEnabled,
        getCameraMotionProgress,
        clearCameraMotion,`);
  // runtime 重建（例如 PMX/VRM 切换）后回填网页端开关，避免与面板状态脱节。
  return once(output, '                state.runtime.setMotionPlaybackEnabled?.(state.motionPlaybackEnabled);',
    `                state.runtime.setMotionPlaybackEnabled?.(state.motionPlaybackEnabled);
                state.runtime.setCameraMotionPlaybackEnabled?.(state.cameraMotionPlaybackEnabled === true);`);
}

module.exports = { addCameraMotionRuntime, preserveCameraOnResize, addCameraMotionDisplay };

// 正式源码已包含此功能时复用共享实现，仅更新构建指纹。
module.exports = require('./web-production-shared').reuseAdapters(module.exports);
