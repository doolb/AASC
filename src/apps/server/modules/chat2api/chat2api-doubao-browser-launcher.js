'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { normalizeDoubaoWebConfig } = require('./chat2api-doubao-web-config');

const profilePath = (rootDir, accountId) => path.join(rootDir, 'browser-profiles', 'doubao',
  createHash('sha256').update(accountId).digest('hex').slice(0, 24));

/** 专用进程、专用目录、本机调试端口；端口已有监听者时拒绝接管未知浏览器。 */
const createDoubaoBrowserLauncher = ({ rootDir, spawnBrowser = spawn, connect,
  probe = globalThis.fetch } = {}) => {
  let browser = null;
  let child = null;
  let activeKey = '';
  const close = async () => {
    try { browser?.disconnect(); } catch { /* 退出时尽力断开。 */ }
    browser = null;
    if (child && !child.killed) child.kill('SIGTERM');
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
    if (occupied) throw new Error('doubao_browser_port_busy');
    child = spawnBrowser(config.browserExecutable, [
      `--user-data-dir=${directory}`, `--remote-debugging-port=${config.debugPort}`,
      '--remote-debugging-address=127.0.0.1', '--no-first-run', '--no-startup-window',
    ], { shell: false, stdio: 'ignore', env: {
      ...process.env,
      ...(process.platform === 'linux' && !process.env.DISPLAY ? { DISPLAY: ':1' } : {}),
    } });
    child.on('error', () => {});
    try {
      const connectBrowser = connect || (options => require('puppeteer-core').connect(options));
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (child.exitCode !== null) throw new Error('doubao_browser_start_failed');
        try {
          browser = await connectBrowser({ browserURL: endpoint, defaultViewport: null });
          activeKey = key;
          return browser;
        } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
      }
      throw new Error('doubao_browser_start_timeout');
    } catch (error) { await close(); throw error; }
  };
  return { open, close, profilePath: accountId => profilePath(rootDir, accountId) };
};

module.exports = { createDoubaoBrowserLauncher, profilePath };
