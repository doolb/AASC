/* PMX 相机 VMD：独立生命周期，AR 接管时暂停，资源读取复用主运行时。 */
export function createPmxCameraMotion(context) {
    const { THREE, camera, arCameraState, PMX_CAMERA_NEAR, MMDAnimationHelper,
        fitCameraToModel, getModelBounds, validateMotionResource, configureCameraMotionLoader,
        waitForManagedLoad, onProgress, onStatus, startRendering } = context;
    // 相机动作独立于角色动作：解析相机 VMD、循环驱动预览相机，定位期间不推进。
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
        fitCameraToModel(context.currentRotationPivot || context.currentMesh);
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
        if (!context.currentMesh || !context.currentProfile) throw new Error('请先加载 PMX 模型');
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
        if (context.disposed || sequence !== cameraMotionSequence) return false;
        reportProgress({ phase: '初始化相机动作', indeterminate: true });
        const bounds = getModelBounds(context.currentRotationPivot || context.currentMesh);
        const radius = Math.max(0.01, bounds.getSize(new THREE.Vector3()).length() / 2);
        const reach = parsed.vmd.cameras.reduce((max, key) => {
            const [x, y, z] = key.position || [];
            return Math.max(max, Math.hypot(x || 0, y || 0, z || 0) + Math.abs(Number(key.distance) || 0));
        }, 0);
        // 新动画成功建立后才替换旧绑定，失败时保留原相机动作。
        const nextHelper = new MMDAnimationHelper({ sync: false });
        try { nextHelper.add(camera, { animation: parsed.clip }); }
        catch (error) {
            if (nextHelper.camera === camera) nextHelper.remove(camera);
            throw error;
        }
        releaseCameraMotionBinding();
        cameraMotionHelper = nextHelper;
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


    return Object.freeze({ advanceCameraMotion, loadCameraMotion, setCameraMotionPlaybackEnabled,
        getCameraMotionProgress, clearCameraMotion,
        disposeCameraMotion() {
            cameraMotionSequence += 1;
            releaseCameraMotionBinding();
            cameraMotionHelper = null;
        } });
}
