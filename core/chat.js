const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, 'chat-history.json');
const MAX_HISTORY_SIZE = 100;

let chatConfig = {
    apiUrl: 'http://192.168.1.12:8080/v1/chat/completions',
    model: 'gpt-3.5-turbo',
    maxTokens: 1000,
    temperature: 0.7,
    systemPrompt: '你是一个友好的助手，请用简洁的语言回答问题。'
};

let chatHistory = [];
let chatTemplates = [];

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
    if (config.templates) chatTemplates = config.templates;
    loadHistory();
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
    return getTemplates();
}

function addTemplate(template) {
    chatTemplates.push({
        id: Date.now().toString(),
        name: template.name,
        content: template.content,
        createdAt: Date.now()
    });
    return getTemplates();
}

function removeTemplate(id) {
    chatTemplates = chatTemplates.filter(t => t.id !== id);
    return getTemplates();
}

function getHistory() {
    return [...chatHistory];
}

function clearHistory() {
    chatHistory = [];
    saveHistory();
    return [];
}

function buildMessages(userMessage, useTemplate = null) {
    const messages = [
        { role: 'system', content: chatConfig.systemPrompt }
    ];
    
    const recentHistory = chatHistory.slice(-20);
    recentHistory.forEach(item => {
        messages.push({ role: 'user', content: item.user });
        messages.push({ role: 'assistant', content: item.assistant });
    });
    
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
    const endChars = ['.', '!', '?', '~', '\u3002', '\uFF01', '\uFF1F', '\uFF1B', ';', '"', '"', '\u201C', '\u201D', '\u2018', '\u2019', '\u2026'];
    return endChars.includes(lastChar);
}

function splitIntoSentences(text) {
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
    const { useTemplate = null, displayId = null } = options;
    
    try {
        const messages = buildMessages(userMessage, useTemplate);
        
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
    const { useTemplate = null, displayId = null } = options;
    const { onChunk, onSentence, onComplete, onError } = callbacks;
    
    let fullMessage = '';
    let pendingText = '';
    
    try {
        const messages = buildMessages(userMessage, useTemplate);
        
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
        
        chatHistory.push({
            id: Date.now().toString(),
            user: userMessage,
            assistant: fullMessage,
            timestamp: Date.now(),
            displayId: displayId
        });
        
        trimHistory();
        saveHistory();
        
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
    getHistory,
    clearHistory,
    chat,
    chatStream,
    isSentenceEnd,
    splitIntoSentences
};
