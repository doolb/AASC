'use strict';

const { PassThrough } = require('node:stream');
const { randomUUID } = require('node:crypto');

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
  method = 'POST', customHeaders = {}, signal,
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
  timer = setTimeout(() => {
    fail(fetchError('doubao_browser_timeout', '豆包网页聊天超时', 504));
  }, Math.min(timeoutMs, url.pathname === '/samantha/chat/completion' ? 300_000 : 120_000));
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  if (done) return result;
  channel.handlers.set(requestId, async packet => {
    if (done) return;
    switch (packet.type) {
      case 'response': {
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
        if (responseStarted) stream.end();
        else rejectResponse(fetchError('doubao_browser_response', '豆包网页未返回聊天响应'));
        break;
      }
      case 'error':
        fail(fetchError('doubao_browser_upstream', '豆包专用浏览器请求失败'));
        break;
      default:
        break;
    }
  });
  // 参数和凭据只交给固定的官网页面；不得让页面返回任意 URL 或读取浏览器外的凭据。
  const evaluation = page.evaluate(async ({ requestId: id, inputUrl: rawUrl, body, bodyType: kind,
    method: verb, customHeaders: extraHeaders, bridgeName: callbackName }) => {
    const report = async packet => window[callbackName]({ requestId: id, ...packet });
    window.__aascDoubaoAborts ||= {};
    const abort = new AbortController();
    window.__aascDoubaoAborts[id] = abort;
    try {
      if (location.origin !== 'https://www.doubao.com') throw new Error('invalid_origin');
      const requestUrl = new URL(rawUrl, location.origin);
      if (requestUrl.origin !== location.origin
        || !['/chat/completion', '/samantha/chat/completion', '/samantha/pages/upload_image',
          '/alice/message/get_file_url', '/alice/resource/prepare_upload', '/top/v1'].includes(requestUrl.pathname)) throw new Error('invalid_url');
      requestUrl.searchParams.delete('a_bogus');
      requestUrl.searchParams.delete('X-Bogus');
      requestUrl.searchParams.sort();
      const query = requestUrl.searchParams.toString();
      if (!['/samantha/chat/completion', '/top/v1'].includes(requestUrl.pathname)) {
        const signature = await window.bdms?.frontierSign?.(query);
        if (!signature) throw new Error('signature_unavailable');
        const signatureValue = typeof signature === 'string' ? { 'X-Bogus': signature } : signature;
        for (const [key, value] of Object.entries(signatureValue)) {
          if (!['a_bogus', 'X-Bogus'].includes(key) || typeof value !== 'string' || !value) continue;
          requestUrl.searchParams.set(key, value);
        }
        if (!requestUrl.searchParams.has('a_bogus') && !requestUrl.searchParams.has('X-Bogus')) {
          throw new Error('signature_invalid');
        }
      }
      const csrf = document.cookie.match(/(?:^|;\s*)passport_csrf_token=([^;]+)/)?.[1] || '';
      const headers = { 'agw-js-conv': 'str', ...extraHeaders };
      if (csrf) headers['x-tt-passport-csrf-token'] = csrf;
      let requestBody;
      if (kind === 'image-upload' && requestUrl.pathname === '/samantha/pages/upload_image') {
        if (!body || !/^[\w.-]{1,128}$/u.test(body.filename) || !/^[a-z0-9]{1,8}$/u.test(body.extension)
          || typeof body.base64 !== 'string' || body.base64.length > 15 * 1024 * 1024) throw new Error('invalid_upload');
        const raw = atob(body.base64);
        const bytes = new Uint8Array(raw.length);
        for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
        const form = new FormData();
        form.append('data', new Blob([bytes], { type: `image/${body.extension}` }), body.filename);
        form.append('file_type', body.extension);
        requestBody = form;
      } else if (kind === 'json') {
        headers['Content-Type'] = 'application/json';
        requestBody = JSON.stringify(body);
      } else if (kind === 'none' && verb === 'GET') {
        requestBody = undefined;
      } else throw new Error('invalid_body_type');
      const response = await fetch(requestUrl.pathname + requestUrl.search, {
        method: verb, headers, body: requestBody, credentials: 'include', signal: abort.signal,
      });
      await report({ type: 'response', status: response.status, headers: Object.fromEntries(response.headers.entries()) });
      const reader = response.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          const chunk = decoder.decode(next.value, { stream: true });
          if (chunk) await report({ type: 'chunk', chunk });
        }
        const rest = decoder.decode();
        if (rest) await report({ type: 'chunk', chunk: rest });
      } else {
        await report({ type: 'chunk', chunk: await response.text() });
      }
      await report({ type: 'end' });
    } catch {
      await report({ type: 'error' });
    } finally {
      delete window.__aascDoubaoAborts[id];
    }
  }, { requestId, inputUrl: url.href, body: payload, bodyType, method,
    customHeaders, bridgeName: channel.bridgeName });
  void evaluation.catch(() => fail(fetchError('doubao_browser_upstream', '豆包专用浏览器连接失败')));
  return result;
};

module.exports = { fetchInDoubaoPage, validateCompletionUrl };
