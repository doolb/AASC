/* 普通显示页浮动控件；壁纸通过独立系统浮窗复用这些偏好。 */
(function initializeWallpaperControls(root) {
    'use strict';
    const document = root.document;
    const get = id => document.getElementById(id);
    const box = get('wallpaperControls');
    if (!box) return;
    const shield = get('wallpaperInteractionShield');
    const handle = get('wallpaperControlsHandle');
    const panel = get('wallpaperControlsPanel');
    const drag = get('wallpaperControlsDrag');
    const volume = get('wallpaperVolume');
    const volumeValue = get('wallpaperVolumeValue');
    const fps = get('wallpaperShowFps');
    const time = get('wallpaperShowTime');
    const hideOverlay = get('wallpaperOverlayHideOtherApps');
    const contentInteraction = get('wallpaperContentInteraction');
    const hologramModel = get('wallpaperHologramModel');
    const hologramCamera = get('wallpaperHologramCamera');
    const hologramMove = get('wallpaperHologramMove');
    const hologramStatus = get('wallpaperHologramStatus');
    const status = get('wallpaperStatus');
    const clock = get('timeDisplay');
    let active = false;
    let frame = null;
    let gesture = null;
    const readPreference = key => { try { return root.localStorage.getItem(key) !== 'false'; } catch (_) { return true; } };
    const savePreference = (key, value) => { try { root.localStorage.setItem(key, String(value)); } catch (_) {} };
    fps.checked = readPreference('aasc.wallpaper.fps');
    time.checked = readPreference('aasc.wallpaper.time');
    contentInteraction.checked = readPreference('aasc.wallpaper.contentInteraction');
    const readHologram = key => { try { return root.localStorage.getItem(key) === 'true'; } catch (_) { return false; } };
    hologramModel.checked = readHologram('aasc.hologram.model');
    hologramCamera.checked = readHologram('aasc.hologram.camera');
    hologramMove.checked = readHologram('aasc.hologram.move');
    if (hologramCamera.checked && hologramMove.checked) { hologramMove.checked = false; savePreference('aasc.hologram.move', false); }

    let hologramCenter = null;
    let orientationListening = false;
    let motionListening = false;
    let nativeMotion = false;
    let motionFrame = null;
    let lastMotionFrame = null;
    let motionTimeout = null;
    let modelStatus = '', motionStatus = '';
    const renderHologramStatus = () => { if (hologramStatus) hologramStatus.textContent = motionStatus || modelStatus; };
    const estimator = root.createWallpaperMotionEstimator();
    const hologram = { modelYaw: 0, modelPitch: 0, modelX: 0, modelY: 0, cameraX: 0, cameraY: 0 };
    const motion = { ax: 0, ay: 0, vx: 0, vy: 0, sampledAt: 0 };
    const publishHologram = () => root.DisplayMmd?.setHolographicTilt?.({ ...hologram });
    const resetMotion = () => {
        estimator.reset();
        Object.assign(motion, { ax: 0, ay: 0, vx: 0, vy: 0, sampledAt: 0 });
        Object.assign(hologram, { modelX: 0, modelY: 0, cameraX: 0, cameraY: 0 });
        lastMotionFrame = null;
    };
    const resetHologram = () => {
        hologramCenter = null;
        resetMotion();
        Object.assign(hologram, { modelYaw: 0, modelPitch: 0 });
        root.DisplayMmd?.setHolographicTilt?.({});
    };
    function motionTick(now) {
        motionFrame = null;
        if (!motionListening) return;
        const dt = lastMotionFrame === null ? 0 : Math.min(0.05, Math.max(0, (now - lastMotionFrame) / 1000));
        lastMotionFrame = now;
        const fresh = now - motion.sampledAt < 150;
        const damping = Math.exp(-5 * dt);
        motion.vx = (motion.vx + (fresh ? motion.ax : 0) * dt) * damping;
        motion.vy = (motion.vy + (fresh ? motion.ay : 0) * dt) * damping;
        const decay = Math.exp(-15 * dt);
        const xKey = hologramMove.checked ? 'modelX' : 'cameraX';
        const yKey = hologramMove.checked ? 'modelY' : 'cameraY';
        const previousX = hologram[xKey], previousY = hologram[yKey];
        // 角色和镜头共用短时运动与回中，但始终只输出到当前选中的目标。
        hologram[xKey] = Math.max(-0.14, Math.min(0.14, hologram[xKey] * decay + motion.vx * dt * 8.4));
        hologram[yKey] = Math.max(-0.14, Math.min(0.14, hologram[yKey] * decay + motion.vy * dt * 8.4));
        if (Math.abs(hologram[xKey]) < 0.00001 && Math.abs(motion.vx) < 0.00001) hologram[xKey] = 0;
        if (Math.abs(hologram[yKey]) < 0.00001 && Math.abs(motion.vy) < 0.00001) hologram[yKey] = 0;
        if (hologram[xKey] !== previousX || hologram[yKey] !== previousY) publishHologram();
        motionFrame = root.requestAnimationFrame(motionTick);
    }
    function onMotionSample(event) {
        if (!motionListening) return;
        const sample = estimator.sample(event, root.performance.now());
        if (!sample) return;
        const angle = Number(root.screen?.orientation?.angle || root.orientation || 0) * Math.PI / 180;
        const deadzone = value => Math.abs(value) < 0.08 ? 0 : Math.max(-8, Math.min(8, value));
        motion.ax = deadzone(sample[0] * Math.cos(angle) - sample[1] * Math.sin(angle));
        motion.ay = deadzone(sample[1] * Math.cos(angle) + sample[0] * Math.sin(angle));
        motion.sampledAt = root.performance.now();
        if (motionTimeout !== null) { root.clearTimeout(motionTimeout); motionTimeout = null; }
        motionStatus = ''; renderHologramStatus();
    }
    function onNativeMotion(event) {
        if (nativeMotion && active) onMotionSample({ accelerationIncludingGravity: event.detail });
    }
    function onNativeMotionError() {
        if (nativeMotion && active) { motionStatus = '壁纸加速度传感器无法启动'; renderHologramStatus(); }
    }
    const deltaDegrees = (value, center) => ((value - center + 540) % 360) - 180;
    function onHologramSample(event) {
        const sample = event.detail || event;
        if (typeof sample.beta !== 'number' || typeof sample.gamma !== 'number') return;
        const beta = Number(sample.beta), gamma = Number(sample.gamma);
        if (!hologramModel.checked || !Number.isFinite(beta) || !Number.isFinite(gamma)) return;
        if (document.hidden && !active) return;
        if (!hologramCenter) { hologramCenter = { beta, gamma }; return; }
        const angle = Number(root.screen?.orientation?.angle || root.orientation || 0) * Math.PI / 180;
        const pitch = deltaDegrees(beta, hologramCenter.beta), roll = deltaDegrees(gamma, hologramCenter.gamma);
        const x = roll * Math.cos(angle) - pitch * Math.sin(angle);
        const y = pitch * Math.cos(angle) + roll * Math.sin(angle);
        const bounded = value => Math.max(-0.28, Math.min(0.28, value * Math.PI / 180));
        const yaw = bounded(x), tilt = bounded(y);
        hologram.modelYaw = yaw;
        hologram.modelPitch = tilt;
        publishHologram();
        modelStatus = ''; renderHologramStatus();
    }
    function updateHologram() {
        resetHologram();
        if (motionFrame !== null) root.cancelAnimationFrame(motionFrame);
        if (motionTimeout !== null) root.clearTimeout(motionTimeout);
        motionFrame = null;
        motionTimeout = null;
        const visible = !document.hidden || active;
        const enabled = hologramModel.checked && visible;
        const motionEnabled = (hologramCamera.checked || hologramMove.checked) && visible;
        let modelSupported = !enabled;
        const webMotionSupported = typeof root.DeviceMotionEvent !== 'undefined';
        const bridge = root.NativeDisplay?.setWallpaperMotionSensorEnabled;
        nativeMotion = false;
        if (typeof bridge === 'function') {
            try { nativeMotion = root.NativeDisplay.setWallpaperMotionSensorEnabled(active && motionEnabled) === true && active && motionEnabled; } catch (_) {}
        }
        const motionSupported = !motionEnabled || nativeMotion || webMotionSupported;
        root.removeEventListener('devicemotion', onMotionSample);
        motionListening = motionEnabled && motionSupported;
        if (motionListening) {
            if (!nativeMotion) root.addEventListener('devicemotion', onMotionSample, { passive: true });
            motionTimeout = root.setTimeout(() => { motionTimeout = null; if (motionListening) { motionStatus = '未收到手机移动数据，请检查加速度传感器和网页权限'; renderHologramStatus(); } }, 5000);
        }
        if (typeof root.NativeDisplay?.setHolographicSensorEnabled === 'function') {
            try { modelSupported = root.NativeDisplay.setHolographicSensorEnabled(enabled) === true; } catch (_) {}
        } else {
            if (orientationListening) root.removeEventListener('deviceorientation', onHologramSample);
            orientationListening = enabled && typeof root.DeviceOrientationEvent !== 'undefined';
            modelSupported = !enabled || orientationListening;
            if (orientationListening) root.addEventListener('deviceorientation', onHologramSample, { passive: true });
        }
        if (motionListening) motionFrame = root.requestAnimationFrame(motionTick);
        motionStatus = !motionSupported ? '当前页面不支持手机移动传感器' : motionEnabled ? '等待手机移动数据…' : '';
        modelStatus = !modelSupported ? '当前设备没有可用的姿态传感器' : enabled ? '等待设备姿态…' : '';
        renderHologramStatus();
    }

    function updateClockInset() {
        frame = null;
        if (!clock) return;
        clock.style.translate = '';
        if (!active || !time.checked) return;
        let inset = 0;
        try { inset = Math.max(0, Number(root.NativeDisplay?.getWallpaperTopInset?.()) || 0); } catch (_) { return; }
        const overlap = Math.max(0, inset - clock.getBoundingClientRect().top);
        if (overlap) clock.style.translate = `0px ${overlap}px`;
    }
    function scheduleClock() {
        if (frame !== null) return;
        frame = root.requestAnimationFrame(updateClockInset);
    }
    function updateOptions() {
        if (shield) shield.hidden = !active || contentInteraction.checked;
        document.body.classList.toggle('wallpaper-fps-hidden', active && !fps.checked);
        document.body.classList.toggle('wallpaper-time-hidden', active && !time.checked);
        scheduleClock();
    }
    function updateStatus() {
        const text = ['connectionStatus', 'voiceStatus'].map(id => get(id)?.textContent?.trim()).filter(Boolean).join(' · ');
        status.textContent = text || '暂无状态';
    }
    function setExpanded(expanded) {
        panel.hidden = !expanded;
        handle.hidden = expanded;
        handle.setAttribute('aria-expanded', String(expanded));
    }
    function updateMode() {
        try { active = root.NativeDisplay?.isWallpaperActive?.() === true; } catch (_) { active = false; }
        document.body.classList.toggle('is-wallpaper', active);
        const hasSystemOverlay = typeof root.NativeDisplay?.openWallpaperPreview === 'function';
        box.hidden = !root.NativeDisplay || (active && hasSystemOverlay);
        get('wallpaperOpenPreview').hidden = !hasSystemOverlay;
        try {
            hideOverlay.disabled = typeof root.NativeDisplay?.getWallpaperOverlayHideOtherApps !== 'function' || typeof root.NativeDisplay?.setWallpaperOverlayHideOtherApps !== 'function';
            hideOverlay.title = hideOverlay.disabled ? '请更新 Android 应用后使用' : '';
            if (!hideOverlay.disabled) hideOverlay.checked = root.NativeDisplay.getWallpaperOverlayHideOtherApps() !== false;
        } catch (_) { hideOverlay.disabled = true; hideOverlay.title = '无法读取设置'; }
        if (!box.hidden) {
            try {
                const value = Number(root.NativeDisplay?.getWallpaperMediaVolume?.());
                if (Number.isFinite(value)) { volume.value = String(value); volumeValue.textContent = `${value}%`; }
            } catch (_) { volume.disabled = true; }
            updateStatus();
        } else setExpanded(false);
        updateOptions();
        updateHologram();
    }
    handle.addEventListener('click', () => setExpanded(true));
    get('wallpaperOpenPreview').addEventListener('click', () => root.NativeDisplay?.openWallpaperPreview?.());
    get('wallpaperControlsCollapse').addEventListener('click', () => setExpanded(false));
    volume.addEventListener('input', () => {
        const value = Number(volume.value);
        try { root.NativeDisplay?.setWallpaperMediaVolume?.(value); volumeValue.textContent = `${value}%`; } catch (_) { volume.disabled = true; }
    });
    for (const [input, key] of [[fps, 'aasc.wallpaper.fps'], [time, 'aasc.wallpaper.time']]) {
        input.addEventListener('change', () => { savePreference(key, input.checked); updateOptions(); });
    }
    contentInteraction.addEventListener('change', () => {
        savePreference('aasc.wallpaper.contentInteraction', contentInteraction.checked);
        updateOptions();
    });
    hideOverlay.addEventListener('change', () => {
        try {
            root.NativeDisplay.setWallpaperOverlayHideOtherApps(hideOverlay.checked);
            hideOverlay.checked = root.NativeDisplay.getWallpaperOverlayHideOtherApps() !== false;
        } catch (_) { hideOverlay.checked = true; hideOverlay.disabled = true; hideOverlay.title = '无法保存设置'; }
    });
    hologramModel.addEventListener('change', () => { savePreference('aasc.hologram.model', hologramModel.checked); updateHologram(); });
    for (const [input, key, other, otherKey] of [
        [hologramMove, 'aasc.hologram.move', hologramCamera, 'aasc.hologram.camera'],
        [hologramCamera, 'aasc.hologram.camera', hologramMove, 'aasc.hologram.move']
    ]) {
        input.addEventListener('change', () => {
            if (input.checked) { other.checked = false; savePreference(otherKey, false); }
            savePreference(key, input.checked);
            updateHologram();
        });
    }
    root.addEventListener('aasc-native-orientation', onHologramSample);
    root.addEventListener('aasc-native-motion', onNativeMotion);
    root.addEventListener('aasc-native-motion-error', onNativeMotionError);
    root.addEventListener('aasc-native-motion-reset', () => { if (nativeMotion && active) { resetMotion(); publishHologram(); } });
    root.addEventListener('aasc-hologram-visibility', resetHologram);
    root.addEventListener('orientationchange', resetHologram);
    document.addEventListener('visibilitychange', updateHologram);
    // 系统浮窗与前台共用网页本地偏好；只接受预定义的三个开关。
    const options = { fps, time, contentInteraction };
    root.WallpaperControls = {
        snapshot: () => ({ fps: fps.checked, time: time.checked, contentInteraction: contentInteraction.checked, status: status.textContent || '暂无状态' }),
        setOption: (name, value) => {
            const input = options[name];
            if (!input || typeof value !== 'boolean') return;
            input.checked = value;
            input.dispatchEvent(new Event('change'));
        }
    };
    // 关闭壁纸内容交互时在捕获阶段拦截输入；浮动面板始终保留交互能力。
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel']) {
        root.addEventListener(type, event => {
            if (!active || contentInteraction.checked || event.composedPath().includes(box)) return;
            event.stopImmediatePropagation();
            if (event.cancelable) event.preventDefault();
        }, { capture: true, passive: false });
    }
    drag.addEventListener('pointerdown', event => {
        if (event.target.closest('button')) return;
        const rect = box.getBoundingClientRect();
        gesture = { id: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
        drag.setPointerCapture(event.pointerId);
    });
    drag.addEventListener('pointermove', event => {
        if (!gesture || gesture.id !== event.pointerId) return;
        box.style.right = 'auto';
        box.style.left = `${Math.max(0, Math.min(root.innerWidth - box.offsetWidth, event.clientX - gesture.dx))}px`;
        box.style.top = `${Math.max(0, Math.min(root.innerHeight - box.offsetHeight, event.clientY - gesture.dy))}px`;
    });
    const finish = event => {
        if (!gesture || gesture.id !== event.pointerId) return;
        gesture = null;
        const rect = box.getBoundingClientRect();
        const left = rect.left + rect.width / 2 < root.innerWidth / 2;
        box.style.left = left ? '0px' : 'auto';
        box.style.right = left ? 'auto' : '0px';
    };
    drag.addEventListener('pointerup', finish);
    drag.addEventListener('pointercancel', finish);
    root.addEventListener('aasc-wallpaper-mode', updateMode);
    root.addEventListener('aasc-wallpaper-inset', scheduleClock);
    root.addEventListener('resize', scheduleClock);
    if (root.MutationObserver) {
        const observer = new root.MutationObserver(() => { updateStatus(); if (active) scheduleClock(); });
        for (const id of ['connectionStatus', 'voiceStatus']) {
            const element = get(id);
            if (element) observer.observe(element, { childList: true, subtree: true, characterData: true });
        }
        const stage = get('displayStageLayers');
        if (stage) observer.observe(stage, { attributes: true, attributeFilter: ['data-rotation'] });
    }
    updateMode();
})(window);
