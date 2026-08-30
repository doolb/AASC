const axios = require('axios');
const { Readable } = require('stream');

const PROVIDER_IDS = Object.freeze(['deepseek', 'glm', 'kimi', 'mimo', 'minimax', 'perplexity', 'qwen', 'qwen-ai', 'zai']);

const getCredentials = (account) => account && (account.credentials || account) || {};

const buildProviderHeaders = (provider, account, providerId) => {
  const credentials = getCredentials(account);
  const headers = { ...(provider.headers || {}) };
  const token = credentials.token || credentials.accessToken || credentials.refreshToken || credentials.refresh_token || credentials.ticket;
  if (token && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${token}`;
  }
  const cookieParts = [];
  const cookie = credentials.cookie || credentials.cookies;
  if (typeof cookie === 'string' && cookie.trim()) {
    cookieParts.push(cookie.trim());
  } else if (cookie && typeof cookie === 'object') {
    for (const [key, value] of Object.entries(cookie)) cookieParts.push(`${key}=${value}`);
  }
  const cookieFields = {
    serviceToken: credentials.serviceToken || credentials.service_token,
    userId: credentials.userId || credentials.user_id,
    xiaomichatbot_ph: credentials.phToken || credentials.ph_token,
    sessionToken: credentials.sessionToken,
  };
  for (const [key, value] of Object.entries(cookieFields)) if (value) cookieParts.push(`${key === 'sessionToken' ? '__Secure-next-auth.session-token' : key}=${value}`);
  if (cookieParts.length > 0) headers.Cookie = cookieParts.join('; ');
  if (providerId === 'mimo' && cookieParts.length > 0) headers.Origin = headers.Origin || provider.apiEndpoint;
  return headers;
};

const buildRequestBody = (request, actualModel) => ({
  model: actualModel,
  messages: request.messages,
  stream: request.stream === true,
  temperature: request.temperature,
  top_p: request.top_p,
  max_tokens: request.max_tokens,
  tools: request.tools,
  tool_choice: request.tool_choice,
});

const asOpenAiChunk = (data, model) => {
  if (!data || typeof data !== 'object') return null;
  if (data.object === 'chat.completion.chunk' || data.choices) return { ...data, model: data.model || model };
  const content = data.content || data.text || data.message || data.delta;
  if (typeof content !== 'string') return null;
  return { id: data.id || `chatcmpl-${Date.now()}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { content }, finish_reason: null }] };
};

const parseSseStream = async function* (source, model) {
  let buffer = '';
  for await (const chunk of source) {
    buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;
      try {
        const parsed = asOpenAiChunk(JSON.parse(raw), model);
        if (parsed) yield parsed;
      } catch {
        // 上游非 JSON 行不转发，避免破坏 OpenAI SSE 协议。
      }
    }
  }
  if (buffer.startsWith('data:')) {
    const raw = buffer.slice(5).trim();
    if (raw && raw !== '[DONE]') {
      try {
        const parsed = asOpenAiChunk(JSON.parse(raw), model);
        if (parsed) yield parsed;
      } catch {
        // 忽略未完成或非法的尾部事件。
      }
    }
  }
};

const normalizeBody = (data, model) => {
  if (data && data.object === 'chat.completion') return { ...data, model: data.model || model };
  const content = data && (data.content || data.text || data.answer || data.message);
  return {
    id: data && data.id ? data.id : `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: typeof content === 'string' ? content : '' }, finish_reason: 'stop' }],
    ...(data && data.usage ? { usage: data.usage } : {}),
  };
};

const createProviderAdapter = ({ httpClient, providerId }) => async ({ request, account, provider, actualModel }) => {
  const url = `${String(provider.apiEndpoint).replace(/\/$/, '')}${provider.chatPath || '/v1/chat/completions'}`;
  const response = await httpClient.request({
    method: 'POST', url, data: buildRequestBody(request, actualModel),
    headers: buildProviderHeaders(provider, account, providerId), responseType: request.stream === true ? 'stream' : 'json', timeout: 120_000,
    validateStatus: () => true,
  });
  if (response.status < 200 || response.status >= 300) {
    const error = new Error(`Provider HTTP ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }
  if (request.stream === true) {
    const source = response.data && typeof response.data[Symbol.asyncIterator] === 'function' ? response.data : Readable.from([JSON.stringify(response.data)]);
    return { stream: parseSseStream(source, request.model) };
  }
  return { body: normalizeBody(response.data, request.model) };
};

const createChat2ApiProviderAdapters = ({ httpClient = axios } = {}) => Object.fromEntries(PROVIDER_IDS.map((providerId) => [providerId, createProviderAdapter({ httpClient, providerId })]));

module.exports = { PROVIDER_IDS, createChat2ApiProviderAdapters, buildProviderHeaders, buildRequestBody, parseSseStream };
