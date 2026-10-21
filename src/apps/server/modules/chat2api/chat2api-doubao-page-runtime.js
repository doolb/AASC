'use strict';

const PAGE_RUNTIME_VERSION = 3;

/** 文档开始安装，保存SDK包装之前的fetch；准备请求仅截留，不真正发消息。 */
function installDoubaoPageRuntime() {
if (window.__aascDoubaoPrepareRequest) return;
  const original = window.fetch;
  const waiters = new Map();
  const collect = async (input, init, receiver, args) => {
    const url = new URL(input instanceof Request ? input.url : String(input),location.href);
    const body = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.clone().text() : '';
    let key;
    try { key = JSON.parse(body).option?.unique_key; } catch (_) {}
    const waiter = waiters.get(key);
    if (!waiter) {
      if (url.origin !== 'https://www.doubao.com' || url.pathname !== '/chat/completion') return original.apply(receiver,args);
      for (const value of waiters.values()) value.reject(Error('prepared_mismatch'));
      waiters.clear(); return new Response(null,{status:204});
    }
    if (url.origin !== 'https://www.doubao.com' || url.pathname !== '/chat/completion' || body !== waiter.body) {
      waiters.delete(key); waiter.reject(Error('prepared_mismatch')); return new Response(null,{status:204});
    }
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) for (const [name,value] of new Headers(init.headers)) headers.set(name,value);
    headers.set('user-agent',navigator.userAgent);
    headers.set('accept','*/*'); headers.set('origin',location.origin);
    headers.set('referer',location.origin + '/chat/');
    const hints = navigator.userAgentData;
    if (hints) {
      headers.set('sec-ch-ua',hints.brands.map(item=>JSON.stringify(item.brand)+';v='+JSON.stringify(item.version)).join(', '));
      headers.set('sec-ch-ua-mobile',hints.mobile ? '?1' : '?0');
      headers.set('sec-ch-ua-platform',JSON.stringify(hints.platform));
    }
    waiters.delete(key);
    waiter.resolve({url:url.href,headers:Object.fromEntries(headers)});
    return new Response(null,{status:204});
  };
  window.fetch = function(input,init) {
    if (!waiters.size) return original.apply(this,arguments);
    return collect(input,init,this,arguments);
  };
  window.__aascDoubaoPrepareRequest = (url, options) => new Promise((resolve,reject) => {
    const key = JSON.parse(options.body).option?.unique_key;
    if (typeof key !== 'string' || !key || waiters.size) { reject(Error('prepare_busy')); return; }
    const cleanup = () => {
      clearTimeout(timer); options.signal?.removeEventListener('abort',cancel);
      if (waiters.get(key) === entry) waiters.delete(key);
    };
    const finish = value => { cleanup(); resolve(value); };
    const fail = error => { cleanup(); reject(error); };
    const cancel = () => fail(Error('cancelled'));
    const timer = setTimeout(()=>fail(Error('prepare_timeout')),10000);
    const entry = {body:options.body,resolve:finish,reject:fail};
    waiters.set(key,entry);
    options.signal?.addEventListener('abort',cancel,{once:true});
    if (options.signal?.aborted) { cancel(); return; }
    // 调用SDK包裹后的fetch；底层拦截点匹配unique_key后返回空响应，不访问官网网络。
    Promise.resolve().then(()=>window.fetch(url,options)).then(()=>{
      if (waiters.get(key) === entry) fail(Error('prepare_hook_missing'));
    },fail);
  });
}

