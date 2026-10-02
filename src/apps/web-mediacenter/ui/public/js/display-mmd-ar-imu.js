/* MMD AR 网页桥接：复用 Mind Basic 的融合/校准核心，只输出相机定位测量。 */
(function exposeMmdArImu(root) {
    'use strict';
    const imu = root.DisplayMmdImuCore;
    const byId = (name) => document.getElementById(`mmdAr${name}`);
    const state = {
        active: false, enabled: false, pending: false, request: 0,
        fusion: null, calibrating: false, samples: [], calibrationTimer: null,
        lastVisual: null, lastVisualAt: null, visible: false, predicting: null,
    };
    const status = (message) => { byId('ImuStatus').textContent = message; };
    const screenAngle = () => Number(root.screen?.orientation?.angle ?? root.orientation ?? 0) || 0;
    const freshVisual = (now) => state.visible && state.lastVisualAt !== null && now - state.lastVisualAt <= 500;
    const bounded = (name, fallback, min, max) => {
        const value = Number(byId(name).value);
        return byId(name).value !== '' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
    };
    const options = () => ({
        orientationCorrectionMs: bounded('ImuCorrection', 800, 200, 2000),
        maxLossDurationMs: bounded('ImuHold', 1800, 200, 3000),
        targetWidthMeters: bounded('ImuTargetWidth', 20, 1, 300) / 100,
        translationEnabled: true
    });

    function controls() {
        byId('ImuToggle').disabled = !state.active || state.pending;
        byId('ImuToggle').textContent = state.enabled ? '关闭 IMU 辅助' : '启用 IMU 辅助';
        byId('ImuToggle').setAttribute('aria-pressed', String(state.enabled));
        for (const name of ['ImuStabilize', 'ImuBridge', 'ImuReset']) byId(name).disabled = !state.enabled;
    }

    function resetFusion() {
        const previous = state.fusion;
        state.fusion = imu.createState(options());
        if (previous) imu.setCalibration(state.fusion, previous);
        state.predicting = null;
        state.lastVisualAt = null;
        state.samples.length = 0;
    }

    function predictionMode(now) {
        const predict = freshVisual(now) ? byId('ImuStabilize').checked : byId('ImuBridge').checked;
        if (!predict && state.predicting !== false) imu.pausePrediction(state.fusion);
        state.predicting = predict;
        return predict;
    }

    function beginCalibration() {
        state.fusion = imu.createState(options());
        state.predicting = null;
        state.samples.length = 0;
        state.calibrating = true;
        const now = performance.now();
        if (state.lastVisual && freshVisual(now)) imu.seedVisualPose(state.fusion, state.lastVisual, now);
        clearTimeout(state.calibrationTimer);
        status('请保持手机静止，校准陀螺仪与加速度零偏（至少 1.2 秒）…');
        state.calibrationTimer = setTimeout(() => {
            if (state.calibrating) status('静止校准未完成，预测保持暂停；请静置或重新校准。');
        }, 8000);
    }

    function onMotion(event) {
        if (!state.active || !state.enabled || document.visibilityState === 'hidden') return;
        const now = performance.now();
        const fusion = state.fusion;
        imu.recordLinearAcceleration(fusion, event.acceleration);
        if (state.calibrating) {
            if (fusion.visualObservedAt !== null && now - fusion.visualObservedAt <= 200
                && now - fusion.visualStillAt < 600) {
                state.samples.length = 0;
                return;
            }
            const calibration = imu.collectCalibrationSample(state.samples, event.rotationRate, event.acceleration, now);
            if (calibration) {
                imu.setCalibration(fusion, calibration);
                fusion.lastGyroscopeAt = null;
                state.calibrating = false;
                clearTimeout(state.calibrationTimer);
                status('IMU 已校准；预测相机旋转和平移，视觉平滑纠偏。');
            }
            return;
        }
        const predict = predictionMode(now);
        imu.integrateGyroscope(fusion, event.rotationRate, now, screenAngle(), predict);
        if (predict) imu.integrateLinearAcceleration(fusion, event.acceleration, now, screenAngle());
    }

    function onCoordinatesChanged() {
        if (state.enabled) resetFusion();
    }

    function disable() {
        state.request += 1;
        state.pending = false;
        state.enabled = false;
        state.calibrating = false;
        clearTimeout(state.calibrationTimer);
        root.removeEventListener('devicemotion', onMotion);
        root.removeEventListener('orientationchange', onCoordinatesChanged);
        document.removeEventListener('visibilitychange', onCoordinatesChanged);
        state.fusion = imu.createState(options());
        state.predicting = null;
        controls();
        status(state.active ? 'IMU 已关闭，使用 MindAR 视觉定位。' : '开始定位后可启用 IMU 辅助。');
    }

    async function enable() {
        if (!state.active || state.enabled || state.pending) return;
        const request = ++state.request;
        state.pending = true;
        controls();
        try {
            if (!root.isSecureContext) throw new Error('设备传感器需要 HTTPS 或可信本地页面');
            if (!root.DeviceMotionEvent) throw new Error('浏览器不支持设备运动传感器');
            if (typeof root.DeviceMotionEvent.requestPermission === 'function') {
                const permission = await root.DeviceMotionEvent.requestPermission();
                if (request !== state.request) return;
                if (permission !== 'granted') throw new Error('设备运动权限未获准');
            }
            if (request !== state.request || !state.active) return;
            state.enabled = true;
            root.addEventListener('devicemotion', onMotion, { passive: true });
            root.addEventListener('orientationchange', onCoordinatesChanged, { passive: true });
            document.addEventListener('visibilitychange', onCoordinatesChanged);
            beginCalibration();
        } catch (error) {
            if (request === state.request) {
                disable();
                status(error.message || '无法启用 IMU');
            }
        } finally {
            if (request === state.request) { state.pending = false; controls(); }
        }
    }

    function observeVisualPose(pose, now) {
        state.lastVisual = pose;
        state.lastVisualAt = now;
        state.visible = true;
        if (state.enabled) {
            imu.observeVisualMotion(state.fusion, pose, now);
            imu.correctVisualPose(state.fusion, pose, {
                timestamp: now, stabilize: byId('ImuStabilize').checked && !state.calibrating
            });
        }
    }

    function beginLoss(now) {
        state.visible = false;
        if (state.enabled) imu.beginTrackingLoss(state.fusion, now);
    }

    function getFramePose(now) {
        if (!state.active || !state.lastVisual) return null;
        if (state.enabled && state.fusion.tracking
            && now - state.fusion.lastVisualAt > state.fusion.config.visualTimeoutMs) {
            imu.beginTrackingLoss(state.fusion, state.fusion.lastVisualAt);
        }
        const visual = freshVisual(now);
        if (!state.enabled) return visual ? { pose: state.lastVisual } : null;
        const predict = predictionMode(now) && !state.calibrating && imu.isGyroscopeFresh(state.fusion, now);
        if (!predict && !visual) return null;
        const stabilize = byId('ImuStabilize').checked && !state.calibrating;
        const pose = predict || (visual && stabilize && state.fusion.initialized)
            ? imu.getPose(state.fusion, now) : state.lastVisual;
        return pose ? { pose } : null;
    }

    function startSession(target) {
        state.active = true;
        state.lastVisual = null;
        state.lastVisualAt = null;
        state.visible = false;
        const physicalWidth = Number(target?.physicalWidthMm);
        if (Number.isFinite(physicalWidth) && physicalWidth >= 10 && physicalWidth <= 3000) {
            byId('ImuTargetWidth').value = String(physicalWidth / 10);
        }
        resetFusion();
        controls();
        status('定位已启动，可启用 IMU 并静置校准；请按实物填写图宽。');
    }

    function stopSession() {
        state.active = false;
        disable();
        state.lastVisual = null;
        state.lastVisualAt = null;
        state.visible = false;
    }

    byId('ImuToggle').addEventListener('click', () => { if (state.enabled) disable(); else void enable(); });
    byId('ImuReset').addEventListener('click', beginCalibration);
    for (const name of ['ImuStabilize', 'ImuBridge']) byId(name).addEventListener('change', () => predictionMode(performance.now()));
    for (const name of ['ImuCorrection', 'ImuHold']) byId(name).addEventListener('input', () => {
        Object.assign(state.fusion.config, options());
        byId('ImuCorrectionValue').textContent = `${options().orientationCorrectionMs} ms`;
        byId('ImuHoldValue').textContent = `${options().maxLossDurationMs} ms`;
    });
    byId('ImuTargetWidth').addEventListener('change', () => { if (state.enabled) resetFusion(); else Object.assign(state.fusion.config, options()); });
    state.fusion = imu.createState(options());
    controls();
    root.DisplayMmdImu = Object.freeze({ startSession, stopSession, observeVisualPose, beginLoss, getFramePose, isVisualTrackingFresh: freshVisual });
})(window);
