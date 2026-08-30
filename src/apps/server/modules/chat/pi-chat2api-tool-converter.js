'use strict';

const CHAT2API_TOOL_CALLS_MARKER = '<|CHAT2API|tool_calls>';
const CHAT2API_INVOKE_PATTERN = /<\|CHAT2API\|invoke\s+name=(?:"([^"]+)"|'([^']+)')\s*>/gu;
const CHAT2API_PARAMETER_PATTERN = /<\|parameter=([A-Za-z_][A-Za-z0-9_.-]*)>([\s\S]*?)<\/parameter>/gu;
const CHAT2API_FUNCTION_END = '</function>';

const DEFAULT_CHAT2API_TOOLS = Object.freeze([
    'read',
    'grep',
    'find',
    'ls',
    'aasc_web_search',
    'aasc_web_fetch'
]);

/**
 * 将 Pi 当前上下文中的工具定义转换为名称集合。
 * 解析器只使用名称做权限判断，不信任 Chat2API 文本中携带的工具定义。
 *
 * @param {string[]|object[]} allowedTools 服务器允许的工具名或 Pi 工具定义
 * @returns {Set<string>} 允许执行的工具名集合
 */
function normalizeAllowedTools(allowedTools) {
    const source = allowedTools === undefined ? DEFAULT_CHAT2API_TOOLS : allowedTools;
    return new Set(source.map((tool) => typeof tool === 'string' ? tool : tool?.name).filter(Boolean));
}

/**
 * 解析单个参数值。路径、搜索词等自然语言参数保持字符串；只有明确像
 * JSON 标量或容器的值才尝试还原类型，避免把文件路径误解析成其他数据。
 *
 * @param {string} rawValue Chat2API 参数原文
 * @returns {unknown} 转换后的参数值
 */
function parseParameterValue(rawValue) {
    const value = String(rawValue || '').trim();
    if (!value) return '';

    const looksLikeJsonScalar = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/u.test(value);
    const looksLikeJsonContainer = value.startsWith('{') || value.startsWith('[');
    if (!looksLikeJsonScalar && !looksLikeJsonContainer) return value;

    try {
        return JSON.parse(value);
    } catch (error) {
        return value;
    }
}

/**
 * 解析 invoke 块内部的 parameter 标签，并拒绝重复或未识别内容。
 *
 * @param {string} rawParameters invoke 块参数区域
 * @returns {object} Pi 工具调用参数
 */
function parseInvocationParameters(rawParameters) {
    const parameters = {};
    let cursor = 0;
    let match;
    CHAT2API_PARAMETER_PATTERN.lastIndex = 0;
    while ((match = CHAT2API_PARAMETER_PATTERN.exec(rawParameters))) {
        if (rawParameters.slice(cursor, match.index).trim()) {
            throw new Error('Chat2API 工具调用格式错误：参数之间存在未识别内容');
        }
        const name = match[1];
        if (Object.prototype.hasOwnProperty.call(parameters, name)) {
            throw new Error(`Chat2API 工具调用包含重复参数：${name}`);
        }
        parameters[name] = parseParameterValue(match[2]);
        cursor = CHAT2API_PARAMETER_PATTERN.lastIndex;
    }
    if (rawParameters.slice(cursor).trim()) {
        throw new Error('Chat2API 工具调用格式错误：参数标签未闭合');
    }
    if (Object.keys(parameters).length === 0) {
        throw new Error('Chat2API 工具调用格式错误：调用没有参数');
    }
    return parameters;
}

/**
 * 将 Chat2API 的文本工具调用转换为 Pi ToolCall 内容块。
 * 该函数不执行任何工具，只负责协议解析和白名单校验。
 *
 * @param {string} text 模型返回的助手文本
 * @param {string[]|object[]} allowedTools 当前权限策略允许的工具
 * @returns {{calls: object[], remainingText: string}} 转换结果
 */
function parseChat2ApiToolCalls(text, allowedTools) {
    const source = String(text || '');
    const markerIndex = source.indexOf(CHAT2API_TOOL_CALLS_MARKER);
    if (markerIndex < 0) {
        if (source.includes('<|CHAT2API|')) {
            throw new Error('Chat2API 工具调用格式错误：缺少 tool_calls 标记');
        }
        return { calls: [], remainingText: source };
    }

    const permittedTools = normalizeAllowedTools(allowedTools);
    const prefix = source.slice(0, markerIndex);
    const payload = source.slice(markerIndex + CHAT2API_TOOL_CALLS_MARKER.length);
    const calls = [];
    let cursor = 0;
    let match;
    CHAT2API_INVOKE_PATTERN.lastIndex = 0;

    while ((match = CHAT2API_INVOKE_PATTERN.exec(payload))) {
        if (payload.slice(cursor, match.index).trim()) {
            throw new Error('Chat2API 工具调用格式错误：调用之间存在未识别内容');
        }

        const name = match[1] || match[2];
        if (!permittedTools.has(name)) {
            throw new Error(`Chat2API 不允许的工具：${name}`);
        }

        const endIndex = payload.indexOf(CHAT2API_FUNCTION_END, CHAT2API_INVOKE_PATTERN.lastIndex);
        if (endIndex < 0) {
            throw new Error('Chat2API 工具调用格式错误：缺少 function 结束标签');
        }
        const rawParameters = payload.slice(CHAT2API_INVOKE_PATTERN.lastIndex, endIndex);
        calls.push({
            type: 'toolCall',
            id: `chat2api-${calls.length + 1}`,
            name,
            arguments: parseInvocationParameters(rawParameters)
        });
        cursor = endIndex + CHAT2API_FUNCTION_END.length;
        CHAT2API_INVOKE_PATTERN.lastIndex = cursor;
    }

    if (calls.length === 0) {
        throw new Error('Chat2API 工具调用格式错误：没有找到 invoke 调用');
    }
    const remainingPayload = payload.slice(cursor);
    if (remainingPayload.includes('<|CHAT2API|')) {
        throw new Error('Chat2API 工具调用格式错误：存在未识别协议标签');
    }
    return {
        calls,
        remainingText: `${prefix}${remainingPayload}`.trim()
    };
}

function convertChat2ApiContent(text, allowedTools) {
    const result = parseChat2ApiToolCalls(text, allowedTools);
    return {
        text: result.remainingText,
        calls: result.calls
    };
}

module.exports = {
    CHAT2API_TOOL_CALLS_MARKER,
    DEFAULT_CHAT2API_TOOLS,
    parseChat2ApiToolCalls,
    convertChat2ApiContent
};
