'use strict';

// 重力旋转仅注入独立网页副本；每个锚点必须唯一，源代码变化时拒绝静默漏改。
function replaceOnce(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error(`网页重力模式缺少唯一锚点：${anchor.slice(0, 90)}`);
  return source.replace(anchor, replacement);
}

function replaceFunction(source, name, nextName, replacement) {
  const start = source.search(new RegExp(`    (?:async )?function ${name}\\(`));
  const relativeEnd = source.slice(Math.max(0, start)).search(new RegExp(`    (?:async )?function ${nextName}\\(`));
  const end = relativeEnd < 0 ? -1 : start + relativeEnd;
  if (start < 0 || end < 0) throw new Error(`网页重力模式缺少函数边界：${name}`);
  return source.slice(0, start) + replacement + '\n\n' + source.slice(end);
}

function addGravityRuntime(source, moduleUrl = './web-gravity-filter.mjs') {
  let output = replaceOnce(source, '    const rotationState = {', `    // 手动角度和相机坐标中的重力倾斜分别保存，最终只合成角色锚点四元数。
    const manualRotation = { yaw: 0, pitch: 0 };
    const gravityFilter = createGravityFilter(THREE);
    const setModelGravityRotation = (value, force = false) => {
        if (!gravityFilter.setTarget(value, force)) return false;
        rotationState.fitShadowWhenSettled = true;
        startRendering();
        return true;
    };
    const setModelGravitySettings = (value) => {
        const settings = gravityFilter.setSettings(value);
        rotationState.fitShadowWhenSettled = true;
        startRendering();
        return settings;
    };
    const rotationState = {`);
  output = replaceOnce(output,
    '        rotationState.fitShadowWhenSettled = false;\n        physicsGate.paused = false;',
    `        manualRotation.yaw = rotationState.targetYaw;
        manualRotation.pitch = rotationState.targetPitch;
        rotationState.fitShadowWhenSettled = false;
        physicsGate.paused = false;`);
  const begin = output.indexOf('    function updateModelRotation(delta) {');
  const end = output.indexOf('    const clearFallback =', begin);
  if (begin < 0 || end < 0) throw new Error('网页重力模式缺少旋转更新边界');
  output = output.slice(0, begin) + `    function updateModelRotation(delta) {
        if (!currentRotationPivot) return false;
        const previous = currentRotationPivot.quaternion.clone();
        const yawDistance = rotationState.targetYaw - manualRotation.yaw;
        const pitchDistance = rotationState.targetPitch - manualRotation.pitch;
        const manualSettled = Math.abs(yawDistance) < ROTATION_SETTLE_EPSILON
            && Math.abs(pitchDistance) < ROTATION_SETTLE_EPSILON;
        const easing = manualSettled ? 1 : 1 - Math.exp(-ROTATION_EASING_PER_SECOND * delta);
        manualRotation.yaw += yawDistance * easing;
        manualRotation.pitch += pitchDistance * easing;
        const gravityQuaternion = gravityFilter.update(delta);
        const settled = manualSettled && gravityFilter.isSettled();
        const manual = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(manualRotation.pitch, manualRotation.yaw, 0, 'XYZ'));
        // 相机方向已经在本帧更新，倾斜先转到世界坐标，再左乘手动角度。
        const worldGravity = camera.quaternion.clone().multiply(gravityQuaternion)
            .multiply(camera.quaternion.clone().invert());
        currentRotationPivot.quaternion.copy(worldGravity.multiply(manual)).normalize();
        const moved = previous.angleTo(currentRotationPivot.quaternion);
        if (moved > Number.EPSILON) {
            keyLight.shadow.needsUpdate = true;
            fillLight.shadow.needsUpdate = true;
        }
        if (settled && rotationState.fitShadowWhenSettled) {
            rotationState.fitShadowWhenSettled = false;
            currentRotationPivot.updateWorldMatrix(true, true);
            fitShadowCamera(currentRotationPivot);
        }
        // 组合后的实际旋转角进入原物理保护，快速重力倾斜也不能绕过保护。
        return moved;
    }

` + output.slice(end);
  const cameraStart = output.indexOf('        if (arCameraState.active && !arCameraState.trackingLost) {');
  const cameraEnd = output.indexOf('        const firstFramePivot =', cameraStart);
  if (cameraStart < 0 || cameraEnd < 0) throw new Error('网页重力模式缺少相机更新边界');
  const cameraUpdate = output.slice(cameraStart, cameraEnd);
  output = output.slice(0, cameraStart) + output.slice(cameraEnd);
  output = replaceOnce(output, '        const frameHelper = helper.current;', cameraUpdate + '        const frameHelper = helper.current;');
  output = replaceOnce(output, '        rotateModelBy,', `        rotateModelBy,
        setModelGravityRotation,
        setModelGravitySettings,
        getModelGravityState: () => gravityFilter.getState(),`);
  return `import { createGravityFilter } from '${moduleUrl}';\n${output}`;
}

