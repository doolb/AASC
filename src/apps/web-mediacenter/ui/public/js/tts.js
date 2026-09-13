const Tts = {
    autoTtsEnabled: true,
    
    init() {
        if (window.CpuAffinitySettings) {
            window.CpuAffinitySettings.init();
        }
        const autoTtsButton = document.getElementById('autoTtsBtn');
        if (autoTtsButton) autoTtsButton.classList.toggle('active', this.autoTtsEnabled);
    },
    
    toggleAutoTts() {
        this.autoTtsEnabled = !this.autoTtsEnabled;
        
        const btn = document.getElementById('autoTtsBtn');
        if (btn) {
            btn.textContent = '自动播报: ' + (this.autoTtsEnabled ? '开' : '关');
            btn.classList.toggle('active', this.autoTtsEnabled);
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
    serverEnabled: true,

    async init() {
        try {
            const res = await fetch('/api/config/asrDevice');
            const data = await res.json();
            if (data.status === 'success') {
                this.currentDevice = data.device || 'server';
                this.serverEnabled = data.serverEnabled !== false;
                this.updateUI();
            }
        } catch (err) {
            console.error('[ASR] 加载配置失败:', err);
        }
    },

    async setDevice(device) {
        if (device !== 'server' && device !== 'display') return;
        if (device === 'server' && !this.serverEnabled) {
            showToast('服务器语音识别已关闭，请先开启', 'error');
            return;
        }

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
            serverBtn.classList.toggle('active', this.currentDevice === 'server');
            serverBtn.disabled = !this.serverEnabled;
            serverBtn.title = this.serverEnabled ? '' : '服务器语音识别已关闭';
            serverBtn.style.background = this.currentDevice === 'server'
                ? 'linear-gradient(135deg, #4CAF50, #45a049)'
                : '';
        }
        if (displayBtn) {
            displayBtn.classList.toggle('active', this.currentDevice === 'display');
            displayBtn.style.background = this.currentDevice === 'display'
                ? 'linear-gradient(135deg, #4CAF50, #45a049)'
                : '';
        }
        if (statusEl) {
            statusEl.textContent = this.currentDevice === 'display'
                ? '当前: 显示端（按连接顺序选择提供端）'
                : '当前: 服务端公共 ASR';
        }
    },

    handleDeviceChanged(device) {
        this.currentDevice = device;
        this.updateUI();
    },

    handleServerEnabledChanged(enabled) {
        this.serverEnabled = enabled === true;
        this.updateUI();
    }
};

window.AsrDevice = AsrDevice;
window.setAsrDevice = AsrDevice.setDevice.bind(AsrDevice);

const TtsDevice = {
    currentDevice: 'server',
    serverEnabled: true,

    async init() {
        try {
            const res = await fetch('/api/config/ttsDevice');
            const data = await res.json();
            if (data.status === 'success') {
                this.currentDevice = data.device || 'server';
                this.serverEnabled = data.serverEnabled !== false;
                this.updateUI();
            }
        } catch (err) {
            console.error('[TTS] 加载语音生成设备配置失败:', err);
        }
    },

    async setDevice(device) {
        if (device !== 'server' && device !== 'display') return;
        if (device === 'server' && !this.serverEnabled) {
            showToast('服务器语音生成已关闭，请先开启', 'error');
            return;
        }

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
            serverBtn.classList.toggle('active', this.currentDevice === 'server');
            serverBtn.disabled = !this.serverEnabled;
            serverBtn.title = this.serverEnabled ? '' : '服务器语音生成已关闭';
            serverBtn.style.background = this.currentDevice === 'server'
                ? 'linear-gradient(135deg, #4CAF50, #45a049)'
                : '';
        }
        if (displayBtn) {
            displayBtn.classList.toggle('active', this.currentDevice === 'display');
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
    },

    handleServerEnabledChanged(enabled) {
        this.serverEnabled = enabled === true;
        this.updateUI();
    }
};

window.TtsDevice = TtsDevice;
window.setTtsDevice = TtsDevice.setDevice.bind(TtsDevice);

const CpuAffinitySettings = {
    currentConfig: {
        asr: { bigCoreCount: 1, littleCoreCount: 1, preferBigCores: false },
        tts: { bigCoreCount: 1, littleCoreCount: 1, preferBigCores: false },
        llm: { bigCoreCount: 2, littleCoreCount: 0, preferBigCores: true }
    },

    init() {
        const saveBtn = document.getElementById('cpuAffinitySaveBtn');
        if (saveBtn && !saveBtn.dataset.bound) {
            saveBtn.dataset.bound = '1';
            saveBtn.addEventListener('click', () => {
                this.saveConfig();
            });
        }
        this.applyConfig(this.currentConfig, '加载中...');
        this.loadConfig();
    },

    normalizeCoreCount(raw, fallbackValue) {
        if (raw === undefined || raw === null || raw === '') {
            return fallbackValue;
        }
        const parsed = Number.parseInt(raw, 10);
        if (!Number.isFinite(parsed) || parsed < 0) {
            return fallbackValue;
        }
        return parsed;
    },

    normalizeEngineConfig(engine, fallbackFieldValue, defaults = {}) {
        const source = engine || {};
        const normalized = {
            bigCoreCount: this.normalizeCoreCount(
                source.bigCoreCount,
                defaults.bigCoreCount === undefined ? fallbackFieldValue : defaults.bigCoreCount
            ),
            littleCoreCount: this.normalizeCoreCount(
                source.littleCoreCount,
                defaults.littleCoreCount === undefined ? fallbackFieldValue : defaults.littleCoreCount
            ),
            preferBigCores: source.preferBigCores === undefined
                ? defaults.preferBigCores === true
                : source.preferBigCores === true
        };
        if (normalized.bigCoreCount + normalized.littleCoreCount <= 0) {
            normalized.littleCoreCount = 1;
        }
        return normalized;
    },

    normalizeConfig(config, fallbackFieldValue) {
        const source = config || {};
        return {
            asr: this.normalizeEngineConfig(source.asr, fallbackFieldValue),
            tts: this.normalizeEngineConfig(source.tts, fallbackFieldValue),
            llm: this.normalizeEngineConfig(source.llm, fallbackFieldValue, {
                bigCoreCount: 2,
                littleCoreCount: 0,
                preferBigCores: true
            })
        };
    },

    getInputs() {
        return {
            asrBig: document.getElementById('asrBigCoreCountInput'),
            asrLittle: document.getElementById('asrLittleCoreCountInput'),
            asrPreferBig: document.getElementById('asrPreferBigCoreInput'),
            ttsBig: document.getElementById('ttsBigCoreCountInput'),
            ttsLittle: document.getElementById('ttsLittleCoreCountInput'),
            ttsPreferBig: document.getElementById('ttsPreferBigCoreInput'),
            llmBig: document.getElementById('llmBigCoreCountInput'),
            llmLittle: document.getElementById('llmLittleCoreCountInput'),
            llmPreferBig: document.getElementById('llmPreferBigCoreInput'),
            status: document.getElementById('cpuAffinityStatus')
        };
    },

    updateStatus(text) {
        const { status } = this.getInputs();
        if (status) {
            status.textContent = text;
        }
    },

    formatStatus(config, prefix) {
        const normalized = this.normalizeConfig(config, 1);
        return `${prefix} ASR 大${normalized.asr.bigCoreCount}/小${normalized.asr.littleCoreCount} | TTS 大${normalized.tts.bigCoreCount}/小${normalized.tts.littleCoreCount} | LLM 大${normalized.llm.bigCoreCount}/小${normalized.llm.littleCoreCount}`;
    },

    applyConfig(config, statusText) {
        const normalized = this.normalizeConfig(config, 1);
        const inputs = this.getInputs();

        this.currentConfig = normalized;
        if (inputs.asrBig) inputs.asrBig.value = String(normalized.asr.bigCoreCount);
        if (inputs.asrLittle) inputs.asrLittle.value = String(normalized.asr.littleCoreCount);
        if (inputs.asrPreferBig) inputs.asrPreferBig.checked = normalized.asr.preferBigCores;
        if (inputs.ttsBig) inputs.ttsBig.value = String(normalized.tts.bigCoreCount);
        if (inputs.ttsLittle) inputs.ttsLittle.value = String(normalized.tts.littleCoreCount);
        if (inputs.ttsPreferBig) inputs.ttsPreferBig.checked = normalized.tts.preferBigCores;
        if (inputs.llmBig) inputs.llmBig.value = String(normalized.llm.bigCoreCount);
        if (inputs.llmLittle) inputs.llmLittle.value = String(normalized.llm.littleCoreCount);
        if (inputs.llmPreferBig) inputs.llmPreferBig.checked = normalized.llm.preferBigCores;

        this.updateStatus(statusText || this.formatStatus(normalized, '当前配置:'));
        return normalized;
    },

    readConfigFromInputs() {
        const inputs = this.getInputs();
        return this.normalizeConfig({
            asr: {
                bigCoreCount: inputs.asrBig ? inputs.asrBig.value : 1,
                littleCoreCount: inputs.asrLittle ? inputs.asrLittle.value : 1,
                preferBigCores: inputs.asrPreferBig ? inputs.asrPreferBig.checked : false
            },
            tts: {
                bigCoreCount: inputs.ttsBig ? inputs.ttsBig.value : 1,
                littleCoreCount: inputs.ttsLittle ? inputs.ttsLittle.value : 1,
                preferBigCores: inputs.ttsPreferBig ? inputs.ttsPreferBig.checked : false
            },
            llm: {
                bigCoreCount: inputs.llmBig ? inputs.llmBig.value : 2,
                littleCoreCount: inputs.llmLittle ? inputs.llmLittle.value : 0,
                preferBigCores: inputs.llmPreferBig ? inputs.llmPreferBig.checked : true
            }
        }, 0);
    },

    async loadConfig() {
        try {
            const res = await fetch('/api/config/cpuAffinity');
            const data = await res.json();
            if (data.status === 'success') {
                this.applyConfig(data.cpuAffinity, '已同步服务器配置');
                return;
            }
            this.updateStatus('加载失败');
            showToast('加载 CPU 并发配置失败', 'error');
        } catch (err) {
            console.error('[CPU] 加载配置失败:', err);
            this.updateStatus('加载失败');
            showToast('加载 CPU 并发配置失败: ' + err.message, 'error');
        }
    },

    async saveConfig() {
        const payload = this.readConfigFromInputs();
        this.applyConfig(payload, '保存中...');

        try {
            const res = await fetch('/api/config/cpuAffinity', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (data.status === 'success') {
                this.applyConfig(data.cpuAffinity, '已保存服务器配置');
                showToast('CPU 并发配置已保存', 'success');
                return;
            }
            this.updateStatus('保存失败');
            showToast('保存 CPU 并发配置失败: ' + (data.message || '未知错误'), 'error');
        } catch (err) {
            console.error('[CPU] 保存配置失败:', err);
            this.updateStatus('保存失败');
            showToast('保存 CPU 并发配置失败: ' + err.message, 'error');
        }
    },

    handleConfigChanged(config) {
        this.applyConfig(config, '已同步服务器配置');
    }
};

window.CpuAffinitySettings = CpuAffinitySettings;
window.Tts = Tts;
window.toggleAutoTts = Tts.toggleAutoTts.bind(Tts);
window.stopTts = Tts.stop.bind(Tts);
window.playCustomTts = Tts.playCustom.bind(Tts);
window.testTimeAnnounce = Tts.testTimeAnnounce.bind(Tts);
