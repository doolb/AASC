'use strict';

const {
  normalizeDoubaoCookieSnapshot,
  canonicalDoubaoCookieFromSnapshot,
  parseDoubaoCookieHeader,
} = require('./chat2api-doubao-cookie-snapshot');
const { normalizeDoubaoCredentials } = require('./chat2api-doubao-chat-adapter');
const { normalizeDoubaoRequestProfile } = require('./chat2api-doubao-request-profile');

const PROVIDERS = Object.freeze({
  doubao: { id: 'doubaochat', loginUrl: 'https://www.doubao.com/chat/', origins: [
    'https://www.doubao.com', 'https://accounts.doubao.com',
  ] },
  qwen: { id: 'qwen', loginUrl: 'https://www.qianwen.com/', origins: [
    'https://www.qianwen.com', 'https://chat2.qianwen.com', 'https://chat2-api.qianwen.com',
  ] },
});

const fail = (code) => Object.assign(new Error(code), { code });

/** 按浏览器作用域顺序合成请求 Cookie；保留不同 Path/Domain 的同名项。 */
const cookieHeader = (cookies, origin) => {
  const host = new URL(origin).hostname;
  return cookies.map((cookie, index) => ({ cookie, index }))
    .filter(({ cookie }) => {
      const domain = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
      return domain && (host === domain || host.endsWith(`.${domain}`));
    })
    .sort((left, right) => {
      const pathOrder = String(right.cookie.path || '/').length - String(left.cookie.path || '/').length;
      const domainOrder = Number(right.cookie.domain === host) - Number(left.cookie.domain === host);
      return pathOrder || domainOrder || left.index - right.index;
    })
    .map(({ cookie }) => `${cookie.name}=${cookie.value}`).join('; ');
};

const readCookies = async (page, origins) => {
  const cdp = await page.createCDPSession();
  try {
    const result = {};
    for (const origin of origins) {
      const urls = [origin + '/', ...(origin === 'https://www.doubao.com' ? [origin + '/chat/'] : [])];
      const reply = await cdp.send('Network.getCookies', { urls });
      result[origin] = cookieHeader(reply.cookies || [], origin);
    }
    return result;
  } finally { await cdp.detach(); }
};

const webIdFromStorage = (raw) => {
  if (typeof raw !== 'string' || raw.length > 16 * 1024) throw fail('doubao_profile_incomplete');
  try {
    const value = JSON.parse(raw).web_id;
    if ((typeof value === 'string' || Number.isSafeInteger(value)) && /^\d{1,32}$/.test(String(value))) return String(value);
  } catch (_error) { /* 页面资料缺失时不猜测设备 ID。 */ }
  throw fail('doubao_profile_incomplete');
};

const captureDoubao = async (page, requestProfile) => {
  const snapshot = normalizeDoubaoCookieSnapshot(await readCookies(page, PROVIDERS.doubao.origins));
  const cookie = canonicalDoubaoCookieFromSnapshot(snapshot);
  const fp = parseDoubaoCookieHeader(snapshot['https://www.doubao.com'])
    .find(item => item.name === 's_v_web_id')?.value || '';
  // 只从当前官网页面读取 Android 同样使用的两个 localStorage 键和 UA。
  const profileSource = await page.evaluate(() => ({
    device: localStorage.getItem('samantha_web_web_id'),
    tokens: localStorage.getItem('__tea_cache_tokens_497858'),
    userAgent: navigator.userAgent,
  }));
  const nodeProfile = {
    deviceId: webIdFromStorage(profileSource.device),
    webId: webIdFromStorage(profileSource.tokens),
    fp,
    userAgent: profileSource.userAgent,
    pcVersion: '3.41.0',
  };
  const credentials = normalizeDoubaoCredentials({ cookie, cookieSnapshot: snapshot, nodeProfile,
    ...(requestProfile ? { requestProfile } : {}) });
  return { credentials, count: parseDoubaoCookieHeader(snapshot['https://www.doubao.com']).length
    + (snapshot['https://accounts.doubao.com'] ? parseDoubaoCookieHeader(snapshot['https://accounts.doubao.com']).length : 0) };
};

