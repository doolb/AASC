const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { isSentenceEnd, splitIntoSentences } = require('../../core/utils/sentence-splitter');

const { USER_CONFIG_DIR } = require('../../apps/server/modules/config/user-config-paths');

const HISTORY_DIR = USER_CONFIG_DIR;
const HISTORY_FILE_BASE = 'chat-history';
const SESSION_FILE = path.join(USER_CONFIG_DIR, 'chat-session.json');
const COMMANDS_FILE = path.join(USER_CONFIG_DIR, 'chat-commands.json');
const IMPORTANT_FILE = path.join(USER_CONFIG_DIR, 'important-records.json');
const TEMPLATES_FILE = path.join(USER_CONFIG_DIR, 'chat-templates.json');
const MAX_MESSAGE_LENGTH = 51200;

const DEFAULT_TEMPLATES = [
    {
        id: '小爱',
        name: '小爱',
        content: '你是小爱，一个友好、活泼的智能助手。请用简洁、亲切的语言回答问题。',
        createdAt: Date.now()
    }
];

let chatConfig = {
    agentBackend: 'codex',
    apiUrl: 'http://192.168.1.12:8080/v1/chat/completions',
    model: 'gpt-3.5-turbo',
    maxTokens: 1000,
    temperature: 0.7,
    apiKey: '',
    contextCount: 0,
    systemPrompt: '你是一个友好的助手，请用简洁的语言回答问题。',
    promptFormat: 'openai'
};

let llmProfiles = [];
let activeProfile = 'default';

let chatHistories = {};
const MAX_HISTORY_PER_SESSION = 100;

function sessionKey(mode, target, sessionId) {
    return mode === 'private' && target ? `private:${target}:${sessionId || 'default'}` : 'group';
}
let chatTemplates = [];
let chatSession = {
    mode: 'group',
    privateTarget: null,
    privateSessionId: 'default',
    playOnControl: false,
    commandMode: true,
    sessions: {}
};
let chatCommands = {
    commands: {}
};
let importantRecords = [];
let historySaveTimer = null;

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

