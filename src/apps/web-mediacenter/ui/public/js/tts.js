const Tts = {
    autoTtsEnabled: true,
    
    init() {
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

const AsrDevice = {
    currentDevice: 'server',

    async init() {
        try {
            const res = await fetch('/api/config/asrDevice');
            const data = await res.json();
            if (data.status === 'success') {
                this.currentDevice = data.device || 'server';
                this.updateUI();
            }
        } catch (err) {
            console.error('[ASR] 加载配置失败:', err);
        }
    },

    async setDevice(device) {
        if (device !== 'server' && device !== 'display') return;

        try {
            const res = await fetch('/api/config/asrDevice', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ device })
            });
            const data = await res.json();
            if (data.status === 'success') {
                this.currentDevice = device;
                this.updateUI();
                showToast(`语音识别设备已切换为: ${device === 'server' ? '服务端' : '显示端'}`, 'success');
            } else {
                showToast('切换失败: ' + data.message, 'error');
            }
        } catch (err) {
            showToast('切换失败: ' + err.message, 'error');
        }
    },

    updateUI() {
        const serverBtn = document.getElementById('asrDeviceServerBtn');
        const displayBtn = document.getElementById('asrDeviceDisplayBtn');
        const statusEl = document.getElementById('asrDeviceStatus');

        if (serverBtn) {
            serverBtn.style.background = this.currentDevice === 'server'
                ? 'linear-gradient(135deg, #4CAF50, #45a049)'
                : '';
        }
        if (displayBtn) {
            displayBtn.style.background = this.currentDevice === 'display'
                ? 'linear-gradient(135deg, #4CAF50, #45a049)'
                : '';
        }
        if (statusEl) {
            const deviceName = this.currentDevice === 'server' ? '服务端 (本地 CPU)' : '显示端 (浏览器 WASM)';
            const displayCount = window.DeviceList ? window.DeviceList.getDisplays().filter(d => {
                const caps = d.capabilities;
                return caps && caps.voiceRecognition;
            }).length : 0;
            statusEl.textContent = `当前: ${deviceName}` + (this.currentDevice === 'display' ? ` | 可用显示端: ${displayCount}` : '');
        }
    },

    handleDeviceChanged(device) {
        this.currentDevice = device;
        this.updateUI();
    }
};

window.AsrDevice = AsrDevice;
window.setAsrDevice = AsrDevice.setDevice.bind(AsrDevice);

const TtsDevice = {
    currentDevice: 'server',

    async init() {
        try {
            const res = await fetch('/api/config/ttsDevice');
            const data = await res.json();
            if (data.status === 'success') {
                this.currentDevice = data.device || 'server';
                this.updateUI();
            }
        } catch (err) {
            console.error('[TTS] 加载语音生成设备配置失败:', err);
        }
    },

    async setDevice(device) {
        if (device !== 'server' && device !== 'display') return;

        try {
            const res = await fetch('/api/config/ttsDevice', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ device })
            });
            const data = await res.json();
            if (data.status === 'success') {
                this.currentDevice = device;
                this.updateUI();
                showToast(`语音生成设备已切换为: ${device === 'server' ? '服务端' : '显示端'}`, 'success');
            } else {
                showToast('切换失败: ' + data.message, 'error');
            }
        } catch (err) {
            showToast('切换失败: ' + err.message, 'error');
        }
    },

    updateUI() {
        const serverBtn = document.getElementById('ttsDeviceServerBtn');
        const displayBtn = document.getElementById('ttsDeviceDisplayBtn');
        const statusEl = document.getElementById('ttsDeviceStatus');

        if (serverBtn) {
            serverBtn.style.background = this.currentDevice === 'server'
                ? 'linear-gradient(135deg, #4CAF50, #45a049)'
                : '';
        }
        if (displayBtn) {
            displayBtn.style.background = this.currentDevice === 'display'
                ? 'linear-gradient(135deg, #4CAF50, #45a049)'
                : '';
        }
        if (statusEl) {
            const available = window.DeviceList ? window.DeviceList.getDisplays().filter(d => {
                const caps = d.capabilities;
                return caps && caps.ttsGeneration;
            }).length : 0;
            const displayName = this.currentDevice === 'server' ? '服务端 (网络合成)' : '显示端 (离线合成)';
            statusEl.textContent = `当前: ${displayName}` + (this.currentDevice === 'display' ? ` | 可用显示端: ${available}` : '');
        }
    },

    handleDeviceChanged(device) {
        this.currentDevice = device;
        this.updateUI();
    }
};

window.TtsDevice = TtsDevice;
window.setTtsDevice = TtsDevice.setDevice.bind(TtsDevice);

window.Tts = Tts;
window.toggleAutoTts = Tts.toggleAutoTts.bind(Tts);
window.stopTts = Tts.stop.bind(Tts);
window.playCustomTts = Tts.playCustom.bind(Tts);
window.testTimeAnnounce = Tts.testTimeAnnounce.bind(Tts);
