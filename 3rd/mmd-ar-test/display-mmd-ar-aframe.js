/* HTTPS MMD AR 测试页：复用 MindAR Basic 的 A-Frame 目标锚点定位。 */
(function exposeMmdArAframeTracking(root) {
    'use strict';

    const host = document.getElementById('mmdArAframeHost');
    const scene = document.getElementById('mmdArAframeScene');
    const anchor = document.getElementById('mmdArAframeAnchor');
    const rectangle = document.getElementById('mmdArAframeTargetRect');
    const worldTarget = document.getElementById('mmdArAframeWorldTarget');
    const cameraRig = document.getElementById('mmdArAframeCameraRig');
    const live = document.getElementById('mmdArBenchmarkLive');
    const filterMinCFInput = document.getElementById('mmdArFilterMinCF');
    const filterMinCFOutput = document.getElementById('mmdArFilterMinCFValue');
    const filterBetaInput = document.getElementById('mmdArFilterBeta');
    const filterBetaOutput = document.getElementById('mmdArFilterBetaValue');
    const FILTER_SETTINGS_KEY = 'aasc.mmdArTest.mindArFilter.v1';
    const DEFAULT_FILTER_SETTINGS = Object.freeze({ filterMinCF: 0.001, filterBeta: 1000 });
    const OFFICIAL_TARGET_SRC = new URL('../assets/mindar-official-card.mind', document.currentScript.src).href;
    if (!host || !scene || !anchor || !rectangle || !worldTarget || !cameraRig) return;

    const readFilterSettings = () => {
        let stored = {};
        try { stored = JSON.parse(root.localStorage.getItem(FILTER_SETTINGS_KEY) || '{}') || {}; }
        catch (error) { stored = {}; }
        const normalize = (name, minimum, maximum) => {
            const candidate = stored[name];
            if (candidate === null || candidate === undefined
                || (typeof candidate === 'string' && candidate.trim() === '')) return DEFAULT_FILTER_SETTINGS[name];
            const value = Number(candidate);
            return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : DEFAULT_FILTER_SETTINGS[name];
        };
        return {
            filterMinCF: normalize('filterMinCF', 0.0001, 0.02),
            filterBeta: normalize('filterBeta', 0, 2000)
        };
    };

    let filterSettings = readFilterSettings();

    function updateFilterControls() {
        if (filterMinCFInput) filterMinCFInput.value = String(filterSettings.filterMinCF);
        if (filterMinCFOutput) {
            filterMinCFOutput.textContent = filterSettings.filterMinCF.toFixed(4).replace(/0+$/u, '').replace(/\.$/u, '');
        }
        if (filterBetaInput) filterBetaInput.value = String(filterSettings.filterBeta);
        if (filterBetaOutput) filterBetaOutput.textContent = String(filterSettings.filterBeta);
    }

    function saveFilterSettings() {
        try { root.localStorage.setItem(FILTER_SETTINGS_KEY, JSON.stringify(filterSettings)); }
        catch (error) { /* 存储不可用时仍允许本页调节，重新加载后回到默认值。 */ }
    }

    filterMinCFInput?.addEventListener('input', () => {
        filterSettings.filterMinCF = Math.min(0.02, Math.max(0.0001, Number(filterMinCFInput.value)));
        updateFilterControls();
        saveFilterSettings();
    });
    filterBetaInput?.addEventListener('input', () => {
        filterSettings.filterBeta = Math.min(2000, Math.max(0, Number(filterBetaInput.value)));
        updateFilterControls();
        saveFilterSettings();
    });
    updateFilterControls();

    let generation = 0;
    let currentSession = null;
    let resizeHandler = null;
    let originalResize = null;
    let originalStartVideo = null;
    let targetUrl = null;
    let rejectStart = null;
    let detachTargetEvents = null;
    let poseSyncFrame = 0;
    let poseSyncState = { attempts: 0, successes: 0, failures: 0, synced: false };

    function updateLive(message) {
        if (live) live.textContent = message;
    }

    function releaseSystem({ preservePreview = false } = {}) {
        // 自动清理的idle取消和pagehide也会到达这里；显式开始/停止仍保留原复位语义。
        // 缺少诊断接口的旧运行时仍走原清理策略，确保实际定位不会遗留相机状态。
        const resetCamera = !preservePreview || root.DisplayMmd?.getArCameraState?.()?.active !== false;
        if (poseSyncFrame) root.cancelAnimationFrame(poseSyncFrame);
        poseSyncFrame = 0;
        root.MmdArTestImu?.stopSession();
        if (resetCamera) root.DisplayMmd?.resetArCameraPose?.();
        if (worldTarget.object3D) worldTarget.object3D.visible = false;
        if (cameraRig.object3D) {
            cameraRig.object3D.position.set(0, 0, 0);
            cameraRig.object3D.quaternion.set(0, 0, 0, 1);
            cameraRig.object3D.scale.set(1, 1, 1);
            cameraRig.object3D.updateMatrix();
            cameraRig.object3D.updateMatrixWorld(true);
        }
        const system = scene.systems?.['mindar-image-system'];
        if (!system) {
            root.MmdArGravityCamera?.trackingStopped();
            return;
        }
        // 编译尚未开始使用摄像头时，不释放独立重力背景持有的模拟流。
        if (system.video || originalStartVideo) root.MmdArTestSimCamera?.releaseStream?.();
        if (resizeHandler) root.removeEventListener('resize', resizeHandler);
        if (originalResize) system._resize = originalResize;
        if (originalStartVideo) system._startVideo = originalStartVideo;
        resizeHandler = null;
        originalResize = null;
        originalStartVideo = null;
        const video = system.video;
        try {
            if (video && system.controller) system.pause();
        } catch (error) {
            console.warn('[MMD AR A-Frame] 暂停识别失败，继续释放相机:', error);
        }
        for (const track of video?.srcObject?.getTracks?.() || []) track.stop();
        try {
            system.controller?.dispose?.();
        } catch (error) {
            console.warn('[MMD AR A-Frame] 销毁识别器失败:', error);
        }
        video?.remove();
        system.video = null;
        system.controller = null;
        root.MmdArGravityCamera?.trackingStopped();
        if (system.mainStats?.domElement?.isConnected) system.mainStats.domElement.remove();
        system.mainStats = null;
        detachTargetEvents?.();
        detachTargetEvents = null;
        if (anchor.object3D) anchor.object3D.visible = false;
        host.hidden = true;
        if (targetUrl) URL.revokeObjectURL(targetUrl);
        targetUrl = null;
    }

    function cancelPending({ preservePreview = false } = {}) {
        generation += 1;
        rejectStart?.(new Error('定位任务已取消'));
        rejectStart = null;
        releaseSystem({ preservePreview });
        currentSession = null;
    }

    function waitForScene(token) {
        if (scene.hasLoaded) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                scene.removeEventListener('loaded', onLoaded);
                reject(new Error('A-Frame 场景初始化超时'));
            }, 30000);
            const onLoaded = () => {
                clearTimeout(timeout);
                if (token !== generation) reject(new Error('定位任务已取消'));
                else resolve();
            };
            scene.addEventListener('loaded', onLoaded, { once: true });
        });
    }

    function prepareSystem(system, token) {
        originalResize = system._resize;
        resizeHandler = originalResize.bind(system);
        const trackedResize = function trackedResize(...args) {
            return originalResize.apply(this, args);
        };
        // MindAR 1.2.5 的 stop 不移除 resize 监听；固定 bind 引用，停止时可准确清理。
        Object.defineProperty(trackedResize, 'bind', { value: () => resizeHandler });
        system._resize = trackedResize;

        originalStartVideo = system._startVideo;
        system._startVideo = function startCancelableVideo() {
            const video = document.createElement('video');
            video.autoplay = true;
            video.muted = true;
            video.playsInline = true;
            video.style.position = 'absolute';
            video.style.left = '0';
            video.style.top = '0';
            video.style.zIndex = '2';
            system.video = video;
            host.appendChild(video);
            (root.MmdArTestSimCamera?.getStream
                ? root.MmdArTestSimCamera.getStream()
                : root.navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment' } }))
                .then((stream) => {
                    if (token !== generation) {
                        for (const track of stream.getTracks()) track.stop();
                        video.remove();
                        return;
                    }
                    video.addEventListener('loadedmetadata', () => {
                        if (token !== generation) return;
                        video.setAttribute('width', video.videoWidth);
                        video.setAttribute('height', video.videoHeight);
                        void system._startAR().catch((error) => scene.emit('arError', { error: error.message }));
                    }, { once: true });
                    video.srcObject = stream;
                })
                .catch((error) => {
                    if (token === generation) scene.emit('arError', { error: error.message || 'VIDEO_FAIL' });
                });
        };
    }

    async function start(target) {
        cancelPending();
        const token = generation;
        let compiled;
        try {
            if (root.MmdArTestSimCamera?.isSimulated() && !root.MmdArTestSimCamera.getState().imageReady) {
                throw new Error('请先选择模拟摄像头图片');
            }
            const official = target?.targetId === 'builtin:mindar-official-card';
            if (official) {
                // 与 MindAR Basic 完全相同的官方 .mind 资源，用于验证 A-Frame 首锁。
                compiled = { aspect: 372 / 674, data: null };
                updateLive('正在载入 MindAR 官方定位图…');
            } else {
                if (typeof root.MmdArTestCompileTarget !== 'function') throw new Error('MindAR 编译器未加载');
                updateLive('正在编译定位图…');
                compiled = await root.MmdArTestCompileTarget(target);
            }
            if (token !== generation) throw new Error('定位任务已取消');
            await waitForScene(token);
            if (token !== generation) throw new Error('定位任务已取消');
            const system = scene.systems?.['mindar-image-system'];
            if (!system || (!root.MmdArTestSimCamera?.isSimulated() && !root.navigator.mediaDevices?.getUserMedia)) {
                throw new Error('A-Frame 定位或视频输入不可用');
            }
            if (!root.MmdArTestImu || !root.MindBasicImu) throw new Error('IMU 融合模块未加载');
            root.MmdArTestImu.startSession(target);
            root.MmdArGravityCamera?.prepareTracking();
            // MindAR 1.2.5 在 _startAR 创建 Controller 时读取 system 上的滤波参数。
            system.filterMinCF = filterSettings.filterMinCF;
            system.filterBeta = filterSettings.filterBeta;
            prepareSystem(system, token);
            targetUrl = compiled.data
                ? URL.createObjectURL(new Blob([compiled.data], { type: 'application/octet-stream' }))
                : null;
            system.imageTargetSrc = targetUrl || OFFICIAL_TARGET_SRC;
            rectangle.setAttribute('height', String(compiled.aspect));
            document.getElementById('mmdArAframeCrossV')?.setAttribute('height', String(Math.min(0.22, compiled.aspect * 0.5)));
            host.hidden = false;
            scene.resize?.();
            let visible = false;
            let sample = 0;
            let poseQueued = false;
            let lastAppliedAnchor = null;
            let lastAppliedProjection = null;
            poseSyncState = { attempts: 0, successes: 0, failures: 0, synced: false };
            const THREE = root.AFRAME.THREE;
            let lastObservedAnchor = null;
            let worldScale = null;
            let cameraFrozen = false;
            const rawTrackingValid = () => anchor.object3D?.visible
                && system.controller?.trackingStates?.[0]?.isTracking !== false;
            const markLost = () => {
                visible = false;
                root.MmdArTestImu.beginLoss(performance.now());
            };
            const observeCurrentPose = () => {
                if (token !== generation || document.visibilityState === 'hidden') return;
                if (!rawTrackingValid()) { markLost(); return; }
                const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
                anchor.object3D.matrix.decompose(position, quaternion, scale);
                const pose = { position: position.toArray(), quaternion: quaternion.toArray(), scale: scale.toArray() };
                if (![...pose.position, ...pose.quaternion, ...pose.scale].every(Number.isFinite)
                    || pose.scale.some((value) => value <= 0) || Math.hypot(...pose.quaternion) < 1e-9) return;
                lastObservedAnchor = Array.from(anchor.object3D.matrix.elements);
                root.MmdArTestImu.observeVisualPose(pose, performance.now());
                visible = true;
                sample += 1;
            };
            const applyCurrentPose = () => {
                if (token !== generation || !scene.camera || document.visibilityState === 'hidden') return false;
                const frame = root.MmdArTestImu.getFramePose(performance.now());
                const pmxState = root.DisplayMmd?.getArCameraSyncState?.();
                if (!frame) {
                    // 关闭失锁预测/传感器断流时也暂停尚未走完的第二层缓动。
                    if (!cameraFrozen || (pmxState?.active && !pmxState.trackingLost)) root.DisplayMmd?.suspendArCameraPose?.();
                    cameraFrozen = true;
                    return false;
                }
                cameraFrozen = false;
                const pose = frame.pose;
                const referenceScale = worldScale ?? pose.scale[0];
                const cameraPose = root.MindBasicImu.cameraPoseFromTarget(pose, referenceScale);
                if (!cameraPose) return false;
                if (worldScale === null) {
                    worldScale = referenceScale;
                    worldTarget.object3D.position.set(0, 0, 0);
                    worldTarget.object3D.quaternion.set(0, 0, 0, 1);
                    worldTarget.object3D.scale.set(worldScale, worldScale, worldScale);
                    worldTarget.object3D.updateMatrix();
                }
                // 蓝框固定在世界锚点，A-Frame 相机取融合测量的逆；模型不随传感器变换。
                worldTarget.object3D.visible = true;
                cameraRig.object3D.position.set(...cameraPose.position);
                cameraRig.object3D.quaternion.set(...cameraPose.quaternion);
                cameraRig.object3D.scale.set(1, 1, 1);
                cameraRig.object3D.updateMatrix();
                cameraRig.object3D.updateMatrixWorld(true);
                const anchorMatrix = new THREE.Matrix4().compose(
                    new THREE.Vector3(...pose.position), new THREE.Quaternion(...pose.quaternion),
                    new THREE.Vector3(...pose.scale)).toArray();
                const projectionMatrix = Array.from(scene.camera.projectionMatrix.elements);
                const changed = !lastAppliedAnchor || !lastAppliedProjection
                    || anchorMatrix.some((value, index) => value !== lastAppliedAnchor[index])
                    || projectionMatrix.some((value, index) => value !== lastAppliedProjection[index]);
                if (!changed && poseSyncState.synced && (!pmxState || (pmxState.active && !pmxState.trackingLost))) return true;
                poseSyncState.attempts += 1;
                // PMX 仍使用原世界图面映射、死区与第二层相机缓动，不改角色根节点或物理。
                const applied = root.DisplayMmd?.setArCameraPose?.({ anchorMatrix, projectionMatrix, targetAspect: compiled.aspect }) === true;
                if (applied) {
                    const wasUnsynced = !poseSyncState.synced;
                    poseSyncState.successes += 1;
                    poseSyncState.synced = true;
                    lastAppliedAnchor = anchorMatrix;
                    lastAppliedProjection = projectionMatrix;
                    if (wasUnsynced) updateLive('相机已同步，IMU/视觉融合后继续使用相机跟随设置。');
                } else {
                    const wasSynced = poseSyncState.synced;
                    poseSyncState.failures += 1;
                    poseSyncState.synced = false;
                    if (wasSynced || poseSyncState.failures === 1) updateLive('已收到位姿，正在等待角色相机同步…');
                }
                return applied;
            };
            const checkPoseSync = () => {
                poseSyncFrame = 0;
                if (token !== generation) return;
                // 漏事件时仅接纳真正改变的原始矩阵，不将 RAF 重读的旧矩阵当作新观测。
                if (document.visibilityState !== 'hidden') {
                    if (rawTrackingValid()) {
                        const matrix = anchor.object3D.matrix.elements;
                        if (!lastObservedAnchor || matrix.some((value, index) => value !== lastObservedAnchor[index])) observeCurrentPose();
                    } else if (visible) markLost();
                }
                applyCurrentPose();
                poseSyncFrame = root.requestAnimationFrame(checkPoseSync);
            };
            const onPoseUpdate = () => {
                if (poseQueued || token !== generation) return;
                poseQueued = true;
                // MindAR 在事件返回后才提交矩阵，微任务只读取本次新观测。
                queueMicrotask(() => {
                    poseQueued = false;
                    if (token !== generation) return;
                    observeCurrentPose();
                    applyCurrentPose();
                });
            };
            const onFound = () => {
                if (token !== generation) return;
                sample += 1;
                updateLive('已找到定位图，等待稳定观测并同步相机…');
                onPoseUpdate();
            };
            const onLost = () => {
                if (token !== generation) return;
                sample += 1;
                markLost();
                applyCurrentPose();
                updateLive('定位图暂时丢失；相机按 IMU 场景开关预测或保持，正在寻找…');
            };
            anchor.addEventListener('targetUpdate', onPoseUpdate);
            anchor.addEventListener('targetFound', onFound);
            anchor.addEventListener('targetLost', onLost);
            poseSyncFrame = root.requestAnimationFrame(checkPoseSync);
            detachTargetEvents = () => {
                anchor.removeEventListener('targetUpdate', onPoseUpdate);
                anchor.removeEventListener('targetFound', onFound);
                anchor.removeEventListener('targetLost', onLost);
            };
            try {
                await new Promise((resolve, reject) => {
                    const cleanup = () => {
                        clearTimeout(timeout);
                        scene.removeEventListener('arReady', onReady);
                        scene.removeEventListener('arError', onError);
                        if (rejectStart === onCancel) rejectStart = null;
                    };
                    const onReady = () => {
                        if (scene.object3D) scene.object3D.background = null;
                        scene.renderer?.setClearAlpha?.(0);
                        root.MmdArTestImu.attachQuality(system.controller);
                        cleanup();
                        resolve();
                    };
                    const onError = (event) => {
                        cleanup();
                        reject(new Error(`MindAR 启动失败：${event.detail?.error || '摄像头不可用'}`));
                    };
                    const onCancel = (error) => { cleanup(); reject(error); };
                    const timeout = setTimeout(() => onError({ detail: { error: '启动超时' } }), 120000);
                    rejectStart = onCancel;
                    scene.addEventListener('arReady', onReady, { once: true });
                    scene.addEventListener('arError', onError, { once: true });
                    try { system.start(); } catch (error) { onCancel(error); }
                });
            } catch (error) {
                detachTargetEvents?.();
                detachTargetEvents = null;
                throw error;
            }
            if (token !== generation) throw new Error('定位任务已取消');
            updateLive('A-Frame 已启动，正在寻找定位图…');
            let lastSample = -1;
            const session = {
                get hasLocated() { return sample > 0; },
                set hasLocated(_value) {},
                async processFrame() {
                    const newSample = sample !== lastSample;
                    lastSample = sample;
                    const visualFresh = visible && root.MmdArTestImu.isVisualTrackingFresh(performance.now());
                    return { visible: visualFresh, newSample, reason: visualFresh ? null : 'searching' };
                },
                async stop() {
                    anchor.removeEventListener('targetUpdate', onPoseUpdate);
                    anchor.removeEventListener('targetFound', onFound);
                    anchor.removeEventListener('targetLost', onLost);
                    if (token === generation) cancelPending();
                    updateLive('A-Frame 定位已停止。');
                }
            };
            currentSession = session;
            return session;
        } catch (error) {
            if (token === generation) cancelPending();
            throw error;
        }
    }

    root.MmdArTestAframeTracking = Object.freeze({
        cancelPending,
        getPoseSyncState: () => ({ ...poseSyncState })
    });
    root.DisplayMmdArLocationMarker = Object.freeze({
        // 正常失锁保留已锚定蓝框；停止/切换由 releaseSystem 显式隐藏，不能篡改 MindAR 测量节点。
        hide: () => { if (!currentSession && worldTarget.object3D) worldTarget.object3D.visible = false; }
    });
    root.DisplayMmdImageTargetTracker = Object.freeze({ start });
    root.addEventListener('pagehide', () => cancelPending({ preservePreview: true }));
})(window);
