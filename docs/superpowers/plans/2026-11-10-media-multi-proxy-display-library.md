# 媒体库多代理、显示端媒体库与下载子分类实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把单全局代理改为命名代理列表并按媒体源选择；在显示端左下角“游戏”上方为回环访问新增只读媒体库浏览与播放；夸克与 B 站下载按“来源名/分类”分层落盘。

**Architecture:** 三个功能均在现有架构内实现：服务端权威配置与代理解析、WebSocket 控制/显示协议、Express 路由；控制端与显示端只消费服务端数据。代理配置通过 `webProxySettings` 服务集中校验与持久化；显示端新增 `/api/display-local/*` 回环路由和 `displayPlaylistRequest` 显示端 WS 消息；下载路径由共享的 `sanitizeCategoryName` 清洗分类后拼接。

**Tech Stack:** Node.js（CommonJS）、Express、WebSocket（ws）、原生浏览器 JS、`node --test`、puppeteer-core + cheerio（浏览器测试）。

## Global Constraints

- **禁止任何 git 状态变更**：不得执行 `git commit`、`git reset`、`git stash`、`git checkout`、`git add` 以外的暂存/提交操作。每个任务以“运行测试并记录结果”结束，不提交。
- **禁止直接控制服务器进程**：不得 `kill`/`pkill`/启动/停止/重启 `server-app.js`；测试只允许在进程内启动临时 Express 测试服务器。
- 仅使用 `const` / `let`，禁止 `var`；异步用 `async/await`；错误处理用 `try-catch`；注释使用中文；禁止长串 `if/else if`，分支选择使用映射表或早期返回。
- 代理地址（可能含凭据）不得写入日志、错误消息或广播给显示端。
- 所有测试使用 `node --test`。浏览器测试在 `/usr/bin/chromium` 不存在时 `t.skip('Chromium 不可用')`。
- UI 文案必须逐字一致：`媒体库`、`不使用代理`、`代理数量超出限制（最多 20 个）`、`代理名称不能为空且不能超过 30 个字符`、`代理地址格式不正确，仅支持 http/https/socks/socks5/socks5h`、`媒体源标识不合法`、`所选代理不存在，请先保存代理列表`、`仅限本机访问`、`仅限本机使用`、`该目录没有可播放的媒体`、`媒体库加载失败，请稍后重试`、`此目录没有可播放的媒体`、`目标：`、`未分类`。
- 设计文档：`docs/superpowers/specs/2026-11-10-media-multi-proxy-display-library-design.md`。实现不得偏离该文档的服务端权威与只读边界。

---

### Task 1: 多代理核心解析与旧配置迁移

**Files:**
- Modify: `src/apps/server/modules/media/web-proxy.js`
- Rewrite: `tests/web-proxy.test.js`

**Interfaces:**
- Consumes: 现有 `normalizeProxyUrl`、`getProxyAgents`、`axiosProxyOptions` 行为不变。
- Produces:
  - `MAX_PROXIES = 20`
  - `LEGACY_PROXY_ID = 'proxy-legacy'`
  - `normalizeWebProxyList(value) -> [{ id, name, url }]`
  - `migrateLegacyProxyConfig({ globalProxy, switches }) -> { proxies, selections, legacyUrl }`
  - `resolveSourceProxyUrl({ proxies, selections, sourceId }) -> string`（找不到或地址非法返回 `''`，不抛错）

- [ ] **Step 1: 重写失败测试**

将 `tests/web-proxy.test.js` 全文替换为：

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizeProxyUrl, normalizeWebProxyList, migrateLegacyProxyConfig,
    resolveSourceProxyUrl, axiosProxyOptions, MAX_PROXIES, LEGACY_PROXY_ID
} = require('../src/apps/server/modules/media/web-proxy');

test('normalizeProxyUrl 接受 HTTP/HTTPS/SOCKS5 并去掉末尾斜杠', () => {
    assert.equal(normalizeProxyUrl(''), '');
    assert.equal(normalizeProxyUrl('http://127.0.0.1:7890/'), 'http://127.0.0.1:7890');
    assert.equal(normalizeProxyUrl('socks5://127.0.0.1:1080'), 'socks5://127.0.0.1:1080');
    assert.equal(normalizeProxyUrl('socks5h://127.0.0.1:1080'), 'socks5h://127.0.0.1:1080');
});

test('normalizeProxyUrl 拒绝非法协议和查询参数', () => {
    assert.throws(() => normalizeProxyUrl('ftp://127.0.0.1:21'), /HTTP\/HTTPS\/SOCKS5/);
    assert.throws(() => normalizeProxyUrl('http://127.0.0.1:7890/?a=1'), /查询参数/);
});

test('normalizeWebProxyList 过滤非法项并限制最大数量', () => {
    const list = normalizeWebProxyList([
        { id: 'p1', name: ' 公司代理 ', url: 'http://127.0.0.1:7890/' },
        { id: '', name: '缺少 ID', url: 'http://127.0.0.1:1080' },
        { id: 'p3', name: '非法协议', url: 'ftp://127.0.0.1:21' },
        null
    ]);
    assert.deepEqual(list, [{ id: 'p1', name: '公司代理', url: 'http://127.0.0.1:7890' }]);
    const many = Array.from({ length: MAX_PROXIES + 5 }, (_, index) => (
        { id: `p${index}`, name: `代理${index}`, url: 'http://127.0.0.1:7890' }
    ));
    assert.equal(normalizeWebProxyList(many).length, MAX_PROXIES);
    assert.deepEqual(normalizeWebProxyList(null), []);
});

test('migrateLegacyProxyConfig 把旧布尔开关迁移为命名代理选择', () => {
    const migrated = migrateLegacyProxyConfig({
        globalProxy: 'socks5://127.0.0.1:1080/',
        switches: { bilibili: true, youtube: false, hongguo: true }
    });
    assert.deepEqual(migrated.proxies, [
        { id: LEGACY_PROXY_ID, name: '默认代理', url: 'socks5://127.0.0.1:1080' }
    ]);
    assert.deepEqual(migrated.selections, {
        bilibili: LEGACY_PROXY_ID,
        youtube: '',
        hongguo: LEGACY_PROXY_ID
    });
    assert.equal(migrated.legacyUrl, 'socks5://127.0.0.1:1080');
});

test('migrateLegacyProxyConfig 在全局代理为空或非法时清空所有选择', () => {
    assert.deepEqual(
        migrateLegacyProxyConfig({ globalProxy: 'not-a-url', switches: { bilibili: true } }).selections,
        { bilibili: '' }
    );
    const empty = migrateLegacyProxyConfig({ globalProxy: '', switches: { bilibili: true, quark: false } });
    assert.deepEqual(empty.proxies, []);
    assert.deepEqual(empty.selections, { bilibili: '', quark: '' });
    assert.equal(empty.legacyUrl, '');
});

test('resolveSourceProxyUrl 按来源选择命名代理', () => {
    const proxies = [{ id: 'p1', name: '公司代理', url: 'http://127.0.0.1:7890/' }];
    assert.equal(
        resolveSourceProxyUrl({ proxies, selections: { bilibili: 'p1' }, sourceId: 'bilibili' }),
        'http://127.0.0.1:7890'
    );
    assert.equal(resolveSourceProxyUrl({ proxies, selections: {}, sourceId: 'bilibili' }), '');
    assert.equal(resolveSourceProxyUrl({ proxies, selections: { bilibili: '' }, sourceId: 'bilibili' }), '');
    assert.equal(resolveSourceProxyUrl({ proxies, selections: { bilibili: 'missing' }, sourceId: 'bilibili' }), '');
    assert.equal(resolveSourceProxyUrl({ proxies, selections: { bilibili: 'p1' }, sourceId: '' }), '');
    assert.equal(resolveSourceProxyUrl({}), '');
});

