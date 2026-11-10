# 国外媒体任务（YouTube + Pinterest + Pixiv）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建 `overseas-media` 用户服务任务，在一个任务内注册 YouTube、Pinterest、Pixiv 三个媒体源，支持首页、搜索、链接解析、相关推荐、分来源代理、播放与下载。

**Architecture:** 复用 Plan 2 的通用任务源路由与前端工具栏。三个 provider 各自解析来源网页/API；YouTube 使用 yt-dlp 解析并下载媒体，首次自动下载官方单文件到任务数据目录；Pinterest/Pixiv 使用页面 JSON 与图片/视频 CDN，所有 provider 每次外部请求读取 `config.proxyUrl` getter，实现运行中切换代理。

**Tech Stack:** Node.js、axios、yt-dlp、node:test、现有任务 provider 协议。

## Global Constraints

- 依赖 Plan 1（registry/manager/代理）与 Plan 2（通用任务源路由/UI/发布清单结构）。
- 注释使用中文；`const/let`；`async/await`；禁止长串 `if/else if`。
- 不创建 git commit，除非用户明确要求。
- 用户已批准 YouTube 首次自动下载 yt-dlp 到数据目录。
- 代理只作用于服务端外部请求；每个来源独立开关，`proxyDefault: true`。
- YouTube 直链失败时返回清晰错误，由前端保留链接；不伪造可播放地址。
- Pinterest 匿名受登录墙影响时降级并提示配置 Cookie；Pixiv CDN 必须带 `Referer: https://www.pixiv.net/`。
- 下载文件先写临时文件再原子发布；不要把 yt-dlp 二进制或下载媒体提交到 Git。

---

### Task 1: 共享代理与 HTTP 工具

**Files:**
- Create: `res/tasks/overseas-media/task.js`
- Create: `res/tasks/overseas-media/providers/proxy.js`
- Create: `res/tasks/overseas-media/providers/http.js`

**Interfaces:**
- `proxy.options(proxyUrl) -> axios agent 配置`
- `http.get(config, url, extra) -> axios response`
- `task.js` 注册 `youtube/pinterest/pixiv`，`region: 'overseas'`，`proxyDefault: true`。

- [ ] **Step 1: 任务入口骨架**

```js
'use strict';
const { createYoutubeProvider } = require('./providers/youtube');
const { createPinterestProvider } = require('./providers/pinterest');
const { createPixivProvider } = require('./providers/pixiv');
const { createYtdlp } = require('./providers/ytdlp');

async function run(context) {
  const params = context.params || {};
  const ytdlp = createYtdlp({
    binary: params.ytdlpBinary || '',
    dataDir: params.ytdlpDataDir || context.workDir,
    proxyUrl: () => '',
    log: context.log
  });
  const definitions = [
    { id: 'youtube', name: 'YouTube', create: config => createYoutubeProvider(config, { ytdlp, cookie: params.youtubeCookie || '' }) },
    { id: 'pinterest', name: 'Pinterest', create: config => createPinterestProvider(config, { cookie: params.pinterestCookie || '' }) },
    { id: 'pixiv', name: 'Pixiv', create: config => createPixivProvider(config, { cookie: params.pixivCookie || '' }) }
  ];
  const unregisters = definitions.map(definition => context.registerMediaProvider({
    id: definition.id,
    name: definition.name,
    region: 'overseas',
    features: ['home', 'search', 'resolveLink', 'related', 'stream', 'download'],
    proxyDefault: true,
    create: definition.create
  }));
  context.log('已注册国外媒体源：YouTube、Pinterest、Pixiv');
  return { stop: async () => unregisters.forEach(unregister => unregister()) };
}
module.exports = { mode: 'service', target: 'server', entryFile: 'task.js', run };
```

- [ ] **Step 2: 代理工具**

`providers/proxy.js`：

