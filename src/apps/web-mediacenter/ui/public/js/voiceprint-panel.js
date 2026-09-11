// 控制端声纹管理面板：注册/列表/删除/配置切换
(function() {
    'use strict';
    // 用户可控的说话人名字渲染进 innerHTML 前必须 HTML 转义（防存储型 XSS）
    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }
    const panel = {
        recording: false,
        pcmCapture: null,
        recordingStream: null,
        recordingName: '',
        speakers: {},
        conversationConfirmationMode: 'off',

        init() {
            document.getElementById('vpNameInput').addEventListener('keydown', e => {
                if (e.key === 'Enter') this.toggleRecord();
            });
            document.getElementById('vpEnabledCheck').addEventListener('change', () => this.saveConfig());
            document.getElementById('vpMultiCheck').addEventListener('change', () => this.saveConfig());
            document.getElementById('vpDenoiseCheck').addEventListener('change', () => this.saveConfig());
            document.getElementById('vpPauseRecordingDuringPlaybackCheck').addEventListener('change', () => this.saveConfig());
            document.getElementById('vpAsrResultDetailLogCheck').addEventListener('change', () => this.saveConfig());
            document.getElementById('vpMultiModeSel').addEventListener('change', () => this.saveConfig());
            document.getElementById('vpSpeakerCountSel').addEventListener('change', () => this.saveConfig());
            document.getElementById('vpThresholdInput').addEventListener('change', () => this.saveConfig());
            document.getElementById('vpExtractionSel').addEventListener('change', () => this.saveConfig());
            document.getElementById('serverAsrEnabledCheck').addEventListener('change', () => this.saveServerVoiceConfig());
            document.getElementById('serverTtsEnabledCheck').addEventListener('change', () => this.saveServerVoiceConfig());
            this.loadConfig();
            this.loadServerVoiceConfig();
            this.loadRepairModeConfig();
            this.refreshList();
            this.bindRemoveDelegation();
            this.renderConversationConfirmationPanel();
        },

        renderConversationConfirmationPanel() {
            const panel = document.getElementById('voiceConversationConfirmationPanel');
            if (!panel) return;
            const modes = [
                { value: 'off', label: '关闭：直接发送' },
                { value: 'manual', label: '手动确认：等待30秒' },
                { value: 'auto', label: '自动确认：7秒内可取消' }
            ];
            panel.innerHTML = `
                <label class="voice-confirmation-mode">
                    确认模式
                    <select data-conversation-confirmation-mode>
                        ${modes.map(({ value, label }) => `<option value="${value}"${value === this.conversationConfirmationMode ? ' selected' : ''}>${label}</option>`).join('')}
                    </select>
                </label>
            `;
            if (!panel.dataset.bound) {
                panel.dataset.bound = '1';
                panel.addEventListener('change', (event) => {
                    const select = event.target.closest('[data-conversation-confirmation-mode]');
                    if (!select) return;
                    this.setConversationConfirmationMode(select.value);
                });
            }
        },

        setConversationConfirmationMode(mode) {
            if (!['off', 'manual', 'auto'].includes(mode)) return false;
            if (!window.WebSocketManager?.ws || window.WebSocketManager.ws.readyState !== WebSocket.OPEN) {
                if (window.showToast) window.showToast('对话确认配置发送失败：控制端未连接', 'error');
                return false;
            }
            this.conversationConfirmationMode = mode;
            this.renderConversationConfirmationPanel();
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'setConversationConfirmationConfig',
                mode
            }));
            return true;
        },

        handleConversationConfirmationConfig(data) {
            if (!['off', 'manual', 'auto'].includes(data?.mode)) return;
            this.conversationConfirmationMode = data.mode;
            this.renderConversationConfirmationPanel();
        },

        // 委托点击：读取 data-name 删除（避免内联 onclick 的用户输入注入）
        bindRemoveDelegation() {
            const list = document.getElementById('vpSpeakerList');
            if (list && !list.dataset.vpBound) {
                list.dataset.vpBound = '1';
                list.addEventListener('click', (e) => {
                    const btn = e.target.closest('.vp-remove-btn');
                    if (btn) {
                        const name = btn.getAttribute('data-name');
                        if (name) this.remove(name);
                    }
                });
            }
        },

        async loadConfig() {
            try {
                const r = await fetch('/api/voiceprint/config');
                const c = await r.json();
                document.getElementById('vpEnabledCheck').checked = !!c.enabled;
                document.getElementById('vpMultiCheck').checked = !!c.multiSpeaker;
                document.getElementById('vpDenoiseCheck').checked = !!c.denoise;
                document.getElementById('vpPauseRecordingDuringPlaybackCheck').checked = c.pauseRecordingDuringPlayback !== false;
                document.getElementById('vpAsrResultDetailLogCheck').checked = c.asrResultDetailLog !== false;
                document.getElementById('vpMultiModeSel').value = c.multiMode || 'fast';
                document.getElementById('vpSpeakerCountSel').value = c.speakerCount || 'AUTO';
                const threshold = Number(c.threshold);
                document.getElementById('vpThresholdInput').value = Number.isFinite(threshold) ? threshold : 0.3;
                document.getElementById('vpExtractionSel').value = c.extraction || 'server';
            } catch (e) { console.warn('加载声纹配置失败:', e); }
        },

        applyServerVoiceConfig(data) {
            if (!data || data.status && data.status !== 'success') return;
            const asrEnabled = data.asrEnabled !== false;
            const ttsEnabled = data.ttsEnabled !== false;
            const asrCheck = document.getElementById('serverAsrEnabledCheck');
            const ttsCheck = document.getElementById('serverTtsEnabledCheck');
            if (asrCheck) asrCheck.checked = asrEnabled;
            if (ttsCheck) ttsCheck.checked = ttsEnabled;
            window.AsrDevice?.handleServerEnabledChanged(asrEnabled);
            window.TtsDevice?.handleServerEnabledChanged(ttsEnabled);
            if (data.asrDevice) window.AsrDevice?.handleDeviceChanged(data.asrDevice);
            if (data.ttsDevice) window.TtsDevice?.handleDeviceChanged(data.ttsDevice);
        },

        async loadServerVoiceConfig() {
            try {
                const response = await fetch('/api/config/serverVoice');
                const data = await response.json();
                if (data.status !== 'success') return;
                this.applyServerVoiceConfig(data);
            } catch (e) { console.warn('加载服务器语音开关失败:', e); }
        },

        applyRepairModeConfig(data) {
            if (!data || data.status && data.status !== 'success') return;
            const roleSelect = document.getElementById('repairModeRole');
            const status = document.getElementById('repairModePasswordStatus');
            if (!roleSelect || !status) return;

            const roles = Array.isArray(data.roles) ? data.roles : [];
            roleSelect.innerHTML = roles.map((role) => {
                const safeRole = escapeHtml(role);
                const selected = role === data.role ? ' selected' : '';
                return `<option value="${safeRole}"${selected}>${safeRole}</option>`;
            }).join('');
            if (data.role && roles.includes(data.role)) roleSelect.value = data.role;
            status.textContent = data.passwordConfigured
                ? '密码已配置（不会回显密码）'
                : '未配置密码，修复模式当前停用';
        },

        async loadRepairModeConfig() {
            try {
                const response = await fetch('/api/repair-mode/config');
                const data = await response.json();
                this.applyRepairModeConfig(data);
            } catch (e) {
                console.warn('加载修复模式配置失败:', e);
                const status = document.getElementById('repairModePasswordStatus');
                if (status) status.textContent = '修复模式配置加载失败';
            }
        },

        async saveRepairModeConfig() {
            const role = document.getElementById('repairModeRole')?.value || '';
            const password = document.getElementById('repairModePassword')?.value || '';
            const clearPassword = document.getElementById('repairModeClearPassword')?.checked === true;
            const body = { role };
            if (clearPassword) {
                body.clearPassword = true;
            } else if (password.trim()) {
                body.password = password;
            }

            try {
                const response = await fetch('/api/repair-mode/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const data = await response.json();
                if (data.status !== 'success') {
                    window.showToast?.(data.message || '修复模式配置保存失败', 'error');
                    return;
                }
                const passwordInput = document.getElementById('repairModePassword');
                const clearInput = document.getElementById('repairModeClearPassword');
                if (passwordInput) passwordInput.value = '';
                if (clearInput) clearInput.checked = false;
                this.applyRepairModeConfig(data);
                window.showToast?.('修复模式配置已更新', 'success');
            } catch (e) {
                window.showToast?.('修复模式配置保存失败: ' + e.message, 'error');
            }
        },

        async saveConfig() {
            const threshold = Number(document.getElementById('vpThresholdInput').value);
            if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
                window.showToast?.('声纹相似度阈值必须是 (0,1] 的数值', 'error');
                return;
            }
            const body = {
                enabled: document.getElementById('vpEnabledCheck').checked,
                multiSpeaker: document.getElementById('vpMultiCheck').checked,
                denoise: document.getElementById('vpDenoiseCheck').checked,
                pauseRecordingDuringPlayback: document.getElementById('vpPauseRecordingDuringPlaybackCheck').checked,
                asrResultDetailLog: document.getElementById('vpAsrResultDetailLogCheck').checked,
                multiMode: document.getElementById('vpMultiModeSel').value,
                speakerCount: document.getElementById('vpSpeakerCountSel').value,
                threshold: threshold,
                extraction: document.getElementById('vpExtractionSel').value
            };
            try {
                await fetch('/api/voiceprint/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
            } catch (e) { console.warn('保存声纹配置失败:', e); }
        },

        async saveServerVoiceConfig() {
            const asrEnabled = document.getElementById('serverAsrEnabledCheck').checked;
            const ttsEnabled = document.getElementById('serverTtsEnabledCheck').checked;
            try {
                const response = await fetch('/api/config/serverVoice', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ asrEnabled, ttsEnabled })
                });
                const data = await response.json();
                if (data.status !== 'success') {
                    window.showToast?.(data.message || '服务器语音开关保存失败', 'error');
                    return;
                }
                this.applyServerVoiceConfig(data);
                window.showToast?.('服务器语音开关已更新', 'success');
            } catch (e) {
                window.showToast?.('服务器语音开关保存失败: ' + e.message, 'error');
            }
        },

        async toggleRecord() {
            if (this.recording) { this.stopRecord(); return; }
            const name = document.getElementById('vpNameInput').value.trim();
            if (!name) {
                document.getElementById('vpRecordStatus').textContent = '请先输入名字';
                return;
            }
            let stream = null;
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: false,
                        noiseSuppression: false,
                        sampleRate: 16000
                    }
                });
                this.recordingStream = stream;
                this.pcmCapture = new PcmAudioCapture().start(stream);
                this.recordingName = name;
                this.recording = true;
                document.getElementById('vpRecordBtn').textContent = '录音中...点击停止';
                document.getElementById('vpStopBtn').style.display = '';
                document.getElementById('vpRecordStatus').textContent = '正在录音，请说出要注册的声音';
                stream.getTracks().forEach(t => t.addEventListener('ended', () => {
                    if (this.recording) this.stopRecord();
                }));
            } catch (e) {
                if (this.pcmCapture) {
                    this.pcmCapture.stop();
                    this.pcmCapture = null;
                }
                if (stream) stream.getTracks().forEach(track => track.stop());
                document.getElementById('vpRecordStatus').textContent = '录音失败: ' + e.message;
            }
        },

        stopRecord() {
            if (!this.recording) return;
            this.recording = false;
            const wav = this.pcmCapture ? this.pcmCapture.stopWav() : null;
            this.pcmCapture = null;
            if (this.recordingStream) {
                this.recordingStream.getTracks().forEach(track => track.stop());
                this.recordingStream = null;
            }
            const name = this.recordingName;
            this.recordingName = '';
            document.getElementById('vpRecordBtn').textContent = '🎤 录音注册';
            document.getElementById('vpStopBtn').style.display = 'none';
            if (wav) void this.register(name, wav);
        },

        async register(name, audioBlob) {
            document.getElementById('vpRecordStatus').textContent = '正在注册...';
            try {
                const formData = new FormData();
                formData.append('name', name);
                formData.append('audio', audioBlob, 'voiceprint.wav');
                const r = await fetch('/api/voiceprint/register', { method: 'POST', body: formData });
                const data = await r.json();
                document.getElementById('vpRecordStatus').textContent = data.message || (data.status === 'success' ? '注册成功' : '注册失败');
                if (data.status === 'success') this.refreshList();
            } catch (e) {
                document.getElementById('vpRecordStatus').textContent = '注册失败: ' + e.message;
            }
        },

        async refreshList() {
            try {
                const r = await fetch('/api/voiceprint/db');
                const db = await r.json();
                this.speakers = db.speakers || {};
                const list = document.getElementById('vpSpeakerList');
                const names = Object.keys(this.speakers);
                if (names.length === 0) {
                    list.innerHTML = '<span style="font-size:12px;color:rgba(255,255,255,0.4);">暂无已注册声纹</span>';
                    return;
                }
                list.innerHTML = names.map(n =>
                    '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.08);">' +
                    '<span>' + escapeHtml(n) + '</span>' +
                    '<button class="control-btn vp-remove-btn" data-name="' + escapeHtml(n) + '">删除</button>' +
                    '</div>'
                ).join('');
            } catch (e) { console.warn('加载声纹列表失败:', e); }
        },

        async remove(name) {
            if (!confirm('确认删除 ' + name + ' 的声纹？')) return;
            try {
                await fetch('/api/voiceprint/remove', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name })
                });
                this.refreshList();
            } catch (e) { console.warn('删除声纹失败:', e); }
        }
    };

    window.VoiceprintPanel = panel;
    // 面板切换到 voiceprint 时初始化
    document.addEventListener('DOMContentLoaded', () => {
        const observer = new MutationObserver(() => {
            const vp = document.getElementById('panel-voiceprint');
            if (vp && vp.style.display !== 'none') {
                panel.init();
                observer.disconnect();
            }
        });
        observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['style'] });
        // 若已可见则直接初始化，并断开观察器避免再次 init 造成重复事件监听
        const vp = document.getElementById('panel-voiceprint');
        if (vp && vp.style.display !== 'none') {
            panel.init();
            observer.disconnect();
        }
    });
})();