test('resolveSourceProxyUrl 对持久化非法地址降级为空代理', () => {
    assert.equal(resolveSourceProxyUrl({
        proxies: [{ id: 'p1', name: '坏代理', url: 'not-a-url' }],
        selections: { bilibili: 'p1' },
        sourceId: 'bilibili'
    }), '');
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
Expected: FAIL，提示 `normalizeWebProxyList is not a function` 或 `migrateLegacyProxyConfig is not a function`。

- [ ] **Step 3: 实现 `web-proxy.js`**

将文件内容替换为（保留原有 `getProxyAgents` / `axiosProxyOptions`）：

```js
'use strict';
const { URL } = require('node:url');

const PROTOCOLS = new Set(['http:', 'https:', 'socks:', 'socks5:', 'socks5h:']);
const MAX_PROXIES = 20;
const LEGACY_PROXY_ID = 'proxy-legacy';
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

// 读取持久化代理表时做一次防御性规范化：坏项直接丢弃，不影响其他代理。
function normalizeWebProxyList(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, MAX_PROXIES).map(proxy => {
        if (!proxy || typeof proxy !== 'object') return null;
        const id = typeof proxy.id === 'string' ? proxy.id.trim() : '';
        const name = typeof proxy.name === 'string' ? proxy.name.trim().slice(0, 30) : '';
        if (!id || !name) return null;
        let url = '';
        try { url = normalizeProxyUrl(proxy.url); } catch { url = ''; }
        return url ? { id, name, url } : null;
    }).filter(Boolean);
}

// 旧模型“单个全局代理 + 布尔开关”只迁移一次：true 且全局代理有效才指向 legacy 代理。
function migrateLegacyProxyConfig({ globalProxy = '', switches = {} } = {}) {
    let legacyUrl = '';
    try { legacyUrl = normalizeProxyUrl(globalProxy); } catch { legacyUrl = ''; }
    const proxies = legacyUrl
        ? [{ id: LEGACY_PROXY_ID, name: '默认代理', url: legacyUrl }]
        : [];
    const selections = {};
    for (const [sourceId, enabled] of Object.entries(switches || {})) {
        selections[sourceId] = enabled === true && legacyUrl ? LEGACY_PROXY_ID : '';
    }
    return { proxies, selections, legacyUrl };
}

// 按来源解析命名代理；持久化数据损坏时降级为“不使用代理”，读取路径不抛错。
function resolveSourceProxyUrl({ proxies = [], selections = {}, sourceId } = {}) {
    if (!sourceId) return '';
    const selection = Object.prototype.hasOwnProperty.call(selections || {}, sourceId)
        ? selections[sourceId]
        : '';
    const proxyId = typeof selection === 'string' ? selection : '';
    if (!proxyId) return '';
    const proxy = Array.isArray(proxies)
        ? proxies.find(item => item && item.id === proxyId)
        : null;
    if (!proxy) return '';
    try { return normalizeProxyUrl(proxy.url); } catch { return ''; }
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

module.exports = {
    normalizeProxyUrl, normalizeWebProxyList, migrateLegacyProxyConfig,
    resolveSourceProxyUrl, getProxyAgents, axiosProxyOptions,
    MAX_PROXIES, LEGACY_PROXY_ID
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/web-proxy.test.js`
Expected: `# tests 8` / `# pass 8` / `# fail 0`。

- [ ] **Step 5: 记录结果（不提交 git）**

把测试命令与通过数量记入任务报告。不要执行 `git add` / `git commit`。

---

### Task 2: 代理设置服务与服务端接线

**Files:**
- Create: `src/apps/server/modules/media/web-proxy-settings.js`
- Create: `tests/web-proxy-settings.test.js`
- Modify: `src/apps/server/boot/server-app.js`（导入、迁移调用、`getSourceProxyUrl`、`getWebProxyConfig`、WS 处理、控制端允许消息）

**Interfaces:**
- Consumes: Task 1 的 `normalizeWebProxyList`、`migrateLegacyProxyConfig`、`resolveSourceProxyUrl`、`MAX_PROXIES`、`LEGACY_PROXY_ID`。
- Produces:
  - `ensureWebProxyMigration({ get, set }) -> boolean`
  - `createWebProxySettings({ get, set, listSources, generateId }) -> { snapshot(), setList(payload), setProvider(payload) }`
  - `snapshot()` 返回 `{ type: 'webProxyConfig', webProxies, providerProxy, sources: [{ id, name, region, proxyId }] }`

- [ ] **Step 1: 写失败测试 `tests/web-proxy-settings.test.js`**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    ensureWebProxyMigration, createWebProxySettings
} = require('../src/apps/server/modules/media/web-proxy-settings');
const { LEGACY_PROXY_ID } = require('../src/apps/server/modules/media/web-proxy');

// 内存配置模拟 config.get/set 的点路径行为，set 立即生效并返回 true。
function memoryConfig(initial = {}) {
    const data = JSON.parse(JSON.stringify(initial));
    const locate = (key, create) => {
        const keys = key.split('.');
        let obj = data;
        for (let i = 0; i < keys.length - 1; i++) {
            if (!obj[keys[i]] || typeof obj[keys[i]] !== 'object') {
                if (!create) return null;
                obj[keys[i]] = {};
            }
            obj = obj[keys[i]];
        }
        return { obj, key: keys[keys.length - 1] };
    };
    return {
        data,
        get(key, fallback) {
            const target = locate(key, false);
            if (!target || !(target.key in target.obj)) return fallback;
            return target.obj[target.key];
        },
        set(key, value) {
            const target = locate(key, true);
            target.obj[target.key] = value;
            return true;
        }
    };
}

test('迁移保留旧全局代理与 true 开关，并且只执行一次', () => {
    const config = memoryConfig({
        network: { globalWebProxy: 'http://127.0.0.1:7890/' },
        media: { providerProxy: { bilibili: true, quark: false } }
    });
    assert.equal(ensureWebProxyMigration(config), true);
    assert.deepEqual(config.data.network.webProxies, [
        { id: LEGACY_PROXY_ID, name: '默认代理', url: 'http://127.0.0.1:7890' }
    ]);
    assert.deepEqual(config.data.media.providerProxy, {
        bilibili: LEGACY_PROXY_ID,
        quark: ''
    });
    assert.equal(config.data.network.globalWebProxy, '');
    assert.equal(ensureWebProxyMigration(config), false);
    assert.equal(config.data.network.webProxies.length, 1);
});

test('迁移在旧全局代理无效时清空选择且不创建代理', () => {
    const config = memoryConfig({
        network: { globalWebProxy: 'ftp://127.0.0.1:21' },
        media: { providerProxy: { bilibili: true, hongguo: true } }
    });
    assert.equal(ensureWebProxyMigration(config), true);
    assert.deepEqual(config.data.network.webProxies, []);
    assert.deepEqual(config.data.media.providerProxy, { bilibili: '', hongguo: '' });
});

test('已有 webProxies 数组时迁移幂等跳过', () => {
    const config = memoryConfig({
        network: { globalWebProxy: 'http://127.0.0.1:7890', webProxies: [] },
        media: { providerProxy: { bilibili: true } }
    });
    assert.equal(ensureWebProxyMigration(config), false);
    assert.deepEqual(config.data.media.providerProxy, { bilibili: true });
});

test('快照附带 B 站与任务源的 proxyId', () => {
    const config = memoryConfig({
        network: { webProxies: [{ id: 'p1', name: '公司代理', url: 'http://127.0.0.1:7890' }] },
        media: { providerProxy: { bilibili: 'p1', hongguo: '' } }
    });
    const settings = createWebProxySettings({
        get: config.get, set: config.set,
        listSources: () => [
            { id: 'bilibili', name: 'B 站视频', region: 'domestic' },
            { id: 'hongguo', name: '红果短剧', region: 'overseas' }
        ]
    });
    const snapshot = settings.snapshot();
    assert.equal(snapshot.type, 'webProxyConfig');
    assert.deepEqual(snapshot.webProxies, config.data.network.webProxies);
    assert.deepEqual(snapshot.sources, [
        { id: 'bilibili', name: 'B 站视频', region: 'domestic', proxyId: 'p1' },
        { id: 'hongguo', name: '红果短剧', region: 'overseas', proxyId: '' }
    ]);
});

test('保存代理列表保留已有 id、给新增项生成 id、清理悬空选择', () => {
    const config = memoryConfig({
        network: { webProxies: [{ id: 'p1', name: '旧代理', url: 'http://127.0.0.1:7890' }] },
        media: { providerProxy: { bilibili: 'p1', hongguo: 'p-gone' } }
    });
    let sequence = 0;
    const settings = createWebProxySettings({
        get: config.get, set: config.set,
        listSources: () => [],
        generateId: () => `proxy-test${++sequence}`
    });
    settings.setList({
        webProxies: [
            { id: 'p1', name: '公司代理', url: 'http://127.0.0.1:7890/' },
            { name: '备用代理', url: 'socks5://127.0.0.1:1080' }
        ]
    });
    assert.deepEqual(config.data.network.webProxies, [
        { id: 'p1', name: '公司代理', url: 'http://127.0.0.1:7890' },
        { id: 'proxy-test1', name: '备用代理', url: 'socks5://127.0.0.1:1080' }
    ]);
    assert.deepEqual(config.data.media.providerProxy, { bilibili: 'p1', hongguo: '' });
});

test('删除被引用代理时同一保存操作把来源置为空选择', () => {
    const config = memoryConfig({
        network: { webProxies: [{ id: 'p1', name: '公司代理', url: 'http://127.0.0.1:7890' }] },
        media: { providerProxy: { bilibili: 'p1' } }
    });
    const settings = createWebProxySettings({ get: config.get, set: config.set, listSources: () => [] });
    settings.setList({ webProxies: [] });
    assert.deepEqual(config.data.network.webProxies, []);
    assert.deepEqual(config.data.media.providerProxy, { bilibili: '' });
});

test('代理列表校验失败时不写入配置', () => {
    const config = memoryConfig({ network: { webProxies: [] }, media: { providerProxy: {} } });
    const settings = createWebProxySettings({ get: config.get, set: config.set, listSources: () => [] });
    const before = JSON.stringify(config.data);
    const tooMany = Array.from({ length: 21 }, (_, index) => (
        { name: `代理${index}`, url: 'http://127.0.0.1:7890' }
    ));
    assert.throws(() => settings.setList({ webProxies: tooMany }), /代理数量超出限制（最多 20 个）/);
    assert.throws(() => settings.setList({ webProxies: [{ name: '', url: 'http://127.0.0.1:7890' }] }), /代理名称不能为空且不能超过 30 个字符/);
    assert.throws(() => settings.setList({ webProxies: [{ name: 'x'.repeat(31), url: 'http://127.0.0.1:7890' }] }), /代理名称不能为空且不能超过 30 个字符/);
    assert.throws(() => settings.setList({ webProxies: [{ name: '代理', url: 'ftp://127.0.0.1:21' }] }), /代理地址格式不正确，仅支持 http\/https\/socks\/socks5\/socks5h/);
    assert.equal(JSON.stringify(config.data), before);
});

test('保存单个来源代理校验来源与代理存在性', () => {
    const config = memoryConfig({
        network: { webProxies: [{ id: 'p1', name: '公司代理', url: 'http://127.0.0.1:7890' }] },
        media: { providerProxy: {} }
    });
    const settings = createWebProxySettings({ get: config.get, set: config.set, listSources: () => [] });
    assert.throws(() => settings.setProvider({ sourceId: 'Bad ID', proxyId: 'p1' }), /媒体源标识不合法/);
    assert.throws(() => settings.setProvider({ sourceId: 'bilibili', proxyId: 'missing' }), /所选代理不存在，请先保存代理列表/);
    settings.setProvider({ sourceId: 'bilibili', proxyId: 'p1' });
    assert.equal(config.data.media.providerProxy.bilibili, 'p1');
    settings.setProvider({ sourceId: 'bilibili', proxyId: '' });
    assert.equal(config.data.media.providerProxy.bilibili, '');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/web-proxy-settings.test.js`
Expected: FAIL，提示找不到模块 `web-proxy-settings`。

- [ ] **Step 3: 创建 `web-proxy-settings.js`**

```js
'use strict';
const crypto = require('node:crypto');
const {
    normalizeProxyUrl, normalizeWebProxyList, migrateLegacyProxyConfig,
    MAX_PROXIES
} = require('./web-proxy');

const SOURCE_ID_PATTERN = /^(bilibili|[a-z][a-z0-9._-]{1,63})$/;
const NAME_MAX_LENGTH = 30;

// 旧配置只迁移一次：已有 network.webProxies 数组时直接跳过，保证幂等。
function ensureWebProxyMigration({ get, set }) {
    if (Array.isArray(get('network.webProxies', undefined))) return false;
    const migrated = migrateLegacyProxyConfig({
        globalProxy: get('network.globalWebProxy', ''),
        switches: get('media.providerProxy', {}) || {}
    });
    set('network.webProxies', migrated.proxies);
    set('media.providerProxy', migrated.selections);
    // 配置服务没有删除接口，置空避免残留可被误读的旧全局代理。
    set('network.globalWebProxy', '');
    return true;
}

function createWebProxySettings({ get, set, listSources = () => [], generateId }) {
    const makeId = generateId || (() => `proxy-${crypto.randomBytes(4).toString('hex')}`);
    const readProxies = () => normalizeWebProxyList(get('network.webProxies', []));
    const readSelections = () => {
        const value = get('media.providerProxy', {});
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    };

    // 控制端需要的权威快照：代理表、来源选择，以及服务端解析后的 proxyId。
    function snapshot() {
        const webProxies = readProxies();
        const providerProxy = readSelections();
        const sources = listSources().map(source => ({
            id: source.id,
            name: source.name || source.id,
            region: source.region === 'overseas' ? 'overseas' : 'domestic',
            proxyId: typeof providerProxy[source.id] === 'string' ? providerProxy[source.id] : ''
        }));
        return { type: 'webProxyConfig', webProxies, providerProxy, sources };
    }

    // 客户端 id 只用于匹配旧项；新增项一律由服务端生成，重复 id 也重新生成。
    function setList(payload = {}) {
        const input = Array.isArray(payload.webProxies) ? payload.webProxies : null;
        if (!input || input.length > MAX_PROXIES) throw new Error('代理数量超出限制（最多 20 个）');
        const currentIds = new Set(readProxies().map(proxy => proxy.id));
        const usedIds = new Set();
        const next = input.map(item => {
            const name = typeof item?.name === 'string' ? item.name.trim() : '';
            if (!name || name.length > NAME_MAX_LENGTH) throw new Error('代理名称不能为空且不能超过 30 个字符');
            let url = '';
            try { url = normalizeProxyUrl(item?.url); } catch { url = ''; }
            if (!url) throw new Error('代理地址格式不正确，仅支持 http/https/socks/socks5/socks5h');
            let id = typeof item?.id === 'string' && currentIds.has(item.id) && !usedIds.has(item.id)
                ? item.id
                : makeId();
            while (usedIds.has(id)) id = makeId();
            usedIds.add(id);
            return { id, name, url };
        });
        if (!set('network.webProxies', next)) throw new Error('代理配置保存失败');
        const validIds = new Set(next.map(proxy => proxy.id));
        const selections = {};
        for (const [sourceId, proxyId] of Object.entries(readSelections())) {
            selections[sourceId] = typeof proxyId === 'string' && validIds.has(proxyId) ? proxyId : '';
        }
        if (!set('media.providerProxy', selections)) throw new Error('代理选择保存失败');
        return snapshot();
    }

    function setProvider(payload = {}) {
        const sourceId = typeof payload.sourceId === 'string' ? payload.sourceId : '';
        if (!SOURCE_ID_PATTERN.test(sourceId)) throw new Error('媒体源标识不合法');
        const proxyId = typeof payload.proxyId === 'string' ? payload.proxyId : '';
        if (proxyId && !readProxies().some(proxy => proxy.id === proxyId)) {
            throw new Error('所选代理不存在，请先保存代理列表');
        }
        const selections = { ...readSelections(), [sourceId]: proxyId };
        if (!set('media.providerProxy', selections)) throw new Error('媒体源代理设置保存失败');
        return snapshot();
    }

    return { snapshot, setList, setProvider };
}

module.exports = { ensureWebProxyMigration, createWebProxySettings };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/web-proxy-settings.test.js`
Expected: `# tests 8` / `# pass 8` / `# fail 0`。

- [ ] **Step 5: 接线 `server-app.js`**

按以下锚点修改。

5a. 导入（第 109 行附近）：

```js
const { resolveSourceProxyUrl } = require('../modules/media/web-proxy');
const { ensureWebProxyMigration, createWebProxySettings } = require('../modules/media/web-proxy-settings');
```

5b. `config.loadConfig();` 之后立即迁移：

```js
config.loadConfig();
ensureWebProxyMigration({
    get: (key, fallback) => config.get(key, fallback),
    set: (key, value) => config.set(key, value)
});
```

5c. `mediaLibraryManager` 定义之后，把旧的 `getSourceProxyUrl` 替换为：

```js
// 统一解析任务媒体源最终使用的代理地址；读取路径对损坏配置降级为不使用代理。
function getSourceProxyUrl(sourceId) {
    return resolveSourceProxyUrl({
        proxies: config.get('network.webProxies', []) || [],
        selections: config.get('media.providerProxy', {}) || {},
        sourceId
    });
}
```

5d. 在 `getSourceProxyUrl` 之后新增服务实例，并用以下实现替换现有 `getWebProxyConfig()`（约 987 行）：

```js
// 代理设置服务集中校验、持久化并广播权威快照。
const webProxySettings = createWebProxySettings({
    get: (key, fallback) => config.get(key, fallback),
    set: (key, value) => config.set(key, value),
    listSources: () => [
        { id: 'bilibili', name: 'B 站视频', region: 'domestic' },
        ...mediaLibraryManager.listTaskMediaSources().map(source => ({
            id: source.id,
            name: source.name,
            region: source.region
        }))
    ]
});

function getWebProxyConfig() {
    return webProxySettings.snapshot();
}
```

5e. WS 处理（约 10178-10199 行）替换 `setGlobalWebProxy` 与 `setProviderProxy` 分支：

```js
    if (data.type === 'setWebProxyList') {
        try {
            webProxySettings.setList({ webProxies: data.webProxies });
            broadcastToControls(getWebProxyConfig());
        } catch (error) {
            ws.send(JSON.stringify({ type: 'webProxyConfigError', message: error.message }));
        }
        return;
    }
    if (data.type === 'setProviderProxy') {
        try {
            webProxySettings.setProvider({ sourceId: data.sourceId, proxyId: data.proxyId });
            broadcastToControls(getWebProxyConfig());
        } catch (error) {
            ws.send(JSON.stringify({ type: 'webProxyConfigError', message: error.message }));
        }
        return;
    }
```

5f. 控制端允许消息列表（约 1610 行）把 `'setGlobalWebProxy'` 替换为 `'setWebProxyList'`，保留 `'getWebProxyConfig', 'setProviderProxy'`。

- [ ] **Step 6: 静态检查**

Run: `node --check src/apps/server/modules/media/web-proxy-settings.js && node --check src/apps/server/boot/server-app.js`
Expected: 无输出，退出码 0。

- [ ] **Step 7: 回归代理相关测试**

Run: `node --test tests/web-proxy.test.js tests/web-proxy-settings.test.js tests/media-library-app-service.test.js`
Expected: 全部通过，0 fail。

- [ ] **Step 8: 记录结果（不提交 git）**

---

### Task 3: 控制端代理列表与来源下拉框

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/upload.html`（代理设置区、B 站代理控件、Settings 初始化）
- Modify: `src/apps/web-mediacenter/ui/public/js/media-library.js`（代理状态、列表编辑器、任务源下拉框）
- Modify: `src/apps/web-mediacenter/ui/public/js/websocket.js`（仅保留 MediaLibrary 分发）
- Modify: `src/apps/web-mediacenter/ui/public/css/media-library.css`
- Create: `tests/web-proxy-ui-browser.test.js`

**Interfaces:**
- Consumes: Task 2 的 `webProxyConfig` 消息 `{ webProxies, providerProxy, sources }`；`setWebProxyList { webProxies }`；`setProviderProxy { sourceId, proxyId }`。
- Produces（浏览器全局 `MediaLibrary` 方法）：
  - `handleWebProxyConfig(data)`
  - `setProviderProxy(sourceId, proxyId)`
  - `fillProxySelect(select, proxies, proxyId)`
  - `renderWebProxyList(proxies)`
  - `addWebProxyRow()`
  - `saveWebProxyList()`

- [ ] **Step 1: 写失败浏览器测试 `tests/web-proxy-ui-browser.test.js`**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');

test('代理列表编辑、B 站下拉框与任务源下拉框使用服务端权威配置', async t => {
    if (!fs.existsSync('/usr/bin/chromium')) return t.skip('Chromium 不可用');
    const root = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
    const html = fs.readFileSync(path.join(root, 'upload.html'), 'utf8');
    const $ = cheerio.load(html);
    assert.equal($('#bilibiliProxyToggle').length, 0);
    assert.equal($('#bilibiliProxySelect').length, 1);
    assert.equal($('#webProxyList').length, 1);
    assert.equal($('#webProxyAddBtn').length, 1);
    assert.equal($('#webProxySaveBtn').length, 1);

    const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent(`
        <div id="webProxyList"></div>
        <button id="webProxyAddBtn" type="button"></button>
        <button id="webProxySaveBtn" type="button"></button>
        <select id="bilibiliProxySelect" data-provider-proxy="bilibili"></select>
        <span id="domesticMediaTabs"></span>
        <span id="overseasMediaTabs"></span>
        <div id="mediaLibraryContent"></div>
    `);
    await page.addScriptTag({ path: path.join(root, 'js/media-library.js') });
    await page.evaluate(() => {
        window.showToast = () => {};
        window.sent = [];
        window.WebSocketManager = { send: message => window.sent.push(message) };
        MediaLibrary.handleTaskMediaSources({
            providers: [
                { id: 'hongguo', name: '红果短剧', libraryId: 'task-auto:hongguo', region: 'domestic' },
                { id: 'youtube', name: 'YouTube', libraryId: 'task-auto:youtube', region: 'overseas' }
            ]
        });
        MediaLibrary.handleWebProxyConfig({
            webProxies: [{ id: 'p1', name: '公司代理', url: 'http://127.0.0.1:7890' }],
            providerProxy: { bilibili: 'p1', hongguo: 'p1', youtube: '' },
            sources: [
                { id: 'bilibili', name: 'B 站视频', region: 'domestic', proxyId: 'p1' },
                { id: 'hongguo', name: '红果短剧', region: 'domestic', proxyId: 'p1' },
                { id: 'youtube', name: 'YouTube', region: 'overseas', proxyId: '' }
            ]
        });
    });

    assert.equal(await page.$$eval('#webProxyList [data-proxy-row]', nodes => nodes.length), 1);
    assert.equal(await page.$eval('#webProxyList [data-proxy-name]', node => node.value), '公司代理');
    assert.equal(await page.$eval('#webProxyList [data-proxy-url]', node => node.value), 'http://127.0.0.1:7890');
    assert.equal(await page.$eval('#bilibiliProxySelect', node => node.value), 'p1');
    assert.equal(await page.$$eval('#bilibiliProxySelect option', nodes => nodes.map(node => node.textContent).join(',')), '不使用代理,公司代理');
    assert.equal(await page.$eval('[data-task-media-proxy="hongguo"]', node => node.tagName), 'SELECT');
    assert.equal(await page.$eval('[data-task-media-proxy="hongguo"]', node => node.value), 'p1');
    assert.equal(await page.$eval('[data-task-media-proxy="youtube"]', node => node.value), '');

    await page.select('[data-task-media-proxy="hongguo"]', '');
    assert.deepEqual(await page.evaluate(() => window.sent.at(-1)), {
        type: 'setProviderProxy', sourceId: 'hongguo', proxyId: ''
    });

    await page.evaluate(() => MediaLibrary.addWebProxyRow());
    await page.evaluate(() => {
        const rows = document.querySelectorAll('#webProxyList [data-proxy-row]');
        const row = rows[rows.length - 1];
        row.querySelector('[data-proxy-name]').value = '备用代理';
        row.querySelector('[data-proxy-url]').value = 'socks5://127.0.0.1:1080';
        MediaLibrary.saveWebProxyList();
    });
    const saved = await page.evaluate(() => window.sent.at(-1));
    assert.equal(saved.type, 'setWebProxyList');
    assert.equal(saved.webProxies.length, 2);
    assert.equal(saved.webProxies[0].id, 'p1');
    assert.equal(saved.webProxies[1].name, '备用代理');

    await page.evaluate(() => MediaLibrary.handleWebProxyConfig({
        webProxies: [], providerProxy: { bilibili: '' }, sources: [{ id: 'bilibili', proxyId: '' }]
    }));
    assert.equal(await page.$eval('#bilibiliProxySelect', node => node.value), '');
    assert.equal(await page.$$eval('#webProxyList [data-proxy-row]', nodes => nodes.length), 0);
    assert.equal(await page.$eval('[data-task-media-proxy="hongguo"]', node => node.value), '');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/web-proxy-ui-browser.test.js`
Expected: FAIL，`#bilibiliProxySelect` 数量为 0 或 `#webProxyList` 不存在。

- [ ] **Step 3: 修改 `upload.html`**

3a. 把 B 站“使用代理”复选框（第 160 行）替换为：

```html
<label class="media-source-proxy">代理 <select id="bilibiliProxySelect" data-provider-proxy="bilibili"></select></label>
```

3b. 把“网络代理”小节（约 897-906 行）替换为：

```html
            <div class="section">
                <h2>网络代理</h2>
                <div class="control-item">
                    <label>代理列表</label>
                    <div id="webProxyList" class="web-proxy-list"></div>
                    <div class="control-buttons">
                        <button class="control-btn" id="webProxyAddBtn" type="button">添加代理</button>
                        <button class="control-btn" id="webProxySaveBtn" type="button">保存代理列表</button>
                    </div>
                    <div class="routing-hint">每个媒体源在页签旁选择使用的代理；删除代理后引用它的来源会回到“不使用代理”。代理仅由服务端使用。</div>
                </div>
            </div>
```

3c. 删除 `Settings.init()` 中的 `globalWebProxySaveBtn` 监听与 `getWebProxyConfig` 发送（代理 UI 已由 `MediaLibrary` 接管），使 `init()` 开头为：

```js
        init() {
            this.updateUI();
            this.loadRouting();
        },
```

3d. 删除 `Settings.saveGlobalWebProxy()` 与 `Settings.applyWebProxyConfig()` 两个方法。

- [ ] **Step 4: 修改 `websocket.js`**

把 `webProxyConfig` 处理改为：

```js
    // 代理配置驱动设置面板代理列表、B 站下拉框与任务页签下拉框。
    webProxyConfig: data => window.MediaLibrary?.handleWebProxyConfig?.(data),
```

- [ ] **Step 5: 修改 `media-library.js`**

5a. 在 `init()` 中、`void this.refreshTaskMediaSources();` 之前加入：

```js
        // 代理设置面板由 MediaLibrary 统一渲染，保证列表与来源下拉框使用同一份权威快照。
        document.getElementById('webProxyAddBtn')?.addEventListener('click', () => this.addWebProxyRow());
        document.getElementById('webProxySaveBtn')?.addEventListener('click', () => this.saveWebProxyList());
        document.getElementById('bilibiliProxySelect')?.addEventListener('change', event => {
            this.setProviderProxy('bilibili', event.target.value);
        });
```

5b. 替换 `handleWebProxyConfig()`、`toggleProviderProxy()` 与 `renderTaskMediaTabs()`（约 816-866 行）为以下实现，并新增代理列表方法：

```js
    // 接收服务端代理配置：重绘代理列表、B 站下拉框与任务页签下拉框。
    handleWebProxyConfig(data) {
        this.webProxyConfig = data && typeof data === 'object' ? data : {};
        this.renderWebProxyList(this.webProxyConfig.webProxies || []);
        const sources = Array.isArray(this.webProxyConfig.sources) ? this.webProxyConfig.sources : [];
        const selects = document.querySelectorAll('[data-provider-proxy]:not([data-task-media-proxy])');
        for (const select of selects) {
            const source = sources.find(item => item.id === select.dataset.providerProxy);
            this.fillProxySelect(select, this.webProxyConfig.webProxies || [], source?.proxyId || '');
        }
        this.renderTaskMediaTabs();
    },
    // 单个来源的代理选择变更即提交服务端，广播回来后按权威结果重绘。
    setProviderProxy(sourceId, proxyId) {
        window.WebSocketManager?.send({ type: 'setProviderProxy', sourceId, proxyId });
    },
    // 下拉框第一项固定“不使用代理”；只保留服务端存在的代理 id。
    fillProxySelect(select, proxies, proxyId) {
        if (!select) return;
        select.replaceChildren();
        const none = document.createElement('option');
        none.value = '';
        none.textContent = '不使用代理';
        select.appendChild(none);
        for (const proxy of proxies || []) {
            const option = document.createElement('option');
            option.value = proxy.id;
            option.textContent = proxy.name;
            select.appendChild(option);
        }
        const valid = (proxies || []).some(proxy => proxy.id === proxyId);
        select.value = valid ? proxyId : '';
    },
    // 整表重绘会丢弃未保存编辑，这是服务端广播后的预期行为。
    renderWebProxyList(proxies) {
        const list = document.getElementById('webProxyList');
        if (!list) return;
        list.replaceChildren(...(proxies || []).map(proxy => this.createWebProxyRow(proxy)));
    },
    createWebProxyRow(proxy = {}) {
        const row = document.createElement('div');
        row.className = 'web-proxy-row';
        row.dataset.proxyRow = '';
        if (proxy.id) row.dataset.proxyId = proxy.id;
        const name = document.createElement('input');
        name.type = 'text';
        name.maxLength = 30;
        name.placeholder = '名称（如：公司代理）';
        name.dataset.proxyName = '';
        name.value = proxy.name || '';
        const url = document.createElement('input');
        url.type = 'text';
        url.placeholder = 'http://127.0.0.1:7890 或 socks5://127.0.0.1:1080';
        url.dataset.proxyUrl = '';
        url.value = proxy.url || '';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '删除';
        remove.dataset.proxyRemove = '';
        remove.onclick = () => row.remove();
        row.append(name, url, remove);
        return row;
    },
    addWebProxyRow() {
        const list = document.getElementById('webProxyList');
        if (!list) return;
        if (list.querySelectorAll('[data-proxy-row]').length >= 20) {
            showToast('代理数量超出限制（最多 20 个）', 'error');
            return;
        }
        list.appendChild(this.createWebProxyRow());
    },
    // 保存整表；新增行不带 id，由服务端生成，已有行按 data-proxy-id 匹配。
    saveWebProxyList() {
        const rows = [...document.querySelectorAll('#webProxyList [data-proxy-row]')];
        const webProxies = rows.map(row => ({
            ...(row.dataset.proxyId ? { id: row.dataset.proxyId } : {}),
            name: row.querySelector('[data-proxy-name]')?.value || '',
            url: row.querySelector('[data-proxy-url]')?.value || ''
        }));
        window.WebSocketManager?.send({ type: 'setWebProxyList', webProxies });
    },
    renderTaskMediaTabs() {
        // 先清理旧节点，避免任务源变化后残留页签或代理下拉框。
        document.querySelectorAll('.media-task-source-wrap').forEach(node => node.remove());
        document.querySelectorAll('[data-task-media-source]').forEach(node => node.remove());
        const groups = { domestic: document.getElementById('domesticMediaTabs'), overseas: document.getElementById('overseasMediaTabs') };
        if (!groups.domestic || !groups.overseas) return;
        groups.domestic.replaceChildren(); groups.overseas.replaceChildren();
        for (const source of this.taskMediaSources || []) {
            const host = groups[source.region === 'overseas' ? 'overseas' : 'domestic'];
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'media-library-tab media-task-source';
            tab.dataset.taskMediaSource = source.id;
            tab.textContent = source.name || source.id;
            tab.classList.toggle('active', this.activeTab === 'task' && this.activeTaskSourceId === source.id);
            tab.onclick = () => this.switchTaskMediaSource(source.id);

            const select = document.createElement('select');
            select.className = 'media-task-proxy-select';
            select.dataset.providerProxy = source.id;
            // data-task-media-proxy 仅作为设置面板批量同步时的排除标记，不再表示开关状态。
            select.dataset.taskMediaProxy = source.id;
            this.fillProxySelect(
                select,
                this.webProxyConfig?.webProxies || [],
                this.webProxyConfig?.providerProxy?.[source.id] || ''
            );
            select.onchange = () => this.setProviderProxy(source.id, select.value);

            const wrap = document.createElement('span');
            wrap.className = 'media-task-source-wrap';
            wrap.append(tab, select);
            host.appendChild(wrap);
        }
    },
```

5c. 确保 `renderTabs()` 仍调用 `renderTaskMediaTabs()`（现有行为不变）。

- [ ] **Step 6: 修改 `media-library.css`**

在既有 `.media-task-source-wrap` 规则之后追加：

```css
.web-proxy-list { display: flex; flex-direction: column; gap: 8px; margin: 8px 0; }
.web-proxy-row { display: flex; gap: 8px; flex-wrap: wrap; }
.web-proxy-row input { flex: 1 1 160px; min-width: 0; padding: 8px; border-radius: 6px; border: 1px solid rgba(128, 128, 128, .5); background: rgba(255, 255, 255, .05); color: #fff; }
.web-proxy-row button { flex: 0 0 auto; }
.media-source-proxy select { max-width: 170px; padding: 4px 6px; border-radius: 6px; border: 1px solid rgba(128, 128, 128, .5); background: rgba(255, 255, 255, .08); color: #fff; }
.media-task-proxy-select { max-width: 150px; font-size: 12px; padding: 2px 4px; border-radius: 6px; border: 1px solid rgba(128, 128, 128, .5); background: rgba(255, 255, 255, .08); color: #fff; }
```

- [ ] **Step 7: 运行测试**

Run: `node --check src/apps/web-mediacenter/ui/public/js/media-library.js && node --test tests/web-proxy-ui-browser.test.js`
Expected: 语法检查通过；浏览器测试 `1 pass / 0 fail`（无 Chromium 时 skip）。

- [ ] **Step 8: 回归既有任务页签测试**

Run: `node --test tests/task-media-tab-browser.test.js`
Expected: 1 pass。该测试只断言任务按钮数量与切换，不依赖代理复选框；如果它按旧结构查找 `input`，改为查找 `[data-task-media-source]` 与 select（不要放宽断言）。

- [ ] **Step 9: 记录结果（不提交 git）**

---

### Task 4: 显示端本机媒体库 API

**Files:**
- Create: `src/apps/server/modules/media/display-local-media.js`
- Create: `tests/display-local-media.test.js`
- Modify: `src/apps/server/boot/server-app.js`（挂载路由）

**Interfaces:**
- Consumes: `MediaLibraryManager.listLibraries()`、`listTaskMediaSources()`、`list(libraryId, path)`。
- Produces:
  - `isLoopbackAddress(address) -> boolean`
  - `listDisplayLibraries(manager) -> [{ id, name, type, readonly?, taskId?, region? }]`
  - `normalizeDisplayEntries(items, { isHttps }) -> [{ name, path, type, mediaType?, directUrl?, proxyUrl? }]`
  - `createDisplayLocalRouter({ mediaLibraryManager, isHttps, getRemoteAddress }) -> express.Router`

- [ ] **Step 1: 写失败测试 `tests/display-local-media.test.js`**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
    isLoopbackAddress, listDisplayLibraries, normalizeDisplayEntries, createDisplayLocalRouter
} = require('../src/apps/server/modules/media/display-local-media');

test('回环地址判定覆盖 IPv4、IPv6 与 IPv4 映射形式', () => {
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1']) {
        assert.equal(isLoopbackAddress(address), true, address);
    }
    for (const address of ['192.168.1.10', '::ffff:192.168.1.10', '', null, undefined]) {
        assert.equal(isLoopbackAddress(address), false, String(address));
    }
});

test('显示端媒体库列表只包含本地库与活动任务源', () => {
    const manager = {
        listLibraries: () => [
            { id: 'local1', name: '上传', type: 'local', readonly: false },
            { id: 'smb1', name: 'NAS', type: 'smb', readonly: true },
            { id: 'quark1', name: '夸克分享', type: 'quark', readonly: true },
            { id: 'task1', name: '旧任务库', type: 'task', readonly: true }
        ],
        listTaskMediaSources: () => [
            { id: 'hongguo', name: '红果短剧', libraryId: 'task-auto:hongguo', region: 'domestic' },
            { id: 'youtube', name: 'YouTube', libraryId: 'task-auto:youtube', region: 'overseas' }
        ]
    };
    assert.deepEqual(listDisplayLibraries(manager), [
        { id: 'local1', name: '上传', type: 'local', readonly: false },
        { id: 'smb1', name: 'NAS', type: 'smb', readonly: true },
        { id: 'task-auto:hongguo', name: '红果短剧', type: 'task', taskId: 'hongguo', region: 'domestic' },
        { id: 'task-auto:youtube', name: 'YouTube', type: 'task', taskId: 'youtube', region: 'overseas' }
    ]);
});

test('目录条目只保留目录与可播放文件，HTTPS 下绝对 http 地址生成代理地址', () => {
    const entries = normalizeDisplayEntries([
        { name: '合集', path: '/合集', type: 'folder' },
        { name: 'a.mp4', path: '/合集/a.mp4', type: 'file', mediaType: 'video', url: 'http://192.168.1.12:8081/api/media-libraries/l/proxy/a.mp4' },
        { name: 'b.gif', path: '/合集/b.gif', type: 'file', mediaType: 'gif', url: '/uploads/b.gif' },
        { name: 'c.html', path: '/合集/c.html', type: 'file', mediaType: 'html', url: '/uploads/c.html' },
        { name: 'd.txt', path: '/合集/d.txt', type: 'file', mediaType: 'text', url: '/uploads/d.txt' }
    ], { isHttps: true });
    assert.deepEqual(entries.map(item => item.path), ['/合集', '/合集/a.mp4', '/合集/b.gif', '/合集/d.txt']);
    assert.deepEqual(entries[1], {
        name: 'a.mp4', path: '/合集/a.mp4', type: 'file', mediaType: 'video',
        directUrl: 'http://192.168.1.12:8081/api/media-libraries/l/proxy/a.mp4',
        proxyUrl: '/api/media-proxy?url=' + encodeURIComponent('http://192.168.1.12:8081/api/media-libraries/l/proxy/a.mp4')
    });
    assert.equal(entries[2].mediaType, 'image');
    assert.equal(entries[2].proxyUrl, '');
    assert.equal(entries[3].proxyUrl, '');
});

test('非回环访问 /api/display-local 一律 403', async t => {
    const app = express();
    app.use('/api/display-local', createDisplayLocalRouter({
        mediaLibraryManager: { listLibraries: () => [], listTaskMediaSources: () => [], list: async () => [] },
        isHttps: () => false,
        getRemoteAddress: () => '192.168.1.20'
    }));
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const url = `http://127.0.0.1:${server.address().port}/api/display-local/libraries`;
    const response = await fetch(url);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: '仅限本机访问' });
});

