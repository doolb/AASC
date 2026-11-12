'use strict';

const fs = require('node:fs/promises');
const { constants: fsConstants } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_SESSIONS = 4;
function normalizeSessionLimit(value) {
  const number = Number(value ?? 1);
  if (!Number.isInteger(number) || number < 1 || number > MAX_SESSIONS) throw new Error('浏览器会话上限须为 1 至 4');
  return number;
}
const MAX_RESPONSE = 2 * 1024 * 1024;
const SCRIPT_PATH = path.resolve(__dirname, '../../../web-mediacenter/ui/public/userscripts/aasc-media-capture.user.js');

function originOf(value) {
  let url;
  try { url = new URL(String(value)); } catch { throw new Error('网站地址无效'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('仅允许 HTTPS 网站地址');
  return url.origin;
}
function normalizeOrigins(input) {
  const entries = Array.isArray(input) ? input : String(input || '').split(/[\s,，]+/);
  const origins = [...new Set(entries.filter(Boolean).map(originOf))];
  if (origins.length > 20) throw new Error('允许的网站数量不能超过 20 个');
  return origins;
}
function proxyArgument(value) {
  if (!value) return '';
  let url;
  try { url = new URL(value); } catch { throw new Error('浏览器代理地址无效'); }
  if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('浏览器代理仅支持无凭据的 HTTP、HTTPS 或 SOCKS5 地址');
  // Chromium 的 SOCKS5 总是在代理侧解析域名，对应已有的 socks5h 配置。
  const protocol = url.protocol === 'socks5h:' ? 'socks5:' : url.protocol;
  return `${protocol}//${url.host}`;
}

// Puppeteer 的 executablePath 需要实际路径，兼容任务参数填写 vivaldi 命令名。
async function resolveExecutable(value) {
  const executable = String(value || '');
  if (!executable || executable.includes('\0')) throw new Error('Vivaldi 路径无效');
  const candidates = executable.includes('/') ? [path.resolve(executable)] : String(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(dir => path.resolve(dir, executable));
  for (const candidate of candidates) {
    try { await fs.access(candidate, fsConstants.X_OK); if ((await fs.stat(candidate)).isFile()) return candidate; } catch { /* 继续检查下一个 PATH 目录。 */ }
  }
  throw new Error('找不到可执行的 Vivaldi，请检查浏览器路径');
}

// 页面内只判断已知挑战信号；不将待验证页面当作可用内容。
async function inspectPage(page, expectedOrigin) {
  const current = new URL(page.url());
  if (current.origin !== expectedOrigin) throw Object.assign(new Error('页面跳转到未授权的网站'), { code: 'BROWSER_MEDIA_ORIGIN' });
  return page.evaluate(() => {
    const title = String(document.title || '').toLowerCase();
    const challenge = /just a moment|checking your browser|请稍候|安全验证/.test(title)
      || Boolean(document.querySelector('#challenge-running, #challenge-form, .cf-challenge'));
    return challenge ? 'challenge' : 'ready';
  });
}

function createBrowserMediaService({ rootDir, browserExecutable = 'vivaldi', allowedOrigins = [], display = '', maxSessions = 1, launch, resolveBrowser = resolveExecutable, readScript, rejectProxy = false, onStatus = () => {} } = {}) {
  const origins = normalizeOrigins(allowedOrigins);
  const sessionLimit = normalizeSessionLimit(maxSessions);
  const sessions = new Map();
  const closing = new Map();
  let running = true;
  let latest = '';
  const getStatus = () => ({ running, sessions: [...sessions.values()].map(entry => ({ sourceId: entry.sourceId, origin: entry.origin, state: entry.state })) });
  const update = (entry, state) => { entry.state = state; onStatus(getStatus()); };
  function validate(options) {
    if (!running) throw Object.assign(new Error('浏览器媒体任务已停止'), { code: 'BROWSER_MEDIA_DISABLED' });
    const sourceId = String(options?.sourceId || '');
    if (!/^[a-z][a-z0-9._-]{1,63}$/.test(sourceId)) throw new Error('媒体来源标识无效');
    const origin = originOf(options?.pageUrl);
    // 留空表示允许所有 HTTPS 站点；显式配置列表时仍严格匹配站点来源。
    if (origins.length > 0 && !origins.includes(origin)) throw Object.assign(new Error('网站不在允许列表中'), { code: 'BROWSER_MEDIA_ORIGIN' });
    const proxy = proxyArgument(options.proxyUrl);
    if (rejectProxy && proxy) throw new Error('Android 网页媒体暂不支持独立代理');
    return { sourceId, origin, pageUrl: new URL(options.pageUrl).href, proxy };
  }
  async function session(options) {
    const details = validate(options);
    const key = crypto.createHash('sha256').update(JSON.stringify([details.sourceId, details.origin, details.proxy])).digest('hex');
    let entry = sessions.get(key);
    if (!entry) {
      if (sessions.size >= sessionLimit) throw new Error('浏览器会话数量已达上限');
      entry = { ...details, state: 'starting', browser: null, page: null, promise: null, chain: Promise.resolve() };
      sessions.set(key, entry);
      entry.promise = (async () => {
        if (closing.has(key)) await closing.get(key);
        if (!running) throw new Error('浏览器媒体任务已停止');
        const profile = path.join(rootDir, 'browser-media', key);
        await fs.mkdir(profile, { recursive: true, mode: 0o700 });
        await fs.chmod(profile, 0o700);
        const args = ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--no-first-run'];
        if (details.proxy) args.push(`--proxy-server=${details.proxy}`, '--proxy-bypass-list=<-loopback>');
        else args.push('--no-proxy-server');
        const start = launch || (config => require('puppeteer-core').launch(config));
        const executablePath = await resolveBrowser(browserExecutable);
        const browser = await start({ executablePath, userDataDir: profile, headless: false, defaultViewport: null, args,
          ...(display ? { env: { ...process.env, DISPLAY: display } } : {}) });
        entry.browser = browser;
        if (!running) { await browser.close(); throw new Error('浏览器媒体任务已停止'); }
        const pages = await browser.pages();
        const page = pages[0] || await browser.newPage();
        entry.page = page;
        // 只限制主页面导航，站点自己的图片和脚本仍按浏览器规则加载。
        await page.setRequestInterception(true);
        page.on('request', request => {
          if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
            let same = false;
            try { same = new URL(request.url()).origin === details.origin; } catch {}
            if (!same) { void request.abort().catch(() => {}); return; }
          }
          void request.continue().catch(() => {});
        });
        page.on('close', () => {
          if (!running || sessions.get(key) !== entry) return;
          sessions.delete(key);
          update(entry, 'closed');
          const cleanup = Promise.resolve().then(() => browser.close()).catch(() => {});
          closing.set(key, cleanup);
          void cleanup.finally(() => { if (closing.get(key) === cleanup) closing.delete(key); });
        });
        browser.on?.('disconnected', () => { if (sessions.get(key) === entry) { sessions.delete(key); update(entry, 'closed'); } });
        update(entry, 'ready');
      })().catch(async error => {
        sessions.delete(key);
        await entry.browser?.close().catch(() => {});
        throw error;
      });
    }
    await entry.promise;
    latest = key;
    return { entry, details };
  }
  async function withPage(options, operation) {
    const { entry, details } = await session(options);
    const execute = entry.chain.catch(() => {}).then(async () => {
      if (!running || !entry.page || entry.page.isClosed()) throw new Error('浏览器页面不可用');
      const current = entry.page.url();
      if (current !== details.pageUrl) {
        update(entry, 'loading');
        const response = await entry.page.goto(details.pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const state = await inspectPage(entry.page, details.origin);
        if (state === 'challenge') { update(entry, 'challenge'); throw Object.assign(new Error('网站需要验证，请在专用浏览器中完成后重试'), { code: 'BROWSER_MEDIA_CHALLENGE' }); }
        if (response && response.status() >= 400) { update(entry, 'error'); throw Object.assign(new Error(`网站返回 HTTP ${response.status()}`), { code: 'BROWSER_MEDIA_UPSTREAM' }); }
      }
      const state = await inspectPage(entry.page, details.origin);
      update(entry, state);
      if (state === 'challenge') throw Object.assign(new Error('网站需要验证，请在专用浏览器中完成后重试'), { code: 'BROWSER_MEDIA_CHALLENGE' });
      return operation(entry.page, details, entry);
    }).catch(error => {
      if (running && entry.state !== 'challenge' && entry.state !== 'blocked') update(entry, 'error');
      throw error;
    });
    entry.chain = execute;
    return execute;
  }
  async function request(options) {
    return withPage(options, async (page, details, entry) => {
      const target = new URL(String(options.url || details.pageUrl));
      if (target.origin !== details.origin || target.username || target.password) throw new Error('浏览器请求必须与页面同源');
      const responseType = options.responseType || 'text';
      if (!['text', 'binary'].includes(responseType)) throw new Error('浏览器响应类型无效');
      const range = options.range || '';
      if (range && (typeof range !== 'string' || !/^bytes=\d+-\d*$/.test(range) || range.length > 100)) throw new Error('浏览器请求 Range 无效');
      const result = await page.evaluate(async ({ url, limit, range, responseType }) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        try {
          const response = await fetch(url, { method: 'GET', credentials: 'same-origin', redirect: 'error', signal: controller.signal, headers: range ? { Range: range } : {} });
          const reader = response.body?.getReader(); const chunks = []; let length = 0;
          if (reader) for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > limit) { await reader.cancel(); throw new Error('响应过大'); } chunks.push(part.value); }
          const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          let body;
          if (responseType === 'binary') {
            let data = ''; for (let i = 0; i < bytes.length; i += 8192) data += String.fromCharCode(...bytes.subarray(i, i + 8192));
            body = btoa(data);
          } else body = new TextDecoder().decode(bytes);
          return { status: response.status, contentType: response.headers.get('content-type') || '', contentRange: response.headers.get('content-range') || '', body };
        } finally { clearTimeout(timer); }
      }, { url: target.href, limit: MAX_RESPONSE, range, responseType });
      if (result.status === 403 || (responseType === 'text' && /<title>\s*just a moment/i.test(result.body))) { update(entry, 'blocked'); throw Object.assign(new Error('网站请求被拒绝或需要验证'), { code: 'BROWSER_MEDIA_BLOCKED' }); }
      if (responseType === 'binary') {
        if (typeof result.body !== 'string' || result.body.length > Math.ceil(MAX_RESPONSE / 3) * 4) throw new Error('浏览器响应过大');
        result.body = Buffer.from(result.body, 'base64');
      }
      return result;
    });
  }
  async function extract(options) {
    const source = await (readScript || (() => fs.readFile(SCRIPT_PATH, 'utf8')))();
    if (typeof source !== 'string' || source.length > 256 * 1024) throw new Error('媒体采集脚本无效');
    return withPage(options, async (page, details) => {
      const result = await page.evaluate(script => {
      const actions = new Map(); let captured = null; let message = '';
      const GM_getValue = key => key === 'server' ? 'http://127.0.0.1' : 'a'.repeat(64);
      const GM_setValue = () => {};
      const GM_registerMenuCommand = (name, handler) => actions.set(name, handler);
      const GM_xmlhttpRequest = request => { captured = JSON.parse(request.data); };
      const prompt = (_text, fallback) => fallback || '';
      const alert = text => { message = String(text); };
      // 仅执行项目内固定脚本；不接受站点或调用方提交代码，不授予实际跨域请求。
      new Function('GM_getValue', 'GM_setValue', 'GM_registerMenuCommand', 'GM_xmlhttpRequest', 'prompt', 'alert', script)(GM_getValue, GM_setValue, GM_registerMenuCommand, GM_xmlhttpRequest, prompt, alert);
      const capture = actions.get('AASC：采集当前页面媒体');
      if (!capture) throw new Error('采集脚本入口不可用');
      capture();
      return captured || { sourceUrl: location.href, items: [], message };
      }, source);
      if (originOf(result?.sourceUrl) !== details.origin || !Array.isArray(result?.items) || result.items.length > 200) throw new Error('媒体采集结果无效');
      return { sourceUrl: String(result.sourceUrl).slice(0, 8192), content: String(result.content || '').slice(0, 200), title: String(result.title || '').slice(0, 200),
        items: result.items.map(item => {
          const url = new URL(item.url);
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 8192) throw new Error('媒体采集地址无效');
          return { url: url.href, title: String(item.title || '').slice(0, 200), mediaType: ['video', 'audio', 'image'].includes(item.mediaType) ? item.mediaType : 'video' };
        }) };
    });
  }
  async function showPage() {
    const entry = sessions.get(latest);
    if (!entry) throw new Error('尚无运行页面，请先由媒体源发起请求');
    await entry.promise;
    await entry.page.bringToFront();
    return true;
  }
  async function extractCurrent() {
    const entry = sessions.get(latest);
    if (!entry) throw new Error('尚无运行页面，请先打开网站');
    await entry.promise;
    return extract({ sourceId: entry.sourceId, pageUrl: entry.page.url(), proxyUrl: entry.proxy });
  }
  async function stop() {
    if (!running) return;
    running = false;
    const entries = [...sessions.values()];
    await Promise.allSettled(entries.map(async entry => { await entry.promise.catch(() => {}); await entry.browser?.close().catch(() => {}); }));
    await Promise.allSettled([...closing.values()]);
    sessions.clear(); onStatus(getStatus());
  }
  return { open: options => withPage(options, async () => ({ ready: true })), request, extract, extractCurrent, showPage, status: getStatus, stop };
}
module.exports = { createBrowserMediaService, normalizeOrigins, normalizeSessionLimit, proxyArgument, inspectPage, resolveExecutable };
