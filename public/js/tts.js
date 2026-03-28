const Tts = {
    autoTtsEnabled: true,
    
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

window.toggleAutoTts = Tts.toggleAutoTts.bind(Tts);
window.stopTts = Tts.stop.bind(Tts);
window.playCustomTts = Tts.playCustom.bind(Tts);
window.testTimeAnnounce = Tts.testTimeAnnounce.bind(Tts);