test('回环访问返回库列表、目录条目与上级路径', async t => {
    const manager = {
        listLibraries: () => [{ id: 'local1', name: '上传', type: 'local', readonly: false }],
        listTaskMediaSources: () => [],
        list: async (libraryId, dirPath) => {
            assert.equal(libraryId, 'local1');
            assert.equal(dirPath, '/电影');
            return [
                { name: '合集A', path: '/电影/合集A', type: 'folder' },
                { name: 'a.mp4', path: '/电影/a.mp4', type: 'file', mediaType: 'video', url: '/uploads/a.mp4' }
            ];
        }
    };
    const app = express();
    app.use('/api/display-local', createDisplayLocalRouter({
        mediaLibraryManager: manager,
        isHttps: () => false,
        getRemoteAddress: () => '::1'
    }));
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const base = `http://127.0.0.1:${server.address().port}/api/display-local`;
    const libraries = await (await fetch(`${base}/libraries`)).json();
    assert.deepEqual(libraries.libraries, [{ id: 'local1', name: '上传', type: 'local', readonly: false }]);
    const listing = await (await fetch(`${base}/list?libraryId=local1&path=${encodeURIComponent('/电影')}`)).json();
    assert.equal(listing.path, '/电影');
    assert.equal(listing.parent, '/');
    assert.deepEqual(listing.entries.map(item => item.type), ['directory', 'file']);
    const missing = await fetch(`${base}/list?libraryId=missing&path=/`);
    assert.equal(missing.status, 400);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/display-local-media.test.js`
Expected: FAIL，找不到模块 `display-local-media`。

- [ ] **Step 3: 创建 `display-local-media.js`**

```js
'use strict';
const express = require('express');

const LOCAL_LIBRARY_TYPES = new Set(['local', 'smb', 'http', 'android-saf']);
const PLAYABLE_MEDIA_TYPES = new Set(['image', 'gif', 'video', 'audio', 'text']);
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1']);

function isLoopbackAddress(address) {
    return typeof address === 'string' && LOOPBACK_ADDRESSES.has(address);
}

// 显示端只读列表：本地库在前，活动任务源在后；夸克与已保存的 task 库不展示。
function listDisplayLibraries(manager) {
    const local = manager.listLibraries()
        .filter(library => LOCAL_LIBRARY_TYPES.has(library.type))
        .map(library => ({
            id: library.id,
            name: library.name,
            type: library.type,
            readonly: library.readonly === true
        }));
    const tasks = manager.listTaskMediaSources().map(source => ({
        id: source.libraryId,
        name: source.name,
        type: 'task',
        taskId: source.id,
        region: source.region === 'overseas' ? 'overseas' : 'domestic'
    }));
    return [...local, ...tasks];
}

function parentPath(value) {
    const path = String(value || '/');
    if (path === '/' || !path.startsWith('/')) return '/';
    const index = path.lastIndexOf('/');
    return index <= 0 ? '/' : path.slice(0, index);
}

// 绝对 http 地址在 HTTPS 页面会被混合内容拦截，提供同源代理地址；本地相对地址直接用。
function displayUrls(item, isHttps) {
    const directUrl = typeof item.url === 'string' ? item.url : '';
    if (!directUrl) return { directUrl: '', proxyUrl: '' };
    const needsProxy = isHttps && /^http:\/\//i.test(directUrl);
    return {
        directUrl,
        proxyUrl: needsProxy ? `/api/media-proxy?url=${encodeURIComponent(directUrl)}` : ''
    };
}

function normalizeDisplayEntries(items, { isHttps = false } = {}) {
    const entries = [];
    for (const item of Array.isArray(items) ? items : []) {
        if (!item || typeof item.path !== 'string') continue;
        if (item.type === 'folder' || item.type === 'directory') {
            entries.push({ name: item.name, path: item.path, type: 'directory' });
            continue;
        }
        if (!PLAYABLE_MEDIA_TYPES.has(item.mediaType)) continue;
        const urls = displayUrls(item, isHttps);
        entries.push({
            name: item.name,
            path: item.path,
            type: 'file',
            // GIF 归一化为 image，与显示端 showMedia 的图片分支一致。
            mediaType: item.mediaType === 'gif' ? 'image' : item.mediaType,
            directUrl: urls.directUrl,
            proxyUrl: urls.proxyUrl
        });
    }
    return entries;
}

function createDisplayLocalRouter({
    mediaLibraryManager,
    isHttps = () => false,
    getRemoteAddress = req => req.socket.remoteAddress
}) {
    const router = express.Router();
    router.use((req, res, next) => {
        if (!isLoopbackAddress(getRemoteAddress(req))) {
            res.status(403).json({ error: '仅限本机访问' });
            return;
        }
        next();
    });
    router.get('/libraries', (req, res) => {
        try {
            res.json({ libraries: listDisplayLibraries(mediaLibraryManager) });
        } catch (error) {
            res.status(500).json({ error: '媒体库加载失败，请稍后重试' });
        }
    });
    router.get('/list', async (req, res) => {
        try {
            const libraryId = String(req.query.libraryId || '');
            const dirPath = typeof req.query.path === 'string' ? req.query.path : '/';
            const allowed = listDisplayLibraries(mediaLibraryManager).some(library => library.id === libraryId);
            if (!allowed) {
                res.status(400).json({ error: '媒体库不存在' });
                return;
            }
            const items = await mediaLibraryManager.list(libraryId, dirPath);
            res.json({
                path: dirPath,
                parent: parentPath(dirPath),
                entries: normalizeDisplayEntries(items, { isHttps: isHttps() })
            });
        } catch (error) {
            res.status(500).json({ error: '媒体库加载失败，请稍后重试' });
        }
    });
    return router;
}

module.exports = {
    isLoopbackAddress, listDisplayLibraries, normalizeDisplayEntries, createDisplayLocalRouter
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/display-local-media.test.js`
Expected: `# tests 5` / `# pass 5` / `# fail 0`。

- [ ] **Step 5: 挂载路由**

在 `server-app.js` 顶部导入（与其它 media 模块导入放在一起）：

```js
const { createDisplayLocalRouter } = require('../modules/media/display-local-media');
```

在 `mediaLibraryManager` 定义之后（约 990 行、`getSourceProxyUrl` 之前或之后均可）挂载：

```js
// 显示端媒体库仅对本机回环连接开放，路由内部还有第二道回环校验。
app.use('/api/display-local', createDisplayLocalRouter({
    mediaLibraryManager,
    isHttps: () => useHttps
}));
```

- [ ] **Step 6: 静态检查**

Run: `node --check src/apps/server/modules/media/display-local-media.js && node --check src/apps/server/boot/server-app.js`
Expected: 退出码 0。

- [ ] **Step 7: 记录结果（不提交 git）**

---

### Task 5: 显示端批量播放 WS 消息

**Files:**
- Modify: `src/apps/server/modules/media/display-local-media.js`（新增机器人可测的 handler 与 `buildDisplayPlaylistStart`）
- Create: `tests/display-playlist-request.test.js`
- Modify: `src/apps/server/boot/server-app.js`（显示端允许消息、handler 注册与分支）

**Interfaces:**
- Consumes: Task 4 的 `isLoopbackAddress`；现有 `playlistManager.buildFromLibrary`、`displayClients`、`persistDisplayState`、`sendToDisplay`。
- Produces:
  - `buildDisplayPlaylistStart({ playlist, displayId }) -> startData`
  - `createDisplayPlaylistRequestHandler({ buildPlaylist, getDisplayData, persist, sendToDisplay }) -> async (displayId, data, ws) => void`

- [ ] **Step 1: 写失败测试 `tests/display-playlist-request.test.js`**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    buildDisplayPlaylistStart, createDisplayPlaylistRequestHandler
} = require('../src/apps/server/modules/media/display-local-media');

function createWs(address) {
    return {
        _socket: { remoteAddress: address },
        sent: [],
        send(payload) { this.sent.push(JSON.parse(payload)); }
    };
}

test('批量播放开始数据固定不循环、不递归、只发给请求方', () => {
    const startData = buildDisplayPlaylistStart({
        playlist: [{ url: '/a.mp4', fileName: 'a.mp4', mediaType: 'video' }],
        displayId: 'display-1'
    });
    assert.match(startData.listId, /^pl-\d+-[a-z0-9]+$/);
    assert.equal(startData.loop, false);
    assert.equal(startData.interval, 5);
    assert.equal(startData.announceName, false);
    assert.deepEqual(startData.selectedDisplayIds, ['display-1']);
    assert.deepEqual(startData.selectedVoiceDisplayIds, []);
    assert.deepEqual(startData.voiceRouteByDisplayId, {});
});

test('非回环连接被拒绝且不生成列表', async () => {
    const ws = createWs('192.168.1.20');
    let built = 0;
    const handler = createDisplayPlaylistRequestHandler({
        buildPlaylist: async () => { built++; return []; },
        getDisplayData: () => ({ state: {}, ws }),
        persist: () => {},
        sendToDisplay: () => {}
    });
    await handler('display-1', { libraryId: 'local1', path: '/' }, ws);
    assert.equal(built, 0);
    assert.deepEqual(ws.sent, [{ type: 'displayPlaylistError', message: '仅限本机使用' }]);
});

test('回环连接生成列表、持久化状态并只发送给请求方', async () => {
    const ws = createWs('::ffff:7f00:1');
    const displayData = { state: {}, ws };
    const sent = [];
    const persisted = [];
    const handler = createDisplayPlaylistRequestHandler({
        buildPlaylist: async (libraryId, dirPath) => {
            assert.equal(libraryId, 'local1');
            assert.equal(dirPath, '/电影/合集A');
            return [{ url: '/a.mp4', path: '/电影/合集A/a.mp4', fileName: 'a.mp4', mediaType: 'video' }];
        },
        getDisplayData: () => displayData,
        persist: (data, partial) => persisted.push(partial),
        sendToDisplay: (displayId, message) => sent.push({ displayId, message })
    });
    await handler('display-1', { libraryId: 'local1', path: '/电影/合集A' }, ws);
    assert.equal(ws.sent.length, 0);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].displayId, 'display-1');
    assert.equal(sent[0].message.type, 'playlistStart');
    assert.equal(sent[0].message.loop, false);
    assert.equal(sent[0].message.playlist.length, 1);
    assert.equal(displayData.state.currentPlaylist.index, 0);
    assert.equal(displayData.state.currentPlaylist.startData.listId, sent[0].message.listId);
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].currentPlaylist.startData.playlist.length, 1);
});

