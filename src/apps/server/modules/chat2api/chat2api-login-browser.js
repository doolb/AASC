'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { captureDoubao, captureQwen, readCookies, observeDoubaoCompletion } = require('./chat2api-browser-capture');
const publicError = message => Object.assign(new Error(message), { publicMessage: message });
const { normalizeDoubaoWebConfig } = require('./chat2api-doubao-web-config');

/** 只解析已有浏览器白名单中的程序，保持参数独立传递；不执行shell。 */
async function executablePath(command) {
  normalizeDoubaoWebConfig({ browserExecutable: command });
  const suffixes = process.platform === 'win32' ? ['', '.exe', '.EXE'] : [''];
  const directories = path.isAbsolute(command) ? [''] : (process.env.PATH || '').split(path.delimiter);
  for (const directory of directories) {
    for (const suffix of suffixes) {
      const candidate = directory ? path.join(directory, command + suffix) : command + suffix;
      try { await fs.access(candidate, fs.constants.X_OK); return candidate; } catch { /* 继续查找PATH中的候选。 */ }
    }
  }
  throw publicError('服务器未找到配置的浏览器，请检查豆包网页任务的浏览器路径');
}

/** 登录角色拥有自己的临时profile与管道，运行中的豆包浏览器不在此模块的清理范围。 */
async function openLoginBrowser({ profile, providerId, restore, executable = 'vivaldi', launch } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-login-'));
  let browser;
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
    await browser?.close().catch(() => {});
    await fs.rm(directory, { recursive: true, force: true });
  };
  try {
    const start = launch || require('puppeteer-core').launch;
    browser = await start({ executablePath: await executablePath(executable), userDataDir: directory,
      headless: false, pipe: true, timeout: 30000, defaultViewport: { width: 1024, height: 720, deviceScaleFactor: 1 },
      args: ['--no-first-run', '--no-default-browser-check'],
      env: { ...process.env, ...(process.platform === 'linux' && !process.env.DISPLAY ? { DISPLAY: ':1' } : {}) } });
    const pages = await browser.pages();
    page = pages[0] || await browser.newPage();
    await Promise.all(pages.slice(1).map(extra => extra.close()));
    await page.setViewport({ width: 1024, height: 720, deviceScaleFactor: 1 });
    // 官网弹出登录页时收回到唯一页面，不让弹窗随切换积累。
    browser.on('targetcreated', async target => {
      try {
        const popup = await target.page();
        if (!popup || popup === page) return;
        const url = popup.url();
        await popup.close();
        if (!closed && allowed(url)) await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch { /* 页面关闭或导航竞争由下一帧状态处理。 */ }
    });
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

module.exports = { openLoginBrowser, executablePath };