function saveHistory() {
    if (historySaveTimer) {
        clearTimeout(historySaveTimer);
    }
    historySaveTimer = setTimeout(() => {
        try {
            if (!fs.existsSync(HISTORY_DIR)) {
                fs.mkdirSync(HISTORY_DIR, { recursive: true });
            }
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

function trimHistory() {
    for (const key of Object.keys(chatHistories)) {
        if (chatHistories[key].length > MAX_HISTORY_PER_SESSION) {
            chatHistories[key] = chatHistories[key].slice(-MAX_HISTORY_PER_SESSION);
        }
    }
}

function init(config = {}) {
    if (config.agentBackend === 'codex' || config.agentBackend === 'claude') chatConfig.agentBackend = config.agentBackend;
    if (config.apiUrl) chatConfig.apiUrl = config.apiUrl;
    if (config.model) chatConfig.model = config.model;
    if (config.maxTokens) chatConfig.maxTokens = config.maxTokens;
    if (config.temperature) chatConfig.temperature = config.temperature;
    if (config.systemPrompt) chatConfig.systemPrompt = config.systemPrompt;
    if (config.llmProfiles) {
        llmProfiles = config.llmProfiles;
    } else {
        llmProfiles = [{
            name: 'default',
            apiUrl: chatConfig.apiUrl,
            model: chatConfig.model,
            maxTokens: chatConfig.maxTokens,
            temperature: chatConfig.temperature,
            apiKey: chatConfig.apiKey,
            contextCount: chatConfig.contextCount,
            promptFormat: chatConfig.promptFormat
        }];
    }
    if (config.activeProfile && llmProfiles.some(p => p.name === config.activeProfile)) {
        activeProfile = config.activeProfile;
        applyProfile(activeProfile);
    } else {
        activeProfile = llmProfiles[0] ? llmProfiles[0].name : 'default';
        applyProfile(activeProfile);
    }
    loadHistory();
    loadSession();
    ensureDefaultSessions();
    loadCommands();
    loadTemplates();
    loadImportantRecords();
}

function applyProfile(name) {
    const profile = llmProfiles.find(p => p.name === name);
    if (profile) {
        chatConfig.apiUrl = profile.apiUrl;
        chatConfig.model = profile.model;
        chatConfig.apiKey = profile.apiKey || '';
        if (profile.maxTokens) chatConfig.maxTokens = profile.maxTokens;
        if (profile.temperature !== undefined) chatConfig.temperature = profile.temperature;
        if (profile.contextCount !== undefined) chatConfig.contextCount = profile.contextCount;
        if (profile.promptFormat !== undefined) chatConfig.promptFormat = profile.promptFormat;
        activeProfile = profile.name;
    }
}

function loadTemplates() {
    try {
        if (fs.existsSync(TEMPLATES_FILE)) {
            const data = fs.readFileSync(TEMPLATES_FILE, 'utf8');
            chatTemplates = JSON.parse(data);
            console.log(`[Chat] 已加载 ${chatTemplates.length} 个模板`);
        } else {
            chatTemplates = DEFAULT_TEMPLATES;
            saveTemplates();
            console.log(`[Chat] 已创建默认模板`);
        }
    } catch (err) {
        console.error('[Chat] 加载模板失败:', err.message);
        chatTemplates = DEFAULT_TEMPLATES;
    }
}

function saveTemplates() {
    try {
        const dir = path.dirname(TEMPLATES_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(chatTemplates, null, 2), 'utf8');
    } catch (err) {
        console.error('[Chat] 保存模板失败:', err.message);
    }
}

function loadSession() {
    try {
        if (fs.existsSync(SESSION_FILE)) {
            const data = fs.readFileSync(SESSION_FILE, 'utf8');
            chatSession = { ...chatSession, ...JSON.parse(data) };
            console.log('[Chat] 已加载会话状态');
        }
    } catch (err) {
        console.error('[Chat] 加载会话状态失败:', err.message);
    }
}

function saveSession() {
    try {
        const dir = path.dirname(SESSION_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(SESSION_FILE, JSON.stringify(chatSession, null, 2), 'utf8');
    } catch (err) {
        console.error('[Chat] 保存会话状态失败:', err.message);
    }
}

function ensureDefaultSessions() {
    if (!chatSession.sessions) {
        chatSession.sessions = {};
    }
}

function loadCommands() {
    try {
        if (fs.existsSync(COMMANDS_FILE)) {
            const data = fs.readFileSync(COMMANDS_FILE, 'utf8');
            chatCommands = { ...chatCommands, ...JSON.parse(data) };
            console.log('[Chat] 已加载自定义指令');
        }
    } catch (err) {
        console.error('[Chat] 加载自定义指令失败:', err.message);
    }
}

function saveCommands() {
    try {
        const dir = path.dirname(COMMANDS_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(COMMANDS_FILE, JSON.stringify(chatCommands, null, 2), 'utf8');
    } catch (err) {
        console.error('[Chat] 保存自定义指令失败:', err.message);
    }
}

function loadImportantRecords() {
    try {
        if (fs.existsSync(IMPORTANT_FILE)) {
            const data = fs.readFileSync(IMPORTANT_FILE, 'utf8');
            importantRecords = JSON.parse(data);
            console.log(`[Chat] 已加载 ${importantRecords.length} 条重要记录`);
        }
    } catch (err) {
        console.error('[Chat] 加载重要记录失败:', err.message);
        importantRecords = [];
    }
}

function saveImportantRecords() {
    try {
        const dir = path.dirname(IMPORTANT_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(IMPORTANT_FILE, JSON.stringify(importantRecords, null, 2), 'utf8');
    } catch (err) {
        console.error('[Chat] 保存重要记录失败:', err.message);
    }
}

function getConfig() {
    return {
        ...chatConfig,
        llmProfiles: llmProfiles.map(p => ({ ...p })),
        activeProfile
    };
}

function setConfig(newConfig) {
    if (newConfig.agentBackend !== undefined) {
        if (newConfig.agentBackend !== 'codex' && newConfig.agentBackend !== 'claude') {
            throw new Error('Agent 后端不合法');
        }
        chatConfig.agentBackend = newConfig.agentBackend;
    }
    if (newConfig.apiUrl !== undefined) chatConfig.apiUrl = newConfig.apiUrl;
    if (newConfig.model !== undefined) chatConfig.model = newConfig.model;
    if (newConfig.maxTokens !== undefined) chatConfig.maxTokens = newConfig.maxTokens;
    if (newConfig.temperature !== undefined) chatConfig.temperature = newConfig.temperature;
    if (newConfig.apiKey !== undefined) chatConfig.apiKey = newConfig.apiKey;
    if (newConfig.contextCount !== undefined) chatConfig.contextCount = newConfig.contextCount;
    if (newConfig.systemPrompt !== undefined) chatConfig.systemPrompt = newConfig.systemPrompt;
    if (newConfig.promptFormat !== undefined) chatConfig.promptFormat = newConfig.promptFormat;
    if (newConfig.llmProfiles !== undefined) {
        llmProfiles = newConfig.llmProfiles;
    }
    if (newConfig.activeProfile !== undefined) {
        activeProfile = newConfig.activeProfile;
        applyProfile(activeProfile);
    }
    return getConfig();
}

function getProfiles() {
    return llmProfiles.map(p => ({ ...p }));
}

function setProfiles(profiles) {
    llmProfiles = profiles || [];
    if (!llmProfiles.some(p => p.name === activeProfile)) {
        activeProfile = llmProfiles[0] ? llmProfiles[0].name : 'default';
    }
    applyProfile(activeProfile);
    return getProfiles();
}

function switchProfile(name) {
    const profile = llmProfiles.find(p => p.name === name);
    if (!profile) return false;
    activeProfile = name;
    applyProfile(name);
    return true;
}

function getActiveProfile() {
    return activeProfile;
}

function getProfileByName(name) {
    const profile = llmProfiles.find(p => p.name === name);
    return profile ? { ...profile } : null;
}

function getTemplates() {
    return [...chatTemplates];
}

function setTemplates(templates) {
    chatTemplates = templates || [];
    saveTemplates();
    return getTemplates();
}

function addTemplate(template) {
    const existing = chatTemplates.find(t => t.name === template.name);
    if (existing) {
        existing.content = template.content;
        existing.updatedAt = Date.now();
    } else {
        chatTemplates.push({
            id: template.name,
            name: template.name,
            content: template.content,
            createdAt: Date.now()
        });
    }
    saveTemplates();
    return getTemplates();
}

function removeTemplate(name) {
    chatTemplates = chatTemplates.filter(t => t.name !== name);
    saveTemplates();
    return getTemplates();
}

function getTemplateByName(name) {
    return chatTemplates.find(t => t.name === name);
}

function getHistory() {
    const all = [];
    for (const messages of Object.values(chatHistories)) {
        all.push(...messages);
    }
    all.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    return all;
}

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
    if (!chatSession.sessions) chatSession.sessions = {};
    saveSession();
    return getSession();
}

function setMode(mode, target = null) {
    chatSession.mode = mode;
    chatSession.privateTarget = target;
    chatSession.privateSessionId = 'default';
    saveSession();
    return getSession();
}

function getCommands() {
    return { ...chatCommands };
}

function setCommands(commands) {
    if (commands && typeof commands === 'object') {
        if (commands.commands) {
            chatCommands = { commands: { ...commands.commands } };
        } else {
            chatCommands = { commands: { ...commands } };
        }
    }
    saveCommands();
    return getCommands();
}

function addCommand(keyword, actions) {
    chatCommands.commands[keyword] = actions;
    saveCommands();
    return getCommands();
}

function removeCommand(keyword) {
    delete chatCommands.commands[keyword];
    saveCommands();
    return getCommands();
}

function getImportantRecords() {
    return [...importantRecords];
}

function addImportantRecord(content, role, name) {
    const record = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        role: role,
        name: name,
        content: content
    };
    importantRecords.unshift(record);
    saveImportantRecords();
    return record;
}

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

function estimateTokens(text) {
    if (!text) return 0;
    // 粗略估算: 中文约 1-2 char/token, 英文约 4 char/token, 中英文混合保守取 / 2
    return Math.ceil(text.length / 2);
}

function tokenCount(item) {
    if (item.content) return estimateTokens(item.content) + 10;
    if (item.user && item.assistant) return estimateTokens(item.user) + estimateTokens(item.assistant) + 20;
    return 0;
}

function trimHistoryToBudget(recentHistory, budget) {
    if (!recentHistory.length || budget <= 0) return [];
    let total = recentHistory.reduce((s, it) => s + tokenCount(it), 0);
    if (total <= budget) return recentHistory;
    const trimmed = [...recentHistory];
    while (trimmed.length > 0 && total > budget) {
        total -= tokenCount(trimmed.shift());
    }
    return trimmed;
}

function buildMessages(userMessage, options = {}) {
    const { useTemplate = null, systemPrompt = null, includeHistory = false, contextCount = 0, mode = null, target = null } = options;

    const format = chatConfig.promptFormat || 'openai';
    const sysPrompt = systemPrompt || chatConfig.systemPrompt;

    // 历史可用 token 预算 = maxTokens（作为上下文上限）- 固定部分
    const inputBudget = chatConfig.maxTokens || 4096;

    if (format === 'raw') {
        let raw = `System:${sysPrompt}\n`;
        if (useTemplate && chatTemplates.length > 0) {
            const template = chatTemplates.find(t => t.id === useTemplate) || chatTemplates[0];
            if (template) raw += `User:${template.content}\n`;
        }
        raw += `User:${userMessage}`;
        const fixedTokens = estimateTokens(raw);
        const historyBudget = inputBudget - fixedTokens;

        if (includeHistory && contextCount > 0 && historyBudget > 0) {
            const key = sessionKey(mode, target, chatSession.privateSessionId);
            const sessionHistory = chatHistories[key] || [];
            let recentHistory = sessionHistory.slice(-contextCount);
            if (recentHistory.length > 0) {
                const last = recentHistory[recentHistory.length - 1];
                if (last.role === 'user' || last.role === 'control') {
                    recentHistory = recentHistory.slice(0, -1);
                }
            }
            recentHistory = trimHistoryToBudget(recentHistory, historyBudget);
            // 重建 raw, 在 fixed 部分前插入历史
            raw = `System:${sysPrompt}\n`;
            for (const item of recentHistory) {
                if (item.content) {
                    raw += `${item.role === 'assistant' ? 'AI' : 'User'}:${item.content}\n`;
                } else if (item.user && item.assistant) {
                    raw += `User:${item.user}\nAI:${item.assistant}\n`;
                }
            }
            if (useTemplate && chatTemplates.length > 0) {
                const template = chatTemplates.find(t => t.id === useTemplate) || chatTemplates[0];
                if (template) raw += `User:${template.content}\n`;
            }
            raw += `User:${userMessage}`;
        }
        return [{ role: 'user', content: raw }];
    }

    // 标准 messages 格式
    const messages = [
        { role: 'system', content: sysPrompt }
    ];

    // 固定部分: system + template + 当前用户消息
    let fixedTokens = tokenCount({ content: sysPrompt }) + 20;
    if (useTemplate && chatTemplates.length > 0) {
        const template = chatTemplates.find(t => t.id === useTemplate) || chatTemplates[0];
        if (template) fixedTokens += tokenCount({ content: template.content }) + 10;
    }
    fixedTokens += tokenCount({ content: userMessage }) + 10;
    const historyBudget = inputBudget - fixedTokens;

    if (includeHistory && contextCount > 0 && historyBudget > 0) {
        const key = sessionKey(mode, target, chatSession.privateSessionId);
        const sessionHistory = chatHistories[key] || [];
        let recentHistory = sessionHistory.slice(-contextCount);
        if (recentHistory.length > 0) {
            const last = recentHistory[recentHistory.length - 1];
            if (last.role === 'user' || last.role === 'control') {
                recentHistory = recentHistory.slice(0, -1);
            }
        }
        recentHistory = trimHistoryToBudget(recentHistory, historyBudget);
        recentHistory.forEach(item => {
            if (item.content) {
                messages.push({ role: item.role === 'assistant' ? 'assistant' : 'user', content: item.content });
            } else if (item.user && item.assistant) {
                messages.push({ role: 'user', content: item.user });
                messages.push({ role: 'assistant', content: item.assistant });
            }
        });
    }

    if (useTemplate && chatTemplates.length > 0) {
        const template = chatTemplates.find(t => t.id === useTemplate) || chatTemplates[0];
        if (template) messages.push({ role: 'user', content: template.content });
    }

    messages.push({ role: 'user', content: userMessage });

    return messages;
}

function isSentenceEnd(text) {
    if (!text || text.length === 0) return false;
    const lastChar = text[text.length - 1];
    if (lastChar === '\n') return true;
    const endChars = ['.', '!', '?', '~', '～', '\u3002', '\uFF01', '\uFF1F', '\uFF1B', ';', '\u2026'];
    return endChars.includes(lastChar);
}

// 在 pendingText 中从右向左扫描最后一个完整句子边界
// 中文句号/问号/感叹号直接分句，英文句点需后跟空白/换行（避免缩写和数字）
function findLastSentenceBoundary(text) {
    if (!text) return -1;
    const cnEnd = new Set(['。', '！', '？', '～']);
    const enEnd = new Set(['.', '!', '?', '~']);
    for (let i = text.length - 2; i >= 0; i--) {
        if (cnEnd.has(text[i])) return i + 1;
        if (enEnd.has(text[i]) && (text[i + 1] === '\n' || text[i + 1] === ' ')) {
            return i + 1;
        }
    }
    return -1;
}

async function chat(userMessage, options = {}) {
    const { useTemplate = null, displayId = null, systemPrompt = null, includeHistory = false, contextCount = 0, mode = null, target = null } = options;

    try {
        const messages = buildMessages(userMessage, { useTemplate, systemPrompt, includeHistory, contextCount, mode, target });
        
        const requestBody = {
            model: chatConfig.model,
            messages: messages,
            max_tokens: chatConfig.maxTokens,
            temperature: chatConfig.temperature
        };
        
        const headers = { 'Content-Type': 'application/json' };
        if (chatConfig.apiKey) headers['Authorization'] = 'Bearer ' + chatConfig.apiKey;
        const response = await makeRequest(chatConfig.apiUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody)
        });
        
        const data = JSON.parse(response);
        
        if (data.choices && data.choices[0] && data.choices[0].message) {
            const assistantMessage = data.choices[0].message.content;
            
            const groupKey = 'group';
            if (!chatHistories[groupKey]) chatHistories[groupKey] = [];
            chatHistories[groupKey].push({
                id: Date.now().toString(),
                user: userMessage.substring(0, MAX_MESSAGE_LENGTH),
                assistant: assistantMessage.substring(0, MAX_MESSAGE_LENGTH),
                timestamp: Date.now(),
                displayId: displayId
            });
            
            trimHistory();
            saveHistory();
            
            return {
                success: true,
                message: assistantMessage,
                history: getHistory()
            };
        } else {
            throw new Error('Invalid response format from API');
        }
    } catch (error) {
        console.error('[Chat] API调用失败:', error.message);
        return {
            success: false,
            error: error.message,
            history: getHistory()
        };
    }
}

async function chatStream(userMessage, options = {}, callbacks = {}) {
    const { useTemplate = null, displayId = null, systemPrompt = null, includeHistory = false, contextCount = 0, mode = null, target = null } = options;
    const { onChunk, onSentence, onComplete, onError } = callbacks;

    let fullMessage = '';
    let pendingText = '';

    try {
        const messages = buildMessages(userMessage, { useTemplate, systemPrompt, includeHistory, contextCount, mode, target });
        
        const requestBody = {
            model: chatConfig.model,
            messages: messages,
            max_tokens: chatConfig.maxTokens,
            temperature: chatConfig.temperature,
            stream: true
        };
        
        const streamHeaders = { 'Content-Type': 'application/json' };
        if (chatConfig.apiKey) streamHeaders['Authorization'] = 'Bearer ' + chatConfig.apiKey;
        await makeStreamRequest(chatConfig.apiUrl, {
            method: 'POST',
            headers: streamHeaders,
            body: JSON.stringify(requestBody)
        }, (line) => {
            if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') {
                    return;
                }
                
                try {
                    const parsed = JSON.parse(data);
                    const content = parsed.choices?.[0]?.delta?.content;
                    
                    if (content) {
                        fullMessage += content;
                        pendingText += content;

                        if (onChunk) {
                            onChunk(content, fullMessage);
                        }

                        // 拆分所有完整句子，只保留末尾不完整片段
                        const sentences = splitIntoSentences(pendingText);
                        if (sentences.length >= 2) {
                            for (let i = 0; i < sentences.length - 1; i++) {
                                if (onSentence) {
                                    onSentence(sentences[i], fullMessage);
                                }
                            }
                            pendingText = sentences[sentences.length - 1];
                        }
                    }
                } catch (e) {
                    // Ignore parse errors for individual chunks
                }
            }
        });
        
        if (pendingText.trim() && onSentence) {
            onSentence(pendingText.trim(), fullMessage);
        }
        
        if (onComplete) {
            onComplete(fullMessage, getHistory());
        }
        
        return {
            success: true,
            message: fullMessage,
            history: getHistory()
        };
    } catch (error) {
        console.error('[Chat] 流式API调用失败:', error.message);
        if (onError) {
            onError(error.message);
        }
        return {
            success: false,
            error: error.message,
            history: getHistory()
        };
    }
}

function makeRequest(url, options) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === 'https:';
        const httpModule = isHttps ? https : http;
        
        const reqOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: options.headers || {}
        };
        
        const req = httpModule.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });
        
        req.on('error', reject);
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

