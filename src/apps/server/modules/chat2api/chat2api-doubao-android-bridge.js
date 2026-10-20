'use strict';

const { PassThrough } = require('node:stream');
const { validateCompletionUrl } = require('./chat2api-doubao-browser-fetch');

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
  const request = async ({ account, prepared, signal, limits = {} }) => {
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
      const response = await fetchClient(`http://127.0.0.1:${port}/fetch`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.href, payload: prepared.data, bodyType: prepared.bodyType || 'json',
          method, customHeaders: prepared.customHeaders || {}, sessionId: expectedSession,
          maxBytes: Math.min(limits.streamBytes || 8 * 1024 * 1024, 32 * 1024 * 1024) }),
      });
      if (!response.ok || !response.body) throw bridgeError('doubao_android_webview',
        'Android 豆包网页未登录或页面不可用', response.status);
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
                  stream.end();
                  break;
                case 'error':
                  throw bridgeError('doubao_android_upstream', 'Android 豆包网页请求失败');
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
  return { request, stop: async () => { for (const item of active) item.abort(); },
    cancel: () => { for (const item of active) item.abort(); } };
};

module.exports = { createDoubaoAndroidBridge };
