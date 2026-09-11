const DeviceList = {
    list: [],
    selectionMode: 'single',
    viewMode: 'tree',
    deviceEvents: {},
    expandedNodes: new Set(['server']),
    selectedNodeId: null,
    serverInfo: { ip: '', port: 8081 },
    // 控制端只保留每个显示端最近一条 ASR 回传，避免实时结果无限累积。
    voiceInputByDisplay: new Map(),
    // 监听开关发出后等待服务端回执，避免用户误以为点击没有生效。
    voiceListeningPending: new Map(),
    // 每台显示端独立保存最近一次底噪统计，避免设备列表刷新后结果丢失。
    voiceVadNoiseByDisplay: new Map(),
    voiceVadNoisePending: new Map(),
    // 控制端只保存临时录音会话和最近一次 WAV，实时 PCM 到达后立即排入播放队列。
    displayRecordingByDisplay: new Map(),
    displayRecordingPlaybackByDisplay: new Map(),
    displayRealtimePlaybackByDisplay: new Map(),

    getDisplays() {
        return this.list || [];
    },

    setSelectionMode(mode) {
        if (mode !== 'single' && mode !== 'all' && mode !== 'adaptive') {
            return;
        }
        this.selectionMode = mode;
        try {
            localStorage.setItem('deviceListSelectionMode', mode);
        } catch (e) {
            console.warn('[DeviceList] 保存选择模式失败:', e.message);
        }
        this.render();
        if (mode === 'single' && !window.currentDisplayId && this.list.length > 0) {
            const storedId = this.getStoredSelection();
            const preferred = this.list.find((display) => display.id === storedId);
            if (preferred || !storedId) {
                this.select(preferred ? preferred.id : this.list[0].id);
            }
        }
    },

    getSelectedDisplayIds(mediaRatio) {
        switch (this.selectionMode) {
            case 'single':
                return window.currentDisplayId ? [window.currentDisplayId] : [];
            case 'all':
                return this.list.map(d => d.id);
            case 'adaptive':
                return this.getAdaptiveDisplayIds(mediaRatio);
            default:
                return [];
        }
    },

    getAdaptiveDisplayIds(mediaRatio) {
        const isLandscapeMedia = mediaRatio > 1;
        const isPortraitMedia = mediaRatio < 1;
        return this.list.filter(display => {
            const isLandscapeDisplay = this.isDisplayLandscape(display);
            if (isLandscapeMedia) {
                return isLandscapeDisplay;
            } else if (isPortraitMedia) {
                return !isLandscapeDisplay;
            } else {
                return true;
            }
        }).map(d => d.id);
    },

    isDisplayLandscape(display) {
        const { width, height } = display.canvasSize || { width: 1920, height: 1080 };
        const rotation = display.rotation || 0;
        let isLandscape = width >= height;
        if (rotation === 90 || rotation === 270) {
            isLandscape = !isLandscape;
        }
        return isLandscape;
    },

    // 显示稳定身份和连接地址，避免本机 Agent 的 127.0.0.1 与真实显示端混淆。
    getDisplayLabel(display) {
        const identity = display.id || 'unknown-display';
        const address = display.ip || 'unknown-ip';
        return identity === address ? identity : `${identity} · ${address}`;
    },

    escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (character) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[character]));
    },

    getVoiceListeningStatus(display) {
        const pending = this.voiceListeningPending.get(display.id);
        if (pending) {
            return { className: 'pending', label: '发送中' };
        }
        const capabilities = {
            voiceRecording: true,
            ...(display.capabilities || {})
        };
        if (capabilities.voiceRecording !== true) {
            return { className: 'disabled', label: '已关闭' };
        }
        if (display.voiceSupported === false) {
            return { className: 'unsupported', label: '不可用' };
        }
        if (display.voiceListening === true) {
            return { className: 'listening', label: '监听中' };
        }
        const conversationState = display.voiceConversation?.state || display.voiceConversationState;
        if (conversationState === 'waitingWake') {
            return { className: 'waiting', label: '等待唤醒' };
        }
        return { className: 'ready', label: '已启用' };
    },

    getLatestVoiceInput(display) {
        return this.voiceInputByDisplay.get(display.id) || display.lastVoiceInput || null;
    },

    isControlSocketOpen() {
        const socket = window.WebSocketManager?.ws;
        const openState = window.WebSocket?.OPEN ?? 1;
        return !!socket && socket.readyState === openState;
    },

    getVoiceCapabilities(display) {
        return {
            mediaRendering: true,
            voicePlayback: true,
            voiceRecording: true,
            voiceRecognition: false,
            ttsGeneration: false,
            displayText: true,
            ...(display.capabilities || {})
        };
    },

    sendVoiceCapabilities(displayId, enabled) {
        const display = this.list.find((item) => item.id === displayId);
        if (!display) return false;

        const previousEnabled = this.getVoiceCapabilities(display).voiceRecording === true;
        if (!this.isControlSocketOpen()) {
            display.capabilities = {
                ...this.getVoiceCapabilities(display),
                voiceRecording: previousEnabled
            };
            this.render();
            if (window.showToast) {
                window.showToast('监听开关发送失败：控制端未连接', 'error');
            }
            return false;
        }

        const capabilities = {
            ...this.getVoiceCapabilities(display),
            voiceRecording: enabled === true
        };
        this.voiceListeningPending.set(displayId, {
            enabled: enabled === true,
            previousEnabled
        });
        display.capabilities = capabilities;
        this.render();

        try {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'updateCapabilities',
                displayId,
                capabilities
            }));
        } catch (error) {
            this.handleCapabilitiesUpdateError({
                displayId,
                message: `监听开关发送失败：${error.message}`
            });
            return false;
        }
        return true;
    },

    toggleVoiceListening(displayId, enabled) {
        const sent = this.sendVoiceCapabilities(displayId, enabled === true);
        if (sent && window.showToast) {
            window.showToast('监听开关发送中', 'info');
        }
        return sent;
    },

    handleCapabilitiesUpdated(data) {
        const display = this.list.find((item) => item.id === data?.displayId);
        if (!display || !data.capabilities) return;
        display.capabilities = { ...this.getVoiceCapabilities(display), ...data.capabilities };
        const pending = this.voiceListeningPending.get(display.id);
        if (!pending || display.capabilities.voiceRecording === pending.enabled) {
            this.voiceListeningPending.delete(display.id);
        }
        this.render();
        if (window.showToast) {
            window.showToast(`显示端监听已${display.capabilities.voiceRecording ? '开启' : '关闭'}`, 'success');
        }
    },

    handleCapabilitiesUpdateError(data) {
        const display = this.list.find((item) => item.id === data?.displayId);
        const pending = this.voiceListeningPending.get(data?.displayId);
        if (display && pending) {
            display.capabilities = {
                ...this.getVoiceCapabilities(display),
                voiceRecording: pending.previousEnabled
            };
        }
        this.voiceListeningPending.delete(data?.displayId);
        this.render();
        if (window.showToast) {
            window.showToast(data?.message || '监听开关发送失败', 'error');
        }
    },

    handleDisplayRecordingModeChanged(data) {
        const display = this.list.find((item) => item.id === data?.displayId);
        if (!display) return;
        display.voiceRecordingMode = this.normalizeVoiceRecordingMode(data.mode);
        this.render();
    },

    normalizeVoiceRecordingMode(mode) {
        return ['asr', 'single', 'realtime'].includes(mode) ? mode : 'asr';
    },

    getVoiceRecordingMode(display) {
        return this.normalizeVoiceRecordingMode(display?.voiceRecordingMode);
    },

    getDisplayRecordingSession(displayId) {
        return this.displayRecordingByDisplay.get(displayId) || null;
    },

    getDisplayRecordingLabel(displayId) {
        const session = this.getDisplayRecordingSession(displayId);
        if (session?.state === 'started') return '录音中';
        if (session?.state === 'stopping') return '停止中';
        const playback = this.displayRecordingPlaybackByDisplay.get(displayId);
        return playback ? '已收到录音' : '';
    },

    sendDisplayRecordingMessage(message) {
        if (!this.isControlSocketOpen()) {
            if (window.showToast) window.showToast('录音操作失败：控制端未连接', 'error');
            return false;
        }
        try {
            window.WebSocketManager.ws.send(JSON.stringify(message));
            return true;
        } catch (error) {
            if (window.showToast) window.showToast(`录音操作失败：${error.message}`, 'error');
            return false;
        }
    },

    setVoiceRecordingMode(displayId, mode) {
        const display = this.list.find((item) => item.id === displayId);
        const nextMode = this.normalizeVoiceRecordingMode(mode);
        if (!display || !this.sendDisplayRecordingMessage({
            type: 'setVoiceRecordingMode',
            displayId,
            mode: nextMode
        })) return false;
        display.voiceRecordingMode = nextMode;
        this.render();
        return true;
    },

    requestDisplayRecording(displayId) {
        const display = this.list.find((item) => item.id === displayId);
        const mode = this.getVoiceRecordingMode(display);
        const capabilities = this.getVoiceCapabilities(display || {});
        if (!display || mode === 'asr' || capabilities.voiceRecording !== true) {
            if (window.showToast) window.showToast('当前显示端不支持该录音模式', 'error');
            return false;
        }
        if (this.getDisplayRecordingSession(displayId)) {
            if (window.showToast) window.showToast('该显示端已有录音任务', 'info');
            return false;
        }
        const requestId = `display-recording-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        this.displayRecordingByDisplay.set(displayId, {
            requestId,
            mode,
            state: 'requested'
        });
        this.render();
        const sent = this.sendDisplayRecordingMessage({
            type: 'requestDisplayRecording',
            displayId,
            mode,
            requestId
        });
        if (!sent) {
            this.displayRecordingByDisplay.delete(displayId);
            this.render();
        }
        return sent;
    },

    stopDisplayRecording(displayId) {
        const session = this.getDisplayRecordingSession(displayId);
        if (!session) return false;
        session.state = 'stopping';
        this.render();
        return this.sendDisplayRecordingMessage({
            type: 'stopDisplayRecording',
            displayId,
            requestId: session.requestId
        });
    },

    decodeBase64Bytes(value) {
        const binary = atob(value || '');
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }
        return bytes;
    },

    playSingleRecording(displayId) {
        const playback = this.displayRecordingPlaybackByDisplay.get(displayId);
        if (!playback?.url) return false;
        if (playback.audio) playback.audio.pause();
        const audio = new Audio(playback.url);
        playback.audio = audio;
        audio.onended = () => {
            if (playback.audio === audio) playback.audio = null;
        };
        void audio.play().catch((error) => {
            console.warn('[DeviceList] 单次录音自动播放失败:', error);
            if (window.showToast) window.showToast('浏览器阻止自动播放，请再次点击播放', 'info');
        });
        return true;
    },

    handleDisplayRecordingStatus(data) {
        const displayId = String(data?.displayId || '');
        const requestId = String(data?.requestId || '');
        if (!displayId || !requestId) return;
        const current = this.getDisplayRecordingSession(displayId);
        if (current && current.requestId !== requestId) return;
        this.displayRecordingByDisplay.set(displayId, {
            ...(current || {}),
            requestId,
            mode: this.normalizeVoiceRecordingMode(data.mode),
            state: data.state || 'started'
        });
        if (data.state === 'started' && data.mode === 'realtime') {
            this.ensureRealtimePlayback(displayId);
        }
        this.render();
    },

    ensureRealtimePlayback(displayId) {
        let state = this.displayRealtimePlaybackByDisplay.get(displayId);
        if (state) return state;
        try {
            const context = new (window.AudioContext || window.webkitAudioContext)();
            state = { context, nextPlayTime: 0, finishTimer: null };
            this.displayRealtimePlaybackByDisplay.set(displayId, state);
            void context.resume().catch((error) => console.warn('[DeviceList] 实时回放启动失败:', error));
            return state;
        } catch (error) {
            console.warn('[DeviceList] 浏览器不支持实时回放:', error);
            if (window.showToast) window.showToast('当前浏览器不支持实时录音播放', 'error');
            return null;
        }
    },

    handleDisplayRecordingChunk(data) {
        const displayId = String(data?.displayId || '');
        const session = this.getDisplayRecordingSession(displayId);
        if (!displayId || !session || session.requestId !== data.requestId) return;
        const playback = this.ensureRealtimePlayback(displayId);
        if (!playback) return;
        try {
            const bytes = this.decodeBase64Bytes(data.audioData);
            const sampleCount = Math.floor(bytes.byteLength / 2);
            const buffer = playback.context.createBuffer(1, sampleCount, Number(data.sampleRate) || 16000);
            const samples = new Float32Array(sampleCount);
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            for (let index = 0; index < sampleCount; index += 1) {
                samples[index] = view.getInt16(index * 2, true) / 0x8000;
            }
            buffer.copyToChannel(samples, 0);
            const source = playback.context.createBufferSource();
            source.buffer = buffer;
            source.connect(playback.context.destination);
            const startAt = Math.max(playback.nextPlayTime, playback.context.currentTime + 0.04);
            source.start(startAt);
            playback.nextPlayTime = startAt + buffer.duration;
        } catch (error) {
            console.warn('[DeviceList] 实时录音块播放失败:', error);
        }
    },

    handleDisplayRecordingResult(data) {
        const displayId = String(data?.displayId || '');
        if (!displayId) return;
        const session = this.getDisplayRecordingSession(displayId);
        if (session && data.requestId && session.requestId !== data.requestId) return;
        this.displayRecordingByDisplay.delete(displayId);
        if (data.audioData && data.mode === 'single') {
            const oldPlayback = this.displayRecordingPlaybackByDisplay.get(displayId);
            if (oldPlayback?.url) URL.revokeObjectURL(oldPlayback.url);
            const bytes = this.decodeBase64Bytes(data.audioData);
            const url = URL.createObjectURL(new Blob([bytes], { type: data.mimeType || 'audio/wav' }));
            this.displayRecordingPlaybackByDisplay.set(displayId, { url, audio: null });
            this.playSingleRecording(displayId);
        }
        if (data.mode === 'realtime') {
            const playback = this.displayRealtimePlaybackByDisplay.get(displayId);
            if (playback) {
                const delay = Math.max(0, (playback.nextPlayTime - playback.context.currentTime) * 1000 + 100);
                playback.finishTimer = setTimeout(() => {
                    void playback.context.close().catch(() => {});
                    this.displayRealtimePlaybackByDisplay.delete(displayId);
                }, delay);
            }
        }
        this.render();
        if (data.error && window.showToast) {
            window.showToast(`显示端录音失败：${data.error}`, 'error');
        }
    },

    cleanupDisplayRecordingResources(displayId) {
        const playback = this.displayRecordingPlaybackByDisplay.get(displayId);
        if (playback) {
            if (playback.audio) playback.audio.pause();
            if (playback.url) URL.revokeObjectURL(playback.url);
            this.displayRecordingPlaybackByDisplay.delete(displayId);
        }
        const realtime = this.displayRealtimePlaybackByDisplay.get(displayId);
        if (realtime) {
            if (realtime.finishTimer) clearTimeout(realtime.finishTimer);
            void realtime.context.close().catch(() => {});
            this.displayRealtimePlaybackByDisplay.delete(displayId);
        }
        this.displayRecordingByDisplay.delete(displayId);
    },

    renderVoiceControlHtml(display) {
        const capabilities = { voiceRecording: true, ...(display.capabilities || {}) };
        const status = this.getVoiceListeningStatus(display);
        const latest = this.getLatestVoiceInput(display);
        const latestText = latest?.text ? this.escapeHtml(latest.text) : '暂无识别回传';
        const latestType = latest ? (latest.isFinal ? '最终' : '实时') : '';
        const displayId = this.escapeHtml(display.id);
        return `
            <div class="display-voice-control" data-display-id="${displayId}">
                <label class="display-voice-toggle" title="直接控制该显示端是否采集语音">
                    <input type="checkbox" data-voice-listening-toggle data-display-id="${displayId}" ${capabilities.voiceRecording ? 'checked' : ''}>
                    <span>🎙️ 监听</span>
                </label>
                <span class="display-voice-state ${status.className}">${status.label}</span>
                <span class="display-voice-latest" title="最近一次语音识别结果">最近识别${latestType ? `（${latestType}）` : ''}：${latestText}</span>
            </div>
        `;
    },

    bindVoiceListeningControls(container) {
        if (!container || container.dataset.voiceControlsBound) return;
        container.dataset.voiceControlsBound = '1';
        container.addEventListener('click', (event) => {
            if (event.target.closest('.display-voice-control')) event.stopPropagation();
        });
        container.addEventListener('change', (event) => {
            const input = event.target.closest('[data-voice-listening-toggle]');
            if (input) {
                event.stopPropagation();
                this.toggleVoiceListening(input.dataset.displayId, input.checked);
                return;
            }
        });
    },

    renderVoiceVadCardHtml(display) {
        const displayId = this.escapeHtml(display.id);
        const vadThreshold = this.getVoiceVadThreshold(display);
        const vadNoise = this.voiceVadNoiseByDisplay.get(display.id);
        const vadNoisePending = this.voiceVadNoisePending.has(display.id);
        const vadNoiseText = vadNoise?.error
            ? `检测失败：${this.escapeHtml(vadNoise.error)}`
            : vadNoise
                ? `均值 ${vadNoise.averageRms.toFixed(4)} · P95 ${vadNoise.p95Rms.toFixed(4)} · 峰值 ${vadNoise.peakRms.toFixed(4)} · 建议 ${vadNoise.recommendedThreshold.toFixed(4)}`
                : '尚未检测底噪';
        const applyButton = vadNoise && !vadNoise.error
            ? `<button type="button" class="display-vad-apply" data-vad-apply data-display-id="${displayId}">应用建议</button>`
            : '';
        const capabilities = this.getVoiceCapabilities(display);
        const recordingMode = this.getVoiceRecordingMode(display);
        const recordingSession = this.getDisplayRecordingSession(display.id);
        const recordingLabel = this.getDisplayRecordingLabel(display.id);
        const recordingButtonText = recordingSession?.state === 'started' || recordingSession?.state === 'requested'
            ? (recordingMode === 'realtime' ? '停止实时录音' : '停止单次录音')
            : (recordingMode === 'realtime' ? '🔴 开始实时录音' : '🎙️ 单次录音并播放');
        const replayButton = this.displayRecordingPlaybackByDisplay.has(display.id)
            ? `<button type="button" class="display-recording-replay" data-display-recording-replay data-display-id="${displayId}">▶ 重播录音</button>`
            : '';
        return `
            <div class="display-vad-card" data-display-id="${displayId}">
                <div class="display-vad-card-title">${this.getDisplayLabel(display)}</div>
                <div class="display-vad-card-controls">
                    <label class="display-vad-threshold" title="数值越大越不容易被底噪触发">
                        VAD 阈值
                        <input type="number" min="0.001" max="0.2" step="0.001" value="${vadThreshold}" data-vad-threshold data-display-id="${displayId}">
                    </label>
                    <button type="button" class="display-vad-noise-test" data-vad-noise-test data-display-id="${displayId}" ${vadNoisePending ? 'disabled' : ''}>
                        ${vadNoisePending ? '检测中…' : '检测底噪'}
                    </button>
                    ${applyButton}
                </div>
                <div class="display-vad-noise-result" title="最近一次底噪检测结果">${vadNoiseText}</div>
                <div class="display-vad-recording-controls">
                    <label class="display-recording-mode">录音模式
                        <select data-voice-recording-mode data-display-id="${displayId}">
                            <option value="asr" ${recordingMode === 'asr' ? 'selected' : ''}>普通 ASR</option>
                            <option value="single" ${recordingMode === 'single' ? 'selected' : ''}>单次录音</option>
                            <option value="realtime" ${recordingMode === 'realtime' ? 'selected' : ''}>实时录音</option>
                        </select>
                    </label>
                    ${recordingMode === 'asr' ? '' : `<button type="button" class="display-recording-btn" data-display-recording-action data-display-id="${displayId}" ${capabilities.voiceRecording !== true ? 'disabled' : ''}>${recordingButtonText}</button>`}
                    ${replayButton}
                    ${recordingLabel ? `<span class="display-recording-state">${recordingLabel}</span>` : ''}
                </div>
                <div class="display-vad-hint">请保持安静约 3 秒；检测只采样 RMS，不会触发识别。</div>
            </div>
        `;
    },

    renderVoiceVadPanel() {
        const panel = document.getElementById('voiceVadPanel');
        if (!panel) return;
        const selectedDisplayId = window.currentDisplayId;
        const display = this.list.find((item) => item.id === selectedDisplayId);
        if (!display) {
            panel.innerHTML = selectedDisplayId
                ? '<div class="empty-list">当前选中的显示端已离线</div>'
                : '<div class="empty-list">请先选择显示端</div>';
            return;
        }
        panel.innerHTML = this.renderVoiceVadCardHtml(display);
        this.bindVoiceVadControls(panel);
    },

    bindVoiceVadControls(container) {
        if (!container || container.dataset.voiceVadControlsBound) return;
        container.dataset.voiceVadControlsBound = '1';
        container.addEventListener('click', (event) => {
            const applyButton = event.target.closest('[data-vad-apply]');
            if (applyButton) {
                event.stopPropagation();
                this.applyVoiceVadRecommendation(applyButton.dataset.displayId);
                return;
            }
            const noiseButton = event.target.closest('[data-vad-noise-test]');
            if (noiseButton) {
                event.stopPropagation();
                this.requestVoiceNoiseTest(noiseButton.dataset.displayId);
                return;
            }
            const recordButton = event.target.closest('[data-display-recording-action]');
            if (recordButton && !recordButton.disabled) {
                event.stopPropagation();
                const displayId = recordButton.dataset.displayId;
                if (this.getDisplayRecordingSession(displayId)) {
                    this.stopDisplayRecording(displayId);
                } else {
                    this.requestDisplayRecording(displayId);
                }
                return;
            }
            const replayButton = event.target.closest('[data-display-recording-replay]');
            if (replayButton) {
                event.stopPropagation();
                this.playSingleRecording(replayButton.dataset.displayId);
            }
        });
        container.addEventListener('change', (event) => {
            const vadInput = event.target.closest('[data-vad-threshold]');
            if (vadInput) {
                event.stopPropagation();
                this.sendVoiceVad(vadInput.dataset.displayId, vadInput.value);
                return;
            }
            const mode = event.target.closest('[data-voice-recording-mode]');
            if (mode) {
                event.stopPropagation();
                this.setVoiceRecordingMode(mode.dataset.displayId, mode.value);
            }
        });
    },

    handleVoiceInput(data) {
        const displayId = String(data?.displayId || '');
        if (!displayId) return;
        const text = String(data?.text || data?.fullText || '').trim();
        if (!text) return;
        const latest = {
            text,
            isFinal: data.isFinal === true,
            timestamp: Date.now()
        };
        this.voiceInputByDisplay.set(displayId, latest);
        const display = this.list.find((item) => item.id === displayId);
        if (display) {
            display.lastVoiceInput = latest;
            this.render();
        }
    },

    getVoiceVadThreshold(display) {
        const threshold = Number(display?.vadThreshold);
        if (!Number.isFinite(threshold)) return 0.01;
        return Math.min(0.2, Math.max(0.001, threshold));
    },

    sendVoiceVad(displayId, value) {
        const display = this.list.find((item) => item.id === displayId);
        if (!display || !this.isControlSocketOpen()) {
            if (window.showToast) window.showToast('VAD 阈值发送失败：控制端未连接', 'error');
            return false;
        }
        const number = Number(value);
        const threshold = Number.isFinite(number)
            ? Math.round(Math.min(0.2, Math.max(0.001, number)) * 1000000) / 1000000
            : this.getVoiceVadThreshold(display);
        display.vadThreshold = threshold;
        this.render();
        try {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'setVoiceVad',
                displayId,
                threshold
            }));
            return true;
        } catch (error) {
            if (window.showToast) window.showToast(`VAD 阈值发送失败：${error.message}`, 'error');
            return false;
        }
    },

    requestVoiceNoiseTest(displayId) {
        if (!this.isControlSocketOpen()) {
            if (window.showToast) window.showToast('底噪检测失败：控制端未连接', 'error');
            return false;
        }
        const requestId = `vad-noise-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        this.voiceVadNoisePending.set(displayId, requestId);
        try {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'detectVoiceNoise',
                displayId,
                requestId
            }));
            this.render();
            if (window.showToast) window.showToast('底噪检测开始，请保持安静约 3 秒', 'info');
            return true;
        } catch (error) {
            this.voiceVadNoisePending.delete(displayId);
            if (window.showToast) window.showToast(`底噪检测发送失败：${error.message}`, 'error');
            return false;
        }
    },

    handleVoiceVadConfig(data) {
        const display = this.list.find((item) => item.id === data?.displayId);
        if (!display || data.threshold === undefined) return;
        display.vadThreshold = this.getVoiceVadThreshold({ vadThreshold: data.threshold });
        this.render();
    },

    handleVoiceVadNoiseResult(data) {
        const displayId = String(data?.displayId || '');
        if (!displayId) return;
        this.voiceVadNoisePending.delete(displayId);
        this.voiceVadNoiseByDisplay.set(displayId, {
            averageRms: Number(data.averageRms) || 0,
            peakRms: Number(data.peakRms) || 0,
            p95Rms: Number(data.p95Rms) || 0,
            recommendedThreshold: Number(data.recommendedThreshold) || 0,
            sampleCount: Number(data.sampleCount) || 0,
            error: data.error ? String(data.error) : ''
        });
        this.render();
        if (window.showToast) {
            window.showToast(
                data.error ? `底噪检测失败：${data.error}` : '底噪检测完成，可参考建议阈值',
                data.error ? 'error' : 'success'
            );
        }
    },

    applyVoiceVadRecommendation(displayId) {
        const result = this.voiceVadNoiseByDisplay.get(displayId);
        if (!result || !Number.isFinite(result.recommendedThreshold) || result.recommendedThreshold <= 0) return false;
        return this.sendVoiceVad(displayId, result.recommendedThreshold);
    },

    updateVoiceConversationState(data) {
        const display = this.list.find((item) => item.id === data?.displayId);
        if (!display) return;
        display.voiceConversation = {
            state: data.state || 'waitingWake',
            target: data.target || null
        };
        this.render();
    },

    setViewMode(mode) {
        if (mode !== 'tree' && mode !== 'list') {
            return;
        }
        this.viewMode = mode;
        try { localStorage.setItem('deviceListViewMode', mode); } catch (e) {}
        this.render();
    },

    getStoredSelection() {
        try {
            return localStorage.getItem('selectedDisplayId');
        } catch (e) {
            return null;
        }
    },

    toggleViewMode() {
        this.setViewMode(this.viewMode === 'tree' ? 'list' : 'tree');
    },

    init() {
        this.loadDeviceEvents();

        try {
            const savedViewMode = localStorage.getItem('deviceListViewMode');
            if (savedViewMode === 'tree' || savedViewMode === 'list') {
                this.viewMode = savedViewMode;
            }

            const savedSelectionMode = localStorage.getItem('deviceListSelectionMode');
            if (savedSelectionMode === 'single' || savedSelectionMode === 'all' || savedSelectionMode === 'adaptive') {
                this.selectionMode = savedSelectionMode;
            }

            const savedExpandedNodes = localStorage.getItem('deviceListExpandedNodes');
            if (savedExpandedNodes) {
                const nodes = JSON.parse(savedExpandedNodes);
                if (Array.isArray(nodes)) {
                    this.expandedNodes = new Set(nodes);
                }
            }
        } catch (e) {}

        const modal = document.getElementById('featureModal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeFeatureModal();
                }
            });
        }
    },

    setServerInfo(ip, port) {
        this.serverInfo = { ip, port };
    },

    async loadDeviceEvents() {
        try {
            const res = await fetch('/api/device-events');
            const data = await res.json();
            if (data.status === 'success') {
                this.deviceEvents = data.events || {};
            }
        } catch (err) {
            console.error('[DeviceList] 加载设备事件配置失败:', err);
        }
    },

    async saveDeviceEvent(ip, onConnect, onDisconnect) {
        try {
            const res = await fetch(`/api/device-events/${encodeURIComponent(ip)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ onConnect, onDisconnect })
            });
            const data = await res.json();
            if (data.status === 'success') {
                this.deviceEvents[ip] = data.event;
                if (window.showToast) {
                    window.showToast('事件指令已保存', 'success');
                }
            }
        } catch (err) {
            console.error('[DeviceList] 保存设备事件配置失败:', err);
            if (window.showToast) {
                window.showToast('保存失败', 'error');
            }
        }
    },

    render() {
        this.renderToContainer('deviceList');
        this.renderToContainer('mediaDeviceList');
        this.renderVoiceVadPanel();
        if (window.FloatingControl) {
            window.FloatingControl.updateDisplayList();
        }
        if (this.selectionMode === 'single' && !window.currentDisplayId && this.list.length > 0) {
            const storedId = this.getStoredSelection();
            const preferred = this.list.find((display) => display.id === storedId);
            if (preferred || !storedId) {
                this.select(preferred ? preferred.id : this.list[0].id);
            }
        }
    },

    renderToContainer(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = '';

        if (this.list.length === 0) {
            container.innerHTML = '<div class="empty-list">暂无显示端连接</div>';
            return;
        }

        const headerBar = this.renderHeaderBar();
        container.appendChild(headerBar);

        const contentEl = document.createElement('div');
        contentEl.className = 'device-list-content';
        if (this.viewMode === 'tree') {
            const tree = this.buildTree();
            contentEl.appendChild(this.renderNode(tree, 0));
        } else {
            contentEl.innerHTML = this.renderListView();
        }
        this.bindVoiceListeningControls(contentEl);
        container.appendChild(contentEl);
    },

    renderHeaderBar() {
        const bar = document.createElement('div');
        bar.className = 'device-list-header';

        const selectionBar = document.createElement('div');
        selectionBar.className = 'selection-mode-bar';

        const modes = [
            { key: 'single', label: '单选', icon: '1️⃣' },
            { key: 'all', label: '全选', icon: '🌐' },
            { key: 'adaptive', label: '自适应', icon: '🔀' }
        ];

        for (const mode of modes) {
            const btn = document.createElement('button');
            btn.className = `selection-mode-btn${this.selectionMode === mode.key ? ' active' : ''}`;
            btn.innerHTML = `<span class="selection-mode-icon">${mode.icon}</span>${mode.label}`;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setSelectionMode(mode.key);
            });
            selectionBar.appendChild(btn);
        }

        bar.appendChild(selectionBar);

        const viewToggle = document.createElement('button');
        viewToggle.className = 'view-toggle-btn';
        viewToggle.title = this.viewMode === 'tree' ? '切换到列表视图' : '切换到树形视图';
        viewToggle.innerHTML = this.viewMode === 'tree' ? '📋' : '🌳';
        viewToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleViewMode();
        });
        bar.appendChild(viewToggle);

        return bar;
    },

    renderListView() {
        return this.list.map(d => {
            let isActive = false;
            if (this.selectionMode === 'single') {
                isActive = d.id === window.currentDisplayId;
            } else if (this.selectionMode === 'all') {
                isActive = true;
            }

            let browserInfoHtml = '';
            if (d.browserInfo) {
                const bi = d.browserInfo;
                browserInfoHtml = `
                    <div class="browser-info">
                        <span title="${bi.userAgent}">${bi.browserName} ${bi.browserVersion}</span>
                        <span class="info-sep">|</span>
                        <span>${bi.os}</span>
                        <span class="info-sep">|</span>
                        <span>${bi.deviceType}</span>
                        <span class="info-sep">|</span>
                        <span>${bi.screenWidth}x${bi.screenHeight}</span>
                        ${bi.devicePixelRatio > 1 ? `<span class="info-sep">|</span><span>${bi.devicePixelRatio}x</span>` : ''}
                    </div>
                `;
            }

            let voiceStatusHtml = '';
            if (d.voiceSupported === true) {
                if (d.voiceListening) {
                    voiceStatusHtml = '<span class="voice-status listening" title="语音识别中">语音</span>';
                } else {
                    voiceStatusHtml = '<span class="voice-status ready" title="语音识别就绪">语音</span>';
                }
            } else if (d.voiceSupported === false) {
                voiceStatusHtml = '<span class="voice-status unsupported" title="不支持语音识别">语音</span>';
            }

            const isLandscape = this.isDisplayLandscape(d);
            const directionIndicator = `<span class="direction-indicator ${isLandscape ? 'landscape' : 'portrait'}" title="${isLandscape ? '横向' : '纵向'}">${isLandscape ? '↔' : '↕'}</span>`;

            let subDisplayIndicator = '';
            if (d.isSubDisplay) {
                subDisplayIndicator = '<span class="sub-display-indicator" title="子显示端（语音端）">🎤</span>';
            }

            let capabilityIcons = '';
            if (d.capabilities) {
                const caps = d.capabilities;
                capabilityIcons = `
                    <span class="cap-icon ${caps.mediaRendering ? 'active' : 'inactive'}" title="媒体渲染${caps.mediaRendering ? '' : '（不可用）'}">🖥️</span>
                    <span class="cap-icon ${caps.voicePlayback ? 'active' : 'inactive'}" title="语音播放${caps.voicePlayback ? '' : '（不可用）'}">🔊</span>
                    <span class="cap-icon ${caps.voiceRecording ? 'active' : 'inactive'}" title="语音录音${caps.voiceRecording ? '' : '（不可用）'}">🎙️</span>
                    <span class="cap-icon ${caps.voiceRecognition ? 'active' : 'inactive'}" title="语音识别${caps.voiceRecognition ? '' : '（不可用）'}">🧠</span>
                    <span class="cap-icon ${caps.ttsGeneration ? 'active' : 'inactive'}" title="语音生成${caps.ttsGeneration ? '' : '（不可用）'}">🗣️</span>
                    <span class="cap-icon ${caps.displayText ? 'active' : 'inactive'}" title="文本显示${caps.displayText ? '' : '（不可用）'}">📝</span>
                    <span class="cap-icon ${caps.ocrAvailable ? 'active' : 'inactive'}" title="RapidOCR${caps.ocrAvailable ? '' : '（不可用）'}">🔤</span>
                    <span class="cap-icon ${caps.yolo11nAvailable ? 'active' : 'inactive'}" title="YOLO11n 目标检测${caps.yolo11nAvailable ? '' : '（不可用）'}">🎯</span>
                `;
            }

            return `
                <div class="display-item ${isActive ? 'active' : ''} ${d.isSubDisplay ? 'sub-display' : ''}" onclick="DeviceList.select('${d.id}')">
                    <div class="display-item-content">
                        <div class="display-item-header">
                            <span class="display-item-id">${this.getDisplayLabel(d)}${d.isSubDisplay ? ' <span class="sub-display-tag">子显示端</span>' : ''}</span>
                            <div class="display-item-actions">
                                ${subDisplayIndicator}
                                ${capabilityIcons}
                                ${directionIndicator}
                                ${voiceStatusHtml}
                                <span class="display-item-size">${d.canvasSize.width}x${d.canvasSize.height}</span>
                                ${d.browserInfo ? `<button class="info-btn" onclick="event.stopPropagation();DeviceList.showFeatureModal('${d.id}')">详情</button>` : ''}
                                <button class="info-btn" onclick="event.stopPropagation();DeviceList.showCapabilityEditor('${d.id}')" title="能力设置">⚙️</button>
                            </div>
                        </div>
                        ${browserInfoHtml}
                        ${this.renderVoiceControlHtml(d)}
                    </div>
                </div>
            `;
        }).join('');
    },

    buildTree() {
        const serverNode = {
            id: 'server',
            label: `${this.serverInfo.ip}:${this.serverInfo.port}`,
            icon: '📡',
            expanded: this.expandedNodes.has('server'),
            children: []
        };

        for (const display of this.list) {
            const eventConfig = this.deviceEvents[display.ip] || { onConnect: '', onDisconnect: '' };
            const isSubDisplay = display.isSubDisplay;
            const isSelected = window.currentDisplayId === display.id;

            const displayNode = {
                id: display.id,
                label: this.getDisplayLabel(display),
                icon: isSubDisplay ? '🎤' : '🖥️',
                status: 'online',
                selected: isSelected,
                expanded: this.expandedNodes.has(display.id),
                displayData: display,
                children: [
                    {
                        id: `${display.id}-settings`,
                        label: '画面设置',
                        icon: '⚙️',
                        type: 'settings',
                        expanded: this.expandedNodes.has(`${display.id}-settings`),
                        displayData: display,
                        children: this.buildSettingsChildren(display)
                    },
                    {
                        id: `${display.id}-events`,
                        label: '事件指令',
                        icon: '🔔',
                        type: 'events',
                        expanded: this.expandedNodes.has(`${display.id}-events`),
                        displayData: display,
                        eventConfig: eventConfig,
                        children: this.buildEventsChildren(display, eventConfig)
                    },
                    {
                        id: `${display.id}-info`,
                        label: '浏览器信息',
                        icon: 'ℹ️',
                        type: 'info',
                        expanded: this.expandedNodes.has(`${display.id}-info`),
                        displayData: display,
                        children: this.buildInfoChildren(display)
                    },
                    {
                        id: `${display.id}-capabilities`,
                        label: '设备能力',
                        icon: '⚡',
                        type: 'capabilities',
                        expanded: this.expandedNodes.has(`${display.id}-capabilities`),
                        displayData: display,
                        children: this.buildCapabilitiesChildren(display)
                    }
                ]
            };

            serverNode.children.push(displayNode);
        }

        return serverNode;
    },

    buildSettingsChildren(display) {
        const children = [];

        children.push({
            id: `${display.id}-rotation`,
            label: '旋转',
            type: 'setting-item',
            settingKey: 'rotation',
            value: display.rotation || 0,
            editable: true,
            inputType: 'select',
            options: [
                { value: 0, label: '0°' },
                { value: 90, label: '90°' },
                { value: 180, label: '180°' },
                { value: 270, label: '270°' }
            ]
        });

        children.push({
            id: `${display.id}-fit`,
            label: '填充',
            type: 'setting-item',
            settingKey: 'fit',
            value: display.fit || 'contain',
            editable: true,
            inputType: 'select',
            options: [
                { value: 'contain', label: '适应' },
                { value: 'cover', label: '铺满' },
                { value: 'dynamic', label: '动态' },
                { value: 'height', label: '高度铺满' },
                { value: 'width', label: '宽度铺满' },
                { value: 'crop', label: '裁剪' }
            ]
        });

        children.push({
            id: `${display.id}-volume`,
            label: '音量',
            type: 'setting-item',
            settingKey: 'volume',
            value: display.volume !== undefined ? display.volume : 100,
            editable: true,
            inputType: 'range',
            min: 0,
            max: 100
        });

        children.push({
            id: `${display.id}-canvasSize`,
            label: '画布',
            type: 'setting-item',
            settingKey: 'canvasSize',
            value: `${display.canvasSize?.width || 1920}x${display.canvasSize?.height || 1080}`,
            editable: false
        });

        return children;
    },

    buildEventsChildren(display, eventConfig) {
        return [
            {
                id: `${display.id}-onConnect`,
                label: '连线指令',
                type: 'event-item',
                eventKey: 'onConnect',
                value: eventConfig.onConnect || '',
                editable: true,
                inputType: 'text',
                placeholder: '设备连接时执行的指令'
            },
            {
                id: `${display.id}-onDisconnect`,
                label: '掉线指令',
                type: 'event-item',
                eventKey: 'onDisconnect',
                value: eventConfig.onDisconnect || '',
                editable: true,
                inputType: 'text',
                placeholder: '设备断开时执行的指令'
            }
        ];
    },

    buildInfoChildren(display) {
        const children = [];
        const bi = display.browserInfo;

        if (bi) {
            children.push({
                id: `${display.id}-browser`,
                label: `${bi.browserName || ''} ${bi.browserVersion || ''} | ${bi.os || ''}`,
                type: 'info-item'
            });
            children.push({
                id: `${display.id}-screen`,
                label: `${bi.screenWidth || '?'}x${bi.screenHeight || '?'}${bi.devicePixelRatio > 1 ? ` @ ${bi.devicePixelRatio}x` : ''}`,
                type: 'info-item'
            });
        } else {
            children.push({
                id: `${display.id}-noInfo`,
                label: '暂无信息',
                type: 'info-item'
            });
        }

        return children;
    },

    buildCapabilitiesChildren(display) {
        const children = [];
        const caps = display.capabilities || {
            mediaRendering: true,
            voicePlayback: true,
            voiceRecording: true,
            voiceRecognition: false,
            ttsGeneration: false,
            displayText: true,
            ocrAvailable: false,
            yolo11nAvailable: false
        };

        const capabilityDefinitions = [
            { key: 'mediaRendering', label: '媒体渲染', icon: '🖥️' },
            { key: 'voicePlayback', label: '语音播放', icon: '🔊' },
            { key: 'voiceRecording', label: '语音录音', icon: '🎙️' },
            { key: 'voiceRecognition', label: '语音识别', icon: '🧠' },
            { key: 'ttsGeneration', label: '语音生成', icon: '🗣️' },
            { key: 'displayText', label: '文本显示', icon: '📝' },
            { key: 'ocrAvailable', label: 'RapidOCR 图像文字识别', icon: '🔤', readOnly: true },
            { key: 'yolo11nAvailable', label: 'YOLO11n 目标检测', icon: '🎯', readOnly: true }
        ];

        for (const capDef of capabilityDefinitions) {
            children.push({
                id: `${display.id}-cap-${capDef.key}`,
                label: capDef.label,
                icon: capDef.icon,
                type: 'capability-item',
                capabilityKey: capDef.key,
                value: caps[capDef.key] !== undefined ? caps[capDef.key] : true,
                editable: capDef.readOnly !== true,
                readOnly: capDef.readOnly === true,
                inputType: 'select',
                options: [
                    { value: true, label: '启用' },
                    { value: false, label: '禁用' }
                ]
            });
        }

        return children;
    },

    renderNode(node, depth) {
        const wrapper = document.createElement('div');
        wrapper.className = 'tree-node-wrapper';

        const nodeEl = document.createElement('div');
        nodeEl.className = 'tree-node';
        if (node.selected || node.id === this.selectedNodeId) {
            nodeEl.classList.add('selected');
        }
        nodeEl.style.paddingLeft = `${depth * 16 + 8}px`;

        const hasChildren = node.children && node.children.length > 0;

        if (hasChildren) {
            const toggle = document.createElement('span');
            toggle.className = 'tree-toggle';
            toggle.textContent = node.expanded ? '▼' : '▶';
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleNode(node.id);
            });
            nodeEl.appendChild(toggle);
        } else {
            const spacer = document.createElement('span');
            spacer.className = 'tree-toggle-spacer';
            nodeEl.appendChild(spacer);
        }

        if (node.icon) {
            const icon = document.createElement('span');
            icon.className = 'tree-icon';
            icon.textContent = node.icon;
            nodeEl.appendChild(icon);
        }

        const label = document.createElement('span');
        label.className = 'tree-label';
        label.textContent = node.label;
        nodeEl.appendChild(label);

        if (node.type === 'setting-item') {
            const valueEl = this.renderSettingControl(node);
            if (valueEl) {
                nodeEl.appendChild(valueEl);
            }
        }

        if (node.type === 'event-item') {
            const eventEl = this.renderEventControl(node);
            if (eventEl) {
                nodeEl.appendChild(eventEl);
            }
        }

        if (node.type === 'capability-item') {
            const capEl = this.renderCapabilityControl(node);
            if (capEl) {
                nodeEl.appendChild(capEl);
            }
        }

        if (node.status === 'online') {
            const status = document.createElement('span');
            status.className = 'tree-status online';
            status.title = '在线';
            nodeEl.appendChild(status);
        }

        if (node.type === 'info-item') {
            nodeEl.classList.add('tree-info-item');
        }

        if (node.displayData && node.type === undefined) {
            nodeEl.appendChild(this.renderVoiceControl(node.displayData));
            nodeEl.addEventListener('click', () => {
                this.select(node.id);
            });
        }

        wrapper.appendChild(nodeEl);

        if (hasChildren && node.expanded) {
            const childrenEl = document.createElement('div');
            childrenEl.className = 'tree-children';
            for (const child of node.children) {
                childrenEl.appendChild(this.renderNode(child, depth + 1));
            }
            wrapper.appendChild(childrenEl);
        }

        return wrapper;
    },

    renderVoiceControl(display) {
        const container = document.createElement('div');
        container.className = 'display-voice-control';
        container.addEventListener('click', (event) => event.stopPropagation());

        const capabilities = { voiceRecording: true, ...(display.capabilities || {}) };
        const status = this.getVoiceListeningStatus(display);
        const latest = this.getLatestVoiceInput(display);

        const label = document.createElement('label');
        label.className = 'display-voice-toggle';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = capabilities.voiceRecording === true;
        input.addEventListener('change', (event) => {
            // 监听开关属于设备列表内的独立控件，避免同时触发设备条目选择。
            event.stopPropagation();
            this.updateCapability(display.id, 'voiceRecording', event.target.checked);
        });
        const labelText = document.createElement('span');
        labelText.textContent = '🎙️ 监听';
        label.append(input, labelText);

        const state = document.createElement('span');
        state.className = `display-voice-state ${status.className}`;
        state.textContent = status.label;

        const latestText = document.createElement('span');
        latestText.className = 'display-voice-latest';
        latestText.title = '最近一次语音识别结果';
        latestText.textContent = latest?.text
            ? `最近识别（${latest.isFinal ? '最终' : '实时'}）：${latest.text}`
            : '最近识别：暂无识别回传';

        container.append(label, state, latestText);
        return container;
    },

    renderSettingControl(node) {
        const container = document.createElement('div');
        container.className = 'tree-setting-control';

        if (node.inputType === 'select') {
            const select = document.createElement('select');
            select.className = 'tree-setting-select';
            for (const opt of node.options) {
                const option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.label;
                if (String(opt.value) === String(node.value)) {
                    option.selected = true;
                }
                select.appendChild(option);
            }
            select.addEventListener('change', (e) => {
                e.stopPropagation();
                const value = isNaN(e.target.value) ? e.target.value : Number(e.target.value);
                this.updateSetting(node.id.split('-').slice(0, -1).join('-'), node.settingKey, value);
            });
            select.addEventListener('click', (e) => e.stopPropagation());
            container.appendChild(select);
        } else if (node.inputType === 'range') {
            const rangeWrap = document.createElement('div');
            rangeWrap.className = 'tree-setting-range-wrap';

            const range = document.createElement('input');
            range.type = 'range';
            range.className = 'tree-setting-range';
            range.min = node.min || 0;
            range.max = node.max || 100;
            range.value = node.value;

            const valueLabel = document.createElement('span');
            valueLabel.className = 'tree-setting-range-value';
            valueLabel.textContent = `${node.value}%`;

            range.addEventListener('input', (e) => {
                e.stopPropagation();
                valueLabel.textContent = `${e.target.value}%`;
            });
            range.addEventListener('change', (e) => {
                e.stopPropagation();
                this.updateSetting(node.id.split('-').slice(0, -1).join('-'), node.settingKey, Number(e.target.value));
            });
            range.addEventListener('click', (e) => e.stopPropagation());

            rangeWrap.appendChild(range);
            rangeWrap.appendChild(valueLabel);
            container.appendChild(rangeWrap);
        }

        return container;
    },

    renderEventControl(node) {
        const container = document.createElement('div');
        container.className = 'tree-event-control';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tree-event-input';
        input.value = node.value;
        input.placeholder = node.placeholder || '';
        input.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('change', (e) => {
            e.stopPropagation();
        });

        const saveBtn = document.createElement('button');
        saveBtn.className = 'tree-event-save';
        saveBtn.textContent = '保存';
        saveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const displayId = node.id.replace(`-${node.eventKey}`, '');
            const display = this.list.find(d => d.id === displayId);
            if (!display) return;

            const ip = display.ip;
            const currentEvents = this.deviceEvents[ip] || { onConnect: '', onDisconnect: '' };
            currentEvents[node.eventKey] = input.value;
            this.saveDeviceEvent(ip, currentEvents.onConnect, currentEvents.onDisconnect);
        });

        container.appendChild(input);
        container.appendChild(saveBtn);

        return container;
    },

    renderCapabilityControl(node) {
        const container = document.createElement('div');
        container.className = 'tree-capability-control';

        if (node.readOnly === true) {
            const status = document.createElement('span');
            status.className = `tree-capability-status ${node.value ? 'active' : 'inactive'}`;
            status.textContent = node.value ? '已检测到' : '不可用';
            container.appendChild(status);
            return container;
        }

        const select = document.createElement('select');
        select.className = 'tree-capability-select';
        for (const opt of node.options) {
            const option = document.createElement('option');
            option.value = String(opt.value);
            option.textContent = opt.label;
            if (String(opt.value) === String(node.value)) {
                option.selected = true;
            }
            select.appendChild(option);
        }
        select.addEventListener('change', (e) => {
            e.stopPropagation();
            const value = e.target.value === 'true';
            this.updateCapability(node.id, node.capabilityKey, value);
        });
        select.addEventListener('click', (e) => e.stopPropagation());
        container.appendChild(select);

        return container;
    },

    toggleNode(nodeId) {
        if (this.expandedNodes.has(nodeId)) {
            this.expandedNodes.delete(nodeId);
        } else {
            this.expandedNodes.add(nodeId);
        }
        try { localStorage.setItem('deviceListExpandedNodes', JSON.stringify([...this.expandedNodes])); } catch (e) {}
        this.render();
    },

    select(id) {
        if (window.MediaLibrary && typeof window.MediaLibrary.clearPlaylistPanel === 'function') {
            window.MediaLibrary.clearPlaylistPanel();
        }
        this.selectedNodeId = id;
        window.currentDisplayId = id;
        try {
            localStorage.setItem('selectedDisplayId', id);
        } catch (e) {
            console.warn('[DeviceList] 保存显示端选择失败:', e.message);
        }
        this.render();

        if (window.FloatingControl) {
            window.FloatingControl.setSelectedDisplay(id);
        }

        const display = this.list.find(d => d.id === id);
        if (display) {
            window.displayCanvasSize = display.canvasSize;
            if (window.Crop) {
                window.Crop.updateContainerSize();
            }
        }

        if (window.WebSocketManager && window.WebSocketManager.ws && window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'getState',
                displayId: id
            }));
        }
    },

    updateSetting(displayId, key, value) {
        if (window.WebSocketManager && window.WebSocketManager.ws && window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'control',
                displayId: displayId,
                action: key,
                value: value
            }));
        }

        const display = this.list.find(d => d.id === displayId);
        if (display) {
            if (key === 'rotation') display.rotation = value;
            else if (key === 'fit') display.fit = value;
            else if (key === 'volume') display.volume = value;
        }

        if (window.showToast) {
            window.showToast(`${key} 已更新`, 'success');
        }
    },

    updateCapability(nodeId, key, value) {
        const displayId = nodeId.replace(`-cap-${key}`, '');
        const display = this.list.find(d => d.id === displayId);
        if (!display) return;

        const capabilities = display.capabilities || {
            mediaRendering: true,
            voicePlayback: true,
            voiceRecording: true,
                voiceRecognition: false,
                ttsGeneration: false,
                displayText: true,
                ocrAvailable: false,
                yolo11nAvailable: false
        };

        capabilities[key] = value;

        if (window.WebSocketManager && window.WebSocketManager.ws && window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'updateCapabilities',
                displayId: displayId,
                capabilities: capabilities
            }));
        }

        display.capabilities = capabilities;

        if (window.showToast) {
            const labelMap = {
                mediaRendering: '媒体渲染',
                voicePlayback: '语音播放',
                voiceRecording: '语音录音',
                voiceRecognition: '语音识别',
                ttsGeneration: '语音生成',
                displayText: '文本显示'
            };
            window.showToast(`${labelMap[key] || key} 已${value ? '启用' : '禁用'}`, 'success');
        }
    },

    showFeatureModal(displayId) {
        const display = this.list.find(d => d.id === displayId);
        if (!display || !display.browserInfo) return;

        const bi = display.browserInfo;

        const browserDetail = document.getElementById('browserDetail');
        browserDetail.innerHTML = `
            <div class="browser-detail-row">
                <span class="browser-detail-label">浏览器</span>
                <span class="browser-detail-value">${bi.browserName} ${bi.browserVersion}</span>
            </div>
            <div class="browser-detail-row">
                <span class="browser-detail-label">操作系统</span>
                <span class="browser-detail-value">${bi.os}</span>
            </div>
            <div class="browser-detail-row">
                <span class="browser-detail-label">设备类型</span>
                <span class="browser-detail-value">${bi.deviceType}</span>
            </div>
            <div class="browser-detail-row">
                <span class="browser-detail-label">屏幕分辨率</span>
                <span class="browser-detail-value">${bi.screenWidth} x ${bi.screenHeight}</span>
            </div>
            <div class="browser-detail-row">
                <span class="browser-detail-label">设备像素比</span>
                <span class="browser-detail-value">${bi.devicePixelRatio}x</span>
            </div>
            <div class="browser-detail-row">
                <span class="browser-detail-label">IP 地址</span>
                <span class="browser-detail-value">${display.ip || 'unknown'}</span>
            </div>
        `;

        const featureList = document.getElementById('featureList');
        var features = [];
        if (bi.featureSupport && bi.featureSupport.length > 0) {
            for (var i = 0; i < bi.featureSupport.length; i++) {
                var f = bi.featureSupport[i];
                // WebGPU 改用 detectCapabilities 的真实结果
                var supported = f.supported;
                if (f.name === 'WebGPU') {
                    supported = !!(display.capabilities && display.capabilities.webgpu);
                }
                features.push({ name: f.name, note: f.note, supported: supported });
            }
        }
        // 如果 capabilities 有 webgpu 字段但 featureSupport 没有，补充一条
        if (display.capabilities && display.capabilities.webgpu !== undefined) {
            var hasWebgpuInFs = features.some(function(f) { return f.name === 'WebGPU'; });
            if (!hasWebgpuInFs) {
                features.push({ name: 'WebGPU', note: 'GPU加速计算（实时探测）', supported: !!display.capabilities.webgpu });
            }
        }
        if (features.length > 0) {
            featureList.innerHTML = features.map(function(f) { return (
                '<div class="feature-item">' +
                    '<div class="feature-name">' +
                        '<span>' + f.name + '</span>' +
                        '<span>' + f.note + '</span>' +
                    '</div>' +
                    '<span class="feature-badge ' + (f.supported ? 'supported' : 'unsupported') + '">' +
                        (f.supported ? '支持' : '不支持') +
                    '</span>' +
                '</div>'
            ); }).join('');
        } else {
            featureList.innerHTML = '<div style="text-align:center;color:#666;padding:20px;">暂无功能支持信息</div>';
        }

        document.getElementById('featureModal').classList.add('active');
    },

    closeFeatureModal() {
        document.getElementById('featureModal').classList.remove('active');
    },

    showCapabilityEditor(displayId) {
        const display = this.list.find(d => d.id === displayId);
        if (!display) return;

        const caps = display.capabilities || {
            mediaRendering: true,
            voicePlayback: true,
            voiceRecording: true,
            voiceRecognition: false,
            ttsGeneration: false,
            displayText: true
        };

        const existing = document.getElementById('capabilityModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'capabilityModal';
        modal.className = 'capability-modal';
        modal.innerHTML = `
            <div class="capability-editor">
                <h3>显示端 ${display.ip || 'unknown'} 能力设置</h3>
                <div class="capability-list">
                    <label class="capability-item">
                        <input type="checkbox" ${caps.mediaRendering ? 'checked' : ''} data-cap="mediaRendering">
                        <span>🖥️ 媒体渲染</span>
                        <span class="capability-desc">能显示图片/视频</span>
                    </label>
                    <label class="capability-item">
                        <input type="checkbox" ${caps.voicePlayback ? 'checked' : ''} data-cap="voicePlayback">
                        <span>🔊 语音播放</span>
                        <span class="capability-desc">语音播放为手动路由开关，开启后可作为文本TTS播报设备</span>
                    </label>
                    <label class="capability-item">
                        <input type="checkbox" ${caps.voiceRecording ? 'checked' : ''} data-cap="voiceRecording">
                        <span>🎙️ 语音录音</span>
                        <span class="capability-desc">能录制音频</span>
                    </label>
                    <label class="capability-item">
                        <input type="checkbox" ${caps.voiceRecognition ? 'checked' : ''} data-cap="voiceRecognition">
                        <span>🧠 语音识别</span>
                        <span class="capability-desc">能进行语音识别</span>
                    </label>
                    <label class="capability-item">
                        <input type="checkbox" ${caps.ttsGeneration ? 'checked' : ''} data-cap="ttsGeneration">
                        <span>🗣️ 语音生成</span>
                        <span class="capability-desc">能在显示端离线合成语音</span>
                    </label>
                    <label class="capability-item">
                        <input type="checkbox" ${caps.displayText ? 'checked' : ''} data-cap="displayText">
                        <span>📝 文本显示</span>
                        <span class="capability-desc">能显示文字覆盖层</span>
                    </label>
                    <label class="capability-item capability-readonly">
                        <input type="checkbox" ${caps.ocrAvailable ? 'checked' : ''} data-cap="ocrAvailable" disabled>
                        <span>🔤 RapidOCR 图像文字识别</span>
                        <span class="capability-desc">正式 APK 原生能力，只读</span>
                    </label>
                    <label class="capability-item capability-readonly">
                        <input type="checkbox" ${caps.yolo11nAvailable ? 'checked' : ''} data-cap="yolo11nAvailable" disabled>
                        <span>🎯 YOLO11n 目标检测</span>
                        <span class="capability-desc">正式 APK 原生能力，只读</span>
                    </label>
                </div>
                <div class="capability-actions">
                    <button class="capability-save-btn" onclick="DeviceList.saveCapabilities('${displayId}')">保存</button>
                    <button class="capability-cancel-btn" onclick="DeviceList.closeCapabilityEditor()">取消</button>
                </div>
            </div>
        `;

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeCapabilityEditor();
            }
        });

        document.body.appendChild(modal);
    },

    saveCapabilities(displayId) {
        const checkboxes = document.querySelectorAll('#capabilityModal input[type="checkbox"]');
        const capabilities = {};
        checkboxes.forEach(cb => {
            capabilities[cb.dataset.cap] = cb.checked;
        });

        if (window.WebSocketManager && window.WebSocketManager.ws && window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'updateCapabilities',
                displayId: displayId,
                capabilities: capabilities
            }));
        }

        this.closeCapabilityEditor();
    },

    closeCapabilityEditor() {
        const modal = document.getElementById('capabilityModal');
        if (modal) modal.remove();
    },

    setDisplayList(list) {
        const nextList = list || [];
        const onlineIds = new Set(nextList.map((display) => display.id));
        for (const displayId of this.voiceInputByDisplay.keys()) {
            if (!onlineIds.has(displayId)) this.voiceInputByDisplay.delete(displayId);
        }
        for (const displayId of this.voiceVadNoiseByDisplay.keys()) {
            if (!onlineIds.has(displayId)) this.voiceVadNoiseByDisplay.delete(displayId);
        }
        for (const displayId of this.voiceVadNoisePending.keys()) {
            if (!onlineIds.has(displayId)) this.voiceVadNoisePending.delete(displayId);
        }
        for (const displayId of this.displayRecordingByDisplay.keys()) {
            if (!onlineIds.has(displayId)) this.cleanupDisplayRecordingResources(displayId);
        }
        for (const displayId of this.displayRecordingPlaybackByDisplay.keys()) {
            if (!onlineIds.has(displayId)) this.cleanupDisplayRecordingResources(displayId);
        }
        for (const displayId of this.displayRealtimePlaybackByDisplay.keys()) {
            if (!onlineIds.has(displayId)) this.cleanupDisplayRecordingResources(displayId);
        }
        this.list = nextList.map((display) => ({
            ...display,
            lastVoiceInput: this.voiceInputByDisplay.get(display.id) || display.lastVoiceInput || null
        }));
        const selectedStillOnline = this.list.some((display) => display.id === window.currentDisplayId);
        if (!selectedStillOnline) {
            window.currentDisplayId = null;
            this.selectedNodeId = null;
        }
        this.render();
    }
};

window.selectDisplay = DeviceList.select.bind(DeviceList);
window.showFeatureModal = DeviceList.showFeatureModal.bind(DeviceList);
window.closeFeatureModal = DeviceList.closeFeatureModal.bind(DeviceList);
window.DisplayList = DeviceList;
window.DeviceList = DeviceList;
window.DeviceTree = DeviceList;