function makeStreamRequest(url, options, onLine) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === 'https:';
        const httpModule = isHttps ? https : http;
        
        const reqOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: options.headers || {}
        };
        
        const req = httpModule.request(reqOptions, (res) => {
            let buffer = '';
            
            res.on('data', chunk => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                
                lines.forEach(line => {
                    const trimmed = line.trim();
                    if (trimmed) {
                        onLine(trimmed);
                    }
                });
            });
            
            res.on('end', () => {
                if (buffer.trim()) {
                    onLine(buffer.trim());
                }
                resolve();
            });
        });
        
        req.on('error', reject);
        req.setTimeout(60000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

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

module.exports = {
    init,
    getConfig,
    setConfig,
    getProfiles,
    setProfiles,
    switchProfile,
    getActiveProfile,
    getProfileByName,
    getTemplates,
    setTemplates,
    addTemplate,
    removeTemplate,
    getTemplateByName,
    getHistory,
    clearHistory,
    getSession,
    setSession,
    setMode,
    getCommands,
    setCommands,
    addCommand,
    removeCommand,
    getImportantRecords,
    addImportantRecord,
    addMessage,
    listSessions,
    createSession,
    deleteSession,
    switchSession,
    getSessionHistory,
    chat,
    chatStream,
    isSentenceEnd,
    splitIntoSentences
};
