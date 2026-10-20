'use strict';

const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const {
  normalizeDoubaoCookieSnapshot,
  canonicalDoubaoCookieFromSnapshot,
  parseDoubaoCookieHeader,
} = require('../../src/apps/server/modules/chat2api/chat2api-doubao-cookie-snapshot');
const { normalizeDoubaoCredentials } = require('../../src/apps/server/modules/chat2api/chat2api-doubao-chat-adapter');

const DEFAULT_DEBUG_PORT = 9222;
const DEFAULT_API_BASE = 'http://127.0.0.1:8083';
const PROVIDERS = Object.freeze({
  doubao: { id: 'doubaochat', loginUrl: 'https://www.doubao.com/chat/', origins: [
    'https://www.doubao.com', 'https://accounts.doubao.com',
  ] },
  qwen: { id: 'qwen', loginUrl: 'https://www.qianwen.com/', origins: [
    'https://www.qianwen.com', 'https://chat2.qianwen.com', 'https://chat2-api.qianwen.com',
  ] },
});

const fail = (code) => Object.assign(new Error(code), { code });

/** 命令只接受 Provider；端口和本机服务地址是可选覆盖，不接受远程调试或远程凭据上传。 */
const parseArguments = (args) => {
  const [providerName, ...options] = args;
  if (!Object.hasOwn(PROVIDERS, providerName || '')) throw fail('provider_must_be_doubao_or_qwen');
  let debugPort = DEFAULT_DEBUG_PORT;
  let apiBase = DEFAULT_API_BASE;
  let now = false;
  for (const option of options) {
    if (option === '--now') { now = true; continue; }
    if (option.startsWith('--debug-port=')) {
      const value = option.slice('--debug-port='.length);
      if (!/^\d{1,5}$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw fail('invalid_debug_port');
      debugPort = Number(value);
      continue;
    }
    if (option.startsWith('--api-base=')) {
      let address;
      try { address = new URL(option.slice('--api-base='.length)); }
      catch (_error) { throw fail('invalid_api_base'); }
      if (address.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname)
        || address.username || address.password || address.search || address.hash || address.pathname !== '/') throw fail('invalid_api_base');
      apiBase = address.origin;
      continue;
    }
    throw fail('unknown_argument');
  }
  return { providerName, provider: PROVIDERS[providerName], debugPort, apiBase, now };
};

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

const captureDoubao = async (page) => {
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
  const credentials = normalizeDoubaoCredentials({ cookie, cookieSnapshot: snapshot, nodeProfile });
  return { credentials, count: parseDoubaoCookieHeader(snapshot['https://www.doubao.com']).length
    + (snapshot['https://accounts.doubao.com'] ? parseDoubaoCookieHeader(snapshot['https://accounts.doubao.com']).length : 0) };
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

const chooseAccount = (accounts, providerId) => {
  if (!Array.isArray(accounts)) throw fail('invalid_account_list');
  const matches = accounts.filter(account => account.providerId === providerId);
  if (matches.length > 1) throw fail('multiple_provider_accounts');
  return matches[0] || null;
};

/** 响应错误只保留状态和公开错误码，避免服务端错误文本意外夹带凭据。 */
const createApiClient = (apiBase, fetchImpl = fetch) => async (method, pathname, body) => {
  const response = await fetchImpl(apiBase + pathname, {
    method, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json().catch(() => null);
  const reportedCode = result?.code || result?.error?.code || 'failed';
  const safeCode = typeof reportedCode === 'string' && /^[a-z0-9_]{1,64}$/i.test(reportedCode)
    ? reportedCode : 'failed';
  if (!response.ok) throw fail(`chat2api_http_${response.status}_${safeCode}`);
  return result;
};

const saveCaptured = async ({ providerName, provider, captured, api }) => {
  const account = chooseAccount(await api('GET', '/api/chat2api/accounts'), provider.id);
  if (providerName === 'doubao' && account) {
    const session = await api('POST', `/api/chat2api/accounts/${encodeURIComponent(account.accountId)}/web-session`, {});
    const consumed = await api('POST', '/api/chat2api/accounts/web-session/consume', { sessionId: session.sessionId });
    const result = await api('POST', '/api/chat2api/accounts/web-session/refresh', {
      refreshToken: consumed.refreshToken, cookieSnapshot: captured.credentials.cookieSnapshot,
    });
    if (result?.refreshed !== true) throw fail('doubao_refresh_failed');
    return { accountId: account.accountId, mode: 'updated' };
  }
  const started = await api('POST', '/api/chat2api/oauth/start', { providerId: provider.id });
  const completed = await api('POST', '/api/chat2api/oauth/complete', {
    state: started.state, providerId: provider.id, credentials: captured.credentials,
    ...(account ? { accountId: account.accountId } : {}),
  });
  if (!completed?.account?.accountId) throw fail('login_save_failed');
  return { accountId: completed.account.accountId, mode: account ? 'updated' : 'created' };
};

const findOrOpenPage = async (browser, provider) => {
  const pages = await browser.pages();
  const loginOrigin = new URL(provider.loginUrl).origin;
  const matching = pages.filter(page => {
    try { return new URL(page.url()).origin === loginOrigin; }
    catch (_error) { return false; }
  });
  if (matching.length > 1) throw fail('multiple_provider_pages');
  if (matching.length === 1) return matching[0];
  const page = await browser.newPage();
  await page.goto(provider.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  return page;
};

const run = async (args = process.argv.slice(2), dependencies = {}) => {
  const options = parseArguments(args);
  const puppeteer = dependencies.puppeteer || require('puppeteer-core');
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${options.debugPort}` });
  try {
    const page = await findOrOpenPage(browser, options.provider);
    if (!options.now) {
      if (!stdin.isTTY) throw fail('interactive_terminal_required_use_now');
      const prompt = readline.createInterface({ input: stdin, output: stdout });
      try { await prompt.question(`${options.providerName} 网页登录完成后按 Enter 保存凭据：`); }
      finally { prompt.close(); }
    }
    if (!options.provider.origins.includes(new URL(page.url()).origin)) throw fail('provider_page_origin_changed');
    const captured = options.providerName === 'doubao' ? await captureDoubao(page) : await captureQwen(page);
    const api = createApiClient(options.apiBase, dependencies.fetch || fetch);
    const saved = await saveCaptured({ ...options, captured, api });
    stdout.write(`${options.providerName} ${saved.mode} ${saved.accountId}; cookies=${captured.count}\n`);
    return saved;
  } finally { browser.disconnect(); }
};

if (require.main === module) {
  run().catch((error) => {
    console.error(`浏览器凭据保存失败：${error.code || 'unexpected_error'}`);
    process.exitCode = 1;
  });
}

module.exports = { PROVIDERS, parseArguments, cookieHeader, readCookies, webIdFromStorage,
  captureDoubao, captureQwen, chooseAccount, createApiClient, saveCaptured, findOrOpenPage, run };
