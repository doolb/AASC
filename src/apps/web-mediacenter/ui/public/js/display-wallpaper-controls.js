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
    const contentInteraction = get('wallpaperContentInteraction');
    const hologramModel = get('wallpaperHologramModel');
    const hologramCamera = get('wallpaperHologramCamera');
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

    let hologramCenter = null;
    let orientationListening = false;
    const resetHologram = () => { hologramCenter = null; root.DisplayMmd?.setHolographicTilt?.({}); };
    const deltaDegrees = (value, center) => ((value - center + 540) % 360) - 180;
    function onHologramSample(event) {
        const sample = event.detail || event;
        if (typeof sample.beta !== 'number' || typeof sample.gamma !== 'number') return;
        const beta = Number(sample.beta), gamma = Number(sample.gamma);
        if ((!hologramModel.checked && !hologramCamera.checked) || !Number.isFinite(beta) || !Number.isFinite(gamma)) return;
        if (document.hidden && !active) return;
        if (!hologramCenter) { hologramCenter = { beta, gamma }; return; }
        const angle = Number(root.screen?.orientation?.angle || root.orientation || 0) * Math.PI / 180;
        const pitch = deltaDegrees(beta, hologramCenter.beta), roll = deltaDegrees(gamma, hologramCenter.gamma);
        const x = roll * Math.cos(angle) - pitch * Math.sin(angle);
        const y = pitch * Math.cos(angle) + roll * Math.sin(angle);
        const bounded = value => Math.max(-0.14, Math.min(0.14, value * Math.PI / 180 * 0.25));
        const yaw = bounded(x), tilt = bounded(y);
        root.DisplayMmd?.setHolographicTilt?.({ modelYaw: hologramModel.checked ? yaw : 0,
            modelPitch: hologramModel.checked ? tilt : 0, cameraYaw: hologramCamera.checked ? -yaw : 0,
            cameraPitch: hologramCamera.checked ? -tilt : 0 });
        if (hologramStatus) hologramStatus.textContent = '';
    }
    function updateHologram() {
        resetHologram();
        const enabled = hologramModel.checked || hologramCamera.checked;
        if (typeof root.NativeDisplay?.setHolographicSensorEnabled === 'function') {
            let supported = false;
            try { supported = root.NativeDisplay.setHolographicSensorEnabled(enabled && (!document.hidden || active)) === true; } catch (_) {}
            if (hologramStatus) hologramStatus.textContent = enabled ? (supported ? '等待设备姿态…' : '当前设备没有可用的姿态传感器') : '';
            return;
        }
        if (orientationListening) root.removeEventListener('deviceorientation', onHologramSample);
        orientationListening = enabled && !document.hidden && typeof root.DeviceOrientationEvent !== 'undefined';
        if (orientationListening) root.addEventListener('deviceorientation', onHologramSample, { passive: true });
        if (hologramStatus) hologramStatus.textContent = enabled && !orientationListening ? '当前页面没有可用的姿态传感器' : '';
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
    for (const [input, key] of [[hologramModel, 'aasc.hologram.model'], [hologramCamera, 'aasc.hologram.camera']]) {
        input.addEventListener('change', () => { savePreference(key, input.checked); updateHologram(); });
    }
    root.addEventListener('aasc-native-orientation', onHologramSample);
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
