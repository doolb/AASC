const axios = require('axios');
const { randomUUID, createHash } = require('crypto');
const { TextDecoder } = require('util');
const { normalizeDoubaoNodeProfile, applyDoubaoNodeProtocol } = require('./chat2api-doubao-node-protocol');
const { normalizeDoubaoCookieSnapshot, parseDoubaoCookieHeader } = require('./chat2api-doubao-cookie-snapshot');
const { normalizeDoubaoRequestProfile } = require('./chat2api-doubao-request-profile');
const { createDoubaoHttp2Client } = require('./chat2api-doubao-http2-client');
const { createDoubaoSessionFlow } = require('./chat2api-doubao-session');
const { createDoubaoAndroidBridge } = require('./chat2api-doubao-android-bridge');

// 豆包网页凭据只能发送到这个固定来源；不使用 Provider 自定义头、路径、查询参数或代理。
const DOUBAO_ORIGIN = 'https://www.doubao.com';
const DOUBAO_COMPLETION_URL = `${DOUBAO_ORIGIN}/chat/completion`;
const DOUBAO_MODEL_MODES = Object.freeze({ doubao: 0, 'doubao-think': 1, 'doubao-expert': 3 });
const DOUBAO_LIMITS = Object.freeze({
  timeoutMs: 120_000,
  requestBytes: 256 * 1024,
  streamBytes: 8 * 1024 * 1024,
  eventBytes: 512 * 1024,
  outputBytes: 2 * 1024 * 1024,
  events: 20_000,
  blocks: 2048,
});
// 仅接受参考协议明确使用的名称。用户可以提供这些字段组成的最小 Cookie，不能猜测未知字段的用途。
const COOKIE_NAMES = new Set(['sessionid', 'passport_csrf_token', 'passport_csrf_token_default', 'msToken', 'ttwid', 's_v_web_id']);
const ERROR_DEFINITIONS = Object.freeze({
  doubao_node_profile_required: [422, '该豆包账号缺少Node直连资料，请重新登录豆包并完成账号保存'],
  doubao_account_conflict: [422, '豆包模型与指定Provider或账号不一致，请检查模型映射'],
  doubao_invalid_credentials: [422, '豆包 Cookie 或 CSRF 格式无效，请检查网页登录凭据'],
  doubao_invalid_provider: [422, '豆包网页 Provider 仅允许固定官方 HTTPS 来源'],
  doubao_unsupported_model: [400, '豆包网页不支持该文字模型模式'],
  doubao_text_only: [400, '豆包网页适配器仅支持纯文字，不支持多模态或原生工具调用'],
  doubao_invalid_request: [400, '豆包文字请求格式无效或缺少用户文字'],
  doubao_request_too_large: [413, '豆包文字请求超过容量限制'],
  doubao_auth_expired: [401, '豆包网页登录已失效，请在官网重新登录'],
  doubao_risk_control: [403, '豆包网页要求安全验证，请在官网处理后重试'],
  doubao_rate_limited: [429, '豆包网页请求过于频繁，请稍后重试'],
  doubao_cancelled: [499, '豆包文字请求已取消'],
  doubao_timeout: [504, '豆包文字请求超时'],
  doubao_stream_limit: [502, '豆包网页响应超过安全容量限制'],
  doubao_protocol_error: [502, '豆包网页返回了无法安全解析的响应'],
  doubao_incomplete_response: [502, '豆包网页响应未完整结束，请稍后重试'],
  doubao_empty_response: [502, '豆包网页未返回有效文字'],
  doubao_upstream_failed: [502, '豆包网页请求失败，请稍后重试'],
  doubao_session_conflict: [409, '豆包会话的账号、登录身份或模式不匹配，请新建会话'],
  doubao_session_uncertain: [409, '豆包上游会话位置已不确定，请新建会话'],
  doubao_browser_disabled: [503, '豆包网页任务尚未启动，请启动 doubao.web 后重试'],
  doubao_android_prepare: [502, 'Android豆包当次签名生成失败，请更新APK或重新登录后重试'],
  doubao_android_unavailable: [503, 'Android豆包签名服务未就绪，请安装最新min APK'],
  doubao_android_webview: [503, 'Android豆包网页未登录或签名接口不可用，请更新APK或重新登录'],
});

/** 所有异常都来自固定白名单；绝不把 Axios 对象、上游错误正文或签名 URL 放进 message/cause。 */
const doubaoError = (code) => {
  const [statusCode, message] = ERROR_DEFINITIONS[code] || ERROR_DEFINITIONS.doubao_upstream_failed;
  return Object.assign(new Error(message), { statusCode, code: ERROR_DEFINITIONS[code] ? code : 'doubao_upstream_failed' });
};

/**
 * 账号秘密允许既有 credentials.cookie 及显式 Node 模式的 nodeProfile。严格检查长度和来源，
 * CSRF 必须从 Cookie 自身取得，禁止用独立字段或 Provider headers 覆盖，更不能静默忽略非法片段。
 */