/** 两个平台执行同一份页面业务；平台只提供报告回调，不参与签名或正文处理。 */
async function executeDoubaoPageRequest(arg, reportPacket) {
  const report = packet => (reportPacket || (value => window[arg.bridgeName](value)))({ requestId: arg.requestId, ...packet });
  const abort = new AbortController();
  window.__aascDoubaoAborts ||= {};
  window.__aascDoubaoAborts[arg.requestId] = abort;
  let stage = 'invalid_request';
  async function streamPageResponse(response, report, cap) {
    await report({ type: 'response', status: response.status, headers: Object.fromEntries(response.headers.entries()) });
    let received = 0;
    const maxBytes = Math.min(Math.max(cap || 8388608, 1), 33554432);
    const send = async chunk => {
      received += new TextEncoder().encode(chunk).byteLength;
      if (received > maxBytes) { stage = 'response_too_large'; throw Error('response_too_large'); }
      await report({ type: 'chunk', chunk });
    };
    const reader = response.body?.getReader();
    if (reader) {
      const decoder = new TextDecoder();
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        const chunk = decoder.decode(next.value, { stream: true });
        if (chunk) await send(chunk);
      }
      const rest = decoder.decode();
      if (rest) await send(rest);
    } else await send(await response.text());
    await report({ type: 'end' });
  }
  try {
    const origin = 'https://www.doubao.com';
    const url = new URL(arg.inputUrl);
    const allowed = ['/chat/completion', '/samantha/chat/completion', '/samantha/pages/upload_image',
      '/alice/message/get_file_url', '/alice/resource/prepare_upload', '/top/v1'];
    if (location.origin !== origin || url.origin !== origin || !allowed.includes(url.pathname)
      || url.username || url.password || url.hash) throw Error('invalid_origin');
    if (!['POST', 'GET'].includes(arg.method) || (arg.method === 'GET' && url.pathname !== '/top/v1')) {
      throw Error('invalid_method');
    }
    // 只同步网页已使用的动态参数，不允许观察到的资源更换账号设备身份。
    const mutable = ['pc_version', 'doubao_pc_version', 'web_tab_id'];
    const hasLiveVersion = () => performance.getEntriesByType('resource').some(entry => {
      try {
        const observed = new URL(entry.name);
        return observed.origin === origin && observed.pathname !== '/chat/completion'
          && Boolean(observed.searchParams.get('pc_version'));
      } catch { return false; }
    });
    // 官网SDK可能先于账号初始化请求就绪；首轮短暂等待真实网页参数，避免立即使用旧版本。
    for (let attempt = 0; attempt < 50 && !hasLiveVersion(); attempt += 1) {
      if (abort.signal.aborted) throw Error('cancelled');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    for (const entry of performance.getEntriesByType('resource')) {
      let observed;
      try { observed = new URL(entry.name); } catch { continue; }
      if (observed.origin !== origin || observed.pathname === '/chat/completion') continue;
      for (const key of mutable) {
        const value = observed.searchParams.get(key);
        if (value && value.length <= 4096) url.searchParams.set(key, value);
      }
    }
    url.searchParams.delete('a_bogus');
    url.searchParams.delete('X-Bogus');
    url.searchParams.sort();
    if (!['/samantha/chat/completion', '/top/v1'].includes(url.pathname)) {
      stage = 'signature_unavailable';
      for (let attempt = 0; attempt < 100 && typeof window.bdms?.frontierSign !== 'function'; attempt += 1) {
        if (abort.signal.aborted) throw Error('cancelled');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const signed = await window.bdms?.frontierSign?.(url.searchParams.toString());
      const fields = typeof signed === 'string' ? { 'X-Bogus': signed } : signed;
      if (!fields || typeof fields !== 'object') throw Error('signature_unavailable');
      for (const [key, value] of Object.entries(fields)) {
        if (['a_bogus', 'X-Bogus'].includes(key) && typeof value === 'string' && value) url.searchParams.set(key, value);
      }
      if (!url.searchParams.has('a_bogus') && !url.searchParams.has('X-Bogus')) throw Error('signature_unavailable');
    }
    const headers = { 'agw-js-conv': 'str', accept: '*/*', ...(arg.customHeaders || {}) };
    const csrf = document.cookie.match(/(?:^|;\s*)passport_csrf_token=([^;]+)/)?.[1];
    if (csrf) headers['x-tt-passport-csrf-token'] = csrf;
    let body;
    if (arg.bodyType === 'image-upload' && url.pathname === '/samantha/pages/upload_image') {
      if (!arg.body || !/^[\w.-]{1,128}$/u.test(arg.body.filename)
        || !/^[a-z0-9]{1,8}$/u.test(arg.body.extension)
        || typeof arg.body.base64 !== 'string' || arg.body.base64.length > 15 * 1024 * 1024) throw Error('invalid_upload');
      const raw = atob(arg.body.base64);
      const bytes = new Uint8Array(raw.length);
      for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
      body = new FormData();
      body.append('data', new Blob([bytes], { type: `image/${arg.body.extension}` }), arg.body.filename);
      body.append('file_type', arg.body.extension);
    } else if (arg.bodyType === 'json') {
      if (!/^application\/json(?:;\s*(?:charset|encoding)=utf-8)?$/iu.test(arg.contentType)) throw Error('encoding');
      headers['Content-Type'] = arg.contentType;
      body = JSON.stringify(arg.body);
    } else if (arg.bodyType !== 'none' || arg.method !== 'GET') throw Error('invalid_body_type');
    stage = 'fetch_failed';
    const meta = arg.body?.client_meta || {};
    const conversation = meta.conversation_id || meta.local_conversation_id || '';
    const options = { method: arg.method, headers, body, credentials: 'include', redirect: 'error',
      referrer: origin + '/chat/' + encodeURIComponent(conversation), signal: abort.signal };
    if (arg.prepareOnly) {
      stage = 'signature_unavailable';
      if (url.pathname !== '/chat/completion' || typeof window.__aascDoubaoPrepareRequest !== 'function') {
        throw Error('prepare_unavailable');
      }
      const prepared = await window.__aascDoubaoPrepareRequest(url.pathname + url.search, options);
      await report({ type: 'prepared', ...prepared });
      await report({ type: 'end' });
      return;
    }
    const response = await fetch(url.pathname + url.search, options);
    await streamPageResponse(response, report, arg.maxBytes);
  } catch (error) {
    const cancelled = abort.signal.aborted;
    abort.abort();
    const known = ['input_unavailable', 'composer_missing', 'send_unavailable', 'prepared_mismatch', 'prepare_timeout'];
    await report({ type: 'error', code: cancelled ? 'cancelled' : known.includes(error?.message) ? error.message : stage });
  } finally {
    delete window.__aascDoubaoAborts[arg.requestId];
  }
}

const PAGE_BOOTSTRAP_SOURCE = `(${installDoubaoPageRuntime.toString()})()`;
const createPageExecutionScript = arg => `(${executeDoubaoPageRequest.toString()})(${JSON.stringify(arg)},`
  + 'packet => AASCDoubaoRuntime.onPacket(JSON.stringify(packet)))';

/** 浏览器只交回动态签名参数；请求正文与Cookie始终由Node持有。 */
const acceptPreparedRequest = (prepared, packet, userAgent, code = 'doubao_browser_prepare') => {
  const invalid = () => Object.assign(new Error('豆包浏览器签名参数无效'), { code, statusCode: 502 });
  let signed;
  try { signed = new URL(packet?.url); } catch { throw invalid(); }
  const original = new URL(prepared.url);
  if (signed.origin !== 'https://www.doubao.com' || signed.pathname !== '/chat/completion'
    || signed.username || signed.password || signed.hash || signed.href.length > 16384
    || !signed.searchParams.get('a_bogus')
    || ['aid', 'device_id', 'web_id', 'fp'].some(key => signed.searchParams.get(key) !== original.searchParams.get(key))) throw invalid();
  const allowed = new Set(['accept', 'content-type', 'agw-js-conv', 'user-agent', 'origin', 'referer',
    'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'x-tt-passport-csrf-token', 'x-flow-trace', 'last-event-id']);
  if (!packet.headers || Array.isArray(packet.headers) || typeof packet.headers !== 'object'
    || Object.keys(packet.headers).length > allowed.size) throw invalid();
  const headers = {};
  for (const [name, value] of Object.entries(packet.headers)) {
    const lower = name.toLowerCase();
    if (!allowed.has(lower) || Object.hasOwn(headers, lower) || typeof value !== 'string'
      || value.length > 4096 || /[^\x20-\x7e]/u.test(value)) throw invalid();
    headers[lower] = value;
  }
  if (headers.origin !== signed.origin || headers['user-agent'] !== userAgent) throw invalid();
  return { ...prepared, url: signed.href, headers: { Cookie: prepared.headers.Cookie, ...headers }, doubaoHttp2: true };
};

/** 当前Cookie只信任平台API，不接收网页回调提供的Cookie；身份不一致立即停止。 */
const withBrowserCookie = (prepared, cookie, credentials) => {
  const { parseDoubaoCookieHeader } = require('./chat2api-doubao-cookie-snapshot');
  const session = value => parseDoubaoCookieHeader(value).find(item => item.name === 'sessionid')?.value;
  if (!session(cookie) || session(cookie) !== session(credentials.cookie)) {
    throw Object.assign(new Error('豆包浏览器账号身份已变化'), { code: 'doubao_browser_auth', statusCode: 401 });
  }
  return { ...prepared, headers: { ...prepared.headers, Cookie: cookie } };
};

module.exports = { PAGE_RUNTIME_VERSION, PAGE_BOOTSTRAP_SOURCE, installDoubaoPageRuntime,
  executeDoubaoPageRequest, createPageExecutionScript, acceptPreparedRequest, withBrowserCookie };
