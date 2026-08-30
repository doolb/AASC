const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');
const { Readable } = require('stream');
const { createHash, createHmac, randomUUID } = require('crypto');
const { createBrotliDecompress, createGunzip, createInflate } = require('zlib');

let deepSeekWasmPromise;

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
    tongyi_sso_ticket: providerId === 'qwen' ? credentials.ticket || credentials.tongyi_sso_ticket : undefined,
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

const getMessageText = (content) => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((item) => item && item.type === 'text')
    .map((item) => item.text || '')
    .join('\n');
};

const getNativeState = (responseSession) => responseSession && responseSession.nativeState && typeof responseSession.nativeState === 'object'
  ? responseSession.nativeState
  : {};

const createQwenRequest = (request, actualModel, provider, headers, responseSession) => {
  const nativeState = getNativeState(responseSession);
  const hasSession = Boolean(nativeState.sessionId);
  const requestId = randomUUID().replaceAll('-', '');
  const sessionId = nativeState.sessionId || randomUUID().replaceAll('-', '');
  if (responseSession && !nativeState.sessionId) nativeState.sessionId = sessionId;
  const timestamp = Date.now();
  const nonce = randomUUID().replaceAll('-', '').slice(0, 12);
  const messages = (request.messages || []).map((message) => {
    const text = getMessageText(message.content);
    if (message.role === 'system') return `System: ${text}`;
    if (message.role === 'assistant') return `Assistant: ${text}`;
    if (message.role === 'tool') return `Tool: ${text}`;
    return text;
  }).filter(Boolean);
  const content = messages.join('\n\n');
  const url = new URL(`${String(provider.apiEndpoint).replace(/\/$/, '')}${provider.chatPath || '/api/v2/chat'}`);
  url.search = new URLSearchParams({
    biz_id: 'ai_qwen',
    chat_client: 'h5',
    device: 'pc',
    fr: 'pc',
    pr: 'qwen',
    ut: randomUUID().replaceAll('-', ''),
    nonce,
    timestamp: String(timestamp),
  }).toString();
  const qwenHeaders = { ...headers };
  // tongyi_sso_ticket 使用 Cookie 鉴权，Bearer ticket 会触发 Qwen 签名错误。
  delete qwenHeaders.Authorization;
  delete qwenHeaders.authorization;
  Object.assign(qwenHeaders, {
    Accept: 'application/json, text/event-stream, text/plain, */*',
    Origin: qwenHeaders.Origin || 'https://www.qianwen.com',
    Referer: qwenHeaders.Referer || 'https://www.qianwen.com/',
    'X-Platform': 'pc_tongyi',
    'X-DeviceId': '5b68c267-cd8e-fd0e-148a-18345bc9a104',
  });
  return {
    url: url.toString(),
    headers: qwenHeaders,
    data: {
      deep_search: '0',
      req_id: requestId,
      model: actualModel,
      scene: 'chat',
      session_id: sessionId,
      sub_scene: 'chat',
      temporary: false,
      messages: [{ content, mime_type: 'text/plain', meta_data: { ori_query: content } }],
      from: 'default',
      parent_req_id: nativeState.parentReqId || '0',
      enable_search: false,
      biz_data: '{"entryPoint":"tongyigw"}',
      scene_param: hasSession ? 'continue' : 'first_turn',
      chat_client: 'h5',
      client_tm: String(timestamp),
      protocol_version: 'v2',
      biz_id: 'ai_qwen',
    },
  };
};

const getProviderToken = (account) => {
  const credentials = getCredentials(account);
  return credentials.accessToken || credentials.token || credentials.apiKey || credentials.refreshToken || credentials.refresh_token || '';
};

const getMessagesText = (messages = []) => messages.map((message) => {
  const text = getMessageText(message.content);
  const role = message.role === 'assistant' ? 'Assistant' : message.role === 'system' ? 'System' : 'User';
  return text ? `${role}: ${text}` : '';
}).filter(Boolean).join('\n\n');

const getProviderOrigin = (provider, fallback) => {
  try {
    return new URL(provider.apiEndpoint).origin;
  } catch {
    return fallback;
  }
};

const createRequestId = () => randomUUID();

const createGlmRequest = (request, actualModel, provider, headers, account, responseSession) => {
  const nativeState = getNativeState(responseSession);
  const timestamp = String(Date.now());
  const nonce = createRequestId();
  const sign = createHash('md5').update(`${timestamp}-${nonce}-8a1317a7468aa3ad86e997d08f3f31cb`).digest('hex');
  const origin = getProviderOrigin(provider, 'https://chatglm.cn');
  const prepared = [{ role: 'user', content: [{ type: 'text', text: `${getMessagesText(request.messages)}\nAssistant: ` }] }];
  return {
    url: `${origin}/chatglm/backend-api/assistant/stream`,
    data: {
      assistant_id: /^[a-z0-9]{24,}$/.test(actualModel) ? actualModel : '65940acff94777010aa6b796',
      conversation_id: nativeState.conversationId || '',
      project_id: '',
      chat_type: 'user_chat',
      messages: prepared,
      meta_data: {
        channel: '',
        chat_mode: request.reasoning_effort || /think|zero/i.test(request.originalModel || request.model) ? 'zero' : undefined,
        draft_id: '',
        if_plus_model: true,
        input_question_type: 'xxxx',
        is_networking: Boolean(request.web_search),
        is_test: false,
        platform: 'pc',
        quote_log_id: '',
        cogview: { rm_label_watermark: false },
      },
    },
    headers: {
      ...headers,
      Authorization: `Bearer ${getProviderToken(account)}`,
      'X-Device-Id': createRequestId(),
      'X-Request-Id': createRequestId(),
      'X-Sign': sign,
      'X-Timestamp': timestamp,
      'X-Nonce': nonce,
    },
  };
};

