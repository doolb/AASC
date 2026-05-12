# 私聊多会话支持实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为私聊模式添加多会话支持，同一助手下可创建多个独立会话，每个会话有独立的聊天上下文和历史记录

**Architecture:** 在 `chat-session.json` 增加 `sessions` 元数据和 `privateSessionId`；消息记录新增 `sessionId` 字段；会话键从 `private:{target}` 改为 `private:{target}:{sessionId}`；控制端通过下拉选择器切换会话

**Tech Stack:** Node.js, JavaScript (前端 Vanilla JS), CSS

---

### Task 1: llm-service.js — session 核心逻辑

**Files:**
- Modify: `src/external/llm/llm-service.js:40-42` (sessionKey)
- Modify: `src/external/llm/llm-service.js:44-49` (chatSession 初始化)
- Modify: `src/external/llm/llm-service.js:56-79` (loadHistory)
- Modify: `src/external/llm/llm-service.js:82-108` (saveHistory)
- Modify: `src/external/llm/llm-service.js:449-476` (addMessage)
- Modify: `src/external/llm/llm-service.js:372-382` (clearHistory)
- Modify: `src/external/llm/llm-service.js:397-402` (setMode)
- Modify: `src/external/llm/llm-service.js:384-395` (getSession/setSession)
- Modify: `src/external/llm/llm-service.js:501-592` (buildMessages)

- [ ] **Step 1: 修改 sessionKey 函数，增加 sessionId 参数**

```javascript
// 原: function sessionKey(mode, target) {
function sessionKey(mode, target, sessionId) {
    return mode === 'private' && target ? `private:${target}:${sessionId || 'default'}` : 'group';
}
```

查找所有调用 `sessionKey` 的地方并更新：
- `loadHistory()` line 68: `const key = sessionKey(msg.mode, msg.target, msg.sessionId);`
- `addMessage()` line 462: `const key = sessionKey(msg.mode, msg.target, msg.sessionId);`
- `clearHistory()` line 374: `const key = sessionKey(options.mode, options.target);` — 暂时不变，后面会改 clearHistory
- `buildMessages()` line 521: `const key = sessionKey(mode, target, null);` — 注意这里 null 表示用 default
- `buildMessages()` line 564: `const key = sessionKey(mode, target, null);` — 同上

实际上对于 `buildMessages`，当 `mode='private'` 且 `target=某助手` 时，传入当前会话ID：
`const key = sessionKey(mode, target, chatSession.privateSessionId);`

- [ ] **Step 2: 修改 chatSession 初始化，增加 sessionId 和 sessions 字段**

```javascript
let chatSession = {
    mode: 'group',
    privateTarget: null,
    privateSessionId: 'default',
    playOnControl: false,
    commandMode: true,
    sessions: {}
};
```

- [ ] **Step 3: 修改 loadHistory，兼容旧消息无 sessionId**

```javascript
function loadHistory() {
    try {
        const allFiles = fs.readdirSync(HISTORY_DIR)
            .filter(f => f.startsWith(HISTORY_FILE_BASE) && f.endsWith('.json'));

        if (allFiles.length === 0) return;

        chatHistories = {};
        for (const file of allFiles) {
            const data = fs.readFileSync(path.join(HISTORY_DIR, file), 'utf8');
            const messages = JSON.parse(data);
            for (const msg of messages) {
                // 旧消息无 sessionId → 默认 'default'
                if (!msg.sessionId) msg.sessionId = 'default';
                const key = sessionKey(msg.mode, msg.target, msg.sessionId);
                if (!chatHistories[key]) chatHistories[key] = [];
                chatHistories[key].push(msg);
            }
        }

        const total = Object.values(chatHistories).reduce((s, a) => s + a.length, 0);
        console.log(`[Chat] 已加载 ${total} 条历史记录 (${Object.keys(chatHistories).length} 个会话)`);
    } catch (err) {
        console.error('[Chat] 加载历史记录失败:', err.message);
        chatHistories = {};
    }
}
```

