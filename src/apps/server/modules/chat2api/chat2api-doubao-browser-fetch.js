'use strict';

const { PassThrough } = require('node:stream');
const { randomUUID } = require('node:crypto');
const { executeDoubaoPageRequest } = require('./chat2api-doubao-page-runtime');

const ORIGIN = 'https://www.doubao.com';
const ALLOWED_PATHS = new Set(['/chat/completion', '/samantha/chat/completion',
  '/samantha/pages/upload_image', '/alice/message/get_file_url',
  '/alice/resource/prepare_upload', '/top/v1']);
const CHANNELS = new WeakMap();

const fetchError = (code, message, statusCode = 502) => Object.assign(new Error(message), { code, statusCode });
const validateCompletionUrl = value => {
  const url = new URL(value);
  if (url.origin !== ORIGIN || !ALLOWED_PATHS.has(url.pathname) || url.username || url.password || url.hash) {
    throw fetchError('doubao_browser_invalid_url', '豆包网页请求地址无效');
  }
  return url;
};

/** 在每个官网页面仅安装一条回传通道；回调只接收当前运行的请求 ID。 */
const getPageChannel = async page => {
  const saved = CHANNELS.get(page);
  if (saved) return saved;
  const handlers = new Map();
  const bridgeName = `__aascDoubaoStream_${randomUUID().replace(/-/gu, '')}`;
  await page.exposeFunction(bridgeName, async packet => {
    const handler = handlers.get(packet?.requestId);
    if (handler) await handler(packet);
  });
  const channel = { bridgeName, handlers };
  CHANNELS.set(page, channel);
  return channel;
};

/** 官网页内生成当次签名并发送同源请求，SSE 分块由 Node 流交给现有解析器。 */
const fetchInDoubaoPage = async ({ page, url: inputUrl, payload, bodyType = 'json',
  method = 'POST', customHeaders = {}, signal, prepareOnly = false, contentType = 'application/json',
  timeoutMs = 120_000, maxBytes = 8 * 1024 * 1024 }) => {
  if (signal?.aborted) throw fetchError('doubao_browser_cancelled', '豆包网页聊天已取消', 499);
  const url = validateCompletionUrl(inputUrl);
  if (!['POST', 'GET'].includes(method) || (method === 'GET' && url.pathname !== '/top/v1')
    || Object.entries(customHeaders).some(([key, value]) => !['Authorization', 'x-amz-date',
      'x-amz-content-sha256', 'x-amz-security-token'].includes(key)
      || typeof value !== 'string' || value.length > 2048 || /[\r\n]/u.test(value))) {
    throw fetchError('doubao_browser_invalid_request', '豆包网页请求参数无效', 400);
  }
  const channel = await getPageChannel(page);
  const requestId = randomUUID();
  const stream = new PassThrough({ highWaterMark: 64 * 1024 });
  stream.on('error', () => {});
  let done = false;
  let received = 0;
  let resolveResponse;
  let rejectResponse;
  let responseStarted = false;
  let preparedPacket;
  let timer;
  const result = new Promise((resolve, reject) => { resolveResponse = resolve; rejectResponse = reject; });
  const cleanup = () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    channel.handlers.delete(requestId);
  };
  const fail = error => {
    if (done) return;
    done = true;
    void page.evaluate(id => window.__aascDoubaoAborts?.[id]?.abort(), requestId).catch(() => {});
    cleanup();
    if (responseStarted) stream.destroy(error);
    else rejectResponse(error);
  };
  const onAbort = () => {
    fail(fetchError('doubao_browser_cancelled', '豆包网页聊天已取消', 499));
  };
  stream.once('close', () => { if (!done) onAbort(); });
  timer = setTimeout(() => {
    fail(fetchError('doubao_browser_timeout', '豆包网页聊天超时', 504));
  }, Math.min(timeoutMs, url.pathname === '/samantha/chat/completion' ? 300_000 : 120_000));
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  if (done) return result;
  channel.handlers.set(requestId, async packet => {
    if (done) return;
    switch (packet.type) {
      case 'prepared':
        if (!prepareOnly || preparedPacket) { fail(fetchError('doubao_browser_prepare', '豆包签名回执无效')); return; }
        preparedPacket = packet;
        break;
      case 'response': {
        if (prepareOnly) { fail(fetchError('doubao_browser_prepare', '签名准备不能返回已发送的响应')); return; }
        if (responseStarted) return;
        responseStarted = true;
        resolveResponse({ status: packet.status, headers: packet.headers || {}, data: stream,
          request: { res: { responseUrl: `${ORIGIN}${url.pathname}` } } });
        break;
      }
      case 'chunk': {
        if (!responseStarted || typeof packet.chunk !== 'string') return;
        const bytes = Buffer.from(packet.chunk);
        received += bytes.length;
        if (received > maxBytes) {
          fail(fetchError('doubao_browser_limit', '豆包网页回复超过容量限制'));
          return;
        }
        stream.write(bytes);
        break;
      }
      case 'end': {
        done = true;
        cleanup();
        if (prepareOnly && preparedPacket) resolveResponse(preparedPacket);
        else if (responseStarted) stream.end();
        else rejectResponse(fetchError('doubao_browser_response', '豆包网页未返回聊天响应'));
        break;
      }
      case 'error':
        if (prepareOnly) console.warn('[Chat2API] 豆包共享JS准备失败 stage=' +
          (['input_unavailable', 'composer_missing', 'send_unavailable', 'prepared_mismatch', 'prepare_timeout',
            'signature_unavailable', 'cancelled'].includes(packet.code) ? packet.code : 'unknown'));
        fail(fetchError(prepareOnly ? 'doubao_browser_prepare' : 'doubao_browser_upstream', '豆包专用浏览器请求失败'));
        break;
      default:
        break;
    }
  });
  // 参数和凭据只交给固定的官网页面；不得让页面返回任意 URL 或读取浏览器外的凭据。
  const evaluation = page.evaluate(executeDoubaoPageRequest, {
    requestId, inputUrl: url.href, body: payload, bodyType, method, customHeaders,
    bridgeName: channel.bridgeName, prepareOnly, contentType, maxBytes });
  void evaluation.catch(() => fail(fetchError('doubao_browser_upstream', '豆包专用浏览器连接失败')));
  return result;
};

const prepareInDoubaoPage = options => fetchInDoubaoPage({ ...options, prepareOnly: true });
module.exports = { fetchInDoubaoPage, prepareInDoubaoPage, validateCompletionUrl };
