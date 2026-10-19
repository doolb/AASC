/* 控制端模型快选只接现有 WebSocket 和右下角工具组。 */
(function exposeControlChatModelTier(root) {
    'use strict';
    let picker = null;
    function send(message) {
        try {
            if (root.WebSocketManager?.ws?.readyState !== WebSocket.OPEN) return false;
            root.WebSocketManager.send(message);
            return true;
        } catch (error) {
            console.warn('[模型快选] 发送失败:', error.message);
            return false;
        }
    }
    function init() {
        if (picker) return picker;
        picker = root.ChatModelTierPicker?.create({
            host: document.getElementById('floatingControl'), prefix: 'control', send,
            onOpen: () => {
                if (root.FloatingControl?.isOpen) root.FloatingControl.toggle();
            }
        }) || null;
        if (picker && root.WebSocketManager?.ws?.readyState === WebSocket.OPEN) picker.setConnected(true);
        return picker;
    }
    root.ControlChatModelTier = Object.freeze({
        init,
        handleMessage(message) { init()?.handleMessage(message); },
        handleConnected() { init()?.setConnected(true); },
        handleDisconnected() { picker?.setConnected(false); }
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
}(window));