- [ ] **Step 4: 修改 saveHistory，按目标名分组保存（非完整key）**

```javascript
function saveHistory() {
    if (historySaveTimer) {
        clearTimeout(historySaveTimer);
    }
    historySaveTimer = setTimeout(() => {
        try {
            const groupedByFile = {};
            const expectedFiles = new Set();

            for (const [key, messages] of Object.entries(chatHistories)) {
                if (messages.length === 0) continue;

                let fileName;
                if (key === 'group') {
                    fileName = `${HISTORY_FILE_BASE}.json`;
                } else {
                    // key = 'private:小爱:default' → 提取 target = '小爱'
                    const parts = key.split(':');
                    const target = parts[1];
                    fileName = `${HISTORY_FILE_BASE}-${target}.json`;
                }

                if (!groupedByFile[fileName]) groupedByFile[fileName] = [];
                groupedByFile[fileName].push(...messages);
                expectedFiles.add(fileName);
            }

            // 写入文件
            for (const [fileName, messages] of Object.entries(groupedByFile)) {
                fs.writeFileSync(path.join(HISTORY_DIR, fileName), JSON.stringify(messages, null, 2), 'utf8');
            }

            // 清理已不存在的会话对应的历史文件
            const existingFiles = fs.readdirSync(HISTORY_DIR)
                .filter(f => f.startsWith(HISTORY_FILE_BASE) && f.endsWith('.json'));
            for (const f of existingFiles) {
                if (!expectedFiles.has(f)) {
                    try { fs.unlinkSync(path.join(HISTORY_DIR, f)); } catch {}
                }
            }
        } catch (err) {
            console.error('[Chat] 保存历史记录失败:', err.message);
        }
        historySaveTimer = null;
    }, 2000);
}
```

- [ ] **Step 5: 修改 addMessage，增加 sessionId 字段**

```javascript
function addMessage(message) {
    const content = message.content ? message.content.substring(0, MAX_MESSAGE_LENGTH) : '';
    const msg = {
        id: Date.now().toString() + Math.random().toString(36).substring(2, 6),
        timestamp: Date.now(),
        role: message.role || 'user',
        name: message.name || '',
        ip: message.ip || '',
        content: content,
        mode: message.mode || chatSession.mode,
        target: message.target || chatSession.privateTarget,
        sessionId: message.sessionId || chatSession.privateSessionId || 'default'
    };

    const key = sessionKey(msg.mode, msg.target, msg.sessionId);
    if (!chatHistories[key]) chatHistories[key] = [];
    chatHistories[key].push(msg);
    trimHistory();
    saveHistory();

    if (content && content.startsWith('系统记录')) {
        const importantContent = content.replace('系统记录', '').trim();
        if (importantContent) {
            addImportantRecord(importantContent, msg.role, msg.name);
        }
    }

    return msg;
}
```

- [ ] **Step 6: 修改 clearHistory，支持按 session 清理**

```javascript
function clearHistory(options = {}) {
    if (options.mode === 'private' && options.target) {
        if (options.sessionId) {
            delete chatHistories[sessionKey(options.mode, options.target, options.sessionId)];
        } else {
            // 兼容旧行为：删除该目标所有会话
            for (const key of Object.keys(chatHistories)) {
                if (key.startsWith(`private:${options.target}:`)) {
                    delete chatHistories[key];
                }
            }
        }
    } else if (options.mode === 'group') {
        delete chatHistories.group;
    } else {
        chatHistories = {};
    }
    saveHistory();
    return getHistory();
}
```

- [ ] **Step 7: 修改 setMode，重置 sessionId 为 default**

```javascript
function setMode(mode, target = null) {
    chatSession.mode = mode;
    chatSession.privateTarget = target;
    chatSession.privateSessionId = 'default';
    saveSession();
    return getSession();
}
```

- [ ] **Step 8: 修改 setSession / getSession，支持新字段**

