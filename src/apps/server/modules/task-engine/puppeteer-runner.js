const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

class PuppeteerRunner {
  constructor(options = {}) {
    this.browser = null;
    this.browserArgs = options.browserArgs || [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--use-gl=angle',
      '--enable-unsafe-swiftshader'
    ];
  }

  async _ensureBrowser() {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: this.browserArgs
      });
    }
    return this.browser;
  }

  async run(options) {
    const { entryFile, workDir, context = {}, timeout = 30000 } = options;
    const codeDir = options.codeDir || workDir;
    const entryPath = options.entryPath || path.resolve(codeDir, entryFile);
    if (!entryPath.startsWith(path.resolve(codeDir) + path.sep)) {
      return { success: false, error: '入口文件路径越界', logs: [] };
    }

    if (!fs.existsSync(entryPath)) {
      return { success: false, error: '入口文件不存在: ' + entryFile, logs: [] };
    }

    const code = fs.readFileSync(entryPath, 'utf8');
    const browser = await this._ensureBrowser();
    const page = await browser.newPage();

    return new Promise((resolve) => {
      const logs = [];
      let completed = false;

      const timer = setTimeout(async () => {
        if (completed) return;
        completed = true;
        await page.close().catch(() => {});
        resolve({ success: false, error: 'timeout', logs });
      }, timeout);

      page.on('console', (msg) => {
        logs.push({
          stream: msg.type() === 'error' ? 'stderr' : 'stdout',
          level: msg.type() === 'error' ? 'error' : 'info',
          message: msg.text()
        });
      });

      page.on('pageerror', (err) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        resolve({ success: false, error: err.message, stack: err.stack, logs });
      });

      page.exposeFunction('__taskResult', (result) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        resolve({ success: true, data: result, logs });
      });

      page.exposeFunction('__taskError', (err) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        resolve({ success: false, error: err.message || String(err), logs });
      });

      const filesJson = JSON.stringify(context.files || {});
      const paramsJson = JSON.stringify(context.params || {});
      const refsJson = JSON.stringify(context.refs || {});
      const workDirJson = JSON.stringify(context.workDir || workDir);
      // evaluate实参由Puppeteer序列化；重复JSON编码会把整个函数变成字符串字面量。
      const safeCode = code;

      page.evaluate(new Function('filesJson', 'paramsJson', 'refsJson', 'workDirJson', 'safeCode', `
        (async () => {
          try {
            const capabilities = {
              cpu: true,
              webgl: (() => { try {
                const c = document.createElement('canvas');
                return !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
              } catch(e) { return false; } })(),
              webgpu: !!navigator.gpu
            };
            const context = {
              workDir: JSON.parse(workDirJson),
              files: JSON.parse(filesJson),
              params: JSON.parse(paramsJson),
              refs: JSON.parse(refsJson),
              capabilities
            };
            const fn = new Function('context', safeCode + '\\nreturn run(context);');
            const result = await fn(context);
            __taskResult(result || {});
          } catch(err) {
            __taskError({ message: err.message, stack: err.stack });
          }
        })();
      `), filesJson, paramsJson, refsJson, workDirJson, safeCode);
    });
  }

  async close() {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }
}

module.exports = PuppeteerRunner;
