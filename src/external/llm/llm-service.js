const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { isSentenceEnd, splitIntoSentences } = require('../../core/utils/sentence-splitter');

const { USER_CONFIG_DIR } = require('../../apps/server/modules/config/user-config-paths');
const {
    normalizeAgentProfile,
    normalizeChatTemplate,
    buildChatSessionKey
} = require('../../apps/server/modules/chat/pi-runtime-policy');
const { createResponsesClient } = require('./llm-responses-client');
const { createChatHistoryStore } = require('./chat-history-store');

const HISTORY_DIR = USER_CONFIG_DIR;
const HISTORY_FILE_BASE = 'chat-history';
const SESSION_FILE = path.join(USER_CONFIG_DIR, 'chat-session.json');
const RESPONSES_SESSION_FILE = path.join(USER_CONFIG_DIR, 'chat-responses-sessions.json');
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
    codexProxy: 'http://127.0.0.1:7899',
    protocol: 'openai-responses',
    responsesBaseUrl: 'http://127.0.0.1:8083/v1',
    responsesApiKey: '',
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
let piRuntimeManager = null;
let codexRuntimeManager = null;
let responsesSessionStates = {};
let responsesClient = null;
let responsesClientFingerprint = '';

let chatHistories = {};
const MAX_HISTORY_PER_SESSION = 100;

function sessionKey(mode, target, sessionId, profileName = activeProfile, templateId = 'default') {
    return buildChatSessionKey({
        profileName,
        templateId,
        mode: mode || 'group',
        target,
        sessionId
    });
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
const pendingChangedHistoryFiles = new Set();
const historyStore = createChatHistoryStore({
    historyDir: HISTORY_DIR,
    timeZone: 'Asia/Shanghai',
    logger: (level, message) => {
        const output = level === 'error' ? console.error : console.log;
        output(`[Chat] ${message}`);
    }
});

function loadHistory() {
    try {
        chatHistories = {};
        for (const sourceMessage of historyStore.load()) {
            if (!sourceMessage || typeof sourceMessage !== 'object') continue;
            const msg = sourceMessage;
            // 旧消息没有 profile/template 时归入启动时的当前 profile/default 模板。
            if (!msg.sessionId) msg.sessionId = 'default';
            if (!msg.profileName) msg.profileName = activeProfile;
            if (!msg.templateId) msg.templateId = 'default';
            const key = sessionKey(
                msg.mode,
                msg.target,
                msg.sessionId,
                msg.profileName,
                msg.templateId
            );
            if (!chatHistories[key]) chatHistories[key] = [];
            chatHistories[key].push(msg);
        }

        const total = Object.values(chatHistories).reduce((s, a) => s + a.length, 0);
        console.log(`[Chat] 已加载 ${total} 条历史记录 (${Object.keys(chatHistories).length} 个会话)`);
    } catch (err) {
        console.error('[Chat] 加载历史记录失败:', err.message);
        chatHistories = {};
    }
}

function getAllHistoryMessages() {
    return Object.values(chatHistories).flat();
}

function flushHistorySave() {
    if (historySaveTimer) {
        clearTimeout(historySaveTimer);
        historySaveTimer = null;
    }
    if (pendingChangedHistoryFiles.size === 0 && getAllHistoryMessages().length === 0) return true;
    try {
        historyStore.ensurePreviousDayBackup();
        historyStore.saveSnapshot(getAllHistoryMessages(), {
            changedFiles: Array.from(pendingChangedHistoryFiles)
        });
        pendingChangedHistoryFiles.clear();
        return true;
    } catch (err) {
        console.error('[Chat] 保存历史记录失败:', err.message);
        return false;
    }
}

function saveHistory(changedFiles = []) {
    for (const fileName of changedFiles) {
        pendingChangedHistoryFiles.add(fileName);
    }
    if (historySaveTimer) {
        clearTimeout(historySaveTimer);
    }
    historySaveTimer = setTimeout(flushHistorySave, 2000);
}

function trimHistory() {
    for (const key of Object.keys(chatHistories)) {
        if (chatHistories[key].length > MAX_HISTORY_PER_SESSION) {
            chatHistories[key] = chatHistories[key].slice(-MAX_HISTORY_PER_SESSION);
        }
    }
}

function init(config = {}, options = {}) {
    if (options.piRuntimeManager !== undefined) {
        piRuntimeManager = options.piRuntimeManager;
    }
    if (options.codexRuntimeManager !== undefined) {
        codexRuntimeManager = options.codexRuntimeManager;
    }
    if (config.agentBackend === 'codex' || config.agentBackend === 'claude') chatConfig.agentBackend = config.agentBackend;
    if (config.codexProxy !== undefined) chatConfig.codexProxy = config.codexProxy;
    if (config.protocol !== undefined) chatConfig.protocol = normalizeChatTransport(config).protocol;
    if (config.responsesBaseUrl) chatConfig.responsesBaseUrl = config.responsesBaseUrl;
    if (config.responsesApiKey !== undefined) chatConfig.responsesApiKey = config.responsesApiKey;
    if (config.apiUrl) chatConfig.apiUrl = config.apiUrl;
    if (config.model) chatConfig.model = config.model;
    if (config.maxTokens) chatConfig.maxTokens = config.maxTokens;
    if (config.temperature) chatConfig.temperature = config.temperature;
    if (config.systemPrompt) chatConfig.systemPrompt = config.systemPrompt;
    if (config.llmProfiles) {
        llmProfiles = config.llmProfiles.map(normalizeAgentProfile);
    } else {
        llmProfiles = [normalizeAgentProfile({
            name: 'default',
            apiUrl: chatConfig.apiUrl,
            model: chatConfig.model,
            maxTokens: chatConfig.maxTokens,
            temperature: chatConfig.temperature,
            apiKey: chatConfig.apiKey,
            contextCount: chatConfig.contextCount,
            promptFormat: chatConfig.promptFormat,
            mode: 'llm'
        })];
    }
    if (config.activeProfile && llmProfiles.some(p => p.name === config.activeProfile)) {
        activeProfile = config.activeProfile;
        applyProfile(activeProfile);
    } else {
        activeProfile = llmProfiles[0] ? llmProfiles[0].name : 'default';
        applyProfile(activeProfile);
    }
    try {
        historyStore.ensurePreviousDayBackup();
    } catch (error) {
        console.error('[Chat] 创建 aasc-user 上一天配置快照失败:', error.message);
    }
    loadHistory();
    loadResponsesSessionState();
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
        chatConfig.mode = profile.mode || 'llm';
        chatConfig.backend = profile.backend || null;
        activeProfile = profile.name;
    }
}