```javascript
function getSession() {
    return { ...chatSession };
}

function setSession(session) {
    if (session.mode !== undefined) chatSession.mode = session.mode;
    if (session.privateTarget !== undefined) chatSession.privateTarget = session.privateTarget;
    if (session.privateSessionId !== undefined) chatSession.privateSessionId = session.privateSessionId;
    if (session.playOnControl !== undefined) chatSession.playOnControl = session.playOnControl;
    if (session.commandMode !== undefined) chatSession.commandMode = session.commandMode;
    if (session.sessions !== undefined) chatSession.sessions = session.sessions;
    // 初始化 sessions
    if (!chatSession.sessions) chatSession.sessions = {};
    saveSession();
    return getSession();
}
```

需在文件开头附近（`loadSession` 之后调用之前）添加 sessions 初始化：

```javascript
// 在 loadSession 之后，确保 sessions 存在
function ensureDefaultSessions() {
    if (!chatSession.sessions) {
        chatSession.sessions = {};
    }
}
```

在 `init()` 中调用 `loadSession()` 后调用 `ensureDefaultSessions()`。

- [ ] **Step 9: 修改 buildMessages，传入当前 sessionId**

```javascript
// line 521: raw 格式
const key = sessionKey(mode, target, chatSession.privateSessionId);

// line 564: 标准 messages 格式
const key = sessionKey(mode, target, chatSession.privateSessionId);
```

- [ ] **Step 10: 新增 session 管理函数**

在 `llm-service.js` 的 exports 部分前添加：

```javascript
function listSessions(target) {
    if (!chatSession.sessions) chatSession.sessions = {};
    if (!chatSession.sessions[target]) {
        chatSession.sessions[target] = [
            { id: 'default', name: '默认会话', createdAt: Date.now() }
        ];
        saveSession();
    }
    return chatSession.sessions[target];
}

function createSession(target, name) {
    if (!chatSession.sessions) chatSession.sessions = {};
    if (!chatSession.sessions[target]) {
        chatSession.sessions[target] = [
            { id: 'default', name: '默认会话', createdAt: Date.now() }
        ];
    }

    const sessionId = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const session = {
        id: sessionId,
        name: name || '新会话',
        createdAt: Date.now()
    };
    chatSession.sessions[target].push(session);
    saveSession();
    return session;
}

function deleteSession(target, sessionId) {
    if (sessionId === 'default') return false;

    if (!chatSession.sessions || !chatSession.sessions[target]) return false;

    chatSession.sessions[target] = chatSession.sessions[target].filter(s => s.id !== sessionId);

    // 删除对应历史
    delete chatHistories[`private:${target}:${sessionId}`];
    saveHistory();

    // 如果当前会话被删除，切回 default
    if (chatSession.privateTarget === target && chatSession.privateSessionId === sessionId) {
        chatSession.privateSessionId = 'default';
    }

    saveSession();
    return true;
}

function switchSession(target, sessionId) {
    if (!chatSession.sessions || !chatSession.sessions[target]) return false;
    const exists = chatSession.sessions[target].some(s => s.id === sessionId);
    if (!exists) return false;

    chatSession.privateTarget = target;
    chatSession.privateSessionId = sessionId;
    saveSession();
    return true;
}

function getSessionHistory(target, sessionId) {
    return chatHistories[`private:${target}:${sessionId || 'default'}`] || [];
}
```

在 `module.exports` 中添加：
```javascript
listSessions,
createSession,
deleteSession,
switchSession,
getSessionHistory
```

- [ ] **Step 11: 运行自检**

Run: `node -e "const c=require('./src/external/llm/llm-service.js'); console.log('llm-service loaded')"` (从项目根目录)

Expected: 无报错，模块加载成功

- [ ] **Step 12: Commit**

```bash
git add src/external/llm/llm-service.js
git commit -m "feat(private-chat): 添加多会话核心逻辑，消息增加 sessionId 字段"
```

---

### Task 2: server-app.js — session 管理 handler

**Files:**
- Modify: `src/apps/server/boot/server-app.js`