/** 浏览器完整回复仅判定终态和非空正文；不保存或打印用户原话与模型回复。 */
const browserChatCompleted = raw => {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 8 * 1024 * 1024) return false;
  let answer = false;
  let completed = false;
  const hasText = value => value && typeof value === 'object' && (
    (typeof value.text_block?.text === 'string' && Boolean(value.text_block.text.trim()))
    || Object.values(value).some(child => child && typeof child === 'object' && hasText(child)));
  for (const frame of raw.split(/\r?\n\r?\n/u)) {
    const event = frame.match(/(?:^|\n)event:\s*([^\r\n]+)/u)?.[1] || '';
    const dataText = frame.match(/(?:^|\n)data:\s*([^\r\n]+)/u)?.[1];
    let data;
    try { data = dataText ? JSON.parse(dataText) : {}; } catch { return false; }
    if (event === 'STREAM_ERROR' || (Number(data.error_code ?? data.code ?? 0) !== 0)) return false;
    if (event === 'CHUNK_DELTA' && typeof data.text === 'string' && data.text.trim()) answer = true;
    if (event === 'STREAM_CHUNK' && data.message?.role !== 'user' && hasText(data)) answer = true;
    if (event === 'SSE_REPLY_END' && !Object.hasOwn(data, 'msg_finish_attr')
      && !Object.hasOwn(data, 'answer_finish_attr')) completed = true;
  }
  return answer && completed;
};

/** 先挂被动CDP监听，再等用户在官网登录页的新会话手动发送消息；不由工具产生对话。 */
const observeDoubaoCompletion = async (page, timeoutMs = 90_000) => {
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable', { maxPostDataSize: 1024 * 1024 });
  const requests = new Map();
  const earlyHeaders = new Map();
  let resolveSample;
  let rejectSample;
  const sample = new Promise((resolve, reject) => { resolveSample = resolve; rejectSample = reject; });
  let timer;
  let capturedSample;
  const allowed = value => {
    try { const url = new URL(value); return url.origin === 'https://www.doubao.com' && url.pathname === '/chat/completion'; }
    catch { return false; }
  };
  cdp.on('Network.requestWillBeSent', event => {
    if (event.request.method !== 'POST' || !allowed(event.request.url)) return;
    requests.set(event.requestId, { url: event.request.url,
      headers: { ...event.request.headers, ...(earlyHeaders.get(event.requestId) || {}) },
      body: event.request.postData || '', status: 0 });
    earlyHeaders.delete(event.requestId);
  });
  cdp.on('Network.requestWillBeSentExtraInfo', event => {
    const request = requests.get(event.requestId);
    if (request) request.headers = { ...request.headers, ...event.headers };
    else if (earlyHeaders.size < 32) earlyHeaders.set(event.requestId, event.headers);
  });
  cdp.on('Network.responseReceived', event => {
    const request = requests.get(event.requestId);
    if (request) request.status = event.response.status;
  });
  cdp.on('Network.loadingFinished', async event => {
    const request = requests.get(event.requestId);
    requests.delete(event.requestId);
    earlyHeaders.delete(event.requestId);
    if (!request || request.status !== 200 || !request.body) return;
    try {
      const result = await cdp.send('Network.getResponseBody', { requestId: event.requestId });
      const raw = result.base64Encoded ? Buffer.from(result.body, 'base64').toString('utf8') : result.body;
      if (!browserChatCompleted(raw)) return;
      capturedSample = normalizeDoubaoRequestProfile({ ...request, browserVerifiedAt: new Date().toISOString() });
      resolveSample(capturedSample);
    } catch { /* 失败样本继续等待下一条官网请求；不输出包含凭据的URL。 */ }
  });
  cdp.on('Network.loadingFailed', event => { requests.delete(event.requestId); earlyHeaders.delete(event.requestId); });
  return { getSample: () => capturedSample, wait: () => {
    timer ||= setTimeout(() => rejectSample(fail('doubao_request_sample_missing')), timeoutMs);
    return sample;
  }, close: async () => { clearTimeout(timer); requests.clear(); earlyHeaders.clear(); await cdp.detach(); } };
};

const captureQwen = async (page) => {
  const headers = await readCookies(page, PROVIDERS.qwen.origins);
  const tickets = new Set(Object.values(headers).filter(Boolean).flatMap(header => header.split(';')
    .map(part => part.trim()).filter(part => part.startsWith('tongyi_sso_ticket='))
    .map(part => part.slice('tongyi_sso_ticket='.length))));
  if (tickets.size !== 1) throw fail('qwen_ticket_missing_or_ambiguous');
  const ticket = [...tickets][0];
  if (!ticket || ticket.length > 4096 || /[^\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]/u.test(ticket)) throw fail('qwen_ticket_invalid');
  return { credentials: { ticket }, count: 1 };
};


module.exports = { cookieHeader, readCookies, webIdFromStorage, captureDoubao, captureQwen, browserChatCompleted, observeDoubaoCompletion };
