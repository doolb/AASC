/*
 * 显示端图片基准图 AR 控制器。
 *
 * 本模块负责校准弹窗、摄像头生命周期、目标管理和跟踪状态。
 * 图像特征匹配由同源 DisplayMmdImageTargetTracker 完成，原始帧只在显示端处理。
 */
(function exposeDisplayMmdAr(root) {
    'use strict';

    const DB_NAME = 'aasc-mmd-ar';
    const DB_VERSION = 1;
    const TARGET_STORE = 'targets';
    const ACTIVE_TARGET_KEY = 'aasc.display.mmdAr.activeTarget.v1';
    const MOTION_SENSITIVITY_KEY = 'aasc.display.mmdAr.motionSensitivity.v1';
    const MOTION_ORBIT_MODE = 'sensor-orbit-only';
    const MIN_QUAD_AREA = 0.03;
    const MAX_PHYSICAL_WIDTH_MM = 100000;
    const DEG_TO_RAD = Math.PI / 180;
    const STATUS_LABELS = Object.freeze({
        idle: '未启用',
        requestingCamera: '打开摄像头',
        calibrationCapture: '准备拍照',
        selectingRegion: '调整选区',
        compilingTarget: '保存定位图',
        ready: '已准备',
        searching: '寻找中',
        tracking: '定位中',
        lost: '目标丢失',
        stopped: '已停止'
    });

    const state = {
        initialized: false,
        database: null,
        elements: null,
        targets: [],
        selectedTargetId: readActiveTargetId(),
        status: 'idle',
        message: '尚未选择定位图',
        cameraEnabled: true,
        cameraStream: null,
        cameraRequestId: 0,
        cameraReadyCancel: null,
        trackingRequestId: 0,
        trackerSession: null,
        tracking: false,
        trackingFrameHandle: null,
        trackingFrameMode: null,
        calibration: createEmptyCalibration(),
        dragIndex: -1,
        dragPointerId: null,
        motionEnabled: false,
        motionMode: 'off',
        motionPermission: 'unknown',
        motionListening: false,
        motionCenter: null,
        motionLastSample: null,
        motionSensitivity: readMotionSensitivity()
    };
    function byId(id) {
        return document.getElementById(id);
    }
    function getElements() {
        return {
            toggle: byId('displayArTargetToggle'),
            panel: byId('displayArTargetPanel'),
            statusLabel: byId('displayArTargetStatus'),
            select: byId('displayArTargetSelect'),
            name: byId('displayArTargetName'),
            physicalWidth: byId('displayArPhysicalWidth'),
            motionEnabled: byId('displayArMotionEnabled'),
            motionSensitivity: byId('displayArMotionSensitivity'),
            motionSensitivityValue: byId('displayArMotionSensitivityValue'),
            motionRecenter: byId('displayArMotionRecenter'),
            motionMessage: byId('displayArMotionMessage'),
            calibrationButton: byId('displayArCalibrationButton'),
            startButton: byId('displayArStartButton'),
            stopButton: byId('displayArStopButton'),
            deleteButton: byId('displayArDeleteButton'),
            message: byId('displayArTargetMessage'),
            calibration: byId('displayArCalibration'),
            trackingVideo: byId('displayArTrackingVideo'),
            cameraVideo: byId('displayArCameraVideo'),
            calibrationCanvas: byId('displayArCalibrationCanvas'),
            calibrationHint: byId('displayArCalibrationHint'),
            captureButton: byId('displayArCaptureButton'),
            saveButton: byId('displayArSaveButton'),
            cancelButton: byId('displayArCancelButton')
        };
    }
    function createEmptyCalibration() {
        return {
            sourceCanvas: null,
            imageBlob: null,
            selectedQuad: createDefaultQuad()
        };
    }
    function createDefaultQuad() {
        return [
            { x: 0.15, y: 0.15 },
            { x: 0.85, y: 0.15 },
            { x: 0.85, y: 0.85 },
            { x: 0.15, y: 0.85 }
        ];
    }
    function cloneQuad(points) {
        return (Array.isArray(points) ? points : createDefaultQuad()).map((point) => ({
            x: clamp(Number(point?.x), 0, 1),
            y: clamp(Number(point?.y), 0, 1)
        }));
    }
    function clamp(value, min, max) {
        if (!Number.isFinite(value)) return min;
        return Math.min(max, Math.max(min, value));
    }
    function readActiveTargetId() {
        try {
            return root.localStorage?.getItem(ACTIVE_TARGET_KEY) || '';
        } catch (error) {
            console.warn('[显示端 AR] 读取当前定位图失败:', error);
            return '';
        }
    }
    function readMotionSensitivity() {
        try {
            const value = Number(root.localStorage?.getItem(MOTION_SENSITIVITY_KEY));
            return Number.isFinite(value) ? clamp(value, 0.25, 2) : 1;
        } catch (error) {
            console.warn('[显示端 AR] 读取体感灵敏度失败:', error);
            return 1;
        }
    }
    function saveMotionSensitivity(value) {
        try {
            root.localStorage?.setItem(MOTION_SENSITIVITY_KEY, String(value));
        } catch (error) {
            console.warn('[显示端 AR] 保存体感灵敏度失败:', error);
        }
    }
    function saveActiveTargetId(targetId) {
        try {
            if (targetId) {
                root.localStorage?.setItem(ACTIVE_TARGET_KEY, targetId);
            } else {
                root.localStorage?.removeItem(ACTIVE_TARGET_KEY);
            }
        } catch (error) {
            console.warn('[显示端 AR] 保存当前定位图失败:', error);
        }
    }

    function setPanelOpen(open) {
        if (!state.elements) return;
        const nextOpen = open === true;
        state.elements.panel.hidden = !nextOpen;
        state.elements.toggle.setAttribute('aria-expanded', String(nextOpen));
    }

    function setStatus(status, message) {
        state.status = STATUS_LABELS[status] ? status : 'idle';
        state.message = message || STATUS_LABELS[state.status];
        if (!state.elements) return;
        const { statusLabel, message: messageElement, toggle } = state.elements;
        statusLabel.textContent = STATUS_LABELS[state.status];
        messageElement.textContent = state.message;
        if (!state.elements.calibration.hidden && /失败|拒绝|未找到|占用|尚未准备/u.test(state.message)) {
            state.elements.calibrationHint.textContent = state.message;
        }
        toggle.textContent = state.status === 'tracking' || state.status === 'searching'
            ? '定位中'
            : state.status === 'lost'
                ? '重新定位'
                : '定位';
        updateControls();
    }

    function updateControls() {
        if (!state.elements) return;
        const selected = getSelectedTarget();
        const hasTarget = !!selected;
        state.elements.calibrationButton.disabled = !state.cameraEnabled;
        state.elements.startButton.disabled = !state.cameraEnabled || !hasTarget || state.tracking;
        state.elements.stopButton.disabled = !state.tracking && !state.cameraStream;
        state.elements.deleteButton.disabled = !hasTarget || state.tracking;
        state.elements.saveButton.disabled = !state.calibration.sourceCanvas
            || !isValidQuad(state.calibration.selectedQuad);
        state.elements.motionEnabled.checked = state.motionEnabled;
        state.elements.motionSensitivity.value = String(state.motionSensitivity);
        state.elements.motionSensitivityValue.textContent = state.motionSensitivity.toFixed(2);
        state.elements.motionRecenter.disabled = !state.motionLastSample;
    }

    function setMotionMessage(message) {
        if (state.elements?.motionMessage) state.elements.motionMessage.textContent = message;
    }

    function normalizeAngle(angle) {
        return Math.atan2(Math.sin(angle), Math.cos(angle));
    }

    function readMotionSample(event) {
        const rawValues = [event?.alpha, event?.beta, event?.gamma];
        if (!rawValues.every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
        const [alpha, beta, gamma] = rawValues;
        return {
            alpha: alpha * DEG_TO_RAD,
            beta: beta * DEG_TO_RAD,
            gamma: gamma * DEG_TO_RAD
        };
    }

    function applyMotionView() {
        if (!state.motionEnabled || !state.motionCenter || !state.motionLastSample) return;
        const yaw = normalizeAngle(state.motionLastSample.alpha - state.motionCenter.alpha)
            * state.motionSensitivity;
        const pitch = clamp(
            (state.motionLastSample.beta - state.motionCenter.beta) * state.motionSensitivity,
            -Math.PI / 4,
            Math.PI / 4
        );
        // 独立体感模式只提交 yaw/pitch 环绕角度；runtime 内部保持固定 cameraDistance，
        // 不接收距离、位移、变焦或滚转参数，不调用 rotateModelBy 改变角色自身朝向。
        root.DisplayMmd?.setCameraViewRotation?.(yaw, pitch);
    }

    function handleDeviceOrientation(event) {
        if (!state.motionEnabled) return;
        const sample = readMotionSample(event);
        if (!sample) {
            setMotionMessage('当前设备未提供完整六轴姿态数据');
            return;
        }
        state.motionLastSample = sample;
        if (!state.motionCenter) {
            state.motionCenter = { ...sample };
            setMotionMessage('体感观察已启用，当前姿态为中心');
        }
        applyMotionView();
        updateControls();
    }

    function recenterMotionView() {
        if (!state.motionLastSample) {
            setMotionMessage('尚未收到传感器数据，请先移动手机或稍候');
            return;
        }
        state.motionCenter = { ...state.motionLastSample };
        root.DisplayMmd?.setCameraViewRotation?.(0, 0);
        setMotionMessage('已重新居中');
        updateControls();
    }

    function disableMotionView() {
        if (state.motionListening) {
            root.removeEventListener('deviceorientation', handleDeviceOrientation);
        }
        state.motionListening = false;
        state.motionEnabled = false;
        state.motionMode = 'off';
        state.motionCenter = null;
        state.motionLastSample = null;
        root.DisplayMmd?.resetCameraViewRotation?.();
        setMotionMessage('体感观察关闭');
        updateControls();
    }

    async function enableMotionView() {
        const OrientationEvent = root.DeviceOrientationEvent;
        if (typeof OrientationEvent === 'undefined') {
            throw new Error('当前浏览器不支持手机姿态传感器');
        }
        if (typeof OrientationEvent.requestPermission === 'function') {
            const permission = await OrientationEvent.requestPermission();
            if (permission !== 'granted') throw new Error('手机姿态传感器权限被拒绝');
        }
        state.motionPermission = 'granted';
        // 体感观察是独立于图片定位的相机环绕模式，不要求目标、摄像头或识别会话。
        state.motionMode = MOTION_ORBIT_MODE;
        state.motionCenter = null;
        state.motionLastSample = null;
        root.addEventListener('deviceorientation', handleDeviceOrientation, { passive: true });
        state.motionListening = true;
        state.motionEnabled = true;
        setMotionMessage('请保持当前姿态，等待传感器数据…');
        updateControls();
    }

    async function setMotionEnabled(enabled) {
        if (!enabled) {
            disableMotionView();
            return;
        }
        try {
            await enableMotionView();
        } catch (error) {
            state.motionPermission = error.message.includes('权限') ? 'denied' : 'unsupported';
            state.elements.motionEnabled.checked = false;
            disableMotionView();
            setMotionMessage(error.message || '体感观察不可用');
        }
    }

    function updateMotionSensitivity(value) {
        state.motionSensitivity = clamp(Number(value), 0.25, 2);
        saveMotionSensitivity(state.motionSensitivity);
        applyMotionView();
        updateControls();
    }

    function getSelectedTarget() {
        return state.targets.find((target) => target.targetId === state.selectedTargetId) || null;
    }

    function normalizeTarget(target) {
        if (!target || typeof target !== 'object' || typeof target.targetId !== 'string') return null;
        return {
            ...target,
            selectedQuad: cloneQuad(target.selectedQuad),
            modelCalibration: target.modelCalibration || {
                anchor: 'feet',
                offset: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                scale: 1,
                mirror: false
            }
        };
    }

    function requestToPromise(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('IndexedDB 请求失败'));
        });
    }

    function transactionToPromise(transaction) {
        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error || new Error('IndexedDB 事务失败'));
            transaction.onabort = () => reject(transaction.error || new Error('IndexedDB 事务已中止'));
        });
    }

    function openDatabase() {
        if (!root.indexedDB) throw new Error('当前浏览器不支持 IndexedDB');
        return new Promise((resolve, reject) => {
            const request = root.indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const database = request.result;
                if (database.objectStoreNames.contains(TARGET_STORE)) return;
                const store = database.createObjectStore(TARGET_STORE, { keyPath: 'targetId' });
                store.createIndex('updatedAt', 'updatedAt', { unique: false });
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('无法打开 AR 数据库'));
        });
    }

    async function loadTargets() {
        state.database = state.database || await openDatabase();
        const transaction = state.database.transaction(TARGET_STORE, 'readonly');
        const records = await requestToPromise(transaction.objectStore(TARGET_STORE).getAll());
        state.targets = records
            .map(normalizeTarget)
            .filter(Boolean)
            .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
        if (!getSelectedTarget()) {
            state.selectedTargetId = state.targets[0]?.targetId || '';
            saveActiveTargetId(state.selectedTargetId);
        }
        renderTargetSelect();
        const selected = getSelectedTarget();
        setStatus(
            selected ? 'ready' : 'idle',
            selected
                ? '定位图已保存，可以开始定位'
                : '尚未选择定位图'
        );
    }

    async function saveTarget(target) {
        state.database = state.database || await openDatabase();
        const transaction = state.database.transaction(TARGET_STORE, 'readwrite');
        const completion = transactionToPromise(transaction);
        transaction.objectStore(TARGET_STORE).put(target);
        await completion;
    }

    async function deleteTarget(targetId) {
        state.database = state.database || await openDatabase();
        const transaction = state.database.transaction(TARGET_STORE, 'readwrite');
        const completion = transactionToPromise(transaction);
        transaction.objectStore(TARGET_STORE).delete(targetId);
        await completion;
    }

    function renderTargetSelect() {
        const select = state.elements.select;
        select.replaceChildren();
        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = state.targets.length ? '请选择定位图' : '暂无定位图';
        select.appendChild(emptyOption);
        for (const target of state.targets) {
            const option = document.createElement('option');
            option.value = target.targetId;
            option.textContent = target.name || '未命名定位图';
            select.appendChild(option);
        }
        select.value = state.selectedTargetId;
        const selected = getSelectedTarget();
        state.elements.name.value = selected?.name || '';
        state.elements.physicalWidth.value = selected?.physicalWidthMm || '';
        updateControls();
    }

    function setSelectedTarget(targetId) {
        state.selectedTargetId = state.targets.some((target) => target.targetId === targetId) ? targetId : '';
        saveActiveTargetId(state.selectedTargetId);
        renderTargetSelect();
    }

    function createTargetId() {
        if (typeof root.crypto?.randomUUID === 'function') return root.crypto.randomUUID();
        return `ar-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    function polygonArea(points) {
        let sum = 0;
        for (let index = 0; index < points.length; index += 1) {
            const current = points[index];
            const next = points[(index + 1) % points.length];
            sum += current.x * next.y - next.x * current.y;
        }
        return Math.abs(sum) / 2;
    }

    function cross(previous, current, next) {
        return (current.x - previous.x) * (next.y - current.y)
            - (current.y - previous.y) * (next.x - current.x);
    }

    function isValidQuad(points) {
        if (!Array.isArray(points) || points.length !== 4) return false;
        if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)
            || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) return false;
        if (polygonArea(points) < MIN_QUAD_AREA) return false;
        const turns = points.map((point, index) => cross(
            points[(index + 3) % 4],
            point,
            points[(index + 1) % 4]
        ));
        return turns.every((turn) => turn > 0) || turns.every((turn) => turn < 0);
    }

    function getCanvasPoint(event) {
        const canvas = state.elements.calibrationCanvas;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        return {
            x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
            y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
        };
    }

    function drawCalibrationCanvas() {
        const source = state.calibration.sourceCanvas;
        const canvas = state.elements.calibrationCanvas;
        if (!source || !canvas) return;
        canvas.width = source.width;
        canvas.height = source.height;
        const context = canvas.getContext('2d');
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(source, 0, 0);
        const points = state.calibration.selectedQuad.map((point) => ({
            x: point.x * canvas.width,
            y: point.y * canvas.height
        }));
        context.save();
        context.fillStyle = 'rgba(20, 160, 255, 0.16)';
        context.strokeStyle = '#3da9ff';
        context.lineWidth = Math.max(3, canvas.width / 360);
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        for (const point of points.slice(1)) context.lineTo(point.x, point.y);
        context.closePath();
        context.fill();
        context.stroke();
        context.fillStyle = '#ffffff';
        context.strokeStyle = '#0867a8';
        for (const point of points) {
            context.beginPath();
            context.arc(point.x, point.y, Math.max(10, canvas.width / 45), 0, Math.PI * 2);
            context.fill();
            context.stroke();
        }
        context.restore();
    }

    function findQuadHandle(point) {
        const threshold = 0.08;
        let nearestIndex = -1;
        let nearestDistance = Number.POSITIVE_INFINITY;
        state.calibration.selectedQuad.forEach((handle, index) => {
            const distance = Math.hypot(handle.x - point.x, handle.y - point.y);
            if (distance <= threshold && distance < nearestDistance) {
                nearestDistance = distance;
                nearestIndex = index;
            }
        });
        return nearestIndex;
    }

    function handleCalibrationPointerDown(event) {
        const point = getCanvasPoint(event);
        if (!point) return;
        const handleIndex = findQuadHandle(point);
        if (handleIndex < 0) return;
        event.preventDefault();
        state.dragIndex = handleIndex;
        state.dragPointerId = event.pointerId;
        state.elements.calibrationCanvas.setPointerCapture?.(event.pointerId);
    }

    function handleCalibrationPointerMove(event) {
        if (state.dragIndex < 0 || state.dragPointerId !== event.pointerId) return;
        const point = getCanvasPoint(event);
        if (!point) return;
        event.preventDefault();
        state.calibration.selectedQuad[state.dragIndex] = point;
        drawCalibrationCanvas();
        const valid = isValidQuad(state.calibration.selectedQuad);
        state.elements.calibrationHint.textContent = valid
            ? '选区有效，可以保存定位图。'
            : '选区面积过小或四边形无效，请调整四个角点。';
        state.elements.saveButton.disabled = !valid;
    }

    function finishCalibrationPointer(event) {
        if (state.dragPointerId !== event.pointerId) return;
        state.elements.calibrationCanvas.releasePointerCapture?.(event.pointerId);
        state.dragIndex = -1;
        state.dragPointerId = null;
    }

    function canvasToBlob(canvas) {
        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error('无法生成定位图图片'));
                }
            }, 'image/jpeg', 0.92);
        });
    }

    function cameraErrorMessage(error) {
        if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
            return '摄像头权限被拒绝，请允许当前页面使用摄像头。';
        }
        if (error?.name === 'NotFoundError') return '未找到可用摄像头。';
        if (error?.name === 'NotReadableError') return '摄像头正在被其他程序占用。';
        return `摄像头启动失败：${error?.message || '未知错误'}`;
    }

    async function startCamera() {
        if (!state.cameraEnabled) throw new Error('显示端摄像头能力已关闭');
        const requestId = ++state.cameraRequestId;
        const video = state.elements.calibration.hidden
            ? state.elements.trackingVideo
            : state.elements.cameraVideo;
        if (state.cameraStream?.active) {
            state.elements.cameraVideo.srcObject = state.cameraStream;
            state.elements.trackingVideo.srcObject = state.cameraStream;
            await video.play();
            return;
        }
        if (!root.navigator?.mediaDevices?.getUserMedia) {
            throw new Error('当前浏览器不支持摄像头访问');
        }
        setStatus('requestingCamera', '正在请求后置摄像头权限…');
        const stream = await root.navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
        });
        if (requestId !== state.cameraRequestId || !state.cameraEnabled) {
            for (const track of stream.getTracks()) track.stop();
            return;
        }
        state.cameraStream = stream;
        state.elements.cameraVideo.srcObject = stream;
        state.elements.trackingVideo.srcObject = stream;
        try {
            await new Promise((resolve) => {
                const finish = () => {
                    video.removeEventListener('loadedmetadata', finish);
                    if (state.cameraReadyCancel === finish) state.cameraReadyCancel = null;
                    resolve();
                };
                if (video.readyState >= 1) {
                    finish();
                    return;
                }
                state.cameraReadyCancel = finish;
                video.addEventListener('loadedmetadata', finish, { once: true });
            });
            if (requestId !== state.cameraRequestId || !state.cameraEnabled) {
                stopCamera();
                return;
            }
            await video.play();
        } catch (error) {
            stopCamera();
            throw error;
        }
    }

    function stopCamera() {
        state.cameraRequestId += 1;
        if (state.cameraReadyCancel) state.cameraReadyCancel();
        if (state.cameraStream) {
            for (const track of state.cameraStream.getTracks()) track.stop();
        }
        state.cameraStream = null;
        if (state.elements?.cameraVideo) state.elements.cameraVideo.srcObject = null;
        if (state.elements?.trackingVideo) {
            state.elements.trackingVideo.srcObject = null;
            state.elements.trackingVideo.hidden = true;
        }
        updateControls();
    }

    async function beginCalibration() {
        if (!state.cameraEnabled) {
            setStatus('stopped', '摄像头已关闭');
            return;
        }
        await stopTrackerSession();
        root.DisplayMmd?.resetArPose?.();
        state.elements.trackingVideo.hidden = true;
        setPanelOpen(false);
        state.calibration = createEmptyCalibration();
        state.elements.calibration.hidden = false;
        state.elements.cameraVideo.hidden = false;
        state.elements.calibrationCanvas.hidden = true;
        state.elements.captureButton.hidden = false;
        state.elements.saveButton.disabled = true;
        state.elements.calibrationHint.textContent = '先拍摄当前画面，再拖动四个角点框选定位区域。';
        try {
            await startCamera();
            if (state.elements.calibration.hidden) return;
            setStatus('calibrationCapture', '摄像头已准备，可以拍照');
        } catch (error) {
            if (state.elements.calibration.hidden) return;
            state.elements.calibration.hidden = false;
            setStatus('stopped', cameraErrorMessage(error));
        }
    }

    async function capturePhoto() {
        const video = state.elements.cameraVideo;
        if (!video.videoWidth || !video.videoHeight) {
            setStatus('calibrationCapture', '摄像头画面尚未准备好，请稍候再试');
            return;
        }
        const sourceCanvas = document.createElement('canvas');
        sourceCanvas.width = video.videoWidth;
        sourceCanvas.height = video.videoHeight;
        const context = sourceCanvas.getContext('2d');
        context.drawImage(video, 0, 0, sourceCanvas.width, sourceCanvas.height);
        state.calibration.sourceCanvas = sourceCanvas;
        state.calibration.imageBlob = await canvasToBlob(sourceCanvas);
        state.calibration.selectedQuad = createDefaultQuad();
        state.elements.cameraVideo.hidden = true;
        state.elements.calibrationCanvas.hidden = false;
        state.elements.captureButton.hidden = true;
        drawCalibrationCanvas();
        state.elements.calibrationHint.textContent = '拖动四个白色角点选择定位区域。';
        setStatus('selectingRegion', '请调整四个角点后保存');
    }

    async function saveCalibrationTarget() {
        const { sourceCanvas, imageBlob, selectedQuad } = state.calibration;
        if (!sourceCanvas || !imageBlob) {
            setStatus('calibrationCapture', '请先拍摄当前画面');
            return;
        }
        if (!isValidQuad(selectedQuad)) {
            setStatus('selectingRegion', '当前选区无效，请扩大区域或调整四个角点');
            return;
        }
        const width = Number(state.elements.physicalWidth.value);
        const physicalWidthMm = Number.isFinite(width) && width > 0 && width <= MAX_PHYSICAL_WIDTH_MM
            ? Math.round(width)
            : null;
        const now = Date.now();
        const target = {
            targetId: createTargetId(),
            name: state.elements.name.value.trim() || `定位图 ${new Date(now).toLocaleString()}`,
            referenceImageBlob: imageBlob,
            selectedQuad: cloneQuad(selectedQuad),
            compiledTargetData: null,
            physicalWidthMm,
            modelCalibration: {
                anchor: 'feet',
                offset: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                scale: 1,
                mirror: false
            },
            createdAt: now,
            updatedAt: now
        };
        try {
            setStatus('compilingTarget', '正在保存定位图…');
            await saveTarget(target);
            state.targets = [target, ...state.targets];
            setSelectedTarget(target.targetId);
            state.calibration = createEmptyCalibration();
            state.elements.calibration.hidden = true;
            stopCamera();
            setStatus('ready', '定位图已保存，可以开始定位');
        } catch (error) {
            console.error('[显示端 AR] 保存定位图失败:', error);
            setStatus('selectingRegion', `保存失败：${error.message || 'IndexedDB 不可用'}`);
        }
    }

    async function switchTarget(targetId) {
        const nextTarget = state.targets.find((target) => target.targetId === targetId);
        if (!nextTarget) {
            if (state.tracking) await stopAr();
            setSelectedTarget('');
            setStatus('idle', '尚未选择定位图');
            return;
        }
        const previousTarget = getSelectedTarget();
        const wasTracking = state.tracking;
        if (wasTracking) await stopTrackerSession();
        setSelectedTarget(targetId);
        if (!wasTracking) {
            setStatus('ready', '已切换定位图，可以开始定位');
            return;
        }
        const started = await startTracking(nextTarget, true);
        if (started) return;
        if (previousTarget) {
            setSelectedTarget(previousTarget.targetId);
            await startTracking(previousTarget, true);
            setStatus('ready', '切换失败，已恢复原定位图');
        }
    }

    function cancelTrackingFrame() {
        if (state.trackingFrameHandle === null) return;
        if (state.trackingFrameMode === 'video' && typeof state.elements.trackingVideo.cancelVideoFrameCallback === 'function') {
            state.elements.trackingVideo.cancelVideoFrameCallback(state.trackingFrameHandle);
        } else {
            clearTimeout(state.trackingFrameHandle);
        }
        state.trackingFrameHandle = null;
        state.trackingFrameMode = null;
    }

    async function stopTrackerSession() {
        state.trackingRequestId += 1;
        cancelTrackingFrame();
        const session = state.trackerSession;
        state.trackerSession = null;
        state.tracking = false;
        if (session && typeof session.stop === 'function') {
            try {
                await session.stop();
            } catch (error) {
                console.warn('[显示端 AR] 停止识别会话失败:', error);
            }
        }
    }

    function scheduleTrackingFrame() {
        if (!state.tracking || !state.trackerSession) return;
        const video = state.elements.trackingVideo;
        if (typeof video.requestVideoFrameCallback === 'function') {
            state.trackingFrameMode = 'video';
            state.trackingFrameHandle = video.requestVideoFrameCallback((timestamp) => {
                state.trackingFrameHandle = null;
                void processTrackingFrame(timestamp).finally(scheduleTrackingFrame);
            });
            return;
        }
        state.trackingFrameMode = 'timer';
        state.trackingFrameHandle = setTimeout(() => {
            state.trackingFrameHandle = null;
            void processTrackingFrame(performance.now()).finally(scheduleTrackingFrame);
        }, 80);
    }

    async function processTrackingFrame(timestamp) {
        const session = state.trackerSession;
        if (!state.tracking || !session || typeof session.processFrame !== 'function') return;
        let result;
        try {
            result = await session.processFrame(state.elements.trackingVideo, timestamp);
        } catch (error) {
            console.error('[显示端 AR] 识别当前帧失败:', error);
            setStatus(session.hasLocated ? 'lost' : 'searching', `识别暂时中断：${error.message || '请保持镜头稳定'}`);
            return;
        }
        if (!state.tracking || session !== state.trackerSession) return;
        if (result?.visible) {
            session.hasLocated = true;
            setStatus('tracking', `定位中 · 置信度 ${Math.round(clamp(Number(result.confidence) || 0, 0, 1) * 100)}%`);
            if (result.pose && typeof root.DisplayMmd?.setArPose === 'function') {
                const video = state.elements.trackingVideo;
                const pose = root.DisplayMmdImageTargetTracker.mapPoseToCover(
                    result.pose, video, byId('displayStageLayers')
                );
                root.DisplayMmd.setArPose(pose, getSelectedTarget()?.modelCalibration);
            }
        } else {
            const hints = {
                cameraNotReady: '正在等待摄像头画面',
                lowTexture: '画面细节不足，请增加光线或选择细节丰富的定位图',
                insufficientMatches: '未匹配到定位图，请靠近并将图片摆正',
                unstableGeometry: '定位图位置不稳定，请保持镜头平稳'
            };
            const message = hints[result?.reason] || '正在寻找定位图，请将基准图置于画面中央';
            setStatus(session.hasLocated ? 'lost' : 'searching', message);
        }
    }

    async function startTracking(target = getSelectedTarget(), keepCamera = false) {
        if (!state.cameraEnabled) {
            setStatus('stopped', '摄像头已关闭');
            return false;
        }
        if (!target) {
            setStatus('idle', '请先拍照保存定位图');
            return false;
        }
        const mmdState = root.DisplayMmd?.getState?.();
        if (!mmdState?.visible || !mmdState.modelReady) {
            setStatus('ready', '请先显示并等待角色模型加载完成');
            return false;
        }
        const tracker = root.DisplayMmdImageTargetTracker;
        if (!tracker || typeof tracker.start !== 'function') {
            setStatus('ready', '定位图已保存；当前识别引擎尚未接入');
            return false;
        }
        const requestId = ++state.trackingRequestId;
        try {
            state.elements.calibration.hidden = true;
            if (!state.cameraStream) await startCamera();
            if (requestId !== state.trackingRequestId) return false;
            if (!state.cameraStream) throw new Error('摄像头已关闭');
            state.elements.trackingVideo.hidden = false;
            await state.elements.trackingVideo.play();
            if (requestId !== state.trackingRequestId || !state.cameraEnabled || !state.cameraStream) {
                return false;
            }
            const session = await tracker.start(
                {
                    targetId: target.targetId,
                    referenceImageBlob: target.referenceImageBlob,
                    selectedQuad: target.selectedQuad,
                    compiledTargetData: target.compiledTargetData
                },
                { video: state.elements.trackingVideo, facingMode: 'environment' }
            );
            if (requestId !== state.trackingRequestId) {
                await session.stop?.();
                return false;
            }
            state.trackerSession = session;
            state.tracking = true;
            setPanelOpen(false);
            setStatus('searching', '正在寻找定位图，请将基准图置于画面中央');
            scheduleTrackingFrame();
            return true;
        } catch (error) {
            if (requestId !== state.trackingRequestId) return false;
            await stopTrackerSession();
            state.elements.trackingVideo.hidden = true;
            if (!keepCamera) stopCamera();
            console.error('[显示端 AR] 启动识别失败:', error);
            setStatus('ready', `识别引擎启动失败：${error.message || '未知错误'}`);
            return false;
        }
    }

    async function stopAr() {
        stopCamera();
        await stopTrackerSession();
        root.DisplayMmd?.resetArPose?.();
        disableMotionView();
        if (state.elements?.calibration) state.elements.calibration.hidden = true;
        state.calibration = createEmptyCalibration();
        if (state.status !== 'idle') setStatus('stopped', '定位已停止');
    }

    async function setCameraEnabled(enabled) {
        // 远端关闭时先释放视频轨道并作废异步请求，再等待识别器退出，防止迟到的流继续被使用。
        const nextEnabled = enabled === true;
        if (state.cameraEnabled === nextEnabled) {
            updateControls();
            return nextEnabled;
        }
        state.cameraEnabled = nextEnabled;
        if (!state.cameraEnabled) {
            stopCamera();
            await stopTrackerSession();
            root.DisplayMmd?.resetArPose?.();
            if (state.elements?.calibration) state.elements.calibration.hidden = true;
            if (state.elements?.trackingVideo) state.elements.trackingVideo.hidden = true;
            state.calibration = createEmptyCalibration();
            setStatus('stopped', '摄像头已关闭');
            return false;
        }
        setStatus(getSelectedTarget() ? 'ready' : 'idle', '摄像头已启用');
        updateControls();
        return true;
    }

    async function deleteSelectedTarget() {
        const target = getSelectedTarget();
        if (!target || state.tracking) return;
        if (typeof root.confirm === 'function' && !root.confirm(`确认删除定位图“${target.name}”？`)) return;
        try {
            await deleteTarget(target.targetId);
            state.targets = state.targets.filter((item) => item.targetId !== target.targetId);
            state.selectedTargetId = state.targets[0]?.targetId || '';
            saveActiveTargetId(state.selectedTargetId);
            renderTargetSelect();
            setStatus(
                state.selectedTargetId ? 'ready' : 'idle',
                state.selectedTargetId ? '已切换到下一张定位图' : '尚未选择定位图'
            );
        } catch (error) {
            console.error('[显示端 AR] 删除定位图失败:', error);
            setStatus('ready', `删除失败：${error.message || 'IndexedDB 不可用'}`);
        }
    }

    function bindEvents() {
        const { elements } = state;
        elements.toggle.addEventListener('click', (event) => {
            event.stopPropagation();
            root.DisplayMmdLighting?.close?.();
            setPanelOpen(elements.panel.hidden);
        });
        elements.panel.addEventListener('click', (event) => event.stopPropagation());
        elements.select.addEventListener('change', () => {
            void switchTarget(elements.select.value);
        });
        elements.motionEnabled.addEventListener('change', () => {
            void setMotionEnabled(elements.motionEnabled.checked);
        });
        elements.motionSensitivity.addEventListener('input', () => {
            updateMotionSensitivity(elements.motionSensitivity.value);
        });
        elements.motionRecenter.addEventListener('click', recenterMotionView);
        elements.calibrationButton.addEventListener('click', () => {
            void beginCalibration();
        });
        elements.captureButton.addEventListener('click', () => {
            void capturePhoto().catch((error) => {
                console.error('[显示端 AR] 拍照失败:', error);
                setStatus('calibrationCapture', `拍照失败：${error.message || '未知错误'}`);
            });
        });
        elements.saveButton.addEventListener('click', () => {
            void saveCalibrationTarget();
        });
        elements.cancelButton.addEventListener('click', () => {
            state.calibration = createEmptyCalibration();
            elements.calibration.hidden = true;
            stopCamera();
            setStatus(getSelectedTarget() ? 'ready' : 'idle', getSelectedTarget()
                ? '已取消校准'
                : '尚未选择定位图');
        });
        elements.startButton.addEventListener('click', () => {
            void startTracking();
        });
        elements.stopButton.addEventListener('click', () => {
            void stopAr();
        });
        elements.deleteButton.addEventListener('click', () => {
            void deleteSelectedTarget();
        });
        elements.calibrationCanvas.addEventListener('pointerdown', handleCalibrationPointerDown);
        elements.calibrationCanvas.addEventListener('pointermove', handleCalibrationPointerMove);
        elements.calibrationCanvas.addEventListener('pointerup', finishCalibrationPointer);
        elements.calibrationCanvas.addEventListener('pointercancel', finishCalibrationPointer);
        document.addEventListener('click', () => setPanelOpen(false));
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !elements.calibration.hidden) {
                elements.cancelButton.click();
            } else if (event.key === 'Escape') {
                setPanelOpen(false);
            }
        });
        root.addEventListener('pagehide', () => {
            void stopAr();
        }, { once: true });
        root.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') void stopAr();
        });
    }

    async function initialize() {
        if (state.initialized) return;
        state.elements = getElements();
        if (Object.values(state.elements).some((element) => !element)) return;
        state.initialized = true;
        bindEvents();
        setStatus('idle', '正在读取本地定位图…');
        try {
            await loadTargets();
        } catch (error) {
            console.error('[显示端 AR] 读取定位图失败:', error);
            setStatus('stopped', `本地定位图不可用：${error.message || 'IndexedDB 不可用'}`);
        }
    }

    root.DisplayMmdAr = Object.freeze({
        closePanel: () => setPanelOpen(false),
        setCameraEnabled,
        getState: () => ({
            status: state.status,
            selectedTargetId: state.selectedTargetId,
            targetCount: state.targets.length,
            tracking: state.tracking,
            cameraEnabled: state.cameraEnabled
        }),
        initialize,
        stop: stopAr
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            void initialize();
        }, { once: true });
    } else {
        void initialize();
    }
}(window));
