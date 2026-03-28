const Chat = {
    history: [],
    templates: [],
    config: {
        systemPrompt: '你是一个友好的助手，请用简洁的语言回答问题。'
    },
    isLoading: false,
    currentStreamingMessage: '',
    currentUserMessage: '',
    
    init() {
        this.loadHistory();
        this.loadTemplates();
        this.loadConfig();
        this.render();
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
                    this.renderTemplates();
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
                }
            })
            .catch(err => console.error('加载聊天配置失败:', err));
    },
    
    saveConfig() {
        const systemPromptInput = document.getElementById('chatSystemPrompt');
        if (systemPromptInput) {
            this.config.systemPrompt = systemPromptInput.value.trim() || '你是一个友好的助手，请用简洁的语言回答问题。';
        }
        
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
        
        container.innerHTML = `
            <div class="chat-header">
                <h3>AI 聊天助手</h3>
                <div class="chat-actions">
                    <button class="chat-action-btn" onclick="Chat.showConfig()">设置</button>
                    <button class="chat-action-btn" onclick="Chat.showTemplates()">模板</button>
                    <button class="chat-action-btn" onclick="Chat.clearHistory()">清空</button>
                </div>
            </div>
            <div class="chat-messages" id="chatMessages"></div>
            <div class="chat-input-area">
                <select id="chatTemplateSelect" class="chat-template-select">
                    <option value="">不使用模板</option>
                </select>
                <div class="chat-input-row">
                    <input type="text" id="chatInput" placeholder="输入消息..." onkeypress="Chat.handleKeyPress(event)">
                    <button class="chat-send-btn" onclick="Chat.sendMessage()" id="chatSendBtn">发送</button>
                </div>
            </div>
        `;
        
        this.renderHistory();
        this.renderTemplates();
    },
    
    renderHistory() {
        const messagesContainer = document.getElementById('chatMessages');
        if (!messagesContainer) return;
        
        if (this.history.length === 0) {
            messagesContainer.innerHTML = '<div class="chat-empty">暂无聊天记录</div>';
            return;
        }
        
        messagesContainer.innerHTML = this.history.map(item => `
            <div class="chat-message-group">
                <div class="chat-message user">
                    <div class="chat-message-content">${this.escapeHtml(item.user)}</div>
                </div>
                <div class="chat-message assistant">
                    <div class="chat-message-content">${this.escapeHtml(item.assistant)}</div>
                </div>
            </div>
        `).join('');
        
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    },
    
    renderTemplates() {
        const select = document.getElementById('chatTemplateSelect');
        if (!select) return;
        
        select.innerHTML = '<option value="">不使用模板</option>' + 
            this.templates.map(t => `<option value="${t.id}">${this.escapeHtml(t.name)}</option>`).join('');
    },
    
    handleKeyPress(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.sendMessage();
        }
    },
    
    sendMessage() {
        if (this.isLoading) return;
        
        const input = document.getElementById('chatInput');
        const templateSelect = document.getElementById('chatTemplateSelect');
        const message = input.value.trim();
        
        if (!message) return;
        
        if (!window.currentDisplayId) {
            window.showToast('请先选择显示端', 'error');
            return;
        }
        
        const useTemplate = templateSelect ? templateSelect.value : null;
        
        this.isLoading = true;
        this.currentStreamingMessage = '';
        this.currentUserMessage = message;
        this.updateSendButton();
        this.showStreamingMessage(message);
        
        if (window.WebSocketManager && window.WebSocketManager.ws && 
            window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'chat',
                displayId: window.currentDisplayId,
                message: message,
                useTemplate: useTemplate || null
            }));
        }
        
        input.value = '';
    },
    
    showStreamingMessage(userMessage) {
        const messagesContainer = document.getElementById('chatMessages');
        if (!messagesContainer) return;
        
        const emptyMsg = messagesContainer.querySelector('.chat-empty');
        if (emptyMsg) {
            emptyMsg.remove();
        }
        
        const group = document.createElement('div');
        group.className = 'chat-message-group';
        group.id = 'streamingGroup';
        group.innerHTML = `
            <div class="chat-message user">
                <div class="chat-message-content">${this.escapeHtml(userMessage)}</div>
            </div>
            <div class="chat-message assistant">
                <div class="chat-message-content" id="streamingContent"><span class="chat-cursor">|</span></div>
            </div>
        `;
        
        messagesContainer.appendChild(group);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    },
    
    handleChunk(data) {
        this.currentStreamingMessage = data.message;
        
        const streamingContent = document.getElementById('streamingContent');
        if (streamingContent) {
            streamingContent.innerHTML = this.escapeHtml(data.message) + '<span class="chat-cursor">|</span>';
            
            const messagesContainer = document.getElementById('chatMessages');
            if (messagesContainer) {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
        }
    },
    
    handleResponse(data) {
        this.isLoading = false;
        this.updateSendButton();
        
        const streamingGroup = document.getElementById('streamingGroup');
        if (streamingGroup) {
            const streamingContent = streamingGroup.querySelector('#streamingContent');
            if (streamingContent) {
                streamingContent.innerHTML = this.escapeHtml(data.message);
                streamingContent.removeAttribute('id');
            }
            streamingGroup.removeAttribute('id');
        }
        
        if (data.success) {
            this.history = data.history;
        } else {
            window.showToast('聊天失败: ' + data.error, 'error');
        }
    },
    
    updateSendButton() {
        const btn = document.getElementById('chatSendBtn');
        if (btn) {
            btn.textContent = this.isLoading ? '发送中...' : '发送';
            btn.disabled = this.isLoading;
        }
    },
    
    clearHistory() {
        if (!confirm('确定要清空聊天记录吗？')) return;
        
        fetch('/api/chat/clear', { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success') {
                    this.history = [];
                    this.renderHistory();
                    window.showToast('聊天记录已清空', 'success');
                }
            })
            .catch(err => window.showToast('清空失败', 'error'));
    },
    
    showConfig() {
        const modal = document.getElementById('chatConfigModal');
        if (modal) {
            modal.style.display = 'flex';
            const textarea = document.getElementById('chatSystemPrompt');
            if (textarea) {
                textarea.value = this.config.systemPrompt;
            }
        }
    },
    
    hideConfig() {
        const modal = document.getElementById('chatConfigModal');
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
                </div>
                <button class="chat-template-delete" onclick="Chat.deleteTemplate('${t.id}')">删除</button>
            </div>
        `).join('');
    },
    
    addTemplate() {
        const nameInput = document.getElementById('newTemplateName');
        const contentInput = document.getElementById('newTemplateContent');
        
        const name = nameInput.value.trim();
        const content = contentInput.value.trim();
        
        if (!name || !content) {
            window.showToast('请填写模板名称和内容', 'error');
            return;
        }
        
        fetch('/api/chat/templates/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, content })
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                this.templates = data.templates;
                this.renderTemplates();
                this.renderTemplateList();
                nameInput.value = '';
                contentInput.value = '';
                window.showToast('模板添加成功', 'success');
            }
        })
        .catch(err => window.showToast('添加失败', 'error'));
    },
    
    deleteTemplate(id) {
        if (!confirm('确定要删除这个模板吗？')) return;
        
        fetch(`/api/chat/templates/${id}`, { method: 'DELETE' })
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success') {
                    this.templates = data.templates;
                    this.renderTemplates();
                    this.renderTemplateList();
                    window.showToast('模板已删除', 'success');
                }
            })
            .catch(err => window.showToast('删除失败', 'error'));
    },
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

window.Chat = Chat;
window.saveChatConfig = Chat.saveConfig.bind(Chat);
window.hideChatConfig = Chat.hideConfig.bind(Chat);
