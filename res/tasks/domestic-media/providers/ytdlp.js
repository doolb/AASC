'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const axios = require('axios');
const { options } = require('./proxy');

// 版本和校验值对应官方 2025.11.12 release，更新时须一并核对。
const VERSION = '2025.11.12';
const BINARIES = {
  x64: ['yt-dlp_linux', '1b48caf7d5ef7826a72595fb9bcb194c7ee3a877ea5e10d26b52bc996757761b'],
  arm64: ['yt-dlp_linux_aarch64', '7cfab552f1015ca29b5471ac5bb5d99d99a83c2ed6d4b0bf4d6114121380b087']
};
const MAX_BINARY = 64 * 1024 * 1024;
const MAX_OUTPUT = 1024 * 1024;

function safeYtdlpArgs(value) {
  let url;
  try { url = new URL(String(value)); } catch { throw new Error('抖音链接无效'); }
  const allowed = ['www.douyin.com', 'douyin.com', 'v.douyin.com', 'www.iesdouyin.com'];
  if (url.protocol !== 'https:' || !allowed.includes(url.hostname) || url.username || url.password || url.port) throw new Error('抖音链接无效');
  return ['--ignore-config', '--no-playlist', '--no-warnings'];
}

function platformBinary() {
  const glibc = process.report?.getReport()?.header?.glibcVersionRuntime;
  const parts = String(glibc || '').split('.').map(Number);
  if (process.platform !== 'linux' || !BINARIES[process.arch] || !glibc || parts[0] < 2 || (parts[0] === 2 && parts[1] < 17)) {
    throw new Error('当前平台不支持自动安装 yt-dlp，请配置本机可执行文件');
  }
  return BINARIES[process.arch];
}

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

function cookieFileContents(cookie) {
  if (!cookie) return '';
  if (typeof cookie !== 'string' || /[\r\n\t\x00-\x1f\x7f]/.test(cookie) || cookie.length > 16384) throw new Error('抖音 Cookie 格式无效');
  const lines = cookie.split(';').map(part => {
    const index = part.indexOf('=');
    const name = part.slice(0, index).trim(), value = part.slice(index + 1).trim();
    if (index < 1 || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\s;]/.test(value)) throw new Error('抖音 Cookie 格式无效');
    return `.douyin.com\tTRUE\t/\tTRUE\t0\t${name}\t${value}`;
  });
  return `# Netscape HTTP Cookie File\n${lines.join('\n')}\n`;
}

