'use strict';

const { timingSafeEqual } = require('node:crypto');
const { normalizeDoubaoWebConfig } = require('./chat2api-doubao-web-config');
const { createDoubaoBrowserLauncher } = require('./chat2api-doubao-browser-launcher');
const { fetchInDoubaoPage } = require('./chat2api-doubao-browser-fetch');

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
  launcher = createDoubaoBrowserLauncher({ rootDir }), fetchPage = fetchInDoubaoPage } = {}) => {
  const pages = new Map();
  const busy = new Set();
  const running = new Set();
  const stop = async () => {
    for (const controller of running) controller.abort();
    running.clear();
    pages.clear();
    await launcher.close();
  };
  const request = async ({ account, sessionKey, prepared, signal, limits = {}, ephemeral = false }) => {
    const config = normalizeDoubaoWebConfig(getConfig());
    if (config.mode !== 'browser-fetch') throw browserError('disabled');
    if (!account || account.providerId !== 'doubaochat'
      || (config.accountId && config.accountId !== account.accountId)) throw browserError('account');
    if (!prepared || typeof prepared.url !== 'string'
      || (!Object.hasOwn(prepared, 'data') && prepared.method !== 'GET')) throw browserError('upstream');
    const key = `${account.accountId}:${sessionKey || 'new'}`;
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
      const browser = await launcher.open(config, account.accountId);
      page = pages.get(key);
      if (!page || page.isClosed()) {
        page = await browser.newPage();
        await page.goto(`${ORIGIN}/chat/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        pages.set(key, page);
      }
      const pageUrl = new URL(page.url());
      if (pageUrl.origin !== ORIGIN || !['/chat', '/chat/'].includes(pageUrl.pathname)) throw browserError('page');
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
      const response = await fetchPage({ page, url: prepared.url, payload: prepared.data,
        bodyType: prepared.bodyType || 'json', method: prepared.method || 'POST',
        customHeaders: prepared.customHeaders || {},
        signal: controller.signal, timeoutMs: limits.timeoutMs, maxBytes: limits.streamBytes });
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
  return { request, stop, cancel: () => { for (const controller of running) controller.abort(); } };
};

module.exports = { createDoubaoBrowserBridge, browserError };