- [ ] **Step 1: 找到 WebSocket handler 中的 getChatSession/setChatSession 区域**

读取 `/mnt/AASC/src/apps/server/boot/server-app.js:2824-2836` 确认现有代码。

在 `setChatSession` handler 之后添加 session 管理 handler：

```javascript
} else if (data.type === 'listPrivateSessions') {
    ws.send(JSON.stringify({
        type: 'privateSessions',
        target: data.target,
        sessions: chat.listSessions(data.target)
    }));
    return;
} else if (data.type === 'createPrivateSession') {
    const session = chat.createSession(data.target, data.name);
    ws.send(JSON.stringify({
        type: 'privateSessionCreated',
        target: data.target,
        session: session
    }));
    broadcastToControls({
        type: 'privateSessionCreated',
        target: data.target,
        session: session
    });
    return;
} else if (data.type === 'deletePrivateSession') {
    const success = chat.deleteSession(data.target, data.sessionId);
    ws.send(JSON.stringify({
        type: 'privateSessionDeleted',
        target: data.target,
        sessionId: data.sessionId,
        success: success
    }));
    if (success) {
        broadcastToControls({
            type: 'privateSessionDeleted',
            target: data.target,
            sessionId: data.sessionId
        });
    }
    return;
} else if (data.type === 'switchPrivateSession') {
    const success = chat.switchSession(data.target, data.sessionId);
    if (success) {
        ws.send(JSON.stringify({
            type: 'privateSessionSwitched',
            target: data.target,
            sessionId: data.sessionId
        }));
        broadcastToControls({
            type: 'privateSessionSwitched',
            target: data.target,
            sessionId: data.sessionId
        });
    }
    return;
}
```

- [ ] **Step 2: 找到 `chatMessage` handler (line ~3059)，修改消息传递 sessionId**

```javascript
// 在 handleChatMessage 调用参数中新增 sessionId
// 找到 data.mode === 'private' 时构建 target 的地方，添加 sessionId
await handleChatMessage({
    content: data.content,
    displayContent: data.displayContent || data.content,
    displayId: targetDisplayId,
    displayIds: targetDisplayIds,
    playOnControl: data.playOnControl || session.playOnControl,
    templateTarget: data.templateTarget || data.target,
    mode: data.mode || session.mode,
    target: data.mode === 'private' ? (data.target || session.privateTarget) : null,
    sessionId: data.sessionId || session.privateSessionId || 'default',  // 新增
    sendToControl: (msg) => {
        ws.send(JSON.stringify(msg));
    }
});
```

- [ ] **Step 3: 修改 handleChatMessage 函数 (line ~3163)**

```javascript
async function handleChatMessage(options) {
    const {
        content,
        displayContent,
        displayId,
        displayIds = [],
        playOnControl = false,
        systemPrompt: customSystemPrompt,
        templateTarget,
        mode = 'group',
        target,
        sessionId,  // 新增
        sendToControl
    } = options;

    const messageMode = mode;
    const messageTarget = messageMode === 'private' ? target : null;

    chat.addMessage({
        role: 'control',
        name: '控制端',
        content: displayContent || content,
        mode: messageMode,
        target: messageTarget,
        sessionId: sessionId  // 新增
    });
    // ... 其余不变
```

- [ ] **Step 4: 找到 voiceCommand.handleSystemCommand 的 privateMode/groupMode 返回处理 (line ~2698)**

确保 `privateMode` 广播时重置会话：

```javascript
} else if (result.type === 'privateMode' || result.type === 'groupMode') {
    // privateMode 已在 voiceCommand 内部调用了 chat.setMode
    broadcastToControls({
        type: result.type === 'privateMode' ? 'privateMode' : 'groupMode',
        target: result.target
    });
```

`voiceCommand` 中的 `setMode` 调用已重置 `privateSessionId = 'default'`，所以语音命令进入私聊时自动在 default 会话。

- [ ] **Step 5: 添加 HTTP API**

在 server-app.js 中找到 HTTP API 路由区域，添加：