const normalizeDoubaoCredentials = (credentials) => {
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)
    || Object.keys(credentials).some((key) => !['cookie', 'nodeProfile', 'cookieSnapshot', 'requestProfile'].includes(key))) throw doubaoError('doubao_invalid_credentials');
  const source = credentials.cookie;
  if (typeof source !== 'string' || source.length === 0 || source.length > 16 * 1024
    || /[^\x20-\x7E]/u.test(source)) throw doubaoError('doubao_invalid_credentials');
  const cookies = new Map();
  for (const segment of source.split(';')) {
    const part = segment.trim();
    const separator = part.indexOf('=');
    if (separator < 1) throw doubaoError('doubao_invalid_credentials');
    const name = part.slice(0, separator);
    const value = part.slice(separator + 1);
    if (!COOKIE_NAMES.has(name) || cookies.has(name) || !value || value.length > 4096
      || !/^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]+$/u.test(value)) throw doubaoError('doubao_invalid_credentials');
    cookies.set(name, value);
  }
  const sessionId = cookies.get('sessionid') || '';
  const csrf = cookies.get('passport_csrf_token') || cookies.get('passport_csrf_token_default') || '';
  if (!/^[a-zA-Z0-9_-]{16,512}$/u.test(sessionId) || !/^[a-zA-Z0-9_-]{16,128}$/u.test(csrf)) {
    throw doubaoError('doubao_invalid_credentials');
  }
  // 两个同名用途的 CSRF Cookie 同时存在时也必须各自合法，防止备用字段携带注入内容。
  for (const name of ['passport_csrf_token', 'passport_csrf_token_default']) {
    if (cookies.has(name) && !/^[a-zA-Z0-9_-]{16,128}$/u.test(cookies.get(name))) throw doubaoError('doubao_invalid_credentials');
  }
  const nodeProfile = Object.hasOwn(credentials, 'nodeProfile') ? normalizeDoubaoNodeProfile(credentials.nodeProfile) : undefined;
  // fp 与 Cookie 必须来自同一账号的同一设备，不能把另一个登录上下文的资料拼入当前账号。
  if (nodeProfile && nodeProfile.fp !== cookies.get('s_v_web_id')) throw doubaoError('doubao_invalid_credentials');
  const cookieSnapshot = Object.hasOwn(credentials, 'cookieSnapshot')
    ? normalizeDoubaoCookieSnapshot(credentials.cookieSnapshot) : undefined;
  if (cookieSnapshot) {
    const webCookies = parseDoubaoCookieHeader(cookieSnapshot[DOUBAO_ORIGIN]);
    // 快照与规范身份资料必须属于同一登录，否则拒绝拼接跨账号 Cookie。
    for (const name of ['sessionid', 's_v_web_id']) {
      const expected = cookies.get(name);
      if (expected && !webCookies.some(item => item.name === name && item.value === expected)) throw doubaoError('doubao_invalid_credentials');
    }
  }
  const requestProfile = Object.hasOwn(credentials, 'requestProfile')
    ? normalizeDoubaoRequestProfile(credentials.requestProfile) : undefined;
  if (requestProfile) {
    if (!nodeProfile) throw doubaoError('doubao_invalid_credentials');
    const query = new Map(requestProfile.query);
    if (query.get('device_id') !== nodeProfile.deviceId || query.get('web_id') !== nodeProfile.webId
      || query.get('fp') !== nodeProfile.fp
      || (requestProfile.headers['user-agent'] && requestProfile.headers['user-agent'] !== nodeProfile.userAgent)) {
      throw doubaoError('doubao_invalid_credentials');
    }
  }
  return { cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; '),
    ...(nodeProfile ? { nodeProfile } : {}), ...(cookieSnapshot ? { cookieSnapshot } : {}),
    ...(requestProfile ? { requestProfile } : {}) };
};

const assertDoubaoProvider = (provider) => {
  if (!provider || (provider.id || provider.providerId) !== 'doubaochat' || provider.enabled === false
    || (provider.apiEndpoint !== undefined && provider.apiEndpoint !== DOUBAO_ORIGIN)
    || (provider.chatPath !== undefined && provider.chatPath !== '/chat/completion')) throw doubaoError('doubao_invalid_provider');
};

/** 保留角色边界并明确拒绝非文字部件；共享工具层已转换的文字标签仍只是文字，不代表网页原生工具。 */
const getRequestText = (request, limits, rawSingleUser = false) => {
  if (!request || !Array.isArray(request.messages) || request.messages.length === 0 || request.messages.length > 1024) {
    throw doubaoError('doubao_invalid_request');
  }
  if ((request.tools !== undefined && (!Array.isArray(request.tools) || request.tools.length > 0))
    || (request.tool_choice !== undefined && request.tool_choice !== 'none') || request.functions !== undefined
    || request.function_call !== undefined || request.audio !== undefined || request.modalities !== undefined) throw doubaoError('doubao_text_only');
  let hasUserText = false;
  let bytes = 0;
  const parts = request.messages.map((message) => {
    if (!message || typeof message !== 'object' || !['system', 'developer', 'user', 'assistant', 'tool'].includes(message.role)) {
      throw doubaoError('doubao_invalid_request');
    }
    if (message.tool_calls || message.function_call) throw doubaoError('doubao_text_only');
    const content = message.content;
    let text;
    if (typeof content === 'string') text = content;
    else if (Array.isArray(content)) {
      text = content.map((part) => {
        if (!part || !['text', 'input_text', 'output_text'].includes(part.type) || typeof part.text !== 'string') throw doubaoError('doubao_text_only');
        return part.text;
      }).join('\n');
    } else throw doubaoError('doubao_invalid_request');
    if (message.role === 'user' && text.trim()) hasUserText = true;
    bytes += Buffer.byteLength(text, 'utf8');
    if (bytes > limits.requestBytes) throw doubaoError('doubao_request_too_large');
    const role = { system: 'System', developer: 'System', user: 'User', assistant: 'Assistant', tool: 'Tool' }[message.role];
    return `${role}: ${text}`;
  });
  if (!hasUserText) throw doubaoError('doubao_invalid_request');
  // 官网单条用户首轮直接发送原文；多角色历史仍保留明确边界。
  return rawSingleUser && request.messages.length === 1 && request.messages[0].role === 'user'
    ? (typeof request.messages[0].content === 'string' ? request.messages[0].content : request.messages[0].content.map(part => part.text).join('\n'))
    : parts.join('\n\n');
};

