const DOUBAO_REQUEST_ORIGIN = 'https://www.doubao.com';
const DOUBAO_REQUEST_PATH = '/chat/completion';
const MAX_PROFILE_BYTES = 192 * 1024;
const HEADER_NAME = /^[a-z0-9!#$%&'*+.^_`|~-]{1,128}$/u;
const SKIP_HEADERS = new Set(['cookie', 'content-length', 'host', 'connection', 'proxy-connection',
  'transfer-encoding', 'upgrade', 'keep-alive']);

const invalidProfile = () => Object.assign(new Error('豆包网页请求样本无效，请在官网新会话发送一条消息后重新导入'), {
  statusCode: 422, code: 'doubao_invalid_request_profile',
});
const plainObject = value => value && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const cloneJson = value => {
  try { return JSON.parse(JSON.stringify(value)); } catch { throw invalidProfile(); }
};

/**
 * 账号仅保存同源首轮请求的参数模板。请求文字、网页旧会话和逐次消息 ID 在入库前删除；
 * Cookie 始终以账号当前快照为准，禁止借请求头把凭据发往可变来源。
 */
const normalizeDoubaoRequestProfile = input => {
  if (!plainObject(input)) throw invalidProfile();
  let query, headers, body, capturedAt, browserVerifiedAt;
  if (input.version === 1) {
    query = input.query;
    headers = input.headers;
    body = input.body;
    capturedAt = input.capturedAt;
    browserVerifiedAt = input.browserVerifiedAt;
  } else {
    let url;
    try { url = new URL(input.url); } catch { throw invalidProfile(); }
    if (url.origin !== DOUBAO_REQUEST_ORIGIN || url.pathname !== DOUBAO_REQUEST_PATH
      || url.username || url.password || url.hash || url.search.length > 16 * 1024) throw invalidProfile();
    query = [...url.searchParams];
    headers = input.headers;
    try { body = typeof input.body === 'string' ? JSON.parse(input.body) : cloneJson(input.body); }
    catch { throw invalidProfile(); }
    if (!plainObject(body) || body.option?.need_create_conversation !== true
      || body.client_meta?.conversation_id !== '' || !Array.isArray(body.messages)
      || body.messages.length !== 1) throw invalidProfile();
    const text = body.messages[0]?.content_block?.[0]?.content?.text_block?.text;
    if (typeof text !== 'string' || !text.trim()) throw invalidProfile();
    delete body.messages;
    // 上游会话由首轮请求创建，不能把网页已生成的消息和旧会话写成账号秘密。
    Object.assign(body.client_meta, { conversation_id: '', local_conversation_id: '', last_section_id: '', last_message_index: null });
    delete body.option.unique_key;
    delete body.option.create_time_ms;
    if (plainObject(body.option.recovery_option)) delete body.option.recovery_option.req_create_time_sec;
    if (JSON.stringify(body).includes(text)) throw invalidProfile();
    capturedAt = new Date().toISOString();
    browserVerifiedAt = input.browserVerifiedAt;
  }
  if (!Array.isArray(query) || query.length === 0 || query.length > 80
    || query.some(item => !Array.isArray(item) || item.length !== 2
      || typeof item[0] !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(item[0])
      || typeof item[1] !== 'string' || item[1].length > 4096 || /[\r\n]/u.test(item[1]))) throw invalidProfile();
  const names = new Set(query.map(item => item[0]));
  if (names.size !== query.length || !['aid', 'device_id', 'web_id', 'fp'].every(name => names.has(name))) throw invalidProfile();
  if (!plainObject(headers) || Object.keys(headers).length > 80) throw invalidProfile();
  const normalizedHeaders = {};
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    if (name.startsWith(':') || SKIP_HEADERS.has(name)) continue;
    if (!HEADER_NAME.test(name) || Object.hasOwn(normalizedHeaders, name)
      || typeof rawValue !== 'string' || rawValue.length > 4096 || /[\r\n]/u.test(rawValue)) throw invalidProfile();
    normalizedHeaders[name] = rawValue;
  }
  if (!plainObject(body) || !plainObject(body.client_meta) || !plainObject(body.option)
    || !plainObject(body.ext) || Object.hasOwn(body, 'messages')
    || body.client_meta.conversation_id !== '' || body.client_meta.local_conversation_id !== ''
    || body.option.need_create_conversation !== true || Object.hasOwn(body.option, 'unique_key')
    || typeof capturedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(capturedAt)) throw invalidProfile();
  if (browserVerifiedAt !== undefined && (typeof browserVerifiedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(browserVerifiedAt))) throw invalidProfile();
  const result = { version: 1, query: query.map(([name, value]) => [name, value]),
    headers: normalizedHeaders, body: cloneJson(body), capturedAt,
    ...(browserVerifiedAt ? { browserVerifiedAt } : {}) };
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_PROFILE_BYTES) throw invalidProfile();
  return result;
};

module.exports = { normalizeDoubaoRequestProfile, invalidProfile, DOUBAO_REQUEST_ORIGIN, DOUBAO_REQUEST_PATH };