```javascript
// 在 GET /api/chat/session 附近添加
app.get('/api/chat/sessions', (req, res) => {
    const target = req.query.target;
    if (!target) {
        return res.json({ status: 'error', message: '缺少 target 参数' });
    }
    res.json({ status: 'success', sessions: chat.listSessions(target) });
});

app.post('/api/chat/sessions/create', (req, res) => {
    const { target, name } = req.body;
    if (!target) {
        return res.json({ status: 'error', message: '缺少 target 参数' });
    }
    const session = chat.createSession(target, name || '新会话');
    res.json({ status: 'success', session });
});

app.post('/api/chat/sessions/delete', (req, res) => {
    const { target, sessionId } = req.body;
    const success = chat.deleteSession(target, sessionId);
    if (success) {
        res.json({ status: 'success' });
    } else {
        res.json({ status: 'error', message: '删除失败（默认会话不可删除或目标不存在）' });
    }
});

app.post('/api/chat/sessions/switch', (req, res) => {
    const { target, sessionId } = req.body;
    const success = chat.switchSession(target, sessionId);
    if (success) {
        res.json({ status: 'success', sessionId });
    } else {
        res.json({ status: 'error', message: '切换失败（会话不存在）' });
    }
});
```

- [ ] **Step 6: 运行语法检查**

Run: `node -c src/apps/server/boot/server-app.js`
Expected: `SyntaxError` or no output (node -c returns nothing on success)

- [ ] **Step 7: Commit**

```bash
git add src/apps/server/boot/server-app.js
git commit -m "feat(private-chat): 服务端增加 session 管理 WebSocket/HTTP handler"
```

---

