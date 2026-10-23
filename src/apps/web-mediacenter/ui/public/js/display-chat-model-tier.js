/* 显示端模型快选复用舞台 WebSocket，不独立建连接。 */
(function exposeDisplayChatModelTier(root) {
    'use strict';
    let picker = null, actions = null;
    root.DisplayChatModelTier = Object.freeze({
        init({ bus, send, getState }) {
            picker ||= root.ChatModelTierPicker?.create({
                host: document.querySelector('.display-stage-lighting-control'),
                prefix: 'display', send,
                onOpen: () => root.DisplayMmdLighting?.close()
            });
            if (!actions) actions = import('./mmd-chat-actions.mjs').then(module => module.attachChatActions({ bus, send, getState }))
                .catch(error => { console.error('[动作SubAI]', error); actions = null; });
            if (!picker) return;
            bus.subscribe('server.message', message => picker.handleMessage(message));
            bus.subscribe('transport.changed', event => picker.setConnected(event.available));
            picker.setConnected(Boolean(getState()?.transport));
        }
    });
}(window));
