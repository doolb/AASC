/*
 * 显示端 VRM/PMX 舞台模块。
 *
 * VRM 和 PMX 运行时通过动态 import 按需加载，模型与动作由同源服务端白名单清单
 * 提供；网络、WebGL 或模型解析失败时回退到轻量 Canvas 占位，确保聊天和媒体仍然可用。
 * 任何动作计划都必须经过 display-mmd-command-adapter.js。
 */
(function exposeDisplayMmd(root) {
    const DEFAULT_STATIC_MODEL_FILE = 'default-vroid.vrm.zst';
    const STATIC_MODEL_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(?:vrm|glb)(?:\.zst)?$/u;
    const DEFAULT_MMD_RESOURCE_ID = 'miya-default';
    const DEFAULT_MODEL_PROFILE = Object.freeze({
        roleId: 'default-miya',
        name: '米娅',
        resourceId: DEFAULT_MMD_RESOURCE_ID,
        modelType: 'pmx'
    });
    const DEFAULT_MMD_LIGHTING = Object.freeze({
        ambientColor: '#ffffff',
        ambientIntensity: 1.8,
        keyColor: '#ffffff',
        keyIntensity: 2.3,
        keyPosition: Object.freeze({ x: 1.5, y: 3, z: 2.5 }),
        shadowEnabled: true
    });
    const POINTER_DRAG_THRESHOLD = 8;
    const POINTER_TAP_THRESHOLD = 18;
    const ROTATION_RADIANS_PER_PIXEL = Math.PI / 360;

    function clamp(value, minimum, maximum, fallback) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.min(maximum, Math.max(minimum, number));
    }

    function normalizeColor(value, fallback = '#ffffff') {
        const color = String(value || '').trim().toLowerCase();
        return /^#[0-9a-f]{6}$/u.test(color) ? color : fallback;
    }

    function normalizeMmdLighting(input = {}) {
        const source = input && typeof input === 'object' ? input : {};
        const position = source.keyPosition && typeof source.keyPosition === 'object'
            ? source.keyPosition
            : {};
        return {
            ambientColor: normalizeColor(source.ambientColor, DEFAULT_MMD_LIGHTING.ambientColor),
            ambientIntensity: clamp(source.ambientIntensity, 0, 4, DEFAULT_MMD_LIGHTING.ambientIntensity),
            keyColor: normalizeColor(source.keyColor, DEFAULT_MMD_LIGHTING.keyColor),
            keyIntensity: clamp(source.keyIntensity, 0, 5, DEFAULT_MMD_LIGHTING.keyIntensity),
            keyPosition: {
                x: clamp(position.x, -10, 10, DEFAULT_MMD_LIGHTING.keyPosition.x),
                y: clamp(position.y, -10, 10, DEFAULT_MMD_LIGHTING.keyPosition.y),
                z: clamp(position.z, -10, 10, DEFAULT_MMD_LIGHTING.keyPosition.z)
            },
            shadowEnabled: typeof source.shadowEnabled === 'boolean'
                ? source.shadowEnabled
                : DEFAULT_MMD_LIGHTING.shadowEnabled
        };
    }

    const state = {
        initialized: false,
        visible: false,
        pointerEnabled: false,
        canvas: null,
        context: null,
        status: null,
        bus: null,
        send: null,
        getState: null,
        width: 0,
        height: 0,
        devicePixelRatio: 1,
        modelReady: false,
        modelProfile: null,
        pressedPoint: null,
        blankDrag: null,
        pulseUntil: 0,
        lastInteractionAt: 0,
        animationFrame: null,
        runtime: null,
        runtimeType: null,
        runtimePromise: null,
        runtimeUnavailable: false,
        loadSequence: 0,
        lighting: normalizeMmdLighting(DEFAULT_MMD_LIGHTING)
    };

    function setStatus(message, isError = false) {
        if (!state.status) return;
        state.status.textContent = message || '';
        state.status.classList.toggle('is-error', isError);
    }

    function ensureFallbackContext() {
        if (state.context || !state.canvas) return state.context;
        try {
            state.context = state.canvas.getContext('2d', { alpha: true });
        } catch (error) {
            console.warn('[显示端 MMD] Canvas 降级上下文不可用:', error);
        }
        return state.context;
    }

    function resizeCanvas(width = window.innerWidth, height = window.innerHeight) {
        if (!state.canvas) return;
        state.width = Math.max(1, Math.round(width));
        state.height = Math.max(1, Math.round(height));
        state.devicePixelRatio = Math.min(2, Math.max(1, Number(window.devicePixelRatio) || 1));
        state.canvas.style.width = `${state.width}px`;
        state.canvas.style.height = `${state.height}px`;
        if (state.runtime) {
            state.runtime.resize(state.width, state.height, state.devicePixelRatio);
            return;
        }
        state.canvas.width = Math.round(state.width * state.devicePixelRatio);
        state.canvas.height = Math.round(state.height * state.devicePixelRatio);
        if (state.runtimeUnavailable) drawFallback();
    }

    function drawFallback() {
        const context = ensureFallbackContext();
        if (!context) return;
        context.setTransform(state.devicePixelRatio, 0, 0, state.devicePixelRatio, 0, 0);
        context.clearRect(0, 0, state.width, state.height);
        if (!state.visible || state.runtime) return;

        // three-vrm 不可用时保留轻量可点击占位区，避免模型失败导致舞台空白。
        const centerX = state.width / 2;
        const centerY = state.height * 0.48;
        const scale = Math.min(state.width, state.height) * 0.2;
        const pulsing = state.pulseUntil > Date.now();
        context.save();
        context.globalAlpha = 0.88;
        context.strokeStyle = pulsing ? '#ffe082' : 'rgba(135, 206, 250, 0.86)';
        context.fillStyle = 'rgba(27, 39, 68, 0.38)';
        context.lineWidth = Math.max(2, scale * 0.025);
        context.beginPath();
        context.ellipse(centerX, centerY - scale * 0.48, scale * 0.46, scale * 0.55, 0, 0, Math.PI * 2);
        context.fill();
        context.stroke();
        context.beginPath();
        context.moveTo(centerX - scale * 0.3, centerY + scale * 0.05);
        context.quadraticCurveTo(centerX, centerY + scale * 0.62, centerX + scale * 0.3, centerY + scale * 0.05);
        context.stroke();
        context.restore();
        if (pulsing) state.animationFrame = requestAnimationFrame(drawFallback);
    }

    function getCanvasPoint(event) {
        const rect = state.canvas.getBoundingClientRect();
        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            normalizedX: ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
            normalizedY: -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1)
        };
    }

    function fallbackHitTest(point) {
        const centerX = state.width / 2;
        const centerY = state.height * 0.48;
        const scale = Math.min(state.width, state.height) * 0.2;
        const dx = (point.x - centerX) / Math.max(1, scale * 0.54);
        const dy = (point.y - (centerY - scale * 0.48)) / Math.max(1, scale * 0.62);
        if ((dx * dx) + (dy * dy) <= 1) return 'head';
        const bodyTop = centerY - scale * 0.02;
        const bodyBottom = centerY + scale * 0.72;
        if (point.x >= centerX - scale * 0.5 && point.x <= centerX + scale * 0.5
            && point.y >= bodyTop && point.y <= bodyBottom) return 'body';
        return null;
    }

    function raycast(point) {
        if (state.runtime && typeof state.runtime.raycast === 'function') {
            return state.runtime.raycast(point);
        }
        return fallbackHitTest(point);
    }

    function triggerInteraction(hitPart, point) {
        const now = Date.now();
        if (now - state.lastInteractionAt < 250) return;
        state.lastInteractionAt = now;
        state.pulseUntil = now + 700;
        const stageState = typeof state.getState === 'function' ? state.getState() : {};
        const event = {
            type: 'mmd.interaction',
            roleId: state.modelProfile?.roleId || null,
            hitPart,
            gesture: 'tap',
            timestamp: now,
            localOnly: true,
            displayId: stageState.displayId || null,
            normalizedX: point.normalizedX,
            normalizedY: point.normalizedY
        };
        setStatus(`已触摸${hitPart === 'head' ? '头部' : '角色'} · 本地动作`);
        if (!state.runtime && state.runtimeUnavailable) drawFallback();
        if (state.bus) state.bus.publish('mmd.interaction', event);
    }

    function finishBlankDrag(pointerId) {
        const drag = state.blankDrag;
        if (!drag || drag.pointerId !== pointerId) return false;
        if (state.canvas?.hasPointerCapture?.(pointerId)) {
            state.canvas.releasePointerCapture(pointerId);
        }
        state.blankDrag = null;
        state.canvas?.classList.remove('is-dragging');
        if (drag.didRotate && typeof state.runtime?.finishModelRotation === 'function') {
            state.runtime.finishModelRotation();
        }
        return true;
    }

    function cancelPointerInteraction() {
        const pointerId = state.blankDrag?.pointerId;
        if (typeof pointerId === 'number') finishBlankDrag(pointerId);
        state.pressedPoint = null;
    }

    function handlePointerDown(event) {
        if (!state.pointerEnabled || !state.visible) return;
        const point = getCanvasPoint(event);
        const hitPart = raycast(point);
        if (hitPart) {
            state.pressedPoint = { point, hitPart, pointerId: event.pointerId };
            return;
        }
        state.pressedPoint = null;
        state.blankDrag = {
            pointerId: event.pointerId,
            startPoint: point,
            lastPoint: point,
            didRotate: false
        };
        state.canvas.setPointerCapture?.(event.pointerId);
    }

    function handlePointerMove(event) {
        const drag = state.blankDrag;
        if (!state.pointerEnabled || !state.visible || !drag || drag.pointerId !== event.pointerId) return;
        const point = getCanvasPoint(event);
        const travelled = Math.hypot(point.x - drag.startPoint.x, point.y - drag.startPoint.y);
        if (!drag.didRotate && travelled < POINTER_DRAG_THRESHOLD) return;
        const deltaX = point.x - drag.lastPoint.x;
        const deltaY = point.y - drag.lastPoint.y;
        drag.lastPoint = point;
        drag.didRotate = true;
        state.canvas.classList.add('is-dragging');
        if (Math.abs(deltaX) < Number.EPSILON && Math.abs(deltaY) < Number.EPSILON) return;
        state.runtime?.rotateModelBy?.(deltaX * ROTATION_RADIANS_PER_PIXEL, deltaY * ROTATION_RADIANS_PER_PIXEL);
    }

    function handlePointerUp(event) {
        if (!state.pointerEnabled || !state.visible) return;
        if (finishBlankDrag(event.pointerId)) return;
        const pressedPoint = state.pressedPoint;
        if (!pressedPoint || pressedPoint.pointerId !== event.pointerId) return;
        const point = getCanvasPoint(event);
        const distance = Math.hypot(point.x - pressedPoint.point.x, point.y - pressedPoint.point.y);
        state.pressedPoint = null;
        if (distance > POINTER_TAP_THRESHOLD) return;
        triggerInteraction(pressedPoint.hitPart, point);
    }

    function setPointerEnabled(enabled) {
        state.pointerEnabled = enabled === true;
        if (!state.pointerEnabled) cancelPointerInteraction();
        if (state.canvas) state.canvas.classList.toggle('is-interactive', state.pointerEnabled);
    }

    function setVisible(visible) {
        state.visible = visible === true;
        if (!state.visible) cancelPointerInteraction();
        if (state.runtime) state.runtime.setVisible(state.visible);
        if (state.visible && !state.modelReady && !state.runtime) {
            setStatus('正在准备角色模型…');
        }
        if (!state.runtime && state.runtimeUnavailable) drawFallback();
    }

    function setLighting(lighting) {
        const current = state.lighting || DEFAULT_MMD_LIGHTING;
        state.lighting = normalizeMmdLighting({
            ...current,
            ...(lighting && typeof lighting === 'object' ? lighting : {}),
            keyPosition: {
                ...current.keyPosition,
                ...(lighting?.keyPosition && typeof lighting.keyPosition === 'object'
                    ? lighting.keyPosition
                    : {})
            }
        });
        if (state.runtime && typeof state.runtime.setLighting === 'function') {
            state.runtime.setLighting(state.lighting);
        }
        return getLighting();
    }

    function getLighting() {
        return {
            ...state.lighting,
            keyPosition: { ...state.lighting.keyPosition }
        };
    }

    async function ensureRuntime(modelType = 'vrm') {
        if (state.runtime && state.runtimeType === modelType) return state.runtime;
        if (state.runtime && state.runtimeType !== modelType) {
            try {
                state.runtime.dispose?.();
            } catch (error) {
                console.warn('[显示端 MMD] 切换运行时释放失败:', error);
            }
            state.runtime = null;
            state.runtimeType = null;
            state.runtimePromise = null;
        }
        if (state.runtimePromise) return state.runtimePromise;
        const runtimeModule = modelType === 'pmx' ? './display-pmx-runtime.js' : './display-vrm-runtime.js';
        state.runtimePromise = import(runtimeModule)
            .then((runtimeExports) => {
                const createRuntime = modelType === 'pmx'
                    ? runtimeExports.createDisplayPmxRuntime
                    : runtimeExports.createDisplayVrmRuntime;
                state.runtime = createRuntime({
                    canvas: state.canvas,
                    onStatus: (message) => setStatus(message)
                });
                state.runtimeType = modelType;
                state.runtime.setLighting?.(state.lighting);
                state.runtime.setVisible(state.visible);
                resizeCanvas(state.width, state.height);
                return state.runtime;
            })
            .catch((error) => {
                state.runtimePromise = null;
                state.runtimeUnavailable = true;
                setStatus(`${modelType === 'pmx' ? 'PMX' : 'VRM'} 运行时不可用：${error.message}`, true);
                drawFallback();
                return null;
            });
        return state.runtimePromise;
    }

    function isSafeLocalMmdUrl(url, extension) {
        return typeof url === 'string'
            && url.startsWith('/models/mmd/')
            && !url.includes('://')
            && !url.includes('..')
            && !/[?#]/u.test(url)
            && url.toLowerCase().endsWith(extension);
    }

    async function resolvePmxProfile(profile) {
        if (profile.modelType === 'pmx'
            && isSafeLocalMmdUrl(profile.modelUrl, '.pmx')
            && (!profile.motionUrl || isSafeLocalMmdUrl(profile.motionUrl, '.vmd'))
            && typeof profile.motionResourceId === 'string') {
            return { ...profile };
        }
        const response = await fetch('/api/mmd/resources', {
            cache: 'no-store',
            credentials: 'same-origin'
        });
        const payload = await response.json();
        if (!response.ok || payload.status !== 'success' || !Array.isArray(payload.resources)) {
            throw new Error(payload.message || `MMD profile 返回 HTTP ${response.status}`);
        }
        const resource = payload.resources.find((entry) => entry.resourceId === profile.resourceId)
            || payload.resources[0];
        if (!resource || resource.modelType !== 'pmx'
            || !isSafeLocalMmdUrl(resource.modelUrl, '.pmx')
            || !isSafeLocalMmdUrl(resource.motionUrl, '.vmd')) {
            throw new Error('服务端没有返回有效的 PMX 资源清单');
        }
        return { ...profile, ...resource };
    }

    async function resolveProfile(profile) {
        if (profile?.modelType === 'pmx') return resolvePmxProfile(profile);
        if (typeof profile.modelUrl === 'string'
            && (profile.modelUrl.startsWith('/api/vrm/model/file?')
                || profile.modelUrl.startsWith('/api/vrm/model/static?'))) {
            return { ...profile };
        }
        if (typeof profile.fileName === 'string' && STATIC_MODEL_FILE_PATTERN.test(profile.fileName)) {
            return {
                ...profile,
                modelUrl: `/api/vrm/model/static?file=${encodeURIComponent(profile.fileName)}`
            };
        }
        const sourceUrl = typeof profile.sourceUrl === 'string' ? profile.sourceUrl : '';
        const response = await fetch(`/api/vrm/model?url=${encodeURIComponent(sourceUrl)}`, {
            cache: 'no-store',
            credentials: 'same-origin'
        });
        const payload = await response.json();
        if (!response.ok || payload.status !== 'success' || !payload.model) {
            throw new Error(payload.message || `VRoid profile 返回 HTTP ${response.status}`);
        }
        return { ...profile, ...payload.model };
    }

    async function loadModel(profile) {
        if (!profile || typeof profile !== 'object') {
            state.modelProfile = null;
            state.modelReady = false;
            setStatus('未配置角色模型');
            return false;
        }
        const sequence = ++state.loadSequence;
        state.modelProfile = { ...profile };
        state.modelReady = false;
        cancelPointerInteraction();
        setStatus('正在准备角色模型…');
        try {
            const resolvedProfile = await resolveProfile(state.modelProfile);
            if (sequence !== state.loadSequence) return false;
            const modelType = resolvedProfile.modelType === 'pmx' ? 'pmx' : 'vrm';
            const runtime = await ensureRuntime(modelType);
            if (!runtime || sequence !== state.loadSequence) return false;
            await runtime.load(modelType === 'pmx' ? resolvedProfile : resolvedProfile.modelUrl);
            if (sequence !== state.loadSequence) return false;
            state.modelProfile = resolvedProfile;
            state.modelReady = true;
            setStatus(`${modelType === 'pmx' ? 'PMX' : 'VRM'} 模型已加载`);
            return true;
        } catch (error) {
            state.modelReady = false;
            state.runtime?.showFallback?.();
            setStatus(`角色模型加载失败：${error.message}`, true);
            if (!state.runtime) drawFallback();
            return false;
        }
    }

    function handleServerMessage(message) {
        if (!message || typeof message !== 'object') return false;
        if (message.type === 'mmd.model.profile' || message.type === 'vrm.model.profile') {
            loadModel(message.profile || message.model || null);
            return true;
        }
        if (message.type === 'mmd.action.plan' && root.DisplayMmdCommandAdapter) {
            root.DisplayMmdCommandAdapter.execute(message.plan || message);
            return true;
        }
        return false;
    }

    function init(options = {}) {
        if (state.initialized || !options.canvas) return;
        state.canvas = options.canvas;
        state.status = options.status || null;
        state.bus = options.bus || null;
        state.send = typeof options.send === 'function' ? options.send : () => false;
        state.getState = typeof options.getState === 'function' ? options.getState : () => ({});
        if (state.bus) {
            state.bus.subscribe('server.message', handleServerMessage);
            state.bus.subscribe('mmd.action.local', ({ plan }) => {
                if (plan) handleActionPlan(plan);
            });
        }
        state.canvas.addEventListener('pointerdown', handlePointerDown, { passive: true });
        state.canvas.addEventListener('pointermove', handlePointerMove, { passive: true });
        state.canvas.addEventListener('pointerup', handlePointerUp, { passive: true });
        state.canvas.addEventListener('pointercancel', (event) => {
            finishBlankDrag(event.pointerId);
            state.pressedPoint = null;
        }, { passive: true });
        state.initialized = true;
        resizeCanvas();
        setStatus('正在准备角色模型…');
        loadModel(DEFAULT_MODEL_PROFILE);
    }

    function handleActionPlan(plan) {
        if (!plan || typeof plan !== 'object') return false;
        const action = plan.fallbackAction || plan.action || 'idle';
        if (state.runtime?.handleActionPlan) state.runtime.handleActionPlan(plan);
        state.pulseUntil = Date.now() + 800;
        setStatus(`动作：${String(action).slice(0, 64)}`);
        if (!state.runtime && state.runtimeUnavailable) drawFallback();
        return true;
    }

    root.DisplayMmd = Object.freeze({
        DEFAULT_MMD_LIGHTING,
        getLighting,
        handleActionPlan,
        init,
        loadModel,
        resize: resizeCanvas,
        setLighting,
        setPointerEnabled,
        setVisible
    });
}(window));