function loadTemplates() {
    try {
        if (fs.existsSync(TEMPLATES_FILE)) {
            const data = fs.readFileSync(TEMPLATES_FILE, 'utf8');
            chatTemplates = JSON.parse(data).map(normalizeChatTemplate);
            console.log(`[Chat] 已加载 ${chatTemplates.length} 个模板`);
        } else {
            chatTemplates = DEFAULT_TEMPLATES.map(normalizeChatTemplate);
            saveTemplates();
            console.log(`[Chat] 已创建默认模板`);
        }
    } catch (err) {
        console.error('[Chat] 加载模板失败:', err.message);
        chatTemplates = DEFAULT_TEMPLATES.map(normalizeChatTemplate);
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

function normalizeChatTransport(config = {}) {
    const protocol = config.protocol === 'openai-completions'
        ? 'openai-completions'
        : 'openai-responses';
    return {
        protocol,
        baseUrl: config.responsesBaseUrl || 'http://127.0.0.1:8083/v1'
    };
}

function loadResponsesSessionState() {
    try {
        if (!fs.existsSync(RESPONSES_SESSION_FILE)) {
            responsesSessionStates = {};
            return;
        }
        const parsed = JSON.parse(fs.readFileSync(RESPONSES_SESSION_FILE, 'utf8'));
        responsesSessionStates = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
        console.error('[Chat] 加载 Responses 会话状态失败:', error.message);
        responsesSessionStates = {};
    }
}

function saveResponsesSessionState() {
    try {
        const dir = path.dirname(RESPONSES_SESSION_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const tempFile = `${RESPONSES_SESSION_FILE}.${process.pid}.tmp`;
        fs.writeFileSync(tempFile, JSON.stringify(responsesSessionStates, null, 2), { encoding: 'utf8', mode: 0o600 });
        fs.chmodSync(tempFile, 0o600);
        fs.renameSync(tempFile, RESPONSES_SESSION_FILE);
        fs.chmodSync(RESPONSES_SESSION_FILE, 0o600);
    } catch (error) {
        console.error('[Chat] 保存 Responses 会话状态失败:', error.message);
    }
}

function getResponsesClient() {
    const fingerprint = `${chatConfig.responsesBaseUrl}\n${chatConfig.responsesApiKey || ''}`;
    if (!responsesClient || responsesClientFingerprint !== fingerprint) {
        responsesClient = createResponsesClient({
            baseUrl: chatConfig.responsesBaseUrl,
            apiKey: chatConfig.responsesApiKey || ''
        });
        responsesClientFingerprint = fingerprint;
    }
    return responsesClient;
}

function getResponsesSessionKey(options = {}) {
    const templateId = options.templateTarget || options.useTemplate || 'default';
    return sessionKey(
        options.mode,
        options.target,
        options.sessionId || chatSession.privateSessionId,
        activeProfile,
        templateId
    );
}

function getResponsesFingerprint(options = {}) {
    return JSON.stringify({
        profileName: activeProfile,
        templateId: options.templateTarget || options.useTemplate || 'default',
        systemPrompt: options.systemPrompt || chatConfig.systemPrompt || '',
        model: chatConfig.model,
        promptFormat: chatConfig.promptFormat || 'openai'
    });
}

function buildResponsesPayload({ messages, userMessage, state, fingerprint, model, maxTokens, temperature, stream = false }) {
    const reusable = state
        && state.fingerprint === fingerprint
        && (state.latestResponseId || state.conversationId);
    const payload = {
        model,
        input: reusable ? [{ role: 'user', content: userMessage }] : messages,
        max_output_tokens: maxTokens,
        temperature,
        stream: Boolean(stream)
    };
    if (reusable && state.latestResponseId) {
        payload.previous_response_id = state.latestResponseId;
    } else if (reusable && state.conversationId) {
        payload.conversation = state.conversationId;
    }
    return payload;
}

function extractResponsesText(response) {
    if (typeof response?.output_text === 'string') return response.output_text;
    if (!Array.isArray(response?.output)) return '';
    return response.output.flatMap((item) => Array.isArray(item?.content) ? item.content : [])
        .filter((item) => item?.type === 'output_text' && typeof item.text === 'string')
        .map((item) => item.text)
        .join('');
}

function saveResponseReference(sessionKeyValue, response, fingerprint) {
    const conversationId = response?.conversation?.id || response?.conversation_id;
    const responseId = response?.id;
    if (!conversationId && !responseId) return;
    responsesSessionStates[sessionKeyValue] = {
        conversationId: conversationId || responsesSessionStates[sessionKeyValue]?.conversationId || '',
        latestResponseId: responseId || responsesSessionStates[sessionKeyValue]?.latestResponseId || '',
        model: response?.model || chatConfig.model,
        fingerprint,
        updatedAt: Date.now()
    };
    saveResponsesSessionState();
}

function clearResponseReference(sessionKeyValue) {
    if (!responsesSessionStates[sessionKeyValue]) return;
    delete responsesSessionStates[sessionKeyValue];
    saveResponsesSessionState();
}

function canRebuildResponsesSession(error) {
    return error?.statusCode === 404 || ['conversation_not_found', 'response_not_found'].includes(error?.code);
}

async function requestResponsesWithRecovery(context) {
    const client = getResponsesClient();
    const request = buildResponsesPayload(context);
    try {
        return await client.request(request);
    } catch (error) {
        if (!context.state || !canRebuildResponsesSession(error)) throw error;
        clearResponseReference(context.sessionKey);
        return client.request(buildResponsesPayload({ ...context, state: null }));
    }
}

async function streamResponsesWithRecovery(context, onEvent) {
    const client = getResponsesClient();
    const request = buildResponsesPayload(context);
    let receivedText = false;
    try {
        await client.stream(request, (event) => {
            if (event?.type === 'response.output_text.delta') receivedText = true;
            onEvent(event);
        });
    } catch (error) {
        if (!context.state || receivedText || !canRebuildResponsesSession(error)) throw error;
        clearResponseReference(context.sessionKey);
        await client.stream(buildResponsesPayload({ ...context, state: null }), onEvent);
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

/**
 * 规范化会话元数据并按会话 ID 去重。
 * 会话列表用于控制端展示，不能因为旧客户端传入异常条目而污染持久化状态。
 */
function normalizeSessionEntries(entries) {
    if (!Array.isArray(entries)) return [];

    const normalized = [];
    const seenIds = new Set();
    for (const entry of entries) {
        const id = String(entry?.id || '').trim();
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        normalized.push({ ...entry, id });
    }
    return normalized;
}

/**
 * 合并客户端快照与服务端会话列表。
 * 客户端可能在异步加载完成前保存，此时 incoming 可能只有 default，不能删除已有会话。
 */
function mergeSessionEntries(existing = [], incoming = []) {
    const merged = new Map();
    for (const entry of normalizeSessionEntries(existing)) {
        merged.set(entry.id, entry);
    }
    for (const entry of normalizeSessionEntries(incoming)) {
        merged.set(entry.id, { ...merged.get(entry.id), ...entry });
    }
    return [...merged.values()];
}

/**
 * 从私聊历史补回丢失的会话元数据。
 * 历史消息没有保存会话名称时只能使用 sessionId 作为临时显示名称，但聊天内容不会丢失。
 */
function recoverSessionsFromHistory(target, sessions = [], historyItems = Object.values(chatHistories).flat()) {
    const recovered = mergeSessionEntries(sessions, []);
    const knownIds = new Set(recovered.map(session => session.id));
    const targetMessages = (Array.isArray(historyItems) ? historyItems : [])
        .filter(message => (
            message?.mode === 'private'
            && message.target === target
            && String(message.sessionId || 'default').trim()
        ))
        .sort((left, right) => (left.timestamp || 0) - (right.timestamp || 0));

    for (const message of targetMessages) {
        const sessionId = String(message.sessionId || 'default').trim();
        if (knownIds.has(sessionId)) continue;
        recovered.push({
            id: sessionId,
            name: sessionId === 'default' ? '默认会话' : sessionId,
            createdAt: message.timestamp || Date.now()
        });
        knownIds.add(sessionId);
    }

    if (!knownIds.has('default')) {
        recovered.unshift({ id: 'default', name: '默认会话', createdAt: Date.now() });
    }
    return recovered;
}

/**
 * 汇总所有目标的私聊会话。
 *
 * 会话元数据通常保存在 chatSession.sessions 中，但历史记录中可能存在
 * 元数据丢失后仍可恢复的 sessionId，因此这里同时扫描两类来源。该函数
 * 只构造返回值，不改变当前会话状态，适合被只读接口调用。
 */
function flattenSessionEntries(sessionMap = {}, historyItems = getAllHistoryMessages()) {
    const source = sessionMap && typeof sessionMap === 'object' && !Array.isArray(sessionMap)
        ? sessionMap
        : {};
    const history = Array.isArray(historyItems) ? historyItems : [];
    const targets = new Set(Object.keys(source).filter(target => String(target).trim()));

    for (const message of history) {
        if (message?.mode !== 'private' || !String(message.target || '').trim()) continue;
        targets.add(String(message.target).trim());
    }

    return [...targets]
        .sort((left, right) => left.localeCompare(right, 'zh-CN'))
        .flatMap(target => recoverSessionsFromHistory(target, source[target] || [], history)
            .map(session => ({ ...session, mode: 'private', target })));
}

function listAllSessions() {
    return flattenSessionEntries(chatSession.sessions, getAllHistoryMessages());
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
    if (newConfig.codexProxy !== undefined) chatConfig.codexProxy = String(newConfig.codexProxy || '');
    if (newConfig.protocol !== undefined) chatConfig.protocol = normalizeChatTransport(newConfig).protocol;
    if (newConfig.responsesBaseUrl !== undefined) chatConfig.responsesBaseUrl = newConfig.responsesBaseUrl;
    if (newConfig.responsesApiKey !== undefined) chatConfig.responsesApiKey = newConfig.responsesApiKey;
    if (newConfig.apiUrl !== undefined) chatConfig.apiUrl = newConfig.apiUrl;
    if (newConfig.model !== undefined) chatConfig.model = newConfig.model;
    if (newConfig.maxTokens !== undefined) chatConfig.maxTokens = newConfig.maxTokens;
    if (newConfig.temperature !== undefined) chatConfig.temperature = newConfig.temperature;
    if (newConfig.apiKey !== undefined) chatConfig.apiKey = newConfig.apiKey;
    if (newConfig.contextCount !== undefined) chatConfig.contextCount = newConfig.contextCount;
    if (newConfig.systemPrompt !== undefined) chatConfig.systemPrompt = newConfig.systemPrompt;
    if (newConfig.promptFormat !== undefined) chatConfig.promptFormat = newConfig.promptFormat;
    if (newConfig.llmProfiles !== undefined) {
        llmProfiles = newConfig.llmProfiles.map(normalizeAgentProfile);
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
    llmProfiles = (profiles || []).map(normalizeAgentProfile);
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

function setTemplates(templates, options = {}) {
    chatTemplates = (templates || []).map(normalizeChatTemplate);
    if (options.persist !== false) {
        saveTemplates();
    }
    return getTemplates();
}

function addTemplate(template) {
    const normalized = normalizeChatTemplate(template);
    const existing = chatTemplates.find(t => t.name === normalized.name);
    if (existing) {
        existing.content = normalized.content;
        existing.permissionProfile = normalized.permissionProfile;
        existing.updatedAt = Date.now();
    } else {
        chatTemplates.push({
            id: normalized.id || normalized.name,
            name: normalized.name,
            content: normalized.content,
            permissionProfile: normalized.permissionProfile,
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
    return chatTemplates.find(t => t.name === name || t.id === name);
}

function getGroupSystemPrompt() {
    const basePrompt = chatConfig.systemPrompt || '';
    const rolePrompts = chatTemplates
        .filter(template => template && template.name && template.content)
        .map(template => `角色「${template.name}」的设定：\n${template.content}`)
        .join('\n\n');
    if (!rolePrompts) return basePrompt;

    return [
        basePrompt,
        '以下是当前群聊中的全部角色设定，请综合这些角色设定理解并回答用户。',
        rolePrompts
    ].filter(Boolean).join('\n\n');
}

function getHistory() {
    const all = [];
    for (const messages of Object.values(chatHistories)) {
        all.push(...messages.filter(message => (
            !message.profileName || message.profileName === activeProfile
        )));
    }
    all.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    return all;
}

function validateHistoryScope(options = {}) {
    const mode = options.mode || null;
    const target = options.target || null;
    const sessionId = options.sessionId || null;
    if (mode === 'group' && !target && !sessionId) {
        return { mode: 'group', target: null, sessionId: null };
    }
    if (mode === 'private' && target && sessionId) {
        return { mode: 'private', target, sessionId };
    }
    throw new Error('必须指定群聊或具体私聊会话');
}

function clearHistory(options = {}) {
    const scope = validateHistoryScope(options);
    const affectedFile = scope.mode === 'private'
        ? historyStore.getHistoryFileName({ mode: 'private', target: scope.target })
        : historyStore.getHistoryFileName({ mode: 'group' });
    historyStore.ensurePreviousDayBackup();
    for (const key of Object.keys(chatHistories)) {
        chatHistories[key] = chatHistories[key].filter(message => {
            if (scope.mode === 'group') return message.mode === 'private';
            return !(
                message.mode === 'private'
                && message.target === scope.target
                && (message.sessionId || 'default') === scope.sessionId
            );
        });
        if (chatHistories[key].length === 0) delete chatHistories[key];
    }
    saveHistory([affectedFile]);
    resetPiSessionForScope(scope);
    console.log(`[Chat] 清空历史 scope=${scope.mode} target=${scope.target || '-'} sessionId=${scope.sessionId || '-'}`);
    return getHistory();
}

function deleteConversationRound(options = {}) {
    const messageId = String(options.messageId || '');
    if (!messageId) return { success: false, history: getHistory(), message: '缺少消息 ID' };

    const matchesScope = (message) => {
        if (message.profileName && message.profileName !== activeProfile) return false;
        if (options.mode && (message.mode || 'group') !== options.mode) return false;
        if (Object.prototype.hasOwnProperty.call(options, 'target') && (message.target || null) !== (options.target || null)) return false;
        if (Object.prototype.hasOwnProperty.call(options, 'sessionId')) {
            return (message.sessionId || 'default') === (options.sessionId || 'default');
        }
        return true;
    };

    for (const [key, messages] of Object.entries(chatHistories)) {
        const removal = getConversationRoundRemoval(messages, messageId, matchesScope);
        if (!removal) continue;
        if (!removal.isUserMessage) return { success: false, history: getHistory(), message: '只能删除用户消息所在的对话轮次' };

        historyStore.ensurePreviousDayBackup();
        messages.splice(removal.index, removal.removeCount);
        if (messages.length === 0) delete chatHistories[key];
        saveHistory([historyStore.getHistoryFileName(removal.message)]);
        resetPiSessionForMessage(removal.message);
        return { success: true, history: getHistory() };
    }

    return { success: false, history: getHistory(), message: '对话轮次不存在' };
}

function getConversationRoundRemoval(messages, messageId, matchesScope = () => true) {
    const index = messages.findIndex(message => String(message.id || '') === String(messageId) && matchesScope(message));
    if (index < 0) return null;

    const message = messages[index];
    const isLegacyRound = message.user !== undefined || message.assistant !== undefined;
    const isUserMessage = isLegacyRound || message.role === 'user' || message.role === 'control';
    const removeCount = isLegacyRound || messages[index + 1]?.role !== 'assistant' ? 1 : 2;
    return { index, removeCount, message, isUserMessage };
}

function buildPiConversationKey(mode, target, sessionId) {
    return JSON.stringify({
        mode: mode || 'group',
        target: target || null,
        sessionId: sessionId || 'default'
    });
}

function resetPiSessionForMessage(message) {
    const profile = getProfileByName(message.profileName || activeProfile);
    if (!profile || profile.mode !== 'agent') return;
    const template = normalizeChatTemplate(getTemplateByName(message.templateId) || {
        id: 'default',
        name: 'default',
        content: '',
        permissionProfile: 'readonly'
    });
    const runtimeManager = profile.backend === 'codex' ? codexRuntimeManager : piRuntimeManager;
    if (!runtimeManager?.resetSession) return;
    runtimeManager.resetSession(
        profile,
        template,
        buildPiConversationKey(message.mode, message.target, message.sessionId)
    );
}

function resetPiSessionForScope(options = {}) {
    resetPiSessionForMessage({
        profileName: activeProfile,
        templateId: options.mode === 'private' ? options.target : 'default',
        mode: options.mode || 'group',
        target: options.target || null,
        sessionId: options.sessionId || 'default'
    });
}

function getSession() {
    return { ...chatSession };
}

/**
 * 记录聊天模式的实际变化。
 * 来源和显示端 ID 只作为诊断元数据使用，不写入持久化会话，避免改变旧协议。
 */
function logModeChange(previousSession, nextSession, metadata = {}) {
    const previousMode = previousSession.mode || 'group';
    const nextMode = nextSession.mode || 'group';
    const previousTarget = previousSession.privateTarget || '-';
    const nextTarget = nextSession.privateTarget || '-';
    if (previousMode === nextMode && previousTarget === nextTarget) return false;

    const source = String(metadata.source || 'unknown').trim() || 'unknown';
    const displayId = String(metadata.displayId || '').trim();
    const displaySummary = displayId ? ` displayId=${displayId}` : '';
    console.log(
        `[Chat] 模式切换 ${previousMode} -> ${nextMode} `
        + `previousTarget=${previousTarget} target=${nextTarget} `
        + `source=${source}${displaySummary}`
    );
    return true;
}

function shouldPersistSession(metadata = {}) {
    return metadata.persist !== false;
}

function setSession(session, metadata = {}) {
    const previousSession = getSession();
    if (session.mode !== undefined) chatSession.mode = session.mode;
    if (session.privateTarget !== undefined) chatSession.privateTarget = session.privateTarget;
    if (session.privateSessionId !== undefined) chatSession.privateSessionId = session.privateSessionId;
    if (session.playOnControl !== undefined) chatSession.playOnControl = session.playOnControl;
    if (session.commandMode !== undefined) chatSession.commandMode = session.commandMode;
    if (session.sessions !== undefined) {
        const incomingSessions = session.sessions && typeof session.sessions === 'object'
            ? session.sessions
            : {};
        const mergedSessions = { ...chatSession.sessions };
        for (const [target, entries] of Object.entries(incomingSessions)) {
            mergedSessions[target] = mergeSessionEntries(mergedSessions[target], entries);
        }
        chatSession.sessions = mergedSessions;
    }
    if (!chatSession.sessions) chatSession.sessions = {};
    logModeChange(previousSession, chatSession, metadata);
    if (shouldPersistSession(metadata)) saveSession();
    return getSession();
}

function setMode(mode, target = null, metadata = {}) {
    const previousSession = getSession();
    const nextSessionId = 'default';
    const modeChanged = previousSession.mode !== mode
        || previousSession.privateTarget !== target
        || (previousSession.mode === 'private' && previousSession.privateSessionId !== nextSessionId);
    if (modeChanged) {
        resetPiSessionForScope({
            mode: previousSession.mode,
            target: previousSession.mode === 'private' ? previousSession.privateTarget : null,
            sessionId: previousSession.privateSessionId || 'default'
        });
    }
    chatSession.mode = mode;
    chatSession.privateTarget = target;
    chatSession.privateSessionId = nextSessionId;
    logModeChange(previousSession, chatSession, metadata);
    if (shouldPersistSession(metadata)) saveSession();
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
        sessionId: message.sessionId || chatSession.privateSessionId || 'default',
        profileName: message.profileName || activeProfile,
        templateId: message.templateId || 'default'
    };

    const key = sessionKey(
        msg.mode,
        msg.target,
        msg.sessionId,
        msg.profileName,
        msg.templateId
    );
    if (!chatHistories[key]) chatHistories[key] = [];
    chatHistories[key].push(msg);
    trimHistory();
    saveHistory([historyStore.getHistoryFileName(msg)]);
    
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

function findTemplate(templateId) {
    if (!templateId) return null;
    return chatTemplates.find(template => (
        template.id === templateId || template.name === templateId
    )) || null;
}

function getHistoryForOptions(options = {}) {
    const profileName = options.profileName || activeProfile;
    const templateId = options.templateId || 'default';
    const key = sessionKey(
        options.mode,
        options.target,
        options.sessionId || chatSession.privateSessionId,
        profileName,
        templateId
    );
    return chatHistories[key] || [];
}

function buildMessages(userMessage, options = {}) {
    const {
        useTemplate = null,
        templateTarget = null,
        systemPrompt = null,
        includeHistory = false,
        contextCount = 0,
        mode = null,
        target = null,
        sessionId = null,
        profileName = activeProfile,
        promptFormat = chatConfig.promptFormat
    } = options;
    const templateId = templateTarget || useTemplate || 'default';
    const format = promptFormat || 'openai';
    const sysPrompt = systemPrompt || chatConfig.systemPrompt;
    const selectedTemplate = findTemplate(templateId);
    // 服务器聊天路由可能已经把模板内容作为 systemPrompt 传入，避免 Agent/LLM 收到重复模板。
    const template = selectedTemplate && selectedTemplate.content !== sysPrompt ? selectedTemplate : null;
    const inputBudget = chatConfig.maxTokens || 4096;
    const sessionHistory = getHistoryForOptions({
        mode,
        target,
        sessionId,
        profileName,
        templateId
    });
    let recentHistory = sessionHistory.slice(-contextCount);

    if (recentHistory.length > 0) {
        const last = recentHistory[recentHistory.length - 1];
        if (last.role === 'user' || last.role === 'control') {
            recentHistory = recentHistory.slice(0, -1);
        }
    }

    if (format === 'raw') {
        const fixedText = `System:${sysPrompt}\n${template ? `User:${template.content}\n` : ''}User:${userMessage}`;
        const historyBudget = inputBudget - estimateTokens(fixedText);
        recentHistory = includeHistory && contextCount > 0 && historyBudget > 0
            ? trimHistoryToBudget(recentHistory, historyBudget)
            : [];
        let raw = `System:${sysPrompt}\n`;
        for (const item of recentHistory) {
            if (item.content) raw += `${item.role === 'assistant' ? 'AI' : 'User'}:${item.content}\n`;
            if (item.user && item.assistant) raw += `User:${item.user}\nAI:${item.assistant}\n`;
        }
        if (template) raw += `User:${template.content}\n`;
        raw += `User:${userMessage}`;
        return [{ role: 'user', content: raw }];
    }

    const messages = [{ role: 'system', content: sysPrompt }];
    let fixedTokens = tokenCount({ content: sysPrompt }) + 20;
    if (template) fixedTokens += tokenCount({ content: template.content }) + 10;
    fixedTokens += tokenCount({ content: userMessage }) + 10;
    const historyBudget = inputBudget - fixedTokens;
    if (includeHistory && contextCount > 0 && historyBudget > 0) {
        recentHistory = trimHistoryToBudget(recentHistory, historyBudget);
        for (const item of recentHistory) {
            if (item.content) {
                messages.push({
                    role: item.role === 'assistant' ? 'assistant' : 'user',
                    content: item.content
                });
            }
            if (item.user && item.assistant) {
                messages.push({ role: 'user', content: item.user });
                messages.push({ role: 'assistant', content: item.assistant });
            }
        }
    }
    if (template) messages.push({ role: 'user', content: template.content });
    messages.push({ role: 'user', content: userMessage });
    return messages;
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
    const activeProfileConfig = llmProfiles.find(profile => profile.name === activeProfile);
    if (activeProfileConfig?.mode === 'agent') {
        return chatStream(userMessage, options, {});
    }
    const { useTemplate = null, displayId = null, systemPrompt = null, includeHistory = false, contextCount = 0, mode = null, target = null, templateTarget = null, sessionId = null } = options;

    try {
        const messages = buildMessages(userMessage, { useTemplate, templateTarget, systemPrompt, includeHistory, contextCount, mode, target, sessionId });
        let assistantMessage = '';
        if (normalizeChatTransport(chatConfig).protocol === 'openai-responses') {
            const responseSessionKey = getResponsesSessionKey({ useTemplate, templateTarget, mode, target, sessionId });
            const fingerprint = getResponsesFingerprint({ useTemplate, templateTarget, systemPrompt });
            const response = await requestResponsesWithRecovery({
                messages,
                userMessage,
                state: responsesSessionStates[responseSessionKey],
                sessionKey: responseSessionKey,
                fingerprint,
                model: chatConfig.model,
                maxTokens: chatConfig.maxTokens,
                temperature: chatConfig.temperature,
                stream: false
            });
            assistantMessage = extractResponsesText(response);
            saveResponseReference(responseSessionKey, response, fingerprint);
        } else {
            const requestBody = {
                model: chatConfig.model,
                messages: messages,
                max_tokens: chatConfig.maxTokens,
                temperature: chatConfig.temperature
            };
            const headers = { 'Content-Type': 'application/json' };
            if (chatConfig.apiKey) headers.Authorization = 'Bearer ' + chatConfig.apiKey;
            const response = await makeRequest(chatConfig.apiUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestBody)
            });
            const data = JSON.parse(response);
            if (!data.choices?.[0]?.message) throw new Error('Invalid response format from API');
            assistantMessage = data.choices[0].message.content || '';
        }

        const templateId = templateTarget || useTemplate || 'default';
        const historyKey = sessionKey(mode, target, sessionId || chatSession.privateSessionId, activeProfile, templateId);
        if (!chatHistories[historyKey]) chatHistories[historyKey] = [];
        chatHistories[historyKey].push({
            id: Date.now().toString(),
            user: userMessage.substring(0, MAX_MESSAGE_LENGTH),
            assistant: assistantMessage.substring(0, MAX_MESSAGE_LENGTH),
            timestamp: Date.now(),
            displayId: displayId,
            mode: mode || chatSession.mode,
            target: target || chatSession.privateTarget,
            sessionId: sessionId || chatSession.privateSessionId || 'default',
            profileName: activeProfile,
            templateId
        });
        trimHistory();
        saveHistory([historyStore.getHistoryFileName({ mode, target })]);
        return { success: true, message: assistantMessage, history: getHistory() };
    } catch (error) {
        console.error('[Chat] API调用失败:', error.message);
        return {
            success: false,
            error: error.message,
            history: getHistory()
        };
    }
}

function buildAgentPrompt(messages) {
    return messages.map((message) => {
        const roleName = message.role === 'system'
            ? 'System:'
            : message.role === 'assistant' ? 'Assistant:' : 'User:';
        return `${roleName}\n${message.content}`;
    }).join('\n\n');
}

function buildCodexDeveloperInstructions(messages) {
    return messages
        .filter(message => message.role === 'system')
        .map(message => String(message.content || ''))
        .filter(Boolean)
        .join('\n\n');
}

function buildCodexConversationPrompt(messages) {
    return messages
        .filter(message => message.role !== 'system')
        .map((message) => {
            const roleName = message.role === 'assistant' ? 'Assistant:' : 'User:';
            return `${roleName}\n${message.content}`;
        })
        .join('\n\n');
}

async function chatStreamWithAgent(userMessage, options, callbacks, profile) {
    const {
        useTemplate = null,
        templateTarget = null,
        systemPrompt = null,
        includeHistory = false,
        contextCount = 0,
        mode = null,
        target = null,
        sessionId = null,
        conversationKey = null,
        ephemeral = false
    } = options;
    const { onChunk, onSentence, onComplete, onError } = callbacks;
    const template = normalizeChatTemplate(
        getTemplateByName(templateTarget || useTemplate) || {
            id: 'default',
            name: 'default',
            content: '',
            permissionProfile: 'readonly'
        }
    );
    let fullMessage = '';
    let pendingText = '';
    let reportedError = false;

    try {
        const runtimeManager = profile.backend === 'codex' ? codexRuntimeManager : piRuntimeManager;
        if (!runtimeManager) throw new Error(`${profile.backend} Runtime 未初始化`);
        const messages = buildMessages(userMessage, {
            useTemplate,
            templateTarget,
            systemPrompt,
            includeHistory,
            contextCount,
            mode,
            target,
            sessionId,
            profileName: profile.name,
            promptFormat: 'openai'
        });
        const prompt = profile.backend === 'codex'
            ? buildCodexConversationPrompt(messages)
            : buildAgentPrompt(messages);
        const result = await runtimeManager.chatStream(profile, template, prompt, {
            onChunk: (chunk, currentMessage) => {
                fullMessage = currentMessage || `${fullMessage}${chunk}`;
                pendingText += chunk;
                onChunk?.(chunk, fullMessage);
                const sentences = splitIntoSentences(pendingText);
                if (sentences.length >= 2) {
                    for (const sentence of sentences.slice(0, -1)) onSentence?.(sentence, fullMessage);
                    pendingText = sentences[sentences.length - 1];
                }
            },
            onComplete: (message) => {
                fullMessage = message || fullMessage;
                if (pendingText.trim()) onSentence?.(pendingText.trim(), fullMessage);
                onComplete?.(fullMessage, getHistory());
            },
            onError: (error) => {
                reportedError = true;
                onError?.(error);
            }
        }, {
            developerInstructions: profile.backend === 'codex'
                ? buildCodexDeveloperInstructions(messages)
                : undefined,
            continuationPrompt: userMessage,
            conversationKey: conversationKey || buildPiConversationKey(mode, target, sessionId),
            ephemeral
        });
        return {
            success: true,
            message: result.message || fullMessage,
            history: getHistory()
        };
    } catch (error) {
        console.error(`[Chat] ${profile.backend} Agent调用失败:`, error.message);
        if (!reportedError) onError?.(error.message);
        return {
            success: false,
            error: error.message,
            history: getHistory()
        };
    }
}

async function chatStream(userMessage, options = {}, callbacks = {}) {
    const { useTemplate = null, displayId = null, systemPrompt = null, includeHistory = false, contextCount = 0, mode = null, target = null, templateTarget = null, sessionId = null } = options;
    const { onChunk, onSentence, onComplete, onError } = callbacks;

    const activeProfileConfig = llmProfiles.find(profile => profile.name === activeProfile);
    if (activeProfileConfig?.mode === 'agent') {
        return chatStreamWithAgent(userMessage, {
            ...options,
            useTemplate,
            templateTarget,
            systemPrompt,
            includeHistory,
            contextCount,
            mode,
            target,
            sessionId
        }, callbacks, activeProfileConfig);
    }

    if (normalizeChatTransport(chatConfig).protocol === 'openai-responses') {
        let fullMessage = '';
        let pendingText = '';
        try {
            const messages = buildMessages(userMessage, { useTemplate, templateTarget, systemPrompt, includeHistory, contextCount, mode, target, sessionId });
            const responseSessionKey = getResponsesSessionKey({ useTemplate, templateTarget, mode, target, sessionId });
            const fingerprint = getResponsesFingerprint({ useTemplate, templateTarget, systemPrompt });
            await streamResponsesWithRecovery({
                messages,
                userMessage,
                state: responsesSessionStates[responseSessionKey],
                sessionKey: responseSessionKey,
                fingerprint,
                model: chatConfig.model,
                maxTokens: chatConfig.maxTokens,
                temperature: chatConfig.temperature,
                stream: true
            }, (event) => {
                if (event?.type === 'response.output_text.delta' && typeof event.delta === 'string') {
                    fullMessage += event.delta;
                    pendingText += event.delta;
                    onChunk?.(event.delta, fullMessage);
                    const sentences = splitIntoSentences(pendingText);
                    if (sentences.length >= 2) {
                        for (const sentence of sentences.slice(0, -1)) onSentence?.(sentence, fullMessage);
                        pendingText = sentences[sentences.length - 1];
                    }
                }
                if (event?.type === 'response.completed') {
                    saveResponseReference(responseSessionKey, event.response, fingerprint);
                }
            });
            if (pendingText.trim()) onSentence?.(pendingText.trim(), fullMessage);
            onComplete?.(fullMessage, getHistory());
            return { success: true, message: fullMessage, history: getHistory() };
        } catch (error) {
            console.error('[Chat] Responses 流式API调用失败:', error.message);
            onError?.(error.message);
            return { success: false, error: error.message, history: getHistory() };
        }
    }

    let fullMessage = '';
    let pendingText = '';

    try {
        const messages = buildMessages(userMessage, { useTemplate, templateTarget, systemPrompt, includeHistory, contextCount, mode, target, sessionId });
        
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

async function shutdown() {
    flushHistorySave();
    if (piRuntimeManager?.stopAll) await piRuntimeManager.stopAll();
    if (codexRuntimeManager?.stopAll) await codexRuntimeManager.stopAll();
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
    const existing = chatSession.sessions[target] || [];
    const recovered = recoverSessionsFromHistory(target, existing);
    const changed = JSON.stringify(existing) !== JSON.stringify(recovered);
    chatSession.sessions[target] = recovered;
    if (changed) {
        saveSession();
    }
    return recovered;
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

    historyStore.ensurePreviousDayBackup();
    chatSession.sessions[target] = chatSession.sessions[target].filter(s => s.id !== sessionId);

    // 删除该目标和会话下所有 profile/template 隔离分区的历史。
    for (const key of Object.keys(chatHistories)) {
        chatHistories[key] = chatHistories[key].filter(message => (
            !(message.mode === 'private' && message.target === target && message.sessionId === sessionId)
        ));
        if (chatHistories[key].length === 0) delete chatHistories[key];
    }
    saveHistory([historyStore.getHistoryFileName({ mode: 'private', target })]);

    // 如果当前会话被删除，切回 default
    if (chatSession.privateTarget === target && chatSession.privateSessionId === sessionId) {
        chatSession.privateSessionId = 'default';
    }

    saveSession();
    return true;
}

function switchSession(target, sessionId, metadata = {}) {
    if (!chatSession.sessions || !chatSession.sessions[target]) return false;
    const exists = chatSession.sessions[target].some(s => s.id === sessionId);
    if (!exists) return false;

    const isPrivateSessionChanged = chatSession.mode === 'private'
        && (chatSession.privateTarget !== target || chatSession.privateSessionId !== sessionId);
    if (isPrivateSessionChanged) {
        resetPiSessionForScope({
            mode: 'private',
            target: chatSession.privateTarget,
            sessionId: chatSession.privateSessionId || 'default'
        });
    }

    chatSession.privateTarget = target;
    chatSession.privateSessionId = sessionId;
    if (shouldPersistSession(metadata)) saveSession();
    return true;
}

function getSessionHistory(target, sessionId) {
    const requestedSessionId = sessionId || 'default';
    return Object.values(chatHistories)
        .flat()
        .filter(message => (
            message.profileName === activeProfile
            && message.mode === 'private'
            && message.target === target
            && message.sessionId === requestedSessionId
        ));
}

function exportHistory() {
    if (!flushHistorySave()) throw new Error('聊天历史保存失败');
    return historyStore.createExport(getAllHistoryMessages());
}

function rebuildChatHistories(messages) {
    chatHistories = {};
    for (const sourceMessage of messages) {
        const message = historyStore.normalizeChatMessage(sourceMessage, {
            profileName: activeProfile,
            templateId: 'default'
        });
        const key = sessionKey(
            message.mode,
            message.target,
            message.sessionId,
            message.profileName,
            message.templateId
        );
        if (!chatHistories[key]) chatHistories[key] = [];
        chatHistories[key].push(message);
    }
    trimHistory();
}

function importHistory(payload, options = {}) {
    const mode = options.mode || 'merge';
    if (!['merge', 'replace'].includes(mode)) {
        throw new Error('聊天历史导入模式无效');
    }
    if (mode === 'replace' && options.confirmed !== true) {
        throw new Error('替换导入需要明确确认');
    }
    const existing = getAllHistoryMessages();
    const mergeResult = mode === 'replace'
        ? historyStore.mergeImport([], payload)
        : historyStore.mergeImport(existing, payload);
    const nextMessages = mergeResult.messages;
    const affectedFiles = new Set();
    for (const message of existing) affectedFiles.add(historyStore.getHistoryFileName(message));
    for (const message of nextMessages) affectedFiles.add(historyStore.getHistoryFileName(message));

    historyStore.ensurePreviousDayBackup();
    rebuildChatHistories(nextMessages);
    for (const message of nextMessages) resetPiSessionForMessage(message);
    saveHistory(Array.from(affectedFiles));
    if (!flushHistorySave()) throw new Error('聊天历史保存失败');
    return {
        importedCount: mergeResult.importedCount,
        skippedCount: mergeResult.skippedCount,
        history: getHistory()
    };
}

function exportUserConfig() {
    if (!flushHistorySave()) throw new Error('聊天历史保存失败');
    return historyStore.createUserConfigExport();
}

function importUserConfig(payload, options = {}) {
    if (!flushHistorySave()) throw new Error('聊天历史保存失败');
    const result = historyStore.importUserConfig(payload, options);
    pendingChangedHistoryFiles.clear();
    loadHistory();
    loadSession();
    loadCommands();
    loadTemplates();
    loadImportantRecords();
    loadResponsesSessionState();
    return result;
}

module.exports = {
    init,
    shutdown,
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
    getGroupSystemPrompt,
    getHistory,
    clearHistory,
    deleteConversationRound,
    getConversationRoundRemoval,
    buildAgentPrompt,
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
    mergeSessionEntries,
    recoverSessionsFromHistory,
    flattenSessionEntries,
    listSessions,
    listAllSessions,
    createSession,
    deleteSession,
    switchSession,
    getSessionHistory,
    exportHistory,
    importHistory,
    exportUserConfig,
    importUserConfig,
    chat,
    chatStream,
    buildResponsesPayload,
    extractResponsesText,
    normalizeChatTransport,
    isSentenceEnd,
    splitIntoSentences
};