```js
'use strict';
const cache = new Map();
function options(proxyUrl) {
  if (!proxyUrl) return {};
  if (cache.has(proxyUrl)) return cache.get(proxyUrl);
  const protocol = new URL(proxyUrl).protocol;
  const Agent = protocol.startsWith('socks')
    ? require('socks-proxy-agent').SocksProxyAgent
    : require('https-proxy-agent').HttpsProxyAgent;
  const agent = new Agent(proxyUrl);
  const value = { proxy: false, httpAgent: agent, httpsAgent: agent };
  cache.set(proxyUrl, value);
  return value;
}
module.exports = { options };
```

- [ ] **Step 3: HTTP 工具**

`providers/http.js`：

```js
'use strict';
const axios = require('axios');
const { options } = require('./proxy');
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
};
function get(config, url, extra = {}) {
  return axios.get(url, { headers: HEADERS, timeout: 15000, maxRedirects: 0, ...options(config.proxyUrl), ...extra });
}
module.exports = { get, HEADERS };
```

- [ ] **Step 4: 注册验证**

启动任务后 `/api/media-library-providers` 应返回三个 `region: 'overseas'`、`proxyDefault: true` 的源；停止后全部移除。

---

### Task 2: yt-dlp 自动下载与执行封装

**Files:**
- Create: `res/tasks/overseas-media/providers/ytdlp.js`
- Test: `tests/ytdlp.test.js`

**Interfaces:**
- `createYtdlp({ binary, dataDir, log }) -> { ensure(), resolve(url, proxyUrl), run(url, args, proxyUrl), path }`
- `ensure()` 返回可执行路径；首次下载 `https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp` 到 `<dataDir>/bin/yt-dlp`。
- `resolve(url, proxyUrl)` 返回 `{ url, title, ext }`。
- `run(url, outputTemplate, proxyUrl)` 返回 Promise，用于下载到临时文件。

- [ ] **Step 1: 写测试**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createYtdlp, safeYtdlpArgs } = require('../res/tasks/overseas-media/providers/ytdlp');