const createKimiRequest = (request, actualModel, provider, headers, account, responseSession) => {
  const nativeState = getNativeState(responseSession);
  const model = actualModel || 'kimi-k2.6';
  const scenario = model.toLowerCase().includes('k2.6') ? 'SCENARIO_K2D6' : 'SCENARIO_K2D5';
  const payload = {
    scenario,
    chat_id: nativeState.chatId || '',
    tools: request.web_search ? [{ type: 'TOOL_TYPE_SEARCH', search: {} }] : [],
    message: {
      parent_id: nativeState.parentId || '',
      role: 'user',
      blocks: [{ message_id: '', text: { content: getMessagesText(request.messages) } }],
      scenario,
    },
    options: { thinking: Boolean(request.enableThinking || request.reasoning_effort || /think|r1/i.test(request.originalModel || request.model)) },
  };
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const frame = Buffer.alloc(5 + json.length);
  frame.writeUInt8(0, 0);
  frame.writeUInt32BE(json.length, 1);
  json.copy(frame, 5);
  return {
    url: `${getProviderOrigin(provider, 'https://www.kimi.com')}/apiv2/kimi.gateway.chat.v1.ChatService/Chat`,
    data: frame,
    headers: { ...headers, Authorization: `Bearer ${getProviderToken(account)}`, 'Content-Type': 'application/connect+json' },
  };
};

const createMimoRequest = (request, actualModel, provider, headers, account, responseSession) => {
  const credentials = getCredentials(account);
  const nativeState = getNativeState(responseSession);
  const conversationId = nativeState.conversationId || request.nativeConversationId || randomUUID().replaceAll('-', '');
  const query = getMessagesText(request.messages);
  return {
    url: `${getProviderOrigin(provider, 'https://aistudio.xiaomimimo.com')}/open-apis/bot/chat?xiaomichatbot_ph=${encodeURIComponent(credentials.ph_token || credentials.phToken || '')}`,
    data: {
      msgId: randomUUID().replaceAll('-', '').slice(0, 32),
      conversationId,
      query,
      isEditedQuery: false,
      modelConfig: {
        enableThinking: Boolean(request.enableThinking || /think|r1/i.test(request.originalModel || request.model)),
        webSearchStatus: 'disabled',
        model: actualModel,
        temperature: request.temperature ?? 0.8,
        topP: 0.95,
      },
      multiMedias: [],
    },
    headers: {
      ...headers,
      Cookie: `serviceToken=${credentials.service_token || credentials.serviceToken || ''}; userId=${credentials.user_id || credentials.userId || ''}; xiaomichatbot_ph=${credentials.ph_token || credentials.phToken || ''}`,
      Origin: getProviderOrigin(provider, 'https://aistudio.xiaomimimo.com'),
    },
  };
};

const createPerplexityRequest = (request, actualModel, provider, headers, account) => {
  const requestId = createRequestId();
  const origin = getProviderOrigin(provider, 'https://www.perplexity.ai');
  const query = getMessagesText(request.messages);
  const frontendUuid = createRequestId();
  const contextUuid = createRequestId();
  const model = String(actualModel || 'turbo').toLowerCase().includes('auto') ? 'turbo' : actualModel;
  const cookies = getCredentials(account).cookies || getCredentials(account).cookie || '';
  const cookie = typeof cookies === 'string' && cookies ? cookies : `__Secure-next-auth.session-token=${getCredentials(account).sessionToken || getProviderToken(account)}`;
  return {
    url: `${origin}/rest/sse/perplexity_ask`,
    data: {
      params: {
        attachments: [], language: 'en-US', timezone: 'America/Los_Angeles', search_focus: 'internet', sources: ['web'], search_recency_filter: null,
        frontend_uuid: frontendUuid, mode: 'copilot', model_preference: model, is_related_query: false, is_sponsored: false,
        frontend_context_uuid: contextUuid, prompt_source: 'user', query_source: 'home', is_incognito: false, time_from_first_type: 18361,
        local_search_enabled: false, use_schematized_api: true, send_back_text_in_streaming_api: false, mentions: [], dsl_query: query,
        skip_search_enabled: true, is_nav_suggestions_disabled: false, source: 'default', always_search_override: false, override_no_search: false,
        should_ask_for_mcp_tool_confirmation: true, browser_agent_allow_once_from_toggle: false, force_enable_browser_agent: false,
        supported_features: ['browser_agent_permission_banner_v1.1'], version: '2.18',
      },
      query_str: query,
    },
    headers: { ...headers, Accept: 'text/event-stream', Cookie: cookie, 'x-perplexity-request-reason': 'perplexity-query-state-provider', 'x-request-id': requestId },
  };
};

const createQwenAiRequest = (request, actualModel, provider, headers, account, chatId, responseSession) => {
  const nativeState = getNativeState(responseSession);
  const credentials = getCredentials(account);
  const model = String(actualModel || 'qwen3.7-max').toLowerCase() === 'qwen' ? 'qwen3.7-max' : actualModel;
  const userContent = getMessagesText(request.messages).replace(/^User:\s*/, '');
  const fid = createRequestId();
  const childId = createRequestId();
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    url: `${getProviderOrigin(provider, 'https://chat.qwen.ai')}/api/v2/chat/completions?chat_id=${encodeURIComponent(chatId)}`,
    data: {
      stream: true, version: '2.1', incremental_output: true, chat_id: chatId, chat_mode: 'normal', model,
      parent_id: nativeState.parentId || null,
      messages: [{ fid, parentId: null, childrenIds: [childId], role: 'user', content: userContent, user_action: 'chat', files: [], timestamp, models: [model], chat_type: 't2t', feature_config: { thinking_enabled: Boolean(request.enable_thinking || /think|r1/i.test(request.originalModel || request.model)), output_schema: 'phase', research_mode: 'normal', auto_thinking: false, thinking_format: 'summary', auto_search: false }, extra: { meta: { subChatType: 't2t' } }, sub_chat_type: 't2t' }],
      timestamp: timestamp + 1,
    },
    headers: { ...headers, Authorization: `Bearer ${getProviderToken(account)}`, Cookie: credentials.cookies || credentials.cookie || headers.Cookie || '', 'x-accel-buffering': 'no' },
  };
};

