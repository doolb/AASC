'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { normalizeDoubaoWebConfig } = require('./chat2api-doubao-web-config');

const profilePath = (rootDir, accountId) => path.join(rootDir, 'browser-profiles', 'doubao',
  createHash('sha256').update(accountId).digest('hex').slice(0, 24));

// 原子替换配置，避免进程被强制结束时留下半份JSON而阻塞下次重连。
const writePrivateJSON = async (target, value) => {
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, target);
  } finally { await fs.unlink(temporary).catch(() => {}); }
};
// 仅修改本项目受管profile的退出提示，不影响用户日常浏览器。
const EXIT_PREFS = { 'vivaldi.system.show_exit_confirmation_dialog': false,
  'vivaldi.windows.show_window_close_confirmation_dialog': false };
const configurePreferences = async directory => {
  const target = path.join(directory, 'Default', 'Preferences');
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  let prefs = {};
  try { prefs = JSON.parse(await fs.readFile(target, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const [key, value] of Object.entries(EXIT_PREFS)) {
    const parts = key.split('.'); let current = prefs;
    for (const part of parts.slice(0, -1)) current = current[part] ||= {};
    current[parts.at(-1)] = value;
  }
  await writePrivateJSON(target, prefs);
};
const browserProfile = async browser => {
  const cdp = await browser.target().createCDPSession();
  try {
    const result = await cdp.send('Browser.getBrowserCommandLine').catch(() => null);
    if (result?.arguments) return result.arguments.find(arg => arg.startsWith('--user-data-dir='))?.slice(16) || '';
  } finally { await cdp.detach(); }
  // 兼容此前未使用enable-automation启动的受管Vivaldi；只读取版本页公开的profile路径。
  const page = await browser.newPage();
  try {
    await page.goto('chrome://version/', { waitUntil: 'domcontentloaded', timeout: 10000 });
    const actual = await page.$eval('#profile_path', node => node.textContent.trim());
    return path.dirname(path.resolve(actual));
  } finally { await page.close(); }
};
const verifyProfile = async (browser, directory) => path.resolve(await browserProfile(browser)) === path.resolve(directory);
const configureRunningPreferences = async browser => {
  for (const target of browser.targets()) {
    if (!target.url().startsWith('chrome-extension://mpognobbkildjkofajifpdfhcoklimli/')) continue;
    const executor = await target.page() || await target.worker();
    if (!executor) continue;
    const changed = await executor.evaluate(async prefs => {
      if (!globalThis.vivaldi?.prefs?.set) return false;
      for (const [path, value] of Object.entries(prefs)) await vivaldi.prefs.set({ path, value });
      return true;
    }, EXIT_PREFS).catch(() => false);
    if (changed) return true;
  }
  return false;
};

/** 专用进程、专用目录、本机调试端口；端口已有监听者时拒绝接管未知浏览器。 */
const createDoubaoBrowserLauncher = ({ rootDir, spawnBrowser = spawn, connect,
  probe = globalThis.fetch } = {}) => {
  let browser = null;
  let child = null;
  let activeKey = '';
  const activeFile = path.join(rootDir, 'browser-profiles', 'doubao', 'active-browser.json');
  const remember = async (config, accountId) => {
    await fs.mkdir(path.dirname(activeFile), { recursive: true, mode: 0o700 });
    await writePrivateJSON(activeFile, { accountId, debugPort: config.debugPort,
      browserExecutable: config.browserExecutable });
  };
  const lastAccount = async (rawConfig, candidates = []) => {
    const config = normalizeDoubaoWebConfig(rawConfig);
    let previous;
    try { previous = JSON.parse(await fs.readFile(activeFile, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const endpoint = `http://127.0.0.1:${config.debugPort}`;
    const occupied = await probe(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
    if (!occupied) return previous?.debugPort === config.debugPort ? previous.accountId : '';
    const connection = await (connect || (options => require('puppeteer-core').connect(options)))({ browserURL: endpoint, defaultViewport: null });
    try {
      const actual = await browserProfile(connection);
      const choices = [previous?.accountId, config.accountId, ...candidates, 'external-login'].filter(value => typeof value === 'string' && value);
      return choices.find(id => path.resolve(profilePath(rootDir, id)) === path.resolve(actual)) || '';
    } finally { connection.disconnect(); }
  };
  const close = async () => {
    try { if (browser?.connected) await browser.close(); } catch { /* 进程可能已经随最后页签退出。 */ }
    browser = null;
    if (child && child.exitCode === null) {
      const exiting = child;
      await new Promise(resolve => {
        const done = () => { clearTimeout(timer); exiting.off('exit', done); resolve(); };
        const timer = setTimeout(done, 5000);
        exiting.once('exit', done);
        if (!exiting.killed) exiting.kill('SIGTERM');
      });
    }
    child = null;
    activeKey = '';
  };
  const open = async (rawConfig, accountId) => {
    const config = normalizeDoubaoWebConfig(rawConfig);
    if (config.mode !== 'browser-fetch') throw new Error('doubao_browser_disabled');
    if (config.accountId && config.accountId !== accountId) throw new Error('doubao_browser_account_mismatch');
    const key = `${config.browserExecutable}\0${config.debugPort}\0${accountId}`;
    if (browser?.connected && key === activeKey) return browser;
    await close();
    const directory = profilePath(rootDir, accountId);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.chmod(directory, 0o700);
    const endpoint = `http://127.0.0.1:${config.debugPort}`;
    const occupied = await probe(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1000) })
      .then(() => true, () => false);
    const connectBrowser = connect || (options => require('puppeteer-core').connect(options));
    if (occupied) {
      const existing = await connectBrowser({ browserURL: endpoint, defaultViewport: null });
      try {
        if (!await verifyProfile(existing, directory)) throw new Error('doubao_browser_port_busy');
        await configureRunningPreferences(existing);
        browser = existing; activeKey = key;
        await remember(config, accountId);
        return browser;
      } catch (error) { existing.disconnect(); throw error; }
    }
    await configurePreferences(directory);
    child = spawnBrowser(config.browserExecutable, [
      `--user-data-dir=${directory}`, `--remote-debugging-port=${config.debugPort}`,
      '--remote-debugging-address=127.0.0.1', '--no-first-run', '--no-startup-window',
    ], { shell: false, stdio: 'ignore', env: {
      ...process.env,
      ...(process.platform === 'linux' && !process.env.DISPLAY ? { DISPLAY: ':1' } : {}),
    } });
    child.on('error', () => {});
    try {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (child.exitCode !== null) throw new Error('doubao_browser_start_failed');
        try {
          browser = await connectBrowser({ browserURL: endpoint, defaultViewport: null });
          activeKey = key;
          await remember(config, accountId);
          return browser;
        } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
      }
      throw new Error('doubao_browser_start_timeout');
    } catch (error) { await close(); throw error; }
  };
  return { open, close, lastAccount, profilePath: accountId => profilePath(rootDir, accountId) };
};

module.exports = { createDoubaoBrowserLauncher, profilePath, configurePreferences, verifyProfile, configureRunningPreferences, writePrivateJSON };