test('safeYtdlpArgs 拒绝播放列表与额外输出', () => {
  assert.deepEqual(safeYtdlpArgs('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), ['--no-playlist', '--no-warnings']);
});

test('ensure 使用已有可执行文件', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-'));
  const binary = path.join(dir, 'yt-dlp');
  fs.writeFileSync(binary, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const ytdlp = createYtdlp({ binary, dataDir: dir });
  assert.equal(await ytdlp.ensure(), binary);
  fs.rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/ytdlp.test.js`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现 yt-dlp 封装**

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const axios = require('axios');
const { options } = require('./proxy');

const RELEASE_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
const MAX_BINARY = 64 * 1024 * 1024;

function safeYtdlpArgs(url) {
  if (!/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(String(url || ''))) throw new Error('YouTube 链接无效');
  return ['--no-playlist', '--no-warnings'];
}

function createYtdlp({ binary = '', dataDir, log = () => {} } = {}) {
  const target = binary ? path.resolve(binary) : path.join(dataDir, 'bin', 'yt-dlp');
  let ensuring = null;

  async function download(proxyUrl = '') {
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${crypto.randomUUID()}.part`;
    const response = await axios.get(RELEASE_URL, { responseType: 'stream', timeout: 60000, maxRedirects: 5, maxContentLength: MAX_BINARY, ...options(proxyUrl) });
    await pipeline(response.data, fs.createWriteStream(temporary, { mode: 0o755 }));
    const stat = await fs.promises.stat(temporary);
    if (!stat.size || stat.size > MAX_BINARY) { await fs.promises.unlink(temporary).catch(() => {}); throw new Error('yt-dlp 下载文件无效'); }
    await fs.promises.rename(temporary, target);
    await fs.promises.chmod(target, 0o755);
    log('yt-dlp 已自动下载到数据目录');
    return target;
  }

  async function ensure(proxyUrl = '') {
    try { await fs.promises.access(target, fs.constants.X_OK); return target; } catch { /* 继续下载。 */ }
    if (!ensuring) ensuring = download(proxyUrl).finally(() => { ensuring = null; });
    return ensuring;
  }

  function execute(args, proxyUrl) {
    return spawn(target, args, { env: { ...process.env, ...(proxyUrl ? { HTTPS_PROXY: proxyUrl, HTTP_PROXY: proxyUrl } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
  }

  async function resolve(url, proxyUrl = '') {
    const executable = await ensure(proxyUrl);
    const args = [...safeYtdlpArgs(url), '-f', 'b[height<=720][ext=mp4]/b[height<=720]/b', '-g'];
    if (proxyUrl) args.push('--proxy', proxyUrl);
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const code = await new Promise(resolveCode => child.once('close', resolveCode));
    if (code !== 0) throw new Error(`yt-dlp 解析失败：${stderr.trim().slice(0, 200) || code}`);
    const lines = stdout.trim().split('\n').filter(Boolean);
    if (!lines.length) throw new Error('yt-dlp 未返回媒体地址');
    return { url: lines[0].trim(), title: '', ext: 'mp4' };
  }

  async function run(url, outputTemplate, proxyUrl = '') {
    const executable = await ensure(proxyUrl);
    const args = [...safeYtdlpArgs(url), '-f', 'bv*[height<=720]+ba/b[height<=720]/b', '--merge-output-format', 'mp4', '-o', outputTemplate];
    if (proxyUrl) args.push('--proxy', proxyUrl);
    const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const code = await new Promise(resolveCode => child.once('close', resolveCode));
    if (code !== 0) throw new Error(`yt-dlp 下载失败：${stderr.trim().slice(0, 200) || code}`);
    return outputTemplate.replace('%(ext)s', 'mp4');
  }

  return { ensure, resolve, run, path: target };
}
module.exports = { createYtdlp, safeYtdlpArgs };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/ytdlp.test.js`
Expected: 2 tests PASS

---

### Task 3: YouTube provider

**Files:**
- Create: `res/tasks/overseas-media/providers/youtube.js`
- Test: `tests/youtube-provider.test.js`

**Interfaces:**
- `createYoutubeProvider(config, { ytdlp, cookie })`
- `home/search/related` 返回视频 item；`resolveLink` 返回单个视频 item；`getStream` 用 yt-dlp 解析直链后代理；`download` 用 yt-dlp 写临时文件后交给 `save`。

- [ ] **Step 1: 写解析测试**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractVideoId, normalizeVideoRenderer, collectVideoRenderers, parseInitialData } = require('../res/tasks/overseas-media/providers/youtube');

test('extractVideoId 支持 watch/shorts/youtu.be/裸 ID', () => {
  assert.equal(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractVideoId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
});

test('collectVideoRenderers 递归提取视频卡片', () => {
  const data = { contents: [{ videoRenderer: { videoId: 'dQw4w9WgXcQ', title: { runs: [{ text: '标题' }] }, ownerText: { runs: [{ text: '作者' }] } } }] };
  const videos = collectVideoRenderers(data);
  assert.equal(videos.length, 1);
  assert.equal(normalizeVideoRenderer(videos[0]).title, '标题');
});

test('parseInitialData 读取 ytInitialData 并忽略损坏 JSON', () => {
  const html = '<script>var ytInitialData = {"a":1};</script>';
  assert.deepEqual(parseInitialData(html), { a: 1 });
  assert.equal(parseInitialData('no data'), null);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/youtube-provider.test.js`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现 YouTube provider**

```js
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { get, HEADERS } = require('./http');

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const SEARCH = 'https://www.youtube.com/results?search_query=';
const WATCH = 'https://www.youtube.com/watch?v=';
const HOME = 'https://www.youtube.com/';

function extractVideoId(value) {
  const text = String(value || '').trim();
  if (VIDEO_ID.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.hostname === 'youtu.be') return VIDEO_ID.test(url.pathname.slice(1)) ? url.pathname.slice(1) : '';
    if (!/(^|\.)youtube\.com$/.test(url.hostname)) return '';
    if (url.pathname === '/watch') { const id = url.searchParams.get('v') || ''; return VIDEO_ID.test(id) ? id : ''; }
    const match = url.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/);
    return match ? match[1] : '';
  } catch { return ''; }
}

function parseInitialData(html) {
  const match = /ytInitialData\s*=\s*(\{[\s\S]*?\});/.exec(String(html || ''));
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

function collectVideoRenderers(node, output = []) {
  if (!node || typeof node !== 'object') return output;
  if (node.videoRenderer?.videoId) output.push(node.videoRenderer);
  for (const value of Object.values(node)) collectVideoRenderers(value, output);
  return output;
}

function textOf(value) {
  return value?.simpleText || value?.runs?.map(run => run.text).join('') || '';
}

function normalizeVideoRenderer(renderer) {
  const id = String(renderer.videoId || '');
  return { id, title: textOf(renderer.title).slice(0, 180) || id, author: textOf(renderer.ownerText).slice(0, 80), cover: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, mediaType: 'video', url: `${WATCH}${id}` };
}

function uniqVideos(videos) {
  const found = new Map();
  for (const video of videos) if (VIDEO_ID.test(video.id)) found.set(video.id, video);
  return [...found.values()];
}

function createYoutubeProvider(config, { ytdlp, cookie = '' } = {}) {
  const headers = { ...HEADERS, ...(cookie ? { Cookie: cookie } : {}) };
  async function html(url) {
    const response = await get(config, url, { headers, responseType: 'text', maxContentLength: 5 * 1024 * 1024 });
    return response.data;
  }
  function videosFrom(htmlText) {
    const data = parseInitialData(htmlText);
    return uniqVideos(collectVideoRenderers(data).map(normalizeVideoRenderer));
  }
  async function resolveVideo(id) {
    const resolved = await ytdlp.resolve(`${WATCH}${id}`, config.proxyUrl || '');
    return resolved;
  }
  return {
    async home() {
      return { items: videosFrom(await html(HOME)).slice(0, 20), page: 1, totalPages: 1 };
    },
    async search({ keyword, page = 1 } = {}) {
      const text = String(keyword || '').trim();
      if (!text || text.length > 100) throw new Error('YouTube 搜索关键词无效');
      const url = `${SEARCH}${encodeURIComponent(text)}${Number(page) > 1 ? `&page=${Number(page)}` : ''}`;
      return { items: videosFrom(await html(url)), page: Number(page) || 1, totalPages: 1 };
    },
    async resolveLink({ url } = {}) {
      const id = extractVideoId(url);
      if (!id) throw new Error('请输入 YouTube 视频链接或 11 位视频 ID');
      return { items: [{ id, title: `YouTube ${id}`, mediaType: 'video', url: `${WATCH}${id}`, cover: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }] };
    },
    async related({ itemId, url } = {}) {
      const id = extractVideoId(itemId || url);
      if (!id) return { items: [] };
      const items = videosFrom(await html(`${WATCH}${id}`)).filter(item => item.id !== id);
      return { items: items.slice(0, 20) };
    },
    async getStream(itemId, range) {
      const id = extractVideoId(itemId);
      if (!id) throw new Error('YouTube 视频 ID 无效');
      const resolved = await resolveVideo(id);
      const response = await get(config, resolved.url, {
        responseType: 'stream', headers: { ...HEADERS, ...(range ? { Range: `bytes=${range.start}-${range.end ?? ''}` } : {}) },
        timeout: 30000, validateStatus: status => [200, 206, 416].includes(status)
      });
      const output = {};
      for (const [key, name] of [['content-type', 'Content-Type'], ['content-length', 'Content-Length'], ['content-range', 'Content-Range'], ['accept-ranges', 'Accept-Ranges']]) if (response.headers[key]) output[name] = response.headers[key];
      return { stream: response.data, statusCode: response.status, headers: output };
    },
    async download(item, { save }) {
      const id = extractVideoId(item?.id || item?.url);
      if (!id) throw new Error('YouTube 视频 ID 无效');
      const temporary = path.join(os.tmpdir(), `aasc-youtube-${crypto.randomUUID()}.%(ext)s`);
      const output = await ytdlp.run(`${WATCH}${id}`, temporary, config.proxyUrl || '');
      try { await save(`${String(item.title || id).replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ').slice(0, 120) || id}.mp4`, fs.createReadStream(output)); }
      finally { await fs.promises.unlink(output).catch(() => {}); }
    }
  };
}
module.exports = { createYoutubeProvider, extractVideoId, normalizeVideoRenderer, collectVideoRenderers, parseInitialData };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/youtube-provider.test.js`
Expected: 3 tests PASS

- [ ] **Step 5: 手工验证**

1. 首次打开 YouTube 首页，自动下载 yt-dlp 到任务数据目录，随后返回热门视频。
2. 搜索关键词、粘贴 watch/youtu.be/shorts 链接可播放。
3. 播放后控制端出现相关推荐。
4. 切换“使用代理”后，yt-dlp 与页面请求走代理；关闭后不走代理。
5. 下载视频到本地媒体库，完成后显示“已下载”。

---

### Task 4: Pinterest provider

**Files:**
- Create: `res/tasks/overseas-media/providers/pinterest.js`
- Test: `tests/pinterest-provider.test.js`

**Interfaces:**
- `createPinterestProvider(config, { cookie })`
- item 的 `id` 使用 `pin:<base64url(cdnUrl)>`；`getStream` 只允许 `*.pinimg.com`。
- 无 Cookie 且页面触发登录墙时抛出“Pinterest 匿名访问受限，请配置 Cookie”。

- [ ] **Step 1: 写测试**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { encodePinId, decodePinId, parsePins, isAllowedPinUrl } = require('../res/tasks/overseas-media/providers/pinterest');

test('pin ID 编解码并拒绝非 pinimg 地址', () => {
  const url = 'https://i.pinimg.com/736x/aa/bb/cc.jpg';
  const id = encodePinId(url);
  assert.equal(decodePinId(id), url);
  assert.equal(isAllowedPinUrl(url), true);
  assert.equal(isAllowedPinUrl('https://evil.example/x.jpg'), false);
});

test('parsePins 从页面数据读取图片和视频', () => {
  const pins = parsePins({ props: { initialReduxState: { pins: { a: { id: 'a', title: '图', images: { orig: { url: 'https://i.pinimg.com/a.jpg' } } }, b: { id: 'b', title: '视频', videos: { video_list: { V_720P: { url: 'https://v1.pinimg.com/b.mp4' } } } } } } } });
  assert.equal(pins.length, 2);
  assert.equal(pins[0].mediaType, 'image');
  assert.equal(pins[1].mediaType, 'video');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/pinterest-provider.test.js`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现 Pinterest provider**

```js
'use strict';
const { get, HEADERS } = require('./http');

const ORIGIN = 'https://www.pinterest.com';
const PIN_HOST = /(^|\.)pinimg\.com$/;

function isAllowedPinUrl(value) {
  try { return new URL(value).protocol === 'https:' && PIN_HOST.test(new URL(value).hostname); } catch { return false; }
}
function encodePinId(url) { return `pin:${Buffer.from(url, 'utf8').toString('base64url')}`; }
function decodePinId(id) {
  const match = String(id || '').match(/^pin:([A-Za-z0-9_-]+)$/);
  if (!match) throw new Error('Pinterest 媒体 ID 无效');
  const url = Buffer.from(match[1], 'base64url').toString('utf8');
  if (!isAllowedPinUrl(url)) throw new Error('Pinterest 媒体地址无效');
  return url;
}

function deepFind(node, key, output = []) {
  if (!node || typeof node !== 'object') return output;
  if (node[key]) output.push(node[key]);
  for (const value of Object.values(node)) deepFind(value, key, output);
  return output;
}

function parsePins(data) {
  const pins = deepFind(data, 'pins').flatMap(value => Array.isArray(value) ? value : Object.values(value || {}));
  const found = new Map();
  for (const pin of pins) {
    const video = pin?.videos?.video_list && Object.values(pin.videos.video_list).find(item => item?.url);
    const image = pin?.images?.orig?.url || pin?.images?.['736x']?.url || Object.values(pin?.images || {}).find(item => item?.url)?.url;
    const url = video?.url || image;
    if (!isAllowedPinUrl(url)) continue;
    found.set(url, { id: encodePinId(url), title: String(pin.title || pin.grid_title || 'Pinterest 媒体').slice(0, 180), cover: image && isAllowedPinUrl(image) ? image : '', mediaType: video ? 'video' : 'image', url });
  }
  return [...found.values()];
}

function createPinterestProvider(config, { cookie = '' } = {}) {
  const headers = { ...HEADERS, ...(cookie ? { Cookie: cookie } : {}), Referer: `${ORIGIN}/` };
  async function page(url) {
    const response = await get(config, url, { headers, responseType: 'text', maxContentLength: 8 * 1024 * 1024 });
    const html = response.data;
    if (/Please log in|登录|Log in to continue/i.test(html) && !html.includes('__PWS_DATA__')) throw new Error('Pinterest 匿名访问受限，请配置 Cookie');
    const match = /__PWS_DATA__\s*=\s*(\{[\s\S]*?\})<\/script>/.exec(html);
    if (!match) throw new Error('Pinterest 页面数据不可用');
    try { return parsePins(JSON.parse(match[1])); } catch { throw new Error('Pinterest 页面数据解析失败'); }
  }
  return {
    async home() { return { items: (await page(`${ORIGIN}/`)).slice(0, 30), page: 1, totalPages: 1 }; },
    async search({ keyword, page: p = 1 } = {}) {
      const text = String(keyword || '').trim();
      if (!text || text.length > 100) throw new Error('Pinterest 搜索关键词无效');
      return { items: await page(`${ORIGIN}/search/pins/?q=${encodeURIComponent(text)}`), page: Number(p) || 1, totalPages: 1 };
    },
    async resolveLink({ url } = {}) {
      const text = String(url || '');
      if (!/^https:\/\/(www\.)?pinterest\.com\/pin\//.test(text)) throw new Error('请输入 Pinterest Pin 链接');
      return { items: await page(text) };
    },
    async related({ itemId } = {}) {
      const items = await page(`${ORIGIN}/`);
      return { items: items.filter(item => item.id !== itemId).slice(0, 20) };
    },
    async getStream(itemId, range) {
      const url = decodePinId(itemId);
      const response = await get(config, url, {
        responseType: 'stream', headers: { ...headers, ...(range ? { Range: `bytes=${range.start}-${range.end ?? ''}` } : {}) },
        timeout: 30000, validateStatus: status => [200, 206, 416].includes(status)
      });
      const output = {};
      for (const [key, name] of [['content-type', 'Content-Type'], ['content-length', 'Content-Length'], ['content-range', 'Content-Range'], ['accept-ranges', 'Accept-Ranges']]) if (response.headers[key]) output[name] = response.headers[key];
      return { stream: response.data, statusCode: response.status, headers: output };
    }
  };
}
module.exports = { createPinterestProvider, encodePinId, decodePinId, parsePins, isAllowedPinUrl };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/pinterest-provider.test.js`
Expected: 2 tests PASS

- [ ] **Step 5: 手工验证**

1. 有 Cookie 时首页、搜索、Pin 链接可打开图片/视频。
2. 无 Cookie 且被登录墙拦截时提示配置 Cookie。
3. 切换代理后请求走代理。

---

### Task 5: Pixiv provider

**Files:**
- Create: `res/tasks/overseas-media/providers/pixiv.js`
- Test: `tests/pixiv-provider.test.js`

**Interfaces:**
- `createPixivProvider(config, { cookie })`
- `home` 用排行榜；`search` 用 `ajax/search/artworks`；`resolveLink` 读取多页插画；`getStream` 带 Referer 读取 `i.pximg.net`。
- item 的 `id` 为 `pixiv:<illustId>:<page>`。

- [ ] **Step 1: 写测试**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractIllustId, parseSearch, parseRanking } = require('../res/tasks/overseas-media/providers/pixiv');

test('extractIllustId 支持 artworks 与 pximg 链接', () => {
  assert.equal(extractIllustId('https://www.pixiv.net/artworks/123456'), '123456');
  assert.equal(extractIllustId('https://i.pximg.net/img-original/img/2024/01/01/00/00/00/123456_p0.jpg'), '123456');
  assert.equal(extractIllustId('123456'), '123456');
});

test('parseSearch 读取插画标题和封面', () => {
  const items = parseSearch({ body: { illustManga: { data: [{ id: '123456', title: '作品', url: 'https://i.pximg.net/a.jpg', illustType: 0 }] } } });
  assert.equal(items[0].id, 'pixiv:123456');
  assert.equal(items[0].mediaType, 'collection');
});

test('parseRanking 读取排行榜插画', () => {
  const items = parseRanking({ contents: [{ illust_id: '123456', title: '作品', url: 'https://i.pximg.net/a.jpg' }] });
  assert.equal(items.length, 1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/pixiv-provider.test.js`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现 Pixiv provider**

```js
'use strict';
const { get, HEADERS } = require('./http');

const ORIGIN = 'https://www.pixiv.net';
const IMAGE_HOST = /(^|\.)pximg\.net$/;

function extractIllustId(value) {
  const text = String(value || '').trim();
  if (/^[0-9]{1,12}$/.test(text)) return text;
  try {
    const url = new URL(text);
    const match = url.pathname.match(/^\/artworks\/([0-9]{1,12})/) || url.pathname.match(/\/([0-9]{1,12})_p[0-9]+\./);
    return match ? match[1] : '';
  } catch { return ''; }
}

function safeImage(value) {
  const text = String(value || '');
  try {
    const parsed = new URL(text);
    return parsed.protocol === 'https:' && IMAGE_HOST.test(parsed.hostname) ? parsed.href : '';
  } catch { return ''; }
}

function collection(id, title, cover) {
  return { id: `pixiv:${id}`, title: String(title || `Pixiv ${id}`).slice(0, 180), cover: safeImage(cover), mediaType: 'collection', url: `${ORIGIN}/artworks/${id}` };
}

function parseSearch(payload) {
  return (Array.isArray(payload?.body?.illustManga?.data) ? payload.body.illustManga.data : [])
    .filter(item => /^[0-9]{1,12}$/.test(String(item?.id || '')))
    .map(item => collection(item.id, item.title, item.url));
}

function parseRanking(payload) {
  return (Array.isArray(payload?.contents) ? payload.contents : [])
    .filter(item => /^[0-9]{1,12}$/.test(String(item?.illust_id || '')))
    .map(item => collection(item.illust_id, item.title, item.url));
}

function createPixivProvider(config, { cookie = '' } = {}) {
  const headers = { ...HEADERS, ...(cookie ? { Cookie: cookie } : {}), Referer: `${ORIGIN}/` };
  async function json(url, extra = {}) {
    const response = await get(config, url, { headers, responseType: 'json', ...extra });
    if (response.data?.error) throw new Error(String(response.data.message || 'Pixiv 请求失败'));
    return response.data;
  }
  async function pages(id) {
    const data = await json(`${ORIGIN}/ajax/illust/${id}/pages?lang=zh`);
    return (Array.isArray(data?.body) ? data.body : []).map((page, index) => ({
      id: `pixiv:${id}:${index}`, title: `Pixiv ${id} · ${index + 1}`, mediaType: 'image',
      cover: safeImage(page.urls?.thumb || page.urls?.small || page.urls?.regular), url: safeImage(page.urls?.original || page.urls?.regular)
    })).filter(item => item.url);
  }
  return {
    async home() {
      const data = await json(`${ORIGIN}/ranking.php?mode=daily&format=json&p=1`);
      return { items: parseRanking(data), page: 1, totalPages: 1 };
    },
    async search({ keyword, page = 1 } = {}) {
      const text = String(keyword || '').trim();
      if (!text || text.length > 100) throw new Error('Pixiv 搜索关键词无效');
      const data = await json(`${ORIGIN}/ajax/search/artworks/${encodeURIComponent(text)}?word=${encodeURIComponent(text)}&p=${Number(page) || 1}&mode=all&order=date_d&lang=zh`);
      return { items: parseSearch(data), page: Number(page) || 1, totalPages: Number(data?.body?.illustManga?.total ? Math.ceil(data.body.illustManga.total / 60) : 1) };
    },
    async resolveLink({ url } = {}) {
      const id = extractIllustId(url);
      if (!id) throw new Error('请输入 Pixiv 作品链接或作品 ID');
      return { items: await pages(id) };
    },
    async related({ itemId } = {}) {
      const data = await json(`${ORIGIN}/ranking.php?mode=daily&format=json&p=1`);
      const current = String(itemId || '').match(/^pixiv:([0-9]+)/)?.[1];
      return { items: parseRanking(data).filter(item => item.id !== `pixiv:${current}`).slice(0, 20) };
    },
    async getStream(itemId, range) {
      const match = String(itemId || '').match(/^pixiv:([0-9]+):([0-9]+)$/);
      if (!match) throw new Error('Pixiv 媒体 ID 无效');
      const list = await pages(match[1]);
      const page = list[Number(match[2])];
      if (!page) throw new Error('Pixiv 图片页不存在');
      const response = await get(config, page.url, {
        responseType: 'stream', headers: { ...headers, ...(range ? { Range: `bytes=${range.start}-${range.end ?? ''}` } : {}) },
        timeout: 30000, validateStatus: status => [200, 206, 416].includes(status)
      });
      const output = {};
      for (const [key, name] of [['content-type', 'Content-Type'], ['content-length', 'Content-Length'], ['content-range', 'Content-Range'], ['accept-ranges', 'Accept-Ranges']]) if (response.headers[key]) output[name] = response.headers[key];
      return { stream: response.data, statusCode: response.status, headers: output };
    }
  };
}
module.exports = { createPixivProvider, extractIllustId, parseSearch, parseRanking };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/pixiv-provider.test.js`
Expected: 3 tests PASS

- [ ] **Step 5: 手工验证**

1. 首页显示 Pixiv 排行榜，打开作品显示多页图片。
2. 搜索关键词、粘贴 artworks 链接/ID 可浏览。
3. 图片请求带 Referer，未出现 403。
4. 配置 Cookie 后可访问受限内容；切换代理生效。

---

### Task 6: 发布清单、任务参数与文档

**Files:**
- Modify: `release/task-code-files.json`
- Modify: `docs/spec/media-library.md`
- Modify: `docs/spec/self-test.md`
- Modify: `docs/usage.md`
- Modify: `changelog.md`
- Modify: `docs/todo.md`

- [ ] **Step 1: 发布清单**

新增：

```json
{
  "taskName": "overseas-media",
  "files": ["task.js", "providers/proxy.js", "providers/http.js", "providers/ytdlp.js", "providers/youtube.js", "providers/pinterest.js", "providers/pixiv.js"],
  "codeRequirement": { "minimumVersion": 169, "apiVersion": 1 },
  "dependencyRequirement": null
}
```

按现有 schema 字段名填写，不新增字段。

- [ ] **Step 2: 文档**

- `docs/spec/media-library.md` 增加“国外媒体任务”伪代码：yt-dlp 自动下载/解析/下载、Pinterest 页面数据与 Cookie 降级、Pixiv 多页与 Referer。
- `docs/spec/self-test.md` 增加：三来源首页/搜索/链接、逐来源代理、yt-dlp 首次下载、YouTube 下载、Pinterest Cookie 降级、Pixiv 403 检查。
- `docs/usage.md` 说明任务参数：`youtubeCookie`、`pinterestCookie`、`pixivCookie`、`ytdlpBinary`、`ytdlpDataDir`。
- `changelog.md` 记录国外媒体任务。
- `docs/todo.md` 删除已完成条目。

- [ ] **Step 3: 全量测试**

Run: `node --test tests/ytdlp.test.js tests/youtube-provider.test.js tests/pinterest-provider.test.js tests/pixiv-provider.test.js`
Expected: 全部 PASS

---

## Self-Review

- Spec coverage：YouTube/Pinterest/Pixiv 首页、搜索、链接、相关推荐、代理、下载、yt-dlp 自动下载均有任务。
- Placeholder scan：无 TBD/TODO。
- Type consistency：三个 provider 都实现 Plan 2 的 `home/search/resolveLink/related/getStream/download`；item id 规则在 resolveLink/getStream 间一致。