### Task 3: chat.js 前端 — 会话选择器 UI

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/chat.js`

- [ ] **Step 1: 修改 session 默认值，增加 session 相关字段**

```javascript
// line 13-18
session: {
    mode: 'group',
    privateTarget: null,
    privateSessionId: 'default',   // 新增
    playOnControl: false,
    commandMode: true,
    sessions: {}                    // 新增
},
```

- [ ] **Step 2: 增加 session 管理函数**

在 `loadCommands()` 之后添加：

```javascript
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
            // 保存后重新加载历史和 session
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
            // 如果删除的是当前会话，自动切回 default
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
```

- [ ] **Step 3: 修改 `setMode`，重置 sessionId 并加载会话列表**

```javascript
setMode(mode, target = null) {
    this.session.mode = mode;
    this.session.privateTarget = target;
    this.session.privateSessionId = 'default';
    this.saveSession();
    this.render();
    if (mode === 'private' && target) {
        this.loadSessions(target);
    }
},
```

- [ ] **Step 4: 添加 `renderSessionSelector` 渲染函数**

```javascript
renderSessionSelector() {
    const container = document.getElementById('chatSessionSelector');
    if (!container) return;

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

onSessionChange(sessionId) {
    if (sessionId === this.session.privateSessionId) return;
    this.switchSession(sessionId);
},
```

- [ ] **Step 5: 修改 `render()`，在 chat-header 中添加会话选择器**

找到 `render()` 中的 chat-header 部分（line 486-496），在 mode-indicator 后添加：

```javascript
container.innerHTML = `
    ${tabsHtml}
    <div class="chat-main">
        <div class="chat-header">
            <h3>AI 聊天助手</h3>
            <div class="chat-mode-indicator" id="chatModeIndicator"></div>
            <div class="chat-session-selector" id="chatSessionSelector"></div>  <!-- 新增 -->
            <div class="chat-actions">
                <button class="chat-action-btn" onclick="Chat.showConfig()">设置</button>
                <button class="chat-action-btn" onclick="Chat.showTemplates()">模板</button>
                <button class="chat-action-btn" onclick="Chat.showCommands()">指令</button>
                <button class="chat-action-btn" onclick="Chat.clearHistory()">清空</button>
            </div>
        </div>
```

然后在 `render()` 末尾加：
```javascript
this.renderSessionSelector();
```

- [ ] **Step 6: 修改 `renderHistory()`，按 sessionId 过滤私聊消息**

```javascript
// 原: 在 line 564-572
if (this.session.mode === 'private' && this.session.privateTarget) {
    indexedHistory = indexedHistory.filter(({ item }) =>
        item.mode === 'private' && item.target === this.session.privateTarget
        && (item.sessionId || 'default') === (this.session.privateSessionId || 'default')
    );
} else {
    indexedHistory = indexedHistory.filter(({ item }) =>
        item.mode !== 'private'
    );
}
```

- [ ] **Step 7: 修改 `clearHistory()`，传递 sessionId**

```javascript
clearHistory() {
    const mode = this.session.mode;
    const target = this.session.privateTarget;
    const sessionId = this.session.privateSessionId;
    let confirmText;
    if (mode === 'private') {
        // 找到当前会话名
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
        body: JSON.stringify({ mode, target, sessionId })  // 新增 sessionId
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
```

- [ ] **Step 8: 修改 `sendMessage()` 传入 sessionId**

```javascript
// line 737-745, chatMessage 构建部分
const chatMessage = {
    type: 'chatMessage',
    content: sendMessage,
    displayContent: displayMessage,
    mode: mode,
    target: target,
    templateTarget: templateTarget,
    sessionId: this.session.privateSessionId || 'default',  // 新增
    playOnControl: this.session.playOnControl
};
```

- [ ] **Step 9: 添加 `handleSessionSwitched` 和 `handleSessionList` 方法**

```javascript
handleSessionSwitched(data) {
    if (data.sessionId) {
        this.session.privateSessionId = data.sessionId;
    }
    // 重新加载历史和会话列表
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
```

- [ ] **Step 10: 修改 `handleSession`，合并 sessions 数据**

```javascript
handleSession(data) {
    if (data.session) {
        this.session = { ...this.session, ...data.session };
        this.renderModeIndicator();
        this.renderPlayOnControlToggle();
        this.renderSessionSelector();
        // 加载当前目标会话列表
        if (this.session.mode === 'private' && this.session.privateTarget) {
            this.loadSessions(this.session.privateTarget);
        }
    }
},
```

- [ ] **Step 11: 运行语法检查**

Run: `node -c src/apps/web-mediacenter/ui/public/js/chat.js`
Expected: 无报错

- [ ] **Step 12: Commit**

```bash
git add src/apps/web-mediacenter/ui/public/js/chat.js
git commit -m "feat(private-chat): 控制端添加会话选择器 UI"
```

---

### Task 4: websocket.js 客户端 — 新增消息处理

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/websocket.js`

- [ ] **Step 1: 在 `handleMessage` 的 `chatSession` 处理之后添加新消息类型**

在 `chatSession` 处理（line 191-194）之后添加：

```javascript
} else if (data.type === 'privateSessions') {
    if (window.Chat) {
        window.Chat.handleSessionList(data);
    }
} else if (data.type === 'privateSessionCreated') {
    if (window.Chat) {
        window.Chat.handleSessionList(data);
        window.showToast('会话已创建', 'success');
    }
} else if (data.type === 'privateSessionDeleted') {
    if (window.Chat) {
        // 重新加载会话和历史
        if (window.Chat.session.privateTarget) {
            window.Chat.loadSessions(window.Chat.session.privateTarget);
        }
        window.Chat.loadHistory();
        window.showToast('会话已删除', 'success');
    }
} else if (data.type === 'privateSessionSwitched') {
    if (window.Chat) {
        window.Chat.handleSessionSwitched(data);
    }
}
```

- [ ] **Step 2: 运行语法检查**

Run: `node -c src/apps/web-mediacenter/ui/public/js/websocket.js`
Expected: 无报错

- [ ] **Step 3: Commit**

```bash
git add src/apps/web-mediacenter/ui/public/js/websocket.js
git commit -m "feat(private-chat): 控制端 WebSocket 新增 session 消息处理"
```

---

### Task 5: chat.css — 会话选择器样式

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/css/chat.css`

