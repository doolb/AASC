'use strict';

const { timingSafeEqual } = require('node:crypto');
const { normalizeDoubaoWebConfig } = require('./chat2api-doubao-web-config');
const { createDoubaoBrowserLauncher } = require('./chat2api-doubao-browser-launcher');
const { fetchInDoubaoPage, prepareInDoubaoPage } = require('./chat2api-doubao-browser-fetch');
const { PAGE_BOOTSTRAP_SOURCE, acceptPreparedRequest, withBrowserCookie } = require('./chat2api-doubao-page-runtime');

const ORIGIN = 'https://www.doubao.com';
const ERRORS = Object.freeze({
  disabled: [503, '豆包网页任务未启用'],
  account: [409, '豆包专用浏览器账号与所选账号不一致'],
  auth: [401, '豆包专用浏览器尚未登录，请在该窗口登录后重试'],
  busy: [409, '豆包当前会话正在等待网页回复'],
  page: [502, '豆包专用浏览器页面不可用'],
  upstream: [502, '豆包专用浏览器连接失败'],
});
const browserError = kind => {
  const entry = ERRORS[kind] || ERRORS.upstream;
  return Object.assign(new Error(entry[1]), { code: `doubao_browser_${kind}`, statusCode: entry[0] });
};
const sameSession = (expected, actual) => {
  const left = Buffer.from(expected || '');
  const right = Buffer.from(actual || '');
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
};
const accountSession = account => String(account?.credentials?.cookie || '').split(';')
  .map(part => part.trim()).find(part => part.startsWith('sessionid='))?.slice(10) || '';