const createZaiRequest = (request, actualModel, provider, headers, account, chatId, messageId, responseSession) => {
  const nativeState = getNativeState(responseSession);
  const token = getProviderToken(account);
  const requestId = createRequestId();
  const timestamp = Date.now();
  const userId = (() => { try { const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()); return payload.id || payload.user_id || payload.uid || payload.sub || 'guest'; } catch { return 'guest'; } })();
  const prompt = getMessagesText(request.messages).replace(/^User:\s*/, '');
  const secret = 'key-@@@@)))()((9))-xxxx&&&%%%%%';
  const windowIndex = Math.floor(timestamp / (5 * 60 * 1000));
  const derived = createHmac('sha256', secret).update(String(windowIndex)).digest('hex');
  const signature = createHmac('sha256', derived).update(`requestId,${requestId},timestamp,${timestamp},user_id,${userId}|${Buffer.from(prompt).toString('base64')}|${timestamp}`).digest('hex');
  return {
    url: `${getProviderOrigin(provider, 'https://chat.z.ai')}/api/v2/chat/completions?${new URLSearchParams({ timestamp: String(timestamp), requestId, user_id: userId, version: '0.0.1', platform: 'web', token, language: 'zh-CN', timezone: 'Asia/Shanghai', signature_timestamp: String(timestamp) }).toString()}`,
    data: { stream: true, model: actualModel, messages: request.messages, signature_prompt: prompt, params: {}, extra: {}, features: { image_generation: false, web_search: false, auto_web_search: Boolean(request.web_search), preview_mode: true, flags: [], vlm_tools_enable: false, vlm_web_search_enable: false, vlm_website_mode: false, enable_thinking: request.reasoning_effort !== false }, variables: {}, chat_id: chatId, id: requestId, current_user_message_id: messageId, current_user_message_parent_id: nativeState.parentMessageId || null, background_tasks: { title_generation: true, tags_generation: true } },
    headers: { ...headers, Authorization: `Bearer ${token}`, Cookie: `token=${token}`, 'X-Signature': signature, Referer: `${getProviderOrigin(provider, 'https://chat.z.ai')}/c/${chatId}` },
  };
};

const createMiniMaxRequest = (request, actualModel, provider, headers, account, chatId, responseSession) => {
  const nativeState = getNativeState(responseSession);
  chatId = chatId || nativeState.chatId;
  const token = getProviderToken(account);
  const credentials = getCredentials(account);
  const realUserId = credentials.realUserID || credentials.real_user_id || 'guest';
  const unix = String(Date.now());
  const timestamp = Math.floor(Date.now() / 1000);
  const requestData = {
    msg_type: 1,
    text: getMessagesText(request.messages),
    chat_type: 1,
    attachments: [],
    selected_mcp_tools: [],
    backend_config: {},
    sub_agent_ids: [],
    ...(chatId ? { chat_id: chatId } : {}),
  };
  const userData = new URLSearchParams({ device_platform: 'web', biz_id: '3', app_id: '3001', version_code: '22201', uuid: realUserId, device_id: credentials.deviceId || '', os_name: 'Mac', browser_name: 'chrome', browser_language: 'zh-CN', user_id: realUserId, unix, lang: 'zh', token, timezone_offset: '28800', sys_language: 'zh', client: 'web' });
  const path = '/matrix/api/v1/chat/send_msg';
  const fullPath = `${path}?${userData.toString()}`;
  const dataJson = JSON.stringify(requestData);
  const yy = createHash('md5').update(`${encodeURIComponent(fullPath)}_${dataJson}${createHash('md5').update(unix).digest('hex')}ooui`).digest('hex');
  const signature = createHash('md5').update(`${timestamp}${token}${dataJson}`).digest('hex');
  const minimaxHeaders = { ...headers, token, Origin: getProviderOrigin(provider, 'https://agent.minimaxi.com'), 'X-User-ID': realUserId, 'x-timestamp': String(timestamp), 'x-signature': signature, yy };
  delete minimaxHeaders.Authorization;
  delete minimaxHeaders.authorization;
  return {
    url: `${getProviderOrigin(provider, 'https://agent.minimaxi.com')}${fullPath}`,
    data: requestData,
    headers: minimaxHeaders,
  };
};

const createMiniMaxDetailRequest = (provider, headers, account, chatId) => {
  const token = getProviderToken(account);
  const credentials = getCredentials(account);
  const realUserId = credentials.realUserID || credentials.real_user_id || 'guest';
  const unix = String(Date.now());
  const timestamp = Math.floor(Date.now() / 1000);
  const path = '/matrix/api/v1/chat/get_chat_detail';
  const data = { chat_id: chatId };
  const dataJson = JSON.stringify(data);
  const query = new URLSearchParams({ device_platform: 'web', biz_id: '3', app_id: '3001', version_code: '22201', uuid: realUserId, device_id: credentials.deviceId || '', os_name: 'Mac', browser_name: 'chrome', browser_language: 'zh-CN', user_id: realUserId, unix, lang: 'zh', token, timezone_offset: '28800', sys_language: 'zh', client: 'web' });
  const fullPath = `${path}?${query.toString()}`;
  const yy = createHash('md5').update(`${encodeURIComponent(fullPath)}_${dataJson}${createHash('md5').update(unix).digest('hex')}ooui`).digest('hex');
  const signature = createHash('md5').update(`${timestamp}${token}${dataJson}`).digest('hex');
  const detailHeaders = { ...headers, token, 'x-timestamp': String(timestamp), 'x-signature': signature, yy };
  delete detailHeaders.Authorization;
  delete detailHeaders.authorization;
  return { method: 'POST', url: `${getProviderOrigin(provider, 'https://agent.minimaxi.com')}${fullPath}`, data, headers: detailHeaders, responseType: 'json', timeout: 120_000, validateStatus: () => true };
};

