/* 独立重力模式的摄像头背景；图片定位和校准使用相机时暂停独立预览。 */
(function exposeGravityCamera(root) {
    'use strict';
    const input = document.getElementById('mmdArGravityCameraEnabled');
    const video = document.getElementById('mmdArGravityCameraVideo');
    const message = document.getElementById('mmdArGravityCameraMessage');
    const calibration = document.getElementById('displayArCalibration');
    if (!input || !video || !message) return;
    const state = { gravity: false, tracking: false, calibration: false, stream: null,
        simulated: false, request: 0, pending: null, frame: 0, leaving: false };
    const wanted = () => state.gravity && input.checked && !state.leaving
        && document.visibilityState !== 'hidden';
    const say = (text) => { message.textContent = text; };

    function releasePreview() {
        state.request += 1;
        state.pending = null;
        video.hidden = true;
        video.pause();
        video.srcObject = null;
        for (const track of state.stream?.getTracks?.() || []) track.stop();
        state.stream = null;
        if (state.simulated) root.MmdArTestSimCamera?.releaseStream?.();
        state.simulated = false;
    }

    function updateVisibility() {
        input.disabled = !state.gravity;
        // 只隐藏用于合成的图片定位视频，绝不停止其帧输入或隐藏识别蓝框。
        document.body.classList.toggle('mmd-ar-gravity-hide-camera', state.gravity && !input.checked);
    }

    async function openPreview() {
        if (state.stream || state.pending || !wanted() || state.tracking || state.calibration) return;
        const request = ++state.request;
        state.pending = request;
        state.simulated = root.MmdArTestSimCamera?.isSimulated?.() === true;
        say('正在打开摄像头画面…');
        let stream = null;
        try {
            stream = root.MmdArTestSimCamera?.getStream
                ? await root.MmdArTestSimCamera.getStream()
                : await root.navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment' } });
            if (request !== state.request || !wanted() || state.tracking || state.calibration) {
                for (const track of stream.getTracks()) track.stop();
                return;
            }
            state.stream = stream;
            video.srcObject = stream;
            await video.play();
            if (request !== state.request || !wanted()) return;
            video.hidden = false;
            say('摄像头画面已显示。');
        } catch (error) {
            // 迟到的授权/错误不能覆盖新一轮状态；重力传感器不受视频失败影响。
            for (const track of stream?.getTracks?.() || []) track.stop();
            if (request === state.request) {
                releasePreview();
                say(`摄像头画面不可用：${error.message || '请检查权限或相机占用'}`);
            }
        } finally {
            if (state.pending === request) state.pending = null;
        }
    }

    function refresh() {
        state.frame = 0;
        updateVisibility();
        if (!wanted() || state.tracking || state.calibration) {
            releasePreview();
            if (!state.gravity) say('启用重力旋转后，可选择显示摄像头画面。');
            else if (!input.checked) say(state.tracking ? '画面已隐藏，图片定位仍继续。' : '摄像头画面已关闭。');
            else if (state.calibration) say('校准使用摄像头中，结束后恢复背景。');
            else if (state.tracking) say('使用图片定位的摄像头画面。');
            else say('页面在后台，摄像头预览已暂停。');
            return;
        }
        void openPreview();
    }

    function scheduleRefresh() {
        updateVisibility();
        if (!state.frame && !state.leaving) state.frame = root.requestAnimationFrame(refresh);
    }

    function setGravityEnabled(enabled) {
        const changed = state.gravity !== Boolean(enabled);
        state.gravity = Boolean(enabled);
        if (!state.gravity && changed) releasePreview();
        if (changed) scheduleRefresh();
    }

    function prepareTracking() {
        // 新跟踪流创建前释放独立流，避免手机重复占用同一个摄像头。
        releasePreview();
        state.tracking = true;
        scheduleRefresh();
    }

    function trackingStopped() {
        if (!state.tracking) return;
        state.tracking = false;
        scheduleRefresh();
    }

    function setCalibrationActive(active) {
        const changed = state.calibration !== Boolean(active);
        state.calibration = Boolean(active);
        if (state.calibration && changed) releasePreview();
        if (changed) scheduleRefresh();
    }

    input.addEventListener('change', () => { if (!input.checked) releasePreview(); scheduleRefresh(); });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') releasePreview();
        scheduleRefresh();
    });
    const observer = calibration ? new MutationObserver(() => setCalibrationActive(!calibration.hidden)) : null;
    observer?.observe(calibration, { attributes: true, attributeFilter: ['hidden'] });
    root.addEventListener('pagehide', () => {
        state.leaving = true;
        if (state.frame) root.cancelAnimationFrame(state.frame);
        state.frame = 0;
        releasePreview();
        observer?.disconnect();
    });
    root.addEventListener('pageshow', (event) => {
        if (!event.persisted) return;
        state.leaving = false;
        observer?.observe(calibration, { attributes: true, attributeFilter: ['hidden'] });
        scheduleRefresh();
    });
    root.MmdArGravityCamera = Object.freeze({ setGravityEnabled, prepareTracking, trackingStopped, setCalibrationActive });
    refresh();
})(window);