test('空目录返回错误且不发送空列表', async () => {
    const ws = createWs('127.0.0.1');
    const sent = [];
    const handler = createDisplayPlaylistRequestHandler({
        buildPlaylist: async () => [],
        getDisplayData: () => ({ state: {}, ws }),
        persist: () => {},
        sendToDisplay: (...args) => sent.push(args)
    });
    await handler('display-1', { libraryId: 'local1', path: '/空目录' }, ws);
    assert.equal(sent.length, 0);
    assert.deepEqual(ws.sent, [{ type: 'displayPlaylistError', message: '该目录没有可播放的媒体' }]);
});

test('生成列表异常时返回统一错误文案', async () => {
    const ws = createWs('127.0.0.1');
    const handler = createDisplayPlaylistRequestHandler({
        buildPlaylist: async () => { throw new Error('boom'); },
        getDisplayData: () => ({ state: {}, ws }),
        persist: () => {},
        sendToDisplay: () => {}
    });
    await handler('display-1', { libraryId: 'local1', path: '/' }, ws);
    assert.deepEqual(ws.sent, [{ type: 'displayPlaylistError', message: '媒体库加载失败，请稍后重试' }]);
});

test('旧连接或已离线显示端不处理', async () => {
    const ws = createWs('127.0.0.1');
    let built = 0;
    const handler = createDisplayPlaylistRequestHandler({
        buildPlaylist: async () => { built++; return []; },
        getDisplayData: () => ({ state: {}, ws: createWs('127.0.0.1') }),
        persist: () => {},
        sendToDisplay: () => {}
    });
    await handler('display-1', { libraryId: 'local1', path: '/' }, ws);
    assert.equal(built, 0);
    assert.equal(ws.sent.length, 0);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/display-playlist-request.test.js`
Expected: FAIL，`buildDisplayPlaylistStart is not a function`。

- [ ] **Step 3: 扩展 `display-local-media.js`**

在 `module.exports` 之前加入：

```js
// 显示端发起的批量播放固定单层顺序、播完即停，只路由给发起请求的显示端。
function buildDisplayPlaylistStart({ playlist, displayId }) {
    return {
        listId: 'pl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        playlist,
        interval: 5,
        loop: false,
        announceName: false,
        selectedDisplayIds: [displayId],
        selectedVoiceDisplayIds: [],
        voiceRouteByDisplayId: {}
    };
}

function createDisplayPlaylistRequestHandler({ buildPlaylist, getDisplayData, persist, sendToDisplay }) {
    return async function handleDisplayPlaylistRequest(displayId, data, ws) {
        if (!isLoopbackAddress(ws?._socket?.remoteAddress)) {
            ws.send(JSON.stringify({ type: 'displayPlaylistError', message: '仅限本机使用' }));
            return;
        }
        const displayData = getDisplayData(displayId);
        if (!displayData || displayData.ws !== ws) return;
        try {
            const libraryId = String(data.libraryId || '');
            const dirPath = typeof data.path === 'string' ? data.path : '/';
            const playlist = await buildPlaylist(libraryId, dirPath);
            if (!Array.isArray(playlist) || playlist.length === 0) {
                ws.send(JSON.stringify({ type: 'displayPlaylistError', message: '该目录没有可播放的媒体' }));
                return;
            }
            const startData = buildDisplayPlaylistStart({ playlist, displayId });
            const currentPlaylist = {
                startData,
                index: 0,
                state: 'playing',
                currentTime: 0,
                duration: 0,
                currentTextPage: 0,
                currentTextPageTotal: 0,
                currentTextSentence: 0,
                currentTextSentenceTotal: 0,
                currentTextFormat: null,
                temp: false
            };
            displayData.state.currentPlaylist = currentPlaylist;
            displayData.state.currentMediaProgress = null;
            persist(displayData, { currentPlaylist, currentMediaProgress: null });
            sendToDisplay(displayId, { type: 'playlistStart', ...startData, temp: false });
        } catch (error) {
            ws.send(JSON.stringify({ type: 'displayPlaylistError', message: '媒体库加载失败，请稍后重试' }));
        }
    };
}
```

并把导出改为：

```js
module.exports = {
    isLoopbackAddress, listDisplayLibraries, normalizeDisplayEntries, createDisplayLocalRouter,
    buildDisplayPlaylistStart, createDisplayPlaylistRequestHandler
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/display-playlist-request.test.js`
Expected: `# tests 6` / `# pass 6` / `# fail 0`。

- [ ] **Step 5: 接线 `server-app.js`**

5a. 导入改为：

```js
const {
    createDisplayLocalRouter, createDisplayPlaylistRequestHandler
} = require('../modules/media/display-local-media');
```

5b. 在 `playlistManager` 定义之后创建 handler：

```js
// 显示端媒体库批量播放：只接受回环连接，固定单层顺序、不循环。
const handleDisplayPlaylistRequest = createDisplayPlaylistRequestHandler({
    buildPlaylist: (libraryId, dirPath) => playlistManager.buildFromLibrary(libraryId, dirPath, {
        recursive: false,
        mode: 'sequence',
        sortBy: 'name',
        direction: 'asc'
    }),
    getDisplayData: displayId => displayClients.get(displayId),
    persist: persistDisplayState,
    sendToDisplay
});
```

5c. 在 `handleDisplayMessageFallback` 开头（`chatAction` 分支之前）加入：

```js
    if (data.type === 'displayPlaylistRequest') {
        void handleDisplayPlaylistRequest(displayId, data, ws);
        return;
    }
```

5d. 显示端允许消息数组（`registerTextMediaDisplayHandlers` 的 `displayTypes`，约 1505 行）加入 `'displayPlaylistRequest'`，放在 `'playlistCacheStatus'` 之后。

- [ ] **Step 6: 静态检查**

Run: `node --check src/apps/server/modules/media/display-local-media.js && node --check src/apps/server/boot/server-app.js`
Expected: 退出码 0。

- [ ] **Step 7: 记录结果（不提交 git）**

---

### Task 6: 显示端媒体库按钮与面板

**Files:**
- Create: `src/apps/web-mediacenter/ui/public/js/display-media-library.js`
- Create: `src/apps/web-mediacenter/ui/public/css/display-media-library.css`
- Create: `tests/display-media-library-browser.test.js`
- Modify: `src/apps/web-mediacenter/ui/public/display.html`（按钮、面板、样式/脚本引入、inline 初始化、WS 分发）

**Interfaces:**
- Consumes: Task 4 的 `/api/display-local/libraries` 与 `/list`；Task 5 的 `displayPlaylistRequest` / `displayPlaylistError` / `playlistStart`；显示端内联的 `showMedia`、`stopPlaylist`、`displayWs`。
- Produces（浏览器全局 `DisplayMediaLibrary`）：
  - `init({ send, playMedia, hostname })`
  - `open()` / `close()`
  - `handleServerMessage(data)`（处理 `displayPlaylistError` 与 `playlistStart`）
  - `isLocalHostname(hostname)`

- [ ] **Step 1: 写失败浏览器测试 `tests/display-media-library-browser.test.js`**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');

const publicDir = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const chrome = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

test('本机显示端媒体库按钮、浏览、单文件播放与文件夹批量播放', {
    skip: !fs.existsSync(chrome), timeout: 45000
}, async t => {
    const $ = cheerio.load(fs.readFileSync(path.join(publicDir, 'display.html'), 'utf8'));
    $('script, link[rel="stylesheet"]').remove();
    const html = $.html();
    const app = express();
    app.get('/display.html', (req, res) => res.type('html').send(html));
    app.get('/api/display-local/libraries', (req, res) => res.json({
        libraries: [
            { id: 'local1', name: '上传', type: 'local' },
            { id: 'task-auto:hongguo', name: '红果短剧', type: 'task', taskId: 'hongguo' }
        ]
    }));
    app.get('/api/display-local/list', (req, res) => {
        const dir = String(req.query.path || '/');
        const entries = dir === '/'
            ? [
                { name: '合集A', path: '/合集A', type: 'directory' },
                { name: 'a.mp4', path: '/a.mp4', type: 'file', mediaType: 'video', directUrl: '/uploads/a.mp4', proxyUrl: '' }
            ]
            : [{ name: 'b.mp4', path: `${dir}/b.mp4`, type: 'file', mediaType: 'video', directUrl: `${dir}/b.mp4`, proxyUrl: '' }];
        res.json({ path: dir, parent: '/', entries });
    });
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/display.html`);
    await page.addScriptTag({ path: path.join(publicDir, 'js/display-media-library.js') });
    await page.evaluate(() => {
        window.sent = [];
        window.played = [];
        window.DisplayMediaLibrary.init({
            send: message => window.sent.push(message),
            playMedia: message => window.played.push(message)
        });
    });

    assert.equal(await page.$eval('#displayMediaLibraryToggle', node => node.hidden), false);
    assert.equal(await page.evaluate(() => {
        const actions = document.getElementById('displayGameChatActions');
        const children = [...actions.children];
        return children.indexOf(document.getElementById('displayMediaLibraryToggle'))
            < children.indexOf(document.getElementById('displayGameToggle'));
    }), true);

    await page.click('#displayMediaLibraryToggle');
    await page.waitForSelector('.display-media-library-source');
    assert.deepEqual(
        await page.$$eval('.display-media-library-source', nodes => nodes.map(node => node.textContent)),
        ['上传', '红果短剧']
    );
    assert.deepEqual(
        await page.$$eval('.display-media-library-group-title', nodes => nodes.map(node => node.textContent)),
        ['本地媒体', '任务媒体']
    );
    await page.waitForSelector('.display-media-library-entry');
    await page.evaluate(() => [...document.querySelectorAll('.display-media-library-entry-name')]
        .find(node => node.textContent === 'a.mp4').click());
    assert.deepEqual(await page.evaluate(() => window.played.at(-1)), {
        type: 'url', url: '/uploads/a.mp4', fileName: 'a.mp4', mediaType: 'video'
    });
    assert.equal(await page.$eval('#displayMediaLibraryPanel', node => node.hidden), true);

    await page.click('#displayMediaLibraryToggle');
    await page.waitForSelector('.display-media-library-entry');
    await page.evaluate(() => [...document.querySelectorAll('.display-media-library-batch')]
        .find(node => node.closest('.display-media-library-entry').textContent.includes('合集A')).click());
    assert.deepEqual(await page.evaluate(() => window.sent.at(-1)), {
        type: 'displayPlaylistRequest', libraryId: 'local1', path: '/合集A'
    });
    assert.equal(await page.$eval('#displayMediaLibraryPanel', node => node.hidden), true);

    await page.evaluate(() => window.DisplayMediaLibrary.handleServerMessage({
        type: 'displayPlaylistError', message: '该目录没有可播放的媒体'
    }));
    assert.equal(await page.$eval('#displayMediaLibraryNotice', node => node.hidden), false);
    assert.equal(await page.$eval('#displayMediaLibraryNotice', node => node.textContent), '该目录没有可播放的媒体');
    assert.deepEqual(errors, []);
});

test('非本机主机名不显示媒体库入口', {
    skip: !fs.existsSync(chrome), timeout: 45000
}, async t => {
    const $ = cheerio.load(fs.readFileSync(path.join(publicDir, 'display.html'), 'utf8'));
    $('script, link[rel="stylesheet"]').remove();
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent($.html());
    await page.addScriptTag({ path: path.join(publicDir, 'js/display-media-library.js') });
    await page.evaluate(() => window.DisplayMediaLibrary.init({ send: () => {}, playMedia: () => {}, hostname: '192.168.1.20' }));
    assert.equal(await page.$eval('#displayMediaLibraryToggle', node => node.hidden), true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/display-media-library-browser.test.js`
Expected: FAIL，找不到 `js/display-media-library.js` 或按钮不存在。

- [ ] **Step 3: 修改 `display.html`**

3a. `<head>` 增加样式（在 `display-mmd.css` 之后）：

```html
    <link rel="stylesheet" href="css/display-media-library.css">
```

3b. 在 `#displayGameChatActions` 内、`#displayGameToggle` 之前插入：

```html
                <button id="displayMediaLibraryToggle" class="display-stage-button" type="button" hidden>媒体库</button>
```

3c. 在脚本引入区（`js/bilibili-danmaku.js` 之后）加入：

```html
    <script src="js/display-media-library.js"></script>
```

3d. 在 `<audio id="ttsAudio" ...>` 之前加入面板与提示层：

```html
    <div id="displayMediaLibraryPanel" class="display-media-library-panel" hidden>
        <div class="display-media-library-header">
            <strong>媒体库</strong>
            <button id="displayMediaLibraryClose" class="display-stage-button" type="button">关闭</button>
        </div>
        <div class="display-media-library-body">
            <div id="displayMediaLibrarySources" class="display-media-library-sources"></div>
            <div class="display-media-library-main">
                <div class="display-media-library-toolbar">
                    <button id="displayMediaLibraryUp" type="button">返回上级</button>
                    <span id="displayMediaLibraryPath">/</span>
                </div>
                <div id="displayMediaLibraryEntries" class="display-media-library-entries"></div>
                <p id="displayMediaLibraryStatus" class="display-media-library-status" role="status"></p>
            </div>
        </div>
    </div>
    <div id="displayMediaLibraryNotice" class="display-media-library-notice" hidden></div>
```

3e. 在内联脚本底部、`connectWebSocket();` 之后加入：

```js
        // 媒体库面板只在本机页面可用；播放回调复用显示端现有 showMedia/stopPlaylist。
        window.DisplayMediaLibrary?.init({
            send: message => {
                if (displayWs && displayWs.readyState === WebSocket.OPEN) displayWs.send(JSON.stringify(message));
            },
            playMedia: data => {
                stopPlaylist();
                showMedia(data);
            }
        });
```

3f. WS 分发中修改 `playlistStart` 分支并新增 `displayPlaylistError` 分支：

```js
                    } else if (data.type === 'playlistStart') {
                        handlePlaylistStart(data);
                        window.DisplayMediaLibrary?.handleServerMessage(data);
                        sendCommandAck('playlistStart', true, data.listId);
                    } else if (data.type === 'displayPlaylistError') {
                        window.DisplayMediaLibrary?.handleServerMessage(data);
                    } else if (data.type === 'playlistDynamicEnd') {
```

- [ ] **Step 4: 创建 `js/display-media-library.js`**

```js
(function () {
    'use strict';

    const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
    let options = null;
    let state = { libraries: [], libraryId: '', path: '/', parent: '/', entries: [] };

    function byId(id) { return document.getElementById(id); }

    function isLocalHostname(hostname) {
        return LOCAL_HOSTS.has(String(hostname || '').toLowerCase());
    }

    function setStatus(text) {
        const node = byId('displayMediaLibraryStatus');
        if (node) node.textContent = text || '';
    }

    async function requestJson(url) {
        const response = await fetch(url, { cache: 'no-store' });
        let payload = null;
        try { payload = await response.json(); } catch { payload = null; }
        if (!response.ok) throw new Error(payload?.error || '媒体库加载失败，请稍后重试');
        return payload || {};
    }

    function createButton(label, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.onclick = onClick;
        return button;
    }

    function renderSources() {
        const root = byId('displayMediaLibrarySources');
        if (!root) return;
        root.replaceChildren();
        const groups = [
            { title: '本地媒体', items: state.libraries.filter(item => item.type !== 'task') },
            { title: '任务媒体', items: state.libraries.filter(item => item.type === 'task') }
        ];
        for (const group of groups) {
            if (!group.items.length) continue;
            const heading = document.createElement('div');
            heading.className = 'display-media-library-group-title';
            heading.textContent = group.title;
            root.appendChild(heading);
            for (const library of group.items) {
                const button = createButton(library.name, () => void openLibrary(library.id));
                button.className = 'display-media-library-source';
                button.dataset.libraryId = library.id;
                if (library.id === state.libraryId) button.classList.add('active');
                root.appendChild(button);
            }
        }
    }

    function renderEntries() {
        const root = byId('displayMediaLibraryEntries');
        if (!root) return;
        root.replaceChildren();
        const path = byId('displayMediaLibraryPath');
        if (path) path.textContent = state.path;
        const up = byId('displayMediaLibraryUp');
        if (up) up.disabled = state.path === '/';
        for (const entry of state.entries) {
            const row = document.createElement('div');
            row.className = 'display-media-library-entry';
            const open = createButton(entry.name, () => {
                if (entry.type === 'directory') void openDirectory(entry.path);
                else playEntry(entry);
            });
            open.className = 'display-media-library-entry-name';
            row.appendChild(open);
            if (entry.type === 'directory') {
                const batch = createButton('批量播放', () => requestFolderPlayback(entry));
                batch.className = 'display-media-library-batch';
                row.appendChild(batch);
            }
            root.appendChild(row);
        }
    }

    async function loadLibraries() {
        setStatus('');
        try {
            const payload = await requestJson('/api/display-local/libraries');
            state.libraries = Array.isArray(payload.libraries) ? payload.libraries : [];
            renderSources();
            if (!state.libraries.length) {
                setStatus('此目录没有可播放的媒体');
                return;
            }
            const preferred = state.libraries.find(item => item.id === state.libraryId) || state.libraries[0];
            await openLibrary(preferred.id);
        } catch (error) {
            setStatus('媒体库加载失败，请稍后重试');
        }
    }

    async function openLibrary(libraryId) {
        state.libraryId = libraryId;
        state.path = '/';
        renderSources();
        await loadDirectory('/');
    }

    async function openDirectory(path) {
        state.path = path;
        await loadDirectory(path);
    }

    async function loadDirectory(path) {
        setStatus('');
        try {
            const query = new URLSearchParams({ libraryId: state.libraryId, path });
            const payload = await requestJson(`/api/display-local/list?${query}`);
            state.path = typeof payload.path === 'string' ? payload.path : path;
            state.parent = typeof payload.parent === 'string' ? payload.parent : '/';
            state.entries = Array.isArray(payload.entries) ? payload.entries : [];
            renderEntries();
            if (!state.entries.length) setStatus('此目录没有可播放的媒体');
        } catch (error) {
            setStatus('媒体库加载失败，请稍后重试');
        }
    }

    function playEntry(entry) {
        const url = entry.proxyUrl || entry.directUrl;
        if (!url) {
            setStatus('媒体库加载失败，请稍后重试');
            return;
        }
        options?.playMedia?.({ type: 'url', url, fileName: entry.name, mediaType: entry.mediaType });
        close();
    }

    function requestFolderPlayback(entry) {
        setStatus('');
        options?.send?.({ type: 'displayPlaylistRequest', libraryId: state.libraryId, path: entry.path });
        close();
    }

    function open() {
        if (!isLocalHostname(options?.hostname ?? window.location.hostname)) return;
        const panel = byId('displayMediaLibraryPanel');
        if (!panel) return;
        panel.hidden = false;
        void loadLibraries();
    }

    function close() {
        const panel = byId('displayMediaLibraryPanel');
        if (panel) panel.hidden = true;
    }

    function showNotice(message) {
        const notice = byId('displayMediaLibraryNotice');
        if (!notice) return;
        notice.textContent = String(message || '');
        notice.hidden = !message;
        if (notice._timer) clearTimeout(notice._timer);
        if (message) {
            notice._timer = setTimeout(() => {
                notice.hidden = true;
                notice.textContent = '';
            }, 4000);
        }
    }

    function handleServerMessage(data) {
        if (data?.type === 'displayPlaylistError') {
            showNotice(data.message || '媒体库加载失败，请稍后重试');
            return;
        }
        if (data?.type === 'playlistStart') close();
    }

    function init(nextOptions = {}) {
        options = nextOptions;
        const toggle = byId('displayMediaLibraryToggle');
        if (!toggle) return;
        if (!isLocalHostname(options.hostname ?? window.location.hostname)) {
            toggle.hidden = true;
            return;
        }
        toggle.hidden = false;
        toggle.onclick = open;
        const closeButton = byId('displayMediaLibraryClose');
        if (closeButton) closeButton.onclick = close;
        const up = byId('displayMediaLibraryUp');
        if (up) up.onclick = () => {
            if (state.path !== '/') void openDirectory(state.parent);
        };
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !byId('displayMediaLibraryPanel')?.hidden) close();
        });
    }

    window.DisplayMediaLibrary = {
        init, open, close, handleServerMessage, isLocalHostname
    };
})();
```

- [ ] **Step 5: 创建 `css/display-media-library.css`**

```css
.display-media-library-panel { position: fixed; inset: 0; z-index: 60; display: flex; flex-direction: column; background: rgba(8, 10, 16, .94); color: #fff; }
.display-media-library-panel[hidden] { display: none; }
.display-media-library-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid rgba(255, 255, 255, .12); }
.display-media-library-body { flex: 1; display: flex; min-height: 0; }
.display-media-library-sources { width: 220px; overflow-y: auto; padding: 12px; border-right: 1px solid rgba(255, 255, 255, .12); }
.display-media-library-group-title { margin: 8px 0; font-size: 12px; color: rgba(255, 255, 255, .55); }
.display-media-library-source { display: block; width: 100%; margin-bottom: 6px; padding: 8px 10px; border: 0; border-radius: 8px; background: rgba(255, 255, 255, .08); color: #fff; text-align: left; }
.display-media-library-source.active { background: linear-gradient(135deg, #667eea, #764ba2); }
.display-media-library-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.display-media-library-toolbar { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid rgba(255, 255, 255, .12); }
.display-media-library-entries { flex: 1; overflow-y: auto; padding: 12px; }
.display-media-library-entry { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border-radius: 8px; }
.display-media-library-entry:hover { background: rgba(255, 255, 255, .08); }
.display-media-library-entry-name { flex: 1; min-width: 0; border: 0; background: none; color: #fff; text-align: left; font-size: 15px; padding: 4px 0; }
.display-media-library-batch { border: 0; border-radius: 6px; padding: 6px 10px; background: rgba(102, 126, 234, .35); color: #fff; }
.display-media-library-status { margin: 0; padding: 10px 16px; color: rgba(255, 255, 255, .6); font-size: 13px; }
.display-media-library-notice { position: fixed; left: 50%; bottom: 96px; z-index: 70; transform: translateX(-50%); padding: 10px 16px; border-radius: 8px; background: rgba(0, 0, 0, .8); color: #fff; font-size: 14px; }
.display-media-library-notice[hidden] { display: none; }
```

- [ ] **Step 6: 运行测试**

Run: `node --check src/apps/web-mediacenter/ui/public/js/display-media-library.js && node --test tests/display-media-library-browser.test.js`
Expected: 语法检查通过；浏览器测试 `2 pass / 0 fail`（无 Chromium 时 skip）。

- [ ] **Step 7: 记录结果（不提交 git）**

---

### Task 7: 夸克下载目录子分类

**Files:**
- Create: `src/apps/server/modules/media/download-path.js`
- Create: `tests/download-path.test.js`
- Modify: `src/apps/server/modules/media/quark-directory-downloads.js`
- Modify: `src/apps/server/boot/server-app.js`（两个夸克下载路由）
- Modify: `tests/quark-directory-downloads.test.js`

**Interfaces:**
- Consumes: 现有 `QuarkDirectoryDownloads` 的 `safeDir`、`placeFile`、记录结构。
- Produces:
  - `sanitizeCategoryName(value) -> string`
  - `QuarkDirectoryDownloads.start(source, dirPath, targetId, category = '')`
  - `QuarkDirectoryDownloads.startFile(source, filePath, targetId, meta = { category })`
  - `downloadPrefix(source, category = '') -> ['夸克分享', 清洗后的分类, hash]`

- [ ] **Step 1: 写失败测试 `tests/download-path.test.js`**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeCategoryName } = require('../src/apps/server/modules/media/download-path');

test('分类名清洗路径分隔符、控制字符与空白', () => {
    assert.equal(sanitizeCategoryName(' 课程 / 2026 '), '课程 _ 2026');
    assert.equal(sanitizeCategoryName('a\\b'), 'a_b');
    assert.equal(sanitizeCategoryName('a\u0000b'), 'a_b');
    assert.equal(sanitizeCategoryName('  多个   空格  '), '多个 空格');
});

test('空值与点目录回退为未分类', () => {
    assert.equal(sanitizeCategoryName(''), '未分类');
    assert.equal(sanitizeCategoryName('   '), '未分类');
    assert.equal(sanitizeCategoryName('.'), '未分类');
    assert.equal(sanitizeCategoryName('..'), '未分类');
    assert.equal(sanitizeCategoryName(null), '未分类');
    assert.equal(sanitizeCategoryName(undefined), '未分类');
});

test('分类名截断到 50 字，路径穿越残留不会被当作目录层级', () => {
    assert.equal(sanitizeCategoryName('a'.repeat(80)).length, 50);
    assert.equal(sanitizeCategoryName('../../etc'), '.._.._etc');
    assert.equal(sanitizeCategoryName('/'), '未分类');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/download-path.test.js`
Expected: FAIL，找不到模块 `download-path`。

- [ ] **Step 3: 创建 `download-path.js`**

```js
'use strict';

// 分类名只作为单层目录名：替换路径分隔符与控制字符，避免穿越或空目录。
function sanitizeCategoryName(value) {
    let text = String(value ?? '').trim();
    text = text.replace(/[\/\\\u0000-\u001f\u007f]/g, '_');
    text = text.replace(/\s+/g, ' ');
    if (!text || text === '.' || text === '..') return '未分类';
    return text.slice(0, 50);
}

module.exports = { sanitizeCategoryName };
```

- [ ] **Step 4: 修改 `quark-directory-downloads.js`**

4a. 顶部加入：

```js
const { sanitizeCategoryName } = require('./download-path');
```

4b. `start()` 改为：

```js
    start(source, dirPath, targetId, category = '') {
        if (this.job?.status === 'running') throw new Error('已有目录正在下载，请稍后再试');
        if (!source?.nodeId || !source?.libraryId || !targetId) throw new Error('请选择来源和目标媒体库');
        const dir = this.validatePath(dirPath);
        this.getTarget(targetId, true);
        this.job = {
            id: crypto.randomUUID(), status: 'running', source, dirPath: dir, targetId,
            category: sanitizeCategoryName(category),
            completed: 0, skipped: 0, received: 0, total: 0, fileName: ''
        };
        const job = this.job;
        void this.run(job).catch(error => { job.status = 'error'; job.message = error.message || '目录下载失败'; this.notify(job); });
        this.notify(job);
        return { ...job };
    }
```

4c. `startFile()` 的 job 增加分类：

```js
    startFile(source, filePath, targetId, meta = {}) {
        if (this.job?.status === 'running') throw new Error('已有下载任务正在进行，请稍后再试');
        if (!source?.nodeId || !source?.libraryId || !targetId) throw new Error('下载来源或目标无效');
        const targetPath = this.validatePath(filePath);
        if (targetPath === '/') throw new Error('文件路径无效');
        this.getTarget(targetId, true);
        const size = meta.size == null ? null : Number(meta.size);
        const job = {
            id: crypto.randomUUID(), status: 'running', source, dirPath: targetPath, fileMode: true, targetId,
            category: sanitizeCategoryName(meta.category),
            completed: 0, skipped: 0, received: 0,
            total: Number.isSafeInteger(size) && size >= 0 ? size : 0,
            fileName: path.posix.basename(targetPath)
        };
        this.job = job;
        void this.runFile(job, targetPath, meta).catch(error => { job.status = 'error'; job.message = error.message || '下载失败'; this.notify(job); });
        this.notify(job);
        return { ...job };
    }
```

4d. `runFile()` 中调用改为 `this.downloadPrefix(job.source, job.category)`。

4e. `downloadPrefix()` 改为：

```js
    downloadPrefix(source, category = '') {
        return [
            '夸克分享',
            sanitizeCategoryName(category),
            crypto.createHash('sha256').update(JSON.stringify(source)).digest('hex').slice(0, 16)
        ];
    }
```

4f. `run()` 中 `const prefix = this.downloadPrefix(source);` 改为 `const prefix = this.downloadPrefix(source, job.category);`。

- [ ] **Step 5: 扩展 `tests/quark-directory-downloads.test.js`**

在文件末尾追加：

```js
test('下载子分类按来源与分类分目录，单文件同样生效', async t => {
    const f = await fixture(t);
    f.service.start(f.source, '/course', 'b', '课程 / 2026');
    assert.equal((await finish(f.service)).status, 'done');
    const saved = await f.service.lookup(f.source, '/course/a.mp4', 'b');
    assert.ok(saved.full.startsWith(path.join(f.b, '夸克分享', '课程 _ 2026') + path.sep));
    f.service.startFile(f.source, '/course/a.mp4', 'a', { size: 3, modifiedTime: null, category: '单文件分类' });
    await finish(f.service);
    const fileSaved = await f.service.lookup(f.source, '/course/a.mp4', 'a');
    assert.ok(fileSaved.full.startsWith(path.join(f.a, '夸克分享', '单文件分类') + path.sep));
});

test('缺省分类落入未分类目录', async t => {
    const f = await fixture(t);
    f.service.start(f.source, '/course', 'a');
    await finish(f.service);
    const saved = await f.service.lookup(f.source, '/course/a.mp4', 'a');
    assert.ok(saved.full.startsWith(path.join(f.a, '夸克分享', '未分类') + path.sep));
});

test('旧夸克下载目录的记录仍可查询', async t => {
    const f = await fixture(t);
    const oldDir = path.join(f.a, '夸克下载', 'legacyhash', 'course');
    await fs.mkdir(oldDir, { recursive: true });
    await fs.writeFile(path.join(oldDir, 'a.mp4'), 'old');
    const stat = await fs.stat(path.join(oldDir, 'a.mp4'));
    f.service.records.push({
        key: f.service.key(f.source, '/course/a.mp4'),
        source: f.source,
        filePath: '/course/a.mp4',
        targetId: 'a',
        relative: path.relative(f.a, path.join(oldDir, 'a.mp4')),
        size: stat.size,
        updatedAt: Date.now()
    });
    const saved = await f.service.lookup(f.source, '/course/a.mp4', 'a');
    assert.equal(await fs.readFile(saved.full, 'utf8'), 'old');
});
```

- [ ] **Step 6: 修改夸克下载路由**

在 `server-app.js` 的两个路由中传递 `category`：

```js
app.post('/api/quark-directory-downloads', async (req, res) => {
    try {
        const { nodeId = AASC_MAIN_NODE_ID, libraryId, targetId, path: dirPath = '/', category = '' } = req.body || {};
        await assertQuarkDownloadSource(nodeId, libraryId);
        if (typeof targetId !== 'string') throw new Error('来源或目标无效');
        const job = quarkDirectoryDownloads.start({ nodeId, libraryId }, dirPath, targetId, category);
        res.json({ status: 'success', job });
    } catch (error) { res.status(400).json({ status: 'error', message: error.message }); }
});
app.post('/api/quark-file-downloads', async (req, res) => {
    try {
        const { nodeId = AASC_MAIN_NODE_ID, libraryId, targetId, path: filePath, size, modifiedTime, category = '' } = req.body || {};
        if (typeof targetId !== 'string' || typeof filePath !== 'string') throw new Error('下载参数无效');
        await assertQuarkDownloadSource(nodeId, libraryId);
        const job = quarkDirectoryDownloads.startFile({ nodeId, libraryId }, filePath, targetId, { size, modifiedTime, category });
        res.json({ status: 'success', job });
    } catch (error) { res.status(400).json({ status: 'error', message: error.message }); }
});
```

- [ ] **Step 7: 运行测试**

Run: `node --test tests/download-path.test.js tests/quark-directory-downloads.test.js`
Expected: 全部通过，0 fail。

- [ ] **Step 8: 记录结果（不提交 git）**

---

### Task 8: B 站下载子分类与下载对话框预览

**Files:**
- Modify: `src/apps/server/modules/media/bilibili-download-service.js`
- Modify: `src/apps/server/boot/server-app.js`（B 站下载路由）
- Modify: `src/apps/web-mediacenter/ui/public/js/media-library.js`（分类助手、对话框预览与请求字段）
- Modify: `tests/bilibili-download-search.test.js`
- Create: `tests/download-category-browser.test.js`

**Interfaces:**
- Consumes: Task 7 的 `sanitizeCategoryName`。
- Produces:
  - `BilibiliDownloads.start(url, targetId, title, category = '')`
  - `MediaLibrary.cleanCategoryName(value)`
  - `MediaLibrary.currentQuarkCategory()`
  - `MediaLibrary.currentBilibiliCategory()`
  - `MediaLibrary.categoryPreview(libraryName, sourceName, category)`
  - 下载请求体新增 `category` 字段。

- [ ] **Step 1: 扩展 B 站下载测试**

在 `tests/bilibili-download-search.test.js` 末尾追加：

```js
test('B 站下载按分类目录存放并保留分集后缀', async t => {
    const f = await create(t);
    f.service.start('https://www.bilibili.com/list/ml1', 'a', '课程合集', '我的课程');
    assert.equal((await wait(f.service)).completed, 2);
    const saved = await f.service.lookup({ bvid: 'BV1B7411m7LV', page: 2 });
    assert.ok(saved.full.startsWith(path.join(f.first, 'B站视频', '我的课程') + path.sep));
    assert.match(saved.full, /P2\.mp4$/);
});

test('B 站单视频无分类时落入未分类目录，旧记录仍可查询', async t => {
    const f = await create(t);
    f.service.start('https://www.bilibili.com/video/BV1B7411m7LV', 'b');
    await wait(f.service);
    const saved = await f.service.lookup({ bvid: 'BV1B7411m7LV', page: 1 });
    assert.ok(saved.full.startsWith(path.join(f.second, 'B站视频', '未分类') + path.sep));
    assert.equal(await fs.readFile(saved.full, 'utf8'), 'videoaudio');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/bilibili-download-search.test.js`
Expected: 新增两条测试 FAIL（文件实际落在 `B站下载/...`，不是 `B站视频/...`）。

- [ ] **Step 3: 修改 `bilibili-download-service.js`**

3a. 顶部加入：

```js
const { sanitizeCategoryName } = require('./download-path');
```

3b. `start()` 增加分类参数并写入 job：

```js
    start(url, targetId, title, category = '') {
        if (this.job?.status === 'running') throw new Error('已有 B 站下载任务正在进行');
        this.getTarget(targetId, true);
        const collection = parseCollectionUrl(url);
        const video = collection ? null : parseVideoUrl(url);
        const job = {
            id: crypto.randomUUID(), status: 'running', targetId,
            url: collection?.url || video.url,
            category: sanitizeCategoryName(category),
            completed: 0, skipped: 0, total: 0, received: 0, fileName: ''
        };
        this.job = job;
        void this.run(job, collection, video, title).catch(error => { job.status = 'error'; job.message = error.message || '下载失败'; this.notify(job); });
        this.notify(job);
        return { ...job };
    }
```

3c. `run()` 中目录改为：

```js
            const dir = await this.index.safeDir(root, ['B站视频', sanitizeCategoryName(job.category)]);
```

- [ ] **Step 4: 修改 B 站下载路由**

```js
app.post('/api/bilibili/download', (req, res) => {
    try {
        const { url, targetId, title, category = '' } = req.body || {};
        if (typeof url !== 'string' || typeof targetId !== 'string') throw new Error('请选择视频和目标媒体库');
        res.json({ status: 'success', job: bilibiliDownloads.start(url, targetId, title, category) });
    } catch (error) { res.status(400).json({ status: 'error', message: error.message }); }
});
```

- [ ] **Step 5: 写失败浏览器测试 `tests/download-category-browser.test.js`**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

test('下载分类助手与对话框路径预览', async t => {
    if (!fs.existsSync('/usr/bin/chromium')) return t.skip('Chromium 不可用');
    const root = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent('<div id="quarkDirectoryDownloadStatus"></div>');
    await page.addScriptTag({ path: path.join(root, 'js/media-library.js') });
    await page.evaluate(() => {
        window.showToast = () => {};
        window.fetch = async (url, options) => {
            window.lastRequest = { url, body: options?.body ? JSON.parse(options.body) : null };
            return { ok: true, json: async () => ({ status: 'success', job: { status: 'running' } }) };
        };
        MediaLibrary.libraries = [{ id: 'local1', name: '上传', type: 'local', readonly: false, isLocal: true }];
        MediaLibrary.currentLibrary = { id: 'q1', type: 'quark' };
        MediaLibrary.shareFolders.quark.folders = [{ id: 'f1', name: '课程合集' }, { id: 'f2', name: '资料夹' }];
        MediaLibrary.selectedShareFolder.quark = 'f1';
        MediaLibrary.bilibiliCollection = { title: '合集 A' };
    });
    assert.equal(await page.evaluate(() => MediaLibrary.cleanCategoryName(' 课程 / 2026 ')), '课程 _ 2026');
    assert.equal(await page.evaluate(() => MediaLibrary.currentQuarkCategory()), '课程合集');
    assert.equal(await page.evaluate(() => MediaLibrary.currentBilibiliCategory()), '合集 A');
    assert.equal(await page.evaluate(() => MediaLibrary.categoryPreview('上传', '夸克分享', '')), '目标：上传 / 夸克分享 / 未分类');
    await page.evaluate(() => MediaLibrary.showQuarkDirectoryDownloadDialog('/', { id: 'q1', type: 'quark' }));
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.dialog-body p')]
        .some(node => node.textContent === '目标：上传 / 夸克分享 / 课程合集')), true);
    await page.click('.btn-confirm');
    await page.waitForFunction(() => window.lastRequest?.url === '/api/quark-directory-downloads');
    assert.equal(await page.evaluate(() => window.lastRequest.body.category), '课程合集');
    await page.waitForFunction(() => !document.querySelector('.modal-mask'));
    // 切换夸克分享文件夹后，重新打开对话框，分类预览与请求分类同步变化。
    await page.evaluate(() => {
        MediaLibrary.selectedShareFolder.quark = 'f2';
        MediaLibrary.showQuarkDirectoryDownloadDialog('/', { id: 'q1', type: 'quark' });
    });
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.dialog-body p')]
        .some(node => node.textContent === '目标：上传 / 夸克分享 / 资料夹')), true);
    await page.click('.btn-confirm');
    await page.waitForFunction(() => window.lastRequest?.body?.category === '资料夹');
    await page.waitForFunction(() => !document.querySelector('.modal-mask'));
    // B 站对话框同样显示分类预览，分类来自收藏列表标题。
    await page.evaluate(() => MediaLibrary.showBilibiliDownloadDialog('https://www.bilibili.com/video/BV1xx411c7mD', '合集 A'));
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.dialog-body p')]
        .some(node => node.textContent === '目标：上传 / B站视频 / 合集 A')), true);
});
```

- [ ] **Step 6: 运行测试确认失败**

Run: `node --test tests/download-category-browser.test.js`
Expected: FAIL，`cleanCategoryName is not a function`。

- [ ] **Step 7: 修改 `media-library.js`**

7a. 在 `showBilibiliDownloadDialog` 之前新增分类助手：

```js
    // 与服务端 sanitizeCategoryName 保持一致，用于对话框预览与请求字段。
    cleanCategoryName(value) {
        let text = String(value ?? '').trim();
        text = text.replace(/[\/\\\u0000-\u001f\u007f]/g, '_');
        text = text.replace(/\s+/g, ' ');
        if (!text || text === '.' || text === '..') return '未分类';
        return text.slice(0, 50);
    },
    currentQuarkCategory() {
        const folderId = this.selectedShareFolder.quark;
        const folder = this.shareFolders.quark.folders.find(item => item.id === folderId);
        return folder?.name || '';
    },
    currentBilibiliCategory() {
        if (this.bilibiliCollection?.title) return this.bilibiliCollection.title;
        const folderId = this.selectedShareFolder.bilibili;
        const folder = this.shareFolders.bilibili.folders.find(item => item.id === folderId);
        return folder?.name || '';
    },
    categoryPreview(libraryName, sourceName, category) {
        return `目标：${libraryName} / ${sourceName} / ${this.cleanCategoryName(category)}`;
    },
```

7b. `showBilibiliDownloadDialog(url, title = '')` 中：

- 在 `const select = ...` 之后新增：

```js
        const category = this.currentBilibiliCategory();
        const preview = document.createElement('p');
        preview.className = 'download-target-preview';
        const updatePreview = () => {
            const selected = targets.find(lib => String(lib.sourceLibraryId || lib.id) === select.value) || targets[0];
            preview.textContent = this.categoryPreview(selected.name, 'B站视频', category);
        };
        select.onchange = updatePreview;
        updatePreview();
```

- `body.append(label, select);` 改为 `body.append(label, select, preview);`。
- POST body 增加 `category`：

```js
body: JSON.stringify({ url, title, targetId: select.value, category })
```

7c. `showQuarkDirectoryDownloadDialog(folderPath, sourceLibrary = null)` 中：

- 在 `const select = ...` 之后新增：

```js
        const category = this.currentQuarkCategory();
        const preview = document.createElement('p');
        preview.className = 'download-target-preview';
        const updatePreview = () => {
            const selected = targets.find(lib => String(lib.sourceLibraryId || lib.id) === select.value) || targets[0];
            preview.textContent = this.categoryPreview(selected.name, '夸克分享', category);
        };
        select.onchange = updatePreview;
        updatePreview();
```

- `body.append(description, select);` 改为 `body.append(description, select, preview);`。
- POST body 改为：

```js
body: JSON.stringify({ nodeId: source.remote ? source.ownerNodeId : 'main-server', libraryId: source.sourceLibraryId || source.id, targetId: select.value, path: folderPath || '/', category })
```

7d. `showQuarkFileDownloadDialog(filePath)` 中：

- 在 `const select = ...` 之后新增（来源名固定 `夸克分享`）：

```js
        const category = this.currentQuarkCategory();
        const preview = document.createElement('p');
        preview.className = 'download-target-preview';
        const updatePreview = () => {
            const selected = targets.find(lib => String(lib.sourceLibraryId || lib.id) === select.value) || targets[0];
            preview.textContent = this.categoryPreview(selected.name, '夸克分享', category);
        };
        select.onchange = updatePreview;
        updatePreview();
```

- `body.append(description, select);` 改为 `body.append(description, select, preview);`。
- POST body 改为：

```js
body: JSON.stringify({ nodeId: source.remote ? source.ownerNodeId : 'main-server', libraryId: source.sourceLibraryId || source.id, targetId: select.value, path: filePath, size: meta.size, modifiedTime: meta.modifiedTime, category })
```

- [ ] **Step 8: 运行测试**

Run: `node --check src/apps/web-mediacenter/ui/public/js/media-library.js && node --test tests/download-category-browser.test.js tests/bilibili-download-search.test.js tests/quark-directory-downloads.test.js tests/download-path.test.js`
Expected: 全部通过，0 fail（无 Chromium 时浏览器测试 skip）。

- [ ] **Step 9: 记录结果（不提交 git）**

---

### Task 9: 文档、自测与全量定向回归

**Files:**
- Modify: `docs/spec/media-library.md`
- Modify: `docs/design/media-library.md`
- Modify: `docs/spec/self-test.md`
- Modify: `docs/todo.md`
- Modify: `changelog.md`
- Create: `docs/task/2026-11-10_媒体库多代理显示端与下载子分类.md`

**Interfaces:**
- Consumes: Task 1-8 的最终实现与测试命令。
- Produces: 与代码同步的 spec/design/self-test/changelog/task 文档。

- [ ] **Step 1: 更新 `docs/spec/media-library.md`**

1a. 找到“全局网络代理”相关小节（关键词 `globalWebProxy`、`setGlobalWebProxy`、`使用代理`），替换为命名代理列表伪代码，至少覆盖：

```text
network.webProxies = [{ id, name, url }]            // 最多 20 项，id 服务端生成
media.providerProxy = { sourceId: proxyId }          // '' 表示不使用代理
迁移：webProxies 非数组时，用 network.globalWebProxy 规范化结果创建 proxy-legacy；
      旧布尔开关 true -> proxy-legacy，其余 -> ''；随后 globalWebProxy 置空；已有 webProxies 时跳过。
解析：resolveSourceProxyUrl({ proxies, selections, sourceId })；找不到/非法地址返回 ''。
协议：getWebProxyConfig -> webProxyConfig；setWebProxyList { webProxies }；
      setProviderProxy { sourceId, proxyId }；错误 -> webProxyConfigError。
校验：数量 <= 20；名称非空且 <= 30；地址经 normalizeProxyUrl；删除代理时同一次保存把引用置 ''。
```

1b. 找到下载相关小节（关键词 `夸克下载`、`B站下载`），改写路径规则：

```text
夸克分享：目标库/夸克分享/<sanitizeCategoryName(category)>/<sha256(source).slice(0,16)>/<相对路径>
B 站：   目标库/B站视频/<sanitizeCategoryName(category)>/<标题> <bvid>[ Pn].mp4
category 缺省 -> 未分类；旧目录与旧记录保持不动，lookup 仍按 source+filePath+targetId 命中。
```

1c. 新增 `### 显示端本机媒体库` 小节：

```text
入口：display.html #displayGameChatActions 内、#displayGameToggle 之前，文案“媒体库”；
      仅 location.hostname ∈ {localhost,127.0.0.1,::1,[::1]} 时显示。
API： GET /api/display-local/libraries -> { libraries }（local/smb/http/android-saf + listTaskMediaSources）
      GET /api/display-local/list?libraryId=&path= -> { path, parent, entries }
      路由以 req.socket.remoteAddress 校验回环，否则 403 { error: '仅限本机访问' }。
entries：目录 + mediaType image/video/audio/text（gif 归一化为 image）；绝对 http 地址在 HTTPS 下给 proxyUrl。
播放：单文件 -> 显示端 showMedia({type:'url',...})；文件夹 -> displayPlaylistRequest。
批量播放：仅回环连接；playlistManager.buildFromLibrary(recursive:false,mode:sequence,sortBy:name,direction:asc)；
          startData loop:false, interval:5, selectedDisplayIds:[请求显示端]；空目录 -> displayPlaylistError。
```

- [ ] **Step 2: 更新 `docs/design/media-library.md`**

在“限制与风险”之后追加实现记录（2026-11-10），逐条写：

```markdown
### 多代理、显示端媒体库与下载子分类（2026-11-10）

- 代理配置改为命名代理列表（最多 20 个），B 站与任务媒体源各自从下拉框选择代理或不使用代理；旧全局代理与布尔开关自动迁移为 `proxy-legacy`，夸克分享不读取代理。
- 显示端新增“媒体库”入口（仅 localhost/127.0.0.1/::1 可见），只读展示本地库与活动任务源，支持单文件播放和文件夹非递归、不循环批量播放；服务端提供回环校验的第二道边界。
- 夸克与 B 站新下载按 `目标库/来源名/分类名/...` 分层，分类名经统一清洗；旧目录与旧下载记录不迁移、不失效。
```

- [ ] **Step 3: 更新 `docs/spec/self-test.md`**

在“自测入口”代码块之前新增章节 `### 多代理、显示端媒体库与下载子分类（2026-11-10）`，包含以下人工项与命令：

```text
1. 设置面板添加两个代理并保存；B 站页签下拉框可切换，刷新页面后选择保持。
2. 删除被引用的代理；来源下拉框回到“不使用代理”，无悬空选择。
3. 旧 config.json（globalWebProxy + providerProxy 布尔值）启动后自动迁移为 webProxies/proxy-legacy。
4. 从 http://127.0.0.1:8081/display.html 打开，确认“媒体库”按钮在“游戏”上方；从局域网 IP 打开按钮不存在。
5. 面板列出本地库与运行中的任务源；进入目录、播放单文件、关闭后画面恢复。
6. 文件夹“批量播放”按顺序播放、播完即停；空目录提示“该目录没有可播放的媒体”。
7. 局域网 IP 直接请求 /api/display-local/libraries 返回 403。
8. 夸克选择分享文件夹后下载，文件落在 目标库/夸克分享/<分类>/；B 站合集下载落在 目标库/B站视频/<合集标题>/；对话框显示“目标：库名 / 来源名 / 分类名”。

node --test tests/web-proxy.test.js tests/web-proxy-settings.test.js tests/display-local-media.test.js tests/display-playlist-request.test.js tests/download-path.test.js tests/quark-directory-downloads.test.js tests/bilibili-download-search.test.js
node --test tests/web-proxy-ui-browser.test.js tests/display-media-library-browser.test.js tests/download-category-browser.test.js tests/task-media-tab-browser.test.js
```

- [ ] **Step 4: 更新 `docs/todo.md`**

在文件末尾追加（该条目保留自测与实机验收，不要删除）：

```markdown
- [ ] [2026-11-10] 多代理/显示端媒体库/下载子分类待实机验收（自测项见 `docs/spec/self-test.md`）
- [ ] [2026-11-10] 待实现：国内媒体任务（红果短剧/番茄小说）与国外媒体任务（YouTube/Pinterest/Pixiv）
```

- [ ] **Step 5: 更新 `changelog.md`**

在文件末尾追加：

```markdown
### 媒体库多代理、显示端媒体库与下载子分类

- ✅ [2026-11-10] 代理配置改为命名代理列表，B 站与任务媒体源可选择代理或不使用代理，旧配置自动迁移
  - 修改 `src/apps/server/modules/media/web-proxy.js`、新增 `web-proxy-settings.js`、`server-app.js`、`upload.html`、`media-library.js`、`websocket.js`、`media-library.css`
- ✅ [2026-11-10] 显示端新增本机“媒体库”入口，只读浏览本地库与任务源，支持单文件播放和文件夹批量播放
  - 新增 `display-local-media.js`、`display-media-library.js`、`display-media-library.css`、`server-app.js` 路由与 WS 消息、`display.html`
- ✅ [2026-11-10] 夸克与 B 站下载按来源名和分类名分层落盘，下载对话框增加目标路径预览
  - 新增 `download-path.js`；修改 `quark-directory-downloads.js`、`bilibili-download-service.js`、`server-app.js`、`media-library.js`
- ✅ [2026-11-10] 单元/路由/浏览器定向测试通过；真实设备与真实 B 站/夸克/代理走线待实机验收
```

- [ ] **Step 6: 创建 `docs/task/2026-11-10_媒体库多代理显示端与下载子分类.md`**

按项目 Task 文档规范写入以下小节（内容与设计文档保持一致）：

```markdown
# 媒体库多代理、显示端媒体库与下载子分类

## 任务描述
实现命名代理列表与按来源选择、显示端本机媒体库浏览播放、夸克/B 站下载目录子分类。

## design 需求
见 docs/superpowers/specs/2026-11-10-media-multi-proxy-display-library-design.md。

## spec 设计
见 docs/spec/media-library.md 对应小节。

## 受影响的功能模块和代码
- 服务端：web-proxy.js、web-proxy-settings.js、display-local-media.js、download-path.js、quark-directory-downloads.js、bilibili-download-service.js、server-app.js
- 控制端：upload.html、media-library.js、websocket.js、media-library.css
- 显示端：display.html、display-media-library.js、display-media-library.css

## 自测用例
见 docs/spec/self-test.md 新增章节。

## 兼容性测试
- 旧 config.json 自动迁移且幂等；旧下载目录与旧记录仍可查询；非回环显示端无入口且 API 返回 403。

## 性能测试
- 显示端目录列表复用现有 provider list；单次最多返回一个目录的内容；代理解析为内存查找。

## 风险评估
- 迁移会改写配置文件中的 network.globalWebProxy（置空）与 providerProxy；需要备份 config.json。
- 显示端批量播放沿用现有列表协议，空目录与生成失败均回错误，不发送空列表。

## 预计工时
1-2 个工作日。
```

- [ ] **Step 7: 全量定向回归**

Run:

```bash
node --test tests/web-proxy.test.js tests/web-proxy-settings.test.js tests/display-local-media.test.js tests/display-playlist-request.test.js tests/download-path.test.js tests/quark-directory-downloads.test.js tests/bilibili-download-search.test.js
node --test tests/web-proxy-ui-browser.test.js tests/display-media-library-browser.test.js tests/download-category-browser.test.js tests/task-media-tab-browser.test.js
```

Expected: 两批均 0 fail；浏览器测试在无 Chromium 时 skip。

- [ ] **Step 8: 静态检查全部改动文件**

Run:

```bash
node --check src/apps/server/modules/media/web-proxy.js
node --check src/apps/server/modules/media/web-proxy-settings.js
node --check src/apps/server/modules/media/display-local-media.js
node --check src/apps/server/modules/media/download-path.js
node --check src/apps/server/modules/media/quark-directory-downloads.js
node --check src/apps/server/modules/media/bilibili-download-service.js
node --check src/apps/server/boot/server-app.js
node --check src/apps/web-mediacenter/ui/public/js/media-library.js
node --check src/apps/web-mediacenter/ui/public/js/websocket.js
node --check src/apps/web-mediacenter/ui/public/js/display-media-library.js
```

Expected: 全部退出码 0。

- [ ] **Step 9: 记录结果（不提交 git）**

---

## Self-Review

- **Spec coverage:** 多代理数据模型/迁移/协议/UI/测试 → Task 1-3；显示端入口/API/面板/单文件/批量/安全/测试 → Task 4-6；下载路径/清洗/协议/预览/切换分享文件夹后分类变化/测试 → Task 7-8；文档与自测 → Task 9。
- **Placeholder scan:** 所有代码步骤含完整实现或精确替换锚点；无 TBD/TODO。
- **Type consistency:** `webProxies/providerProxy/proxyId`、`displayPlaylistRequest/displayPlaylistError`、`sanitizeCategoryName`、`category` 在各任务中命名一致；`resolveSourceProxyUrl` 在 Task 1 定义的参数名与 Task 2 调用一致。
- **已知取舍:** gif 归一化为 image 以复用显示端图片分支；`interval: 5` 按设计文档写入 startData；旧配置迁移通过 `config.set` 三次落盘（现有配置服务无批量接口）。
