const Tts = {
    autoTtsEnabled: true,
    timeAnnounceConfig: {
        enabled: true,
        interval: 15,
        repeatCount: 3,
        repeatDelay: 3000
    },
    
    init() {
        this.loadTimeAnnounceConfig();
    },
    
    loadTimeAnnounceConfig() {
        fetch('/api/timeAnnounce/config')
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success' && data.config) {
                    console.log('[TTS] 加载整点报时配置:', data.config);
                    this.timeAnnounceConfig = { ...this.timeAnnounceConfig, ...data.config };
                    console.log('[TTS] 合并后配置:', this.timeAnnounceConfig);
                    this.renderTimeAnnounceConfig();
                }
            })
            .catch(err => console.error('加载整点报时配置失败:', err));
    },
    
    renderTimeAnnounceConfig() {
        const enabledSelect = document.getElementById('timeAnnounceEnabled');
        const intervalSelect = document.getElementById('timeAnnounceInterval');
        const repeatCountInput = document.getElementById('timeAnnounceRepeatCount');
        const repeatDelayInput = document.getElementById('timeAnnounceRepeatDelay');
        
        console.log('[TTS] renderTimeAnnounceConfig 开始');
        console.log('[TTS] 配置值:', this.timeAnnounceConfig);
        console.log('[TTS] DOM元素:', {
            enabledSelect: !!enabledSelect,
            intervalSelect: !!intervalSelect,
            repeatCountInput: !!repeatCountInput,
            repeatDelayInput: !!repeatDelayInput
        });
        
        if (enabledSelect) {
            enabledSelect.value = this.timeAnnounceConfig.enabled ? 'true' : 'false';
            console.log('[TTS] 设置 enabledSelect.value =', enabledSelect.value);
        }
        if (intervalSelect) {
            intervalSelect.value = String(this.timeAnnounceConfig.interval);
            console.log('[TTS] 设置 intervalSelect.value =', intervalSelect.value);
        }
        if (repeatCountInput) {
            repeatCountInput.value = this.timeAnnounceConfig.repeatCount || 3;
            console.log('[TTS] 设置 repeatCountInput.value =', repeatCountInput.value);
        }
        if (repeatDelayInput) {
            repeatDelayInput.value = (this.timeAnnounceConfig.repeatDelay || 3000) / 1000;
            console.log('[TTS] 设置 repeatDelayInput.value =', repeatDelayInput.value);
        }
    },
    
    saveTimeAnnounceConfig() {
        const enabledSelect = document.getElementById('timeAnnounceEnabled');
        const intervalSelect = document.getElementById('timeAnnounceInterval');
        const repeatCountInput = document.getElementById('timeAnnounceRepeatCount');
        const repeatDelayInput = document.getElementById('timeAnnounceRepeatDelay');
        
        const config = {
            enabled: enabledSelect ? enabledSelect.value === 'true' : true,
            interval: intervalSelect ? parseInt(intervalSelect.value) : 15,
            repeatCount: repeatCountInput ? parseInt(repeatCountInput.value) || 1 : 3,
            repeatDelay: repeatDelayInput ? (parseInt(repeatDelayInput.value) || 3) * 1000 : 3000
        };
        
        fetch('/api/timeAnnounce/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                this.timeAnnounceConfig = data.config;
                window.showToast('整点报时配置已保存', 'success');
            }
        })
        .catch(err => window.showToast('保存配置失败', 'error'));
    },
    
    toggleAutoTts() {
        this.autoTtsEnabled = !this.autoTtsEnabled;
        
        const btn = document.getElementById('autoTtsBtn');
        if (btn) {
            btn.textContent = '自动播报: ' + (this.autoTtsEnabled ? '开' : '关');
        }
        
        if (window.WebSocketManager && window.WebSocketManager.ws && 
            window.WebSocketManager.ws.readyState === WebSocket.OPEN && 
            window.currentDisplayId) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'tts',
                displayId: window.currentDisplayId,
                action: 'setAutoTts',
                enabled: this.autoTtsEnabled
            }));
        }
        
        showToast('自动播报已' + (this.autoTtsEnabled ? '开启' : '关闭'), 'success');
    },
    
    stop() {
        if (window.WebSocketManager) {
            window.WebSocketManager.sendTts('stop');
            showToast('已停止播报', 'success');
        }
    },
    
    playCustom() {
        const textInput = document.getElementById('ttsTextInput');
        const text = textInput.value.trim();
        
        if (!text) {
            showToast('请输入要播报的文字', 'error');
            return;
        }
        
        if (!window.currentDisplayId) {
            showToast('请先选择显示端', 'error');
            return;
        }
        
        if (window.WebSocketManager) {
            window.WebSocketManager.sendTts('play', { text: text });
            showToast('已发送播报请求', 'success');
        }
    },
    
    testTimeAnnounce() {
        if (window.WebSocketManager && window.WebSocketManager.ws && 
            window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'tts',
                action: 'testTimeAnnounce'
            }));
            showToast('已发送整点报时测试请求', 'success');
        } else {
            showToast('未连接到服务器', 'error');
        }
    }
};

window.Tts = Tts;
window.toggleAutoTts = Tts.toggleAutoTts.bind(Tts);
window.stopTts = Tts.stop.bind(Tts);
window.playCustomTts = Tts.playCustom.bind(Tts);
window.testTimeAnnounce = Tts.testTimeAnnounce.bind(Tts);
window.saveTimeAnnounceConfig = Tts.saveTimeAnnounceConfig.bind(Tts);
