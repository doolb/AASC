'use strict';

const READONLY_TOOLS = Object.freeze([
    'read',
    'grep',
    'aasc_find',
    'ls',
    'aasc_web_search',
    'aasc_web_fetch'
]);

const AGENT_MODES = new Set(['llm', 'agent']);

/**
 * 规范化聊天 profile，确保 Agent 分支只能使用服务器支持的后端。
 * 这里不接受请求侧传入的工具列表，避免调用方绕过控制端权限配置。
 *
 * @param {object} profile 原始 profile
 * @returns {object} 规范化后的 profile
 */
function normalizeAgentProfile(profile = {}) {
    const normalized = { ...profile };
    const mode = normalized.mode || 'llm';

    if (!AGENT_MODES.has(mode)) {
        throw new Error('LLM 模式不合法');
    }

    normalized.mode = mode;
    if (mode === 'agent') {
        if (normalized.backend !== undefined && !['pi', 'codex'].includes(normalized.backend)) {
            throw new Error('Agent 后端配置不合法');
        }
        normalized.backend = normalized.backend || 'pi';
    }

    return normalized;
}

/**
 * 规范化聊天模板。权限策略只保留枚举名称，忽略模板中的任意 tools 字段。
 *
 * @param {object} template 原始模板
 * @returns {object} 规范化后的模板
 */
function normalizeChatTemplate(template = {}) {
    const normalized = { ...template };
    const permissionProfile = normalized.permissionProfile || 'readonly';
    resolvePermissionPolicy(permissionProfile);
    normalized.permissionProfile = permissionProfile;
    delete normalized.tools;
    return normalized;
}

/**
 * 将控制端权限名称映射为服务器内置的固定工具集合。
 *
 * @param {string} permissionProfile 权限策略名称
 * @returns {{name: string, tools: string[]}} 权限策略
 */
function resolvePermissionPolicy(permissionProfile = 'readonly') {
    if (permissionProfile !== 'readonly') {
        throw new Error('权限策略不合法');
    }
    return {
        name: 'readonly',
        tools: [...READONLY_TOOLS]
    };
}

/**
 * 将 OpenAI Chat Completions 地址转换为 Pi provider 使用的 base URL。
 *
 * @param {string} apiUrl Chat Completions 地址
 * @returns {string} provider base URL
 */
function normalizeOpenAiBaseUrl(apiUrl = '') {
    const value = String(apiUrl || '').replace(/\/+$/u, '');
    return value.replace(/\/chat\/completions$/u, '');
}

/**
 * Pi provider 要求 apiKey 非空，但本地 OpenAI 兼容服务通常不需要鉴权。
 * 空值时使用仅用于通过 Pi provider 校验的占位值；真实 Key 原样透传。
 *
 * @param {string} apiKey profile 中的 API Key
 * @returns {string} Pi 可接受的 API Key
 */
function normalizePiApiKey(apiKey = '') {
    return String(apiKey || '').trim() || 'aasc-local-key';
}

function safeSessionPart(value, fallback) {
    const text = String(value ?? fallback);
    return encodeURIComponent(text).replace(/%/gu, '~');
}

/**
 * 生成 Pi 会话和历史记录使用的隔离键。
 *
 * @param {object} options 会话维度
 * @returns {string} 隔离键
 */
function buildChatSessionKey({
    profileName = 'default',
    templateId = 'default',
    mode = 'group',
    target = null,
    sessionId = 'default'
} = {}) {
    const parts = [
        'profile',
        safeSessionPart(profileName, 'default'),
        'template',
        safeSessionPart(templateId, 'default'),
        safeSessionPart(mode, 'group')
    ];

    if (mode === 'private') {
        parts.push(safeSessionPart(target, 'default'));
        parts.push(safeSessionPart(sessionId, 'default'));
    }

    return parts.join(':');
}

module.exports = {
    READONLY_TOOLS,
    normalizeAgentProfile,
    normalizeChatTemplate,
    resolvePermissionPolicy,
    normalizeOpenAiBaseUrl,
    normalizePiApiKey,
    buildChatSessionKey
};