const getMiniMaxAnswer = (data) => {
  const messages = Array.isArray(data && data.messages) ? data.messages.filter((message) => message && message.msg_type === 2) : [];
  const message = messages.at(-1);
  return { chatId: data && data.chat_id, content: message && message.msg_content || '', thinking: message && message.extra_info && message.extra_info.thinking_content || '', done: Boolean(data && data.chat && data.chat.chat_status === 2), usage: data && data.usage };
};

const pollMiniMaxAnswer = async (httpClient, provider, headers, account, chatId, maxPolls = 120) => {
  let latest = { chatId, content: '', thinking: '', done: false };
  for (let poll = 0; poll < maxPolls; poll += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const response = await httpClient.request(createMiniMaxDetailRequest(provider, headers, account, chatId));
    if (response.status < 200 || response.status >= 300) continue;
    const current = getMiniMaxAnswer(response.data);
    latest = { ...latest, ...current, chatId: current.chatId || chatId };
    if (latest.done && latest.content) return latest;
  }
  return latest;
};

const createMiniMaxPollingStream = async function* (httpClient, provider, headers, account, chatId, model) {
  const result = await pollMiniMaxAnswer(httpClient, provider, headers, account, chatId);
  if (result.thinking) yield { id: chatId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { reasoning_content: result.thinking }, finish_reason: null }] };
  if (result.content) yield { id: chatId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { content: result.content }, finish_reason: null }] };
  yield { id: chatId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
};

const createDeepSeekRequest = (request, actualModel, provider, headers, account, sessionId, powResponse, responseSession) => {
  const nativeState = getNativeState(responseSession);
  const token = getProviderToken(account);
  const modelLower = String(request.originalModel || request.model).toLowerCase();
  return {
    url: `${getProviderOrigin(provider, 'https://chat.deepseek.com')}/api/v0/chat/completion`,
    data: { chat_session_id: sessionId || nativeState.sessionId || '', parent_message_id: nativeState.parentMessageId || null, prompt: getMessagesText(request.messages), model_type: modelLower.includes('pro') ? 'expert' : 'default', ref_file_ids: [], search_enabled: Boolean(request.web_search || modelLower.includes('search')), thinking_enabled: Boolean(request.reasoning_effort || modelLower.includes('think') || modelLower.includes('r1')), preempt: false },
    headers: { ...headers, Authorization: `Bearer ${token}`, Referer: `${getProviderOrigin(provider, 'https://chat.deepseek.com')}/a/chat/s/${sessionId || ''}`, 'X-Ds-Pow-Response': powResponse || headers['X-Ds-Pow-Response'] || '' },
  };
};

const NATIVE_REQUEST_BUILDERS = Object.freeze({ glm: createGlmRequest, kimi: createKimiRequest, mimo: createMimoRequest, minimax: createMiniMaxRequest, perplexity: createPerplexityRequest, 'qwen-ai': createQwenAiRequest, zai: createZaiRequest, deepseek: createDeepSeekRequest });

