'use strict';

const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');
const { createHash, randomUUID } = require('crypto');

const { buildProviderHeaders } = require('./chat2api-provider-adapters');

const DEFAULT_HISTORY_API_ENDPOINT = 'https://chat2-api.qianwen.com';
const DEFAULT_DEVICE_ID = '5b68c267-cd8e-fd0e-148a-18345bc9a104';
const PAGE_SIZE = 50;
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 1000;
const PAGE_DELAY_MS = 120;
const DETAIL_DELAY_MS = 80;
const REDACTED_CREDENTIAL = '[REDACTED_QWEN_CREDENTIAL]';
const CREDENTIAL_FIELDS = Object.freeze(['ticket', 'tongyi_sso_ticket', 'cookie', 'cookies', 'token', 'accessToken', 'refreshToken', 'refresh_token']);

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const getCredentials = (account) => account && (account.credentials || account) || {};

const collectCredentialSecrets = (credentials) => {
  const values = new Set();
  const collect = (value) => {
    if (typeof value === 'string') {
      if (value.length >= 8) values.add(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  CREDENTIAL_FIELDS.forEach((field) => collect(credentials[field]));
  return [...values].sort((left, right) => right.length - left.length);
};

const redactSecrets = (value, secrets) => {
  if (typeof value === 'string') {
    return secrets.reduce((text, secret) => text.split(secret).join(REDACTED_CREDENTIAL), value);
  }
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, secrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactSecrets(item, secrets)]));
  }
  return value;
};

const ensureLimit = (value) => {
  if (value === undefined || value === null || value === '') return DEFAULT_LIMIT;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_LIMIT) {
    throw new Error(`Qwen 网页会话导入数量必须是 1 到 ${MAX_LIMIT} 之间的整数`);
  }
  return limit;
};

