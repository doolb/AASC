/*
 * 显示端 VRM/MMD 舞台模块。
 *
 * three-vrm 运行时通过动态 import 按需加载，模型由同源服务端在线代理；网络、
 * WebGL 或 VRM 解析失败时回退到轻量 Canvas 占位，确保聊天和媒体仍然可用。
 * 任何动作计划都必须经过 display-mmd-command-adapter.js。
 */
(function exposeDisplayMmd(root) {
    const DEFAULT_STATIC_MODEL_FILE = 'default-vroid.vrm.zst';
    const STATIC_MODEL_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(?:vrm|glb)(?:\.zst)?$/u;
    const DEFAULT_MODEL_PROFILE = Object.freeze({
        roleId: 'default-vroid',
        name: '凍香(天使)',
        fileName: DEFAULT_STATIC_MODEL_FILE,
        modelUrl: `/api/vrm/model/static?file=${encodeURIComponent(DEFAULT_STATIC_MODEL_FILE)}`,
        sourceUrl: 'http://c.aasc.us/mnt/mmd/'
    });
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
        pulseUntil: 0,
        lastInteractionAt: 0,
        animationFrame: null,
        runtime: null,
        runtimePromise: null,
        runtimeUnavailable: false,
        loadSequence: 0
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

    function handlePointerDown(event) {
        if (!state.pointerEnabled || !state.visible) return;
        state.pressedPoint = getCanvasPoint(event);
    }

    function handlePointerUp(event) {
        if (!state.pointerEnabled || !state.visible || !state.pressedPoint) return;
        const point = getCanvasPoint(event);
        const distance = Math.hypot(point.x - state.pressedPoint.x, point.y - state.pressedPoint.y);
        state.pressedPoint = null;
        if (distance > 18) return;
        const hitPart = raycast(point);
        if (hitPart) triggerInteraction(hitPart, point);
    }

    function setPointerEnabled(enabled) {
        state.pointerEnabled = enabled === true;
        if (state.canvas) state.canvas.classList.toggle('is-interactive', state.pointerEnabled);
    }

    function setVisible(visible) {
        state.visible = visible === true;
        if (state.runtime) state.runtime.setVisible(state.visible);
        if (state.visible && !state.modelReady && !state.runtime) {
            setStatus('正在准备在线 VRM 模型…');
        }
        if (!state.runtime && state.runtimeUnavailable) drawFallback();
    }

    async function ensureRuntime() {
        if (state.runtime) return state.runtime;
        if (state.runtimePromise) return state.runtimePromise;
        state.runtimePromise = import('./display-vrm-runtime.js')
            .then(({ createDisplayVrmRuntime }) => {
                state.runtime = createDisplayVrmRuntime({
                    canvas: state.canvas,
                    onStatus: (message) => setStatus(message)
                });
                state.runtime.setVisible(state.visible);
                resizeCanvas(state.width, state.height);
                return state.runtime;
            })
            .catch((error) => {
                state.runtimePromise = null;
                state.runtimeUnavailable = true;
                setStatus(`VRM 运行时不可用：${error.message}`, true);
                drawFallback();
                return null;
            });
        return state.runtimePromise;
    }

    async function resolveProfile(profile) {
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
        setStatus('正在解析在线 VRM 模型…');
        const runtime = await ensureRuntime();
        if (!runtime || sequence !== state.loadSequence) return false;
        try {
            const resolvedProfile = await resolveProfile(state.modelProfile);
            if (sequence !== state.loadSequence) return false;
            await runtime.load(resolvedProfile.modelUrl);
            if (sequence !== state.loadSequence) return false;
            state.modelProfile = resolvedProfile;
            state.modelReady = true;
            setStatus('VRM 模型已加载');
            return true;
        } catch (error) {
            state.modelReady = false;
            setStatus(`VRM 模型加载失败：${error.message}`, true);
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
        state.canvas.addEventListener('pointerup', handlePointerUp, { passive: true });
        state.canvas.addEventListener('pointercancel', () => {
            state.pressedPoint = null;
        }, { passive: true });
        state.initialized = true;
        resizeCanvas();
        setStatus('正在准备在线 VRM 模型…');
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
        handleActionPlan,
        init,
        loadModel,
        resize: resizeCanvas,
        setPointerEnabled,
        setVisible
    });
}(window));
