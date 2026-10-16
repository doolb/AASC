/* 控制端音色快选仅适配现有WS与浮动工具组；对应.src/framework/tts-provider-configuration.md。 */
(function exposeControlTtsVoices(root) {
    'use strict';
    let initialized = false;
    const listeners = new Map();
    const bus = {
        subscribe(name, callback) {
            if (!listeners.has(name)) listeners.set(name, new Set());
            listeners.get(name).add(callback);
            return () => listeners.get(name).delete(callback);
        }
    };
    const publish = (name, message) => {
        for (const callback of listeners.get(name) || []) callback(message);
    };
    function init() {
        if (initialized) return;
        const host = document.getElementById('floatingControl');
        if (!host || !root.TtsVoicePicker) return;
        // 固定模板一次插入，不插入目录或服务器输入；目录由共享模块使用textContent渲染。
        host.insertAdjacentHTML('beforeend', `
            <button id="controlTtsVoiceToggle" type="button" class="floating-control-toggle control-tts-voice-toggle"
                    aria-controls="controlTtsVoicePanel" aria-expanded="false" aria-label="选择语音方式与音色">音色</button>
<section id="controlTtsVoicePanel" class="control-tts-voice-panel display-tts-voice-panel tts-voice-picker" hidden aria-label="语音方式与音色">
                    <div class="display-tts-voice-header"><strong>音色选择</strong><button id="controlTtsVoiceClose" type="button" aria-label="关闭音色面板">×</button></div>
                    <div class="display-tts-voice-settings">
                    <p class="display-tts-voice-scope">全局 AI/Agent 默认语音；角色独立设置优先，对后续播放生效。</p>
                    <button id="controlTtsCurrentVoice" class="display-tts-current-voice" type="button" title="定位当前音色">
                        <span><small>当前音色</small><strong id="controlTtsCurrentVoiceName">等待同步</strong></span><span aria-hidden="true">✓</span>
                    </button>
                    <label for="controlTtsProviderSelect">TTS 方式</label>
                    <select id="controlTtsProviderSelect" aria-label="TTS方式" disabled></select>
                    <div id="controlTtsSpeedControl" class="tts-voice-speed" hidden>
                        <label for="controlTtsSpeed">语速 <output id="controlTtsSpeedValue" for="controlTtsSpeed">0</output></label>
                        <input id="controlTtsSpeed" type="range" min="-10" max="10" step="1" value="0" aria-label="语速">
                        <small>慢 <span>正常 0</span> 快</small>
                    </div>
                    <label for="controlTtsVoiceSearch">搜索音色</label>
                    <input id="controlTtsVoiceSearch" type="search" placeholder="名称或标签" aria-label="搜索音色" autocomplete="off">
                    <div class="display-tts-voice-filters" aria-label="音色筛选">
                        <label for="controlTtsFilterGender">性别<select id="controlTtsFilterGender" data-voice-filter="gender"></select></label>
                        <label for="controlTtsFilterAge">年龄<select id="controlTtsFilterAge" data-voice-filter="age"></select></label>
                        <label for="controlTtsFilterAccent">口音<select id="controlTtsFilterAccent" data-voice-filter="accent"></select></label>
                    </div>
                    <div class="display-tts-voice-summary"><span id="controlTtsVoiceSummary">全部音色</span><button id="controlTtsVoiceClear" type="button" hidden>清除筛选</button></div>
                    </div>
                    <div class="display-tts-voice-results">
                    <div class="display-tts-voice-list-header"><span>音色列表</span><span id="controlTtsVoiceCount"></span></div>
                    <div id="controlTtsVoiceList" class="display-tts-voice-list" role="listbox" aria-label="音色列表"></div>
                    </div>
                    <p id="controlTtsVoiceStatus" class="display-tts-voice-status" role="status"></p>
                </section>
        `);
        initialized = true;
        root.TtsVoicePicker.create().init({
            prefix: 'control', bus,
            send(message) {
                try {
                    if (root.WebSocketManager?.ws?.readyState !== WebSocket.OPEN) return false;
                    root.WebSocketManager.send(message);
                    return true;
                } catch (error) {
                    console.warn('[音色快选] 发送失败:', error.message);
                    return false;
                }
            },
            onOpen: () => { if (root.FloatingControl?.isOpen) root.FloatingControl.toggle(); }
        });
    }
    root.ControlTtsVoices = Object.freeze({
        init,
        handleMessage(message) { init(); publish('server.message', message); },
        handleConnected() { init(); publish('transport.changed', { available: true }); },
        handleDisconnected() { publish('transport.changed', { available: false }); }
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
}(window));