/**
 * 普通Node模式已有两轮增量记忆正例，由内部nativeSession选择续接；旧观测状态、网页
 * 模式及其它模式继续新建并重放调用方历史，不凭一个裸conversationId宣称原生能力。
 */
const buildDoubaoRequest = ({ request, account, provider, actualModel, limits = DOUBAO_LIMITS, nativeSession }) => {
  assertDoubaoProvider(provider);
  const credentials = normalizeDoubaoCredentials(account && account.credentials);
  if (!credentials.nodeProfile) throw doubaoError('doubao_node_profile_required');
  const model = actualModel || request.model;
  if (!Object.hasOwn(DOUBAO_MODEL_MODES, model)) throw doubaoError('doubao_unsupported_model');
  const text = getRequestText(request, limits, model === 'doubao');
  const requestCookie = credentials.cookieSnapshot?.[DOUBAO_ORIGIN] || credentials.cookie;
  const cookieMap = new Map(parseDoubaoCookieHeader(requestCookie).map(({ name, value }) => [name, value]));
  const mode = DOUBAO_MODEL_MODES[model];
  const data = {
    client_meta: {
      local_conversation_id: `local_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
      conversation_id: '', bot_id: '7338286299411103781', last_section_id: '', last_message_index: null,
    },
    messages: [{
      local_message_id: randomUUID(), message_status: 0,
      content_block: [{
        block_type: 10000, block_id: randomUUID(), parent_id: '', meta_info: [], append_fields: [],
        content: { text_block: { text, icon_url: '', icon_url_dark: '', summary: '' }, pc_event_block: '' },
      }],
    }],
    option: {
      send_message_scene: '', create_time_ms: Date.now(), collect_id: '',
      is_audio: false, answer_with_suggest: false, tts_switch: false, need_deep_think: mode,
      click_clear_context: false, from_suggest: false, is_regen: false, is_replace: false,
      disable_sse_cache: false, select_text_action: '', resend_for_regen: false, scene_type: 0,
      unique_key: randomUUID(), start_seq: 0, need_create_conversation: true,
      conversation_init_option: { need_ack_conversation: true },
      regen_query_id: [], edit_query_id: [], regen_instruction: '', no_replace_for_regen: false,
      message_from: 0, shared_app_name: '', shared_app_id: '', is_ai_playground: false,
      support_lazy_fetch_stream: true,
      // 当次网页捕获为 false，但仍出现 CHUNK_DELTA；不将此值解释为所有版本的通用开关语义。
      sse_recv_event_options: { support_chunk_delta: false },
    },
    ext: { use_deep_think: String(mode), collection_id: '', commerce_credit_config_enable: '0', sub_conv_firstmet_type: '1' },
  };
  if (nativeSession) {
    Object.assign(data.client_meta, { conversation_id: nativeSession.conversationId, local_conversation_id: '', last_section_id: '', last_message_index: null });
    data.option.need_create_conversation = false;
    data.ext.sub_conv_firstmet_type = '0';
  }
  const nodeProtocol = applyDoubaoNodeProtocol({ data, profile: credentials.nodeProfile, cookieMap });
  const browserFirstTurn = data.option.need_create_conversation && mode === 0;
  const requestProfile = mode === 0 ? credentials.requestProfile : null;
  if (requestProfile) {
    // 从官网样本复制不含消息的结构；首轮新建、续聊使用权威会话，消息标识均由本轮生成。
    const template = JSON.parse(JSON.stringify(requestProfile.body));
    const currentMeta = data.client_meta;
    const currentMessage = data.messages;
    const currentOption = data.option;
    for (const key of Object.keys(data)) delete data[key];
    Object.assign(data, template);
    data.client_meta = { ...template.client_meta, conversation_id: nativeSession?.conversationId || '',
      local_conversation_id: currentMeta.local_conversation_id, last_section_id: '', last_message_index: null };
    data.messages = currentMessage;
    data.option = { ...template.option, create_time_ms: currentOption.create_time_ms,
      unique_key: currentOption.unique_key, need_create_conversation: !nativeSession,
      recovery_option: { ...(template.option.recovery_option || {}),
        req_create_time_sec: Math.floor(currentOption.create_time_ms / 1000) } };
    if (nativeSession) data.ext.sub_conv_firstmet_type = '0';
  }
  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > limits.requestBytes) throw doubaoError('doubao_request_too_large');
  const profileUrl = requestProfile && (() => {
    const params = new URLSearchParams(requestProfile.query);
    const msToken = cookieMap.get('msToken') || credentials.nodeProfile.msToken;
    if (msToken) params.set('msToken', msToken);
    return `${DOUBAO_COMPLETION_URL}?${params.toString()}`;
  })();
  return {
    method: 'POST', url: profileUrl || nodeProtocol.url, data,
    headers: {
      Cookie: requestCookie,
      ...(!browserFirstTurn ? { 'x-tt-passport-csrf-token': cookieMap.get('passport_csrf_token') || cookieMap.get('passport_csrf_token_default') } : {}),
      Accept: 'text/event-stream', 'Content-Type': 'application/json', Origin: DOUBAO_ORIGIN, Referer: `${DOUBAO_ORIGIN}/`, 'agw-js-conv': 'str',
      ...nodeProtocol.headers,
      ...(browserFirstTurn ? { Referer: `${DOUBAO_ORIGIN}/chat/` } : {}),
      ...(requestProfile ? requestProfile.headers : {}),
      ...(requestProfile && Object.hasOwn(requestProfile.headers, 'x-tt-passport-csrf-token')
        ? { 'x-tt-passport-csrf-token': cookieMap.get('passport_csrf_token') || cookieMap.get('passport_csrf_token_default') } : {}),
    },
    // 禁止重定向和环境代理；Android在发送前取得本会话官网签名，实际网络仍由Node执行。
    responseType: 'stream', maxRedirects: 0, proxy: false, timeout: limits.timeoutMs,
    ...(requestProfile ? { doubaoHttp2: true } : {}),
    maxBodyLength: limits.requestBytes, maxContentLength: limits.streamBytes, validateStatus: () => true,
  };
};

const getHeader = (headers, name) => String(Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name)?.[1] || '');
const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value);
const parseJson = (text) => {
  try { return JSON.parse(text); } catch { throw doubaoError('doubao_protocol_error'); }
};
const safeId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/u.test(value) && value !== '0' ? value : '';

/** 仅使用数值错误码分类，不读取/返回上游 msg、extra、验证码参数或任意未知错误字段。 */
const getUpstreamError = (data, event = '') => {
  if (!isRecord(data)) return null;
  const rawCode = data.error_code ?? data.code ?? 0;
  const code = Number(rawCode);
  if (code === 710012001 || code === 401) return doubaoError('doubao_auth_expired');
  if ([710022002, 710022004, 403].includes(code)) return doubaoError('doubao_risk_control');
  if (code === 429) return doubaoError('doubao_rate_limited');
  if (code !== 0 || ['gateway-error', 'STREAM_ERROR'].includes(event)) return doubaoError('doubao_upstream_failed');
  return null;
};

/** 增量 UTF-8 解码和完整 SSE 帧解析；未知事件忽略，但带 data 的损坏 JSON 不可冒充心跳。 */
const parseDoubaoEvents = async function* (source, limits, control) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let totalBytes = 0;
  let count = 0;
  const iterator = source[Symbol.asyncIterator]();
  const parseBlock = (block) => {
    if (Buffer.byteLength(block, 'utf8') > limits.eventBytes) throw doubaoError('doubao_stream_limit');
    let event = '';
    const data = [];
    for (const line of block.split(/\r?\n/u)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /u, ''));
    }
    if (data.length === 0) return null;
    const raw = data.join('\n');
    if (raw === '[DONE]') return { event: 'UNCONFIRMED_DONE', data: {} };
    const parsed = parseJson(raw);
    if (!isRecord(parsed)) throw doubaoError('doubao_protocol_error');
    return { event: event || parsed._event || '', data: parsed };
  };
  while (true) {
    const item = await control.wait(iterator.next());
    if (item.done) break;
    const bytes = Buffer.isBuffer(item.value) ? item.value : Buffer.from(item.value);
    totalBytes += bytes.length;
    if (totalBytes > limits.streamBytes) throw doubaoError('doubao_stream_limit');
    try { buffer += decoder.decode(bytes, { stream: true }); } catch { throw doubaoError('doubao_protocol_error'); }
    let boundary;
    while ((boundary = /\r?\n\r?\n/u.exec(buffer))) {
      const block = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary[0].length);
      count += 1;
      if (count > limits.events) throw doubaoError('doubao_stream_limit');
      const parsed = parseBlock(block);
      if (parsed) yield parsed;
    }
    if (Buffer.byteLength(buffer, 'utf8') > limits.eventBytes) throw doubaoError('doubao_stream_limit');
  }
  try { buffer += decoder.decode(); } catch { throw doubaoError('doubao_protocol_error'); }
  // 最后一帧没有空行也允许解析，但只有真正的 SSE_REPLY_END 才会完成回答。
  if (buffer.trim()) {
    count += 1;
    if (count > limits.events) throw doubaoError('doubao_stream_limit');
    const parsed = parseBlock(buffer);
    if (parsed) yield parsed;
  }
};

/**
 * 单个请求的生命周期贯穿握手和读取；Promise.race 也约束不响应 signal 的 mock/异常客户端。
 * 总超时不依赖下一片数据到达，取消时立即销毁上游流，迭代器提前 return 同样进入 finally。
 */
const createRequestControl = (signal, timeoutMs) => {
  const controller = new AbortController();
  let source;
  let stoppedError;
  let rejectStop;
  const stopped = new Promise((resolve, reject) => { rejectStop = reject; });
  stopped.catch(() => {});
  const stop = (code) => {
    if (stoppedError) return;
    stoppedError = doubaoError(code);
    controller.abort();
    if (source && typeof source.destroy === 'function') source.destroy();
    rejectStop(stoppedError);
  };
  const onAbort = () => stop('doubao_cancelled');
  const timer = setTimeout(() => stop('doubao_timeout'), timeoutMs);
  if (signal && typeof signal.addEventListener === 'function') {
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  }
  return {
    signal: controller.signal,
    attach: (value) => {
      source = value;
      if (stoppedError) {
        if (source && typeof source.destroy === 'function') source.destroy();
        throw stoppedError;
      }
    },
    cancel: () => stop('doubao_cancelled'),
    check: () => { if (stoppedError) throw stoppedError; },
    wait: async (pending) => {
      if (stoppedError) throw stoppedError;
      return Promise.race([pending, stopped]);
    },
    normalizeError: (error) => stoppedError || doubaoError(error?.code),
    cleanup: () => {
      clearTimeout(timer);
      if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort);
      controller.abort();
      if (source && typeof source.destroy === 'function') source.destroy();
    },
  };
};

const createChunk = (id, model, delta, finishReason = null) => ({
  id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model,
  choices: [{ index: 0, delta, finish_reason: finishReason }],
});

/**
 * 正文、思考和状态各走独立通道。10040 是参考协议的思考边界块；只按白名单文字块解析，
 * FULL_MSG_NOTIFY 可能是用户回显，永不当回答。累计快照只补未输出后缀，不重发 CHUNK_DELTA。
 */
const consumeDoubaoStream = async function* ({ source, model, mode, nativeState, limits, control, sessionFlow, onComplete }) {
  const id = `chatcmpl-${randomUUID().replaceAll('-', '')}`;
  const blocks = new Map();
  let activeBlock = null;
  let textChannelAllowed = true;
  let thinkingBoundaries = 0;
  // 思考/专家模式如不提供可识别边界，默认隔离为思考；宁可明确空正文失败，也不泄露思考文本。
  let inThinking = mode !== 0;
  let bodyBytes = 0;
  let content = '';
  let reasoning = '';
  let observedConversationId = '';
  let observedSectionId = '';
  const appendText = (text, channel) => {
    if (typeof text !== 'string' || !text) return null;
    const delta = text;
    bodyBytes += Buffer.byteLength(delta, 'utf8');
    if (bodyBytes > limits.outputBytes) throw doubaoError('doubao_stream_limit');
    if (channel === 'reasoning_content') reasoning += delta;
    else content += delta;
    return delta ? createChunk(id, model, { [channel]: delta }) : null;
  };
  const visitBlock = (block, snapshot = false) => {
    if (!isRecord(block)) throw doubaoError('doubao_protocol_error');
    const key = safeId(block.block_id);
    const type = Number(block.block_type);
    const previous = key && blocks.get(key);
    if (type === 10040) {
      // 官网思考流会先发送未完成的 10040，再以同一 block_id 的 is_finish=true 关闭思考。
      // 旧版两个不同边界块的流仍按成对边界处理；重复快照不能再次翻转状态。
      if (!previous) {
        thinkingBoundaries += 1;
        inThinking = thinkingBoundaries % 2 === 1;
      }
      if (block.is_finish === true) {
        inThinking = false;
        thinkingBoundaries = 0;
      }
      activeBlock = null;
      textChannelAllowed = true;
      if (key) blocks.set(key, { channel: 'reasoning_content', type });
      if (blocks.size > limits.blocks) throw doubaoError('doubao_stream_limit');
      return null;
    }
    if (type !== 10000) {
      activeBlock = null;
      textChannelAllowed = false;
      return null;
    }
    textChannelAllowed = true;
    const channel = previous?.channel || (inThinking ? 'reasoning_content' : 'content');
    const record = previous || { channel, type, text: '' };
    if (key) {
      blocks.set(key, record);
      if (blocks.size > limits.blocks) throw doubaoError('doubao_stream_limit');
    }
    activeBlock = record;
    const text = block.content?.text_block?.text;
    if (typeof text !== 'string' || !text) return null;
    if (snapshot && record.text) {
      if (record.text.startsWith(text)) return null;
      if (!text.startsWith(record.text)) throw doubaoError('doubao_protocol_error');
      const delta = text.slice(record.text.length);
      record.text = text;
      return appendText(delta, channel);
    }
    record.text += text;
    return appendText(text, channel);
  };
  try {
    for await (const { event, data } of parseDoubaoEvents(source, limits, control)) {
      const error = getUpstreamError(data, event);
      if (error) throw error;
      switch (event) {
        case 'SSE_ACK': {
          const ack = data.ack_client_meta;
          const conversationId = safeId(ack?.conversation_id);
          sessionFlow?.observe(ack?.conversation_id);
          observedConversationId = conversationId || observedConversationId;
          observedSectionId = safeId(ack?.last_section_id) || observedSectionId;
          break;
        }
        case 'FULL_MSG_NOTIFY':
          // 完整消息通知包含用户回显/会话元数据，不作为 assistant 内容。真正正文由流事件提供。
          break;
        case 'CHUNK_DELTA': {
          if (!textChannelAllowed && data.block_type === undefined) break;
          const block = safeId(data.block_id) && blocks.get(data.block_id) || activeBlock;
          const channel = block?.channel || (inThinking ? 'reasoning_content' : 'content');
          if (data.block_type !== undefined && ![10000, 10040].includes(Number(data.block_type))) break;
          if (typeof data.text !== 'string') throw doubaoError('doubao_protocol_error');
          if (block) block.text = (block.text || '') + data.text;
          const chunk = appendText(data.text, Number(data.block_type) === 10040 ? 'reasoning_content' : channel);
          if (chunk) yield chunk;
          break;
        }
        case 'STREAM_MSG_NOTIFY':
        case 'STREAM_CHUNK': {
          const snapshot = event === 'STREAM_MSG_NOTIFY';
          const message = isRecord(data.message) ? data.message : null;
          if (message && ['user', 'human'].includes(message.role)) break;
          const contentBlocks = message?.content_block || data.content?.content_block;
          if (Array.isArray(contentBlocks)) {
            for (const block of contentBlocks) {
              const chunk = visitBlock(block, true);
              if (chunk) yield chunk;
            }
          }
          const patches = data.patch_op;
          if (patches !== undefined && !Array.isArray(patches)) throw doubaoError('doubao_protocol_error');
          for (const patch of patches || []) {
            if (!isRecord(patch) || !isRecord(patch.patch_value)) throw doubaoError('doubao_protocol_error');
            const value = patch.patch_value;
            if (Array.isArray(value.content_block)) {
              for (const block of value.content_block) {
                const chunk = visitBlock(block, snapshot);
                if (chunk) yield chunk;
              }
            }
            // 102 是参考客户端的文字块增量，content 是一个 JSON 字符串而不是可回显的任意正文。
            if (Number(patch.patch_object) === 102 && typeof value.content === 'string' && textChannelAllowed) {
              const parsed = parseJson(value.content);
              const channel = activeBlock?.channel || (inThinking ? 'reasoning_content' : 'content');
              if (activeBlock) activeBlock.text = (activeBlock.text || '') + (typeof parsed.text === 'string' ? parsed.text : '');
              const chunk = appendText(parsed.text, channel);
              if (chunk) yield chunk;
            }
          }
          break;
        }
        case 'SSE_REPLY_END': {
          // 现场出现消息结束、答案结束、总结束三类通知；前两类不能提前提交原生状态。
          if (Object.hasOwn(data, 'msg_finish_attr') || Object.hasOwn(data, 'answer_finish_attr')) break;
          if (!content.trim()) throw doubaoError('doubao_empty_response');
          control.check();
          const completedSession = sessionFlow?.complete(observedConversationId);
          // 只有正文非空且收到显式结束事件才提交观测状态；失败/取消不会污染下一轮会话。
          if (observedConversationId) nativeState.observedConversationId = observedConversationId;
          if (observedSectionId) nativeState.observedSectionId = observedSectionId;
          if (completedSession) Object.assign(nativeState, completedSession);
          try { await onComplete?.(); } catch { /* 验证状态写入失败不改变已经成功的聊天结果。 */ }
          yield createChunk(id, model, {}, 'stop');
          return;
        }
        default:
          // 心跳、搜索/音频/工具描述以及未知协议事件均不作为正文；EOF 仍必须有显式结束。
          break;
      }
    }
    throw doubaoError('doubao_incomplete_response');
  } catch (error) {
    throw control.normalizeError(error);
  } finally {
    control.cleanup();
  }
};

/**
 * 签名只属于当前适配器实例，不进入会话持久化；只有成功确认的普通原生会话才可复用。
 * 有效期没有可靠的官网契约，不猜测永久有效；补发由外层统一限制次数、输出和截止时间。
 */
const createDoubaoNodeSignatureCache = () => {
  const entries = new Map();
  const invalidCodes = new Set(['doubao_auth_expired', 'doubao_risk_control',
    'doubao_session_conflict', 'doubao_session_uncertain']);
  return ({ account, responseSession, mode, sessionFlow }) => {
    const conversation = responseSession?.aascConversationId;
    const key = sessionFlow.enabled && typeof conversation === 'string' && conversation.length > 0
      && conversation.length <= 256 ? JSON.stringify([account.accountId, conversation]) : '';
    const fingerprint = key ? createHash('sha256').update(JSON.stringify([
      account.credentialRevision || '', normalizeDoubaoCredentials(account.credentials),
    ])).digest('hex') : '';
    let entry = key ? entries.get(key) : null;
    if (entry && (!sessionFlow.continuing || entry.fingerprint !== fingerprint || entry.mode !== mode
      || entry.upstreamId !== responseSession.nativeState?.conversationId)) {
      entries.delete(key);
      entry = null;
    }
    if (entry) {
      entries.delete(key);
      entries.set(key, entry);
    }
    return {
      // 每轮的正文、时间、消息标识与Cookie仍使用本轮构造结果，只复用已签名URL和SDK头。
      apply: prepared => entry ? { ...prepared, url: entry.url,
        headers: { ...entry.headers, Cookie: prepared.headers.Cookie }, doubaoHttp2: true } : null,
      complete: (prepared, state) => {
        if (!key || state.status !== 'ready' || !state.conversationId) return;
        const headers = { ...prepared.headers };
        delete headers.Cookie;
        delete headers.cookie;
        entry = { fingerprint, mode, upstreamId: state.conversationId, url: prepared.url, headers };
        entries.delete(key);
        entries.set(key, entry);
        // 固定容量的LRU避免已结束的AASC会话长期积累签名；淘汰后下次续聊重新生成。
        while (entries.size > 128) entries.delete(entries.keys().next().value);
      },
      invalidate: error => {
        // 旧请求的迟到错误不得清除同键后来成功提交的另一条记录。
        if (entry && invalidCodes.has(error?.code) && entries.get(key) === entry) entries.delete(key);
      },
      clear: () => {
        if (entry && entries.get(key) === entry) entries.delete(key);
        entry = null;
      },
    };
  };
};

/** 未走通用 rawTrafficLogger：原始网页错误可在任意字符串携带凭据，不能仅依靠键名脱敏。 */
const createDoubaoChatAdapter = ({ httpClient = axios, http2Client = createDoubaoHttp2Client(), browserBridge,
  getTransport = () => 'node-http', onChatVerified, onBrowserChatVerified, prepareNodeRequest,
  limits: customLimits = {} } = {}) => {
  // 测试可收紧容量/超时，但调用方不能放宽生产安全上限。
  const limits = Object.fromEntries(Object.entries(DOUBAO_LIMITS).map(([key, maximum]) => [key,
    Number.isSafeInteger(customLimits[key]) && customLimits[key] > 0 ? Math.min(customLimits[key], maximum) : maximum,
  ]));
  const signatureCache = createDoubaoNodeSignatureCache();
  const runAttempt = async ({ request, account, provider, actualModel, responseSession, context = {} }, execution) => {
    // 传输由任务的权威配置决定；网页路径只使用当前官网页面的同源请求。
    const accountCredentials = Object.getOwnPropertyDescriptor(account || {}, 'credentials')?.value;
    // 两次尝试共用完成态容器；ACK仍由每次尝试的临时sessionFlow验证，未完成不提交。
    const nativeState = execution.nativeState ||= responseSession?.nativeState && isRecord(responseSession.nativeState)
      ? responseSession.nativeState : {};
    const mode = DOUBAO_MODEL_MODES[actualModel || request.model];
    const transportMode = execution.transportMode ||= getTransport() === 'browser-fetch' ? 'browser-fetch' : 'node-http';
    if (transportMode === 'browser-fetch' && typeof browserBridge?.request !== 'function') throw doubaoError('doubao_browser_disabled');
    const sessionFlow = createDoubaoSessionFlow({ account, mode, state: nativeState,
      nodeMode: Boolean(accountCredentials?.nodeProfile), transport: transportMode });
    // 补发沿用同一条消息和唯一标识，不把一次恢复变成另一条新的用户消息。
    const basePrepared = execution.prepared ||= buildDoubaoRequest({ request, account, provider, actualModel, limits,
      ...(sessionFlow.continuing ? { nativeSession: nativeState } : {}) });
    let prepared = { ...basePrepared, headers: { ...basePrepared.headers } };
    // Responses内部截止时间不可由请求JSON覆盖；排队已经消耗的时间不能重新赋给执行阶段。
    const remaining = Math.min(execution.deadlineAt,
      sessionFlow.enabled && Number.isFinite(responseSession?.doubaoDeadlineAt)
        ? responseSession.doubaoDeadlineAt : execution.deadlineAt) - Date.now();
    if (remaining <= 0) throw doubaoError('doubao_timeout');
    const timeoutMs = Math.min(limits.timeoutMs,remaining);
    prepared.timeout = timeoutMs;
    const control = createRequestControl(context.signal || request.signal, timeoutMs);
    execution.control = control;
    let response;
    let signatureScope;
    try {
      control.check();
      // Android首轮由官网SDK签名，同一权威会话续聊复用内存签名；实际联网仍由Node HTTP/2执行。
      if (transportMode === 'node-http' && (prepareNodeRequest || process.env.AASC_ANDROID_NODE === '1')) {
        execution.nodeSigning = true;
        signatureScope = signatureCache({ account, responseSession, mode, sessionFlow });
        execution.signatureScope = signatureScope;
        if (execution.retried) signatureScope.clear();
        const prepare = prepareNodeRequest || (options => createDoubaoAndroidBridge().prepare(options));
        prepared = signatureScope.apply(prepared)
          || await control.wait(prepare({ account, prepared, signal: control.signal, limits: { ...limits, timeoutMs } }));
        control.check();
      }
      // 仅内部Responses生命周期读取这些标记；不属于nativeState，不会持久化到会话历史。
      if (responseSession && sessionFlow.enabled) {
        responseSession.doubaoNodeMode = true;
        responseSession.doubaoRequestStarted = true;
        responseSession.doubaoContinuationStarted = sessionFlow.continuing;
      }
      // 若客户端忽略取消后才交回流，也必须立即关闭，避免后台请求成为泄漏的资源。
      const pending = Promise.resolve(transportMode === 'browser-fetch'
        ? browserBridge?.request({ account, sessionKey: responseSession?.aascConversationId || nativeState.conversationId,
          prepared, signal: control.signal, limits: { ...limits, timeoutMs } })
        : (prepared.doubaoHttp2 ? http2Client : httpClient).request({ ...prepared, signal: control.signal })).then((value) => {
        control.attach(value?.data);
        return value;
      });
      response = await control.wait(pending);
      const status = Number(response && response.status);
      if (status !== 200) {
        if (status === 401) throw doubaoError('doubao_auth_expired');
        if (status === 403) throw doubaoError('doubao_risk_control');
        if (status === 429) throw doubaoError('doubao_rate_limited');
        throw doubaoError('doubao_upstream_failed');
      }
      // 自动重定向由 maxRedirects=0 关闭；仍核对客户端给出的最终 URL，禁止不受控实现悄悄换来源。
      const finalUrl = response.request?.res?.responseUrl || response.request?.responseURL;
      if (finalUrl && (transportMode === 'browser-fetch'
        ? new URL(finalUrl).origin !== DOUBAO_ORIGIN || new URL(finalUrl).pathname !== '/chat/completion'
        : finalUrl !== prepared.url)) throw doubaoError('doubao_invalid_provider');
      if (!response.data || typeof response.data[Symbol.asyncIterator] !== 'function') throw doubaoError('doubao_protocol_error');
      const contentType = getHeader(response.headers, 'content-type').toLowerCase();
      if (!/^text\/event-stream(?:\s*;|$)/u.test(contentType)) {
        // JSON 登录失效可分类，其余响应只返回固定错误；读取本身同样受总时间/字节限制。
        let bytes = 0;
        const pieces = [];
        const iterator = response.data[Symbol.asyncIterator]();
        while (true) {
          const part = await control.wait(iterator.next());
          if (part.done) break;
          const piece = Buffer.from(part.value);
          bytes += piece.length;
          if (bytes > Math.min(limits.eventBytes, 64 * 1024)) throw doubaoError('doubao_stream_limit');
          pieces.push(piece);
        }
        if (contentType.startsWith('application/json')) {
          const data = parseJson(Buffer.concat(pieces).toString('utf8'));
          throw getUpstreamError(data) || doubaoError('doubao_protocol_error');
        }
        throw doubaoError('doubao_protocol_error');
      }
      const events = consumeDoubaoStream({ source: response.data, model: request.originalModel || request.model,
        mode, nativeState, limits, control, sessionFlow,
        onComplete: () => {
          signatureScope?.complete(prepared, nativeState);
          return transportMode === 'browser-fetch' ? onBrowserChatVerified?.(account) : onChatVerified?.(account);
        } });
      const stream = {
        [Symbol.asyncIterator]() { return this; },
        next: async () => {
          try {
            const next = await events.next();
            const delta = next.value?.choices?.[0]?.delta;
            if (delta?.content || delta?.reasoning_content) execution.receivedOutput = true;
            return next;
          }
          catch (error) { signatureScope?.invalidate(error); throw error; }
        },
        return: async () => {
          control.cancel();
          try { return await events.return(); } finally { control.cleanup(); }
        },
      };
      if (request.stream === true) return { stream, nativeState, cancel: () => control.cancel() };
      let content = '';
      let reasoning = '';
      let id = '';
      for await (const chunk of stream) {
        id = chunk.id;
        content += chunk.choices[0].delta.content || '';
        reasoning += chunk.choices[0].delta.reasoning_content || '';
      }
      return {
        body: {
          id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: request.originalModel || request.model,
          choices: [{ index: 0, message: { role: 'assistant', content, ...(reasoning ? { reasoning_content: reasoning } : {}) }, finish_reason: 'stop' }],
        },
        nativeState,
      };
    } catch (error) {
      signatureScope?.invalidate(error);
      control.cleanup();
      throw control.normalizeError(error);
    }
  };
  const retryCodes = new Set(['doubao_auth_expired', 'doubao_risk_control', 'doubao_rate_limited',
    'doubao_upstream_failed', 'doubao_protocol_error', 'doubao_incomplete_response', 'doubao_empty_response',
    'doubao_android_prepare', 'doubao_android_unavailable', 'doubao_android_webview']);
  return async input => {
    const execution = { deadlineAt: Date.now() + limits.timeoutMs, retried: false, receivedOutput: false, stopped: false };
    const refreshForRetry = error => {
      // 单个额度同时覆盖握手和流读取失败；已经输出任何正文/思考后禁止换流重放。
      if (!execution.nodeSigning || execution.retried || execution.receivedOutput || execution.stopped
        || input.context?.signal?.aborted || input.request.signal?.aborted
        || Date.now() >= execution.deadlineAt
        || (Number.isFinite(input.responseSession?.doubaoDeadlineAt) && Date.now() >= input.responseSession.doubaoDeadlineAt)
        || !retryCodes.has(error?.code)) return false;
      execution.signatureScope?.clear();
      execution.retried = true;
      return true;
    };
    const start = async () => {
      try { return await runAttempt(input, execution); }
      catch (error) {
        if (!refreshForRetry(error)) throw error;
        return runAttempt(input, execution);
      }
    };
    let active = await start();
    if (!active.stream) return active;
    const stream = {
      [Symbol.asyncIterator]() { return this; },
      next: async () => {
        try { return await active.stream.next(); }
        catch (error) {
          if (!refreshForRetry(error)) throw error;
          active = await start();
          return active.stream.next();
        }
      },
      return: async () => {
        execution.stopped = true;
        execution.control?.cancel();
        return active.stream.return();
      },
    };
    return { ...active, stream, cancel: () => {
      execution.stopped = true;
      execution.control?.cancel();
      active.cancel?.();
    } };
  };
};

module.exports = {
  DOUBAO_ORIGIN, DOUBAO_COMPLETION_URL, DOUBAO_MODEL_MODES, DOUBAO_LIMITS,
  normalizeDoubaoCredentials, assertDoubaoProvider, buildDoubaoRequest, createDoubaoChatAdapter, doubaoError,
  createRequestControl, consumeDoubaoStream,
};
