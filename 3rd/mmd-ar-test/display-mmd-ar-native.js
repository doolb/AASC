/* APK原生ORB-SLAM3适配；没有真实原生能力时保留已加载的MindAR后端。 */
(function exposeNativeSlamTracking(root) {
    'use strict';
    const fallback = root.DisplayMmdImageTargetTracker;
    if (!fallback?.start) return;
    const CALIBRATION_KEY = 'aasc.mmdArTest.nativeCalibration.v1';
    let currentSession = null, operation = 0, calibration = null, calibrationName = '';
    try {
        const stored = JSON.parse(root.localStorage.getItem(CALIBRATION_KEY) || 'null');
        calibration = stored?.profile || null; calibrationName = stored?.name || '';
    } catch (error) { console.warn('[原生SLAM] 标定配置不可读取:', error); }
    function capabilities() {
        const bridge = root.MmdArNativeSlam;
        if (!bridge || typeof bridge.getCapabilities !== 'function'
            || typeof bridge.start !== 'function' || typeof bridge.stop !== 'function') return null;
        try {
            const result = JSON.parse(bridge.getCapabilities());
            return result.protocolVersion === 1 && result.engine === 'orb-slam3' && result.available === true ? result : null;
        } catch (error) { console.warn('[原生SLAM] 能力检测失败，使用MindAR:', error); return null; }
    }
    function showStatus(message) {
        const live = document.getElementById('mmdArBenchmarkLive');
        if (live) live.textContent = message;
    }
    function updateControls() {
        const available = Boolean(capabilities()) && !root.MmdArTestSimCamera?.isSimulated?.();
        const panel = document.getElementById('mmdArNativeCalibrationPanel');
        const backend = document.getElementById('mmdArNativeBackend');
        const hint = document.getElementById('mmdArNativeCalibrationHint');
        if (panel) panel.hidden = !available;
        if (backend) backend.textContent = available ? '定位后端：原生 ORB-SLAM3（图片首定位）' : '定位后端：MindAR';
        if (hint) hint.textContent = calibration ? `已导入：${calibrationName}；重新开始定位后应用。`
            : '使用估算内参和单目视觉；导入相机与 IMU 标定后可启用惯性模式。';
    }
    document.getElementById('mmdArNativeCalibrationFile')?.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            if (file.size > 64 * 1024) throw new Error('标定文件超过64KiB');
            const profile = JSON.parse(await file.text());
            if (!Number.isInteger(profile.width) || !Number.isInteger(profile.height)
                || !['fx', 'fy', 'cx', 'cy'].every((name) => Number.isFinite(profile[name]))) throw new Error('相机标定格式无效');
            root.localStorage.setItem(CALIBRATION_KEY, JSON.stringify({ profile, name: file.name }));
            calibration = profile; calibrationName = file.name; updateControls();
        } catch (error) { showStatus(`标定导入失败：${error.message}`); }
        finally { event.target.value = ''; }
    });
    document.getElementById('mmdArNativeCalibrationClear')?.addEventListener('click', () => {
        root.localStorage.removeItem(CALIBRATION_KEY); calibration = null; calibrationName = ''; updateControls();
    });
    updateControls();
    document.getElementById('mmdArInputMode')?.addEventListener('change', updateControls);

    async function prepareReference(target) {
        if (!(target.referenceImageBlob instanceof Blob)) throw new Error('请先保存或选择定位图');
        const bitmap = await root.createImageBitmap(target.referenceImageBlob);
        try {
            const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const image = canvas.toDataURL('image/jpeg', .92).split(',')[1];
            const quad = target.selectedQuad;
            if (!Array.isArray(quad) || quad.length !== 4
                || quad.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) throw new Error('图片框选数据无效');
            const distance = (a, b) => Math.hypot((a.x-b.x)*canvas.width, (a.y-b.y)*canvas.height);
            const width = (distance(quad[0],quad[1])+distance(quad[2],quad[3]))/2;
            const height = (distance(quad[0],quad[3])+distance(quad[1],quad[2]))/2;
            if (width < 16 || height < 16) throw new Error('图片框选区域过小');
            return { referenceImageBase64: image, selectedQuad: quad.flatMap((point) => [point.x,point.y]), targetAspect: height/width };
        } finally { bitmap.close(); }
    }

    async function startNative(target) {
        if (currentSession) await currentSession.stop();
        const token = ++operation;
        const reference = await prepareReference(target);
        if (token !== operation) throw new Error('原生定位已取消');
        const bridge = root.MmdArNativeSlam;
        // 原生Camera2开始前释放网页独立预览，停止时再交还背景预览生命周期。
        root.MmdArGravityCamera?.prepareTracking();
        let captureLabel = '';
        let id = null, generation = null, sample = 0, consumedSample = -1, stopped = false, ready = false;
        let latest = { visible: false, reason: 'nativeInitializing', message: '正在初始化原生定位，请保持定位图可见并缓慢移动镜头' };
        let resolveReady, rejectReady;
        const started = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
        // 取消可能发生在start返回前，提前注册拒绝处理，实际await仍会收到相同错误。
        started.catch(() => {});
        const timeout = root.setTimeout(() => rejectReady(new Error('原生定位初始化超时')), 120000);
        const onMessage = (event) => {
            const data = event.detail;
            if (stopped || !data || data.sessionId !== id || data.generation !== generation) return;
            if (data.type === 'status') { showStatus(data.message); return; }
            if (data.type === 'error') {
                const error = new Error(data.message || '原生定位失败');
                if (!ready) rejectReady(error);
                else void root.DisplayMmdAr.stop().finally(() => showStatus(error.message));
                return;
            }
            if (data.type === 'ready') {
                captureLabel = `相机 ${data.cameraId ?? '?'} · ${data.width}×${data.height}`;
                ready = true; root.clearTimeout(timeout); resolveReady();
                showStatus(`${captureLabel} · 请保持图片可见，缓慢平移镜头以对齐地图。`);
                return;
            }
            if (data.type !== 'pose') return;
            const calibrated = data.calibrationQuality === 'calibrated' ? '已标定' : '估算内参';
            const mode = data.mode === 'monocular-inertial' ? '视觉＋IMU' : '单目视觉';
            let message = data.anchored ? `SLAM 跟踪 · ${mode} · ${calibrated} · 地图匹配点 ${data.trackedPoints}`
                : `图片首定位/地图对齐中 · 图像匹配 ${data.imageMatches} · ${mode} · 请保持图片可见并平移镜头`;
            message += ` · ${captureLabel}`;
            if (data.trackingState !== 2) message = data.trackingState <= 1
                ? 'SLAM 初始化中，请缓慢平移镜头并保持环境纹理清晰'
                : 'SLAM 暂时失锁，保留角色并等待重新定位；新地图需要再次看到定位图';
            let visible = false;
            if (data.poseValid && Array.isArray(data.anchorMatrix) && data.anchorMatrix.length === 16
                && Array.isArray(data.projectionMatrix) && data.projectionMatrix.length === 16
                && [...data.anchorMatrix, ...data.projectionMatrix].every(Number.isFinite)) {
                visible = root.DisplayMmd?.setArCameraPose?.({ anchorMatrix: data.anchorMatrix,
                    projectionMatrix: data.projectionMatrix, targetAspect: reference.targetAspect }) === true;
            }
            if (!visible) root.DisplayMmd?.suspendArCameraPose?.();
            latest = { visible, anchored: data.anchored, message, reason: 'nativeTracking', backend: 'orb-slam3' };
            sample += 1; showStatus(message);
        };
        const session = {
            backend: 'orb-slam3', hasLocated: false,
            processFrame: async () => {
                const changed = sample !== consumedSample;
                consumedSample = sample;
                return { ...latest, newSample: changed };
            },
            stop: async () => {
                if (stopped) return;
                stopped = true; root.clearTimeout(timeout);
                root.removeEventListener('mmdNativeSlam', onMessage);
                try { if (id) bridge.stop(id); }
                catch (error) { console.warn('[原生SLAM] 停止接口失败:', error); }
                document.body.classList.remove('mmd-native-slam-live');
                root.MmdArGravityCamera?.trackingStopped();
                root.DisplayMmd?.resetArCameraPose?.();
                if (currentSession === session) { currentSession = null; operation += 1; }
                if (!ready) rejectReady(new Error('原生定位已取消'));
            }
        };
        currentSession = session;
        root.addEventListener('mmdNativeSlam', onMessage);
        try {
            root.MmdArTestImu?.stopSession();
            const imuStatus = document.getElementById('mmdArImuStatus');
            if (imuStatus) imuStatus.textContent = '原生模式由 ORB-SLAM3 处理惯性数据，网页 IMU 预测保持关闭。';
            document.body.classList.add('mmd-native-slam-live');
            const response = JSON.parse(bridge.start(JSON.stringify({ ...reference, calibration })));
            if (response.error || typeof response.sessionId !== 'string' || !Number.isInteger(response.generation))
                throw new Error(response.error || '原生定位接口返回无效会话');
            id = response.sessionId; generation = response.generation;
            await started;
            return session;
        } catch (error) { await session.stop(); throw error; }
    }
    function cancelPending() { operation += 1; if (currentSession) void currentSession.stop(); }
    root.MmdArNativeTracking = Object.freeze({ getCapabilities: capabilities, cancelPending });
    root.DisplayMmdImageTargetTracker = Object.freeze({ ...fallback,
        start: (target, options) => capabilities() && !root.MmdArTestSimCamera?.isSimulated?.()
            ? startNative(target) : fallback.start(target, options)
    });
    root.addEventListener('pagehide', cancelPending);
})(window);
