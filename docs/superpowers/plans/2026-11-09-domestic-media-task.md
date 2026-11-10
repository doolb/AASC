# 国内媒体任务（红果短剧 + 番茄小说）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建 `domestic-media` 用户服务任务，在一个任务内注册红果短剧与番茄小说两个媒体源，提供首页、搜索、链接解析、相关推荐、流式播放、下载和已下载状态。

**Architecture:** 先补齐 Plan 1 定义的任务源通用 HTTP 路由与前端工具栏，再实现 `res/tasks/domestic-media/`。红果复用网页 JSON-LD 与公开搜索 API；番茄以子进程方式托管 `/mnt/novel/TomatoNovelDownloader... --server`，provider 通过本地 HTTP API 搜索、建下载任务、读取书库与章节文本。

**Tech Stack:** Node.js、axios、cheerio、child_process、node:test、现有控制端 DOM/WS。

## Global Constraints

- 依赖 Plan 1：`TaskMediaProviderRegistry` metadata、`MediaLibraryManager.callTaskSource/getTaskSourceProvider`、代理配置、B 站/夸克功能。
- 注释使用中文；`const/let`；`async/await`；禁止长串 `if/else if`。
- 不创建 git commit，除非用户明确要求。
- 红果不猜测隐藏剧集地址，只使用网页公开的 `360p.mp4` 与公开搜索接口。
- 番茄不反推网页搜索/正文接口，只调用下载器 server API。
- 番茄子进程必须使用独立 PID/进程组；停止任务时先 SIGINT，等待 5 秒后 SIGKILL 兜底。
- 任务停止、启动失败、端口占用必须给出明确中文错误，不影响 AASC 主服务启动。
- 下载目标只允许主服务器上可写本地媒体库。

---

### Task 1: 任务源通用 HTTP 路由

**Files:**
- Modify: `src/apps/server/boot/server-app.js`（媒体路由区，L6029 后）
- Create: `src/apps/server/modules/media/task-media-download-index.js`
- Test: `tests/task-media-download-index.test.js`

**Interfaces:**
- `GET /api/task-media-sources/:id/home?page=`
- `GET /api/task-media-sources/:id/search?keyword=&page=`
- `POST /api/task-media-sources/:id/resolve-link { url }`
- `GET /api/task-media-sources/:id/related?itemId=&url=`
- `GET /api/task-media-sources/:id/stream/:itemId`（支持 Range）
- `POST /api/task-media-sources/:id/download { item, targetId, dirPath }`
- Provider 返回 item：`{ id, title, cover, mediaType, description?, duration?, meta? }`；路由补齐 `{ playUrl, downloaded }`。
- Provider 可选实现 `getStream(itemId, range)`；未实现时 item 必须自带绝对 `playUrl`。

- [ ] **Step 1: 写下载索引测试**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TaskMediaDownloadIndex } = require('../src/apps/server/modules/media/task-media-download-index');

