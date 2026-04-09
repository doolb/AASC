const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '../config/chat-history.json');
const SESSION_FILE = path.join(__dirname, '../config/chat-session.json');
const COMMANDS_FILE = path.join(__dirname, '../config/chat-commands.json');
const IMPORTANT_FILE = path.join(__dirname, '../config/important-records.json');
const TEMPLATES_FILE = path.join(__dirname, '../config/chat-templates.json');
const MAX_HISTORY_SIZE = 100;

const DEFAULT_TEMPLATES = [
    {
        id: '小爱',
        name: '小爱',
        content: '你是小爱，一个友好、活泼的智能助手。请用简洁、亲切的语言回答问题。',
        createdAt: Date.now()
    }
];

let chatConfig = {
    apiUrl: 'http://192.168.1.12:8080/v1/chat/completions',
    model: 'gpt-3.5-turbo',
    maxTokens: 1000,
    temperature: 0.7,
    systemPrompt: '你是一个友好的助手，请用简洁的语言回答问题。'
};

let chatHistory = [];
let chatTemplates = [];
let chatSession = {
    mode: 'group',
    privateTarget: null,
    playOnControl: false
};
let chatCommands = {
    commands: {}
};
let importantRecords = [];

function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = fs.readFileSync(HISTORY_FILE, 'utf8');
            chatHistory = JSON.parse(data);
            console.log(`[Chat] 已加载 ${chatHistory.length} 条历史记录`);
        }
    } catch (err) {
        console.error('[Chat] 加载历史记录失败:', err.message);
        chatHistory = [];
    }
}

function saveHistory() {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(chatHistory, null, 2), 'utf8');
    } catch (err) {
        console.error('[Chat] 保存历史记录失败:', err.message);
    }
}

function trimHistory() {
    if (chatHistory.length > MAX_HISTORY_SIZE) {
        chatHistory = chatHistory.slice(-MAX_HISTORY_SIZE);
    }
}

function init(config = {}) {
    if (config.apiUrl) chatConfig.apiUrl = config.apiUrl;
    if (config.model) chatConfig.model = config.model;
    if (config.maxTokens) chatConfig.maxTokens = config.maxTokens;
    if (config.temperature) chatConfig.temperature = config.temperature;
    if (config.systemPrompt) chatConfig.systemPrompt = config.systemPrompt;
    loadHistory();
    loadSession();
    loadCommands();
    loadTemplates();
    loadImportantRecords();
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
    return { ...chatConfig };
}

function setConfig(newConfig) {
    if (newConfig.apiUrl !== undefined) chatConfig.apiUrl = newConfig.apiUrl;
    if (newConfig.model !== undefined) chatConfig.model = newConfig.model;
    if (newConfig.maxTokens !== undefined) chatConfig.maxTokens = newConfig.maxTokens;
    if (newConfig.temperature !== undefined) chatConfig.temperature = newConfig.temperature;
    if (newConfig.systemPrompt !== undefined) chatConfig.systemPrompt = newConfig.systemPrompt;
    return getConfig();
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
    return [...chatHistory];
}

function clearHistory(options = {}) {
    if (options.mode === 'private' && options.target) {
        chatHistory = chatHistory.filter(item => 
            !(item.mode === 'private' && item.target === options.target)
        );
    } else if (options.mode === 'group') {
        chatHistory = chatHistory.filter(item => item.mode === 'private');
    } else {
        chatHistory = [];
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
    if (session.playOnControl !== undefined) chatSession.playOnControl = session.playOnControl;
    saveSession();
    return getSession();
}

function setMode(mode, target = null) {
    chatSession.mode = mode;
    chatSession.privateTarget = target;
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
    const msg = {
        id: Date.now().toString() + Math.random().toString(36).substring(2, 6),
        timestamp: Date.now(),
        role: message.role || 'user',
        name: message.name || '',
        ip: message.ip || '',
        content: message.content,
        mode: message.mode || chatSession.mode,
        target: message.target || chatSession.privateTarget
    };
    
    chatHistory.push(msg);
    trimHistory();
    saveHistory();
    
    if (message.content && message.content.startsWith('系统记录')) {
        const importantContent = message.content.replace('系统记录', '').trim();
        if (importantContent) {
            addImportantRecord(importantContent, msg.role, msg.name);
        }
    }
    
    return msg;
}

function buildMessages(userMessage, options = {}) {
    const { useTemplate = null, systemPrompt = null, includeHistory = false } = options;
    
    const messages = [
        { role: 'system', content: systemPrompt || chatConfig.systemPrompt }
    ];
    
    if (includeHistory) {
        const recentHistory = chatHistory.slice(-20);
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
        if (template) {
            messages.push({ role: 'user', content: template.content });
        }
    }
    
    messages.push({ role: 'user', content: userMessage });
    
    return messages;
}

function isSentenceEnd(text) {
    if (!text || text.length === 0) return false;
    const lastChar = text[text.length - 1];
    const endChars = ['.', '!', '?', '~', '～', '\u3002', '\uFF01', '\uFF1F', '\uFF1B', ';', '"', '"', '\u201C', '\u201D', '\u2018', '\u2019', '\u2026'];
    return endChars.includes(lastChar);
}

function splitIntoSentences(text) {
    if (!text || typeof text !== 'string') {
        return [];
    }
    
    const sentences = [];
    let current = '';
    
    for (let i = 0; i < text.length; i++) {
        current += text[i];
        if (isSentenceEnd(current)) {
            const trimmed = current.trim();
            if (trimmed.length > 0) {
                sentences.push(trimmed);
            }
            current = '';
        }
    }
    
    if (current.trim().length > 0) {
        sentences.push(current.trim());
    }
    
    return sentences;
}

async function chat(userMessage, options = {}) {
    const { useTemplate = null, displayId = null, systemPrompt = null } = options;
    
    try {
        const messages = buildMessages(userMessage, { useTemplate, systemPrompt });
        
        const requestBody = {
            model: chatConfig.model,
            messages: messages,
            max_tokens: chatConfig.maxTokens,
            temperature: chatConfig.temperature
        };
        
        const response = await makeRequest(chatConfig.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
        
        const data = JSON.parse(response);
        
        if (data.choices && data.choices[0] && data.choices[0].message) {
            const assistantMessage = data.choices[0].message.content;
            
            chatHistory.push({
                id: Date.now().toString(),
                user: userMessage,
                assistant: assistantMessage,
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
    const { useTemplate = null, displayId = null, systemPrompt = null } = options;
    const { onChunk, onSentence, onComplete, onError } = callbacks;
    
    let fullMessage = '';
    let pendingText = '';
    
    try {
        const messages = buildMessages(userMessage, { useTemplate, systemPrompt });
        
        const requestBody = {
            model: chatConfig.model,
            messages: messages,
            max_tokens: chatConfig.maxTokens,
            temperature: chatConfig.temperature,
            stream: true
        };
        
        await makeStreamRequest(chatConfig.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
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
                        
                        if (isSentenceEnd(pendingText)) {
                            const sentence = pendingText.trim();
                            if (sentence && onSentence) {
                                onSentence(sentence, fullMessage);
                            }
                            pendingText = '';
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

module.exports = {
    init,
    getConfig,
    setConfig,
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
    chat,
    chatStream,
    isSentenceEnd,
    splitIntoSentences
};
