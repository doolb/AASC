const http = require('http');
const https = require('https');

let chatConfig = {
    apiUrl: 'http://192.168.1.12:8080/v1/chat/completions',
    model: 'gpt-3.5-turbo',
    maxTokens: 1000,
    temperature: 0.7,
    systemPrompt: '你是一个友好的助手，请用简洁的语言回答问题。'
};

let chatHistory = [];
let chatTemplates = [];

function init(config = {}) {
    if (config.apiUrl) chatConfig.apiUrl = config.apiUrl;
    if (config.model) chatConfig.model = config.model;
    if (config.maxTokens) chatConfig.maxTokens = config.maxTokens;
    if (config.temperature) chatConfig.temperature = config.temperature;
    if (config.systemPrompt) chatConfig.systemPrompt = config.systemPrompt;
    if (config.templates) chatTemplates = config.templates;
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
    chat
};
