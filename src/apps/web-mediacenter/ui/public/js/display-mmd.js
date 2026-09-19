/*
 * 显示端 VRM/MMD 舞台模块。
 *
 * 当前包先提供无外部依赖的 Canvas 降级运行时：它保留模型点击、动作事件和
 * 高 DPI 尺寸契约，等本地 three-vrm/mmd-parser 资源准备好后，可由同一个模块
 * 替换绘制器，不需要改聊天层或 display.html。任何动作计划都必须经过命令适配器。
 */
(function exposeDisplayMmd(root) {
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
        animationFrame: null
    };

    function setStatus(message, isError = false) {
        if (!state.status) return;
        state.status.textContent = message || '';
        state.status.classList.toggle('is-error', isError);
    }

    function resizeCanvas(width = window.innerWidth, height = window.innerHeight) {
        if (!state.canvas) return;
        state.width = Math.max(1, Math.round(width));
        state.height = Math.max(1, Math.round(height));
        state.devicePixelRatio = Math.min(2, Math.max(1, Number(window.devicePixelRatio) || 1));
        state.canvas.width = Math.round(state.width * state.devicePixelRatio);
        state.canvas.height = Math.round(state.height * state.devicePixelRatio);
        state.canvas.style.width = `${state.width}px`;
        state.canvas.style.height = `${state.height}px`;
        drawFallback();
    }

    function drawFallback() {
        if (!state.context) return;
        const context = state.context;
        const width = state.width;
        const height = state.height;
        context.setTransform(state.devicePixelRatio, 0, 0, state.devicePixelRatio, 0, 0);
        context.clearRect(0, 0, width, height);
        if (!state.visible) return;

        // 没有内置模型时保留一个轻量可点击占位区，避免 WebView 首屏加载外部模型。
        const centerX = width / 2;
        const centerY = height * 0.48;
        const scale = Math.min(width, height) * 0.2;
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
        if (pulsing) {
            state.animationFrame = requestAnimationFrame(drawFallback);
        }
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
        // 本地 three-vrm 接入后由 runtime 提供真实 Raycaster；无 runtime 时使用安全的占位命中区。
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
        drawFallback();
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
        if (state.visible && !state.modelReady) {
            setStatus('角色舞台已就绪，等待本地 VRM/MMD 模型');
        }
        drawFallback();
    }

    function loadModel(profile) {
        if (!profile || typeof profile !== 'object') {
            state.modelProfile = null;
            state.modelReady = false;
            setStatus('未配置角色模型');
            return false;
        }
        state.modelProfile = { ...profile };
        state.modelReady = false;
        setStatus('模型资源待接入本地运行时');
        return false;
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
        state.context = state.canvas.getContext('2d', { alpha: true });
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
        resizeCanvas();
        setStatus('角色舞台已就绪，等待本地 VRM/MMD 模型');
        state.initialized = true;
    }

    function handleActionPlan(plan) {
        if (!plan || typeof plan !== 'object') return false;
        const action = plan.fallbackAction || plan.action || 'idle';
        state.pulseUntil = Date.now() + 800;
        setStatus(`动作：${String(action).slice(0, 64)}`);
        drawFallback();
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
