/*
 * 显示端同页舞台协调器。
 *
 * 聊天、MMD 和媒体都属于同一个 display.html 文档。本模块只负责 DOM 层级、
 * 事件总线和现有 WebSocket 的注入，不创建 iframe，也不创建第二条 WebSocket。
 */
(function exposeDisplayStage(root) {
    const CHAT_MESSAGE_TYPES = new Set([
        'assistantConfig',
        'chatChunk',
        'chatHistory',
        'chatHistoryError',
        'chatInput',
        'chatResponse',
        'chatSession',
        'privateSessionCreated',
        'privateSessionDeleted',
        'privateSessions',
        'privateSessionSwitched',
        'roleError',
        'roleHistory',
        'roleList'
    ]);
    const state = {
        initialized: false,
        chatVisible: false,
        // MMD 默认显示；服务端连接后会用按 displayId 保存的权威值覆盖它。
        mmdVisible: true,
        mmdOrder: 'under-chat',
        rotation: 0,
        rotationGeometry: null,
        displayId: null,
        transport: null,
        snapshotRequested: false
    };
    const subscribers = new Map();
    const refs = {};
    const ROTATION_SAFE_AREA_MAP = Object.freeze({
        0: Object.freeze({ top: 'top', right: 'right', bottom: 'bottom', left: 'left' }),
        90: Object.freeze({ top: 'right', right: 'bottom', bottom: 'left', left: 'top' }),
        180: Object.freeze({ top: 'bottom', right: 'left', bottom: 'top', left: 'right' }),
        270: Object.freeze({ top: 'left', right: 'top', bottom: 'right', left: 'bottom' })
    });
    const ROTATION_KEYBOARD_EDGE = Object.freeze({ 0: 'bottom', 90: 'right', 180: 'top', 270: 'left' });

    function normalizeRotation(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return 0;
        const normalized = ((numeric % 360) + 360) % 360;
        return Object.prototype.hasOwnProperty.call(ROTATION_SAFE_AREA_MAP, normalized) ? normalized : 0;
    }

    function getRotationGeometry(viewportWidth, viewportHeight, rotation, keyboardInset = 0) {
        const width = Math.max(1, Math.round(Number(viewportWidth) || 1));
        const height = Math.max(1, Math.round(Number(viewportHeight) || 1));
        const angle = normalizeRotation(rotation);
        const isQuarterTurn = angle === 90 || angle === 270;
        const logicalWidth = isQuarterTurn ? height : width;
        const logicalHeight = isQuarterTurn ? width : height;
        const physicalKeyboardInset = Math.max(0, Number(keyboardInset) || 0);
        const keyboardEdge = ROTATION_KEYBOARD_EDGE[angle];
        const keyboardInsets = { top: 0, right: 0, bottom: 0, left: 0 };
        keyboardInsets[keyboardEdge] = physicalKeyboardInset;
        return {
            rotation: angle,
            viewportWidth: width,
            viewportHeight: height,
            logicalWidth,
            logicalHeight,
            keyboardInset: physicalKeyboardInset,
            keyboardInsets,
            safeAreaSources: ROTATION_SAFE_AREA_MAP[angle]
        };
    }

    function mapViewportPointToStage(clientX, clientY, rect, geometry) {
        if (!rect || !geometry || rect.width <= 0 || rect.height <= 0) return null;
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const deltaX = Number(clientX) - centerX;
        const deltaY = Number(clientY) - centerY;
        const logicalWidth = Math.max(1, Number(geometry.logicalWidth) || rect.width);
        const logicalHeight = Math.max(1, Number(geometry.logicalHeight) || rect.height);
        let x;
        let y;
        switch (normalizeRotation(geometry.rotation)) {
            case 90:
                x = logicalWidth / 2 + deltaY;
                y = logicalHeight / 2 - deltaX;
                break;
            case 180:
                x = logicalWidth / 2 - deltaX;
                y = logicalHeight / 2 - deltaY;
                break;
            case 270:
                x = logicalWidth / 2 - deltaY;
                y = logicalHeight / 2 + deltaX;
                break;
            default:
                x = logicalWidth / 2 + deltaX;
                y = logicalHeight / 2 + deltaY;
                break;
        }
        const normalizedX = (x / logicalWidth) * 2 - 1;
        const normalizedY = -((y / logicalHeight) * 2 - 1);
        return {
            x,
            y,
            normalizedX: normalizedX === 0 ? 0 : normalizedX,
            normalizedY: normalizedY === 0 ? 0 : normalizedY
        };
    }

    function subscribe(type, handler) {
        if (typeof handler !== 'function') return () => {};
        const handlers = subscribers.get(type) || new Set();
        handlers.add(handler);
        subscribers.set(type, handlers);
        return () => {
            handlers.delete(handler);
            if (handlers.size === 0) subscribers.delete(type);
        };
    }

    function publish(type, payload = {}) {
        const handlers = subscribers.get(type);
        if (!handlers) return false;
        let consumed = false;
        for (const handler of handlers) {
            try {
                if (handler(payload) === true) consumed = true;
            } catch (error) {
                console.error(`[显示端舞台] 处理 ${type} 失败:`, error);
            }
        }
        return consumed;
    }

    const bus = Object.freeze({
        publish,
        subscribe
    });

    function send(message) {
        if (!message || typeof state.transport !== 'function') return false;
        try {
            return state.transport(message) === true;
        } catch (error) {
            console.warn('[显示端舞台] 发送消息失败:', error);
            return false;
        }
    }

    function requestInitialSnapshot() {
        if (state.snapshotRequested || typeof state.transport !== 'function') return;
        const messages = [
            { type: 'roleList' },
            { type: 'getAssistantConfig' },
            { type: 'getChatSession' },
            { type: 'chatHistory', source: 'displayChat' }
        ];
        const sent = messages.every((message) => send(message));
        if (sent) {
            state.snapshotRequested = true;
            publish('snapshot.requested', {});
        }
    }

    function setTransport(transport) {
        state.transport = typeof transport === 'function' ? transport : null;
        publish('transport.changed', { available: state.transport !== null });
        requestInitialSnapshot();
        if (state.initialized && state.transport) syncDisplayChatVoiceContext(state.chatVisible);
    }

    function getDisplayChatVoiceContext() {
        if (root.DisplayChat && typeof root.DisplayChat.getVoiceConversationContext === 'function') {
            return root.DisplayChat.getVoiceConversationContext();
        }
        return { mode: 'group', target: null };
    }

    function syncDisplayChatVoiceContext(visible) {
        const context = getDisplayChatVoiceContext();
        send({
            type: 'displayChatVisibility',
            visible: visible === true,
            mode: context.mode,
            target: context.target,
            displayId: state.displayId
        });
    }

    function updatePointerRouting() {
        if (root.DisplayMmd && typeof root.DisplayMmd.setPointerEnabled === 'function') {
            root.DisplayMmd.setPointerEnabled(state.mmdVisible && !state.chatVisible);
        }
    }

    function setChatVisible(visible, focus = false) {
        state.chatVisible = visible === true;
        // 播报文字与聊天共用全屏舞台；聊天打开时隐藏字幕，避免遮挡消息气泡。
        // 这里只切换页面状态类，不触碰 TTS 音频队列、播放状态或录音状态。
        if (document.body) document.body.classList.toggle('display-chat-open', state.chatVisible);
        if (refs.voiceTextDisplay) {
            // 记录到 data 属性，防止后续 showTtsText 改写 className 后字幕重新出现。
            refs.voiceTextDisplay.dataset.chatSuppressed = String(state.chatVisible);
            refs.voiceTextDisplay.setAttribute('aria-hidden', String(state.chatVisible));
            applyVoiceTextVisibility();
        }
        if (refs.chatLayer) {
            refs.chatLayer.classList.toggle('is-visible', state.chatVisible);
            refs.chatLayer.setAttribute('aria-hidden', String(!state.chatVisible));
        }
        if (refs.chatToggle) {
            refs.chatToggle.setAttribute('aria-expanded', String(state.chatVisible));
            refs.chatToggle.textContent = state.chatVisible ? '隐藏聊天' : '聊天';
        }
        if (root.DisplayChat && typeof root.DisplayChat.setVisible === 'function') {
            root.DisplayChat.setVisible(state.chatVisible, focus);
        }
        updatePointerRouting();
        publish('chat.visibility', { visible: state.chatVisible });
        if (state.initialized) syncDisplayChatVoiceContext(state.chatVisible);
    }

    function applyVoiceTextVisibility() {
        if (!refs.voiceTextDisplay) return;
        const suppressed = state.chatVisible === true;
        refs.voiceTextDisplay.dataset.chatSuppressed = String(suppressed);
        refs.voiceTextDisplay.setAttribute('aria-hidden', String(suppressed));
        if (suppressed) {
            refs.voiceTextDisplay.style.setProperty('display', 'none', 'important');
        } else {
            refs.voiceTextDisplay.style.removeProperty('display');
        }
    }

    function setMmdVisible(visible) {
        state.mmdVisible = visible === true;
        if (refs.mmdLayer) {
            refs.mmdLayer.classList.toggle('is-visible', state.mmdVisible);
            refs.mmdLayer.setAttribute('aria-hidden', String(!state.mmdVisible));
        }
        if (refs.mmdToggle) {
            refs.mmdToggle.setAttribute('aria-expanded', String(state.mmdVisible));
            refs.mmdToggle.textContent = state.mmdVisible ? '隐藏角色' : '角色';
        }
        if (root.DisplayMmd && typeof root.DisplayMmd.setVisible === 'function') {
            root.DisplayMmd.setVisible(state.mmdVisible);
        }
        updatePointerRouting();
        publish('mmd.visibility', { visible: state.mmdVisible });
    }

    function requestMmdVisibility() {
        const desiredVisible = !state.mmdVisible;
        const sent = send({
            type: 'mmdVisibilityRequest',
            displayId: state.displayId,
            visible: desiredVisible
        });
        if (!sent) {
            publish('mmd.visibility.error', {
                visible: desiredVisible,
                message: '显示端 WebSocket 未连接'
            });
            return false;
        }
        // 先更新本地画面，服务端随后下发同一权威值，保证点击时没有可感知延迟。
        setMmdVisible(desiredVisible);
        return true;
    }

    function setMmdOrder(order) {
        state.mmdOrder = order === 'over-chat' ? 'over-chat' : 'under-chat';
        if (refs.mmdLayer) refs.mmdLayer.classList.toggle('over-chat', state.mmdOrder === 'over-chat');
        if (refs.chatLayer) refs.chatLayer.classList.toggle('under-mmd', state.mmdOrder === 'over-chat');
        publish('mmd.order', { order: state.mmdOrder });
    }

    function resize() {
        const viewport = root.visualViewport;
        const width = viewport?.width || document.documentElement.clientWidth || window.innerWidth;
        const height = viewport?.height || document.documentElement.clientHeight || window.innerHeight;
        const keyboardInset = Math.max(0, window.innerHeight - height);
        const geometry = getRotationGeometry(width, height, root.currentRotation, keyboardInset);
        state.rotation = geometry.rotation;
        state.rotationGeometry = geometry;
        const logicalWidth = geometry.logicalWidth;
        const logicalHeight = geometry.logicalHeight;
        if (refs.stage) {
            refs.stage.dataset.rotation = String(geometry.rotation);
            refs.stage.style.setProperty('--display-viewport-width', `${width}px`);
            refs.stage.style.setProperty('--display-viewport-height', `${height}px`);
            refs.stage.style.setProperty('--display-stage-width', `${logicalWidth}px`);
            refs.stage.style.setProperty('--display-stage-height', `${logicalHeight}px`);
            refs.stage.style.setProperty('--display-stage-panel-width', `${Math.min(320, Math.max(1, Math.round(logicalWidth * 0.86)))}px`);
            refs.stage.style.setProperty('--display-stage-panel-max-height', `${Math.min(620, Math.max(1, Math.round(logicalHeight * 0.72)))}px`);
            refs.stage.style.setProperty('--display-stage-dialog-width', `${Math.min(920, Math.max(1, logicalWidth - 24))}px`);
            refs.stage.style.setProperty('--display-stage-dialog-max-height', `${Math.max(1, Math.round(logicalHeight * 0.92))}px`);
            refs.stage.style.setProperty('--display-stage-preview-max-height', `${Math.max(1, Math.round(logicalHeight * 0.68))}px`);
            refs.stage.style.setProperty('--display-stage-panel-top-gap', `${Math.min(104, Math.max(64, Math.round(logicalHeight * 0.12)))}px`);
            refs.stage.style.setProperty('--display-keyboard-inset', `${geometry.rotation === 0 ? keyboardInset : 0}px`);
            for (const edge of ['top', 'right', 'bottom', 'left']) {
                refs.stage.style.setProperty(`--display-keyboard-inset-${edge}`, `${Math.round(geometry.keyboardInsets[edge])}px`);
            }
        }
        for (const layer of [refs.mmdLayer, refs.chatLayer, refs.interactionLayer, refs.arCalibration]) {
            if (!layer) continue;
            layer.style.inset = 'auto';
            layer.style.left = '50%';
            layer.style.top = '50%';
            layer.style.right = 'auto';
            layer.style.bottom = 'auto';
            layer.style.width = `${logicalWidth}px`;
            layer.style.height = `${logicalHeight}px`;
            layer.style.transformOrigin = 'center center';
            layer.style.transform = `translate(-50%, -50%) rotate(${geometry.rotation}deg)`;
        }
        if (refs.arTrackingVideo) {
            refs.arTrackingVideo.style.inset = 'auto';
            refs.arTrackingVideo.style.left = '50%';
            refs.arTrackingVideo.style.top = '50%';
            refs.arTrackingVideo.style.right = 'auto';
            refs.arTrackingVideo.style.bottom = 'auto';
            refs.arTrackingVideo.style.width = `${logicalWidth}px`;
            refs.arTrackingVideo.style.height = `${logicalHeight}px`;
            refs.arTrackingVideo.style.transformOrigin = 'center center';
            refs.arTrackingVideo.style.transform = `translate(-50%, -50%) rotate(${geometry.rotation}deg)`;
        }
        if (root.DisplayChat && typeof root.DisplayChat.resize === 'function') root.DisplayChat.resize();
        if (root.DisplayMmd && typeof root.DisplayMmd.resize === 'function') root.DisplayMmd.resize(logicalWidth, logicalHeight);
        publish('stage.resize', { width: logicalWidth, height: logicalHeight, viewportWidth: width, viewportHeight: height, keyboardInset, rotation: geometry.rotation });
    }

    function setRotation(rotation) {
        const angle = normalizeRotation(rotation);
        if (state.rotation === angle && state.rotationGeometry) return true;
        state.rotation = angle;
        if (refs.stage) resize();
        publish('stage.rotation', { rotation: angle });
        return true;
    }

    function handleServerMessage(message) {
        if (!message || typeof message !== 'object') return false;
        if (message.type === 'displayId' && typeof message.id === 'string') {
            state.displayId = message.id;
            publish('display.identity', { displayId: state.displayId });
            return true;
        }
        const consumed = publish('server.message', message);
        if (CHAT_MESSAGE_TYPES.has(message.type)) return consumed;
        return consumed;
    }

    function initialize() {
        if (state.initialized) return;
        refs.stage = document.getElementById('displayStageLayers');
        refs.arTrackingVideo = document.getElementById('displayArTrackingVideo');
        refs.mmdLayer = document.getElementById('displayMmdLayer');
        refs.chatLayer = document.getElementById('displayChatLayer');
        refs.interactionLayer = document.getElementById('displayInteractionLayer');
        refs.arCalibration = document.getElementById('displayArCalibration');
        refs.mmdCanvas = document.getElementById('displayMmdCanvas');
        refs.voiceTextDisplay = document.getElementById('voiceTextDisplay');
        refs.chatToggle = document.getElementById('displayChatToggle');
        refs.mmdToggle = document.getElementById('displayMmdToggle');
        refs.chatTtsStop = document.getElementById('displayChatTtsStop');
        if (!refs.stage || !refs.chatLayer || !refs.mmdLayer) return;

        if (refs.chatToggle) {
            refs.chatToggle.addEventListener('click', () => setChatVisible(!state.chatVisible, !state.chatVisible));
        }
        if (refs.mmdToggle) {
            refs.mmdToggle.addEventListener('click', requestMmdVisibility);
        }
        if (refs.chatTtsStop) {
            refs.chatTtsStop.addEventListener('click', () => {
                root.DisplayChat?.stopConversationTts({ notify: true });
            });
        }
        if (root.DisplayChat && typeof root.DisplayChat.init === 'function') {
            root.DisplayChat.init({ root: refs.chatLayer, bus, send, getState: () => ({ ...state }) });
        }
        bus.subscribe('chat.selection', () => {
            if (state.chatVisible) syncDisplayChatVoiceContext(true);
        });
        if (root.DisplayMmd && typeof root.DisplayMmd.init === 'function') {
            root.DisplayMmd.init({
                canvas: refs.mmdCanvas,
                status: document.getElementById('displayMmdStatus'),
                bus,
                send,
                getState: () => ({ ...state })
            });
        }
        setChatVisible(false);
        // MMD 是显示端主舞台，默认显示；如果服务端消息已先到达则保留其状态。
        setMmdVisible(state.mmdVisible);
        setMmdOrder('under-chat');
        window.addEventListener('resize', resize, { passive: true });
        window.addEventListener('orientationchange', resize, { passive: true });
        if (root.visualViewport) root.visualViewport.addEventListener('resize', resize, { passive: true });
        if (typeof ResizeObserver === 'function') {
            const observer = new ResizeObserver(resize);
            observer.observe(refs.stage);
        }
        state.initialized = true;
        resize();
        root.dispatchEvent(new CustomEvent('display-stage-ready'));
        publish('stage.ready', { refs, state: { ...state } });
        requestInitialSnapshot();
    }

    root.DisplayStage = Object.freeze({
        getBus: () => bus,
        getState: () => ({ ...state }),
        handleServerMessage,
        initialize,
        publish,
        requestMmdVisibility,
        refreshVoiceTextVisibility: applyVoiceTextVisibility,
        getRotationGeometry: (...args) => args.length
            ? getRotationGeometry(...args)
            : state.rotationGeometry || getRotationGeometry(
                root.visualViewport?.width || document.documentElement.clientWidth || window.innerWidth,
                root.visualViewport?.height || document.documentElement.clientHeight || window.innerHeight,
                root.currentRotation,
                0
            ),
        mapViewportPointToStage,
        send,
        setRotation,
        setChatVisible,
        setMmdOrder,
        setMmdVisible,
        setTransport
    });

    function scheduleInitialize() {
        if (state.initialized) return;
        // 当前文件使用 defer 加载；interactive 阶段仍可能有后续 defer 模块未执行。
        // 统一等 DOMContentLoaded，确保 DisplayChat/DisplayMmd 已经暴露 init 方法。
        if (document.readyState === 'loading' || document.readyState === 'interactive') {
            document.addEventListener('DOMContentLoaded', initialize, { once: true });
            return;
        }
        initialize();
    }

    scheduleInitialize();
}(window));