const asOpenAiChunk = (data, model) => {
  if (!data || typeof data !== 'object') return null;
  if (data.object === 'chat.completion.chunk' || data.choices) return { ...data, model: data.model || model };
  const content = data.content || data.text || data.message || data.delta;
  if (typeof content !== 'string') return null;
  return { id: data.id || `chatcmpl-${Date.now()}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { content }, finish_reason: null }] };
};

const stripQwenMarkers = (value) => value
  .replace(/\[\(deep_think\)\]/g, '')
  .replace(/\[\(multimodal_chat_think_\d+\)\]/g, '');

const getQwenMessages = (data) => {
  const candidates = [data && data.data && data.data.messages, data && data.messages];
  return candidates.find(Array.isArray) || null;
};

const extractQwenContent = (data) => {
  const messages = getQwenMessages(data);
  if (!messages) return null;
  return messages
    .filter((message) => message && ['multi_load/iframe', 'text/plain'].includes(message.mime_type))
    .map((message) => typeof message.content === 'string' ? stripQwenMarkers(message.content) : '')
    .reduce((longest, content) => content.length > longest.length ? content : longest, '');
};

const extractQwenResponseId = (data) => data && data.communication && (
  data.communication.reqid || data.communication.sessionid
);

const parseSseEvent = (eventBlock) => {
  const dataLines = eventBlock.split(/\r?\n/).filter((line) => line.startsWith('data:'));
  if (dataLines.length === 0) return null;
  const raw = dataLines.map((line) => line.slice(5).trim()).join('\n');
  if (!raw || raw === '[DONE]') return null;
  try {
    return JSON.parse(raw);
  } catch {
    // 上游偶尔会发送非 JSON 心跳，忽略该事件并继续读取后续内容。
    return null;
  }
};

const parseSseEvents = async function* (source) {
  let buffer = '';
  for await (const chunk of source) {
    buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || '';
    for (const block of blocks) {
      const parsed = parseSseEvent(block);
      if (parsed) yield parsed;
    }
  }
  const parsed = parseSseEvent(buffer);
  if (parsed) yield parsed;
};

const parseGrpcEvents = async function* (source, headers) {
  let buffer = Buffer.alloc(0);
  for await (const chunk of decompressStream(source, headers)) {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    while (buffer.length >= 5) {
      const length = buffer.readUInt32BE(1);
      if (buffer.length < length + 5) break;
      const payload = buffer.subarray(5, length + 5).toString('utf8');
      buffer = buffer.subarray(length + 5);
      try {
        const data = JSON.parse(payload);
        yield data;
      } catch {
        // Kimi 可能发送心跳或非 JSON 帧，跳过后继续解析后续帧。
      }
    }
  }
};

const decompressStream = (source, headers = {}) => {
  const encoding = String(headers['content-encoding'] || headers['Content-Encoding'] || '').toLowerCase().trim();
  if (encoding === 'gzip' || encoding === 'x-gzip') return source.pipe(createGunzip());
  if (encoding === 'deflate') return source.pipe(createInflate());
  if (encoding === 'br') return source.pipe(createBrotliDecompress());
  return source;
};

const parseSseStream = async function* (source, model, providerId, headers, responseSession) {
  let qwenContent = '';
  let providerContent = '';
  const events = providerId === 'kimi' ? parseGrpcEvents(source, headers) : parseSseEvents(decompressStream(source, headers));
  for await (const data of events) {
    updateNativeState(data, providerId, responseSession);
    if (providerId === 'qwen') {
      const currentContent = extractQwenContent(data);
      if (currentContent === null || currentContent.length <= qwenContent.length) continue;
      const delta = currentContent.slice(qwenContent.length);
      qwenContent = currentContent;
      yield {
        id: extractQwenResponseId(data) || `chatcmpl-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
      };
      continue;
    }
    if (NATIVE_REQUEST_BUILDERS[providerId]) {
      const currentContent = extractNativeProviderContent(data, providerId);
      if (currentContent === null || currentContent.length <= providerContent.length) continue;
      const delta = currentContent.slice(providerContent.length);
      providerContent = currentContent;
      yield {
        id: extractNativeProviderId(data, providerId) || `chatcmpl-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
      };
      continue;
    }
    const parsed = asOpenAiChunk(data, model);
    if (parsed) yield parsed;
  }
};

const extractNativeProviderId = (data, providerId) => {
  if (!data || typeof data !== 'object') return null;
  const ids = {
    deepseek: data.response_message_id,
    glm: data.conversation_id,
    kimi: data.chat && data.chat.id,
    mimo: data.dialogId || data.conversationId,
    minimax: data.data && data.data.messageResult && (data.data.messageResult.chat_id || data.data.messageResult.chatID),
    perplexity: data.backend_uuid || data.request_id,
    'qwen-ai': data.id || data.response_id,
    zai: data.data && data.data.id,
  };
  return ids[providerId] || null;
};

const updateNativeState = (data, providerId, responseSession) => {
  if (!responseSession || !responseSession.nativeState) return;
  const nativeState = responseSession.nativeState;
  if (providerId === 'qwen') {
    const communication = data && data.communication;
    if (communication && communication.sessionid) nativeState.sessionId = communication.sessionid;
    if (communication && communication.reqid) nativeState.parentReqId = communication.reqid;
    return;
  }
  const id = extractNativeProviderId(data, providerId);
  if (!id) return;
  const stateFields = {
    deepseek: 'parentMessageId',
    glm: 'conversationId',
    kimi: 'chatId',
    mimo: 'conversationId',
    minimax: 'chatId',
    perplexity: 'threadId',
    'qwen-ai': 'parentId',
    zai: 'parentMessageId',
  };
  const field = stateFields[providerId];
  if (field && !nativeState[field]) nativeState[field] = id;
  if (providerId === 'glm' && data.conversation_id) nativeState.conversationId = data.conversation_id;
  if (providerId === 'mimo' && data.conversationId) nativeState.conversationId = data.conversationId;
  if (providerId === 'minimax' && id) nativeState.chatId = id;
  if (providerId === 'qwen-ai' && data.chat_id) nativeState.chatId = data.chat_id;
  if (providerId === 'zai' && data.data && data.data.chat_id) nativeState.chatId = data.data.chat_id;
};

const extractNativeProviderContent = (data, providerId) => {
  if (!data || typeof data !== 'object') return null;
  if (providerId === 'deepseek') {
    if (typeof data.v === 'string') return data.v;
    if (data.v && data.v.response && Array.isArray(data.v.response.fragments)) return data.v.response.fragments.map((fragment) => fragment.content || '').join('');
    if (Array.isArray(data.v)) return data.v.map((item) => item && item.v && item.v.content || '').join('');
    return null;
  }
  if (providerId === 'glm') {
    const parts = Array.isArray(data.parts) ? data.parts : [];
    return parts.flatMap((part) => Array.isArray(part.content) ? part.content : []).filter((item) => item && item.type === 'text').map((item) => item.text || '').join('');
  }
  if (providerId === 'kimi') return data.block && data.block.text ? data.block.text.content || '' : null;
  if (providerId === 'mimo') return typeof data.content === 'string' && (data.type === 'message' || data.type === 'text') ? data.content : null;
  if (providerId === 'minimax') return data.data && data.data.messageResult ? data.data.messageResult.content || '' : null;
  if (providerId === 'perplexity') return data.text || data.answer || data.content || data.output || null;
  if (providerId === 'qwen-ai') return data.choices && data.choices[0] && data.choices[0].delta ? data.choices[0].delta.content || '' : null;
  if (providerId === 'zai') return data.type === 'chat:completion' && data.data && data.data.phase === 'answer' ? data.data.delta_content || '' : null;
  return null;
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

const createQwenBody = (content, model, id) => ({
  id: id || `chatcmpl-${Date.now()}`,
  object: 'chat.completion',
  created: Math.floor(Date.now() / 1000),
  model,
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
});

const normalizeQwenBody = async (data, model, headers, responseSession) => {
  if (!data || typeof data[Symbol.asyncIterator] !== 'function') {
    updateNativeState(data, 'qwen', responseSession);
    return createQwenBody(extractQwenContent(data) || '', model, extractQwenResponseId(data));
  }
  let content = '';
  let id;
  for await (const event of parseSseEvents(decompressStream(data, headers))) {
    updateNativeState(event, 'qwen', responseSession);
    id = extractQwenResponseId(event) || id;
    const currentContent = extractQwenContent(event);
    if (currentContent !== null && currentContent.length > content.length) content = currentContent;
  }
  return createQwenBody(content.trim(), model, id);
};

const normalizeNativeBody = async (data, model, providerId, headers, responseSession) => {
  if (!data || typeof data[Symbol.asyncIterator] !== 'function') {
    updateNativeState(data, providerId, responseSession);
    return normalizeBody(data, model);
  }
  let content = '';
  let id;
  const events = providerId === 'kimi' ? parseGrpcEvents(data, headers) : parseSseEvents(decompressStream(data, headers));
  for await (const event of events) {
    updateNativeState(event, providerId, responseSession);
    id = extractNativeProviderId(event, providerId) || id;
    const current = extractNativeProviderContent(event, providerId);
    if (typeof current === 'string') {
      content = current.length >= content.length ? current : `${content}${current}`;
    }
  }
  return createQwenBody(content.trim(), model, id);
};

const createQwenAiChat = async (httpClient, provider, headers, account, actualModel) => {
  const credentials = getCredentials(account);
  const response = await httpClient.request({
    method: 'POST',
    url: `${getProviderOrigin(provider, 'https://chat.qwen.ai')}/api/v2/chats/new`,
    data: { title: 'OpenAI_API_Chat', models: [actualModel], chat_mode: 'normal', chat_type: 't2t', timestamp: Date.now(), project_id: '' },
    headers: { ...headers, Authorization: `Bearer ${getProviderToken(account)}`, Cookie: credentials.cookies || credentials.cookie || headers.Cookie || '' },
    responseType: 'json',
    timeout: 30_000,
    validateStatus: () => true,
  });
  const chatId = response.data && response.data.data && response.data.data.id;
  if (response.status < 200 || response.status >= 300 || !chatId) throw new Error(`Qwen AI 创建会话失败: HTTP ${response.status}`);
  return chatId;
};

const createZaiChat = async (httpClient, provider, headers, account, actualModel) => {
  const token = getProviderToken(account);
  const messageId = createRequestId();
  const response = await httpClient.request({
    method: 'POST',
    url: `${getProviderOrigin(provider, 'https://chat.z.ai')}/api/v1/chats/new`,
    data: { chat: { id: '', title: '新聊天', models: [actualModel], params: {}, history: { messages: {}, currentId: '' }, tags: [], flags: [], features: [{ type: 'tool_selector', server: 'tool_selector_h', status: 'hidden' }], mcp_servers: [], enable_thinking: true, auto_web_search: false, message_version: 1, extra: {}, timestamp: Date.now(), type: 'default' } },
    headers: { ...headers, Authorization: `Bearer ${token}`, Cookie: `token=${token}` },
    responseType: 'json',
    timeout: 30_000,
    validateStatus: () => true,
  });
  const chatId = response.data && (response.data.id || response.data.data && response.data.data.id);
  if (response.status < 200 || response.status >= 300 || !chatId) throw new Error(`Z.ai 创建会话失败: HTTP ${response.status}`);
  return { chatId, messageId };
};

const refreshGlmToken = async (httpClient, provider, headers, account) => {
  const refreshToken = getCredentials(account).refresh_token || getCredentials(account).refreshToken || getCredentials(account).token || '';
  if (!refreshToken) return account;
  const timestamp = String(Date.now());
  const nonce = createRequestId();
  const sign = createHash('md5').update(`${timestamp}-${nonce}-8a1317a7468aa3ad86e997d08f3f31cb`).digest('hex');
  const response = await httpClient.request({
    method: 'POST',
    url: `${getProviderOrigin(provider, 'https://chatglm.cn')}/chatglm/user-api/user/refresh`,
    data: {},
    headers: { ...headers, Authorization: `Bearer ${refreshToken}`, 'X-Device-Id': createRequestId(), 'X-Nonce': nonce, 'X-Request-Id': createRequestId(), 'X-Sign': sign, 'X-Timestamp': timestamp },
    responseType: 'json',
    timeout: 15_000,
    validateStatus: () => true,
  });
  const refreshed = response.data && response.data.result && response.data.result.access_token;
  if (response.status < 200 || response.status >= 300 || !refreshed) throw new Error(`GLM Token 刷新失败: HTTP ${response.status}`);
  return { ...account, credentials: { ...getCredentials(account), accessToken: refreshed } };
};

const saveMimoConversation = async (httpClient, provider, headers, account, conversationId) => {
  const credentials = getCredentials(account);
  const phToken = credentials.ph_token || credentials.phToken || '';
  const response = await httpClient.request({
    method: 'POST',
    url: `${getProviderOrigin(provider, 'https://aistudio.xiaomimimo.com')}/open-apis/chat/conversation/save?xiaomichatbot_ph=${encodeURIComponent(phToken)}`,
    data: { conversationId, title: '新对话', type: 'chat' },
    headers,
    responseType: 'json',
    timeout: 30_000,
    validateStatus: () => true,
  });
  if (response.status < 200 || response.status >= 300 || (response.data && response.data.code !== undefined && response.data.code !== 0)) throw new Error(`MiMo 保存会话失败: HTTP ${response.status}`);
};

const registerMiniMaxDevice = async (httpClient, provider, headers, account) => {
  const credentials = getCredentials(account);
  const token = getProviderToken(account);
  const realUserId = credentials.realUserID || credentials.real_user_id || (() => {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      return payload.user && payload.user.id || payload.user_id || payload.sub || 'guest';
    } catch {
      return 'guest';
    }
  })();
  const deviceUuid = randomUUID();
  const unix = String(Date.now());
  const timestamp = Math.floor(Date.now() / 1000);
  const query = new URLSearchParams({ device_platform: 'web', biz_id: '3', app_id: '3001', version_code: '22201', uuid: deviceUuid, user_id: realUserId, unix, lang: 'zh', token, client: 'web' });
  const path = `/v1/api/user/device/register?${query.toString()}`;
  const data = { uuid: deviceUuid };
  const dataJson = JSON.stringify(data);
  const yy = createHash('md5').update(`${encodeURIComponent(path)}_${dataJson}${createHash('md5').update(unix).digest('hex')}ooui`).digest('hex');
  const signature = createHash('md5').update(`${timestamp}${token}${dataJson}`).digest('hex');
  const response = await httpClient.request({
    method: 'POST',
    url: `${getProviderOrigin(provider, 'https://agent.minimaxi.com')}${path}`,
    data,
    headers: { ...headers, token, 'x-timestamp': String(timestamp), 'x-signature': signature, yy },
    responseType: 'json',
    timeout: 15_000,
    validateStatus: () => true,
  });
  const deviceId = response.data && response.data.data && response.data.data.deviceIDStr;
  if (response.status < 200 || response.status >= 300 || (response.data && response.data.statusInfo && response.data.statusInfo.code !== 0) || !deviceId) throw new Error(`MiniMax 设备注册失败: HTTP ${response.status}`);
  return { ...account, credentials: { ...credentials, realUserID: response.data.data.realUserID || realUserId, deviceId } };
};

const createDeepSeekSession = async (httpClient, provider, headers, account) => {
  const token = getProviderToken(account);
  const response = await httpClient.request({
    method: 'POST',
    url: `${getProviderOrigin(provider, 'https://chat.deepseek.com')}/api/v0/chat_session/create`,
    data: {},
    headers: { ...headers, Authorization: `Bearer ${token}` },
    responseType: 'json',
    timeout: 15_000,
    validateStatus: () => true,
  });
  const data = response.data && (response.data.data && response.data.data.biz_data || response.data.biz_data);
  const sessionId = data && data.chat_session && data.chat_session.id || data && data.id;
  if (response.status < 200 || response.status >= 300 || !sessionId) throw new Error(`DeepSeek 创建会话失败: HTTP ${response.status}`);
  return sessionId;
};

const solveDeepSeekChallenge = async (challenge) => {
  if (!challenge || challenge.algorithm !== 'DeepSeekHashV1') throw new Error('DeepSeek 返回了不支持的 PoW 算法');
  if (!deepSeekWasmPromise) {
    deepSeekWasmPromise = fs.readFile(path.join(__dirname, 'assets', 'sha3_wasm_bg.7b9ca65ddd.wasm'))
      .then((buffer) => WebAssembly.instantiate(buffer, { wbg: {} }))
      .then(({ instance }) => instance.exports);
  }
  const wasm = await deepSeekWasmPromise;
  const encode = (value) => {
    const bytes = Buffer.from(value, 'utf8');
    const pointer = wasm.__wbindgen_export_0(bytes.length, 1) >>> 0;
    new Uint8Array(wasm.memory.buffer).subarray(pointer, pointer + bytes.length).set(bytes);
    return { pointer, length: bytes.length };
  };
  const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
  try {
    const challengeText = encode(challenge.challenge);
    const prefix = encode(`${challenge.salt}_${challenge.expire_at}_`);
    wasm.wasm_solve(retptr, challengeText.pointer, challengeText.length, prefix.pointer, prefix.length, challenge.difficulty);
    const view = new DataView(wasm.memory.buffer);
    if (view.getInt32(retptr, true) === 0) throw new Error('DeepSeek PoW 计算失败');
    return view.getFloat64(retptr + 8, true);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
};

const createDeepSeekPowResponse = async (httpClient, provider, headers, account) => {
  const token = getProviderToken(account);
  const response = await httpClient.request({
    method: 'POST',
    url: `${getProviderOrigin(provider, 'https://chat.deepseek.com')}/api/v0/chat/create_pow_challenge`,
    data: { target_path: '/api/v0/chat/completion' },
    headers: { ...headers, Authorization: `Bearer ${token}` },
    responseType: 'json',
    timeout: 15_000,
    validateStatus: () => true,
  });
  const challenge = response.data && (response.data.data && response.data.data.biz_data && response.data.data.biz_data.challenge || response.data.biz_data && response.data.biz_data.challenge);
  if (response.status < 200 || response.status >= 300 || !challenge) throw new Error(`DeepSeek 获取 PoW 挑战失败: HTTP ${response.status}`);
  const answer = await solveDeepSeekChallenge(challenge);
  return Buffer.from(JSON.stringify({ ...challenge, answer, target_path: '/api/v0/chat/completion' })).toString('base64');
};

const prepareNativeRequest = async ({ httpClient, providerId, provider, account, request, actualModel, headers, responseSession }) => {
  const nativeState = getNativeState(responseSession);
  let preparedAccount = account;
  if (providerId === 'glm') preparedAccount = await refreshGlmToken(httpClient, provider, headers, account);
  if (providerId === 'minimax') preparedAccount = await registerMiniMaxDevice(httpClient, provider, headers, account);
  if (providerId === 'deepseek') {
    const sessionId = nativeState.sessionId || await createDeepSeekSession(httpClient, provider, headers, account);
    if (responseSession && !nativeState.sessionId) nativeState.sessionId = sessionId;
    const powResponse = getCredentials(account).powResponse || await createDeepSeekPowResponse(httpClient, provider, headers, account);
    return NATIVE_REQUEST_BUILDERS[providerId](request, actualModel, provider, headers, account, sessionId, powResponse, responseSession);
  }
  if (providerId === 'mimo') {
    const hasConversation = Boolean(nativeState.conversationId);
    const conversationId = nativeState.conversationId || randomUUID().replaceAll('-', '');
    if (responseSession && !nativeState.conversationId) nativeState.conversationId = conversationId;
    if (!hasConversation) await saveMimoConversation(httpClient, provider, headers, account, conversationId);
    request = { ...request, nativeConversationId: conversationId };
  }
  if (providerId === 'qwen-ai') {
    const chatId = nativeState.chatId || await createQwenAiChat(httpClient, provider, headers, preparedAccount, actualModel);
    if (responseSession && !nativeState.chatId) nativeState.chatId = chatId;
    return NATIVE_REQUEST_BUILDERS[providerId](request, actualModel, provider, headers, preparedAccount, chatId, responseSession);
  }
  if (providerId === 'zai') {
    const chat = nativeState.chatId
      ? { chatId: nativeState.chatId, messageId: createRequestId() }
      : await createZaiChat(httpClient, provider, headers, preparedAccount, actualModel);
    if (responseSession && !nativeState.chatId) nativeState.chatId = chat.chatId;
    return NATIVE_REQUEST_BUILDERS[providerId](request, actualModel, provider, headers, preparedAccount, chat.chatId, chat.messageId, responseSession);
  }
  return NATIVE_REQUEST_BUILDERS[providerId](request, actualModel, provider, headers, preparedAccount, responseSession);
};

const createProviderAdapter = ({ httpClient, providerId, rawTrafficLogger, getConfig }) => async ({ request, account, provider, actualModel, context = {}, responseSession }) => {
  let currentConfig = {};
  if (rawTrafficLogger && typeof getConfig === 'function') {
    try {
      currentConfig = await getConfig();
    } catch {
      // 调试配置读取失败时按关闭处理，不能让日志功能阻断正常 Provider 请求。
      currentConfig = {};
    }
  }
  const tracedHttpClient = rawTrafficLogger
    ? rawTrafficLogger.createHttpClient({
      httpClient,
      providerId,
      context,
      enabled: currentConfig && currentConfig.debugRawTraffic === true,
      maxBytes: currentConfig && currentConfig.rawTrafficMaxBytes,
    })
    : httpClient;
  const isQwen = providerId === 'qwen';
  const headers = buildProviderHeaders(provider, account, providerId);
  const qwenRequest = isQwen ? createQwenRequest(request, actualModel, provider, headers, responseSession) : null;
  const nativeRequest = !isQwen && NATIVE_REQUEST_BUILDERS[providerId]
    ? await prepareNativeRequest({ httpClient: tracedHttpClient, providerId, provider, account, request, actualModel, headers, responseSession })
    : null;
  const response = await tracedHttpClient.request({
    method: 'POST',
    url: qwenRequest ? qwenRequest.url : nativeRequest ? nativeRequest.url : `${String(provider.apiEndpoint).replace(/\/$/, '')}${provider.chatPath || '/v1/chat/completions'}`,
    data: qwenRequest ? qwenRequest.data : nativeRequest ? nativeRequest.data : buildRequestBody(request, actualModel),
    headers: qwenRequest ? qwenRequest.headers : nativeRequest ? nativeRequest.headers : headers,
    responseType: providerId === 'minimax' ? 'json' : isQwen || nativeRequest || request.stream === true ? 'stream' : 'json',
    decompress: isQwen || nativeRequest ? false : undefined,
    timeout: 120_000,
    validateStatus: () => true,
  });
  if (response.status < 200 || response.status >= 300) {
    const error = new Error(`Provider HTTP ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }
  if (providerId === 'minimax' && response.data && typeof response.data[Symbol.asyncIterator] !== 'function') {
    const initial = getMiniMaxAnswer(response.data);
    if (initial.chatId) {
      if (responseSession && responseSession.nativeState) responseSession.nativeState.chatId = initial.chatId;
      if (request.stream === true) return { stream: createMiniMaxPollingStream(tracedHttpClient, provider, nativeRequest.headers, account, initial.chatId, request.model), nativeState: responseSession?.nativeState || {} };
      const answer = await pollMiniMaxAnswer(tracedHttpClient, provider, nativeRequest.headers, account, initial.chatId);
      if (responseSession && responseSession.nativeState) responseSession.nativeState.chatId = initial.chatId;
      return { body: createQwenBody(answer.content, request.model, initial.chatId), nativeState: responseSession?.nativeState || {} };
    }
  }
  if (request.stream === true) {
    const source = response.data && typeof response.data[Symbol.asyncIterator] === 'function' ? response.data : Readable.from([JSON.stringify(response.data)]);
    return { stream: parseSseStream(source, request.model, providerId, response.headers, responseSession), nativeState: responseSession?.nativeState || {} };
  }
  if (isQwen) return { body: await normalizeQwenBody(response.data, request.model, response.headers, responseSession), nativeState: responseSession?.nativeState || {} };
  if (nativeRequest) return { body: await normalizeNativeBody(response.data, request.model, providerId, response.headers, responseSession), nativeState: responseSession?.nativeState || {} };
  return { body: normalizeBody(response.data, request.model), nativeState: responseSession?.nativeState || {} };
};

const createChat2ApiProviderAdapters = ({ httpClient = axios, rawTrafficLogger, getConfig } = {}) => Object.fromEntries(PROVIDER_IDS.map((providerId) => [providerId, createProviderAdapter({ httpClient, providerId, rawTrafficLogger, getConfig })]));

module.exports = { PROVIDER_IDS, createChat2ApiProviderAdapters, buildProviderHeaders, buildRequestBody, createQwenRequest, parseSseStream };