- [ ] **Step 1: 在 chat-mode-indicator 样式后添加会话选择器样式**

```css
/* 会话选择器 */
.chat-session-selector {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 10px;
}

.session-label {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.6);
    white-space: nowrap;
}

.session-select {
    padding: 4px 8px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.3);
    color: #fff;
    font-size: 12px;
    cursor: pointer;
    max-width: 120px;
    outline: none;
}

.session-select:hover {
    border-color: rgba(102, 126, 234, 0.5);
}

.session-select option {
    background: #2a2a3a;
    color: #fff;
}

.session-btn {
    padding: 4px 8px;
    border: none;
    border-radius: 4px;
    font-size: 14px;
    cursor: pointer;
    transition: background 0.2s;
    line-height: 1;
}

.session-add {
    background: rgba(46, 204, 113, 0.3);
    color: #2ecc71;
}

.session-add:hover {
    background: rgba(46, 204, 113, 0.5);
}

.session-del {
    background: rgba(231, 76, 60, 0.3);
    color: #e74c3c;
}

.session-del:hover {
    background: rgba(231, 76, 60, 0.5);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/apps/web-mediacenter/ui/public/css/chat.css
git commit -m "style(private-chat): 添加会话选择器样式"
```

---

### Task 6: 更新文档

**Files:**
- Modify: `docs/spec/chat-system.md`
- Modify: `docs/design/private-chat-sessions.md`

- [ ] **Step 1: 更新 spec 文档 `docs/spec/chat-system.md`**

在 `sessionKey` 部分更新签名：
```
sessionKey(mode, target, sessionId):
    私聊且有 target → 'private:{target}:{sessionId || "default"}'
    否则 → 'group'
```

在 `chatSession` 数据结构中添加：
```
privateSessionId: string,    // 当前私聊会话ID（默认 'default'）
sessions: {},                // 会话元数据 { "小爱": [{ id, name, createdAt }] }
```

在 `addMessage` 中添加 `sessionId` 参数。

在 `clearHistory` 中添加 `sessionId` 参数。

在 `chat.js` 的 `sendMessage` 部分添加 `sessionId` 字段。

在消息类型汇总表中添加 session 管理相关消息类型。

- [ ] **Step 2: 确认设计文档已保存**

确认 `docs/design/private-chat-sessions.md` 已存在，内容完整。

- [ ] **Step 3: Commit**

```bash
git add docs/spec/chat-system.md docs/design/private-chat-sessions.md
git commit -m "docs(private-chat): 更新多会话设计文档和实现文档"
```

---

## 自测清单

### 后端自测

1. **向后兼容测试**: 启动服务，检查 `chat-history-小爱.json` 中的旧消息（无 sessionId）是否被正确加载为 `default` 会话
2. **新消息测试**: 在私聊模式下发送消息，检查消息记录中是否包含 `sessionId: 'default'`
3. **切换会话测试**: 调用 `switchSession` API，发送消息后检查历史是否独立
4. **新建会话测试**: 创建新会话后发送消息，检查历史文件是否正确包含新会话消息
5. **删除会话测试**: 删除非 default 会话，检查历史是否被清理；尝试删除 default 会话应被拒绝
6. **清空会话测试**: 清空特定会话的历史，其他会话不受影响

### 前端自测

1. **会话选择器显示**: 私聊模式下头部显示下拉选择器
2. **会话切换**: 切换下拉选项后聊天记录切换到对应会话
3. **新建会话**: 点击 + 按钮，输入名称，确认会话创建并显示在下拉列表
4. **删除会话**: 点击 × 按钮，确认删除，当前会话被删除后自动切回 default
5. **消息过滤**: 每个会话只显示自己的消息
6. **清空操作**: 清空只影响当前会话

### 兼容性测试

1. 旧版本 `chat-session.json`（无 sessions/privateSessionId 字段）→ 自动初始化
2. 旧历史文件中的消息（无 sessionId 字段）→ 自动归类到 default 会话