function addGravityDisplay(source) {
  let output = replaceOnce(source, '    function setCameraViewRotation(yaw, pitch) {', `    let modelGravityRotation = [0, 0, 0, 1];
    let modelGravityForce = false;
    let modelGravitySettings = { deadZoneDegrees: 0.5, smoothingMs: 120 };
    function setModelGravityRotation(value, force = false) {
        if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite)
            || Math.hypot(...value) < 1e-9) return false;
        modelGravityRotation = value.slice();
        modelGravityForce = force === true;
        state.runtime?.setModelGravityRotation?.(modelGravityRotation, modelGravityForce);
        return true;
    }

    function setModelGravitySettings(value) {
        modelGravitySettings = { ...modelGravitySettings, ...value };
        state.runtime?.setModelGravitySettings?.(modelGravitySettings);
    }

    function setCameraViewRotation(yaw, pitch) {`);
  output = replaceOnce(output, '                state.runtime.setVisible(state.visible);',
    `                state.runtime.setVisible(state.visible);
                state.runtime.setModelGravitySettings?.(modelGravitySettings);
                state.runtime.setModelGravityRotation?.(modelGravityRotation, modelGravityForce);`);
  return replaceOnce(output, '        setCameraViewRotation,', `        setCameraViewRotation,
        setModelGravityRotation,
        setModelGravitySettings,
        getModelGravityState: () => state.runtime?.getModelGravityState?.() ?? null,`);
}