/** 一个 AASC 会话固定一张官网页，避免不同会话的页面登录态和结果混淆。 */
const createDoubaoBrowserBridge = ({ getConfig = () => ({}), rootDir,
  launcher = createDoubaoBrowserLauncher({ rootDir }), fetchPage = fetchInDoubaoPage,
  preparePage = prepareInDoubaoPage } = {}) => {
  const pages = new Map();
  const busy = new Set();
  const running = new Set();
  const observers = new Map();
  let ownerAccount = '';
  let opening = Promise.resolve();
  let stopped = false;
  const stop = async () => {
    stopped = true;
    for (const controller of running) controller.abort();
    await opening.catch(() => {});
    for (const [browser, handler] of observers) browser.off?.('targetcreated', handler);
    observers.clear();
    running.clear();
    await Promise.allSettled([...pages.values()].map(page => page.close?.()));
    pages.clear();
    await launcher.close();
  };
  const request = async ({ account, sessionKey, prepared, signal, limits = {}, ephemeral = false,
    prepareOnly = false, closeAfterPrepare = false }) => {
    if (stopped) throw browserError('disabled');
    const config = normalizeDoubaoWebConfig(getConfig());
    if (config.mode !== 'browser-fetch') throw browserError('disabled');
    if (!account || account.providerId !== 'doubaochat'
      || (config.accountId && config.accountId !== account.accountId)) throw browserError('account');
    if (!prepared || typeof prepared.url !== 'string'
      || (!Object.hasOwn(prepared, 'data') && prepared.method !== 'GET')) throw browserError('upstream');
    if (busy.size && ownerAccount !== account.accountId) throw browserError('busy');
    ownerAccount = account.accountId;
    // 聊天状态由Node权威conversationId隔离，浏览器无需为每段聊天保留一个页签。
    const key = account.accountId;
    if (busy.has(key)) throw browserError('busy');
    busy.add(key);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) controller.abort();
    running.add(controller);
    let responseOwned = false;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      signal?.removeEventListener('abort', onAbort);
      running.delete(controller);
      busy.delete(key);
      if (ephemeral) {
        pages.delete(key);
        void page?.close().catch(() => {});
      }
    };
    let page;
    try {
      // 多个会话的首次请求也只能启动一个专用浏览器，后续操作复用同一受管实例。
      const next = opening.catch(() => {}).then(() => {
        if (stopped || controller.signal.aborted) throw browserError('disabled');
        return launcher.open(config, account.accountId);
      });
      opening = next;
      const browser = await next;
      if (stopped || controller.signal.aborted) throw browserError('disabled');
      if (browser.on && !observers.has(browser)) {
        const closeRestoredPage = async target => {
          // Vivaldi恢复旧窗口可能晚于newPage返回，等待本轮登记执行页后再整理迟到页签。
          await new Promise(resolve => setTimeout(resolve, 250));
          if (stopped) return;
          try {
            const candidate = await target.page();
            const current = pages.get(ownerAccount);
            if (candidate && current && candidate !== current && !candidate.isClosed()
              && (candidate.url().startsWith(`${ORIGIN}/`) || candidate.url() === 'about:blank')) await candidate.close();
          } catch { /* 目标可能已被浏览器关闭，无需重试整理。 */ }
        };
        browser.on('targetcreated', closeRestoredPage);
        observers.set(browser, closeRestoredPage);
      }
      page = pages.get(key);
      if (!page || page.isClosed()) {
        const existing = browser.pages ? await browser.pages() : [];
        const official = existing.filter(candidate => candidate.url().startsWith(`${ORIGIN}/`));
        page = official[0] || await browser.newPage();
        // 只整理专用profile中的官网旧页和空白页，先复用一页再安装共享文档脚本。
        await Promise.allSettled(existing.filter(candidate => candidate !== page
          && (candidate.url().startsWith(`${ORIGIN}/`) || candidate.url() === 'about:blank'))
          .map(candidate => candidate.close()));
        await page.evaluateOnNewDocument(PAGE_BOOTSTRAP_SOURCE);
        await page.goto(`${ORIGIN}/chat/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        pages.set(key, page);
      }
      const pageUrl = new URL(page.url());
      if (pageUrl.origin !== ORIGIN || !/^\/chat(?:\/[^/?#]*)?\/?$/u.test(pageUrl.pathname)) throw browserError('page');
      const cdp = await page.createCDPSession();
      try {
        const cookieResult = await cdp.send('Network.getCookies', { urls: [`${ORIGIN}/chat/`] });
        const sessions = (cookieResult.cookies || []).filter(cookie => cookie.name === 'sessionid'
          && ['doubao.com', '.doubao.com', 'www.doubao.com'].includes(cookie.domain));
        // 官网可同时设置www专属与父域同名Cookie；以发送到聊天页时优先的专属项核对账号。
        const preferred = sessions.filter(cookie => cookie.domain === 'www.doubao.com');
        const candidates = preferred.length ? preferred : sessions.filter(cookie => cookie.domain !== 'www.doubao.com');
        if (candidates.length !== 1 || !sameSession(accountSession(account), candidates[0].value)) throw browserError('auth');
      } finally { await cdp.detach().catch(() => {}); }
      const signing = await page.waitForFunction(() => typeof window.bdms?.frontierSign === 'function',
        { timeout: 30_000 }).catch(() => null);
      if (!signing) throw browserError('page');
      if (browser.pages) {
        await Promise.allSettled((await browser.pages()).filter(candidate => candidate !== page
          && (candidate.url().startsWith(`${ORIGIN}/`) || candidate.url() === 'about:blank'))
          .map(candidate => candidate.close()));
      }
      const options = { page, url: prepared.url, payload: prepared.data,
        bodyType: prepared.bodyType || 'json', method: prepared.method || 'POST',
        contentType: Object.entries(prepared.headers || {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1]
          || 'application/json',
        customHeaders: prepared.customHeaders || {},
        signal: controller.signal, timeoutMs: limits.timeoutMs, maxBytes: limits.streamBytes };
      if (prepareOnly) {
        const packet = await preparePage(options);
        const userAgent = await page.evaluate(() => navigator.userAgent);
        let result = acceptPreparedRequest(prepared, packet, userAgent);
        const session = await page.createCDPSession();
        try {
          const { cookies = [] } = await session.send('Network.getCookies', { urls: [`${ORIGIN}/chat/completion`] });
          const cookie = cookies.filter(item => item.value).sort((left, right) =>
            Number(right.domain === 'www.doubao.com') - Number(left.domain === 'www.doubao.com'))
            .map(item => `${item.name}=${item.value}`).join('; ');
          result = withBrowserCookie(result, cookie, account.credentials);
        } finally { await session.detach().catch(() => {}); }
        if (closeAfterPrepare) { pages.delete(key); await page.close(); }
        return result;
      }
      const response = await fetchPage(options);
      responseOwned = true;
      response.data.once('close', release);
      response.data.once('finish', release);
      response.data.once('end', release);
      return response;
    } catch (error) {
      if (error?.code?.startsWith('doubao_browser_')) throw error;
      throw browserError('upstream');
    } finally {
      if (!responseOwned) release();
    }
  };
  return { request, prepare: options => request({ ...options, prepareOnly: true }), stop,
    isBusy: () => busy.size > 0,
    cancel: () => { for (const controller of running) controller.abort(); } };
};

module.exports = { createDoubaoBrowserBridge, browserError };
