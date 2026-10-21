'use strict';

const { PassThrough } = require('node:stream');
const { validateCompletionUrl } = require('./chat2api-doubao-browser-fetch');
const { normalizeDoubaoCookieSnapshot } = require('./chat2api-doubao-cookie-snapshot');
const { normalizeDoubaoNodeProfile } = require('./chat2api-doubao-node-protocol');

const bridgeError = (code, message, statusCode = 502) => Object.assign(new Error(message), { code, statusCode });
const sessionId = account => String(account?.credentials?.cookie || '').split(';')
  .map(item => item.trim()).find(item => item.startsWith('sessionid='))?.slice(10) || '';

/** Android 隔离 WebView 的本机 IPC；随机密钥只从原生启动器给当前 Node 子进程。 */
const createDoubaoAndroidBridge = ({ port = Number(process.env.AASC_DOUBAO_WEBVIEW_PORT),
  token = process.env.AASC_DOUBAO_WEBVIEW_TOKEN, accountId = '', fetchClient = globalThis.fetch } = {}) => {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || typeof token !== 'string' || token.length < 32) {
    throw bridgeError('doubao_android_unavailable', 'Android 豆包网页服务未就绪', 503);
  }
  const active = new Set();
  const request = async ({ account, prepared, signal, limits = {}, prepareOnly = false, closeAfterPrepare = false }) => {
    if (!account || account.providerId !== 'doubaochat' || (accountId && account.accountId !== accountId)) {
      throw bridgeError('doubao_android_account', '豆包网页账号不匹配', 409);
    }
    const url = validateCompletionUrl(prepared?.url);
    const method = prepared.method || 'POST';
    if (!['GET', 'POST'].includes(method) || (method === 'GET' && url.pathname !== '/top/v1')
      || Object.entries(prepared.customHeaders || {}).some(([key, value]) =>
        !['Authorization', 'x-amz-date', 'x-amz-content-sha256', 'x-amz-security-token'].includes(key)
        || typeof value !== 'string' || /[\r\n]/u.test(value))) {
      throw bridgeError('doubao_android_request', '豆包网页请求参数无效', 400);
    }
    const expectedSession = sessionId(account);
    if (!expectedSession) throw bridgeError('doubao_android_account', '豆包网页账号缺少登录态', 401);
    const restore = {
      cookieSnapshot: normalizeDoubaoCookieSnapshot(account.credentials.cookieSnapshot
        || { 'https://www.doubao.com': account.credentials.cookie }),
      nodeProfile: normalizeDoubaoNodeProfile(account.credentials.nodeProfile),
    };
    const contentType = Object.entries(prepared.headers || {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1]
      || 'application/json; encoding=utf-8';
    if (typeof contentType !== 'string' || !/^application\/json(?:;\s*(?:charset|encoding)=utf-8)?$/iu.test(contentType)) {
      throw bridgeError('doubao_android_request', '豆包网页编码参数无效', 400);
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) controller.abort();
    active.add(controller);
    const release = () => {
      signal?.removeEventListener('abort', onAbort);
      active.delete(controller);
    };
    const timeout = setTimeout(() => controller.abort(), Math.min(limits.timeoutMs || 120_000, 180_000));
    try {
      const response = await fetchClient(`http://127.0.0.1:${port}/${prepareOnly ? 'prepare' : 'fetch'}`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.href, payload: prepared.data, bodyType: prepared.bodyType || 'json',
          ...(prepareOnly ? { closeAfterPrepare: closeAfterPrepare === true } : {}),
          method, customHeaders: prepared.customHeaders || {}, sessionId: expectedSession, restore, contentType,
          maxBytes: Math.min(limits.streamBytes || 8 * 1024 * 1024, 32 * 1024 * 1024) }),
      });
      if (!response.ok || !response.body) throw bridgeError('doubao_android_webview',
        'Android 豆包网页未登录或页面不可用', response.status);
      if (prepareOnly) {
        try {
          let raw = '', packet, ended = false, pageClosed = false;
          const decoder = new TextDecoder();
          for await (const chunk of response.body) {
            raw += decoder.decode(chunk, { stream: true });
            if (raw.length > 256 * 1024) throw bridgeError('doubao_android_prepare', '豆包当次签名参数过大');
          }
          raw += decoder.decode();
          for (const line of raw.split('\n').filter(Boolean)) {
            const value = JSON.parse(line);
            if (value.type === 'error') throw bridgeError('doubao_android_prepare', '豆包当次签名生成失败，请更新APK或重试');
            if (value.type === 'prepared') {
              if (packet) throw bridgeError('doubao_android_prepare', '豆包当次签名重复');
              packet = value;
            }
            if (value.type === 'end') { ended = true; pageClosed = value.webViewClosed === true; }
          }
          if (!ended || !packet || typeof packet.url !== 'string' || packet.url.length > 16384) {
            throw bridgeError('doubao_android_prepare', '豆包当次签名未完整返回');
          }
          if (closeAfterPrepare === true && !pageClosed) {
            throw bridgeError('doubao_android_upgrade_required', '当前APK不支持签名后关闭页面，请更新min APK或关闭此开关', 503);
          }
          const signed = validateCompletionUrl(packet.url);
          if (signed.pathname !== url.pathname || !signed.searchParams.get('a_bogus')
            || ['aid', 'device_id', 'web_id', 'fp'].some(key => signed.searchParams.get(key) !== url.searchParams.get(key))) {
            throw bridgeError('doubao_android_prepare', '豆包当次签名身份不匹配');
          }
          const allowed = new Set(['accept', 'content-type', 'agw-js-conv', 'user-agent', 'origin', 'referer',
            'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'x-tt-passport-csrf-token']);
          if (!packet.headers || typeof packet.headers !== 'object' || Object.keys(packet.headers).length > 40) {
            throw bridgeError('doubao_android_prepare', '豆包当次签名请求头无效');
          }
          const signedHeaders = {};
          for (const [name, value] of Object.entries(packet.headers)) {
            const lower = name.toLowerCase();
            if (!allowed.has(lower) || typeof value !== 'string' || value.length > 4096 || /[\r\n]/u.test(value)) {
              throw bridgeError('doubao_android_prepare', '豆包当次签名请求头无效');
            }
            signedHeaders[lower] = value;
          }
          if (signedHeaders.origin !== 'https://www.doubao.com'
            || signedHeaders['user-agent'] !== restore.nodeProfile.userAgent) {
            throw bridgeError('doubao_android_prepare', '豆包当次签名身份不匹配');
          }
          // SDK只提供动态参数；账号Cookie始终由原来的Node构造器提供，不从网页脚本接收。
          return { ...prepared, url: signed.href, headers: { Cookie: prepared.headers.Cookie, ...signedHeaders }, doubaoHttp2: true };
        } finally { release(); clearTimeout(timeout); }
      }
      const stream = new PassThrough();
      stream.on('error', () => {});
      stream.once('close', () => { controller.abort(); release(); clearTimeout(timeout); });
      let resolveStarted;
      let rejectStarted;
      let started = false;
      const first = new Promise((resolve, reject) => { resolveStarted = resolve; rejectStarted = reject; });
      const pump = async () => {
        const decoder = new TextDecoder();
        let buffer = '';
        let bytes = 0;
        let ended = false;
        try {
          for await (const raw of response.body) {
            buffer += decoder.decode(raw, { stream: true });
            if (buffer.length > (limits.streamBytes || 8 * 1024 * 1024) * 2) {
              throw bridgeError('doubao_android_limit', 'Android 豆包网页响应过大');
            }
            let boundary;
            while ((boundary = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 1);
              if (!line) continue;
              const packet = JSON.parse(line);
              switch (packet.type) {
                case 'response':
                  if (!started) {
                    started = true;
                    resolveStarted({ status: Number(packet.status), headers: packet.headers || {}, data: stream,
                      request: { res: { responseUrl: `${url.origin}${url.pathname}` } } });
                  }
                  break;
                case 'chunk':
                  if (!started || typeof packet.chunk !== 'string') break;
                  bytes += Buffer.byteLength(packet.chunk);
                  if (bytes > (limits.streamBytes || 8 * 1024 * 1024)) {
                    throw bridgeError('doubao_android_limit', 'Android 豆包网页响应过大');
                  }
                  stream.write(packet.chunk);
                  break;
                case 'end':
                  ended = true;
                  if (!started) rejectStarted(bridgeError('doubao_android_incomplete', 'Android 豆包网页未返回响应'));
                  stream.end();
                  break;
                case 'error':
                  throw bridgeError('doubao_android_upstream', {
                    signature_unavailable: 'Android 豆包网页签名尚未就绪',
                    fetch_failed: 'Android 豆包网页网络请求失败',
                    cancelled: 'Android 豆包网页请求已取消',
                  }[packet.code] || 'Android 豆包网页请求失败');
                default:
                  break;
              }
            }
          }
          if (!ended) throw bridgeError('doubao_android_incomplete', 'Android 豆包网页连接提前结束');
        } catch (error) {
          if (started) stream.destroy(error);
          else rejectStarted(error);
        } finally {
          release();
          clearTimeout(timeout);
        }
      };
      void pump();
      return await first;
    } catch (error) {
      release();
      clearTimeout(timeout);
      if (error?.code?.startsWith('doubao_')) throw error;
      throw bridgeError('doubao_android_upstream', 'Android 豆包网页连接失败');
    }
  };
  return { request, prepare: options => request({ ...options, prepareOnly: true }),
    stop: async () => { for (const item of active) item.abort(); },
    cancel: () => { for (const item of active) item.abort(); } };
};

module.exports = { createDoubaoAndroidBridge };
