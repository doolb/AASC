/* 显示端语音交互：只协调现有采集和播报，状态由真实运行事件归约。 */
(function exposeDisplayVoiceControls(root) {
    const LABELS = Object.freeze({ stopped: '已停止', idle: '空闲', listening: '监听中', recognizing: '识别中', thinking: '思考', speaking: '说话中' });
    const chats = new Set();
    let runtime = null;
    let send = null;
    let getStageState = null;
    let pendingId = null;
    let pendingTimer = null;
    let initialized = false;
    let refs = {};

    function deriveStatus(snapshot = {}, thinking = false) {
        if (snapshot.speaking) return 'speaking';
        if (snapshot.recognizing > 0) return 'recognizing';
        if (thinking) return 'thinking';
        if (snapshot.manual || (snapshot.listening && snapshot.hasSpeech)) return 'listening';
        if (snapshot.continuous && snapshot.listening) return 'idle';
        return 'stopped';
    }

    function render() {
        if (!runtime) return;
        const snapshot = runtime.snapshot();
        const status = deriveStatus(snapshot, chats.size > 0);
        const assistantName = root.DisplayChat?.getVoiceStatusName?.() || '助手';
        const label = `${assistantName} · ${LABELS[status]}`;
        if (refs.status) refs.status.textContent = label;
        if (refs.button) {
            refs.button.dataset.state = status;
            refs.button.setAttribute('aria-label', `${label}，${snapshot.continuous ? '打断播报' : snapshot.manual ? '结束录音并识别' : '开始一次语音输入'}`);
        }
        if (refs.toggle) {
            refs.toggle.checked = snapshot.continuous;
            refs.toggle.disabled = Boolean(pendingId) || !snapshot.connected || !snapshot.configReady;
        }
    }

    function clearPending() {
        if (pendingTimer) root.clearTimeout(pendingTimer);
        pendingTimer = null;
        pendingId = null;
    }

    function showError(error) {
        if (root.showToast) root.showToast(error.message || String(error), 'error');
        if (refs.status) refs.status.title = error.message || String(error);
    }

    function requestContinuous(enabled) {
        if (pendingId || !send) return false;
        pendingId = `display-listening-${Date.now()}`;
        const sent = send({ type: 'setDisplayVoiceListeningConfig', displayId: getStageState().displayId, enabled: enabled === true, requestId: pendingId });
        if (!sent) {
            clearPending();
            showError(new Error('未连接服务器，监听模式未保存'));
            render();
            return false;
        }
        pendingTimer = root.setTimeout(() => {
            clearPending();
            showError(new Error('未收到监听模式保存结果，请重连确认'));
            render();
        }, 10000);
        render();
        return true;
    }

    async function click() {
        if (!runtime) return;
        try {
            await runtime.activate();
        } catch (error) {
            showError(error);
        }
        render();
    }

    function handleServerMessage(message) {
        if (message.type !== 'displayVoiceListeningConfig') return false;
        const displayId = getStageState().displayId;
        if (message.displayId && displayId && message.displayId !== displayId) return false;
        if (!message.requestId || message.requestId === pendingId) clearPending();
        runtime.configure(message.enabled !== false);
        if (message.success === false) showError(new Error(message.message || '监听模式保存失败'));
        render();
        return true;
    }

    function init(options) {
        if (initialized || !options.runtime) return;
        initialized = true;
        runtime = options.runtime;
        send = options.send;
        getStageState = options.getState;
        refs = {
            toggle: root.document.getElementById('displayVoiceContinuous'),
            button: root.document.getElementById('displayVoiceAction'),
            status: root.document.getElementById('displayVoiceActionStatus')
        };
        refs.toggle?.addEventListener('change', () => requestContinuous(refs.toggle.checked));
        refs.button?.addEventListener('click', click);
        options.bus.subscribe('server.message', handleServerMessage);
        options.bus.subscribe('voice.runtime', render);
        options.bus.subscribe('chat.status-name', render);
        options.bus.subscribe('chat.activity', ({ requestId, active }) => {
            if (!requestId) return;
            if (active) chats.add(requestId);
            else chats.delete(requestId);
            render();
        });
        options.bus.subscribe('transport.changed', ({ available }) => {
            if (!available) {
                clearPending();
                chats.clear();
            }
            render();
        });
        render();
    }

    root.DisplayVoiceControls = Object.freeze({ deriveStatus, init, render });
}(window));
