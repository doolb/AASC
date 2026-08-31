'use strict';

const { createHash } = require('node:crypto');

const TOOL_PROMPT_MARKERS = Object.freeze([
  '<|CHAT2API|tool_calls>',
  '## Available Tools',
  '你可以使用以下只读工具',
]);

const PROVIDER_NATIVE_STATE_KEYS = Object.freeze([
  'sessionId',
  'parentReqId',
  'parentMessageId',
  'conversationId',
  'chatId',
  'parentId',
]);

const getToolDefinition = (tool) => {
  if (!tool || typeof tool !== 'object' || (tool.type !== undefined && tool.type !== 'function')) return null;
  const definition = tool.function && typeof tool.function === 'object' ? tool.function : tool;
  if (typeof definition.name !== 'string' || definition.name.trim().length === 0) return null;
  return {
    name: definition.name.trim(),
    description: typeof definition.description === 'string' ? definition.description : '',
    parameters: definition.parameters && typeof definition.parameters === 'object' ? definition.parameters : {},
  };
};

const normalizeManagedTools = (tools) => (Array.isArray(tools) ? tools : [])
  .map(getToolDefinition)
  .filter(Boolean);

const buildManagedToolInstruction = (tools) => {
  const definitions = normalizeManagedTools(tools);
  if (definitions.length === 0) return '';
  return [
    '你可以使用以下只读工具。需要调用工具时，不要解释调用过程，只输出下面的 Chat2API 工具标签格式；不需要工具时直接正常回答。',
    JSON.stringify(definitions),
    '工具调用格式：<|CHAT2API|tool_calls><|CHAT2API|invoke name="工具名"><|CHAT2API|parameter name="参数名"><![CDATA[参数值]]></|CHAT2API|parameter></|CHAT2API|invoke></|CHAT2API|tool_calls>',
    '只能调用上面列出的工具，参数值必须是合法 JSON 或字符串。',
  ].join('\n');
};

const getToolPromptHash = (tools) => {
  const definitions = normalizeManagedTools(tools);
  if (definitions.length === 0) return '';
  return createHash('sha256').update(JSON.stringify(definitions)).digest('hex');
};

const getMessageText = (content) => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((item) => item && item.type === 'text')
    .map((item) => item.text || '')
    .join('\n');
};

const hasManagedToolPrompt = (messages) => (Array.isArray(messages) ? messages : []).some((message) => {
  const text = getMessageText(message && message.content);
  return TOOL_PROMPT_MARKERS.some((marker) => text.includes(marker));
});

const hasProviderNativeSession = (nativeState) => PROVIDER_NATIVE_STATE_KEYS.some((key) => (
  typeof nativeState?.[key] === 'string' && nativeState[key].length > 0
));

const appendPromptToMessages = (messages, prompt) => {
  const current = Array.isArray(messages) ? messages : [];
  const [first, ...rest] = current;
  if (first?.role === 'system') {
    return [{
      ...first,
      content: `${getMessageText(first.content)}\n\n${prompt}`,
    }, ...rest];
  }
  return [{ role: 'system', content: prompt }, ...current];
};

/**
 * 在公共 Provider 边界执行原版 Chat2API 的 managed tool calling 转换。
 * 网页 Provider 不可靠地支持 OpenAI 原生 tools，因此这里统一注入标签协议，
 * 并移除原生字段。Responses 原生会话只发送本轮增量消息时，通过 nativeState
 * 保存提示指纹，避免同一上游 session 反复生成 System 工具提示。
 */
const prepareManagedToolRequest = (request, responseSession) => {
  const definitions = normalizeManagedTools(request && request.tools);
  if (definitions.length === 0) return request;

  const prompt = buildManagedToolInstruction(definitions);
  const promptHash = getToolPromptHash(definitions);
  const nativeState = responseSession && responseSession.nativeState && typeof responseSession.nativeState === 'object'
    ? responseSession.nativeState
    : null;
  const messages = Array.isArray(request.messages) ? request.messages : [];
  const promptExists = hasManagedToolPrompt(messages);
  const hasSamePromptHash = nativeState?.managedToolPromptHash === promptHash;
  const hasUntrackedPrompt = promptExists && !nativeState?.managedToolPromptHash;
  const isLegacyNativeSession = Boolean(nativeState)
    && hasProviderNativeSession(nativeState)
    && !nativeState.managedToolPromptHash;
  const shouldInject = !hasSamePromptHash && !hasUntrackedPrompt && !isLegacyNativeSession;

  if (nativeState) nativeState.managedToolPromptHash = promptHash;
  const preparedMessages = shouldInject ? appendPromptToMessages(messages, prompt) : messages;
  const { tools: _tools, tool_choice: _toolChoice, ...requestWithoutNativeTools } = request;
  return { ...requestWithoutNativeTools, messages: preparedMessages };
};

module.exports = {
  buildManagedToolInstruction,
  getToolPromptHash,
  hasManagedToolPrompt,
  normalizeManagedTools,
  prepareManagedToolRequest,
};