test('记录并查询任务源下载状态', async () => {
    const indexPath = path.join(os.tmpdir(), `task-media-index-${process.pid}.json`);
    const index = new TaskMediaDownloadIndex({ indexPath });
    await index.record({ providerId: 'hongguo', itemId: 'episode:1', targetId: 'local', relative: '红果/1.mp4', size: 10 });
    const found = await index.lookup('hongguo', 'episode:1');
    assert.equal(found.relative, '红果/1.mp4');
    assert.equal(await index.lookup('hongguo', 'episode:2'), null);
    fs.rmSync(indexPath, { force: true });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/task-media-download-index.test.js`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现下载索引**

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');

class TaskMediaDownloadIndex {
    constructor({ indexPath }) {
        this.indexPath = indexPath;
        this.records = [];
        try {
            const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
            this.records = Array.isArray(parsed) ? parsed : [];
        } catch { this.records = []; }
    }
    key(providerId, itemId) { return JSON.stringify([providerId, itemId]); }
    async lookup(providerId, itemId, targetId = '') {
        return this.records.find(record => this.key(providerId, itemId) === this.key(record.providerId, record.itemId) && (!targetId || record.targetId === targetId)) || null;
    }
    async record(entry) {
        const item = {
            providerId: entry.providerId, itemId: entry.itemId, targetId: entry.targetId,
            relative: entry.relative, size: entry.size, updatedAt: Date.now()
        };
        const key = this.key(item.providerId, item.itemId);
        this.records = this.records.filter(record => this.key(record.providerId, record.itemId) !== key || record.targetId !== item.targetId);
        this.records.push(item);
        await fs.promises.mkdir(path.dirname(this.indexPath), { recursive: true });
        await fs.promises.writeFile(this.indexPath, JSON.stringify(this.records, null, 2));
        return item;
    }
}
module.exports = { TaskMediaDownloadIndex };
```

- [ ] **Step 4: server-app 增加路由**

在 `quarkDirectoryDownloads` 初始化后创建：

```js
const { TaskMediaDownloadIndex } = require('../modules/media/task-media-download-index');
const taskMediaDownloads = new TaskMediaDownloadIndex({ indexPath: path.join(USER_CONFIG_DIR, 'task-media-downloads.json') });

function taskSourceBase() { return `${useHttps ? 'https' : 'http'}://${getLocalIP()}:${PORT}`; }

async function decorateTaskSourceResult(providerId, result) {
    const provider = mediaLibraryManager.getTaskSourceProvider(providerId).getImplementation();
    const items = (Array.isArray(result?.items) ? result.items : []).map(item => ({
        ...item,
        playUrl: item.playUrl || (typeof provider.getStream === 'function'
            ? `${taskSourceBase()}/api/task-media-sources/${encodeURIComponent(providerId)}/stream/${encodeURIComponent(item.id)}`
            : ''),
        downloaded: false
    }));
    await Promise.all(items.map(async item => {
        item.downloaded = Boolean(await taskMediaDownloads.lookup(providerId, item.id));
    }));
    return { ...result, items };
}

function taskRoute(handler) {
    return async (req, res) => {
        try { res.json({ status: 'success', ...await handler(req) }); }
        catch (error) { res.status(400).json({ status: 'error', message: error.message }); }
    };
}

app.get('/api/task-media-sources/:id/home', taskRoute(async req => decorateTaskSourceResult(req.params.id,
    await mediaLibraryManager.callTaskSource(req.params.id, 'home', { page: req.query.page || 1 }))));

app.get('/api/task-media-sources/:id/search', taskRoute(async req => decorateTaskSourceResult(req.params.id,
    await mediaLibraryManager.callTaskSource(req.params.id, 'search', { keyword: req.query.keyword, page: req.query.page || 1 }))));

app.post('/api/task-media-sources/:id/resolve-link', taskRoute(async req => decorateTaskSourceResult(req.params.id,
    await mediaLibraryManager.callTaskSource(req.params.id, 'resolveLink', { url: req.body?.url }))));

app.get('/api/task-media-sources/:id/related', taskRoute(async req => decorateTaskSourceResult(req.params.id,
    await mediaLibraryManager.callTaskSource(req.params.id, 'related', { itemId: req.query.itemId || '', url: req.query.url || '' }))));
```

流路由：

```js
app.get('/api/task-media-sources/:id/stream/:itemId', async (req, res) => {
    try {
        const provider = mediaLibraryManager.getTaskSourceProvider(req.params.id).getImplementation();
        if (typeof provider.getStream !== 'function') throw new Error('任务媒体源不支持流式播放');
        const range = req.headers.range ? (() => {
            const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
            return match ? { start: Number(match[1]), end: match[2] ? Number(match[2]) : undefined } : undefined;
        })() : undefined;
        const result = await provider.getStream(req.params.itemId, range);
        res.status(result.statusCode || 200);
        for (const [key, value] of Object.entries(result.headers || {})) res.set(key, value);
        result.stream.pipe(res);
    } catch (error) { res.status(502).json({ status: 'error', message: error.message }); }
});
```

下载路由：

```js
app.post('/api/task-media-sources/:id/download', async (req, res) => {
    try {
        const { id } = req.params;
        const item = req.body?.item;
        const targetId = String(req.body?.targetId || '');
        if (!item || typeof item.id !== 'string' || !targetId) throw new Error('下载参数无效');
        const registration = mediaLibraryManager.taskMediaProviders.get(id);
        if (!registration?.features.includes('download')) throw new Error('任务媒体源不支持下载');
        if (await taskMediaDownloads.lookup(id, item.id, targetId)) {
            res.json({ status: 'success', downloaded: true, skipped: true });
            return;
        }
        const target = mediaLibraryManager.getLibrary(targetId);
        if (!target || target.config.type !== 'local' || target.config.readonly || !target.provider.basePath) throw new Error('请选择主服务器上的可写本地媒体库');
        const root = await fs.promises.realpath(target.provider.basePath);
        const directory = await fs.promises.mkdir(path.join(root, registration.name.replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ')), { recursive: true });
        const provider = mediaLibraryManager.getTaskSourceProvider(id).getImplementation();
        const save = async (fileName, stream) => {
            const safeName = String(fileName || item.title || item.id).replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ').trim().slice(0, 120) || item.id;
            const output = path.join(directory, safeName);
            const temporary = path.join(directory, `.aasc-${crypto.randomUUID()}.part`);
            await pipeline(stream, fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
            await fs.promises.rename(temporary, output);
            const stat = await fs.promises.stat(output);
            await taskMediaDownloads.record({ providerId: id, itemId: item.id, targetId, relative: path.relative(root, output), size: stat.size });
            return { fileName: safeName, size: stat.size };
        };
        if (typeof provider.download === 'function') await provider.download(item, { targetId, directory, save });
        else {
            const result = await provider.getStream(item.id);
            await save(item.fileName || `${item.title || item.id}.mp4`, result.stream);
        }
        res.json({ status: 'success', downloaded: true });
    } catch (error) { res.status(400).json({ status: 'error', message: error.message }); }
});
```

确认 `fs`/`path`/`crypto`/`pipeline` 已在 server-app 顶部引入；若未引入则补：

```js
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test tests/task-media-download-index.test.js`
Expected: 1 test PASS

---

### Task 2: 任务源前端工具栏与列表

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/upload.html:155-162`
- Modify: `src/apps/web-mediacenter/ui/public/js/media-library.js:673-710, 1676-1761`
- Modify: `src/apps/web-mediacenter/ui/public/css/media-library.css`

**Interfaces:**
- 任务源切换后显示 `#taskMediaSourceBar`，自动加载首页。
- 卡片按钮：`播放`、`下载`/`已下载`、`打开`（collection）。
- 相关推荐区 `#taskSourceRelated`，只在控制端显示。

- [ ] **Step 1: HTML**

在 `#bilibiliSearchBar` 后加入：

```html
<div id="taskMediaSourceBar" class="quark-share-bar" hidden>
    <button class="control-btn" id="taskSourceHomeBtn">首页</button>
    <input id="taskSourceSearchInput" type="text" placeholder="搜索媒体源内容">
    <button class="control-btn" id="taskSourceSearchBtn">搜索</button>
    <input id="taskSourceLinkInput" type="text" placeholder="粘贴链接或 ID">
    <button class="control-btn" id="taskSourceLinkBtn">打开链接</button>
    <span id="taskSourceTitle" class="task-source-title"></span>
</div>
<div id="taskMediaSourceList" class="bilibili-video-list" hidden></div>
<div id="taskSourceRelated" class="bilibili-related" hidden>
    <div class="bilibili-related-title">相关推荐</div>
    <div id="taskSourceRelatedList" class="bilibili-video-list"></div>
</div>
```

- [ ] **Step 2: 切换任务源时加载首页**

修改 `switchTaskMediaSource(id)`：

```js
async switchTaskMediaSource(id) {
    const source = (this.taskMediaSources || []).find(item => item.id === id);
    if (!source) return;
    this.activeTab = 'task';
    this.activeTaskSourceId = id;
    this.currentLibrary = {
        id: source.libraryId, sourceLibraryId: source.libraryId, providerId: id,
        type: 'task', readonly: true, ownerNodeId: 'main-server'
    };
    document.getElementById('taskMediaSourceBar').hidden = false;
    document.getElementById('taskMediaSourceList').hidden = false;
    document.getElementById('taskSourceTitle').textContent = source.name;
    this.renderTabs();
    await this.loadTaskSourceHome();
}
```

新增：

```js
async taskSourceRequest(path, options = {}) {
    const id = this.activeTaskSourceId;
    if (!id) throw new Error('请先选择媒体源');
    const response = await fetch(`/api/task-media-sources/${encodeURIComponent(id)}${path}`, options);
    return this.parseResponse(response);
}

async loadTaskSourceHome() {
    try {
        const result = await this.taskSourceRequest('/home?page=1');
        this.renderTaskSourceItems(result.items, '首页');
    } catch (error) { showToast(`首页加载失败：${error.message}`, 'error'); }
}

async searchTaskSource() {
    const keyword = document.getElementById('taskSourceSearchInput')?.value.trim();
    if (!keyword) { showToast('请输入搜索关键词', 'warning'); return; }
    try {
        const result = await this.taskSourceRequest(`/search?keyword=${encodeURIComponent(keyword)}&page=1`);
        this.renderTaskSourceItems(result.items, `搜索：${keyword}`);
    } catch (error) { showToast(`搜索失败：${error.message}`, 'error'); }
}

async openTaskSourceLink() {
    const url = document.getElementById('taskSourceLinkInput')?.value.trim();
    if (!url) { showToast('请输入链接或 ID', 'warning'); return; }
    try {
        const result = await this.taskSourceRequest('/resolve-link', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url })
        });
        this.renderTaskSourceItems(result.items, '链接内容');
    } catch (error) { showToast(`链接解析失败：${error.message}`, 'error'); }
}

renderTaskSourceItems(items, titleText) {
    const root = document.getElementById('taskMediaSourceList');
    if (!root) return;
    root.replaceChildren();
    if (titleText) {
        const title = document.createElement('div');
        title.className = 'bilibili-section-title'; title.textContent = titleText;
        root.appendChild(title);
    }
    for (const item of Array.isArray(items) ? items : []) root.appendChild(this.buildTaskSourceCard(item));
}

buildTaskSourceCard(item) {
    const card = document.createElement('div');
    card.className = 'bilibili-video-card';
    if (item.cover) {
        const cover = document.createElement('img');
        cover.className = 'bilibili-video-cover'; cover.src = item.cover; cover.loading = 'lazy'; cover.alt = '';
        card.appendChild(cover);
    }
    const title = document.createElement('div');
    title.className = 'bilibili-video-title'; title.textContent = item.title || item.id; title.title = item.title || '';
    const actions = document.createElement('div');
    actions.className = 'bilibili-video-actions';
    if (item.mediaType === 'collection') {
        const open = document.createElement('button'); open.textContent = '打开';
        open.onclick = () => this.openTaskSourceItem(item);
        actions.appendChild(open);
    } else {
        const play = document.createElement('button'); play.textContent = '播放';
        play.onclick = () => this.playTaskSourceItem(item);
        actions.appendChild(play);
    }
    const download = document.createElement('button');
    download.textContent = item.downloaded ? '已下载' : '下载'; download.disabled = Boolean(item.downloaded);
    download.onclick = () => this.downloadTaskSourceItem(item);
    actions.append(download);
    card.append(title, actions);
    return card;
}
```

`openTaskSourceItem` / `playTaskSourceItem` / `downloadTaskSourceItem`：

```js
async openTaskSourceItem(item) {
    try {
        const result = await this.taskSourceRequest('/resolve-link', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: item.url || item.id })
        });
        this.renderTaskSourceItems(result.items, item.title || '内容');
    } catch (error) { showToast(`打开失败：${error.message}`, 'error'); }
},

playTaskSourceItem(item) {
    if (!item.playUrl) { showToast('该媒体没有可播放地址', 'error'); return; }
    this.playMedia(item.playUrl, item.mediaType || 'video', item.title || item.id);
    this.loadTaskSourceRelated(item);
},

async loadTaskSourceRelated(item) {
    const root = document.getElementById('taskSourceRelated');
    const list = document.getElementById('taskSourceRelatedList');
    if (!root || !list) return;
    try {
        const result = await this.taskSourceRequest(`/related?itemId=${encodeURIComponent(item.id)}&url=${encodeURIComponent(item.url || '')}`);
        list.replaceChildren(...(result.items || []).map(entry => this.buildTaskSourceCard(entry)));
        root.hidden = !result.items?.length;
    } catch { root.hidden = true; }
},

async downloadTaskSourceItem(item) {
    const targets = this.libraries.filter(lib => lib.type === 'local' && !lib.readonly && !lib.remote && lib.isLocal !== false);
    if (!targets.length) { showToast('请先添加主服务器上的可写本地媒体库', 'error'); return; }
    try {
        const result = await this.taskSourceRequest('/download', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item, targetId: targets[0].sourceLibraryId || targets[0].id })
        });
        if (result.downloaded) { item.downloaded = true; showToast('下载完成', 'success'); this.renderTaskSourceItems([item], '当前项目'); }
    } catch (error) { showToast(`下载失败：${error.message}`, 'error'); }
}
```

- [ ] **Step 3: 绑定按钮与页签清理**

在 `init()` 中绑定：

```js
document.getElementById('taskSourceHomeBtn')?.addEventListener('click', () => this.loadTaskSourceHome());
document.getElementById('taskSourceSearchBtn')?.addEventListener('click', () => this.searchTaskSource());
document.getElementById('taskSourceLinkBtn')?.addEventListener('click', () => this.openTaskSourceLink());
```

`switchTab` 与 `switchLibrary` 中若离开了任务源，隐藏 `#taskMediaSourceBar`、`#taskMediaSourceList`、`#taskSourceRelated`。

- [ ] **Step 4: CSS**

```css
.task-source-title { margin-left: auto; font-size: 13px; color: #aaa; }
#taskMediaSourceList { margin-top: 12px; }
```

- [ ] **Step 5: 手工验证（可用假 provider）**

任务源首页加载后卡片可见；搜索、链接解析、播放、下载按钮可用；离开任务源后工具栏隐藏。

---

### Task 3: 国内媒体任务骨架

**Files:**
- Create: `res/tasks/domestic-media/task.js`
- Create: `res/tasks/domestic-media/providers/proxy.js`
- Create: `res/tasks/domestic-media/providers/http.js`

**Interfaces:**
- 注册 `hongguo` 与 `tomato` 两个 provider，region 均为 `domestic`，features 均含 `home/search/resolveLink/related/stream/download`，`proxyDefault: false`。
- 任务参数：`{ hongguoCookie, tomatoBinary, tomatoPort, tomatoDataDir, tomatoSaveDir, tomatoPassword }`。

- [ ] **Step 1: 任务入口**

```js
'use strict';
const { createHongguoProvider } = require('./providers/hongguo');
const { createTomatoProvider } = require('./providers/tomato');

async function run(context) {
  const params = context.params || {};
  const unregisterHongguo = context.registerMediaProvider({
    id: 'hongguo',
    name: '红果短剧',
    region: 'domestic',
    features: ['home', 'search', 'resolveLink', 'related', 'stream', 'download'],
    proxyDefault: false,
    create: config => createHongguoProvider(config, { cookie: params.hongguoCookie || '' })
  });
  const tomato = createTomatoProvider({
    binary: params.tomatoBinary || '/mnt/novel/TomatoNovelDownloader-Linux_amd64-v2.4.13',
    port: Number(params.tomatoPort) || 18423,
    dataDir: params.tomatoDataDir || '',
    saveDir: params.tomatoSaveDir || '',
    password: params.tomatoPassword || '',
    workDir: context.workDir,
    log: context.log
  });
  const unregisterTomato = context.registerMediaProvider({
    id: 'tomato',
    name: '番茄小说',
    region: 'domestic',
    features: ['home', 'search', 'resolveLink', 'related', 'stream', 'download'],
    proxyDefault: false,
    create: config => tomato.create(config)
  });
  context.log('已注册国内媒体源：红果短剧、番茄小说');
  return {
    stop: async () => {
      unregisterHongguo();
      unregisterTomato();
      await tomato.stop();
    }
  };
}

module.exports = { mode: 'service', target: 'server', entryFile: 'task.js', run };
```

- [ ] **Step 2: 代理与 HTTP 工具**

`providers/proxy.js`：

```js
'use strict';
function options(proxyUrl) {
  if (!proxyUrl) return {};
  const protocol = new URL(proxyUrl).protocol;
  const Agent = protocol.startsWith('socks')
    ? require('socks-proxy-agent').SocksProxyAgent
    : require('https-proxy-agent').HttpsProxyAgent;
  const agent = new Agent(proxyUrl);
  return { proxy: false, httpAgent: agent, httpsAgent: agent };
}
module.exports = { options };
```

`providers/http.js`：

```js
'use strict';
const axios = require('axios');
const { options } = require('./proxy');
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' };

function client(config, defaults = {}) {
  return axios.create({ timeout: 15000, maxRedirects: 0, headers: HEADERS, ...defaults });
}
async function get(config, url, extra = {}) {
  const response = await client(config).get(url, { ...options(config.proxyUrl), ...extra });
  return response;
}
module.exports = { client, get, HEADERS };
```

- [ ] **Step 3: 简单注册验证**

启动任务后控制端 `/api/media-library-providers` 返回：

```json
{"providers":[{"id":"hongguo","name":"红果短剧","region":"domestic","features":["home","search","resolveLink","related","stream","download"],"proxyDefault":false},{"id":"tomato","name":"番茄小说","region":"domestic","features":["home","search","resolveLink","related","stream","download"],"proxyDefault":false}]}
```

停止任务后两个页签移除。

---

### Task 4: 红果 provider

**Files:**
- Create: `res/tasks/domestic-media/providers/hongguo.js`
- Test: `tests/hongguo-provider.test.js`

**Interfaces:**
- `createHongguoProvider(config, { cookie }) -> provider`
- `home({ page }) -> { items, page: 1, totalPages: 1 }`
- `search({ keyword, page }) -> { items, page, totalPages }`
- `resolveLink({ url }) -> { items }`
- `related({ itemId, url }) -> { items }`
- `getStream(itemId, range) -> { stream, statusCode, headers }`
- `list/getFile/getFileStream` 保持任务媒体库兼容。

- [ ] **Step 1: 写解析测试**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseSeriesId, parseSearchPayload, htmlItems } = require('../res/tasks/domestic-media/providers/hongguo');

test('parseSeriesId 支持 player/detail/纯数字', () => {
  assert.equal(parseSeriesId('https://hongguoduanju.com/player/7701935931787316286'), '7701935931787316286');
  assert.equal(parseSeriesId('https://hongguoduanju.com/detail?series_id=7701935931787316286'), '7701935931787316286');
  assert.equal(parseSeriesId('7701935931787316286'), '7701935931787316286');
  assert.equal(parseSeriesId('https://example.com/player/1'), '');
});

test('parseSearchPayload 读取 searchList 和系列 ID', () => {
  const items = parseSearchPayload({ searchList: [{ name: '剧名', video_data: { series_id: '7701935931787316286' }, cover: 'https://p3-sign.douyinpic.com/a.jpg' }] });
  assert.equal(items[0].title, '剧名');
  assert.equal(items[0].mediaType, 'collection');
  assert.match(items[0].url, /series_id=7701935931787316286/);
});

test('htmlItems 从首页提取剧集链接并去重', () => {
  const html = '<a href="/detail?series_id=7701935931787316286"><img alt="剧A" src="https://p3-sign.douyinpic.com/a.jpg"></a><a href="/detail?series_id=7701935931787316286">重复</a>';
  assert.equal(htmlItems(html).length, 1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/hongguo-provider.test.js`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现红果 provider**

```js
'use strict';
const { Readable } = require('node:stream');
const cheerio = require('cheerio');
const { get, HEADERS } = require('./http');

const ORIGIN = 'https://hongguoduanju.com';
const ID = '[1-9][0-9]{0,19}';
const SERIES_RE = new RegExp(`^${ID}$`);

function parseSeriesId(value) {
  const text = String(value || '').trim();
  if (SERIES_RE.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.origin !== ORIGIN || url.username || url.password) return '';
    const direct = url.pathname.match(new RegExp(`^/player/(${ID})(?:/${ID})?/?$`))?.[1];
    if (direct) return direct;
    const query = url.pathname === '/detail' ? url.searchParams.get('series_id') || '' : '';
    return SERIES_RE.test(query) ? query : '';
  } catch { return ''; }
}

function safeCover(value) {
  const text = String(value || '');
  try {
    const parsed = new URL(text.startsWith('//') ? `https:${text}` : text);
    return parsed.protocol === 'https:' ? parsed.href : '';
  } catch { return ''; }
}

function collectionItem(id, title, cover = '') {
  return { id: `series:${id}`, title: String(title || '红果剧集').slice(0, 180), cover, mediaType: 'collection', url: `${ORIGIN}/detail?series_id=${id}` };
}

function htmlItems(html) {
  const $ = cheerio.load(html);
  const found = new Map();
  $('a[href^="/detail?series_id="]').each((_i, el) => {
    const id = /^\/detail\?series_id=([1-9][0-9]{0,19})$/.exec($(el).attr('href') || '')?.[1];
    if (!id || found.has(id)) return;
    const img = $(el).find('img').first();
    found.set(id, collectionItem(id, img.attr('alt') || $(el).text().trim().slice(0, 100) || '红果剧集', safeCover(img.attr('src') || img.attr('data-src'))));
  });
  return [...found.values()];
}

function parseSearchPayload(payload) {
  const list = Array.isArray(payload?.searchList) ? payload.searchList : [];
  const found = new Map();
  for (const item of list) {
    const id = String(item?.video_data?.series_id || '');
    if (!SERIES_RE.test(id)) continue;
    found.set(id, collectionItem(id, item.name, safeCover(item.cover || item.video_data?.cover)));
  }
  return [...found.values()];
}

function episodeItems(id, html) {
  const $ = cheerio.load(html);
  const items = [];
  $('script[type="application/ld+json"]').each((_i, el) => {
    try {
      const data = JSON.parse($(el).html());
      for (const entry of data['@graph'] || [data]) {
        const match = new RegExp(`^${ORIGIN}/video/public/(${ID})/360p\\.mp4$`).exec(String(entry.contentUrl || ''));
        if (entry['@type'] !== 'VideoObject' || !match) continue;
        items.push({
          id: `episode:${id}:${match[1]}`,
          title: String(entry.name || '公开片段').slice(0, 180),
          mediaType: 'video', url: `${ORIGIN}/player/${id}`,
          libraryPath: `/${id}/${match[1]}.mp4`
        });
      }
    } catch { /* 忽略无关结构化数据。 */ }
  });
  return items;
}

function createHongguoProvider(config = {}, { cookie = '' } = {}) {
  const pages = new Map();
  async function page(pathname) {
    const cached = pages.get(pathname);
    if (cached && cached.until > Date.now()) return cached.html;
    const response = await get(config, ORIGIN + pathname, {
      responseType: 'text', headers: { ...HEADERS, ...(cookie ? { Cookie: cookie } : {}) }, maxContentLength: 3 * 1024 * 1024
    });
    pages.set(pathname, { html: response.data, until: Date.now() + 60000 });
    return response.data;
  }
  async function series(id) {
    return episodeItems(id, await page(`/player/${id}`));
  }
  function getStream(itemId, range) {
    const match = new RegExp(`^episode:(${ID}):(${ID})$`).exec(String(itemId || ''));
    if (!match) throw new Error('红果视频 ID 无效');
    return get(config, `${ORIGIN}/video/public/${match[2]}/360p.mp4`, {
      responseType: 'stream', headers: { ...HEADERS, ...(cookie ? { Cookie: cookie } : {}), ...(range ? { Range: `bytes=${range.start}-${range.end ?? ''}` } : {}) },
      timeout: 20000, validateStatus: status => [200, 206, 416].includes(status)
    }).then(response => {
      const headers = {};
      for (const [key, name] of [['content-type', 'Content-Type'], ['content-length', 'Content-Length'], ['content-range', 'Content-Range'], ['accept-ranges', 'Accept-Ranges']]) if (response.headers[key]) headers[name] = response.headers[key];
      return { stream: response.data, statusCode: response.status, headers };
    });
  }
  return {
    async home({ page: p = 1 } = {}) {
      if (Number(p) !== 1) return { items: [], page: 1, totalPages: 1 };
      return { items: htmlItems(await page('/')), page: 1, totalPages: 1 };
    },
    async search({ keyword, page: p = 1 } = {}) {
      const text = String(keyword || '').trim();
      if (!text || text.length > 100) throw new Error('红果搜索关键词无效');
      const response = await get(config, `${ORIGIN}/api/search/result/`, { params: { query: text }, headers: { ...HEADERS, ...(cookie ? { Cookie: cookie } : {}) } });
      return { items: parseSearchPayload(response.data), page: Number(p) || 1, totalPages: Number(response.data?.totalPages) || 1 };
    },
    async resolveLink({ url } = {}) {
      const id = parseSeriesId(url);
      if (!id) throw new Error('请输入红果剧集链接、/player/ 链接或纯数字 ID');
      return { items: await series(id) };
    },
    async related({ itemId } = {}) {
      const id = String(itemId || '').match(new RegExp(`^episode:(${ID}):`))?.[1] || '';
      const items = htmlItems(await page('/')).filter(item => item.id !== `series:${id}`);
      return { items: items.slice(0, 12) };
    },
    getStream,
    async list(dir = '/') {
      if (dir === '/') return htmlItems(await page('/')).map(item => ({ name: item.title, path: `/${item.id.split(':')[1]}`, type: 'folder' }));
      const id = new RegExp(`^/(${ID})$`).exec(dir)?.[1];
      if (!id) return [];
      return (await series(id)).map(item => ({ name: `${item.title}.mp4`, path: item.libraryPath, type: 'file', mediaType: 'video', size: 0 }));
    },
    async getFile(filePath) {
      const match = new RegExp(`^/(${ID})/(${ID})\\.mp4$`).exec(filePath);
      const item = match ? (await series(match[1])).find(entry => entry.libraryPath === filePath) : null;
      if (!item) throw new Error('红果视频路径无效');
      return { name: `${item.title}.mp4`, path: filePath, type: 'file', mediaType: 'video', size: 0 };
    },
    async getFileStream(filePath, range) {
      const match = new RegExp(`^/(${ID})/(${ID})\\.mp4$`).exec(filePath);
      if (!match) throw new Error('红果视频路径无效');
      return getStream(`episode:${match[1]}:${match[2]}`, range);
    }
  };
}
module.exports = { createHongguoProvider, parseSeriesId, parseSearchPayload, htmlItems, episodeItems };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/hongguo-provider.test.js`
Expected: 3 tests PASS

- [ ] **Step 5: 手工验证**

1. 首页显示红果剧集卡片，点击“打开”显示公开分集。
2. 搜索关键词返回剧集，打开后显示分集。
3. 粘贴 `/player/{19位ID}`、`/detail?series_id=`、纯数字 ID 均可解析。
4. 配置 `hongguoCookie` 后，观察请求携带 Cookie（可用本地日志/代理抓包）。
5. 下载分集到本地媒体库，完成后按钮显示“已下载”。

---

### Task 5: 番茄 provider

**Files:**
- Create: `res/tasks/domestic-media/providers/tomato.js`
- Test: `tests/tomato-provider.test.js`

**Interfaces:**
- `createTomatoProvider({ binary, port, dataDir, saveDir, password, workDir, log }) -> { create(config), stop() }`
- `create(config).home/search/resolveLink/related/getStream/download/list/getFile/getFileStream`
- 子进程环境：`TOMATO_WEB_ADDR=127.0.0.1:<port>`；参数：`--server --data-dir <dataDir> [--password <password>]`；CWD 为 `saveDir`。

- [ ] **Step 1: 写解析测试**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseSearch, parseLibrary, parseChapterLines, safeRelPath } = require('../res/tasks/domestic-media/providers/tomato');

test('parseSearch 映射 book_id/title/author', () => {
  const items = parseSearch({ items: [{ book_id: '7659683388898413630', title: '书名', author: '作者' }] });
  assert.deepEqual(items[0], { id: 'book:7659683388898413630', title: '书名', author: '作者', mediaType: 'collection', url: '7659683388898413630' });
});

test('parseLibrary 只保留文本/电子书文件', () => {
  const items = parseLibrary({ items: [
    { kind: 'file', name: '书.txt', rel_path: '书.txt', ext: 'txt', size: 10 },
    { kind: 'file', name: '封面.jpg', rel_path: '封面.jpg', ext: 'jpg', size: 10 },
    { kind: 'dir', name: 'bookid', rel_path: 'bookid' }
  ] });
  assert.equal(items.length, 1);
  assert.equal(items[0].mediaType, 'text');
});

test('parseChapterLines 解析 JSONL 前 N 章', () => {
  const items = parseChapterLines('{"id":"1","title":"第一章","content":"正文"}\n{"id":"2","title":"第二章","content":"正文2"}\n', 'book1', 1);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'chapter:book1:1');
  assert.equal(items[0].title, '第一章');
});

test('safeRelPath 拒绝目录穿越', () => {
  assert.equal(safeRelPath('书.txt'), '书.txt');
  assert.throws(() => safeRelPath('../secret.txt'), /路径/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/tomato-provider.test.js`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现番茄 provider**

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const axios = require('axios');

const TEXT_EXT = new Set(['txt', 'epub', 'pdf']);

function safeRelPath(value) {
  const text = String(value || '');
  const normalized = path.posix.normalize(text).replace(/^\/+/, '');
  if (!normalized || normalized === '.' || normalized.startsWith('..') || normalized.includes('\0')) throw new Error('文件路径无效');
  return normalized;
}

function parseSearch(payload) {
  return (Array.isArray(payload?.items) ? payload.items : [])
    .filter(item => /^[0-9]{6,}$/.test(String(item?.book_id || '')))
    .map(item => ({ id: `book:${item.book_id}`, title: String(item.title || item.book_id).slice(0, 180), author: String(item.author || '').slice(0, 80), mediaType: 'collection', url: String(item.book_id) }));
}

function parseLibrary(payload) {
  return (Array.isArray(payload?.items) ? payload.items : [])
    .filter(item => item?.kind === 'file' && TEXT_EXT.has(String(item.ext || '').toLowerCase()))
    .map(item => ({ id: `file:${item.rel_path}`, title: String(item.name || item.rel_path), mediaType: 'text', url: String(item.rel_path), size: Number(item.size) || 0 }));
}

function parseChapterLines(text, bookId, limit = 100) {
  const items = [];
  for (const line of String(text || '').split('\n')) {
    if (items.length >= limit) break;
    try {
      const chapter = JSON.parse(line);
      if (!chapter?.id || typeof chapter.content !== 'string') continue;
      items.push({ id: `chapter:${bookId}:${chapter.id}`, title: String(chapter.title || chapter.id).slice(0, 180), mediaType: 'text', bookId, chapterId: String(chapter.id) });
    } catch { /* 忽略损坏的章节行。 */ }
  }
  return items;
}

function createTomatoProvider(options) {
  let child = null;
  let starting = null;
  const baseUrl = () => `http://127.0.0.1:${options.port}`;
  const headers = () => options.password ? { 'x-tomato-password': options.password } : {};
  const api = axios.create({ baseURL: baseUrl(), timeout: 15000, headers: headers(), maxRedirects: 0 });
  const dataDir = options.dataDir || path.join(options.workDir, 'tomato-data');
  const saveDir = options.saveDir || path.join(options.workDir, 'tomato-output');

  async function start() {
    if (child && !child.killed) return;
    if (starting) return starting;
    starting = new Promise((resolve, reject) => {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.mkdirSync(saveDir, { recursive: true });
      const args = ['--server', '--data-dir', dataDir];
      if (options.password) args.push('--password', options.password);
      child = spawn(options.binary, args, {
        cwd: saveDir, detached: true,
        env: { ...process.env, TOMATO_WEB_ADDR: `127.0.0.1:${options.port}` },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('番茄下载器启动超时')); } }, 15000);
      const ready = data => {
        if (settled) return;
        if (!String(data).includes('Web UI listening')) return;
        settled = true; clearTimeout(timer); resolve();
      };
      child.stdout.on('data', ready);
      child.stderr.on('data', ready);
      child.once('error', error => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`番茄下载器启动失败：${error.message}`)); } });
      child.once('exit', code => { child = null; if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`番茄下载器退出 (${code})`)); } });
      options.log?.(`番茄下载器启动：127.0.0.1:${options.port}`);
    }).finally(() => { starting = null; });
    return starting;
  }

  async function request(method, url, data, extra = {}) {
    await start();
    return api.request({ method, url, data, ...extra });
  }

  async function stop() {
    if (!child) return;
    const target = child;
    child = null;
    try { process.kill(-target.pid, 'SIGINT'); } catch { try { target.kill('SIGINT'); } catch {} }
    await new Promise(resolve => {
      const timer = setTimeout(() => { try { process.kill(-target.pid, 'SIGKILL'); } catch {} resolve(); }, 5000);
      target.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    options.log?.('番茄下载器已停止');
  }

  async function waitJob(jobId) {
    for (let i = 0; i < 300; i++) {
      const response = await request('get', '/api/jobs', undefined);
      const job = (response.data?.items || []).find(item => String(item.id) === String(jobId));
      if (job?.state === 'done') return job;
      if (['failed', 'canceled'].includes(job?.state)) throw new Error(job?.message || '番茄下载任务失败');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('番茄下载任务超时');
  }

  function create(config = {}) {
    const bookFile = bookId => path.join(saveDir, bookId, 'downloaded_chapters.jsonl');
    const homeItems = async () => parseLibrary((await request('get', '/api/library', undefined)).data);
    return {
      async home() {
        return { items: await homeItems(), page: 1, totalPages: 1 };
      },
      async search({ keyword, page = 1 } = {}) {
        const text = String(keyword || '').trim();
        if (!text || text.length > 100) throw new Error('番茄搜索关键词无效');
        const response = await request('get', `/api/search?q=${encodeURIComponent(text)}`);
        return { items: parseSearch(response.data), page: Number(page) || 1, totalPages: 1 };
      },
      async resolveLink({ url } = {}) {
        const match = String(url || '').match(/([0-9]{6,})/);
        if (!match) throw new Error('请输入番茄小说 ID 或书籍链接');
        const bookId = match[1];
        try {
          const text = await fs.promises.readFile(bookFile(bookId), 'utf8');
          return { items: parseChapterLines(text, bookId, 100) };
        } catch {
          return { items: [{ id: `book:${bookId}`, title: `番茄小说 ${bookId}`, mediaType: 'collection', url: bookId, downloaded: false }] };
        }
      },
      async related({ itemId } = {}) {
        const bookId = String(itemId || '').match(/([0-9]{6,})/)?.[1];
        const response = await request('get', '/api/library', undefined);
        return { items: parseLibrary(response.data).filter(item => !bookId || !item.id.includes(bookId)).slice(0, 12) };
      },
      async getStream(itemId, range) {
        const chapter = String(itemId || '').match(/^chapter:([0-9]+):(.+)$/);
        if (chapter) {
          const text = await fs.promises.readFile(bookFile(chapter[1]), 'utf8');
          const entry = parseChapterLines(text, chapter[1], Number.MAX_SAFE_INTEGER).find(item => item.chapterId === chapter[2]);
          if (!entry) throw new Error('番茄章节不存在');
          const line = text.split('\n').find(value => { try { return String(JSON.parse(value).id) === chapter[2]; } catch { return false; } });
          const content = JSON.parse(line).content || '';
          const body = Buffer.from(content, 'utf8');
          const slice = range ? body.subarray(range.start, range.end === undefined ? undefined : range.end + 1) : body;
          return { stream: Readable.from([slice]), statusCode: range ? 206 : 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': String(slice.length), 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${range.start}-${range.start + slice.length - 1}/${body.length}` } : {}) } };
        }
        const file = String(itemId || '').match(/^file:(.+)$/)?.[1];
        if (!file) throw new Error('番茄文件 ID 无效');
        const rel = safeRelPath(file);
        const response = await request('get', `/download/${rel.split('/').map(encodeURIComponent).join('/')}`, undefined, { responseType: 'stream' });
        return { stream: response.data, statusCode: 200, headers: { 'Content-Type': response.headers['content-type'] || 'application/octet-stream' } };
      },
      async download(item, { save }) {
        const bookId = String(item?.url || item?.id || '').match(/([0-9]{6,})/)?.[1];
        if (!bookId) throw new Error('番茄小说 ID 无效');
        const created = await request('post', '/api/jobs', { book_id: bookId });
        await waitJob(created.data?.id);
        const library = parseLibrary((await request('get', '/api/library', undefined)).data);
        const file = library.find(entry => entry.url.includes(bookId)) || library.find(entry => entry.title.includes(String(item.title || '')));
        if (!file) throw new Error('番茄下载完成但未找到书籍文件');
        const rel = safeRelPath(file.url);
        const response = await request('get', `/download/${rel.split('/').map(encodeURIComponent).join('/')}`, undefined, { responseType: 'stream' });
        await save(file.title, response.data);
      },
      async list(dir = '/') {
        if (dir !== '/') throw new Error('番茄媒体源目录无效');
        return (await homeItems()).map(item => ({ name: item.title, path: `/${item.id}`, type: 'file', mediaType: item.mediaType, size: item.size || 0 }));
      },
      async getFile(filePath) {
        const item = (await this.list('/')).find(entry => entry.path === filePath);
        if (!item) throw new Error('番茄文件不存在');
        return item;
      },
      async getFileStream(filePath, range) {
        const id = String(filePath || '').replace(/^\//, '');
        return this.getStream(id, range);
      }
    };
  }

  return { create, stop, start };
}
module.exports = { createTomatoProvider, parseSearch, parseLibrary, parseChapterLines, safeRelPath };
```

`home()`、`list()` 与 `download()` 都通过 `homeItems()` 读取书库，避免依赖 `this` 调用上下文。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/tomato-provider.test.js`
Expected: 4 tests PASS

- [ ] **Step 5: 手工验证**

1. 启动任务后 `GET /api/task-media-sources/tomato/home` 返回书库文本/电子书。
2. 搜索“斗罗大陆”，返回 `book_id/title/author`。
3. 打开书籍 ID：未下载时返回书籍集合；下载完成后再打开返回前 100 章。
4. 播放章节文本，显示端显示正文并支持 TTS。
5. 下载书籍到本地媒体库，按钮显示“已下载”。
6. 停止任务后 `pgrep -f 'TomatoNovelDownloader.*--data-dir <workDir>'` 无残留进程。

---

### Task 6: 发布清单与迁移

**Files:**
- Modify: `release/task-code-files.json:4, 55-65`
- Modify: `docs/task/2026-11-09_地区媒体中心与弹幕.md`
- Modify: `docs/spec/media-library.md`
- Modify: `docs/spec/self-test.md`
- Modify: `docs/usage.md`
- Modify: `changelog.md`
- Modify: `docs/todo.md`

- [ ] **Step 1: 发布清单**

`retiredTaskNames` 增加 `hongguo`。`tasks` 移除 `hongguo` 条目，新增：

```json
{
  "taskName": "domestic-media",
  "files": ["task.js", "providers/proxy.js", "providers/http.js", "providers/hongguo.js", "providers/tomato.js"],
  "codeRequirement": { "minimumVersion": 169, "apiVersion": 1 },
  "dependencyRequirement": null
}
```

若现有 schema 的 `codeRequirement` 结构不同，按同文件 `hongguo` 条目的实际字段名填写，不新增字段。

- [ ] **Step 2: 文档**

- `docs/spec/media-library.md` 增加“国内媒体任务”伪代码：通用任务源路由、红果解析、番茄子进程与 API。
- `docs/spec/self-test.md` 增加：红果首页/搜索/链接/Cookie、番茄搜索/下载/书库/章节/TTS、任务停止子进程回收。
- `docs/usage.md` 说明任务参数：`hongguoCookie`、`tomatoBinary`、`tomatoPort`、`tomatoDataDir`、`tomatoSaveDir`、`tomatoPassword`。
- `changelog.md` 记录国内媒体任务。
- `docs/todo.md` 删除已完成条目。

- [ ] **Step 3: 全量测试**

Run: `node --test tests/task-media-download-index.test.js tests/hongguo-provider.test.js tests/tomato-provider.test.js`
Expected: 全部 PASS

---

## Self-Review

- Spec coverage：国内任务、红果首页/搜索/链接/Cookie、番茄下载器搜索/下载/书库/章节/TTS、任务停止回收均有任务。
- Placeholder scan：无 TBD/TODO。
- Type consistency：item 的 `id/title/mediaType/url`、provider 的 `home/search/resolveLink/related/getStream/download` 与 Plan 1 的 `callTaskSource` 一致；番茄 `parseChapterLines` 在 resolveLink 与 getStream 中复用。