const getCookieValue = (cookieHeader, name) => {
  const match = String(cookieHeader || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`, 'u'));
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};

const asText = (value) => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(asText).join('');
  if (!value || typeof value !== 'object') return '';
  if (typeof value.content === 'string') return value.content;
  if (value.content !== undefined) return asText(value.content);
  if (typeof value.text === 'string') return value.text;
  return '';
};

const requestText = (turn) => (Array.isArray(turn && turn.request_messages) ? turn.request_messages : [])
  .map(asText)
  .map((value) => value.trim())
  .filter(Boolean)
  .join('\n\n')
  .trim();

const qwenResponseText = (turn) => (Array.isArray(turn && turn.qwen_response_messages) ? turn.qwen_response_messages : [])
  .filter((message) => String(message && message.role || '').toLowerCase() === 'assistant')
  .filter((message) => ['', 'text', 'markdown', 'multi_load/text'].includes(String(message && (message.contentType || message.content_type || message.mimeType) || '').toLowerCase()))
  .map((message) => typeof message.content === 'string' ? message.content.trim() : '')
  .filter(Boolean)
  .join('\n\n')
  .trim();

const responseText = (turn) => {
  const values = (Array.isArray(turn && turn.response_messages) ? turn.response_messages : [])
    .filter((message) => !/^(signal|bar|paa)\//u.test(String(message && message.mime_type || '')))
    .map(asText)
    .map((value) => value.trim())
    .filter(Boolean);
  return (values.length > 0 ? values : [qwenResponseText(turn)]).filter(Boolean).join('\n\n').trim();
};

const isPinned = (value) => value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';

const normalizeSessionMetadata = (session, pinned = false) => {
  const id = session && (session.session_id || session.sessionId);
  if (!id) return null;
  return {
    id,
    title: session.title || session.summary || id,
    created_at: session.created_at || session.createTime || null,
    updated_at: session.updated_at || session.modifiedTime || session.last_req_timestamp || null,
    qwen_session_type: session.qwen_session_type || session.sessionType || null,
    pinned: pinned || isPinned(session.top),
  };
};

const thinkingText = (turn) => {
  const values = [];
  for (const message of (Array.isArray(turn && turn.response_messages) ? turn.response_messages : [])) {
    const loaders = message && message.meta_data && Array.isArray(message.meta_data.multi_load)
      ? message.meta_data.multi_load
      : [];
    for (const item of loaders) {
      const text = item && item.type === 'deep_think' && item.content && item.content.think_content;
      if (text) values.push(String(text).trim());
    }
  }
  return values.filter(Boolean).join('\n\n').trim();
};

const getTurnTimestamp = (turn) => {
  const value = turn && (turn.request_timestamp ?? turn.requestTimestamp ?? turn.created_at ?? turn.createdAt ?? turn.create_time ?? turn.createTime ?? turn.pos);
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
};

const orderTurns = (turns) => turns.map((turn, index) => ({ turn, index, timestamp: getTurnTimestamp(turn) }))
  .sort((left, right) => {
    if (left.timestamp === null && right.timestamp === null) return left.index - right.index;
    if (left.timestamp === null) return -1;
    if (right.timestamp === null) return 1;
    return left.timestamp - right.timestamp || left.index - right.index;
  })
  .map(({ turn }) => turn);

const normalizeConversation = ({ id, metadata = {}, sessionResponse, turns }) => {
  const orderedTurns = orderTurns(turns);
  const messages = [];
  for (const turn of orderedTurns) {
    const createdAt = turn.created_at || turn.createdAt || turn.create_time || turn.createTime || null;
    const request = requestText(turn);
    const response = responseText(turn);
    const requestId = turn.req_id || turn.reqId || '';
    if (request) {
      messages.push({
        role: 'user',
        content: request,
        ...(createdAt ? { createdAt } : {}),
        ...(requestId ? { qwenRequestId: requestId } : {}),
      });
    }
    if (response) {
      const thought = thinkingText(turn);
      messages.push({
        role: 'assistant',
        content: response,
        ...(thought ? { reasoningContent: thought } : {}),
        ...(createdAt ? { createdAt } : {}),
        ...(requestId ? { qwenRequestId: requestId } : {}),
      });
    }
  }

  const lastTurn = orderedTurns.at(-1) || {};
  return {
    id,
    title: metadata.title || metadata.summary || id,
    createdAt: metadata.created_at || metadata.createdAt || metadata.createTime || null,
    updatedAt: metadata.updated_at || metadata.updatedAt || metadata.modifiedTime || metadata.last_req_timestamp || null,
    qwenSessionType: metadata.qwen_session_type || metadata.sessionType || null,
    nativeState: {
      sessionId: id,
      ...(lastTurn.req_id || lastTurn.reqId ? { parentReqId: lastTurn.req_id || lastTurn.reqId } : {}),
    },
    pinned: metadata.pinned === true,
    messages,
    raw: {
      session: sessionResponse && sessionResponse.data !== undefined ? sessionResponse.data : sessionResponse || null,
      listMetadata: metadata,
      turns,
    },
  };
};

const safeFileName = (id) => {
  const slug = String(id).replace(/[^a-zA-Z0-9._-]/gu, '_').slice(0, 80) || 'session';
  const suffix = createHash('sha256').update(String(id), 'utf8').digest('hex').slice(0, 12);
  return `${slug}-${suffix}.json`;
};

const writeJsonAtomic = async (target, value) => {
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, target);
    await fs.chmod(target, 0o600);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
};

const createChat2ApiQwenHistoryService = ({ dataStore, providerRegistry, httpClient = axios, projectRoot } = {}) => {
  if (!dataStore || typeof dataStore.getAccount !== 'function' || typeof dataStore.listAccounts !== 'function') {
    throw new Error('Qwen 网页会话导入需要账号数据存储');
  }
  if (!providerRegistry || typeof providerRegistry.getProvider !== 'function') {
    throw new Error('Qwen 网页会话导入需要 Provider 注册表');
  }

  const resolveAccount = async (accountId) => {
    const accounts = await dataStore.listAccounts();
    const candidates = accounts.filter((account) => account.providerId === 'qwen'
      && account.enabled !== false && (!account.status || account.status === 'active'));
    if (accountId) {
      const selected = candidates.find((account) => (account.accountId || account.id) === accountId);
      if (!selected) throw new Error(`找不到可用的 Qwen 账号: ${accountId}`);
      return dataStore.getAccount(selected.accountId || selected.id);
    }
    if (candidates.length === 0) throw new Error('没有可用的 Qwen 账号，请先在 Chat2API 中登录 Qwen');
    if (candidates.length > 1) throw new Error('检测到多个 Qwen 账号，请指定 accountId 后再导入');
    return dataStore.getAccount(candidates[0].accountId || candidates[0].id);
  };

  const buildRequestContext = (provider, account) => {
    const credentials = getCredentials(account);
    const headers = buildProviderHeaders(provider, account, 'qwen');
    delete headers.Authorization;
    delete headers.authorization;
    const cookie = headers.Cookie || headers.cookie || '';
    const deviceId = credentials.deviceId || DEFAULT_DEVICE_ID;
    const version = provider.webVersion || '4.0.7';
    const commonParams = (extra = {}) => new URLSearchParams({
      biz_id: 'ai_qwen',
      chat_client: 'h5',
      device: 'pc',
      fr: 'pc',
      pr: 'qwen',
      ut: deviceId,
      la: credentials.language || 'zh-CN',
      tz: credentials.timezone || 'Asia/Shanghai',
      wv: version,
      ve: version,
      ...extra,
    });
    const requestHeaders = {
      ...headers,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Platform': 'pc_tongyi',
      'X-DeviceId': deviceId,
    };
    const xsrfToken = getCookieValue(cookie, 'XSRF-TOKEN');
    if (xsrfToken) requestHeaders['X-Xsrf-Token'] = xsrfToken;
    const baseUrl = String(provider.historyApiEndpoint || DEFAULT_HISTORY_API_ENDPOINT).replace(/\/$/u, '');

    const requestJson = async (requestPath, options = {}) => {
      const url = new URL(`${baseUrl}${requestPath}`);
      const query = commonParams(options.query);
      for (const [key, value] of query) url.searchParams.set(key, value);
      const response = await httpClient.request({
        method: options.method || 'GET',
        url: url.toString(),
        data: options.body,
        headers: requestHeaders,
        responseType: 'json',
        timeout: 30_000,
        validateStatus: () => true,
      });
      const body = response.data || {};
      const bodyCode = body && body.code;
      const bodyFailed = body && (body.success === false || (bodyCode !== undefined && bodyCode !== 0 && String(bodyCode) !== '0'));
      if (response.status < 200 || response.status >= 300 || bodyFailed) {
        const error = new Error(`Qwen 网页接口请求失败: HTTP ${response.status}${body.msg || body.errorMsg ? ` (${body.msg || body.errorMsg})` : ''}`);
        error.statusCode = response.status;
        error.code = response.status === 401 || response.status === 403 ? 'qwen_auth_failed' : 'qwen_history_request_failed';
        throw error;
      }
      return body;
    };

    return { requestJson };
  };

  const listConversations = async (requestJson, limit) => {
    const conversations = [];
    const seen = new Set();
    let nextToken = '';
    while (conversations.length < limit) {
      const body = await requestJson('/api/v2/session/page/list', {
        method: 'POST',
        body: {
          limit: Math.min(PAGE_SIZE, limit - conversations.length),
          next_token: nextToken,
          sort_field: 'modifiedTime',
          need_filter_tag: true,
        },
      });
      const data = body && body.data || {};
      const sessions = Array.isArray(data.list) ? data.list : [];
      let added = 0;
      for (const session of sessions) {
        const id = session && (session.session_id || session.sessionId);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        conversations.push(normalizeSessionMetadata(session));
        added++;
        if (conversations.length >= limit) break;
      }
      nextToken = data.next_token || '';
      const hasMore = data.have_next_page === true || data.has_next_page === true || data.have_more_record === true;
      if (!hasMore || !nextToken || sessions.length === 0 || added === 0) break;
      await wait(PAGE_DELAY_MS);
    }
    return conversations;
  };

  const listPinnedConversations = async (requestJson) => {
    const body = await requestJson('/api/v1/session/top/list', {
      method: 'POST',
      body: { biz_id: 'ai_qwen' },
    });
    const data = body && body.data;
    const sessions = Array.isArray(data) ? data : Array.isArray(data && data.list) ? data.list : [];
    return sessions.map((session) => normalizeSessionMetadata(session, true)).filter(Boolean);
  };

  const mergeConversationMetadata = (conversations, pinnedConversations, limit) => {
    const merged = new Map();
    for (const conversation of pinnedConversations) merged.set(conversation.id, conversation);
    for (const conversation of conversations) {
      const pinned = merged.get(conversation.id);
      merged.set(conversation.id, pinned ? { ...conversation, pinned: true } : conversation);
    }
    return [...merged.values()].slice(0, limit);
  };

  const getConversationDetails = async (requestJson, metadata) => {
    const id = metadata.id;
    const sessionResponse = await requestJson('/api/v1/session/get', {
      method: 'POST',
      body: { session_id: id },
    });
    const turns = [];
    const seen = new Set();
    let nextPos = '';
    let page = 1;
    while (true) {
      const query = {
        session_id: id,
        page_size: String(PAGE_SIZE),
        page: String(page),
        return_response_messages: 'true',
        event_filter: 'all',
      };
      if (nextPos) query.pos = nextPos;
      const body = await requestJson('/api/v1/session/msg/list', { query });
      const data = body && body.data || {};
      const batch = Array.isArray(data.list) ? data.list : [];
      let added = 0;
      for (const turn of batch) {
        const key = turn && (turn.req_id || turn.pos) || JSON.stringify(turn && turn.request_messages || []);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        turns.push(turn);
        added++;
      }
      const candidatePos = data.next_page_pos || batch.at(-1)?.pos || '';
      const hasMore = data.has_next_page === true || data.have_next_page === true || data.have_more_record === true;
      if (!hasMore || !batch.length || !added || !candidatePos || candidatePos === nextPos) break;
      nextPos = candidatePos;
      page++;
      await wait(PAGE_DELAY_MS);
    }

    for (let index = 0; index < turns.length; index++) {
      const turn = turns[index];
      const hasResponse = Array.isArray(turn && turn.response_messages) && turn.response_messages.length > 0;
      const hasQwenResponse = Array.isArray(turn && turn.qwen_response_messages) && turn.qwen_response_messages.length > 0;
      if (!turn || !turn.req_id || hasResponse || hasQwenResponse) continue;
      try {
        const detail = await requestJson('/api/v1/session/req/detail', {
          query: { session_id: id, req_id: turn.req_id },
        });
        if (detail && detail.data) turns[index] = { ...turn, ...detail.data };
      } catch (error) {
        // 单轮补详情失败不阻断整条会话导入，原始列表数据仍保留。
      }
      if (index < turns.length - 1) await wait(DETAIL_DELAY_MS);
    }
    return normalizeConversation({ id, metadata, sessionResponse, turns });
  };

  const importConversations = async ({ accountId, limit: rawLimit } = {}) => {
    const limit = ensureLimit(rawLimit);
    const account = await resolveAccount(accountId);
    const provider = await providerRegistry.getProvider('qwen');
    if (!provider) throw new Error('Qwen Provider 不存在');
    const credentials = getCredentials(account);
    if (!credentials.ticket && !credentials.tongyi_sso_ticket && !credentials.cookie && !credentials.cookies) {
      throw new Error('Qwen 账号缺少网页登录凭据');
    }
    const credentialSecrets = collectCredentialSecrets(credentials);
    const { requestJson } = buildRequestContext(provider, account);
    const pinnedMetadata = await listPinnedConversations(requestJson);
    const metadata = mergeConversationMetadata(await listConversations(requestJson, limit), pinnedMetadata, limit);
    const conversations = [];
    const errors = [];
    for (const item of metadata) {
      try {
        conversations.push(await getConversationDetails(requestJson, item));
      } catch (error) {
        errors.push({ id: item.id, title: redactSecrets(item.title, credentialSecrets), error: redactSecrets(error.message, credentialSecrets) });
      }
    }

    const outputDir = path.join(path.resolve(projectRoot || path.resolve(__dirname, '../../../../..')), 'tmp', 'qwen-web-import');
    await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
    await fs.chmod(outputDir, 0o700);
    const files = [];
    for (const sourceConversation of conversations) {
      const conversation = redactSecrets(sourceConversation, credentialSecrets);
      const fileName = safeFileName(conversation.id);
      await writeJsonAtomic(path.join(outputDir, fileName), {
        version: 1,
        source: 'qwen-web',
        providerId: 'qwen',
        accountId: account.accountId || account.id,
        importedAt: new Date().toISOString(),
        conversation,
      });
      files.push({
        id: conversation.id,
        title: conversation.title,
        file: path.posix.join('tmp', 'qwen-web-import', fileName),
        messageCount: conversation.messages.length,
        pinned: conversation.pinned === true,
      });
    }
    const index = {
      version: 1,
      source: 'qwen-web',
      providerId: 'qwen',
      accountId: account.accountId || account.id,
      importedAt: new Date().toISOString(),
      requestedLimit: limit,
      total: metadata.length,
      imported: conversations.length,
      failed: errors.length,
      pinned: files.filter((file) => file.pinned).length,
      files,
      errors,
    };
    await writeJsonAtomic(path.join(outputDir, 'index.json'), index);
    return {
      ...index,
      outputDir: path.posix.join('tmp', 'qwen-web-import'),
      indexFile: path.posix.join('tmp', 'qwen-web-import', 'index.json'),
    };
  };

  return { importConversations };
};

module.exports = {
  createChat2ApiQwenHistoryService,
  normalizeConversation,
  requestText,
  responseText,
};
