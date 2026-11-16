'use strict';

const { spawn: defaultSpawn } = require('node:child_process');
const net = require('node:net');
const { once } = require('node:events');
const puppeteer = require('puppeteer-core');

function portAvailable(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

function defaultExecutable(browser) {
  return browser === 'vivaldi' ? '/usr/bin/vivaldi' : '/usr/bin/chromium';
}

function matchesBrowser(browser, version) {
  const identity = String(version?.Browser || '');
  if (browser === 'vivaldi') return /chrome|vivaldi/i.test(identity);
  return /chrome|chromium/i.test(identity) && !/vivaldi/i.test(identity);
}

class BrowserInstance {
  constructor({
    id,
    browser = 'chromium',
    debugPort,
    profile,
    display = process.env.DISPLAY,
    executable,
    startupTimeout = 30000,
    probe,
    attach = options => puppeteer.connect(options),
    spawn = defaultSpawn,
    portAvailable: checkPort = portAvailable,
    sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
  } = {}) {
    this.id = id;
    this.browserType = browser;
    this.debugPort = debugPort;
    this.profile = profile;
    this.display = display;
    this.executable = executable || defaultExecutable(browser);
    this.startupTimeout = startupTimeout;
    this.probe = probe || (() => this.fetchVersion());
    this.attach = attach;
    this.spawn = spawn;
    this.portAvailable = checkPort;
    this.sleep = sleep;
    this.browser = null;
    this.child = null;
    this.owned = false;
    this.ensuring = null;
    this.state = 'disconnected';
  }

  endpoint() {
    return `http://127.0.0.1:${this.debugPort}`;
  }

  async fetchVersion() {
    try {
      const response = await fetch(`${this.endpoint()}/json/version`, { signal: AbortSignal.timeout(1500) });
      return response.ok ? response.json() : null;
    } catch {
      return null;
    }
  }

  ensure() {
    if (this.browser?.connected) return Promise.resolve(this.browser);
    if (this.ensuring) return this.ensuring;
    this.ensuring = this.ensureInternal().finally(() => { this.ensuring = null; });
    return this.ensuring;
  }

  async ensureInternal() {
    const existingVersion = await this.probe();
    if (existingVersion) {
      this.assertBrowserType(existingVersion);
      const browser = await this.attach({ browserURL: this.endpoint(), defaultViewport: null });
      return this.adopt(browser, false);
    }

    if (!await this.portAvailable(this.debugPort)) {
      throw new Error(`debug port ${this.debugPort} is occupied`);
    }
    const args = [
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${this.debugPort}`,
      '--no-first-run',
      '--no-default-browser-check'
    ];
    if (this.display) args.push(`--display=${this.display}`);
    if (this.profile) args.push(`--user-data-dir=${this.profile}`);
    const child = this.spawn(this.executable, args, {
      env: { ...process.env, ...(this.display ? { DISPLAY: this.display } : {}) },
      stdio: 'ignore'
    });
    this.child = child;
    const exited = new Promise((_, reject) => {
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`${this.browserType} startup failed (exit code ${code})`)));
    });
    exited.catch(() => {});
    try {
      const deadline = Date.now() + this.startupTimeout;
      let version = null;
      while (Date.now() < deadline) {
        version = await Promise.race([this.probe(), exited]);
        if (version) break;
        await Promise.race([this.sleep(100), exited]);
      }
      if (!version) throw new Error(`${this.browserType} debug port startup timed out`);
      this.assertBrowserType(version);
      const browser = await Promise.race([
        this.attach({ browserURL: this.endpoint(), defaultViewport: null }),
        exited
      ]);
      return this.adopt(browser, true);
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  assertBrowserType(version) {
    if (!matchesBrowser(this.browserType, version)) {
      throw new Error(`debug port is not the expected ${this.browserType} browser`);
    }
  }

  adopt(browser, owned) {
    this.browser = browser;
    this.owned = owned;
    this.state = 'connected';
    if (browser && typeof browser.on === 'function') {
      browser.on('disconnected', () => {
        if (this.browser === browser) {
          this.browser = null;
          this.state = 'disconnected';
        }
      });
    }
    return browser;
  }

  status() {
    return {
      id: this.id,
      browser: this.browserType,
      debugPort: this.debugPort,
      profile: this.profile || null,
      owned: this.owned,
      state: this.state,
      connected: Boolean(this.browser?.connected)
    };
  }

  async close() {
    const browser = this.browser;
    this.browser = null;
    this.state = 'closed';
    this.owned = false;
    if (browser?.connected && typeof browser.disconnect === 'function') browser.disconnect();
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null) {
      const exit = once(child, 'exit');
      child.kill('SIGTERM');
      await exit;
    }
  }
}

module.exports = { BrowserInstance, matchesBrowser, portAvailable };
