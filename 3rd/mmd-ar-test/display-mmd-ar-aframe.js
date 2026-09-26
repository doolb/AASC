/* HTTPS MMD AR 测试页：复用 MindAR Basic 的 A-Frame 目标锚点定位。 */
(function exposeMmdArAframeTracking(root) {
    'use strict';

    const host = document.getElementById('mmdArAframeHost');
    const scene = document.getElementById('mmdArAframeScene');
    const anchor = document.getElementById('mmdArAframeAnchor');
    const rectangle = document.getElementById('mmdArAframeTargetRect');
    const live = document.getElementById('mmdArBenchmarkLive');
    const OFFICIAL_TARGET_SRC = 'https://cdn.jsdelivr.net/gh/hiukim/mind-ar-js@1.2.2/examples/image-tracking/assets/card-example/card.mind';
    if (!host || !scene || !anchor || !rectangle) return;

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

    function releaseSystem() {
        if (poseSyncFrame) root.cancelAnimationFrame(poseSyncFrame);
        poseSyncFrame = 0;
        root.MmdArTestSimCamera?.releaseStream?.();
        root.DisplayMmd?.resetArCameraPose?.();
        const system = scene.systems?.['mindar-image-system'];
        if (!system) return;
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
        if (system.mainStats?.domElement?.isConnected) system.mainStats.domElement.remove();
        system.mainStats = null;
        detachTargetEvents?.();
        detachTargetEvents = null;
        if (anchor.object3D) anchor.object3D.visible = false;
        host.hidden = true;
        if (targetUrl) URL.revokeObjectURL(targetUrl);
        targetUrl = null;
    }

    function cancelPending() {
        generation += 1;
        rejectStart?.(new Error('定位任务已取消'));
        rejectStart = null;
        releaseSystem();
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
            const applyCurrentPose = () => {
                if (token !== generation || !anchor.object3D?.visible || !scene.camera) return false;
                const anchorMatrix = Array.from(anchor.object3D.matrix.elements);
                const projectionMatrix = Array.from(scene.camera.projectionMatrix.elements);
                poseSyncState.attempts += 1;
                const applied = root.DisplayMmd?.setArCameraPose?.({ anchorMatrix, projectionMatrix, targetAspect: compiled.aspect }) === true;
                if (applied) {
                    const wasUnsynced = !poseSyncState.synced;
                    poseSyncState.successes += 1;
                    poseSyncState.synced = true;
                    lastAppliedAnchor = anchorMatrix;
                    lastAppliedProjection = projectionMatrix;
                    sample += 1;
                    if (wasUnsynced) updateLive('已收到定位图位姿，角色相机正在跟随。');
                } else {
                    const wasSynced = poseSyncState.synced;
                    poseSyncState.failures += 1;
                    poseSyncState.synced = false;
                    if (wasSynced || poseSyncState.failures === 1) {
                        updateLive('已找到定位图，正在等待角色相机同步…');
                    }
                }
                return applied;
            };
            const checkPoseSync = () => {
                poseSyncFrame = 0;
                if (token !== generation) return;
                if (anchor.object3D?.visible && scene.camera) {
                    const anchorMatrix = anchor.object3D.matrix.elements;
                    const projectionMatrix = scene.camera.projectionMatrix.elements;
                    const changed = !lastAppliedAnchor || !lastAppliedProjection
                        || anchorMatrix.some((value, index) => value !== lastAppliedAnchor[index])
                        || projectionMatrix.some((value, index) => value !== lastAppliedProjection[index]);
                    const pmxState = root.DisplayMmd?.getArCameraSyncState?.();
                    // A-Frame 蓝框独立渲染；事件漏帧或 PMX 暂未就绪时，按当前锚点重试。
                    if (!poseSyncState.synced || changed
                        || (pmxState && (!pmxState.active || pmxState.trackingLost))) applyCurrentPose();
                }
                poseSyncFrame = root.requestAnimationFrame(checkPoseSync);
            };
            const onPoseUpdate = () => {
                if (poseQueued || token !== generation) return;
                poseQueued = true;
                // MindAR 在 targetUpdate 事件返回后才把矩阵写入锚点；微任务读取本帧新矩阵。
                queueMicrotask(() => {
                    poseQueued = false;
                    applyCurrentPose();
                });
            };
            const onFound = () => {
                if (token !== generation) return;
                visible = true;
                sample += 1;
                poseSyncState.synced = false;
                lastAppliedAnchor = null;
                lastAppliedProjection = null;
                updateLive('A-Frame 已找到定位图，正在同步角色相机…');
            };
            const onLost = () => {
                if (token !== generation) return;
                visible = false;
                sample += 1;
                poseSyncState.synced = false;
                lastAppliedAnchor = null;
                lastAppliedProjection = null;
                root.DisplayMmd?.suspendArCameraPose?.();
                updateLive('定位图暂时丢失，角色保持原位置，视角停在最后一次定位结果；正在寻找…');
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
                    const onReady = () => { cleanup(); resolve(); };
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
                    return { visible, newSample, reason: visible ? null : 'searching' };
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
    root.DisplayMmdArLocationMarker = Object.freeze({ hide: () => { if (anchor.object3D) anchor.object3D.visible = false; } });
    root.DisplayMmdImageTargetTracker = Object.freeze({ start });
    root.addEventListener('pagehide', cancelPending);
})(window);
