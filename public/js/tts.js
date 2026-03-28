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
                    this.timeAnnounceConfig = { ...this.timeAnnounceConfig, ...data.config };
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
        
        if (enabledSelect) enabledSelect.value = this.timeAnnounceConfig.enabled ? 'true' : 'false';
        if (intervalSelect) intervalSelect.value = String(this.timeAnnounceConfig.interval);
        if (repeatCountInput) repeatCountInput.value = this.timeAnnounceConfig.repeatCount || 3;
        if (repeatDelayInput) repeatDelayInput.value = (this.timeAnnounceConfig.repeatDelay || 3000) / 1000;
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
        if (window.WebSocketManager) {
            window.WebSocketManager.sendTts('testTimeAnnounce');
            showToast('已发送整点报时测试请求', 'success');
        }
    }
};

window.Tts = Tts;
window.toggleAutoTts = Tts.toggleAutoTts.bind(Tts);
window.stopTts = Tts.stop.bind(Tts);
window.playCustomTts = Tts.playCustom.bind(Tts);
window.testTimeAnnounce = Tts.testTimeAnnounce.bind(Tts);
window.saveTimeAnnounceConfig = Tts.saveTimeAnnounceConfig.bind(Tts);
