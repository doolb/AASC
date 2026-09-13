const Chat = {
    history: [],
    temporaryConversation: {
        id: null,
        startedAt: null,
        displayId: null,
        roleName: null,
        templateId: null,
        messages: []
    },
    temporaryRoleSelection: '',
    temporaryRolePending: false,
    templates: [],
    config: {
        systemPrompt: '你是一个友好的助手，请用简洁的语言回答问题。',
        agentBackend: 'codex'
    },
    assistantConfig: {
        defaultName: '小爱',
        assistants: [
            { name: '小爱', template: '你是小爱，一个友好、活泼的智能助手。请用简洁、亲切的语言回答问题。' }
        ]
    },
    session: {
        mode: 'group',
        privateTarget: null,
        roleTarget: null,
        privateSessionId: 'default',
        playOnControl: false,
        commandMode: true,
        sessions: {}
    },
    aiRoles: [],          // 工作 AI 角色列表 [{name, createdAt, running}]
    roleCatalog: [],      // workgroup/members 候选列表
    pendingRoleAdd: '',   // 等待服务端广播 roleList 确认的成员名
    roleHistories: {},    // 每个角色的独立对话历史
    commands: {
        commands: {}
    },
    builtinCommands: null,
    searchHistory: [],
    isLoading: false,
    currentStreamingMessage: '',
    activeRequestId: null,
    requestCounter: 0,
    currentUserMessage: '',
    isListening: false,
    pcmCapture: null,
    asrSupported: false,
    audioQueue: [],
    isPlayingAudio: false,
    currentAudio: null,
    silenceStartTime: null,
    audioContext: null,
    analyser: null,
    micStream: null,
    hasSpeech: false,
    speechStartTime: null,
    recordingStartTime: null,
    isAlwaysListening: false,
    wasListeningBeforePlayback: false,
    noInterruptMode: true,
    profiles: [],
    activeProfile: '',
    editingTemplateName: null,
    // 图片只保留在当前待发送消息中，实时预览帧不会进入这里。
    pendingImages: [],

    init() {
        this.loadHistory();
        this.loadTemplates();
        this.loadConfig();
        this.loadProfiles();
        this.loadAssistantConfig();
        this.loadSearchHistory();
        this.loadSession();
        this.loadAiRoles();
        this.loadCommands();
        this.loadBuiltinCommands();
        this.initVoiceRecognition();
        this.render();
    },

    onWebSocketOpen() {
        this.loadHistory();
        this.loadSession();
        this.loadAiRoles();
        this.loadCommands();
        this.loadBuiltinCommands();
        this.loadProfiles();
        this.requestTemporaryConversation();
    },
    
    async initVoiceRecognition() {
        try {
            const response = await fetch('/api/asr/status');
            const data = await response.json();
            this.asrSupported = data.ready;
            
            if (this.asrSupported) {
                console.log('本地 ASR 服务可用');
            } else {
                console.log('ASR 服务未初始化，请检查模型文件');
            }
        } catch (e) {
            console.log('ASR 服务不可用:', e.message);
            this.asrSupported = false;
        }
    },
    
    toggleVoice() {
        if (this.isListening) {
            this.stopListening();
        } else {
            this.startListening();
        }
    },
    
    async startListening() {
        if (this.isListening) return;
        
        try {
            this.micStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    // 语音输入统一使用原始 PCM，关闭浏览器隐式音频处理。
                    echoCancellation: false,
                    noiseSuppression: false,
                    sampleRate: 16000
                }
            });
            this.pcmCapture = new PcmAudioCapture().start(this.micStream);
            this.isListening = true;
            this.updateVoiceButton();
            this.silenceStartTime = null;
            this.hasSpeech = false;
            this.speechStartTime = null;
            this.recordingStartTime = Date.now();
            console.log('语音录制已启动');
            
            this.startSilenceDetection();
            
        } catch (e) {
            console.error('麦克风访问失败:', e);
            if (this.pcmCapture) {
                this.pcmCapture.stop();
                this.pcmCapture = null;
            }
            if (this.micStream) {
                this.micStream.getTracks().forEach(track => track.stop());
                this.micStream = null;
            }
            let msg = '无法访问麦克风';
            if (e.name === 'NotAllowedError') {
                msg = '麦克风权限被拒绝';
            } else if (e.name === 'NotFoundError') {
                msg = '未找到麦克风设备';
            }
            window.showToast(msg, 'error');
        }
    },
    
    stopListening() {
        const audioBlob = this.pcmCapture ? this.pcmCapture.stopWav() : null;
        this.pcmCapture = null;
        if (this.micStream) {
            this.micStream.getTracks().forEach(track => track.stop());
            this.micStream = null;
        }
        this.isListening = false;
        this.hasSpeech = false;
        this.speechStartTime = null;
        this.silenceStartTime = null;
        this.updateVoiceButton();
        this.stopSilenceDetection();
        console.log('语音录制已停止');
        if (audioBlob) void this.sendAudioForRecognition(audioBlob);
    },
    
    startSilenceDetection() {
        if (!this.micStream) return;
        
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = this.audioContext.createMediaStreamSource(this.micStream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;
            source.connect(this.analyser);
            
            const SILENCE_THRESHOLD = 0.01;
            const SILENCE_DURATION = 1000;
            const MIN_SPEECH_DURATION = 300;
            
            const checkSilence = () => {
                if (!this.isListening || !this.analyser) return;
                
                const timeDomainData = new Uint8Array(this.analyser.fftSize);
                this.analyser.getByteTimeDomainData(timeDomainData);
                
                let sumSquares = 0;
                for (let i = 0; i < timeDomainData.length; i++) {
                    const normalized = (timeDomainData[i] - 128) / 128;
                    sumSquares += normalized * normalized;
                }
                const rms = Math.sqrt(sumSquares / timeDomainData.length);
                
                if (rms >= SILENCE_THRESHOLD) {
                    if (!this.hasSpeech && !this.speechStartTime) {
                        this.speechStartTime = Date.now();
                    }
                    this.hasSpeech = true;
                    this.silenceStartTime = null;
                } else if (this.hasSpeech) {
                    if (!this.silenceStartTime) {
                        this.silenceStartTime = Date.now();
                    }
                    if (Date.now() - this.silenceStartTime > SILENCE_DURATION) {
                        const speechDuration = this.speechStartTime ? Date.now() - this.speechStartTime : 0;
                        if (speechDuration >= MIN_SPEECH_DURATION) {
                            console.log('检测到静音，自动停止录音');
                            this.stopListening();
                            return;
                        }
                    }
                }
                
                requestAnimationFrame(checkSilence);
            };
            
            requestAnimationFrame(checkSilence);
        } catch (e) {
            console.log('静音检测初始化失败:', e);
        }
    },
    
    stopSilenceDetection() {
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
            this.analyser = null;
        }
    },
    
    async sendAudioForRecognition(audioBlob) {
        const input = document.getElementById('chatInput');
        if (input) {
            input.value = '正在识别...';
        }
        
        try {
            const formData = new FormData();
            formData.append('audio', audioBlob, 'recording.wav');
            
            const response = await fetch('/api/asr/recognize', {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            
            if (data.status === 'success') {
                // 多人分割：逐段处理（每段可能是一条聊天或普通文本）
                if (data.segments && data.segments.length) {
                    for (const seg of data.segments) {
                        const segText = (seg.text || '').trim();
                        if (!segText) continue;
                        console.log('分段识别:', segText, '->', seg.speaker);
                        // 控制端直接上传的录音也可能收到未匹配声纹分段；只回显诊断文字，不能当作聊天或命令执行。
                        if (seg.speaker === null) {
                            this.handleAsrCommand(segText, null);
                            continue;
                        }
                        if (segText.startsWith('聊天')) {
                            const message = segText.substring(2).trim();
                            if (message) {
                                setTimeout(() => { this.sendVoiceMessage(message); }, 300);
                            }
                        } else {
                            this.handleAsrCommand(segText, seg.speaker);
                        }
                    }
                    return;
                }
                if (!data.text) return;
                const recognizedText = data.text.trim();
                console.log('识别结果:', recognizedText);

                if (input) {
                    input.value = recognizedText;
                }

                if (recognizedText.startsWith('聊天')) {
                    if (data.speaker === null) {
                        this.handleAsrCommand(recognizedText, null);
                        return;
                    }
                    const message = recognizedText.substring(2).trim();
                    if (message) {
                        setTimeout(() => {
                            this.sendVoiceMessage(message);
                        }, 300);
                    }
                } else {
                    this.handleAsrCommand(recognizedText, data.speaker);
                }
            } else if (data.status === 'ignored') {
                console.log('无效语音输入，已忽略:', data.text);
                if (input) {
                    input.value = '';
                }
                window.showToast('无效语音输入', 'warning');
                if (this.isAlwaysListening) {
                    setTimeout(() => this.startListening(), 500);
                }
            } else {
                if (input) {
                    input.value = '';
                }
                window.showToast(data.message || '语音识别失败', 'error');
            }
        } catch (e) {
            console.error('语音识别请求失败:', e);
            if (input) {
                input.value = '';
            }
            window.showToast('语音识别请求失败', 'error');
        }
    },
    
    // 处理非"聊天"开头的识别结果（普通文本/语音命令），带 speaker 归属
    handleAsrCommand(text, speaker) {
        // 非"聊天"文本沿用原有行为：填充输入框；speaker 归属仅记入日志
        const input = document.getElementById('chatInput');
        if (input) {
            input.value = text;
        }
        console.log('[语音输入]', text, speaker ? '（' + speaker + '）' : '');
    },

    updateVoiceButton() {
        const btn = document.getElementById('voiceInputBtn');
        if (btn) {
            btn.textContent = this.isListening ? '🔴' : '🎤';
            btn.title = this.isListening ? '停止语音输入' : '开始语音输入';
            btn.classList.toggle('listening', this.isListening);
        }
    },
    
    sendVoiceMessage(message) {
        const input = document.getElementById('chatInput');
        if (input) {
            input.value = message;
        }
        this.sendMessage();
    },
    
    loadHistory() {
        fetch('/api/chat/history')
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success') {
                    this.history = data.history;
                    this.renderHistory();
                }
            })
            .catch(err => console.error('加载聊天记录失败:', err));
    },
    
    loadTemplates() {
        fetch('/api/chat/templates')
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success') {
                    this.templates = data.templates;
                    this.render();
                }
            })
            .catch(err => console.error('加载聊天模板失败:', err));
    },
    
    loadConfig() {
        fetch('/api/chat/config')
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success' && data.config) {
                    if (data.config.systemPrompt) {
                        this.config.systemPrompt = data.config.systemPrompt;
                    }
                    this.config.agentBackend = data.config.agentBackend || 'codex';
                }
            })
            .catch(err => console.error('加载聊天配置失败:', err));
    },
    
    loadAssistantConfig() {
        if (window.WebSocketManager && window.WebSocketManager.ws && 
            window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'getAssistantConfig'
            }));
        }
    },
    
    loadSearchHistory() {
        if (window.WebSocketManager && window.WebSocketManager.ws &&
            window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'getSearchHistory'
            }));
        }
    },

    loadProfiles() {
        fetch('/api/chat/profiles')
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success') {
                    this.profiles = data.profiles || [];
                    this.activeProfile = data.activeProfile || '';
                    this.renderProfileSelector();
                }
            })
            .catch(err => console.error('加载LLM配置失败:', err));
    },

    switchProfile(name) {
        fetch('/api/chat/profiles/switch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                this.activeProfile = data.activeProfile;
                window.showToast(`已切换到配置: ${data.activeProfile} (${data.config.model})`, 'success');
                this.renderProfileSelector();
            } else {
                window.showToast('切换配置失败: ' + (data.message || data.error), 'error');
            }
        })
        .catch(err => window.showToast('切换配置失败', 'error'));
    },

    handleProfileSwitched(data) {
        if (data.activeProfile) {
            this.activeProfile = data.activeProfile;
            if (data.config) {
                this.config.apiUrl = data.config.apiUrl;
                this.config.model = data.config.model;
            }
            this.renderProfileSelector();
            window.showToast(`LLM配置已切换为: ${data.activeProfile}`, 'info');
        }
    },
    
    loadSession() {
        if (window.WebSocketManager && window.WebSocketManager.ws && 
            window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'getChatSession'
            }));
        }
    },
    
    loadCommands() {
        if (window.WebSocketManager && window.WebSocketManager.ws && 
            window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'getChatCommands'
            }));
        }
    },

    loadBuiltinCommands() {
        if (window.WebSocketManager && window.WebSocketManager.ws &&
            window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'getBuiltinVoiceCommands'
            }));
        }
    },
    
    saveSession(source = 'controlManual') {
        if (window.WebSocketManager && window.WebSocketManager.ws && 
            window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            // 会话元数据由服务端的创建/删除接口维护，避免页面尚未加载完成时提交空快照覆盖服务端列表。
            const session = { ...this.session };
            delete session.sessions;
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'setChatSession',
                session: session,
                source,
                displayId: window.currentDisplayId || null
            }));
        }
    },
    
    saveCommands() {
        if (window.WebSocketManager && window.WebSocketManager.ws &&
            window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'setChatCommands',
                commands: this.commands
            }));
        }
    },

    loadSessions(target) {
        if (!target) return;
        fetch(`/api/chat/sessions?target=${encodeURIComponent(target)}`)
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success') {
                    this.session.sessions[target] = data.sessions;
                    this.renderSessionSelector();
                }
            })
            .catch(err => console.error('加载会话列表失败:', err));
    },

    switchSession(sessionId) {
        const target = this.session.privateTarget;
        if (!target) return;

        fetch('/api/chat/sessions/switch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target, sessionId })
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                this.session.privateSessionId = sessionId;
                this.loadHistory();
                this.loadSession();
            } else {
                window.showToast('切换会话失败: ' + (data.message || data.error), 'error');
            }
        })
        .catch(err => window.showToast('切换会话失败', 'error'));
    },

    createSession() {
        const target = this.session.privateTarget;
        if (!target) return;

        const name = prompt('请输入新会话名称:');
        if (!name || !name.trim()) return;

        fetch('/api/chat/sessions/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target, name: name.trim() })
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                window.showToast(`会话 "${name}" 已创建`, 'success');
                this.loadSessions(target);
            } else {
                window.showToast('创建会话失败: ' + (data.message || data.error), 'error');
            }
        })
        .catch(err => window.showToast('创建会话失败', 'error'));
    },

    deleteSession(sessionId) {
        if (sessionId === 'default') {
            window.showToast('默认会话不可删除', 'error');
            return;
        }
        if (!confirm('确定要删除此会话吗？（聊天记录将永久删除）')) return;

        const target = this.session.privateTarget;
        if (!target) return;

        fetch('/api/chat/sessions/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target, sessionId })
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                window.showToast('会话已删除', 'success');
                if (this.session.privateSessionId === sessionId) {
                    this.switchSession('default');
                } else {
                    this.loadSessions(target);
                    this.loadHistory();
                }
            } else {
                window.showToast('删除会话失败: ' + (data.message || data.error), 'error');
            }
        })
        .catch(err => window.showToast('删除会话失败', 'error'));
    },

    setMode(mode, target = null, source = 'controlManual') {
        this.session.mode = mode;
        this.session.privateTarget = target;
        // 切回群聊/私聊时清空角色状态，避免残留影响角色历史渲染
        this.session.roleTarget = null;
        this.session.privateSessionId = 'default';
        this.saveSession(source);
        this.render();
        if (mode === 'private' && target) {
            this.loadSessions(target);
        }
    },

    requestTemporaryConversation() {
        if (window.WebSocketManager?.ws?.readyState !== WebSocket.OPEN) return;
        window.WebSocketManager.ws.send(JSON.stringify({ type: 'getTemporaryConversation' }));
    },

    handleTemporaryConversation(data) {
        if (!data || !data.conversation) return;
        const conversation = data.conversation;
        this.temporaryConversation = {
            id: conversation.id || null,
            startedAt: conversation.startedAt || null,
            displayId: conversation.displayId || null,
            roleName: conversation.roleName || null,
            templateId: conversation.templateId || null,
            messages: Array.isArray(conversation.messages) ? conversation.messages : []
        };
        this.temporaryRoleSelection = this.temporaryConversation.roleName || '';
        this.temporaryRolePending = false;
        this.renderModeIndicator();
        this.renderSessionSelector();
        this.updateSendButton();
        if (this.session.mode === 'temporary') this.renderHistory();
    },

    handleTemporaryConversationError(data) {
        this.temporaryRolePending = false;
        this.temporaryRoleSelection = this.temporaryConversation.roleName || '';
        this.renderSessionSelector();
        this.updateSendButton();
        window.showToast(data?.message || '临时对话角色切换失败', 'error');
    },

    // 加载角色列表（WS roleList）
    loadAiRoles() {
        if (window.WebSocketManager && window.WebSocketManager.ws && window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({ type: 'roleList' }));
        }
    },

    // 打开工作 AI 角色选择窗口，候选数据只从服务端读取元数据。
    showAddRole() {
        const modal = document.getElementById('chatRoleCatalogModal');
        if (!modal) return;
        modal.classList.add('active');
        this.roleCatalog = [];
        this.pendingRoleAdd = '';
        this.renderRoleCatalog();
        if (window.WebSocketManager && window.WebSocketManager.ws && window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({ type: 'roleCatalog' }));
            return;
        }
        window.showToast('聊天服务尚未连接，无法加载工作组成员', 'error');
    },

    hideRoleCatalog() {
        const modal = document.getElementById('chatRoleCatalogModal');
        if (modal) modal.classList.remove('active');
        this.pendingRoleAdd = '';
    },

    addRoleByName(name) {
        const clean = typeof name === 'string' ? name.trim() : '';
        if (!clean) return;
        if (this.templates.some((template) => template.name === clean)) {
            window.showToast('该名字与聊天模板冲突', 'error');
            return;
        }
        if (this.aiRoles.some((role) => role.name === clean)) {
            this.hideRoleCatalog();
            this.setRoleMode(clean);
            return;
        }
        this.pendingRoleAdd = clean;
        window.WebSocketManager.send({ type: 'roleAdd', name: clean });
    },

    addRoleFromCatalog(name) {
        this.addRoleByName(name);
    },

    renderRoleCatalog() {
        const container = document.getElementById('chatRoleCatalogList');
        if (!container) return;
        container.replaceChildren();
        if (this.roleCatalog.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'chat-role-catalog-empty';
            empty.textContent = '暂无可选择的 workgroup 成员';
            container.appendChild(empty);
            return;
        }

        const savedNames = new Set(this.aiRoles.map((role) => role.name));
        const templateNames = new Set(this.templates.map((template) => template.name));
        this.roleCatalog.forEach((member) => {
            const item = document.createElement('div');
            item.className = 'chat-role-catalog-item';

            const info = document.createElement('div');
            info.className = 'chat-role-catalog-info';
            const name = document.createElement('div');
            name.className = 'chat-role-catalog-name';
            name.textContent = member.name;
            info.appendChild(name);

            const roles = document.createElement('div');
            roles.className = 'chat-role-catalog-meta';
            const roleLabels = [];
            if (member.primary) roleLabels.push(`主角色：${member.primary}`);
            if (Array.isArray(member.secondary) && member.secondary.length > 0) {
                roleLabels.push(`副角色：${member.secondary.join('、')}`);
            }
            if (member.hasRoleFile) roleLabels.push('有角色信息');
            if (member.hasHistoryFile) roleLabels.push('有历史记录');
            roles.textContent = roleLabels.join(' · ') || '暂无角色或历史文件';
            info.appendChild(roles);
            item.appendChild(info);

            const action = document.createElement('button');
            action.type = 'button';
            action.className = 'chat-role-catalog-action';
            const alreadyAdded = savedNames.has(member.name);
            const templateConflict = templateNames.has(member.name);
            action.textContent = alreadyAdded ? '已添加' : (templateConflict ? '名称冲突' : '选择');
            action.disabled = alreadyAdded || templateConflict || this.pendingRoleAdd === member.name;
            action.addEventListener('click', () => this.addRoleFromCatalog(member.name));
            item.appendChild(action);
            container.appendChild(item);
        });
    },

    // 删除角色：确认后发 roleDelete（服务端回收 claude 进程并清历史）
    deleteRole(name) {
        if (!window.confirm(`删除角色「${name}」将关闭其 claude 进程并清除对话历史，确定？`)) return;
        // 协议字段对齐：后端 roleDelete 分支读 data.role（server-app.js L3806 aiRoles.remove(data.role)），
        // 与 roleList/roleHistory/roleError 一致都用 role 字段，发送 name 会因 data.role 为 undefined 而误报「角色不存在」
        window.WebSocketManager.send({ type: 'roleDelete', role: name });
    },

    // 进入角色对话：切 mode='role'，拉取该角色历史
    setRoleMode(name) {
        this.session.mode = 'role';
        this.session.roleTarget = name;
        this.session.privateTarget = null;
        this.saveSession('controlManual');
        this.render();
        window.WebSocketManager.send({ type: 'roleHistory', role: name });
    },

    togglePlayOnControl() {
        this.session.playOnControl = !this.session.playOnControl;
        this.saveSession();
        this.renderPlayOnControlToggle();
    },
    
    saveConfig() {
        const systemPromptInput = document.getElementById('chatSystemPrompt');
        if (systemPromptInput) {
            this.config.systemPrompt = systemPromptInput.value.trim() || '你是一个友好的助手，请用简洁的语言回答问题。';
        }
        const agentBackendInput = document.getElementById('chatAgentBackend');
        if (agentBackendInput) this.config.agentBackend = agentBackendInput.value === 'claude' ? 'claude' : 'codex';

        fetch('/api/chat/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.config)
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                window.showToast('配置已保存', 'success');
                this.hideConfig();
            }
        })
        .catch(err => window.showToast('保存配置失败', 'error'));
    },
    
    render() {
        const container = document.getElementById('chatContainer');
        if (!container) return;
        
        let tabsHtml = '<div class="chat-tabs"><div class="chat-tab' + (this.session.mode === 'group' ? ' active' : '') + '" data-chat-tab="group">群聊</div>';
        tabsHtml += '<div class="chat-tab' + (this.session.mode === 'temporary' ? ' active' : '') + '" data-chat-tab="temporary">临时</div>';
        this.templates.forEach(t => {
            const isActive = this.session.mode === 'private' && this.session.privateTarget === t.name;
            tabsHtml += `<div class="chat-tab${isActive ? ' active' : ''}" onclick="Chat.setMode('private', '${this.escapeHtml(t.name)}')">${this.escapeHtml(t.name)}</div>`;
        });
        this.aiRoles.forEach(r => {
            const active = this.session.mode === 'role' && this.session.roleTarget === r.name;
            tabsHtml += `<div class="chat-tab${active ? ' active' : ''}" data-role-tab="${this.escapeHtml(r.name)}"></div>`;
        });
        tabsHtml += '<div class="chat-tab chat-tab-add" data-add-role="true">+</div>';
        tabsHtml += '</div>';
        
        container.innerHTML = `
            ${tabsHtml}
            <div class="chat-main">
                <div class="chat-header">
                    <h3>AI 聊天助手</h3>
                    <div class="chat-mode-indicator" id="chatModeIndicator"></div>
                    <div class="chat-session-selector" id="chatSessionSelector"></div>
                    <div class="chat-actions">
                        <button class="chat-action-btn" onclick="Chat.showConfig()">设置</button>
                        <button class="chat-action-btn" onclick="Chat.showTemplates()">模板</button>
                        <button class="chat-action-btn" onclick="Chat.showCommands()">指令</button>
                        <button class="chat-action-btn" onclick="Chat.exportHistory()">导出记录</button>
                        <button class="chat-action-btn" onclick="Chat.selectHistoryImport()">导入记录</button>
                        <input type="file" id="chatHistoryImportInput" accept="application/json,.json" style="display:none" onchange="Chat.importHistory(this.files[0]); this.value=''">
                        <button class="chat-action-btn" onclick="Chat.clearHistory()">清空</button>
                    </div>
                </div>
                <div class="chat-messages" id="chatMessages"></div>
                <div class="chat-input-area">
                    <div class="chat-input-row">
                        <button id="voiceInputBtn" class="voice-input-btn" onclick="Chat.toggleVoice()" title="开始语音输入">🎤</button>
                        <button type="button" class="chat-image-btn" onclick="Chat.selectImageFile()" title="添加图片">🖼️</button>
                        <input type="file" id="chatImageInput" accept="image/*" style="display:none" onchange="Chat.handleImageFile(this.files[0]); this.value=''">
                        <input type="text" id="chatInput" placeholder="输入消息... (说“聊天xxx”触发语音对话)" onkeypress="Chat.handleKeyPress(event)">
                        <button class="chat-send-btn" onclick="Chat.sendMessage()" id="chatSendBtn">发送</button>
                    </div>
                    <div class="chat-image-preview-list" id="chatImagePreview"></div>
                    <div class="chat-options">
                        <label class="chat-option">
                            <input type="checkbox" id="playOnControlCheckbox" onchange="Chat.togglePlayOnControl()">
                            在控制端播放语音
                        </label>
                        <label class="chat-option">
                            <input type="checkbox" id="noInterruptCheckbox" onchange="Chat.toggleNoInterrupt()" checked>
                            播放时暂停监听
                        </label>
                    </div>
                </div>
            </div>
        `;
        
        const tabs = container.querySelector('.chat-tabs');
        const groupTab = tabs.querySelector('[data-chat-tab="group"]');
        if (groupTab) {
            // 群聊页签必须主动清理私聊/工作组状态，否则页签只显示但不会切换上下文。
            groupTab.addEventListener('click', () => this.setMode('group', null));
        }
        const temporaryTab = tabs.querySelector('[data-chat-tab="temporary"]');
        if (temporaryTab) {
            temporaryTab.addEventListener('click', () => this.setMode('temporary', null));
        }
        tabs.querySelectorAll('[data-role-tab]').forEach((tab) => {
            const name = tab.dataset.roleTab;
            const role = this.aiRoles.find((item) => item.name === name);
            tab.textContent = name;
            const status = document.createElement('span');
            status.className = `chat-role-status ${role && role.running ? 'online' : 'offline'}`;
            status.textContent = role && role.running ? '在线' : '离线';
            status.title = role && role.backend ? `Agent 后端：${role.backend}` : 'Agent 未运行';
            tab.appendChild(status);
            tab.addEventListener('click', () => this.setRoleMode(name));
            const del = document.createElement('span'); del.className = 'chat-tab-del'; del.textContent = '×'; del.title = '删除角色';
            del.addEventListener('click', (event) => { event.stopPropagation(); this.deleteRole(name); }); tab.appendChild(del);
        });
        const add = tabs.querySelector('[data-add-role]'); if (add) { add.addEventListener('click', () => this.showAddRole()); }
        const chatInput = container.querySelector('#chatInput');
        const chatSendButton = container.querySelector('#chatSendBtn');
        if (chatInput) {
            // 临时页签与普通聊天一样允许手动输入；消息由服务端归并到唯一临时会话。
            chatInput.disabled = false;
            chatInput.placeholder = this.session.mode === 'temporary'
                ? '输入临时对话消息...'
                : '输入消息... (说"聊天xxx"触发语音对话)';
        }
        if (chatSendButton) chatSendButton.disabled = false;
        this.renderHistory();
        this.renderModeIndicator();
        this.renderPlayOnControlToggle();
        this.renderSessionSelector();
        this.updateSendButton();
        this.renderSearchHistory();
    },

    /**
     * 仅更新角色标签的在线状态，避免聊天请求进行中重建消息区域。
     * Agent 后端启动或退出时服务端会广播 roleList；此时必须保留用户消息
     * 和正在接收的流式回复节点，才能让 chatChunk 持续显示在原位置。
     */
    updateRoleStatuses() {
        const roleMap = new Map(this.aiRoles.map((role) => [role.name, role]));
        const tabs = document.querySelectorAll('[data-role-tab]');

        tabs.forEach((tab) => {
            const role = roleMap.get(tab.dataset.roleTab);
            const status = tab.querySelector('.chat-role-status');
            if (!status || !role) return;

            const online = role.running === true;
            status.classList.toggle('online', online);
            status.classList.toggle('offline', !online);
            status.textContent = online ? '在线' : '离线';
            status.title = role.backend ? `Agent 后端：${role.backend}` : 'Agent 未运行';
        });

        this.renderModeIndicator();
    },
    
    renderModeIndicator() {
        const indicator = document.getElementById('chatModeIndicator');
        if (!indicator) return;

        let html = '';
        if (this.session.commandMode) {
            html += '<span class="mode-badge command">指令模式</span>';
        }
        // 角色模式：显示当前角色名 + 退出按钮（回到群聊）
        if (this.session.mode === 'role') {
            const role = this.aiRoles.find((item) => item.name === this.session.roleTarget);
            const backend = role && role.backend ? role.backend : this.config.agentBackend;
            const online = role && role.running;
            html += `
                <span class="mode-badge role">Agent · ${this.escapeHtml(backend)} · ${this.escapeHtml(this.session.roleTarget)} · ${online ? '在线' : '离线'}</span>
                <button class="mode-exit-btn" onclick="Chat.setMode('group', null)">退出工作组</button>
            `;
        } else if (this.session.mode === 'private') {
            html += `
                <span class="mode-badge private">私聊: ${this.escapeHtml(this.session.privateTarget)}</span>
                <button class="mode-exit-btn" onclick="Chat.setMode('group', null)">退出私聊</button>
            `;
        } else if (this.session.mode === 'temporary') {
            const roleName = this.temporaryConversation.roleName || '未选择角色';
            html += `<span class="mode-badge group">临时对话 · ${this.escapeHtml(roleName)}</span>`;
        } else {
            html += '<span class="mode-badge group">群聊</span>';
        }
        indicator.innerHTML = html;
    },
    
    renderPlayOnControlToggle() {
        const checkbox = document.getElementById('playOnControlCheckbox');
        if (checkbox) {
            checkbox.checked = this.session.playOnControl;
        }
        const noInterruptCheckbox = document.getElementById('noInterruptCheckbox');
        if (noInterruptCheckbox) {
            noInterruptCheckbox.checked = this.noInterruptMode;
        }
    },
    
    toggleNoInterrupt() {
        this.noInterruptMode = !this.noInterruptMode;
    },

    renderSessionSelector() {
        const container = document.getElementById('chatSessionSelector');
        if (!container) return;

        if (this.session.mode === 'temporary') {
            const roleTemplates = this.templates.filter(template => (
                template && template.name && String(template.content || '').trim()
            ));
            const selectedRole = this.temporaryRoleSelection || this.temporaryConversation.roleName || '';
            container.style.display = 'flex';
            let html = '<label class="session-label">角色:</label>';
            html += '<select class="session-select" onchange="Chat.onTemporaryRoleChange(this.value)"' + (this.temporaryRolePending ? ' disabled' : '') + '>';
            html += '<option value="">请选择角色</option>';
            for (const template of roleTemplates) {
                const selected = template.name === selectedRole ? ' selected' : '';
                html += `<option value="${this.escapeHtml(template.name)}"${selected}>${this.escapeHtml(template.name)}</option>`;
            }
            html += '</select>';
            const canRestart = Boolean(selectedRole) && !this.temporaryRolePending;
            html += `<button class="session-btn session-add" onclick="Chat.startTemporaryConversation()" title="重新开始当前角色临时对话"${canRestart ? '' : ' disabled'}>↻</button>`;
            container.innerHTML = html;
            return;
        }

        const target = this.session.privateTarget;
        if (this.session.mode !== 'private' || !target) {
            container.style.display = 'none';
            return;
        }

        const sessions = this.session.sessions[target] || [];
        if (sessions.length === 0) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'flex';
        let html = '<label class="session-label">会话:</label>';
        html += '<select class="session-select" onchange="Chat.onSessionChange(this.value)">';
        for (const s of sessions) {
            const selected = s.id === this.session.privateSessionId ? ' selected' : '';
            html += `<option value="${this.escapeHtml(s.id)}"${selected}>${this.escapeHtml(s.name)}</option>`;
        }
        html += '</select>';
        html += '<button class="session-btn session-add" onclick="Chat.createSession()" title="新建会话">+</button>';
        html += '<button class="session-btn session-del" onclick="Chat.deleteSession(\'' + this.escapeHtml(this.session.privateSessionId) + '\')" title="删除当前会话">×</button>';

        container.innerHTML = html;
    },

    onTemporaryRoleChange(roleName) {
        const normalizedRoleName = String(roleName || '').trim();
        if (!normalizedRoleName) {
            this.temporaryRoleSelection = '';
            this.updateSendButton();
            return;
        }
        this.temporaryRoleSelection = normalizedRoleName;
        this.startTemporaryConversation(normalizedRoleName);
    },

    startTemporaryConversation(roleName = null) {
        const selectedRole = String(
            roleName || this.temporaryRoleSelection || this.temporaryConversation.roleName || ''
        ).trim();
        if (!selectedRole) {
            window.showToast('请先选择临时对话角色', 'warning');
            return;
        }
        if (window.WebSocketManager?.ws?.readyState !== WebSocket.OPEN) {
            window.showToast('临时对话角色切换失败：控制端未连接', 'error');
            return;
        }
        this.temporaryRoleSelection = selectedRole;
        this.temporaryRolePending = true;
        this.renderSessionSelector();
        this.updateSendButton();
        window.WebSocketManager.ws.send(JSON.stringify({
            type: 'startTemporaryConversation',
            roleName: selectedRole,
            displayId: window.currentDisplayId || null
        }));
    },

    onSessionChange(sessionId) {
        if (sessionId === this.session.privateSessionId) return;
        this.switchSession(sessionId);
    },

    renderHistory() {
        const messagesContainer = document.getElementById('chatMessages');
        if (!messagesContainer) return;
        
        let indexedHistory = [];
        if (this.session.mode === 'temporary') {
            indexedHistory = this.temporaryConversation.messages
                .map((item, index) => ({ item, originalIndex: index }));
        } else if (this.session.mode === 'role' && this.session.roleTarget) {
            // 角色模式：渲染该角色独立历史，与群聊/私聊隔离
            indexedHistory = (this.roleHistories[this.session.roleTarget] || []).map((item, index) => ({ item, originalIndex: index }));
        } else {
            indexedHistory = this.history.map((item, index) => ({ item, originalIndex: index }));
            if (this.session.mode === 'private' && this.session.privateTarget) {
                indexedHistory = indexedHistory.filter(({ item }) =>
                    item.mode === 'private' && item.target === this.session.privateTarget
                    && (item.sessionId || 'default') === (this.session.privateSessionId || 'default')
                );
            } else {
                indexedHistory = indexedHistory.filter(({ item }) =>
                    item.mode !== 'private' && item.mode !== 'role' && item.mode !== 'temporary'
                );
            }
        }
        
        if (indexedHistory.length === 0) {
            messagesContainer.innerHTML = '<div class="chat-empty">暂无聊天记录</div>';
            return;
        }
        
        messagesContainer.innerHTML = indexedHistory.map(({ item, originalIndex }) => {
            let roleClass = item.role || 'user';
            let name = item.name;
            let content = item.content || item.assistant || item.user || '';
            
            if (item.role === 'control') {
                roleClass = 'user';
                name = '用户';
            } else if (item.role === 'assistant') {
                // 私聊/角色模式：助手名字用目标名（模板名/角色名）展示
                if ((item.mode === 'private' || item.mode === 'role') && item.target) {
                    name = item.target;
                } else {
                    name = item.name || '助手';
                }
            } else if (item.user) {
                roleClass = 'user';
                name = '用户';
                content = item.user;
            } else if (item.assistant) {
                roleClass = 'assistant';
                name = '助手';
                content = item.assistant;
            }

            const canDeleteRound = !['role', 'temporary'].includes(this.session.mode)
                && Boolean(item.id)
                && (roleClass === 'user' || item.user !== undefined);
            const deleteButton = canDeleteRound
                ? `<button class="chat-delete-round-btn" onclick="Chat.deleteConversationRound('${this.escapeHtml(String(item.id))}')" title="删除本轮对话">删除本轮</button>`
                : '';
            
            return `
                <div class="chat-message ${roleClass}" data-index="${originalIndex}">
                    <div class="chat-message-header">${this.escapeHtml(name)}</div>
                    <div class="chat-message-content">${this.renderMessageImages(item.images)}${ChatMarkdown.render(content)}</div>
                    <button class="chat-play-btn" onclick="Chat.playMessage(${originalIndex})" title="播放语音">🔊</button>
                    ${deleteButton}
                </div>
            `;
        }).join('');
        
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    },
    
    handleKeyPress(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.sendMessage();
        }
    },
    
    checkMultiHandlerKeywords(message) {
        const keywords = [];
        
        if (message.includes('天气') && !this.shouldLetPiAgentHandle('weather')) {
            keywords.push('weather');
        }
        if (message.includes('提醒')) {
            keywords.push('reminder');
        }
        if (message.includes('报时') || message.includes('现在几点')) {
            keywords.push('time');
        }
        if (message.includes('搜索') && !this.shouldLetPiAgentHandle('search')) {
            keywords.push('search');
        }
        
        for (const keyword of Object.keys(this.commands.commands || {})) {
            if (message.includes(keyword)) {
                keywords.push('command:' + keyword);
            }
        }
        
        return keywords;
    },

    shouldLetPiAgentHandle(commandType) {
        const activeProfile = this.profiles.find(profile => profile.name === this.activeProfile);
        const route = window.Settings?.routing?.[commandType];
        // 只有控制端明确选择 LLM，且当前 profile 确实由 Pi Agent 执行时，
        // 才跳过旧的天气/搜索处理器；system 路由和普通 LLM 行为保持不变。
        return route === 'llm' && activeProfile?.mode === 'agent' && activeProfile?.backend === 'pi';
    },
    
    executeMultiHandlers(message, keywords) {
        for (const key of keywords) {
            if (key === 'weather') {
                this.handleWeatherCommand(message);
            } else if (key === 'reminder') {
                this.handleReminderCommand(message);
            } else if (key === 'time') {
                this.handleTimeAnnounceCommand(message);
            } else if (key === 'search') {
                this.handleSearchCommand(message);
            } else if (key.startsWith('command:')) {
                const keyword = key.substring(8);
                const actions = this.commands.commands[keyword];
                if (actions) {
                    this.addSystemMessage(`执行指令组合: ${keyword}`);
                    this.executeCommands(actions);
                }
            }
        }
    },

    isGroupRoleAddressedMessage(message) {
        if (this.session.mode !== 'group') return false;
        return this.templates.some((template) => {
            const name = String(template.name || '').trim();
            return name && message.includes(name) && message.replace(name, '').trim();
        });
    },
    
    selectImageFile() {
        const input = document.getElementById('chatImageInput');
        if (input) input.click();
    },

    async handleImageFile(file) {
        if (!file || !file.type.startsWith('image/')) return;
        try {
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('图片读取失败'));
                reader.readAsDataURL(file);
            });
            this.attachImage({ dataUrl, mimeType: file.type });
        } catch (error) {
            if (window.showToast) window.showToast(error.message, 'error');
        }
    },

    attachImage(image) {
        const dataUrl = String(image?.dataUrl || '');
        const mimeType = String(image?.mimeType || '').toLowerCase();
        if (!dataUrl.startsWith('data:image/') || !mimeType.startsWith('image/')) {
            if (window.showToast) window.showToast('图片格式不正确', 'error');
            return false;
        }
        if (dataUrl.length > 8 * 1024 * 1024) {
            if (window.showToast) window.showToast('图片不能超过 8MB', 'error');
            return false;
        }
        if (this.pendingImages.length >= 4) {
            if (window.showToast) window.showToast('单条消息最多添加 4 张图片', 'error');
            return false;
        }
        this.pendingImages.push({ dataUrl, mimeType, sourceDisplayId: image.sourceDisplayId || null });
        this.renderPendingImages();
        return true;
    },

    removeImage(index) {
        this.pendingImages.splice(index, 1);
        this.renderPendingImages();
    },

    renderPendingImages() {
        const container = document.getElementById('chatImagePreview');
        if (!container) return;
        container.innerHTML = '';
        this.pendingImages.forEach((image, index) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'chat-image-preview-item';
            const preview = document.createElement('img');
            preview.src = image.dataUrl;
            preview.alt = `待发送图片 ${index + 1}`;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'chat-image-remove';
            remove.textContent = '×';
            remove.title = '移除图片';
            remove.addEventListener('click', () => this.removeImage(index));
            wrapper.append(preview, remove);
            container.appendChild(wrapper);
        });
    },

    renderMessageImages(images) {
        if (!Array.isArray(images) || images.length === 0) return '';
        return `<div class="chat-message-images">${images.map((image) => {
            const dataUrl = this.escapeHtml(image.dataUrl || image.url || '');
            return dataUrl ? `<img src="${dataUrl}" alt="聊天图片">` : '';
        }).join('')}</div>`;
    },

    sendMessage() {
        if (this.isLoading) return;

        if (this.session.mode === 'temporary'
            && (this.temporaryRolePending
                || !this.temporaryConversation.id
                || !this.temporaryConversation.roleName)) {
            window.showToast('请先选择并等待临时对话角色生效', 'warning');
            return;
        }
        
        const input = document.getElementById('chatInput');
        let message = input.value.trim();
        
        if (!message && this.pendingImages.length === 0) return;
        
        if (this.session.mode === 'private') {
            const systemResult = this.handleSystemCommand(message);
            if (systemResult) {
                input.value = '';
                return;
            }
        }
        
        let mode = this.session.mode;
        let target = this.session.privateTarget;
        let templateTarget = null;
        let displayMessage = message;
        let sendMessage = message;
        let multiHandlerKeywords = [];

        if (mode === 'group') {
            const isRoleAddressedMessage = this.isGroupRoleAddressedMessage(message);
            if (!isRoleAddressedMessage) {
                const systemResult = this.handleSystemCommand(message);
                if (systemResult) {
                    input.value = '';
                    return;
                }
            }

            multiHandlerKeywords = isRoleAddressedMessage
                ? []
                : this.checkMultiHandlerKeywords(message);
            // 群聊使用全部角色模板，用户输入必须保持原样，包括角色名前缀。
        }

        const requestId = `${Date.now()}-${++this.requestCounter}`;
        this.activeRequestId = requestId;
        this.isLoading = true;
        this.currentStreamingMessage = '';
        const images = this.pendingImages.map((image) => ({
            dataUrl: image.dataUrl,
            mimeType: image.mimeType
        }));
        this.currentUserMessage = displayMessage;
        this.updateSendButton();

        if (mode === 'group' && multiHandlerKeywords.length > 0) {
            this.executeMultiHandlers(message, multiHandlerKeywords);
        }

        let assistantName = '助手';
        if (mode === 'private' && target) {
            assistantName = target;
        } else if (mode === 'role' && this.session.roleTarget) {
            // 角色模式：流式消息以角色名作为助手名
            assistantName = this.session.roleTarget;
        } else if (templateTarget) {
            assistantName = templateTarget;
        }
        this.showStreamingMessage(displayMessage, assistantName, images);
        
        if (window.WebSocketManager && window.WebSocketManager.ws && 
            window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            const selectionMode = window.DisplayList ? window.DisplayList.selectionMode : 'single';
            const chatMessage = {
                type: 'chatMessage',
                requestId,
                content: sendMessage,
                images: images,
                displayContent: displayMessage,
                mode: mode,
                assistantType: mode === 'role' ? 'agent' : 'llm',
                target: target,
                // 角色模式才带 role 字段；群聊不指定 templateTarget，私聊由服务端按 target 处理。
                role: mode === 'role' ? this.session.roleTarget : undefined,
                templateTarget: templateTarget,
                sessionId: this.session.privateSessionId || 'default',
                // 临时页签始终使用服务端唯一会话；旧控制端没有最新 ID 时由服务端补齐。
                temporaryConversation: mode === 'temporary',
                temporaryConversationId: mode === 'temporary'
                    ? (this.temporaryConversation.id || null)
                    : null,
                playOnControl: this.session.playOnControl
            };

            this.pendingImages = [];
            this.renderPendingImages();
            
            if (selectionMode === 'all' || selectionMode === 'adaptive') {
                const selectedIds = window.DisplayList ? window.DisplayList.getSelectedDisplayIds() : [];
                chatMessage.displayIds = selectedIds;
            } else {
                chatMessage.displayId = window.currentDisplayId;
            }
            
            window.WebSocketManager.ws.send(JSON.stringify(chatMessage));
        } else {
            this.addSystemMessage('WebSocket 连接未建立，正在重连...');
            if (window.WebSocketManager) {
                window.WebSocketManager.connect();
            }
            this.isLoading = false;
            this.updateSendButton();
            return;
        }
        
        input.value = '';
    },
    
    handleSystemCommand(text) {
        if (this.session.mode === 'private') {
            if (text === '退出私聊') {
                this.setMode('group', null, 'controlCommand');
                this.addSystemMessage('已退出私聊模式');
                return true;
            }
            
            if (text === '系统' || text.startsWith('系统')) {
                const cmd = text.substring(2).trim() || text;
                return this.handleSystemCommand(cmd);
            }
            
            return false;
        }
        
        if (text === '系统') {
            this.showHelp();
            return true;
        }
        
        if (text.startsWith('私聊')) {
            const name = text.substring(2).trim();
            if (name) {
                const template = this.templates.find(t => t.name === name);
                if (template) {
                    this.setMode('private', name, 'controlCommand');
                    this.addSystemMessage(`已进入与 ${name} 的私聊模式`);
                    return true;
                }
            } else if (this.templates.length > 0) {
                const defaultTemplate = this.templates[0];
                this.setMode('private', defaultTemplate.name, 'controlCommand');
                this.addSystemMessage(`已进入与 ${defaultTemplate.name} 的私聊模式`);
                return true;
            }
            this.addSystemMessage('请指定有效的助手名字');
            return true;
        }
        
        if (text === '退出私聊') {
            this.setMode('group', null, 'controlCommand');
            this.addSystemMessage('已退出私聊模式');
            return true;
        }
        
        for (const [keyword, actions] of Object.entries(this.commands.commands || {})) {
            if (text.includes(keyword)) {
                this.addSystemMessage(`执行指令组合: ${keyword}`);
                this.executeCommands(actions);
                return true;
            }
        }
        
        if (text.includes('提醒')) {
            this.handleReminderCommand(text);
            return true;
        }
        
        if (text.includes('报时') || text.includes('现在几点')) {
            this.handleTimeAnnounceCommand(text);
            return true;
        }
        
        if (text.includes('天气')) {
            this.handleWeatherCommand(text);
            return true;
        }
        
        if (text.includes('搜索')) {
            this.handleSearchCommand(text);
            return true;
        }
        
        if (text === '静音' || text.includes('全部静音')) {
            this.handleMuteCommand();
            return true;
        }
        
        if (text.includes('取消静音') || text === '恢复音量') {
            this.handleUnmuteCommand();
            return true;
        }
        
        if (text.includes('今日提醒') || text.includes('今天提醒')) {
            this.handleTodayReminders();
            return true;
        }
        
        if (text.includes('明日提醒') || text.includes('明天提醒')) {
            this.handleTomorrowReminders();
            return true;
        }
        
        if (text.includes('播放')) {
            this.handlePlayCommand(text);
            return true;
        }
        
        return false;
    },
    
    handlePlayCommand(text) {
        if (!window.currentDisplayId) {
            window.showToast('请先选择显示端', 'error');
            return;
        }
        
        const fileName = text.replace(/播放/, '').trim();
        if (!fileName) {
            this.addSystemMessage('请输入要播放的文件名');
            return;
        }
        
        this.addSystemMessage(`正在搜索: ${fileName}`);
        
        if (window.WebSocketManager && window.WebSocketManager.ws && 
            window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'voiceCommand',
                displayId: window.currentDisplayId,
                text: text,
                playOnControl: false
            }));
        }
    },
    
    handleMuteCommand() {
        if (window.WebSocketManager && window.WebSocketManager.ws && 
            window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'mute'
            }));
            this.addSystemMessage('正在静音所有显示端...');
        }
    },
    
    handleUnmuteCommand() {
        if (window.WebSocketManager && window.WebSocketManager.ws && 
            window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'unmute'
            }));
            this.addSystemMessage('正在取消静音...');
        }
    },
    
    handleTodayReminders() {
        if (window.WebSocketManager && window.WebSocketManager.ws && 
            window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'todayReminders',
                displayId: window.currentDisplayId
            }));
        }
    },
    
    handleTomorrowReminders() {
        if (window.WebSocketManager && window.WebSocketManager.ws && 
            window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'tomorrowReminders',
                displayId: window.currentDisplayId
            }));
        }
    },
    
    addSystemMessage(content, type = 'info') {
        window.showToast(content, type);
    },
    
    addCommandAckMessage(displayId, commandType, success, details) {
        const display = window.DisplayList ? window.DisplayList.getDisplays().find(d => d.id === displayId) : null;
        const displayName = display ? (display.ip || displayId) : displayId;
        const icon = success ? '✓' : '✗';
        const type = success ? 'success' : 'error';
        const content = `${icon} 显示端 ${displayName} ${commandType} 命令${success ? '已确认' : '执行失败'}${details ? ': ' + details : ''}`;
        this.addSystemMessage(content, type);
    },
    
    showStreamingMessage(userMessage, assistantName = '助手', images = []) {
        const messagesContainer = document.getElementById('chatMessages');
        if (!messagesContainer) return;
        
        const emptyMsg = messagesContainer.querySelector('.chat-empty');
        if (emptyMsg) {
            emptyMsg.remove();
        }
        
        const group = document.createElement('div');
        group.className = 'chat-message user streaming';
        group.id = 'streamingGroup';
        group.innerHTML = `
            <div class="chat-message-header">用户</div>
            <div class="chat-message-content">${this.renderMessageImages(images)}${ChatMarkdown.render(userMessage)}</div>
        `;
        
        messagesContainer.appendChild(group);
        
        const assistantMsg = document.createElement('div');
        assistantMsg.className = 'chat-message assistant';
        assistantMsg.id = 'streamingAssistant';
        assistantMsg.innerHTML = `
            <div class="chat-message-header">${this.escapeHtml(assistantName)}</div>
            <div class="chat-message-content" id="streamingContent"><span class="chat-cursor">|</span></div>
        `;
        
        messagesContainer.appendChild(assistantMsg);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    },
    
    handleChunk(data) {
        if (data.requestId !== this.activeRequestId) return;
        this.currentStreamingMessage = data.message;
        
        const streamingContent = document.getElementById('streamingContent');
        if (streamingContent) {
            streamingContent.innerHTML = ChatMarkdown.render(data.message) + '<span class="chat-cursor">|</span>';
            
            const messagesContainer = document.getElementById('chatMessages');
            if (messagesContainer) {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
        }
    },
    
    handleResponse(data) {
        if (data.requestId !== this.activeRequestId) return;
        this.isLoading = false;
        this.updateSendButton();
        
        if (this.noInterruptMode && this.wasListeningBeforePlayback && !this.isPlayingAudio) {
            console.log('LLM响应完成，延迟恢复监听');
            const savedWasListening = this.wasListeningBeforePlayback;
            this.wasListeningBeforePlayback = false;
            setTimeout(() => {
                if (savedWasListening && !this.isPlayingAudio && !this.isListening) {
                    this.startListening();
                }
            }, 3000);
        }
        
        const streamingContent = document.getElementById('streamingContent');
        const streamingGroup = document.getElementById('streamingGroup');
        const streamingAssistant = document.getElementById('streamingAssistant');
        
        if (data.success && !data.temporaryConversation) {
            // 角色模式：历史写入该角色独立历史，避免污染群聊/私聊
            if (this.session.mode === 'role' && this.session.roleTarget) {
                this.roleHistories[this.session.roleTarget] = data.history;
            } else {
                this.history = data.history;
            }
        } else if (!data.success) {
            window.showToast('聊天失败: ' + data.error, 'error');
        }
        
        if (streamingContent) {
            streamingContent.innerHTML = ChatMarkdown.render(data.message);
            streamingContent.removeAttribute('id');
        }
        
        if (streamingGroup) {
            streamingGroup.removeAttribute('id');
        }
        
        if (streamingAssistant) {
            streamingAssistant.removeAttribute('id');
            
            if (data.success) {
                const playBtn = document.createElement('button');
                playBtn.className = 'chat-play-btn';
                playBtn.textContent = '🔊';
                playBtn.title = '播放语音';
                // 角色模式：播放按钮取该角色独立历史最后一条（历史已写入 roleHistories），
                // 仍读 this.history 会播放群聊最后一条，造成播错消息
                if (data.temporaryConversation) {
                    playBtn.onclick = () => this.playMessage({
                        content: data.message,
                        displayId: window.currentDisplayId,
                        playOnControl: this.session.playOnControl
                    });
                } else if (this.session.mode === 'role' && this.session.roleTarget && this.roleHistories[this.session.roleTarget]) {
                    playBtn.onclick = () => this.playMessage(this.roleHistories[this.session.roleTarget].length - 1);
                } else {
                    playBtn.onclick = () => this.playMessage(this.history.length - 1);
                }
                streamingAssistant.appendChild(playBtn);
            }
        } else if (data.success) {
            this.renderHistory();
        }
    },
    
    handleNewMessage(data) {
        this.history.push(data.message);
        const msg = data.message;
        const shouldRender = 
            (this.session.mode === 'private' && this.session.privateTarget === msg.target && msg.mode === 'private') ||
            (this.session.mode !== 'private' && msg.mode !== 'private');
        
        if (shouldRender) {
            this.renderHistory();
            this.playMessage({ content: msg.content, displayId: data.displayId, playOnControl: data.playOnControl });
        }
    },
    
    playMessage(indexOrData) {
        let content, displayId, playOnControl;
        
        if (typeof indexOrData === 'object') {
            content = indexOrData.content;
            displayId = indexOrData.displayId;
            playOnControl = indexOrData.playOnControl;
        } else {
            // 按当前模式取历史数组：角色模式读该角色独立历史（renderHistory 的下标来自 roleHistories），
            // 其余模式读群聊历史，避免下标错位播错消息
            let history;
            if (this.session.mode === 'temporary') {
                history = this.temporaryConversation.messages || [];
            } else if (this.session.mode === 'role' && this.session.roleTarget) {
                history = this.roleHistories[this.session.roleTarget] || [];
            } else {
                history = this.history;
            }
            const item = history[indexOrData];
            if (!item) return;
            content = item.content || item.assistant || item.user;
            displayId = window.currentDisplayId;
            playOnControl = this.session.playOnControl;
        }
        
        if (!content) return;
        
        this.playText(content, displayId, playOnControl);
    },
    
    playText(text, displayId, playOnControl) {
        if (this.noInterruptMode && this.isListening) {
            this.wasListeningBeforePlayback = this.isAlwaysListening;
            this.stopListening();
        }
        
        if (window.WebSocketManager && window.WebSocketManager.ws && 
            window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            const selectionMode = window.DisplayList ? window.DisplayList.selectionMode : 'single';
            const message = {
                type: 'tts',
                action: 'play',
                text: text,
                playOnControl: playOnControl || !displayId
            };
            
            if (selectionMode === 'all' || selectionMode === 'adaptive') {
                const selectedIds = window.DisplayList ? window.DisplayList.getSelectedDisplayIds() : [];
                message.displayIds = selectedIds;
            } else {
                message.displayId = displayId || null;
            }
            
            window.WebSocketManager.ws.send(JSON.stringify(message));
        }
    },
    
    playOnControlDevice(audioUrl, text) {
        this.audioQueue.push({ audioUrl, text });
        this.processAudioQueue();
    },
    
    processAudioQueue() {
        if (this.isPlayingAudio || this.audioQueue.length === 0) {
            if (this.audioQueue.length === 0) {
                if (this.noInterruptMode && this.wasListeningBeforePlayback && !this.isLoading && !this.isPlayingAudio) {
                    console.log('播放完成，恢复监听');
                    this.wasListeningBeforePlayback = false;
                    setTimeout(() => this.startListening(), 500);
                } else if (this.isAlwaysListening && !this.noInterruptMode) {
                    console.log('自动恢复监听');
                    setTimeout(() => this.startListening(), 500);
                }
            }
            return;
        }
        
        this.isPlayingAudio = true;
        const { audioUrl, text } = this.audioQueue.shift();
        
        const audio = new Audio(audioUrl);
        this.currentAudio = audio;
        
        audio.onended = () => {
            this.currentAudio = null;
            this.isPlayingAudio = false;
            this.processAudioQueue();
        };
        
        audio.onerror = () => {
            window.showToast('音频播放失败', 'error');
            this.currentAudio = null;
            this.isPlayingAudio = false;
            this.processAudioQueue();
        };
        
        audio.play().catch(err => {
            console.error('播放失败:', err);
            window.showToast('音频播放失败', 'error');
            this.currentAudio = null;
            this.isPlayingAudio = false;
            this.processAudioQueue();
        });
    },
    
    updateSendButton() {
        const btn = document.getElementById('chatSendBtn');
        if (btn) {
            btn.textContent = this.isLoading ? '发送中...' : '发送';
            const temporaryUnavailable = this.session.mode === 'temporary'
                && (this.temporaryRolePending
                    || !this.temporaryConversation.id
                    || !this.temporaryConversation.roleName);
            btn.disabled = this.isLoading || temporaryUnavailable;
        }
    },
    
    clearHistory() {
        const mode = this.session.mode;
        if (mode === 'temporary') {
            if (!confirm('确定要清空当前临时对话吗？')) return;
            if (window.WebSocketManager?.ws?.readyState !== WebSocket.OPEN) {
                window.showToast('临时对话清空失败：控制端未连接', 'error');
                return;
            }
            window.WebSocketManager.ws.send(JSON.stringify({ type: 'clearTemporaryConversation' }));
            return;
        }
        const target = this.session.privateTarget;
        const sessionId = this.session.privateSessionId;
        let confirmText;
        if (mode === 'private') {
            const sessions = this.session.sessions[target] || [];
            const current = sessions.find(s => s.id === sessionId);
            const sessionName = current ? current.name : sessionId;
            confirmText = `确定要清空与 ${target} (${sessionName}) 的聊天记录吗？`;
        } else {
            confirmText = '确定要清空群聊记录吗？';
        }

        if (!confirm(confirmText)) return;

        fetch('/api/chat/clear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode, target, sessionId })
        })
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success') {
                    this.history = data.history;
                    this.renderHistory();
                    window.showToast('聊天记录已清空', 'success');
                }
            })
            .catch(err => window.showToast('清空失败', 'error'));
    },

    async exportHistory() {
        try {
            const response = await fetch('/api/chat/history/export');
            const data = response.ok ? await response.blob() : await response.json();
            if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
            const url = URL.createObjectURL(data);
            const link = document.createElement('a');
            link.href = url;
            link.download = `chat-history-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            window.showToast('聊天记录已导出', 'success');
        } catch (error) {
            window.showToast(`导出聊天记录失败: ${error.message}`, 'error');
        }
    },

    selectHistoryImport() {
        const input = document.getElementById('chatHistoryImportInput');
        if (input) input.click();
    },

    async importHistory(file) {
        if (!file) return;
        try {
            const payload = JSON.parse(await file.text());
            const response = await fetch('/api/chat/history/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ history: payload, mode: 'merge' })
            });
            const data = await response.json();
            if (!response.ok || data.status !== 'success') throw new Error(data.message || `HTTP ${response.status}`);
            this.history = data.history || [];
            this.renderHistory();
            window.showToast(`聊天记录导入完成：新增 ${data.importedCount || 0} 条`, 'success');
        } catch (error) {
            window.showToast(`导入聊天记录失败: ${error.message}`, 'error');
        }
    },

    deleteConversationRound(messageId) {
        if (!messageId || !window.confirm('确定删除这一轮对话吗？')) return;

        const mode = this.session.mode === 'private' ? 'private' : 'group';
        const body = {
            messageId,
            mode,
            target: mode === 'private' ? this.session.privateTarget : null,
            sessionId: this.session.privateSessionId || 'default'
        };
        fetch('/api/chat/round', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
            .then(res => res.json())
            .then(data => {
                if (data.status !== 'success') {
                    window.showToast(data.message || '删除本轮对话失败', 'error');
                    return;
                }
                this.history = data.history || [];
                this.renderHistory();
                window.showToast('本轮对话已删除', 'success');
            })
            .catch(err => window.showToast(`删除本轮对话失败: ${err.message}`, 'error'));
    },
    
    showConfig() {
        const modal = document.getElementById('chatConfigModal');
        if (modal) {
            modal.style.display = 'flex';
            const textarea = document.getElementById('chatSystemPrompt');
            if (textarea) {
                textarea.value = this.config.systemPrompt;
            }
            const agentBackend = document.getElementById('chatAgentBackend');
            if (agentBackend) agentBackend.value = this.config.agentBackend || 'codex';
            this.loadProfiles();
        }
    },

    renderProfileSelector() {
        const container = document.getElementById('profileSelector');
        if (!container) return;

        if (this.profiles.length === 0) {
            container.innerHTML = '<div class="chat-empty">暂无LLM配置</div>';
            return;
        }

        let html = '<div class="profile-list">';
        this.profiles.forEach(p => {
            const isActive = p.name === this.activeProfile;
            html += `
                <div class="profile-item ${isActive ? 'active' : ''}">
                    <div class="profile-info" onclick="Chat.switchProfile('${this.escapeHtml(p.name)}')" style="cursor:pointer;flex:1">
                        <span class="profile-name">${this.escapeHtml(p.name)}</span>
                        <span class="profile-model">${this.escapeHtml(p.model)}</span>
                        <span class="profile-mode">${this.getProfileModeLabel(p)}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:4px;">
                        <span class="profile-status">${isActive ? '✓ 当前' : '切换'}</span>
                        <button class="chat-btn-icon" onclick="event.stopPropagation();Chat.editProfile('${this.escapeHtml(p.name)}')" title="编辑">✎</button>
                        <button class="chat-btn-icon" onclick="event.stopPropagation();Chat.deleteProfile('${this.escapeHtml(p.name)}')" title="删除">✕</button>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        container.innerHTML = html;
    },

    getProfileModeLabel(profile = {}) {
        if (profile.mode !== 'agent') return '直接 LLM';
        return `Agent · ${profile.backend === 'codex' ? 'Codex' : 'Pi'}`;
    },

    updateProfileBackendVisibility() {
        const mode = document.getElementById('profileEditMode')?.value || 'llm';
        const backendItem = document.getElementById('profileBackendEditorItem');
        if (backendItem) backendItem.hidden = mode !== 'agent';
    },

    showAddProfile() {
        document.getElementById('profileEditName').value = '';
        document.getElementById('profileEditMode').value = 'llm';
        document.getElementById('profileEditBackend').value = 'pi';
        document.getElementById('profileEditApiUrl').value = '';
        document.getElementById('profileEditModel').value = '';
        document.getElementById('profileEditMaxTokens').value = '';
        document.getElementById('profileEditTemperature').value = '';
        document.getElementById('profileEditContextCount').value = '';
        document.getElementById('profileEditApiKey').value = '';
        this.updateProfileBackendVisibility();
        document.getElementById('profileEditor').style.display = 'block';
    },

    editProfile(name) {
        const profile = this.profiles.find(p => p.name === name);
        if (!profile) return;
        document.getElementById('profileEditName').value = profile.name || '';
        document.getElementById('profileEditMode').value = profile.mode || 'llm';
        document.getElementById('profileEditBackend').value = profile.backend || 'pi';
        document.getElementById('profileEditApiUrl').value = profile.apiUrl || '';
        document.getElementById('profileEditModel').value = profile.model || '';
        document.getElementById('profileEditMaxTokens').value = profile.maxTokens || '';
        document.getElementById('profileEditTemperature').value = profile.temperature || '';
        document.getElementById('profileEditContextCount').value = profile.contextCount || '';
        document.getElementById('profileEditApiKey').value = profile.apiKey || '';
        document.getElementById('profileEditPromptFormat').value = profile.promptFormat || 'openai';
        this.updateProfileBackendVisibility();
        document.getElementById('profileEditor').style.display = 'block';
    },

    cancelEditProfile() {
        document.getElementById('profileEditor').style.display = 'none';
    },

    saveProfile() {
        const name = document.getElementById('profileEditName').value.trim();
        const apiUrl = document.getElementById('profileEditApiUrl').value.trim();
        const model = document.getElementById('profileEditModel').value.trim();
        const maxTokens = parseInt(document.getElementById('profileEditMaxTokens').value) || 1000;
        const temperature = parseFloat(document.getElementById('profileEditTemperature').value) || 0.7;
        const contextCount = parseInt(document.getElementById('profileEditContextCount').value) || 0;
        const apiKey = document.getElementById('profileEditApiKey').value.trim();
        const mode = document.getElementById('profileEditMode').value;
        const backend = document.getElementById('profileEditBackend').value === 'codex' ? 'codex' : 'pi';

        if (!name) {
            window.showToast('请输入配置名称', 'error');
            return;
        }
        if (!apiUrl) {
            window.showToast('请输入 API URL', 'error');
            return;
        }
        if (!model) {
            window.showToast('请输入模型名称', 'error');
            return;
        }

        const existingIdx = this.profiles.findIndex(p => p.name === name);
        const promptFormat = document.getElementById('profileEditPromptFormat').value;
        const profile = { name, apiUrl, model, maxTokens, temperature, contextCount, apiKey, promptFormat, mode };
        if (mode === 'agent') profile.backend = backend;

        if (existingIdx >= 0) {
            this.profiles[existingIdx] = profile;
        } else {
            this.profiles.push(profile);
        }

        fetch('/api/chat/profiles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profiles: this.profiles })
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                window.showToast(existingIdx >= 0 ? '配置已更新' : '配置已添加', 'success');
                this.cancelEditProfile();
                this.renderProfileSelector();
            } else {
                window.showToast('保存配置失败: ' + (data.message || data.error), 'error');
            }
        })
        .catch(err => window.showToast('保存配置失败', 'error'));
    },

    deleteProfile(name) {
        if (!confirm(`确定删除配置 "${name}" ？`)) return;
        this.profiles = this.profiles.filter(p => p.name !== name);

        fetch('/api/chat/profiles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profiles: this.profiles })
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                window.showToast('配置已删除', 'success');
                this.renderProfileSelector();
            } else {
                window.showToast('删除配置失败: ' + (data.message || data.error), 'error');
            }
        })
        .catch(err => window.showToast('删除配置失败', 'error'));
    },
    
    hideConfig() {
        const modal = document.getElementById('chatConfigModal');
        if (modal) {
            modal.style.display = 'none';
        }
    },
    
    showHelp() {
        const modal = document.getElementById('chatHelpModal');
        if (modal) {
            modal.style.display = 'flex';
            this.renderBuiltinCommands();
        }
    },

    renderBuiltinCommands() {
        const container = document.getElementById('builtinVoiceCommandsList');
        if (!container) return;

        if (!Array.isArray(this.builtinCommands)) {
            container.innerHTML = '<p class="chat-empty">加载中...</p>';
            return;
        }

        if (this.builtinCommands.length === 0) {
            container.innerHTML = '<p class="chat-empty">暂无内置命令</p>';
            return;
        }

        container.innerHTML = this.builtinCommands.map(command => `
            <div class="builtin-command-item">
                <div class="builtin-command-examples">${this.escapeHtml(command.examples.join(' / '))}</div>
                <div class="builtin-command-description">${this.escapeHtml(command.description)}</div>
                <span class="builtin-command-badge">无需唤醒</span>
            </div>
        `).join('');
    },
    
    hideHelp() {
        const modal = document.getElementById('chatHelpModal');
        if (modal) {
            modal.style.display = 'none';
        }
    },
    
    showTemplates() {
        const modal = document.getElementById('chatTemplateModal');
        if (modal) {
            modal.style.display = 'flex';
            this.renderTemplateList();
        }
    },
    
    hideTemplates() {
        const modal = document.getElementById('chatTemplateModal');
        if (modal) {
            modal.style.display = 'none';
        }
    },
    
    renderTemplateList() {
        const list = document.getElementById('chatTemplateList');
        if (!list) return;
        
        if (this.templates.length === 0) {
            list.innerHTML = '<div class="chat-empty">暂无模板</div>';
            return;
        }
        
        list.innerHTML = this.templates.map(t => `
            <div class="chat-template-item">
                <div class="chat-template-info">
                    <div class="chat-template-name">${this.escapeHtml(t.name)}</div>
                    <div class="chat-template-content">${this.escapeHtml(t.content)}</div>
                    <div class="chat-template-permission-label">权限：${t.permissionProfile === 'readonly' ? '只读' : '未知'}</div>
                </div>
                <button class="chat-template-edit" onclick="Chat.editTemplate(\`${this.escapeHtml(t.name)}\`)">编辑</button>
                <button class="chat-template-delete" onclick="Chat.deleteTemplate(\`${this.escapeHtml(t.name)}\`)">删除</button>
            </div>
        `).join('');
    },
    
    addTemplate() {
        const nameInput = document.getElementById('newTemplateName');
        const contentInput = document.getElementById('newTemplateContent');
        
        const name = nameInput.value.trim();
        const content = contentInput.value.trim();
        const permissionProfile = document.getElementById('templatePermissionProfile').value || 'readonly';
        
        if (!name || !content) {
            window.showToast('请填写模板名称和内容', 'error');
            return;
        }
        
        fetch('/api/chat/templates/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, content, permissionProfile: permissionProfile })
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                this.templates = data.templates;
                this.render();
                this.renderTemplateList();
                nameInput.value = '';
                contentInput.value = '';
                document.getElementById('templatePermissionProfile').value = 'readonly';
                this.editingTemplateName = null;
                const button = document.querySelector('.chat-add-template .chat-add-btn');
                if (button) button.textContent = '添加模板';
                window.showToast('模板保存成功', 'success');
            }
        })
        .catch(err => window.showToast('添加失败', 'error'));
    },

    editTemplate(name) {
        const template = this.templates.find(item => item.name === name);
        if (!template) return;
        this.editingTemplateName = name;
        document.getElementById('newTemplateName').value = template.name || '';
        document.getElementById('newTemplateContent').value = template.content || '';
        document.getElementById('templatePermissionProfile').value = template.permissionProfile || 'readonly';
        const button = document.querySelector('.chat-add-template .chat-add-btn');
        if (button) button.textContent = '保存模板';
    },
    
    deleteTemplate(name) {
        if (!confirm('确定要删除这个模板吗？')) return;
        
        fetch(`/api/chat/templates/${encodeURIComponent(name)}`, { method: 'DELETE' })
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success') {
                    this.templates = data.templates;
                    this.render();
                    this.renderTemplateList();
                    window.showToast('模板已删除', 'success');
                }
            })
        .catch(err => window.showToast('删除失败', 'error'));
    },
    
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    handleDisplayVoiceInput(data) {
        if (data.displayId !== window.currentDisplayId) {
            return;
        }
        
        const input = document.getElementById('chatInput');
        if (input) {
            if (data.isFinal) {
                input.value = data.fullText;
            } else {
                input.value = data.fullText + '…';
            }
        }
        
        // 服务端已处理 voiceInput 消息（语音命令解析），控制端仅展示识别文本
    },

    handleDisplayChatInput(data) {
        if (!data || !data.requestId || !data.content) return;

        this.activeRequestId = data.requestId;
        this.isLoading = true;
        this.currentStreamingMessage = '';
        this.currentUserMessage = data.content;

        let assistantName = '助手';
        if (data.mode === 'private' && this.session.privateTarget) {
            assistantName = this.session.privateTarget;
        } else if (data.mode === 'role' && this.session.roleTarget) {
            assistantName = this.session.roleTarget;
        } else if (data.mode === 'temporary' && this.temporaryConversation.roleName) {
            assistantName = this.temporaryConversation.roleName;
        }

        this.showStreamingMessage(data.content, assistantName);
        this.updateSendButton();
    },
    
    processVoiceCommand(text) {
        if (!text) return;
        
        if (text === '系统') {
            this.showHelp();
            return;
        }
        
        if (text.startsWith('私聊')) {
            const name = text.substring(2).trim();
            if (name) {
                const template = this.templates.find(t => t.name === name);
                if (template) {
                    this.setMode('private', name, 'controlVoice');
                    this.addSystemMessage(`已进入私聊模式，正在与 ${name} 对话`);
                    return;
                }
            }
            if (this.templates.length > 0) {
                this.setMode('private', this.templates[0].name, 'controlVoice');
                this.addSystemMessage(`已进入私聊模式，正在与 ${this.templates[0].name} 对话`);
            }
            return;
        }
        
        if (text === '退出私聊') {
            this.setMode('group', null, 'controlVoice');
            this.addSystemMessage('已退出私聊模式');
            return;
        }
        
        for (const [keyword, actions] of Object.entries(this.commands.commands || {})) {
            if (text.includes(keyword)) {
                this.addSystemMessage(`执行指令组合: ${keyword}`);
                this.executeCommands(actions);
                return;
            }
        }
        
        if (text.includes('提醒')) {
            this.handleReminderCommand(text);
        } else if (text.includes('报时') || text.includes('现在几点')) {
            this.handleTimeAnnounceCommand(text);
        } else if (text.includes('天气')) {
            this.handleWeatherCommand(text);
        } else if (text.includes('搜索')) {
            this.handleSearchCommand(text);
        } else if (text.startsWith('聊天')) {
            const message = text.substring(2).trim();
            if (message) {
                setTimeout(() => {
                    this.sendVoiceMessage(message);
                }, 300);
            }
        } else {
            const assistantName = this.assistantConfig.defaultName || '小爱';
            if (text.includes(assistantName)) {
                const message = text.replace(assistantName, '').trim();
                if (message) {
                    setTimeout(() => {
                        this.sendVoiceMessage(message);
                    }, 300);
                }
            } else {
                if (!window.currentDisplayId && !this.session.playOnControl) {
                    window.showToast('请先选择显示端或开启控制端播放', 'error');
                    return;
                }
                
                if (window.WebSocketManager && window.WebSocketManager.ws && 
                    window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
                    window.WebSocketManager.ws.send(JSON.stringify({
                        type: 'voiceCommand',
                        displayId: window.currentDisplayId,
                        text: text,
                        playOnControl: this.session.playOnControl
                    }));
                }
            }
        }
    },
    
    executeCommands(actions) {
        if (window.WebSocketManager && window.WebSocketManager.ws &&
            window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'executeCommands',
                actions: actions,
                displayId: window.currentDisplayId,
                playOnControl: this.session.playOnControl
            }));
        }
    },
    
    handleTodayReminders() {
        this.addSystemMessage('正在查询今日提醒...');
        if (window.WebSocketManager && window.WebSocketManager.ws && 
            window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'getReminders'
            }));
        }
    },
    
    handleReminderCommand(text) {
        if (!window.currentDisplayId && !this.session.playOnControl) {
            window.showToast('请先选择显示端或开启控制端播放', 'error');
            return;
        }
        
        this.addSystemMessage(`设置提醒: ${text}`);
        
        if (window.WebSocketManager && window.WebSocketManager.ws && 
            window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'voiceCommand',
                displayId: window.currentDisplayId,
                text: text,
                playOnControl: this.session.playOnControl
            }));
        }
    },
    
    handleTimeAnnounceCommand(text) {
        if (text.includes('关闭报时')) {
            if (window.WebSocketManager && window.WebSocketManager.ws) {
                window.WebSocketManager.ws.send(JSON.stringify({
                    type: 'timeAnnounce',
                    action: 'disable'
                }));
            }
            this.addSystemMessage('已关闭报时功能');
        } else if (text.includes('开启报时')) {
            if (window.WebSocketManager && window.WebSocketManager.ws) {
                window.WebSocketManager.ws.send(JSON.stringify({
                    type: 'timeAnnounce',
                    action: 'enable'
                }));
            }
            this.addSystemMessage('已开启报时功能');
        } else {
            if (window.WebSocketManager && window.WebSocketManager.ws) {
                window.WebSocketManager.ws.send(JSON.stringify({
                    type: 'timeAnnounce',
                    action: 'announce'
                }));
            }
            const now = new Date();
            const hours = now.getHours().toString().padStart(2, '0');
            const minutes = now.getMinutes().toString().padStart(2, '0');
            this.addSystemMessage(`现在时间是 ${hours} 点 ${minutes} 分`);
        }
    },
    
    handleSearchCommand(text) {
        const query = text.replace(/搜索/, '').trim();
        if (!query) {
            this.addSystemMessage('请输入搜索内容');
            return;
        }
        
        if (!window.currentDisplayId && !this.session.playOnControl) {
            window.showToast('请先选择显示端或开启控制端播放', 'error');
            return;
        }
        
        this.addSystemMessage(`正在搜索: ${query}`);
        
        if (window.WebSocketManager && window.WebSocketManager.ws && 
            window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'voiceCommand',
                displayId: window.currentDisplayId,
                text: text,
                playOnControl: this.session.playOnControl
            }));
        }
    },
    
    handleWeatherCommand(text) {
        if (!window.currentDisplayId && !this.session.playOnControl) {
            window.showToast('请先选择显示端或开启控制端播放', 'error');
            return;
        }
        
        const city = text.replace(/天气|今天|明天|后天/g, '').trim();
        this.addSystemMessage(`正在查询${city || '本地'}天气...`);
        
        if (window.WebSocketManager && window.WebSocketManager.ws && 
            window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'voiceCommand',
                displayId: window.currentDisplayId,
                text: text,
                playOnControl: this.session.playOnControl
            }));
        }
    },
    
    handleSession(data) {
        if (data.session) {
            this.session = { ...this.session, ...data.session };
            this.renderModeIndicator();
            this.renderPlayOnControlToggle();
            this.renderSessionSelector();
            if (this.session.mode === 'private' && this.session.privateTarget) {
                this.loadSessions(this.session.privateTarget);
            }
            // 刷新恢复 role 模式：会话回包后 session 才可靠填充（onWebSocketOpen 时尚未就绪），
            // 在此补发角色历史请求，否则恢复后的角色 tab 显示「暂无聊天记录」
            if (this.session.mode === 'role' && this.session.roleTarget) {
                window.WebSocketManager.send({ type: 'roleHistory', role: this.session.roleTarget });
            }
        }
    },

    handleSessionSwitched(data) {
        if (data.sessionId) {
            this.session.privateSessionId = data.sessionId;
        }
        this.loadHistory();
        if (this.session.privateTarget) {
            this.loadSessions(this.session.privateTarget);
        }
    },

    handleSessionList(data) {
        if (data.target && data.sessions) {
            this.session.sessions[data.target] = data.sessions;
            this.renderSessionSelector();
        }
    },

    handleCommands(data) {
        if (data.commands) {
            this.commands = data.commands;
        }
    },

    handleBuiltinCommands(data) {
        if (!Array.isArray(data.commands)) return;
        this.builtinCommands = data.commands;
        this.renderBuiltinCommands();
    },

    handlePlayOnControl(data) {
        if (data.audioUrl) {
            if (this.noInterruptMode && this.isListening) {
                this.wasListeningBeforePlayback = this.isAlwaysListening;
                this.stopListening();
            }
            this.playOnControlDevice(data.audioUrl, data.text);
        }
    },
    
    renderSearchHistory() {
        const container = document.getElementById('chatSearchHistory');
        if (!container) return;
        
        if (this.searchHistory.length === 0) {
            container.style.display = 'none';
            return;
        }
        
        container.style.display = 'block';
        container.innerHTML = `
            <div class="search-history-header">
                <h4>搜索历史</h4>
                <button class="clear-btn" onclick="Chat.clearSearchHistory()">清空</button>
            </div>
            <div class="search-history-list">
                ${this.searchHistory.slice(-10).reverse().map(item => `
                    <div class="search-history-item">
                        <div class="time">${this.formatTime(item.timestamp)}</div>
                        <div class="content">
                            <div class="keyword">${this.escapeHtml(item.query)}</div>
                            <div class="result">${this.escapeHtml(item.results?.snippet || item.results?.title || '无结果')}</div>
                        </div>
                        <div class="actions">
                            <button class="action-btn" onclick="Chat.playSearchResult('${item.id}')" title="播放结果">播放</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    },
    
    formatTime(timestamp) {
        const date = new Date(timestamp);
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        return `${month}-${day} ${hours}:${minutes}`;
    },
    
    playSearchResult(id) {
        const item = this.searchHistory.find(h => h.id === id);
        if (!item) return;
        
        let text = '';
        if (item.results && item.results.snippet) {
            text = item.results.snippet;
        } else if (item.results && item.results.title) {
            text = item.results.title;
        } else {
            text = `搜索${item.query}，未找到相关结果`;
        }
        
        this.playText(text, window.currentDisplayId, this.session.playOnControl);
    },
    
    clearSearchHistory() {
        if (this.searchHistory.length === 0) {
            window.showToast('暂无搜索记录', 'info');
            return;
        }
        
        if (!confirm('确定要清空所有搜索历史吗？')) return;
        
        if (window.WebSocketManager && window.WebSocketManager.ws && 
            window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'clearSearchHistory'
            }));
            this.searchHistory = [];
            this.renderSearchHistory();
            window.showToast('已清空搜索历史', 'success');
        }
    },
    
    showCommands() {
        let modal = document.getElementById('chatCommandsModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'chatCommandsModal';
            modal.className = 'chat-modal-overlay';
            document.body.appendChild(modal);
        }
        
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="chat-modal-content">
                <div class="chat-modal-header">
                    <h3>自定义指令配置</h3>
                    <button class="chat-modal-close" onclick="Chat.hideCommands()">&times;</button>
                </div>
                <div class="chat-modal-body">
                    <div class="chat-commands-list" id="chatCommandsList">
                        ${Object.entries(this.commands.commands || {}).map(([keyword, actions]) => `
                            <div class="chat-command-item">
                                <div class="command-keyword">${this.escapeHtml(keyword)}</div>
                                <div class="command-actions">${this.escapeHtml(actions.join(', '))}</div>
                                <button class="chat-template-delete" onclick="Chat.deleteCommand('${this.escapeHtml(keyword)}')">删除</button>
                            </div>
                        `).join('') || '<div class="chat-empty">暂无自定义指令</div>'}
                    </div>
                    <div class="chat-add-template">
                        <h4>添加新指令</h4>
                        <input type="text" id="newCommandKeyword" placeholder="关键词 (如: 早上好)">
                        <textarea id="newCommandActions" placeholder="指令列表，每行一个 (如:&#10;今天天气&#10;今日提醒&#10;报时)"></textarea>
                        <button class="chat-add-btn" onclick="Chat.addCommand()">添加指令</button>
                    </div>
                </div>
            </div>
        `;
    },
    
    hideCommands() {
        const modal = document.getElementById('chatCommandsModal');
        if (modal) {
            modal.style.display = 'none';
        }
    },
    
    addCommand() {
        const keywordInput = document.getElementById('newCommandKeyword');
        const actionsInput = document.getElementById('newCommandActions');
        
        const keyword = keywordInput.value.trim();
        const actionsText = actionsInput.value.trim();
        
        if (!keyword || !actionsText) {
            window.showToast('请填写关键词和指令列表', 'error');
            return;
        }
        
        const actions = actionsText.split('\n').map(a => a.trim()).filter(a => a);
        if (actions.length === 0) {
            window.showToast('请至少添加一个指令', 'error');
            return;
        }
        
        this.commands.commands = this.commands.commands || {};
        this.commands.commands[keyword] = actions;
        this.saveCommands();
        this.showCommands();
        window.showToast('指令添加成功', 'success');
    },
    
    deleteCommand(keyword) {
        if (!confirm(`确定要删除指令 "${keyword}" 吗？`)) return;
        
        delete this.commands.commands[keyword];
        this.saveCommands();
        this.showCommands();
        window.showToast('指令已删除', 'success');
    }
};

window.Chat = Chat;
window.saveChatConfig = Chat.saveConfig.bind(Chat);
window.hideChatConfig = Chat.hideConfig.bind(Chat);
