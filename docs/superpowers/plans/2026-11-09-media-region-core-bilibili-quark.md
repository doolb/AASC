# 地区媒体中心核心、B站增强与夸克下载统一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立统一媒体源协议、地区分组与代理配置，并完成 B 站搜索稳定性/首页/相关推荐/弹幕/已下载状态和夸克分享下载统一。

**Architecture:** 在现有 `TaskMediaProviderRegistry` 上扩展 region/features/proxyDefault 元数据，由 `MediaLibraryManager` 向任务 provider 注入实时代理地址和统一 home/search/resolveLink/related/stream/download 调用入口。B 站保持原生实现，新增无签名搜索主通道、发现服务、弹幕服务和显示端弹幕层。夸克复用 `QuarkDirectoryDownloads`，增加单文件下载和目录完成记录。

**Tech Stack:** Node.js、Express、axios、node:test、原生 WebSocket、浏览器 DOM/Canvas-free 弹幕层。

## Global Constraints

- 注释使用中文；使用 `const/let`，禁止 `var`；异步使用 `async/await`。
- 遵守 AASC 规则：不要写长串 `if/else if`，用映射表、提前返回或独立函数分发。
- 代码、功能、配置规则变更后必须同步更新 `docs/spec/media-library.md`、`docs/spec/self-test.md`、`docs/design/media-library.md`、`docs/todo.md`、`changelog.md`。
- 本计划执行期间不要创建 git commit，除非用户明确要求。
- 测试统一使用 `node --test tests/<file>.test.js`，不得依赖外网。
- 所有 UI 文本使用简体中文，按钮文案固定为“首页”“搜索”“打开链接”“下载”“已下载”“使用代理”。
- 外部请求必须设置超时与 `maxRedirects: 0`；代理仅作用于服务端外部请求。
- 显示端弹幕层必须 `pointer-events: none`，只有临时开关按钮可接收触控。

---

### Task 1: 代理工具模块

**Files:**
- Create: `src/apps/server/modules/media/web-proxy.js`
- Test: `tests/web-proxy.test.js`
- Modify: `package.json:107-125`

**Interfaces:**
- Produces: `normalizeProxyUrl(value) -> string`（空串表示未配置，非法抛错）
- Produces: `resolveSourceProxyUrl({ globalProxy, switches, sourceId, proxyDefault }) -> string`
- Produces: `axiosProxyOptions(proxyUrl) -> object`
- Produces: `getProxyAgents(proxyUrl) -> { httpAgent, httpsAgent } | null`

- [ ] **Step 1: 写失败测试**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeProxyUrl, resolveSourceProxyUrl, axiosProxyOptions } = require('../src/apps/server/modules/media/web-proxy');

test('normalizeProxyUrl 接受 HTTP/HTTPS/SOCKS5 并去掉末尾斜杠', () => {
    assert.equal(normalizeProxyUrl(''), '');
    assert.equal(normalizeProxyUrl('http://127.0.0.1:7890/'), 'http://127.0.0.1:7890');
    assert.equal(normalizeProxyUrl('socks5://127.0.0.1:1080'), 'socks5://127.0.0.1:1080');
});

test('normalizeProxyUrl 拒绝非法协议和查询参数', () => {
    assert.throws(() => normalizeProxyUrl('ftp://127.0.0.1:21'), /HTTP\/HTTPS\/SOCKS5/);
    assert.throws(() => normalizeProxyUrl('http://127.0.0.1:7890/?a=1'), /查询参数/);
});

test('resolveSourceProxyUrl 使用显式开关覆盖默认值', () => {
    const base = { globalProxy: 'http://127.0.0.1:7890', sourceId: 'youtube' };
    assert.equal(resolveSourceProxyUrl({ ...base, switches: {}, proxyDefault: true }), 'http://127.0.0.1:7890');
    assert.equal(resolveSourceProxyUrl({ ...base, switches: { youtube: false }, proxyDefault: true }), '');
    assert.equal(resolveSourceProxyUrl({ ...base, switches: { youtube: true }, proxyDefault: false }), 'http://127.0.0.1:7890');
    assert.equal(resolveSourceProxyUrl({ ...base, switches: {}, proxyDefault: false }), '');
});

test('axiosProxyOptions 为代理请求关闭 axios 默认代理并返回 agent', () => {
    const options = axiosProxyOptions('socks5://127.0.0.1:1080');
    assert.equal(options.proxy, false);
    assert.ok(options.httpAgent);
    assert.ok(options.httpsAgent);
    assert.deepEqual(axiosProxyOptions(''), {});
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/web-proxy.test.js`
Expected: FAIL，`Cannot find module .../web-proxy`

- [ ] **Step 3: 实现模块**

```js
'use strict';
const { URL } = require('node:url');

const PROTOCOLS = new Set(['http:', 'https:', 'socks:', 'socks5:', 'socks5h:']);
const agentCache = new Map();

function normalizeProxyUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    let parsed;
    try { parsed = new URL(raw); } catch { throw new Error('代理地址格式无效'); }
    if (!PROTOCOLS.has(parsed.protocol)) throw new Error('代理仅支持 HTTP/HTTPS/SOCKS5');
    if (!parsed.hostname) throw new Error('代理地址缺少主机名');
    if (parsed.search || parsed.hash) throw new Error('代理地址不能包含查询参数或片段');
    return parsed.toString().replace(/\/$/, '');
}

function resolveSourceProxyUrl({ globalProxy = '', switches = {}, sourceId, proxyDefault = false } = {}) {
    const normalized = normalizeProxyUrl(globalProxy);
    if (!normalized || !sourceId) return '';
    const selected = Object.prototype.hasOwnProperty.call(switches, sourceId)
        ? switches[sourceId] === true
        : proxyDefault === true;
    return selected ? normalized : '';
}

function getProxyAgents(proxyUrl) {
    const normalized = normalizeProxyUrl(proxyUrl);
    if (!normalized) return null;
    if (agentCache.has(normalized)) return agentCache.get(normalized);
    const protocol = new URL(normalized).protocol;
    let Agent;
    try {
        Agent = protocol.startsWith('socks')
            ? require('socks-proxy-agent').SocksProxyAgent
            : require('https-proxy-agent').HttpsProxyAgent;
    } catch {
        throw new Error('代理组件未安装，请安装 https-proxy-agent 与 socks-proxy-agent');
    }
    const agent = new Agent(normalized);
    const value = { httpAgent: agent, httpsAgent: agent };
    agentCache.set(normalized, value);
    return value;
}

function axiosProxyOptions(proxyUrl) {
    const agents = getProxyAgents(proxyUrl);
    return agents ? { proxy: false, ...agents } : {};
}

module.exports = { normalizeProxyUrl, resolveSourceProxyUrl, getProxyAgents, axiosProxyOptions };
```

- [ ] **Step 4: 增加依赖**

在 `package.json` 的 `dependencies` 中加入：

```json
"https-proxy-agent": "^7.0.6",
"socks-proxy-agent": "^8.0.5",
```

Run: `npm install --package-lock-only`
Expected: `package-lock.json` 更新，不新增源码改动。

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test tests/web-proxy.test.js`
Expected: 4 tests PASS

---

### Task 2: provider 注册元数据

**Files:**
- Modify: `src/apps/web-mediacenter/modules/media/task-media-provider-registry.js:6-15`
- Test: `tests/task-media-provider-registry.test.js`

**Interfaces:**
- Produces: `register(owner, { id, name, region, features, proxyDefault, defaultConfig, create })`
- Produces: `list() -> [{ id, name, region, features, proxyDefault }]`
- Region 只允许 `domestic|overseas`；features 只保留 `home|search|resolveLink|related|stream|download`。

- [ ] **Step 1: 写失败测试**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TaskMediaProviderRegistry } = require('../src/apps/web-mediacenter/modules/media/task-media-provider-registry');

test('register 透传地区、能力与代理默认值', () => {
    const registry = new TaskMediaProviderRegistry();
    registry.register('owner', {
        id: 'youtube', name: 'YouTube', region: 'overseas',
        features: ['home', 'search', 'stream', 'unknown'], proxyDefault: true,
        defaultConfig: { a: 1 }, create: () => ({})
    });
    assert.deepEqual(registry.list(), [{
        id: 'youtube', name: 'YouTube', region: 'overseas',
        features: ['home', 'search', 'stream'], proxyDefault: true
    }]);
});