function addGravityControls(source) {
  let output = replaceOnce(source, "    const MOTION_ORBIT_MODE = 'sensor-orbit-only';", "    const MOTION_ORBIT_MODE = 'gravity-anchor-rotation';");
  output = replaceOnce(output, '        motionListening: false,', '        motionListening: false,\n        motionPending: false,\n        motionRequest: 0,');
  output = replaceOnce(output, 'state.elements.motionEnabled.checked = state.motionEnabled;',
    `state.elements.motionEnabled.checked = state.motionEnabled || state.motionPending;
        root.MmdArGravityCamera?.setGravityEnabled(state.motionEnabled);`);
  output = replaceOnce(output, `        await stopTrackerSession();
        resetTrackedDisplay();
        state.elements.trackingVideo.hidden = true;
        setPanelOpen(false);
        state.calibration = createEmptyCalibration();`,
    `        root.MmdArGravityCamera?.setCalibrationActive(true);
        await stopTrackerSession();
        resetTrackedDisplay();
        state.elements.trackingVideo.hidden = true;
        setPanelOpen(false);
        state.calibration = createEmptyCalibration();`);
  output = replaceOnce(output, 'const rawValues = [event?.alpha, event?.beta, event?.gamma];',
    '// 重力方向由倾斜给出，不需要磁航向 alpha；缺少航向的设备也可使用。\n        const rawValues = [0, event?.beta, event?.gamma];');
  output = replaceFunction(output, 'applyMotionView', 'handleDeviceOrientation', `    function gravityDirection(sample) {
        const vector = [-Math.sin(sample.gamma) * Math.cos(sample.beta),
            Math.sin(sample.beta), Math.cos(sample.gamma) * Math.cos(sample.beta)];
        const angle = Number(root.screen?.orientation?.angle ?? root.orientation ?? 0) || 0;
        return new root.AFRAME.THREE.Vector3(...root.MindBasicImu.rotateForScreen(vector, angle)).normalize();
    }

    function applyMotionView() {
        if (!state.motionEnabled || !state.motionCenter || !state.motionLastSample) return;
        const THREE = root.AFRAME.THREE;
        const from = gravityDirection(state.motionCenter), to = gravityDirection(state.motionLastSample);
        const dot = clamp(from.dot(to), -1, 1);
        let axis = new THREE.Vector3().crossVectors(from, to);
        if (axis.lengthSq() < 1e-8) {
            // 正向平行保持单位旋转；对跖方向选固定参考轴，不用本帧微小噪声决定翻转轴。
            if (dot >= 0) { root.DisplayMmd?.setModelGravityRotation?.([0, 0, 0, 1]); return; }
            axis.crossVectors(from, Math.abs(from.x) < 0.8
                ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1));
        }
        const tilt = Math.acos(dot);
        const rotation = new THREE.Quaternion().setFromAxisAngle(axis.normalize(), tilt);
        root.DisplayMmd?.setModelGravityRotation?.(rotation.toArray());
    }

    function handleGravityCoordinatesChanged() {
        state.motionCenter = null;
        state.motionLastSample = null;
        root.DisplayMmd?.setModelGravityRotation?.([0, 0, 0, 1], true);
        setMotionMessage('等待新的重力方向建立中性姿态，手动旋转保留');
        updateControls();
    }`);
  output = replaceOnce(output, '        if (!state.motionEnabled) return;',
    "        if (!state.motionEnabled || document.visibilityState === 'hidden') return;");
  output = replaceOnce(output, '        root.DisplayMmd?.setCameraViewRotation?.(0, 0);',
    '        root.DisplayMmd?.setModelGravityRotation?.([0, 0, 0, 1], true);');
  output = replaceOnce(output, '        root.DisplayMmd?.resetCameraViewRotation?.();',
    '        root.DisplayMmd?.setModelGravityRotation?.([0, 0, 0, 1], true);');
  output = replaceOnce(output, '        state.motionListening = false;\n        state.motionEnabled = false;',
    `        state.motionRequest += 1;
        state.motionPending = false;
        root.removeEventListener('orientationchange', handleGravityCoordinatesChanged);
        document.removeEventListener('visibilitychange', handleGravityCoordinatesChanged);
        state.motionListening = false;
        state.motionEnabled = false;`);
  output = replaceFunction(output, 'enableMotionView', 'setMotionEnabled', `    async function enableMotionView() {
        if (state.motionEnabled || state.motionPending) return;
        const request = ++state.motionRequest;
        state.motionPending = true;
        updateControls();
        try {
            if (!root.isSecureContext) throw new Error('重力旋转需要 HTTPS 或可信本地页面');
            const OrientationEvent = root.DeviceOrientationEvent;
            if (typeof OrientationEvent === 'undefined') throw new Error('当前浏览器不支持重力倾斜传感器');
            if (typeof OrientationEvent.requestPermission === 'function') {
                const permission = await OrientationEvent.requestPermission();
                if (request !== state.motionRequest) return;
                if (permission !== 'granted') throw new Error('手机姿态传感器权限被拒绝');
            }
            if (request !== state.motionRequest || document.visibilityState === 'hidden') return;
            state.motionPermission = 'granted';
            state.motionMode = MOTION_ORBIT_MODE;
            state.motionCenter = null;
            state.motionLastSample = null;
            root.addEventListener('deviceorientation', handleDeviceOrientation, { passive: true });
            root.addEventListener('orientationchange', handleGravityCoordinatesChanged, { passive: true });
            document.addEventListener('visibilitychange', handleGravityCoordinatesChanged);
            state.motionListening = true;
            state.motionEnabled = true;
            setMotionMessage('等待重力方向，当前姿态将作为中性姿态…');
        } catch (error) {
            if (request === state.motionRequest) throw error;
        } finally {
            if (request === state.motionRequest) { state.motionPending = false; updateControls(); }
        }
    }`);
  // 网页已经移除灵敏度 DOM，必须同时移除原模块的读写与事件，避免空节点中断初始化。
  output = replaceOnce(output, "    const MOTION_SENSITIVITY_KEY = 'aasc.display.mmdAr.motionSensitivity.v1';", '');
  output = replaceOnce(output, '        motionSensitivity: readMotionSensitivity()', '');
  output = replaceOnce(output, "            motionSensitivity: byId('displayArMotionSensitivity'),", '');
  output = replaceOnce(output, "            motionSensitivityValue: byId('displayArMotionSensitivityValue'),", '');
  output = replaceFunction(output, 'readMotionSensitivity', 'saveActiveTargetId', '');
  output = replaceFunction(output, 'updateMotionSensitivity', 'getSelectedTarget', '');
  output = replaceOnce(output, `        state.elements.motionSensitivity.value = String(state.motionSensitivity);
        state.elements.motionSensitivityValue.textContent = state.motionSensitivity.toFixed(2);`, '');
  output = replaceOnce(output, `        elements.motionSensitivity.addEventListener('input', () => {
            updateMotionSensitivity(elements.motionSensitivity.value);
        });`, '');
  return output.replaceAll('当前设备未提供完整六轴姿态数据', '当前设备未提供有效重力倾斜数据')
    .replaceAll('体感观察已启用，当前姿态为中心', '重力旋转已启用，当前姿态为中性姿态；可叠加手动旋转')
    .replaceAll('已重新居中', '重力方向已居中，手动旋转保留')
    .replaceAll('体感观察关闭', '重力旋转关闭，手动旋转保留')
    .replaceAll('体感观察不可用', '重力旋转不可用');
}

module.exports = { addGravityRuntime, addGravityDisplay, addGravityControls };