function createYtdlp({ binary = '', dataDir, proxyUrl = () => '', cookie = '', log = () => {} } = {}) {
  const cookies = cookieFileContents(cookie);
  if (!binary && !dataDir) throw new Error('缺少 yt-dlp 数据目录');
  const target = binary ? path.resolve(binary) : path.join(dataDir, 'bin', 'yt-dlp');
  let ensuring;
  let stopped = false;
  const controllers = new Set();
  const children = new Set();
  const operations = new Set();
  function currentProxy(value) {
    const result = value === undefined ? (typeof proxyUrl === 'function' ? proxyUrl() : proxyUrl) : value;
    options(result || ''); // 校验并避免将凭据放进错误。
    return result || '';
  }
  async function ensure(value) {
    if (stopped) throw new Error('yt-dlp 已停止');
    if (binary) {
      try { await fs.promises.access(target, fs.constants.X_OK); }
      catch { throw new Error('配置的 yt-dlp 不可执行'); }
      if (stopped) throw new Error('yt-dlp 已停止');
      return target;
    }
    const [asset, digest] = platformBinary();
    try {
      await fs.promises.access(target, fs.constants.X_OK);
      const stat = await fs.promises.stat(target);
      if (stat.isFile() && stat.size <= MAX_BINARY && await hashFile(target) === digest) {
        if (stopped) throw new Error('yt-dlp 已停止');
        return target;
      }
    } catch { /* 文件不存在或不可读时重新安装。 */ }
    if (stopped) throw new Error('yt-dlp 已停止');
    if (!ensuring) {
      ensuring = (async () => {
        const proxy = currentProxy(value);
        const controller = new AbortController();
        controllers.add(controller);
        const timeout = setTimeout(() => controller.abort(), 120000);
        const temp = `${target}.${crypto.randomUUID()}.part`;
        try {
          await fs.promises.mkdir(path.dirname(target), { recursive: true });
          if (stopped) throw new Error('已停止');
          const response = await axios.get(`https://github.com/yt-dlp/yt-dlp/releases/download/${VERSION}/${asset}`, {
            ...options(proxy), responseType: 'stream', timeout: 60000, maxRedirects: 5, signal: controller.signal
          });
          let size = 0;
          const limit = new Transform({ transform(chunk, encoding, callback) {
            size += chunk.length;
            callback(size > MAX_BINARY ? new Error('下载文件过大') : null, chunk);
          } });
          await pipeline(response.data, limit, fs.createWriteStream(temp, { mode: 0o700, flags: 'wx' }), { signal: controller.signal });
          if (!size || await hashFile(temp) !== digest) throw new Error('校验失败');
          if (stopped) throw new Error('已停止');
          await fs.promises.rename(temp, target);
          log('yt-dlp 已校验并安装到数据目录');
          return target;
        } catch { throw new Error(stopped ? 'yt-dlp 已停止' : 'yt-dlp 下载或校验失败，请检查网络和代理'); }
        finally { clearTimeout(timeout); controllers.delete(controller); await fs.promises.unlink(temp).catch(() => {}); }
      })().finally(() => { ensuring = undefined; });
    }
    return ensuring;
  }
  async function executeCore(url, args, value, timeoutMs) {
    const baseArgs = safeYtdlpArgs(url);
    const proxy = currentProxy(value);
    const executable = await ensure(proxy);
    if (stopped) throw new Error('yt-dlp 已停止');
    // 清理所有常见环境代理，凭据只经子进程环境传递，不出现在命令参数中。
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/^(http|https|all|no)_proxy$/i.test(key)) delete env[key];
    if (proxy) {
      env.HTTP_PROXY = proxy;
      env.HTTPS_PROXY = proxy;
      env.ALL_PROXY = proxy;
    }
    const proxyArgs = proxy ? [] : ['--proxy', ''];
    let cookieDir;
    try {
      let cookieArgs = [];
      if (cookies) {
        cookieDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aasc-ytdlp-cookie-'));
        const file = path.join(cookieDir, 'cookies.txt');
        await fs.promises.writeFile(file, cookies, { mode: 0o600, flag: 'wx' });
        cookieArgs = ['--cookies', file];
      }
      if (stopped) throw new Error('yt-dlp 已停止');
    const child = spawn(executable, [...baseArgs, ...proxyArgs, ...cookieArgs, ...args, '--', url], { env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    children.add(child);
    // 只结束本次启动的进程组；Windows 使用 taskkill 的进程树选项。
    function terminate() {
      if (!child.pid) return Promise.resolve();
      if (process.platform === 'win32') return new Promise(resolve => {
        execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, error => {
          if (error) child.kill('SIGKILL');
          resolve();
        });
      });
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      return Promise.resolve();
    }
    child.terminateTree = terminate;
    return await new Promise((resolve, reject) => {
      let output = ''; let bytes = 0; let reason = '';
      const timer = setTimeout(() => { reason = 'yt-dlp 执行超时'; void terminate(); }, timeoutMs);
      child.stdout.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_OUTPUT) { reason = 'yt-dlp 输出过大'; void terminate(); }
        else output += chunk.toString();
      });
      // 不转发 stderr：其中可能包含上游 URL、Cookie 或代理凭据。
      child.stderr.on('data', () => {});
      child.once('error', () => { reason = 'yt-dlp 启动失败'; });
      child.once('close', code => {
        clearTimeout(timer); children.delete(child);
        if (stopped) return reject(new Error('yt-dlp 已停止'));
        if (reason || code !== 0) return reject(new Error(reason || 'yt-dlp 执行失败，请检查网络或代理'));
        resolve(output.trim());
      });
    });
    } finally { if (cookieDir) await fs.promises.rm(cookieDir, { recursive: true, force: true }); }
  }
  function execute(url, args, value, timeoutMs) {
    const operation = executeCore(url, args, value, timeoutMs);
    operations.add(operation);
    operation.then(() => operations.delete(operation), () => operations.delete(operation));
    return operation;
  }
  async function resolve(url, proxy) {
    const output = await execute(url, ['-f', 'b[height<=720][ext=mp4]/b[height<=720]/b', '--dump-json'], proxy, 120000);
    let metadata;
    try { metadata = JSON.parse(output); } catch { throw new Error('yt-dlp 未返回有效媒体信息'); }
    if (typeof metadata.url !== 'string' || !/^https?:\/\//i.test(metadata.url) || !/^[a-z0-9]{1,10}$/i.test(metadata.ext || '')) throw new Error('yt-dlp 未返回有效媒体信息');
    return { url: metadata.url, title: typeof metadata.title === 'string' ? metadata.title.slice(0, 180) : '', ext: metadata.ext.toLowerCase() };
  }
  async function run(url, outputTemplate, proxy) {
    if (typeof outputTemplate !== 'string' || !outputTemplate || outputTemplate.includes('\0')) throw new Error('输出路径无效');
    const output = await execute(url, ['-f', 'bv*[height<=720]+ba/b[height<=720]/b', '--merge-output-format', 'mp4', '-o', outputTemplate, '--print', 'after_move:filepath'], proxy, 30 * 60 * 1000);
    if (!output) throw new Error('yt-dlp 未返回下载文件');
    return output.split(/\r?\n/).pop();
  }
  async function stop() {
    stopped = true;
    for (const controller of controllers) controller.abort();
    const exits = [...children].map(child => new Promise(resolve => {
      child.once('close', resolve);
      void child.terminateTree();
    }));
    if (ensuring) await ensuring.catch(() => {});
    await Promise.all(exits);
    await Promise.allSettled([...operations]);
  }
  return { ensure, resolve, run, stop, path: target };
}
module.exports = { createYtdlp, safeYtdlpArgs };