test('register 默认国内且拒绝重复 ID', () => {
    const registry = new TaskMediaProviderRegistry();
    const unregister = registry.register('owner', { id: 'hongguo', name: '红果短剧', create: () => ({}) });
    assert.equal(registry.get('hongguo').region, 'domestic');
    assert.throws(() => registry.register('owner2', { id: 'hongguo', name: '重复', create: () => ({}) }), /已注册/);
    unregister();
    assert.equal(registry.get('hongguo'), undefined);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/task-media-provider-registry.test.js`
Expected: FAIL，metadata 缺失

- [ ] **Step 3: 修改 registry**

在文件顶部加：

```js
const REGIONS = new Set(['domestic', 'overseas']);
const FEATURES = new Set(['home', 'search', 'resolveLink', 'related', 'stream', 'download']);
```

`register` 内构造并存储：

```js
const region = REGIONS.has(definition.region) ? definition.region : 'domestic';
const features = [...new Set((Array.isArray(definition.features) ? definition.features : []).filter(name => FEATURES.has(name)))];
this.providers.set(id, {
    id, owner,
    name: String(definition.name || id).slice(0, 100),
    region, features,
    proxyDefault: definition.proxyDefault === true,
    defaultConfig: definition.defaultConfig || {},
    create: definition.create
});
```

`list()` 改为：

```js
list() {
    return [...this.providers.values()].map(({ id, name, region, features, proxyDefault }) =>
        ({ id, name, region, features, proxyDefault }));
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/task-media-provider-registry.test.js`
Expected: 2 tests PASS

---

### Task 3: 任务媒体源统一调用与代理注入

**Files:**
- Modify: `src/apps/web-mediacenter/modules/media/media-library-app-service.js:1148-1184, 1186-1201, 1262-1265, 1304-1325, 1578-1587`
- Test: `tests/media-library-app-service.test.js`（追加用例）

**Interfaces:**
- Produces: `MediaLibraryManager.callTaskSource(providerId, action, payload)`
- Produces: `MediaLibraryManager.getTaskSourceProvider(providerId)`
- Produces: `MediaLibraryManager.listTaskMediaSources()` 每项包含 `region/features/proxyDefault/proxyEnabled/libraryId`
- Produces: provider `create(config)` 收到的 `config.proxyUrl` 为实时 getter；未启用时为空串。

- [ ] **Step 1: 写失败测试**

追加到 `tests/media-library-app-service.test.js`：

```js
test('任务媒体源统一调用并注入实时代理地址', () => {
    const { TaskMediaProviderRegistry } = require('../src/apps/web-mediacenter/modules/media/task-media-provider-registry');
    const { MediaLibraryManager } = require('../src/apps/web-mediacenter/modules/media/media-library-app-service');
    const registry = new TaskMediaProviderRegistry();
    let received = null;
    registry.register('owner', {
        id: 'demo', name: '演示源', region: 'overseas', features: ['home', 'search'], proxyDefault: true,
        create: config => {
            received = config;
            return {
                list: async () => [],
                getFile: async () => ({}),
                getFileStream: async () => ({}),
                home: async () => ({ items: [{ id: '1', title: '视频', mediaType: 'video' }] })
            };
        }
    });
    let proxy = 'http://127.0.0.1:7890';
    const manager = new MediaLibraryManager({
        configPath: path.join(os.tmpdir(), `aasc-media-${process.pid}.json`),
        taskMediaProviders: registry,
        getProxyUrl: (id, fallback) => id === 'demo' && fallback ? proxy : ''
    });
    const provider = manager.getTaskSourceProvider('demo');
    assert.equal(provider.getImplementation().list instanceof Function, true);
    assert.equal(received.proxyUrl, 'http://127.0.0.1:7890');
    proxy = '';
    assert.equal(received.proxyUrl, '');
    return manager.callTaskSource('demo', 'home', {}).then(result => {
        assert.equal(result.items[0].title, '视频');
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/media-library-app-service.test.js`
Expected: FAIL，`getTaskSourceProvider is not a function`

- [ ] **Step 3: 修改 TaskMediaProvider**

构造函数增加：

```js
this.getProxyUrl = options.getProxyUrl || (() => '');
```

`getImplementation()` 改为：

```js
getImplementation() {
    const registration = this.registry.get(this.config.providerId);
    if (!registration) throw new Error('任务媒体源未运行，请先启动对应的用户服务任务');
    if (registration !== this.registration) {
        const config = { ...this.config };
        Object.defineProperty(config, 'proxyUrl', {
            enumerable: true,
            get: () => this.getProxyUrl(registration.id, registration.proxyDefault) || ''
        });
        const implementation = registration.create(config);
        if (!implementation || ['list', 'getFile', 'getFileStream'].some(name => typeof implementation[name] !== 'function')) {
            throw new Error('任务媒体源缺少必要接口');
        }
        this.registration = registration;
        this.implementation = implementation;
    }
    return this.implementation;
}
```

- [ ] **Step 4: 修改 MediaLibraryManager**

构造函数增加：

```js
this.getProxyUrl = options.getProxyUrl || (() => '');
```

两处创建 `TaskMediaProvider` 时传入 `getProxyUrl: this.getProxyUrl`（L1264、L1314）。

新增方法：

```js
getTaskSourceProvider(providerId) {
    const entry = this.getLibrary(`task-auto:${providerId}`);
    if (!entry) throw new Error('任务媒体源未运行，请先启动对应的用户服务任务');
    return entry.provider;
}

async callTaskSource(providerId, action, payload = {}) {
    const registration = this.taskMediaProviders.get(providerId);
    if (!registration) throw new Error('任务媒体源未运行，请先启动对应的用户服务任务');
    if (!registration.features.includes(action)) throw new Error('任务媒体源不支持该操作');
    const implementation = this.getTaskSourceProvider(providerId).getImplementation();
    if (typeof implementation[action] !== 'function') throw new Error('任务媒体源缺少该操作接口');
    return implementation[action](payload);
}
```

`listTaskMediaSources()` 增加有效代理状态：

```js
return this.taskMediaProviders.list().map(source => {
    const existing = [...this.libraries.values()].find(item => item.config.type === 'task' && item.config.providerId === source.id);
    return {
        ...source,
        libraryId: existing?.config.id || `task-auto:${source.id}`,
        proxyEnabled: Boolean(this.getProxyUrl(source.id, source.proxyDefault))
    };
});
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test tests/media-library-app-service.test.js`
Expected: 原有测试 + 新用例全部 PASS

---

### Task 4: 全局代理配置与 WebSocket 设置

**Files:**
- Modify: `src/apps/server/modules/config/config-app-service.js:342-471`
- Modify: `src/apps/server/boot/server-app.js:18, 1530-1555, 1664-1717, 6029`
- Modify: `src/apps/web-mediacenter/ui/public/upload.html:862-886`
- Modify: `src/apps/web-mediacenter/ui/public/js/websocket.js:3-22`
- Modify: `src/apps/web-mediacenter/ui/public/js/media-library.js:673-710`

**Interfaces:**
- Config keys: `network.globalWebProxy`（字符串）、`media.providerProxy`（对象，`{ [sourceId]: boolean }`）
- WS 上行：`getWebProxyConfig`、`setGlobalWebProxy { value }`、`setProviderProxy { sourceId, enabled }`
- WS 下行：`webProxyConfig { globalWebProxy, providerProxy, sources }`、`webProxyConfigError { message }`

- [ ] **Step 1: 增加配置默认值**

`Config.defaults` 增加：

```js
network: { globalWebProxy: '' },
```

- [ ] **Step 2: server-app 引入解析函数并构造管理器代理回调**

在媒体模块 require 区加入：

```js
const { normalizeProxyUrl, resolveSourceProxyUrl } = require('../modules/media/web-proxy');
function getSourceProxyUrl(sourceId, proxyDefault = false) {
    return resolveSourceProxyUrl({
        globalProxy: config.get('network.globalWebProxy', ''),
        switches: config.get('media.providerProxy', {}) || {},
        sourceId,
        proxyDefault
    });
}
function getWebProxyConfig() {
    return {
        type: 'webProxyConfig',
        globalWebProxy: config.get('network.globalWebProxy', ''),
        providerProxy: config.get('media.providerProxy', {}) || {},
        sources: mediaLibraryManager.listTaskMediaSources()
    };
}
```

`new MediaLibraryManager({...})` 增加：

```js
getProxyUrl: (sourceId, proxyDefault) => getSourceProxyUrl(sourceId, proxyDefault),
```

- [ ] **Step 3: 增加 WS 白名单与处理分支**

控制端类型白名单加入 `getWebProxyConfig`、`setGlobalWebProxy`、`setProviderProxy`。在处理函数中增加：

```js
if (data.type === 'getWebProxyConfig') {
    ws.send(JSON.stringify(getWebProxyConfig()));
    return;
}
if (data.type === 'setGlobalWebProxy') {
    try {
        const value = normalizeProxyUrl(data.value);
        if (!config.set('network.globalWebProxy', value)) throw new Error('代理配置保存失败');
        broadcastToControls(getWebProxyConfig());
    } catch (error) {
        ws.send(JSON.stringify({ type: 'webProxyConfigError', message: error.message }));
    }
    return;
}
if (data.type === 'setProviderProxy') {
    try {
        const sourceId = String(data.sourceId || '');
        if (!/^(bilibili|[a-z][a-z0-9._-]{1,63})$/.test(sourceId)) throw new Error('媒体源 ID 无效');
        const switches = { ...(config.get('media.providerProxy', {}) || {}), [sourceId]: data.enabled === true };
        if (!config.set('media.providerProxy', switches)) throw new Error('媒体源代理设置保存失败');
        broadcastToControls(getWebProxyConfig());
    } catch (error) {
        ws.send(JSON.stringify({ type: 'webProxyConfigError', message: error.message }));
    }
    return;
}
```

控制端连接建立并发送初始配置时，追加：

```js
ws.send(JSON.stringify(getWebProxyConfig()));
```

- [ ] **Step 4: upload.html 增加代理设置**

在 `#panel-settings` 服务器端口区块之后、`</section>` 之前插入：

```html
<div class="section">
    <h3>网络代理</h3>
    <div class="control-item">
        <label for="globalWebProxyInput">全局网页代理</label>
        <input id="globalWebProxyInput" type="text" placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:1080">
        <div class="control-buttons">
            <button class="control-btn" id="globalWebProxySaveBtn">保存代理</button>
        </div>
        <div class="routing-hint">仅对开启“使用代理”的媒体源生效；留空表示不使用代理。</div>
    </div>
</div>
```

在 `Settings` 对象中增加：

```js
saveGlobalWebProxy() {
    const value = document.getElementById('globalWebProxyInput')?.value.trim() || '';
    window.WebSocketManager?.send({ type: 'setGlobalWebProxy', value });
},
applyWebProxyConfig(data) {
    const input = document.getElementById('globalWebProxyInput');
    if (input && document.activeElement !== input) input.value = data.globalWebProxy || '';
    document.querySelectorAll('[data-provider-proxy]').forEach(input => {
        input.checked = Boolean(data.providerProxy?.[input.dataset.providerProxy]);
    });
}
```

初始化时绑定按钮并发送 `getWebProxyConfig`：

```js
document.getElementById('globalWebProxySaveBtn')?.addEventListener('click', () => this.saveGlobalWebProxy());
```

- [ ] **Step 5: websocket.js 分发配置消息**

`CONTROL_REMOTE_CONFIG_HANDLERS` 增加：

```js
webProxyConfig: data => window.Settings?.applyWebProxyConfig?.(data),
webProxyConfigError: data => window.showToast?.(data.message, 'error'),
```

- [ ] **Step 6: media-library.js 渲染每个媒体源的“使用代理”开关**

新增：

```js
handleWebProxyConfig(data) {
    this.webProxyConfig = data || {};
    const enabled = Boolean(data?.providerProxy?.bilibili);
    const toggle = document.getElementById('bilibiliProxyToggle');
    if (toggle && document.activeElement !== toggle) toggle.checked = enabled;
    this.renderTaskMediaTabs();
},
toggleProviderProxy(sourceId, enabled) {
    window.WebSocketManager?.send({ type: 'setProviderProxy', sourceId, enabled });
}
```

初始化时发送 `{ type: 'getWebProxyConfig' }`，并把消息接入 `handleWebProxyConfig`。`renderTaskMediaTabs` 为每个任务源生成：

```html
<label class="media-source-proxy"><input type="checkbox" data-provider-proxy="youtube"> 使用代理</label>
```

- [ ] **Step 7: 手工验证**

1. 打开控制端设置，输入 `http://127.0.0.1:7890`，保存；刷新页面后值仍在。
2. 输入 `ftp://x`，应显示“代理仅支持 HTTP/HTTPS/SOCKS5”。
3. 打开 B 站页签的“使用代理”，再次刷新后复选框保持勾选。

---

### Task 5: B 站搜索稳定性重写

**Files:**
- Modify: `src/apps/server/modules/media/bilibili-search-service.js`（整体替换）
- Modify: `src/apps/server/boot/server-app.js:5931-5955`
- Test: `tests/bilibili-search-service.test.js`

**Interfaces:**
- Produces: `createBilibiliSearchService({ client, now, getProxyUrl }) -> async (keyword, page) => { videos, page, totalPages }`
- `videos[]` 字段：`{ bvid, page: 1, url, title, cover, author, downloaded? }`（downloaded 由路由附加）

- [ ] **Step 1: 写失败测试**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBilibiliSearchService } = require('../src/apps/server/modules/media/bilibili-search-service');

function response(data, status = 200) { return { status, data }; }
function video(bvid = 'BV1xx411c7mD') {
    return { bvid, title: '<em>测试</em>视频', pic: '//i0.hdslb.com/a.jpg', author: '作者' };
}

test('无签名通道成功时不请求 WBI', async () => {
    const calls = [];
    const client = { get: async (url, options) => { calls.push(url); return response({ code: 0, data: { result: [video()], numPages: 3 } }); } };
    const search = createBilibiliSearchService({ client });
    const result = await search('测试', 1);
    assert.equal(result.videos[0].bvid, 'BV1xx411c7mD');
    assert.equal(result.videos[0].title, '测试视频');
    assert.equal(result.videos[0].cover, 'https://i0.hdslb.com/a.jpg');
    assert.equal(result.totalPages, 3);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /search\/type/);
});

test('无签名通道 412 时回退 WBI 签名搜索', async () => {
    const client = { get: async url => {
        if (url.includes('search/type')) return response('<html>412</html>', 412);
        if (url.includes('/x/web-interface/nav')) return response({ code: 0, data: { wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png' } } });
        if (url.includes('/x/frontend/finger/spi')) return response({ code: 0, data: { b_3: 'b3', b_4: 'b4' } });
        return response({ code: 0, data: { result: [video()], numPages: 1 } });
    } };
    const result = await createBilibiliSearchService({ client })('测试', 1);
    assert.equal(result.videos.length, 1);
});

test('搜索成功结果缓存 60 秒', async () => {
    let count = 0;
    const client = { get: async () => { count++; return response({ code: 0, data: { result: [video()], numPages: 1 } }); } };
    const search = createBilibiliSearchService({ client, now: () => 1000 });
    await search('缓存', 1);
    await search('缓存', 1);
    assert.equal(count, 1);
});

test('两条通道都失败时返回中文提示并退避', async () => {
    let count = 0;
    const client = { get: async url => {
        count++;
        if (url.includes('search/type')) return response('', 412);
        if (url.includes('/x/web-interface/nav')) return response({ code: 0, data: { wbi_img: { img_url: 'https://i0.hdslb.com/a.png', sub_url: 'https://i0.hdslb.com/b.png' } } });
        if (url.includes('/x/frontend/finger/spi')) return response({ code: 0, data: {} });
        return response('', 412);
    } };
    const search = createBilibiliSearchService({ client, now: () => 1000 });
    await assert.rejects(search('失败', 1), /B站搜索暂不可用/);
    const before = count;
    await assert.rejects(search('失败', 1), /请稍后重试/);
    assert.equal(count, before);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/bilibili-search-service.test.js`
Expected: FAIL，当前实现始终走 WBI，测试计数/回退不符

- [ ] **Step 3: 重写搜索服务**

```js
'use strict';
const crypto = require('node:crypto');
const axios = require('axios');
const { axiosProxyOptions } = require('./web-proxy');

const MIXIN = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];
const SEARCH_API = 'https://api.bilibili.com/x/web-interface/search/type';
const CACHE_TTL = 60000;
const BACKOFF_TTL = 30000;
const HEADERS = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://search.bilibili.com/' };
const RATE_CODES = new Set([-352, -403, -412, -509]);

function cleanTitle(value) {
    return String(value || '').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function safeCover(value) {
    const text = String(value || '');
    const normalized = text.startsWith('//') ? `https:${text}` : text;
    try {
        const parsed = new URL(normalized);
        return parsed.protocol === 'https:' && /(^|\.)hdslb\.com$/.test(parsed.hostname) ? parsed.href : '';
    } catch { return ''; }
}

function normalize(payload) {
    if (payload?.code !== 0 || !Array.isArray(payload?.data?.result)) throw new Error('B站搜索暂不可用，请稍后重试');
    const videos = payload.data.result
        .filter(item => /^BV[0-9A-Za-z]{10}$/.test(item?.bvid || ''))
        .map(item => ({ bvid: item.bvid, page: 1, url: `https://www.bilibili.com/video/${item.bvid}`, title: cleanTitle(item.title) || item.bvid, cover: safeCover(item.pic), author: cleanTitle(item.author) }));
    const totalPages = Math.max(1, Math.min(50, Number(payload.data.numPages || 1)));
    return { videos, totalPages };
}

function createBilibiliSearchService({ client = axios, now = Date.now, getProxyUrl = () => '' } = {}) {
    const cache = new Map();
    const backoff = new Map();
    let session = null;
    let pending = null;

    function requestOptions(extra = {}) {
        return { headers: HEADERS, timeout: 10000, maxRedirects: 0, validateStatus: status => status >= 200 && status < 500, ...axiosProxyOptions(getProxyUrl()), ...extra };
    }

    async function unsigned(keyword, page) {
        const response = await client.get(SEARCH_API, requestOptions({ params: { search_type: 'video', keyword, page } }));
        if (response.status === 412 || RATE_CODES.has(response.data?.code)) throw new Error('RATE_LIMIT');
        if (response.status !== 200) throw new Error('SEARCH_HTTP');
        return normalize(response.data);
    }

    async function getSession() {
        if (session && session.until > now()) return session;
        if (!pending) pending = (async () => {
            const [nav, spi] = await Promise.all([
                client.get('https://api.bilibili.com/x/web-interface/nav', requestOptions()),
                client.get('https://api.bilibili.com/x/frontend/finger/spi', requestOptions())
            ]);
            const keys = [nav.data?.data?.wbi_img?.img_url, nav.data?.data?.wbi_img?.sub_url]
                .map(value => String(value || '').split('/').pop().split('.')[0]).join('');
            const cookie = [['buvid3', spi.data?.data?.b_3], ['buvid4', spi.data?.data?.b_4]]
                .filter(([, value]) => value).map(([key, value]) => `${key}=${value}`).join('; ');
            session = {
                key: MIXIN.map(index => keys[index]).join('').slice(0, 32),
                cookie, until: now() + 3600000
            };
            return session;
        })().finally(() => { pending = null; });
        return pending;
    }

    async function signed(keyword, page) {
        const current = await getSession();
        const params = { search_type: 'video', keyword, page, wts: Math.floor(now() / 1000) };
        const query = Object.keys(params).sort().map(key => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]).replace(/[!'()*]/g, ''))}`).join('&');
        params.w_rid = crypto.createHash('md5').update(query + current.key).digest('hex');
        const response = await client.get(SEARCH_API, requestOptions({ params, headers: { ...HEADERS, Cookie: current.cookie } }));
        if (response.status === 412 || RATE_CODES.has(response.data?.code)) throw new Error('RATE_LIMIT');
        if (response.status !== 200) throw new Error('SEARCH_HTTP');
        return normalize(response.data);
    }

    return async function search(keyword, page = 1) {
        const text = String(keyword || '').trim();
        const pageNumber = Number(page);
        if (!text || text.length > 100 || !Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > 50) throw new Error('B站搜索参数无效');
        const key = `${text}:${pageNumber}`;
        const cached = cache.get(key);
        if (cached && cached.until > now()) return cached.value;
        const blockedUntil = backoff.get(text) || 0;
        if (blockedUntil > now()) throw new Error('B站搜索暂不可用，请稍后重试');
        try {
            const value = await unsigned(text, pageNumber).catch(() => signed(text, pageNumber));
            cache.set(key, { value, until: now() + CACHE_TTL });
            backoff.delete(text);
            return value;
        } catch {
            backoff.set(text, now() + BACKOFF_TTL);
            throw new Error('B站搜索暂不可用，请稍后重试');
        }
    };
}

module.exports = { createBilibiliSearchService, normalize, safeCover };
```

- [ ] **Step 4: server-app 接入代理并附加已下载状态**

搜索服务构造改为：

```js
const searchBilibili = createBilibiliSearchService({ getProxyUrl: () => getSourceProxyUrl('bilibili', false) });
```

搜索路由改为：

```js
app.get('/api/bilibili/search', async (req, res) => {
    try {
        const result = await searchBilibili(req.query.keyword, req.query.page || 1);
        const videos = await Promise.all(result.videos.map(async video => ({
            ...video,
            downloaded: Boolean(await bilibiliDownloads.lookup(video))
        })));
        res.json({ status: 'success', ...result, videos });
    } catch (error) {
        res.status(502).json({ status: 'error', message: error.message });
    }
});
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test tests/bilibili-search-service.test.js`
Expected: 4 tests PASS

---

### Task 6: B 站首页、相关推荐与已下载查询

**Files:**
- Create: `src/apps/server/modules/media/bilibili-discovery-service.js`
- Modify: `src/apps/server/boot/server-app.js:5931-6009`
- Test: `tests/bilibili-discovery-service.test.js`

**Interfaces:**
- Produces: `createBilibiliDiscoveryService({ client, getProxyUrl }) -> { home(page), related(bvid) }`
- 返回 `{ videos: [{ bvid, page: 1, url, title, cover, author }] }`
- 新路由：`GET /api/bilibili/home?page=`、`GET /api/bilibili/related?bvid=`、`GET /api/bilibili/downloaded?bvid=&page=`

- [ ] **Step 1: 写失败测试**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBilibiliDiscoveryService, normalizeRecommendList } = require('../src/apps/server/modules/media/bilibili-discovery-service');

test('normalizeRecommendList 过滤非 BV 条目并规范封面', () => {
    const videos = normalizeRecommendList([
        { bvid: 'BV1xx411c7mD', title: '正常', pic: '//i0.hdslb.com/a.jpg', owner: { name: 'UP' } },
        { bvid: 'av123', title: '无效' }
    ]);
    assert.equal(videos.length, 1);
    assert.equal(videos[0].cover, 'https://i0.hdslb.com/a.jpg');
    assert.equal(videos[0].author, 'UP');
});

test('home 与 related 请求正确接口', async () => {
    const calls = [];
    const client = { get: async (url, options) => {
        calls.push({ url, options });
        return { status: 200, data: { code: 0, data: { list: [{ bvid: 'BV1xx411c7mD', title: '视频', pic: 'https://i0.hdslb.com/a.jpg', owner: { name: 'UP' } }] } } };
    } };
    const service = createBilibiliDiscoveryService({ client });
    assert.equal((await service.home(1)).videos.length, 1);
    assert.equal((await service.related('BV1xx411c7mD')).videos.length, 1);
    assert.match(calls[0].url, /popular/);
    assert.match(calls[1].url, /archive\/related/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/bilibili-discovery-service.test.js`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现发现服务**

```js
'use strict';
const axios = require('axios');
const { axiosProxyOptions } = require('./web-proxy');

const HEADERS = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.bilibili.com/' };

function clean(value, max = 200) {
    return String(value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cover(value) {
    const text = String(value || '');
    const normalized = text.startsWith('//') ? `https:${text}` : text;
    try {
        const parsed = new URL(normalized);
        return parsed.protocol === 'https:' && /(^|\.)hdslb\.com$/.test(parsed.hostname) ? parsed.href : '';
    } catch { return ''; }
}

function normalizeRecommendList(list) {
    return (Array.isArray(list) ? list : [])
        .filter(item => /^BV[0-9A-Za-z]{10}$/.test(item?.bvid || ''))
        .map(item => ({ bvid: item.bvid, page: 1, url: `https://www.bilibili.com/video/${item.bvid}`, title: clean(item.title) || item.bvid, cover: cover(item.pic), author: clean(item.owner?.name || item.author, 80) }));
}

function createBilibiliDiscoveryService({ client = axios, getProxyUrl = () => '' } = {}) {
    const options = (params) => ({ params, headers: HEADERS, timeout: 10000, maxRedirects: 0, ...axiosProxyOptions(getProxyUrl()) });
    return {
        async home(page = 1) {
            const pn = Math.max(1, Math.min(50, Number(page) || 1));
            const response = await client.get('https://api.bilibili.com/x/web-interface/popular', options({ ps: 20, pn }));
            if (response.data?.code !== 0) throw new Error('B站首页暂不可用，请稍后重试');
            return { videos: normalizeRecommendList(response.data.data?.list) };
        },
        async related(bvid) {
            if (!/^BV[0-9A-Za-z]{10}$/.test(String(bvid || ''))) throw new Error('B站视频 ID 无效');
            const response = await client.get('https://api.bilibili.com/x/web-interface/archive/related', options({ bvid }));
            if (response.data?.code !== 0) throw new Error('B站相关推荐暂不可用，请稍后重试');
            return { videos: normalizeRecommendList(response.data.data) };
        }
    };
}

module.exports = { createBilibiliDiscoveryService, normalizeRecommendList };
```

- [ ] **Step 4: server-app 增加路由**

```js
const discoveryBilibili = createBilibiliDiscoveryService({ getProxyUrl: () => getSourceProxyUrl('bilibili', false) });

app.get('/api/bilibili/home', async (req, res) => {
    try { res.json({ status: 'success', ...await discoveryBilibili.home(req.query.page || 1) }); }
    catch (error) { res.status(502).json({ status: 'error', message: error.message }); }
});

app.get('/api/bilibili/related', async (req, res) => {
    try { res.json({ status: 'success', ...await discoveryBilibili.related(req.query.bvid) }); }
    catch (error) { res.status(502).json({ status: 'error', message: error.message }); }
});

app.get('/api/bilibili/downloaded', async (req, res) => {
    try {
        const video = parseVideoUrl(`https://www.bilibili.com/video/${req.query.bvid}?p=${req.query.page || 1}`);
        res.json({ status: 'success', downloaded: Boolean(await bilibiliDownloads.lookup(video)) });
    } catch (error) { res.status(400).json({ status: 'error', message: error.message }); }
});
```

`parseVideoUrl` 从 `./modules/media/bilibili-list-service` 引入（若尚未引入）。

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test tests/bilibili-discovery-service.test.js`
Expected: 2 tests PASS

---

### Task 7: B 站弹幕服务与路由

**Files:**
- Create: `src/apps/server/modules/media/bilibili-danmaku-service.js`
- Modify: `src/apps/server/boot/server-app.js:5931-6009`
- Modify: `src/apps/server/modules/media/bilibili-list-service.js:99-104`
- Test: `tests/bilibili-danmaku-service.test.js`

**Interfaces:**
- Produces: `createBilibiliDanmakuService({ client, getProxyUrl, now }) -> { get(bvid, page) }`
- `get()` 返回 `{ cid, items: [{ time, mode, fontSize, color, text }] }`
- 新路由：`GET /api/bilibili/danmaku/:bvid/:page`
- 播放列表项新增 `bilibiliDanmakuUrl`。

- [ ] **Step 1: 写失败测试**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { createBilibiliDanmakuService, parseDanmakuXml } = require('../src/apps/server/modules/media/bilibili-danmaku-service');

test('parseDanmakuXml 解析滚动、顶部、底部弹幕并转义文本', () => {
    const xml = '<?xml version="1.0"?><i><d p="1.2,1,25,16777215,0,0,0,0">你好&amp;世界</d><d p="2,5,18,255,0,0,0,0">顶部</d><d p="3,4,18,255,0,0,0,0">底部</d></i>';
    const items = parseDanmakuXml(xml);
    assert.deepEqual(items.map(item => item.mode), [1, 5, 4]);
    assert.equal(items[0].text, '你好&世界');
    assert.equal(items[0].time, 1.2);
});

test('get 先解析 cid，再解压弹幕 XML 并缓存', async () => {
    let xmlCalls = 0;
    const xml = Buffer.from('<i><d p="1,1,25,16777215,0,0,0,0">弹幕</d></i>');
    const compressed = zlib.deflateRawSync(xml);
    const client = { get: async url => {
        if (url.includes('/x/web-interface/view')) return { status: 200, data: { code: 0, data: { pages: [{ page: 1, cid: 123 }] } } };
        xmlCalls++;
        return { status: 200, data: compressed, headers: { 'content-type': 'text/xml' } };
    } };
    const service = createBilibiliDanmakuService({ client });
    assert.equal((await service.get('BV1xx411c7mD', 1)).items[0].text, '弹幕');
    await service.get('BV1xx411c7mD', 1);
    assert.equal(xmlCalls, 1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/bilibili-danmaku-service.test.js`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现弹幕服务**

```js
'use strict';
const zlib = require('node:zlib');
const axios = require('axios');
const { axiosProxyOptions } = require('./web-proxy');

const HEADERS = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.bilibili.com/' };
const MAX_COMPRESSED = 1024 * 1024;
const MAX_XML = 4 * 1024 * 1024;
const MAX_ITEMS = 10000;

function decodeEntities(text) {
    return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function parseDanmakuXml(xml) {
    const items = [];
    const pattern = /<d\s+p="([^"]*)"[^>]*>([\s\S]*?)<\/d>/g;
    let match;
    while ((match = pattern.exec(xml)) && items.length < MAX_ITEMS) {
        const fields = match[1].split(',');
        const time = Number(fields[0]);
        const mode = Number(fields[1]);
        const fontSize = Number(fields[2]) || 25;
        const color = Number(fields[3]) || 0xFFFFFF;
        if (!Number.isFinite(time) || !Number.isInteger(mode)) continue;
        if (![1, 4, 5].includes(mode)) continue;
        const text = decodeEntities(match[2]).trim();
        if (!text) continue;
        items.push({ time, mode, fontSize, color, text: text.slice(0, 200) });
    }
    return items;
}

function decompress(buffer) {
    if (buffer.length > MAX_COMPRESSED) throw new Error('B站弹幕数据过大');
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) return zlib.gunzipSync(buffer);
    try { return zlib.inflateRawSync(buffer); } catch { return zlib.inflateSync(buffer); }
}

function createBilibiliDanmakuService({ client = axios, getProxyUrl = () => '', now = Date.now } = {}) {
    const cidCache = new Map();
    const xmlCache = new Map();

    async function resolveCid(bvid, page) {
        if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) throw new Error('B站视频 ID 无效');
        const key = `${bvid}:${page}`;
        const cached = cidCache.get(key);
        if (cached && cached.until > now()) return cached.cid;
        const response = await client.get('https://api.bilibili.com/x/web-interface/view', {
            params: { bvid }, headers: HEADERS, timeout: 10000, maxRedirects: 0, ...axiosProxyOptions(getProxyUrl())
        });
        if (response.data?.code !== 0) throw new Error('B站视频信息暂不可用');
        const target = (response.data.data?.pages || []).find(item => item.page === page);
        if (!target?.cid) throw new Error('B站视频分集不存在');
        cidCache.set(key, { cid: target.cid, until: now() + 3600000 });
        return target.cid;
    }

    return {
        async get(bvid, page = 1) {
            const pageNumber = Number(page);
            if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > 10000) throw new Error('B站视频分集无效');
            const cid = await resolveCid(bvid, pageNumber);
            const cached = xmlCache.get(cid);
            if (cached && cached.until > now()) return cached.value;
            const response = await client.get(`https://comment.bilibili.com/${cid}.xml`, {
                headers: HEADERS, responseType: 'arraybuffer', timeout: 10000, maxRedirects: 0,
                maxContentLength: MAX_COMPRESSED + 1, ...axiosProxyOptions(getProxyUrl())
            });
            if (response.status !== 200) throw new Error('B站弹幕暂不可用');
            const xml = decompress(Buffer.from(response.data));
            if (xml.length > MAX_XML) throw new Error('B站弹幕数据过大');
            const value = { cid, items: parseDanmakuXml(xml.toString('utf8')) };
            xmlCache.set(cid, { value, until: now() + 600000 });
            return value;
        }
    };
}

module.exports = { createBilibiliDanmakuService, parseDanmakuXml };
```

- [ ] **Step 4: server-app 增加弹幕路由**

```js
const danmakuBilibili = createBilibiliDanmakuService({ getProxyUrl: () => getSourceProxyUrl('bilibili', false) });

app.get('/api/bilibili/danmaku/:bvid/:page', async (req, res) => {
    try {
        res.set('Cache-Control', 'private, max-age=600');
        res.json({ status: 'success', ...await danmakuBilibili.get(req.params.bvid, req.params.page) });
    } catch (error) {
        res.status(502).json({ status: 'error', message: error.message });
    }
});
```

- [ ] **Step 5: 播放列表加入弹幕地址**

`bilibili-list-service.js` 返回项增加：

```js
bilibiliDanmakuUrl: `${origin}/api/bilibili/danmaku/${item.bvid}/${item.page}`,
```

- [ ] **Step 6: 运行测试确认通过**

Run: `node --test tests/bilibili-danmaku-service.test.js`
Expected: 2 tests PASS

---

### Task 8: B 站控制端首页、相关推荐、已下载与弹幕开关

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/upload.html:148-162`
- Modify: `src/apps/web-mediacenter/ui/public/js/media-library.js:186-355, 465-523, 1057-1114`
- Modify: `src/apps/web-mediacenter/ui/public/css/media-library.css:519-557`

**Interfaces:**
- `MediaLibrary.bilibiliDanmakuEnabled` 从 `localStorage.getItem('aasc.bilibiliDanmaku') === '1'` 初始化。
- `playBilibiliUrl` 在开启时发送 `bilibiliDanmaku: true` 和 `bilibiliDanmakuUrl`。
- 首页与相关推荐复用卡片渲染函数。

- [ ] **Step 1: 修改 upload.html B 站工具栏**

`#bilibiliVideoBar` 内增加：

```html
<button class="control-btn" id="bilibiliHomeBtn" onclick="MediaLibrary.loadBilibiliHome()">首页</button>
<label class="bilibili-danmaku-toggle"><input type="checkbox" id="bilibiliDanmakuToggle"> 弹幕</label>
<label class="media-source-proxy"><input type="checkbox" id="bilibiliProxyToggle"> 使用代理</label>
```

在 `#bilibiliVideoList` 后增加：

```html
<div id="bilibiliRelated" class="bilibili-related" hidden>
    <div class="bilibili-related-title">相关推荐</div>
    <div id="bilibiliRelatedList" class="bilibili-video-list"></div>
</div>
```

- [ ] **Step 2: 增加卡片渲染与已下载标记**

在 `media-library.js` 增加：

```js
async loadBilibiliHome() {
    try {
        const response = await fetch('/api/bilibili/home?page=1');
        const result = await this.parseResponse(response);
        this.renderBilibiliCards(result.videos, 'B站热门');
    } catch (error) { showToast(`B站首页加载失败：${error.message}`, 'error'); }
},

async loadBilibiliRelated(bvid) {
    const root = document.getElementById('bilibiliRelated');
    const list = document.getElementById('bilibiliRelatedList');
    if (!root || !list || !/^BV[0-9A-Za-z]{10}$/.test(bvid || '')) return;
    try {
        const response = await fetch(`/api/bilibili/related?bvid=${encodeURIComponent(bvid)}`);
        const result = await this.parseResponse(response);
        list.replaceChildren(...this.buildBilibiliCards(result.videos));
        this.checkBilibiliDownloaded();
        root.hidden = !result.videos.length;
    } catch { root.hidden = true; }
},

buildBilibiliCards(videos) {
    return (Array.isArray(videos) ? videos : []).map(video => {
        const card = document.createElement('div');
        card.className = 'bilibili-video-card';
        const cover = document.createElement('img');
        cover.className = 'bilibili-video-cover'; cover.src = video.cover; cover.loading = 'lazy'; cover.alt = '';
        const title = document.createElement('div');
        title.className = 'bilibili-video-title'; title.textContent = video.title; title.title = video.title;
        const actions = document.createElement('div');
        actions.className = 'bilibili-video-actions';
        const play = document.createElement('button'); play.textContent = '播放'; play.onclick = () => this.playBilibiliUrl(video.url);
        const add = document.createElement('button'); add.textContent = '加入'; add.onclick = () => this.addBilibiliUrl(video.url);
        const download = document.createElement('button'); download.className = 'btn-bilibili-download';
        download.textContent = video.downloaded ? '已下载' : '下载';
        download.disabled = Boolean(video.downloaded);
        download.onclick = () => this.showBilibiliDownloadDialog(video.url, video.title);
        const copy = document.createElement('button'); copy.textContent = '复制链接'; copy.onclick = () => this.copyShareLink(video.url);
        actions.append(play, add, download, copy);
        card.append(cover, title, actions);
        if (/^BV[0-9A-Za-z]{10}$/.test(video.bvid || '')) {
            card.dataset.bilibiliVideo = '1'; card.dataset.bvid = video.bvid; card.dataset.page = String(video.page || 1);
        }
        return card;
    });
},

renderBilibiliCards(videos, titleText) {
    const root = document.getElementById('bilibiliVideoList');
    if (!root) return;
    root.replaceChildren();
    if (titleText) {
        const title = document.createElement('div');
        title.className = 'bilibili-section-title'; title.textContent = titleText;
        root.appendChild(title);
    }
    root.append(...this.buildBilibiliCards(videos));
    this.checkBilibiliDownloaded();
},

async checkBilibiliDownloaded() {
    document.querySelectorAll('[data-bilibili-video]').forEach(async card => {
        try {
            const response = await fetch(`/api/bilibili/downloaded?bvid=${encodeURIComponent(card.dataset.bvid)}&page=${card.dataset.page || 1}`);
            const result = await this.parseResponse(response);
            if (!result.downloaded) return;
            const button = card.querySelector('.btn-bilibili-download');
            if (button) { button.textContent = '已下载'; button.disabled = true; }
        } catch { /* 已下载状态失败不阻塞列表展示。 */ }
    });
}
```

现有 `renderBilibiliSearch` 的卡片循环（L342-354）中增加：

```js
card.dataset.bilibiliVideo = '1';
card.dataset.bvid = video.bvid;
card.dataset.page = String(video.page || 1);
download.className = 'btn-bilibili-download';
download.textContent = video.downloaded ? '已下载' : '下载';
download.disabled = Boolean(video.downloaded);
```

并在 `renderBilibiliSearch` 末尾调用 `this.checkBilibiliDownloaded()`。`renderBilibiliVideos` 的已保存视频卡片（L486-521）同样为带 `bvid` 的卡片加 `data-bilibili-video/data-bvid/data-page`，下载按钮加 `btn-bilibili-download`，在列表末尾调用一次 `checkBilibiliDownloaded()`；集合卡片没有单一 `bvid`，跳过已下载检查。

- [ ] **Step 3: 播放时加载相关推荐与附加弹幕字段**

`playBilibiliUrl` 在发送媒体前：

```js
const parsed = new URL(playerUrl);
const bvid = parsed.pathname.match(/\/video\/(BV[0-9A-Za-z]{10})/)?.[1] || '';
const page = Number(parsed.searchParams.get('p') || 1);
if (this.bilibiliDanmakuEnabled && bvid) {
    media = { ...media, bilibiliDanmaku: true, bilibiliDanmakuUrl: `/api/bilibili/danmaku/${bvid}/${page}` };
}
if (bvid) this.loadBilibiliRelated(bvid);
```

初始化弹幕开关（在 `init()` 或 `renderTabs()` 首次执行时）：

```js
const toggle = document.getElementById('bilibiliDanmakuToggle');
if (toggle) {
    this.bilibiliDanmakuEnabled = localStorage.getItem('aasc.bilibiliDanmaku') === '1';
    toggle.checked = this.bilibiliDanmakuEnabled;
    toggle.onchange = () => {
        this.bilibiliDanmakuEnabled = toggle.checked;
        localStorage.setItem('aasc.bilibiliDanmaku', toggle.checked ? '1' : '0');
    };
}
```

- [ ] **Step 4: B 站页签默认进入首页**

`switchTab('bilibili')` 在调用 `renderBilibiliVideos()` 后，首次进入时调用 `this.loadBilibiliHome()`；用 `this.bilibiliHomeLoaded` 防止每次切页签重复拉取。用户仍可通过“首页”按钮手动刷新，保存的视频列表保持原有入口。

- [ ] **Step 5: 批量播放请求携带弹幕开关**

`showBilibiliBatchPlayDialog` 的 playlist request 增加：

```js
danmaku: this.bilibiliDanmakuEnabled === true,
```

服务端 `buildPlaylist({ ..., danmaku })` 在返回项条件加入：

```js
...(danmaku ? { bilibiliDanmakuUrl: `${origin}/api/bilibili/danmaku/${item.bvid}/${item.page}`, bilibiliDanmaku: true } : {}),
```

`server-app.js` 的 `playlistRequest` B 站分支调用 `buildPlaylist` 时透传 `danmaku: data.danmaku === true`。

- [ ] **Step 6: CSS**

追加到 `media-library.css`：

```css
.bilibili-section-title,
.bilibili-related-title { font-size: 14px; font-weight: 600; margin: 8px 0; color: #ddd; }
.bilibili-related { margin-top: 12px; }
.bilibili-danmaku-toggle,
.media-source-proxy { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: #bbb; }
.bilibili-video-actions button:disabled { opacity: .55; cursor: default; }
```

- [ ] **Step 7: 手工验证**

1. B 站页签点击“首页”，显示热门列表；播放后控制端出现“相关推荐”。
2. 关闭弹幕开关播放，显示端无弹幕层；开启后重新播放出现弹幕。
3. 下载过的视频，在搜索结果中按钮显示“已下载”且不可点击。

---

### Task 9: 显示端弹幕渲染层

**Files:**
- Create: `src/apps/web-mediacenter/ui/public/js/bilibili-danmaku.js`
- Modify: `src/apps/web-mediacenter/ui/public/display.html:50-64, 5501, 5631-5683`
- Modify: `src/apps/web-mediacenter/ui/public/css/display.css`

**Interfaces:**
- Produces: `window.BilibiliDanmaku.create({ container, video, url, toggle }) -> { destroy(), setVisible(visible), visible }`
- 弹幕层类名 `.bilibili-danmaku-layer`，临时开关 id `danmakuToggle`。

- [ ] **Step 1: 创建渲染器**

```js
'use strict';
(function () {
    const LANES = { 1: 'scroll', 4: 'bottom', 5: 'top' };
    const MAX_ACTIVE = 80;

    function create(options = {}) {
        const container = options.container;
        const video = options.video;
        if (!container || !video || !options.url) throw new Error('弹幕初始化参数无效');
        const layer = document.createElement('div');
        layer.className = 'bilibili-danmaku-layer';
        container.appendChild(layer);
        let visible = true;
        let destroyed = false;
        let items = [];
        let cursor = 0;
        const active = new Set();
        let frame = 0;
        let lastTime = 0;

        function removeNode(node) {
            clearTimeout(node._danmakuTimer);
            node.remove();
        }

        function schedule(item) {
            if (active.size >= MAX_ACTIVE) return;
            const span = document.createElement('span');
            span.className = `bilibili-danmaku ${LANES[item.mode]}`;
            span.textContent = item.text;
            span.style.color = `#${Number(item.color || 0xffffff).toString(16).padStart(6, '0')}`;
            span.style.fontSize = `${Math.max(14, Math.min(36, item.fontSize || 25))}px`;
            span._danmakuTimer = setTimeout(() => { active.delete(span); removeNode(span); }, item.mode === 1 ? 9000 : 4500);
            active.add(span);
            layer.appendChild(span);
        }

        function tick() {
            if (destroyed) return;
            const now = video.currentTime || 0;
            if (now < lastTime || now - lastTime > 2) {
                cursor = 0;
                active.forEach(removeNode);
                active.clear();
            }
            lastTime = now;
            while (cursor < items.length && items[cursor].time <= now + 0.05) {
                if (visible) schedule(items[cursor]);
                cursor++;
            }
            frame = requestAnimationFrame(tick);
        }

        fetch(options.url, { credentials: 'same-origin' })
            .then(response => response.json())
            .then(result => {
                if (destroyed) return;
                items = (Array.isArray(result.items) ? result.items : []).sort((a, b) => a.time - b.time);
                frame = requestAnimationFrame(tick);
            })
            .catch(() => { /* 弹幕失败不影响视频播放。 */ });

        return {
            get visible() { return visible; },
            setVisible(value) {
                visible = value === true;
                layer.style.display = visible ? '' : 'none';
                if (visible && !frame) frame = requestAnimationFrame(tick);
                if (!visible) active.forEach(removeNode);
                if (!visible) active.clear();
            },
            destroy() {
                destroyed = true;
                cancelAnimationFrame(frame);
                active.forEach(removeNode);
                active.clear();
                layer.remove();
            }
        };
    }

    window.BilibiliDanmaku = { create };
})();
```

- [ ] **Step 2: display.html 增加 DOM 与脚本**

在 `#mediaContainer` 内、`#mediaSleepOverlay` 前加入：

```html
<div id="bilibiliDanmakuLayerHost"></div>
<button id="danmakuToggle" type="button" hidden>弹幕</button>
```

在页面脚本加载区加入：

```html
<script src="/js/bilibili-danmaku.js"></script>
```

- [ ] **Step 3: showMedia 集成**

在显示端主脚本顶部增加模块变量与函数：

```js
let bilibiliDanmakuController = null;
function stopBilibiliDanmaku() {
    try { bilibiliDanmakuController?.destroy(); } catch { /* 忽略清理失败。 */ }
    bilibiliDanmakuController = null;
    const toggle = document.getElementById('danmakuToggle');
    if (toggle) toggle.hidden = true;
}
function setupBilibiliDanmaku(data) {
    stopBilibiliDanmaku();
    if (!data?.bilibiliDanmaku || !data?.bilibiliDanmakuUrl) return;
    const toggle = document.getElementById('danmakuToggle');
    try {
        bilibiliDanmakuController = window.BilibiliDanmaku.create({
            container: document.getElementById('mediaContainer'),
            video: document.getElementById('mediaVideo'),
            url: data.bilibiliDanmakuUrl,
            toggle
        });
        if (toggle) {
            toggle.hidden = false;
            toggle.onclick = () => {
                const visible = !bilibiliDanmakuController.visible;
                bilibiliDanmakuController.setVisible(visible);
                toggle.textContent = visible ? '弹幕' : '弹幕已关';
            };
        }
    } catch { bilibiliDanmakuController = null; }
}
```

`showMedia` 开头调用 `stopBilibiliDanmaku()`；视频分支在设置 `mediaVideo.src`/初始化 dash.js 成功后调用 `setupBilibiliDanmaku(data)`；非视频分支和媒体清理处也调用 `stopBilibiliDanmaku()`。

- [ ] **Step 4: CSS**

追加到 `display.css`：

```css
.bilibili-danmaku-layer {
    position: absolute; inset: 0; z-index: 50;
    overflow: hidden; pointer-events: none;
}
.bilibili-danmaku {
    position: absolute; white-space: nowrap; font-weight: 600;
    text-shadow: 0 1px 2px rgba(0,0,0,.9); will-change: transform;
}
.bilibili-danmaku.scroll { top: var(--lane, 10%); left: 100%; animation: danmaku-scroll 9s linear forwards; }
.bilibili-danmaku.top { top: 8%; left: 50%; transform: translateX(-50%); }
.bilibili-danmaku.bottom { bottom: 8%; left: 50%; transform: translateX(-50%); }
@keyframes danmaku-scroll { from { transform: translateX(0); } to { transform: translateX(-120vw); } }
#danmakuToggle {
    position: absolute; top: 12px; right: 12px; z-index: 60;
    pointer-events: auto; opacity: .5; background: rgba(0,0,0,.4);
    color: #fff; border: 1px solid rgba(255,255,255,.35); border-radius: 4px; padding: 2px 8px;
}
```

为滚动弹幕分配轨道：在渲染器 `schedule` 内设置 `span.style.setProperty('--lane', `${(active.size % 10) * 8 + 6}%`)`。

- [ ] **Step 5: 手工验证**

1. Android 与桌面显示端：播放开启弹幕的 B 站视频，滚动/顶部/底部弹幕出现。
2. 暂停、继续、向前/向后 seek，弹幕与视频时间一致，无堆积。
3. 点击右上角“弹幕”临时关闭，再次点击恢复。
4. 关闭弹幕开关重新播放，`#danmakuToggle` 隐藏，无弹幕层。

---

### Task 10: 夸克分享、文件与文件夹下载统一

**Files:**
- Modify: `src/apps/server/modules/media/quark-directory-downloads.js:41-126`
- Modify: `src/apps/server/boot/server-app.js:6011-6027, 6113-6121, 6031-6037`
- Modify: `src/apps/web-mediacenter/ui/public/js/media-library.js:711-730, 1332-1366, 1704-1757`
- Test: `tests/quark-directory-downloads.test.js`

**Interfaces:**
- Produces: `QuarkDirectoryDownloads.lookupDirectory(source, dirPath, targetId)`
- Produces: `QuarkDirectoryDownloads.startFile(source, filePath, targetId)`
- 目录下载完成时写入 `{ directory: true, fileCount }` 记录。
- 新路由：`POST /api/quark-file-downloads`
- 媒体库列表项与夸克分享卡片增加 `downloaded` 字段。

- [ ] **Step 1: 写失败测试**

追加到 `tests/quark-directory-downloads.test.js`：

```js
test('目录完成记录可查询，单文件记录不会被误判为目录', async () => {
    const { QuarkDirectoryDownloads } = require('../src/apps/server/modules/media/quark-directory-downloads');
    const os = require('node:os');
    const path = require('node:path');
    const instance = new QuarkDirectoryDownloads({
        indexPath: path.join(os.tmpdir(), `quark-index-${process.pid}.json`),
        getTarget: () => ({ basePath: os.tmpdir() }),
        list: async () => [],
        open: async () => ({})
    });
    const source = { nodeId: 'main-server', libraryId: 'share1' };
    instance.records.push({ key: instance.key(source, '/'), source, filePath: '/', targetId: 't1', relative: '', size: 0, directory: true, fileCount: 2, updatedAt: Date.now() });
    assert.ok(await instance.lookupDirectory(source, '/'));
    assert.equal(await instance.lookup(source, '/'), null);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/quark-directory-downloads.test.js`
Expected: FAIL，`lookupDirectory is not a function`

- [ ] **Step 3: 扩展下载索引**

在 `QuarkDirectoryDownloads` 增加：

```js
async lookupDirectory(source, dirPath, targetId) {
    const key = this.key(source, this.validatePath(dirPath));
    return this.records.find(record => record.key === key && record.directory === true && (!targetId || record.targetId === targetId)) || null;
}

startFile(source, filePath, targetId) {
    if (!source?.nodeId || !source?.libraryId || !targetId) throw new Error('下载来源或目标无效');
    const targetPath = this.validatePath(filePath);
    this.getTarget(targetId, true);
    const job = { id: crypto.randomUUID(), status: 'running', source, dirPath: targetPath, fileMode: true, targetId, completed: 0, skipped: 0, received: 0, total: 1, fileName: path.posix.basename(targetPath) };
    void this.runFile(job, targetPath).catch(error => { job.status = 'error'; job.message = error.message || '下载失败'; this.notify(job); });
    this.notify(job);
    return { ...job };
}

async runFile(job, filePath) {
    const existing = await this.lookup(job.source, filePath, job.targetId);
    if (existing) { job.skipped = 1; job.status = 'done'; this.notify(job); return; }
    const root = await fs.promises.realpath(this.getTarget(job.targetId, true).basePath);
    const relativeParts = filePath.split('/').filter(Boolean);
    const directory = await this.safeDir(root, relativeParts.slice(0, -1));
    const output = path.join(directory, relativeParts[relativeParts.length - 1]);
    const stream = await this.open(job.source, filePath);
    const temporary = path.join(directory, `.aasc-${crypto.randomUUID()}.part`);
    try {
        await pipeline(stream, fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
        const stat = await fs.promises.stat(temporary);
        await fs.promises.rename(temporary, output).catch(async error => {
            if (error.code !== 'EEXIST' && error.code !== 'ENOTEMPTY') throw error;
            await fs.promises.unlink(output).catch(() => {});
            await fs.promises.rename(temporary, output);
        });
        job.received = stat.size; job.completed = 1;
        this.records.push({ key: this.key(job.source, filePath), source: job.source, filePath, targetId: job.targetId, relative: path.relative(root, output), size: stat.size, updatedAt: Date.now() });
        await this.persist();
        job.status = 'done'; this.notify(job);
    } finally { await fs.promises.unlink(temporary).catch(() => {}); }
}
```

在既有目录任务 `run` 完成前（`job.status = 'done'` 前）加入目录完成记录（根目录 `/` 也要记录，用于分享卡片“已下载”状态）：

```js
const key = this.key(job.source, job.dirPath);
this.records.push({ key, source: job.source, filePath: job.dirPath, targetId: job.targetId, relative: '', size: 0, directory: true, fileCount: job.completed + job.skipped, updatedAt: Date.now() });
await this.persist();
```

这里需要把 `run(job)` 改为能访问 `source` 和 `dirPath`（job 已保存这两个字段，直接使用 `job.source`、`job.dirPath`）。

- [ ] **Step 4: server-app 增加单文件路由与列表状态**

```js
app.post('/api/quark-file-downloads', async (req, res) => {
    try {
        const { nodeId = AASC_MAIN_NODE_ID, libraryId, targetId, path: filePath } = req.body || {};
        if (typeof libraryId !== 'string' || typeof targetId !== 'string' || typeof filePath !== 'string') throw new Error('下载参数无效');
        if (nodeId !== AASC_MAIN_NODE_ID) throw new Error('单文件下载仅支持主服务器夸克媒体库');
        const source = mediaLibraryManager.getLibrary(libraryId);
        if (!source || source.config.type !== 'quark') throw new Error('夸克媒体库不存在');
        const job = quarkDirectoryDownloads.startFile({ nodeId, libraryId }, filePath, targetId);
        res.json({ status: 'success', job });
    } catch (error) { res.status(400).json({ status: 'error', message: error.message }); }
});
```

列表路由在返回前为夸克库附加状态：

```js
const library = mediaLibraryManager.getLibrary(req.params.id);
if (library?.config.type === 'quark' && !library.config.remote) {
    const source = { nodeId: AASC_MAIN_NODE_ID, libraryId: req.params.id };
    await Promise.all(items.map(async item => {
        item.downloaded = item.type === 'folder'
            ? Boolean(await quarkDirectoryDownloads.lookupDirectory(source, item.path))
            : Boolean(await quarkDirectoryDownloads.lookup(source, item.path));
    }));
}
```

`GET /api/media-libraries` 返回前为本地夸克库附加：

```js
downloaded: library.config.type === 'quark' ? Boolean(await quarkDirectoryDownloads.lookupDirectory({ nodeId: AASC_MAIN_NODE_ID, libraryId: library.config.id }, '/')) : false
```

（按现有返回结构在 `listLibraries()` 结果上映射。）

- [ ] **Step 5: 前端分享卡片增加下载按钮**

`renderQuarkShares` 的 actions 增加：

```js
const download = document.createElement('button');
download.textContent = library.downloaded ? '已下载' : '下载';
download.disabled = Boolean(library.downloaded);
download.onclick = event => { event.stopPropagation(); this.showQuarkDirectoryDownloadDialog('/', library); };
actions.append(move, edit, copy, download);
```

`showQuarkDirectoryDownloadDialog(folderPath, sourceLibrary = null)` 使用 `const source = sourceLibrary || this.currentLibrary;`，其余不变。

- [ ] **Step 6: 文件与文件夹卡片显示已下载并支持单文件下载**

文件夹下载按钮：

```js
<button class="btn-download" ${item.downloaded ? 'disabled' : ''} onclick="event.stopPropagation(); MediaLibrary.showQuarkDirectoryDownloadDialog(this.closest('.media-library-item').dataset.directoryPath)">${item.downloaded ? '已下载' : '下载到媒体库'}</button>
```

文件卡片把夸克下载入口替换为：

```js
${this.currentLibrary?.type === 'quark'
    ? `<button class="btn-download" ${item.downloaded ? 'disabled' : ''} onclick="event.stopPropagation(); MediaLibrary.showQuarkFileDownloadDialog('${this._escapeHtml(item.path)}')">${item.downloaded ? '已下载' : '下载'}</button>`
    : (downloadUrl ? `<a class="btn-download" href="${this._escapeHtml(downloadUrl)}" download="${this._escapeHtml(item.name || '')}" onclick="event.stopPropagation()">下载</a>` : '')}
```

新增：

```js
showQuarkFileDownloadDialog(filePath) {
    const source = this.currentLibrary;
    if (!source || source.type !== 'quark') return;
    const targets = this.libraries.filter(lib => lib.type === 'local' && !lib.readonly && !lib.remote && lib.isLocal !== false);
    if (!targets.length) { showToast('请先添加主服务器上的可写本地媒体库', 'error'); return; }
    const mask = document.createElement('div'); mask.className = 'modal-mask';
    const dialog = document.createElement('div'); dialog.className = 'playlist-settings-dialog';
    const title = document.createElement('div'); title.className = 'dialog-title'; title.textContent = '下载文件到本地媒体库';
    const body = document.createElement('div'); body.className = 'dialog-body';
    const description = document.createElement('p'); description.textContent = `来源文件：${filePath}`;
    const select = document.createElement('select'); select.setAttribute('aria-label', '目标本地媒体库');
    for (const lib of targets) { const option = document.createElement('option'); option.value = lib.sourceLibraryId || lib.id; option.textContent = lib.name; select.appendChild(option); }
    body.append(description, select);
    const footer = document.createElement('div'); footer.className = 'dialog-footer';
    const cancel = document.createElement('button'); cancel.className = 'btn-cancel'; cancel.textContent = '取消'; cancel.onclick = () => mask.remove();
    const start = document.createElement('button'); start.className = 'btn-confirm'; start.textContent = '开始下载';
    start.onclick = async () => {
        start.disabled = true;
        try {
            const response = await fetch('/api/quark-file-downloads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodeId: source.remote ? source.ownerNodeId : 'main-server', libraryId: source.sourceLibraryId || source.id, targetId: select.value, path: filePath }) });
            const result = await this.parseResponse(response);
            this.handleQuarkDirectoryDownload(result.job); mask.remove();
        } catch (error) { showToast(`文件下载失败：${error.message}`, 'error'); start.disabled = false; }
    };
    footer.append(cancel, start); dialog.append(title, body, footer); mask.appendChild(dialog); document.body.appendChild(mask);
}
```

- [ ] **Step 7: 运行测试确认通过**

Run: `node --test tests/quark-directory-downloads.test.js`
Expected: 原有测试 + 新用例全部 PASS

---

### Task 11: 地区页签分组

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/upload.html:137-141`
- Modify: `src/apps/web-mediacenter/ui/public/js/media-library.js:690-702`
- Modify: `src/apps/web-mediacenter/ui/public/css/media-library.css`

**Interfaces:**
- 静态页签顺序：本地媒体、夸克分享、国内媒体标签、B站视频、国内任务源、国外媒体标签、国外任务源。

- [ ] **Step 1: 调整静态 DOM**

把 `.media-library-tabs` 内容替换为：

```html
<button class="media-library-tab active" data-tab="libraries" id="mediaTabLibraries" onclick="MediaLibrary.switchTab('libraries')">本地媒体</button>
<button class="media-library-tab" data-tab="quark" id="mediaTabQuark" onclick="MediaLibrary.switchTab('quark')">夸克分享</button>
<span class="media-region-label" data-region-label="domestic">国内媒体</span>
<button class="media-library-tab" data-tab="bilibili" data-region="domestic" id="mediaTabBilibili" onclick="MediaLibrary.switchTab('bilibili')">B站视频</button>
<span class="media-region-group" id="domesticMediaTabs"></span>
<span class="media-region-label" data-region-label="overseas">国外媒体</span>
<span class="media-region-group" id="overseasMediaTabs"></span>
```

- [ ] **Step 2: 分组渲染任务源**

`renderTaskMediaTabs()` 改为：

```js
renderTaskMediaTabs() {
    document.querySelectorAll('[data-task-media-source]').forEach(el => el.remove());
    const groups = { domestic: document.getElementById('domesticMediaTabs'), overseas: document.getElementById('overseasMediaTabs') };
    if (!groups.domestic || !groups.overseas) return;
    groups.domestic.replaceChildren(); groups.overseas.replaceChildren();
    for (const source of this.taskMediaSources || []) {
        const host = groups[source.region === 'overseas' ? 'overseas' : 'domestic'];
        const tab = document.createElement('button');
        tab.className = 'media-library-tab media-task-source';
        tab.dataset.taskMediaSource = source.id;
        tab.textContent = source.name;
        tab.onclick = () => this.switchTaskMediaSource(source.id);
        const proxy = document.createElement('label');
        proxy.className = 'media-source-proxy';
        proxy.title = '使用全局网页代理';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox'; checkbox.dataset.providerProxy = source.id;
        checkbox.checked = Boolean(this.webProxyConfig?.providerProxy?.[source.id] ?? source.proxyDefault);
        checkbox.onclick = event => { event.stopPropagation(); this.toggleProviderProxy(source.id, checkbox.checked); };
        proxy.append(checkbox, document.createTextNode(' 使用代理'));
        const wrap = document.createElement('span');
        wrap.className = 'media-task-source-wrap';
        wrap.append(tab, proxy);
        host.appendChild(wrap);
    }
}
```

- [ ] **Step 3: CSS**

```css
.media-region-label { align-self: center; margin: 0 4px 0 8px; font-size: 12px; color: #888; white-space: nowrap; }
.media-region-group { display: inline-flex; align-items: center; gap: 6px; }
.media-task-source-wrap { display: inline-flex; align-items: center; gap: 2px; }
.media-task-source-wrap .media-source-proxy { font-size: 11px; }
```

- [ ] **Step 4: 手工验证**

启动国内媒体任务后，B 站与国内任务源显示在“国内媒体”之后；国外任务源显示在“国外媒体”之后；停止任务后页签移除且当前页签回退到“本地媒体”。

---

### Task 12: 文档与自测更新

**Files:**
- Modify: `docs/spec/media-library.md`
- Modify: `docs/spec/self-test.md`
- Modify: `docs/design/media-library.md`
- Modify: `docs/todo.md`
- Modify: `changelog.md`

- [ ] **Step 1: 更新 spec**

把本计划新增的 `web-proxy`、registry 元数据、`callTaskSource`、搜索双通道、发现服务、弹幕服务、夸克 `lookupDirectory/startFile` 写成伪代码，并标注实际文件路径。

- [ ] **Step 2: 更新自测**

在 `docs/spec/self-test.md` 增加可执行检查项：

```text
媒体库-B站搜索稳定性：连续搜索 10 次均返回 JSON；第 11 次模拟 412 后 30 秒内提示稍后重试。
媒体库-B站弹幕：开启后显示滚动/顶部/底部弹幕；暂停、恢复、seek 同步；关闭后无弹幕层。
媒体库-B站首页与相关推荐：首页热门可播放；播放后控制端出现相关推荐。
媒体库-B站已下载：已下载视频按钮显示“已下载”并禁用。
媒体库-夸克下载：分享卡片、文件、文件夹均可下载到本地媒体库；完成后显示“已下载”。
媒体库-代理：非法代理地址提示；开启来源代理后请求走代理；关闭后不走代理。
媒体库-地区分组：国内/国外任务源分组正确，任务停止后页签移除。
```

- [ ] **Step 3: 更新 todo/changelog**

从 `docs/todo.md` 删除已完成条目；在 `changelog.md` 记录“B站搜索双通道、弹幕、首页/相关推荐、已下载、夸克下载统一、代理与地区分组”。

- [ ] **Step 4: 全量测试**

Run: `node --test tests/web-proxy.test.js tests/task-media-provider-registry.test.js tests/media-library-app-service.test.js tests/bilibili-search-service.test.js tests/bilibili-discovery-service.test.js tests/bilibili-danmaku-service.test.js tests/quark-directory-downloads.test.js`
Expected: 全部 PASS

---

## Self-Review

- Spec coverage：地区元数据、代理、统一调用、B站搜索/首页/推荐/弹幕/已下载、夸克下载与状态、地区分组均对应任务。
- Placeholder scan：无 TBD/TODO；每个代码步骤包含实际实现。
- Type consistency：`callTaskSource`、`getTaskSourceProvider`、`proxyUrl`、`lookupDirectory`、`startFile` 在定义与使用处命名一致。
