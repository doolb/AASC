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
        'chatResponse',
        'chatSession',
        'privateSessionCreated',
        'privateSessionDeleted',
        'privateSessions',
        'privateSessionSwitched',
        'roleError',
        'roleList'
    ]);
    const state = {
        initialized: false,
        chatVisible: false,
        mmdVisible: false,
        mmdOrder: 'under-chat',
        displayId: null,
        transport: null,
        snapshotRequested: false
    };
    const subscribers = new Map();
    const refs = {};

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
    }

    function updatePointerRouting() {
        if (root.DisplayMmd && typeof root.DisplayMmd.setPointerEnabled === 'function') {
            root.DisplayMmd.setPointerEnabled(state.mmdVisible && !state.chatVisible);
        }
    }

    function setChatVisible(visible, focus = false) {
        state.chatVisible = visible === true;
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
        if (refs.stage) {
            refs.stage.style.setProperty('--display-stage-width', `${Math.round(width)}px`);
            refs.stage.style.setProperty('--display-stage-height', `${Math.round(height)}px`);
            refs.stage.style.setProperty('--display-keyboard-inset', `${Math.round(keyboardInset)}px`);
        }
        if (root.DisplayChat && typeof root.DisplayChat.resize === 'function') root.DisplayChat.resize();
        if (root.DisplayMmd && typeof root.DisplayMmd.resize === 'function') root.DisplayMmd.resize(width, height);
        publish('stage.resize', { width, height, keyboardInset });
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
        refs.mmdLayer = document.getElementById('displayMmdLayer');
        refs.chatLayer = document.getElementById('displayChatLayer');
        refs.mmdCanvas = document.getElementById('displayMmdCanvas');
        refs.chatToggle = document.getElementById('displayChatToggle');
        refs.mmdToggle = document.getElementById('displayMmdToggle');
        if (!refs.stage || !refs.chatLayer || !refs.mmdLayer) return;

        if (refs.chatToggle) {
            refs.chatToggle.addEventListener('click', () => setChatVisible(!state.chatVisible, !state.chatVisible));
        }
        if (refs.mmdToggle) {
            refs.mmdToggle.addEventListener('click', () => setMmdVisible(!state.mmdVisible));
        }
        if (root.DisplayChat && typeof root.DisplayChat.init === 'function') {
            root.DisplayChat.init({ root: refs.chatLayer, bus, send, getState: () => ({ ...state }) });
        }
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
        // MMD 是显示端主舞台，默认显示；聊天仍由独立入口按需打开并位于其上层。
        setMmdVisible(true);
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
        send,
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
