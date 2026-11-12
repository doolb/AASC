'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const axios = require('axios');
const cheerio = require('cheerio');
const yauzl = require('yauzl');
const { get } = require('./http');

const TEXT_EXT = new Set(['txt', 'epub', 'pdf']);
// 不同任务副本可能从不同路径加载；使用进程内非枚举命名符号共享真实输出目录租约。
const DOMAIN_KEY = Symbol.for('aasc.domestic-media.tomato.output-domains');
if (!process[DOMAIN_KEY]) Object.defineProperty(process, DOMAIN_KEY, { value: new Map(), enumerable: false });
const OUTPUT_DOMAINS = process[DOMAIN_KEY];
async function outputDomain(directory) {
  await fs.promises.mkdir(directory, { recursive: true });
  const real = await fs.promises.realpath(directory);
  if (!OUTPUT_DOMAINS.has(real)) OUTPUT_DOMAINS.set(real, { queue: Promise.resolve(), blockers: new Set() });
  return OUTPUT_DOMAINS.get(real);
}
const RANK_ORIGIN = 'https://fanqienovel.com';
const RANK_HEADERS = { 'User-Agent': 'Mozilla/5.0' };
function parseRankPage(html) {
  if (typeof html !== 'string') return [];
  const $ = cheerio.load(html), found = new Set();
  $('a[href^="/page/"]').each((_i, element) => {
    const id = /^\/page\/([0-9]{6,20})\/?$/.exec($(element).attr('href') || '')?.[1];
    if (id) found.add(id);
    if (found.size >= 10) return false;
  });
  return [...found];
}
function parseRankDetail(html, id) {
  if (typeof html !== 'string' || !/^[0-9]{6,20}$/.test(id)) return null;
  const $ = cheerio.load(html);
  let result = null;
  $('script[type="application/ld+json"]').each((_i, element) => {
    try {
      const entry = JSON.parse($(element).html());
      if (entry?.['@type'] !== 'NewsArticle' || typeof entry.headline !== 'string') return;
      const title = /^(.+?)完整版在线免费阅读_/.exec(entry.headline)?.[1]?.trim();
      if (!title || /[\uE000-\uF8FF]/u.test(title)) return;
      const author = Array.isArray(entry.author) && typeof entry.author[0]?.name === 'string' ? entry.author[0].name.slice(0, 80) : '';
      result = { id: `book:${id}`, title: title.slice(0, 180), author, mediaType: 'collection', url: id };
      return false;
    } catch { /* 忽略无关或损坏的结构化数据。 */ }
  });
  return result;
}
function safeRelPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('文件路径无效');
  return value;
}
function encodeLibraryPath(rel) {
  return `/f_${Buffer.from(safeRelPath(rel), 'utf8').toString('base64url')}`;
}
function decodeLibraryPath(value) {
  const match = /^\/f_([A-Za-z0-9_-]{1,8192})$/.exec(typeof value === 'string' ? value : '');
  if (!match) throw new Error('番茄文件路径无效');
  const bytes = Buffer.from(match[1], 'base64url');
  const rel = bytes.toString('utf8');
  if (bytes.toString('base64url') !== match[1] || !Buffer.from(rel, 'utf8').equals(bytes)) throw new Error('番茄文件路径无效');
  return safeRelPath(rel);
}
function parseSearch(payload) {
  return (Array.isArray(payload?.items) ? payload.items : []).filter(item => /^[0-9]{6,20}$/.test(String(item?.book_id || ''))).slice(0, 200).map(item => ({ id: `book:${item.book_id}`, title: String(item.title || item.book_id).slice(0, 180), author: String(item.author || '').slice(0, 80), mediaType: 'collection', url: String(item.book_id) }));
}
function parseLibrary(payload) {
  return (Array.isArray(payload?.items) ? payload.items : []).flatMap(item => {
    try {
      if (item.kind !== 'file' || !TEXT_EXT.has(String(item.ext || '').replace(/^\./, '').toLowerCase())) return [];
      const rel = safeRelPath(item.rel_path);
      return [{ id: `file:${rel}`, title: String(item.name || rel).slice(0, 180), mediaType: 'text', url: rel, size: Number(item.size) || 0, modifiedMs: Number(item.modified_ms) || 0, ...(/\.txt$/i.test(rel) ? {} : { playable: false, playbackMessage: '该格式暂不支持播放' }) }];
    } catch { return []; }
  });
}
function epubHasBookId(buffer, id) {
  return new Promise(resolve => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, autoClose: false }, (error, zip) => {
      if (error) return resolve(false);
      let settled = false, count = 0;
      const entries = new Map();
      const finish = value => { if (!settled) { settled = true; zip.close(); resolve(value); } };
      const readEntry = (entry, callback) => {
        if (!entry || entry.uncompressedSize > 1024 * 1024) return finish(false);
        zip.openReadStream(entry, (err, stream) => {
          if (err) return finish(false);
          const chunks = []; let size = 0;
          stream.on('error', () => finish(false));
          stream.on('data', chunk => { size += chunk.length; if (size > 1024 * 1024) { stream.destroy(); finish(false); } else chunks.push(chunk); });
          stream.on('end', () => { if (!settled) callback(Buffer.concat(chunks).toString('utf8')); });
        });
      };
      zip.on('error', () => finish(false));
      zip.on('entry', entry => {
        if (++count > 10000 || entries.has(entry.fileName) || entry.fileName.includes('\\') || entry.fileName.startsWith('/') || entry.fileName.split('/').includes('..')) return finish(false);
        entries.set(entry.fileName, entry); zip.readEntry();
      });
      zip.on('end', () => {
        readEntry(entries.get('META-INF/container.xml'), xml => {
          try {
            const container = cheerio.load(xml, { xmlMode: true });
            const roots = container('rootfile').toArray();
            if (roots.length !== 1) return finish(false);
            const root = container(roots[0]);
            const filename = root.attr('full-path');
            if (root.attr('media-type') !== 'application/oebps-package+xml' || !filename) return finish(false);
            readEntry(entries.get(filename), opf => {
              try {
                const $ = cheerio.load(opf, { xmlMode: true });
                const ids = $('metadata').find('*').toArray().filter(el => String(el.name).toLowerCase() === 'dc:identifier').map(el => $(el).text().trim());
                finish(ids.length === 1 && ids[0] === id);
              } catch { finish(false); }
            });
          } catch { finish(false); }
        });
      });
      zip.readEntry();
    });
  });
}
function parseChapterLines(text, bookId, limit = 100) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    if (out.length >= limit) break;
    try { const c = JSON.parse(line); if (c?.id && typeof c.content === 'string') out.push({ id: `chapter:${bookId}:${c.id}`, title: String(c.title || c.id).slice(0, 180), mediaType: 'text', bookId, chapterId: String(c.id) }); } catch { /* 忽略损坏行。 */ }
  }
  return out;
}
function bookId(value) {
  const raw = String(value || '');
  if (/^[0-9]{6,20}$/.test(raw)) return raw;
  if (/^book:[0-9]{6,20}$/.test(raw)) return raw.slice(5);
  try { const u = new URL(raw); if (u.protocol === 'https:' && !u.username && !u.password && u.hostname === 'fanqienovel.com') return /^\/page\/([0-9]{6,20})\/?$/.exec(u.pathname)?.[1] || ''; } catch { /* 非链接。 */ }
  return '';
}
async function checkPort(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error('番茄下载器端口不可用')));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
function createTomatoProvider(options) {
  const port = Number(options.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('番茄下载器端口无效');
  const dataDir = options.dataDir || path.join(options.workDir, 'tomato-data');
  const saveDir = options.saveDir || path.join(options.workDir, 'tomato-output');
  const api = axios.create({ baseURL: `http://127.0.0.1:${port}`, proxy: false, timeout: 15000, maxRedirects: 0 });
  let child = null, starting = null, stopping = null, closed = false, cookie = '';
  let activeProxy = '', queue = Promise.resolve(), openStreams = 0, unknownJob = false;
  let rankQueue = Promise.resolve(), rankCache = null, domain = null;
  const owner = {};
  const rankInflight = new Map();
  const jobs = new Set();
  const jobFinished = job => job && ['done', 'failed', 'canceled', 'partial'].includes(job.state) && !job.book_name_options?.length && !job.format_options?.length;
  // 串行化端口、进程和请求的切换，避免并发请求错用其他代理进程。
  function locked(fn) {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  }
  function normalizeProxy(value) {
    if (!value) return '';
    try {
      const url = new URL(value);
      if (!['http:', 'https:', 'socks:', 'socks5:', 'socks5h:'].includes(url.protocol) || !url.hostname || url.search || url.hash || (url.pathname && url.pathname !== '/')) throw new Error();
      if (url.protocol === 'socks:') url.protocol = 'socks5:';
      return url.href;
    } catch { throw new Error('番茄代理地址无效'); }
  }
  async function terminate(proc) {
    if (!proc) return;
    if (!proc.pid) { if (child === proc) child = null; return; }
    const exited = () => proc.exitCode !== null || proc.signalCode !== null;
    if (!exited()) {
      try { process.kill(-proc.pid, 'SIGINT'); } catch (error) { if (error.code !== 'ESRCH') throw new Error('番茄下载器停止失败'); }
      await Promise.race([new Promise(resolve => proc.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
    }
    if (!exited()) {
      try { process.kill(-proc.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw new Error('番茄下载器停止失败'); }
      await Promise.race([new Promise(resolve => proc.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 2000))]);
    }
    if (!exited()) throw new Error('番茄下载器停止失败');
    if (child === proc) child = null;
    cookie = '';
  }
  async function start(proxy = '') {
    if (closed) throw new Error('番茄来源已停止');
    if (starting) return starting;
    if (child && child.exitCode === null && child.signalCode === null) return;
    // 每次新进程都拥有独立的服务端会话，旧 Cookie 不可跨进程沿用。
    cookie = '';
    starting = (async () => {
      await fs.promises.mkdir(dataDir, { recursive: true });
      await fs.promises.mkdir(saveDir, { recursive: true });
      await checkPort(port);
      if (closed) throw new Error('番茄来源已停止');
      const args = ['--server', '--data-dir', dataDir];
      const env = { ...process.env, TOMATO_WEB_ADDR: `127.0.0.1:${port}` };
      delete env.TOMATO_WEB_PASSWORD;
      if (options.password) env.TOMATO_WEB_PASSWORD = options.password;
      // 直连时不继承宿主环境中的代理，避免与控制端选择不一致。
      for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'NO_PROXY', 'no_proxy']) delete env[key];
      if (proxy) { env.HTTP_PROXY = proxy; env.HTTPS_PROXY = proxy; env.ALL_PROXY = proxy; }
      const proc = spawn(options.binary, args, { cwd: saveDir, detached: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
      child = proc;
      proc.once('exit', () => { if (child === proc) cookie = ''; });
      // 只有本次持有的进程确认监听后才访问端口，避免误连抢占端口的其他服务。
      let ready = false, output = '';
      const watch = chunk => { output = (output + String(chunk)).slice(-1024); if (output.includes('Web UI listening')) ready = true; };
      proc.stdout.on('data', watch); proc.stderr.on('data', watch);
      let spawnError = false;
      proc.once('error', () => { spawnError = true; });
      try {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          if (closed || spawnError || proc.exitCode !== null || proc.signalCode !== null) throw new Error('番茄下载器启动失败');
          try {
            if (ready) {
              if (options.password && !cookie) {
                const login = await api.post('/api/login', { password: options.password });
                cookie = (login.headers['set-cookie'] || []).map(value => value.split(';')[0]).join('; ');
                if (!cookie) throw new Error('番茄下载器登录失败');
              }
              const result = await api.get('/api/status', { timeout: 400, headers: cookie ? { Cookie: cookie } : {}, validateStatus: () => true });
              if (result.status === 200 && result.data?.bind_addrs?.includes(`127.0.0.1:${port}`)) return;
            }
          } catch { /* 未就绪或登录失败时等待，超时统一清理。 */ }
          await new Promise(resolve => setTimeout(resolve, 150));
        }
        throw new Error('番茄下载器启动超时');
      } catch (error) { await terminate(proc); throw error; }
    })();
    try { await starting; } finally { starting = null; }
  }
  async function stop() {
    closed = true;
    if (!stopping) stopping = (async () => { if (starting) { try { await starting; } catch { /* 启动失败路径负责回收进程。 */ } } await terminate(child); jobs.clear(); unknownJob = false; domain?.blockers.delete(owner); })();
    try { await stopping; } finally { stopping = null; }
  }
  async function refreshJobs() {
    if (!jobs.size) return;
    let entries;
    try { entries = (await api.get('/api/jobs', { headers: cookie ? { Cookie: cookie } : {} })).data?.items; }
    catch { throw new Error('番茄下载任务状态不可用，暂不能切换代理'); }
    if (!Array.isArray(entries)) throw new Error('番茄下载任务状态不可用，暂不能切换代理');
    for (const id of jobs) {
      const job = entries.find(item => String(item.id) === id);
      // 未找到作业并不证明下载已结束，保守地保留租约。
      if (jobFinished(job)) jobs.delete(id);
    }
    if (!jobs.size && !unknownJob) domain?.blockers.delete(owner);
  }
  // 其他控制器可查询本控制器已知作业，但不能自行解除未知作业租约。
  owner.refresh = async () => { if (!unknownJob && jobs.size) await locked(refreshJobs); };
  async function request(config, method, url, data, extra = {}) {
    const proxy = normalizeProxy(config.proxyUrl);
    return locked(async () => {
      if (closed) throw new Error('番茄来源已停止');
      if (proxy !== activeProxy && !child && (unknownJob || jobs.size)) throw new Error('番茄下载任务状态不可用，暂不能切换代理');
      if (proxy !== activeProxy && child) {
        if (unknownJob || openStreams) throw new Error('番茄下载或读取进行中，暂不能切换代理');
        await refreshJobs();
        if (jobs.size) throw new Error('番茄下载或读取进行中，暂不能切换代理');
        await terminate(child);
      }
      activeProxy = proxy;
      await start(proxy);
      const createJob = method === 'post' && url === '/api/jobs';
      // 创建请求一旦发出便可能在后台成功；响应丢失时不能推测它不存在。
      const hadUnknownJob = unknownJob;
      if (createJob) { unknownJob = true; domain?.blockers.add(owner); }
      try {
        const response = await api.request({ method, url, data, ...extra, headers: { ...(cookie ? { Cookie: cookie } : {}), ...extra.headers } });
        if (createJob && response.data?.id) { jobs.add(String(response.data.id)); unknownJob = hadUnknownJob; }
        if (method === 'get' && url.startsWith('/api/jobs') && Array.isArray(response.data?.items)) {
          for (const job of response.data.items) if (jobFinished(job)) jobs.delete(String(job.id));
          if (!jobs.size && !unknownJob) domain?.blockers.delete(owner);
        }
        if (extra.responseType === 'stream') {
          openStreams++;
          let released = false;
          const release = () => { if (!released) { released = true; openStreams--; } };
          response.data.once('end', release); response.data.once('close', release); response.data.once('error', release);
        }
        return response;
      } catch { throw new Error('番茄下载器请求失败'); }
    });
  }
  function create(config = {}) {
    const req = (method, url, data, extra, selected = config) => request(selected, method, url, data, extra);
    async function ranking() {
      const selected = { proxyUrl: config.proxyUrl };
      if (rankCache && rankCache.proxy === selected.proxyUrl && rankCache.until > Date.now()) return rankCache.items;
      if (rankInflight.has(selected.proxyUrl)) return rankInflight.get(selected.proxyUrl);
      if (rankInflight.size >= 8) throw new Error('番茄榜单暂不可用');
      const run = rankQueue.then(async () => {
      const fetchPage = options.rankGet || get;
      const fetchHtml = async pathname => {
        const response = await fetchPage(selected, RANK_ORIGIN + pathname, { headers: RANK_HEADERS, responseType: 'text', maxContentLength: 1024 * 1024, timeout: 10000 });
        return response.data;
      };
      const ids = parseRankPage(await fetchHtml('/rank/1'));
      const items = new Array(ids.length);
      let cursor = 0;
      // 固定最多三个请求并行，单项失败不影响其余榜单条目。
      await Promise.all(Array.from({ length: Math.min(3, ids.length) }, async () => {
        while (cursor < ids.length) {
          const index = cursor++;
          try { items[index] = parseRankDetail(await fetchHtml(`/page/${ids[index]}`), ids[index]); } catch { /* 保留其他已确认的榜单结果。 */ }
        }
      }));
      const result = items.filter(Boolean);
      if (!result.length) throw new Error('番茄榜单暂不可用');
      rankCache = { proxy: selected.proxyUrl, until: Date.now() + 60000, items: result };
      return result;
      });
      rankQueue = run.catch(() => {});
      rankInflight.set(selected.proxyUrl, run);
      try { return await run; } finally { if (rankInflight.get(selected.proxyUrl) === run) rankInflight.delete(selected.proxyUrl); }
    }
    async function chapters(id) {
      const directory = path.join(saveDir, id);
      const file = path.join(directory, 'downloaded_chapters.jsonl');
      try {
        // 拒绝书籍目录和章节文件的符号链接，并限制单次读取大小。
        if ((await fs.promises.lstat(directory)).isSymbolicLink()) throw new Error('章节路径无效');
        const handle = await fs.promises.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try {
          const stat = await handle.stat();
          if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new Error('章节文件无效');
          return await handle.readFile('utf8');
        } finally { await handle.close(); }
      } catch (error) { if (error.code === 'ENOENT') return ''; throw new Error('章节读取失败'); }
    }
    async function library(selected = config) {
      let payload;
      for (let i = 0; i < 40; i++) {
        payload = (await req('get', `/api/library?start=${i === 0 ? 'true' : 'false'}`, undefined, undefined, selected)).data;
        if (!payload.running) break;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      if (payload?.running || payload?.error) throw new Error('番茄书库读取失败');
      return parseLibrary(payload);
    }
    async function getStream(id, range, selected = config) {
      const match = /^chapter:([0-9]{6,20}):([0-9]{1,32})$/.exec(String(id));
      if (match) {
        const text = await chapters(match[1]);
        let content;
        for (const line of text.split('\n')) {
          try { const c = JSON.parse(line); if (String(c.id) === match[2] && typeof c.content === 'string') { content = cheerio.load(c.content).text(); break; } } catch { /* 忽略无效章节行。 */ }
        }
        if (content === undefined) throw new Error('番茄章节不存在');
        const body = Buffer.from(content, 'utf8');
        if (range && (!Number.isSafeInteger(range.start) || range.start < 0 || range.start >= body.length || (range.end !== undefined && (!Number.isSafeInteger(range.end) || range.end < range.start)))) return { stream: Readable.from([]), statusCode: 416, headers: { 'content-range': `bytes */${body.length}` } };
        const end = range ? Math.min(range.end ?? body.length - 1, body.length - 1) : body.length - 1;
        const data = range ? body.subarray(range.start, end + 1) : body;
        return { stream: Readable.from([data]), statusCode: range ? 206 : 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'content-length': String(data.length), 'accept-ranges': 'bytes', ...(range ? { 'content-range': `bytes ${range.start}-${end}/${body.length}` } : {}) } };
      }
      const rel = safeRelPath(/^file:(.+)$/.exec(String(id))?.[1]);
      if (!(await library(selected)).some(item => item.url === rel)) throw new Error('番茄文件不存在');
      const headers = range ? { Range: `bytes=${range.start}-${range.end ?? ''}` } : {};
      const response = await req('get', `/download/${rel.split('/').map(encodeURIComponent).join('/')}`, undefined, { responseType: 'stream', headers, validateStatus: s => [200, 206, 416].includes(s) }, selected);
      const out = {};
      for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (response.headers[name]) out[name] = response.headers[name];
      return { stream: response.data, statusCode: response.status, headers: out };
    }
    return {
      async home() { try { return { items: await ranking(), page: 1, totalPages: 1 }; } catch { return { items: await library(), page: 1, totalPages: 1 }; } },
      async search({ keyword, page = 1 } = {}) { const q = typeof keyword === 'string' ? keyword.trim() : ''; if (!q || q.length > 100) throw new Error('番茄搜索关键词无效'); return { items: Number(page) === 1 ? parseSearch((await req('get', `/api/search?q=${encodeURIComponent(q)}`)).data) : [], page: 1, totalPages: 1 }; },
      async resolveLink({ url } = {}) { const id = bookId(url); if (!id) throw new Error('番茄链接无效'); const items = parseChapterLines(await chapters(id), id); return { items: items.length ? items : [{ id: `book:${id}`, title: `番茄小说 ${id}`, mediaType: 'collection', url: id }] }; },
      async related() { return { items: (await library()).slice(0, 12) }; },
      getStream,
      async download(item, { save }) {
        domain = await outputDomain(saveDir);
        const run = domain.queue.then(async () => {
        // 一个下载作业固定使用开始时的代理；配置变化不会中断其轮询或保存。
        const selected = { proxyUrl: config.proxyUrl };
        const hasUrl = item?.url !== undefined && item.url !== null && item.url !== '';
        if (/^chapter:[0-9]{6,20}:[0-9]{1,32}$/.test(String(item?.id || ''))) {
          if (hasUrl && item.url !== item.id) throw new Error('番茄下载条目标识不一致');
          const result = await getStream(item.id, undefined, selected);
          await save(`${String(item.title || '章节').replace(/\.txt$/i, '')}.txt`, result.stream);
          return;
        }
        if (String(item?.id || '').startsWith('file:')) { if (hasUrl && item.url !== item.id.slice(5)) throw new Error('番茄下载条目标识不一致'); const result = await getStream(item.id, undefined, selected); await save(item.title, result.stream); return; }
        const id = /^book:[0-9]{6,20}$/.test(String(item?.id || '')) ? bookId(item.id) : '';
        if (!id || (hasUrl && (typeof item.url !== 'string' || bookId(item.url) !== id))) throw new Error('番茄下载条目标识不一致');
        // 前次轮询失败或超时不代表任务结束；先在持有进程上确认终态。
        for (const blocker of domain.blockers) await blocker.refresh();
        if (domain.blockers.size) throw new Error('番茄下载任务状态不可用，暂不能切换代理');
        const failure = () => new Error('番茄下载文件无法确认书籍身份');
        let budget = 64 * 1024 * 1024;
        const candidateFiles = async () => {
          const list = (await library(selected)).filter(entry => /\.epub$/i.test(entry.title));
          if (list.length > 20 || list.some(entry => entry.size <= 0 || entry.size > budget)) throw failure();
          return list;
        };
        const readFile = async (file, retain) => {
          const response = await getStream(file.id, undefined, selected);
          if (response.statusCode !== 200) { response.stream.destroy(); throw failure(); }
          const chunks = [], hash = crypto.createHash('sha256');
          for await (const chunk of response.stream) {
            budget -= chunk.length;
            if (budget < 0) { response.stream.destroy(); throw failure(); }
            hash.update(chunk); if (retain) chunks.push(chunk);
          }
          return { hash: hash.digest('hex'), data: retain ? Buffer.concat(chunks) : null };
        };
        // 开始前记录整个输出域候选的实际内容，旧文件不能仅靠 mtime 冒充新结果。
        const before = new Map();
        for (const file of await candidateFiles()) before.set(file.url, (await readFile(file, false)).hash);
        const startedAt = Date.now();
        const created = (await req('post', '/api/jobs', { book_id: id }, undefined, selected)).data;
        if (!created?.id || String(created.book_id) !== id) throw new Error('番茄下载任务创建失败');
        let job;
        const pollLimit = Number.isInteger(options.jobPollLimit) && options.jobPollLimit > 0 && options.jobPollLimit <= 600 ? options.jobPollLimit : 600;
        for (let i = 0; i < pollLimit; i++) {
          const data = (await req('get', `/api/jobs?id=${encodeURIComponent(created.id)}`, undefined, undefined, selected)).data;
          job = data.items?.find(entry => String(entry.id) === String(created.id));
          if (!job || ['failed', 'canceled', 'partial'].includes(job.state) || job.book_name_options?.length || job.format_options?.length) throw new Error('番茄下载任务失败或需要配置');
          if (job.state === 'done') break;
          if (i + 1 < pollLimit) await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if (job?.state !== 'done') throw new Error('番茄下载任务超时');
        const progress = job.progress;
        if (String(job.book_id) !== id || !Number.isSafeInteger(progress?.chapter_total) || progress.chapter_total < 1 || progress.saved_chapters !== progress.chapter_total) throw failure();
        // 只检查本次作业后修改的 EPUB；仅信任 EPUB 内的 book_id，而非可重复的书名。
        const files = (await candidateFiles()).filter(entry => entry.modifiedMs >= startedAt - 1000);
        if (!files.length) throw failure();
        let verified = null;
        for (const file of files) {
          const { hash, data } = await readFile(file, true);
          if (before.get(file.url) === hash) continue;
          if (await epubHasBookId(data, id)) {
            if (verified) throw failure();
            verified = { name: file.title, data };
          }
        }
        if (!verified) throw failure();
        // 保存同一份已验证字节，避免校验后源文件被替换造成误绑定。
        await save(verified.name, Readable.from([verified.data]));
        });
        domain.queue = run.catch(() => {});
        return run;
      },
      async list(dir = '/') { if (dir !== '/') return []; return (await library()).filter(item => /\.txt$/i.test(item.url)).map(item => ({ name: item.title, path: encodeLibraryPath(item.url), type: 'file', mediaType: 'text', size: item.size })); },
      async getFile(filePath) { decodeLibraryPath(filePath); const item = (await this.list('/')).find(entry => entry.path === filePath); if (!item) throw new Error('番茄文件不存在'); return item; },
      async getFileStream(filePath, range) { const rel = decodeLibraryPath(filePath); await this.getFile(filePath); return getStream(`file:${rel}`, range); }
    };
  }
  return { create, start, stop };
}
module.exports = { createTomatoProvider, parseSearch, parseLibrary, parseChapterLines, safeRelPath, parseRankPage, parseRankDetail, epubHasBookId, encodeLibraryPath, decodeLibraryPath };
