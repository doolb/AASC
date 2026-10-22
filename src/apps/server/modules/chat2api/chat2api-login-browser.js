'use strict';

const { registerLoginPage, restoreLoginPage } = require('./chat2api-login-page-role');
const { captureDoubao, captureQwen, readCookies, observeDoubaoCompletion } = require('./chat2api-browser-capture');
const { acquireDoubaoBrowserPort } = require('./chat2api-doubao-browser-port');
const { DEFAULT_ROOT_DIR } = require('./chat2api-data-store');
const publicError = message => Object.assign(new Error(message), { publicMessage: message });

/** 登录和运行借用同一平台桥；关闭登录tab不结束运行租约。 */
function createLoginBrowserHost({ acquirePort = acquireDoubaoBrowserPort } = {}) {
  const leases = new Map();
  return {
    async acquire({ rootDir = DEFAULT_ROOT_DIR, config, accountId, accountIds, providerId } = {}) {
      let port = leases.get(rootDir);
      if (!port) {
        port = acquirePort({ rootDir, config });
        leases.set(rootDir, port);
      }
      return port.openLogin({ accountId, accountIds, providerId });
    },
    async stop() {
      const pending = [...leases.values()]; leases.clear();
      await Promise.allSettled(pending.map(port => port.stop()));
    },
  };
}

/** 登录与运行使用同一网站环境，关闭只回收本次标签，保留浏览器凭据。 */
async function openLoginBrowser({ profile, providerId, restore, host, browserOptions } = {}) {
  if (!host) throw new Error('登录浏览器需要服务级宿主');
  const rootDir = browserOptions?.rootDir || DEFAULT_ROOT_DIR;
  let browser;
  let lease;
  let unregister;
  let popupHandler;
  let page;
  let cdp;
  let observer;
  let closed = false;
  let blocked = '';
  const captured = {};
  const allowed = url => {
    try { return profile.allowedOrigins.includes(new URL(url).origin); } catch { return false; }
  };
  const close = async () => {
    if (closed) return;
    closed = true;
    await observer?.close().catch(() => {});
    await cdp?.detach().catch(() => {});
    if (popupHandler) browser?.off('targetcreated', popupHandler);
    try {
      if (page && !page.isClosed()) await page.close();
    } finally { try { await unregister?.(); } finally { await lease?.release(); } }
  };
  try {
    lease = await host.acquire(browserOptions);
    browser = lease.browser;
    // 同一默认Context共享网页登录态；仅替换先前明确登记的登录tab。
    const previous = await restoreLoginPage(browser, rootDir);
    if (previous && !previous.isClosed()) await previous.close();
    page = await browser.newPage();
    unregister = await registerLoginPage(browser, page, rootDir);
    await page.setViewport({ width: 1024, height: 720, deviceScaleFactor: 1 });
    // 仅接管登录页直接打开的弹窗，不触碰宿主或其他页面。
    popupHandler = async target => {
      try {
        if (closed || target.opener() !== page.target()) return;
        const popup = await target.page();
        if (!popup || popup === page) return;
        const url = popup.url();
        await popup.close();
        if (!closed && allowed(url)) await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch { /* 页面关闭或导航竞争由下一帧状态处理。 */ }
    };
    browser.on('targetcreated', popupHandler);
    await page.setRequestInterception(true);
    page.on('request', request => {
      try {
        const url = request.url();
        if (request.isNavigationRequest() && request.frame() === page.mainFrame() && !allowed(url)) {
          blocked = '登录跳转地址不在此Provider的登录声明中';
          void request.abort().catch(() => {}); return;
        }
        const authorization = profile.authorization;
        if (authorization && allowed(url)) {
          const value = request.headers().authorization;
          const prefix = authorization.scheme + ' ';
          if (typeof value === 'string' && value.startsWith(prefix) && value.length <= 8192) captured[authorization.field] = value.slice(prefix.length);
        }
        void request.continue().catch(() => {});
      } catch { void request.abort().catch(() => {}); }
    });
    cdp = await page.createCDPSession();
    if (restore) {
      const cookies = (restore.cookieMappings || []).filter(item => profile.allowedOrigins.includes(item.origin))
        .map(item => ({ name: item.name, value: item.value, url: item.origin + '/' }));
      if (cookies.length) await cdp.send('Network.setCookies', { cookies });
      const mappings = (restore.localStorageMappings || []).filter(item => profile.allowedOrigins.includes(item.origin));
      await page.evaluateOnNewDocument(items => {
        for (const item of items) if (location.origin === item.origin && !sessionStorage.getItem('__aasc_login_restored')) {
          localStorage.setItem(item.key, item.value);
        }
        sessionStorage.setItem('__aasc_login_restored', '1');
      }, mappings);
    }
    if (providerId === 'doubaochat') observer = await observeDoubaoCompletion(page);
    await page.goto(profile.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return {
      close,
      async frame() {
        if (closed || page.isClosed()) throw publicError('登录页面已关闭');
        const image = await page.screenshot({ type: 'jpeg', quality: 65, encoding: 'base64' });
        if (image.length > 2 * 1024 * 1024) throw publicError('登录画面过大，请重试');
        return { image, width: 1024, height: 720, notice: blocked };
      },
      async input(input) {
        await page.bringToFront();
        const actions = {
          move: () => page.mouse.move(input.x, input.y),
          down: async () => { await page.mouse.move(input.x, input.y); await page.mouse.down({ button: 'left' }); },
          up: async () => { await page.mouse.move(input.x, input.y); await page.mouse.up({ button: 'left' }); },
          wheel: () => page.mouse.wheel({ deltaX: input.deltaX, deltaY: input.deltaY }),
          text: () => cdp.send('Input.insertText', { text: input.text }),
          key: () => page.keyboard.press(input.key),
        };
        await actions[input.kind]();
      },
      async capture() {
        if (!allowed(page.url())) throw publicError('请返回此Provider的官网登录页面');
        if (providerId === 'doubaochat') {
          const sample = observer.getSample();
          if (!sample) throw publicError('请在豆包页面手动发送一条消息，等待完整回复后再完成登录');
          return (await captureDoubao(page, sample)).credentials;
        }
        if (providerId === 'qwen') return (await captureQwen(page)).credentials;
        const cookies = await readCookies(page, profile.allowedOrigins);
        const credentials = { ...captured };
        for (const mapping of profile.cookies || []) {
          const values = new Set(Object.values(cookies).flatMap(header => header.split(';').map(item => item.trim()))
            .filter(item => item.startsWith(mapping.name + '=')).map(item => item.slice(mapping.name.length + 1)));
          if (values.size > 1) throw publicError('登录Cookie存在冲突，请重新登录');
          if (values.size === 1 && !credentials[mapping.field]) credentials[mapping.field] = [...values][0];
        }
        const storage = await page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])),
          (profile.localStorage || []).map(item => item.key));
        for (const mapping of profile.localStorage || []) if (storage[mapping.key]) credentials[mapping.field] = storage[mapping.key];
        const missing = profile.requiredFields.filter(field => !credentials[field]);
        if (missing.length) throw publicError('尚未捕获完整凭据，请完成登录并操作一次官网功能后重试');
        if (JSON.stringify(credentials).length > 128 * 1024) throw publicError('登录资料超过大小限制');
        return credentials;
      },
    };
  } catch (error) { await close(); throw error; }
}

module.exports = { openLoginBrowser, createLoginBrowserHost };
