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
        mediaRecorder: null,
        audioChunks: [],
        speakers: {},

        init() {
            document.getElementById('vpNameInput').addEventListener('keydown', e => {
                if (e.key === 'Enter') this.toggleRecord();
            });
            document.getElementById('vpEnabledCheck').addEventListener('change', () => this.saveConfig());
            document.getElementById('vpMultiCheck').addEventListener('change', () => this.saveConfig());
            document.getElementById('vpExtractionSel').addEventListener('change', () => this.saveConfig());
            this.loadConfig();
            this.refreshList();
        },

        async loadConfig() {
            try {
                const r = await fetch('/api/voiceprint/config');
                const c = await r.json();
                document.getElementById('vpEnabledCheck').checked = !!c.enabled;
                document.getElementById('vpMultiCheck').checked = !!c.multiSpeaker;
                document.getElementById('vpExtractionSel').value = c.extraction || 'server';
            } catch (e) { console.warn('加载声纹配置失败:', e); }
        },

        async saveConfig() {
            const body = {
                enabled: document.getElementById('vpEnabledCheck').checked,
                multiSpeaker: document.getElementById('vpMultiCheck').checked,
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

        async toggleRecord() {
            if (this.recording) { this.stopRecord(); return; }
            const name = document.getElementById('vpNameInput').value.trim();
            if (!name) {
                document.getElementById('vpRecordStatus').textContent = '请先输入名字';
                return;
            }
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                this.mediaRecorder = new MediaRecorder(stream);
                this.audioChunks = [];
                this.mediaRecorder.ondataavailable = e => { if (e.data.size > 0) this.audioChunks.push(e.data); };
                this.mediaRecorder.onstop = () => this.register(name);
                this.mediaRecorder.start();
                this.recording = true;
                document.getElementById('vpRecordBtn').textContent = '录音中...点击停止';
                document.getElementById('vpStopBtn').style.display = '';
                document.getElementById('vpRecordStatus').textContent = '正在录音，请说出要注册的声音';
                stream.getTracks().forEach(t => t.addEventListener('ended', () => {
                    if (this.recording) this.stopRecord();
                }));
            } catch (e) {
                document.getElementById('vpRecordStatus').textContent = '录音失败: ' + e.message;
            }
        },

        stopRecord() {
            if (!this.recording) return;
            this.recording = false;
            if (this.mediaRecorder && this.mediaRecorder.state === 'recording') this.mediaRecorder.stop();
            if (this.mediaRecorder && this.mediaRecorder.stream) {
                this.mediaRecorder.stream.getTracks().forEach(t => t.stop());
            }
            document.getElementById('vpRecordBtn').textContent = '🎤 录音注册';
            document.getElementById('vpStopBtn').style.display = 'none';
        },

        async register(name) {
            document.getElementById('vpRecordStatus').textContent = '正在注册...';
            try {
                const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
                const formData = new FormData();
                formData.append('name', name);
                formData.append('audio', blob, 'voiceprint.webm');
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
                list.innerHTML = names.map(n => {
                    const safe = escapeHtml(n);
                    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.08);">' +
                        '<span>' + safe + '</span>' +
                        '<button class="control-btn" onclick="VoiceprintPanel.remove(\'' + safe.replace(/'/g, "\\'") + '\')">删除</button>' +
                        '</div>';
                }).join('');
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
