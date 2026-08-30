# Chat2API 核心内置任务 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Chat2API 的完整核心能力移植到 AASC，作为不依赖外部 Chat2API/Electron 进程的 `chat2api.proxy` 常驻内置任务运行。

**Architecture:** 保留 Chat2API 核心源码快照和许可证信息，将 Provider、OAuth、账号、负载均衡、模型映射和 OpenAI 兼容协议封装在 AASC 的 Chat2API 模块中。AASC 任务引擎负责启动/停止独立代理 HTTP Server，AASC 控制端负责配置和管理，不加载 Chat2API 的 Electron、React、IPC、托盘或窗口模块。

**Tech Stack:** Node.js CommonJS、原生 HTTP/Express、Axios、HTTP SSE、AASC TaskManager、AASC UserConfig 存储、浏览器 OAuth 回调。

**Spec:** `docs/design/chat2api-builtin-task.md`、`docs/spec/chat2api-builtin-task.md`

## Global Constraints

- 运行时不读取 `/mnt/Chat2API`，不启动 Chat2API Electron 或独立 Chat2API 进程。
- `chat2api.proxy` 使用 `mode=service`，默认监听 `127.0.0.1:8080`，端口和地址可配置。
- 上游核心来源文件不直接混入 AASC 业务文件；AASC 差异放在适配层或明确的移植补丁中。
- Chat2API GPL-3.0 许可证、版权、上游版本和修改说明必须随移植代码发布。
- 凭据、Cookie、Token 和 API Key 不得写入普通日志、任务参数或控制端列表；文件使用用户私有权限并原子写入。
- Provider 失败必须支持账号冷却/故障转移；流式和非流式响应都必须保持 OpenAI 兼容格式。
- 旧 AASC LLM profile、Pi Agent、统一 TTS 和其他内置任务的行为保持不变。
- 代码使用 `const/let`、`async/await` 和 `try/catch`，新增注释使用中文说明数据流和安全边界。

## 文件结构与职责

### 上游快照

- Create: `3rd/chat2api-core/UPSTREAM.md` — 上游仓库、版本、抽取清单、同步方式和本地修改记录。
- Create: `3rd/chat2api-core/LICENSE` — Chat2API GPL-3.0 原文。
- Create: `3rd/chat2api-core/NOTICE.md` — Chat2API 版权、AASC 移植说明和发布源代码位置。
- Create: `3rd/chat2api-core/` — 仅保留 Provider、OAuth、代理、账号、负载均衡、模型映射、流式和工具协议所需源码。

### AASC 服务模块

- Create: `src/apps/server/modules/chat2api/chat2api-data-store.js` — 配置、Provider、账号、API Key 和 OAuth 临时状态的文件存储。
- Create: `src/apps/server/modules/chat2api/chat2api-secret.js` — 敏感字段脱敏、文件权限和原子写入辅助逻辑。
- Create: `src/apps/server/modules/chat2api/chat2api-core-adapter.js` — 上游核心模块与 AASC 存储、日志、HTTP 生命周期的适配边界。
- Create: `src/apps/server/modules/chat2api/chat2api-proxy-service.js` — 独立代理服务的启动、状态、连接跟踪和停止。
- Create: `src/apps/server/modules/chat2api/chat2api-management-service.js` — Provider、账号、模型映射、API Key 和导入管理。
- Create: `src/apps/server/modules/chat2api/chat2api-oauth-service.js` — OAuth state、浏览器登录、回调、超时和凭据保存。
- Create: `src/apps/server/modules/chat2api/chat2api-routes.js` — 代理路由和管理路由的 HTTP 装配。
- Create: `src/apps/server/modules/chat2api/chat2api-upstream-sync.js` — 上游版本检查、文件清单校验和同步测试入口。
- Modify: `src/apps/server/modules/config/user-config-paths.js` — 增加 Chat2API 专用用户配置目录。

### 内置任务与控制端

- Create: `src/apps/server/modules/task-engine/builtin-tasks/chat2api-proxy.js` — `mode=service` 内置任务定义、参数、widget 和 stop 控制器。
- Modify: `src/apps/server/modules/task-engine/builtin-tasks/registry.js` — 注册 `chat2api.proxy`。
- Modify: `src/apps/server/modules/task-engine/task-manager.js` — 仅在需要注入 Chat2API 管理回调时扩展服务上下文，保持通用任务生命周期不变。
- Create: `src/apps/web-mediacenter/ui/public/js/chat2api.js` — 控制端 Provider、账号、OAuth、API Key 和代理状态面板。
- Modify: `src/apps/web-mediacenter/ui/public/js/task-panel.js` — 注册 Chat2API widget 的管理动作和脱敏刷新。
- Modify: `src/apps/web-mediacenter/ui/public/upload.html` — 加载 Chat2API 控制面板脚本和入口样式。

### 测试与文档

- Create: `src/apps/server/modules/chat2api/chat2api-data-store.test.js`
- Create: `src/apps/server/modules/chat2api/chat2api-proxy-service.test.js`
- Create: `src/apps/server/modules/chat2api/chat2api-management-service.test.js`
- Create: `src/apps/server/modules/chat2api/chat2api-core-adapter.test.js`
- Create: `src/apps/server/modules/chat2api/chat2api-oauth-service.test.js`
- Create: `src/apps/server/modules/chat2api/chat2api-upstream-sync.test.js`
- Create: `tests/chat2api-builtin-task.test.js`
- Modify: `docs/design.md`、`docs/spec.md`、`docs/todo.md`、`changelog.md`

---

### Task 1: 固定上游来源并建立移植边界

**Files:**
- Create: `3rd/chat2api-core/UPSTREAM.md`
- Create: `3rd/chat2api-core/LICENSE`
- Create: `3rd/chat2api-core/NOTICE.md`
- Create: `src/apps/server/modules/chat2api/chat2api-upstream-sync.js`
- Test: `src/apps/server/modules/chat2api/chat2api-upstream-sync.test.js`

**Interfaces:**
- Produces `readUpstreamManifest()`，返回 `{ repository, version, commit, includedPaths, excludedPaths, license }`。
- Produces `validateUpstreamTree(rootDir)`，返回 `{ valid, missing, forbidden, licenseValid }`。

- [ ] **Step 1: Write the failing manifest test**

```js
test('上游清单必须记录版本、许可证和排除的 Electron 文件', () => {
    const manifest = readUpstreamManifest();
    assert.equal(manifest.license, 'GPL-3.0');
    assert.ok(manifest.version);
    assert.ok(manifest.commit);
    assert.ok(manifest.excludedPaths.some((item) => item.includes('electron')));
    assert.ok(manifest.excludedPaths.some((item) => item.includes('renderer')));
});
```

- [ ] **Step 2: Run the manifest test and verify it fails**

Run: `node --test src/apps/server/modules/chat2api/chat2api-upstream-sync.test.js`

Expected: FAIL because the upstream manifest reader and vendor directory do not exist。

- [ ] **Step 3: Copy only the required upstream source and license**

保留 Chat2API 的 Provider、OAuth、proxy adapter、forwarder、stream、model mapper、load balancer、账号类型和工具协议；排除 `src/main/index.ts`、`ipc`、`renderer`、`window`、`tray`、`updater` 以及 Electron 专属 store。记录当前上游 commit，不修改 AASC 业务文件。

- [ ] **Step 4: Implement manifest validation**

`validateUpstreamTree(rootDir)` 读取 `UPSTREAM.md` 和路径清单，拒绝缺少 `LICENSE`、混入 Electron/Renderer 文件或版本字段为空的快照；错误返回包含具体路径。

- [ ] **Step 5: Run the test and commit the import boundary**

Run: `node --test src/apps/server/modules/chat2api/chat2api-upstream-sync.test.js`

Expected: PASS；Commit: `chore(chat2api): 固定上游核心快照和许可证边界`。

### Task 2: 实现 AASC 安全数据层

**Files:**
- Modify: `src/apps/server/modules/config/user-config-paths.js`
- Create: `src/apps/server/modules/chat2api/chat2api-secret.js`
- Create: `src/apps/server/modules/chat2api/chat2api-data-store.js`
- Test: `src/apps/server/modules/chat2api/chat2api-data-store.test.js`

**Interfaces:**
- Produces `createChat2ApiDataStore({ rootDir })`，提供 `readConfig()`、`writeConfig(config)`、`listProviders()`、`saveProvider(provider)`、`listAccounts()`、`saveAccount(account)`、`listApiKeys()`、`saveApiKeys(keys)`、`validateApiKey(value)`、`readOAuthState(state)`、`writeOAuthState(state)` 和 `deleteOAuthState(id)`。
- Produces `sanitizeAccount(account)`、`maskApiKey(key)` 和 `atomicWriteJson(filePath, value)`。

- [ ] **Step 1: Write failing storage and secrecy tests**

```js
const fs = require('node:fs');
const path = require('node:path');

test('数据层写入私有文件并脱敏返回账号', async () => {
    const tempDir = await createTempDir();
    const store = createChat2ApiDataStore({ rootDir: tempDir });
    await store.saveAccount({ id: 'a1', providerId: 'deepseek', token: 'secret-token' });
    const account = (await store.listAccounts())[0];
    assert.equal(account.token, undefined);
    assert.equal(account.secretConfigured, true);
    assert.equal((await fs.promises.stat(path.join(tempDir, 'accounts.json'))).mode & 0o077, 0);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test src/apps/server/modules/chat2api/chat2api-data-store.test.js`

Expected: FAIL because the store and secret helpers do not exist。

- [ ] **Step 3: Implement private, atomic JSON storage**

所有文件写入临时文件后使用 rename 原子替换；目录和文件权限分别为 `0700`、`0600`。列表接口只返回 Provider/账号 ID、启用状态、健康状态和脱敏字段，不返回 Token、Cookie、refreshToken 或完整 API Key。

- [ ] **Step 4: Implement merge-safe import primitives**

加入 `previewImport(data)` 和 `mergeImport(data, confirmed)`；只合并导入文件明确提供的 Provider、账号和模型映射，不删除本地未出现在导入文件中的数据，`confirmed !== true` 时拒绝写入。

- [ ] **Step 5: Run storage, permission and import tests**

Run: `node --test src/apps/server/modules/chat2api/chat2api-data-store.test.js`

Expected: PASS；Commit: `feat(chat2api): 增加安全配置和凭据存储`。

### Task 3: 接入 Provider、模型映射和多账号负载均衡

**Files:**
- Create: `src/apps/server/modules/chat2api/chat2api-core-adapter.js`
- Modify: `3rd/chat2api-core/` selected Provider adapter files only when a boundary shim is required
- Create: `src/apps/server/modules/chat2api/chat2api-management-service.js`
- Test: `src/apps/server/modules/chat2api/chat2api-management-service.test.js`

**Interfaces:**
- Produces `createChat2ApiCore({ dataStore, logger })`，提供 `listProviders()`、`listModels()`、`upsertProvider(input)`、`deleteProvider(id)`、`listAccounts(providerId)`、`upsertAccount(input)`、`setAccountEnabled(id, enabled)`、`deleteAccount(id)`、`checkAccount(id)` 和 `complete(request, responseContext)`。
- `complete(request, responseContext)` 根据 `request.model` 返回标准 OpenAI 非流式或 SSE 流式结果；不把 Provider 私有字段暴露给调用方。
- `createChat2ApiCore` 接收测试用 `providerAdapterFactory({ provider, account })`，生产环境由 Provider 注册表提供，测试环境由 fake adapter 控制成功和失败。
- Produces `createChat2ApiManagementService({ core, dataStore, oauth })`，提供 `getConfig()`、`updateConfig(input)`、`listProviders()`、`saveProvider(input)`、`listAccounts(providerId)`、`saveAccount(input)`、`setApiKeyEnabled(id, enabled)`、`previewImport(data)` 和 `confirmImport(data)`。

- [ ] **Step 1: Write failing provider registry and load-balancer tests**

```js
test('模型映射选择启用账号并在失败后切换下一账号', async () => {
    const dataStore = createFakeDataStore();
    const core = createChat2ApiCore({
        dataStore,
        logger: () => {},
        providerAdapterFactory: ({ account }) => ({
            complete: async () => {
                if (account.id === 'a1') throw new Error('fixture account failure');
                return { text: 'ok', accountId: account.id };
            }
        })
    });
    await core.upsertProvider({ id: 'deepseek', enabled: true, models: ['deepseek-chat'] });
    await core.upsertAccount({ id: 'a1', providerId: 'deepseek', enabled: true });
    await core.upsertAccount({ id: 'a2', providerId: 'deepseek', enabled: true });
    const result = await core.complete({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] }, { forceFirstAccountFailure: true });
    assert.equal(result.providerId, 'deepseek');
    assert.equal(result.accountId, 'a2');
});
```

测试文件在该用例前定义 `createFakeDataStore()`，其 `listProviders()`、`listAccounts(providerId)`、`saveProvider()` 和 `saveAccount()` 使用内存数组实现；生产实现仍只使用 Task 2 的文件数据层。

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test src/apps/server/modules/chat2api/chat2api-management-service.test.js`

Expected: FAIL because the core adapter and account routing do not exist。

- [ ] **Step 3: Adapt the nine current Provider adapters**

为 DeepSeek、GLM、Kimi、Mimo、MiniMax、Perplexity、Qwen、Qwen AI、Z.ai 统一输入 `{ provider, account, request }`，统一输出文本、工具调用、usage、错误分类和流式 chunk。Provider adapter 只能从 `dataStore` 获取凭据，不读取 Electron store 或外部 Chat2API 路径。

- [ ] **Step 4: Implement model mapping and account selection**

支持精确模型名和通配符映射；只在 Provider、账号和模型均启用时选择；失败账号进入冷却，按轮询/填充优先/故障转移策略选择下一账号，并保留失败原因摘要。

- [ ] **Step 5: Run provider contract tests and commit**

Run: `node --test src/apps/server/modules/chat2api/chat2api-management-service.test.js src/apps/server/modules/chat2api/chat2api-core-adapter.test.js`

Expected: PASS；Commit: `feat(chat2api): 接入 Provider 和多账号路由`。

### Task 4: 实现 OpenAI 兼容代理服务和 API Key 鉴权

**Files:**
- Create: `src/apps/server/modules/chat2api/chat2api-proxy-service.js`
- Create: `src/apps/server/modules/chat2api/chat2api-routes.js`
- Create: `src/apps/server/modules/chat2api/chat2api-proxy-service.test.js`
- Modify: `src/apps/server/boot/server-app.js` only to expose management route registration if required by existing HTTP API assembly

**Interfaces:**
- Produces `createChat2ApiProxyService({ host, port, core, dataStore, logger })`，提供 `start()`、`stop()`、`getStatus()` 和 `getStatistics()`。
- `registerChat2ApiRoutes(app, services)` 注册 `/v1/chat/completions`、`/v1/completions`、`/v1/models`、`/health` 和管理路由。

- [ ] **Step 1: Write failing route and lifecycle tests**

```js
const core = createFakeCore();
const dataStore = createFakeDataStore();

test('代理服务启动后提供 models 和 health，停止后释放端口', async () => {
    const service = createChat2ApiProxyService({
        host: '127.0.0.1',
        port: 0,
        core,
        dataStore,
        logger: () => {}
    });
    await service.start();
    assert.equal((await fetch(`${service.getStatus().baseUrl}/health`)).status, 200);
    assert.equal((await fetch(`${service.getStatus().baseUrl}/v1/models`)).status, 200);
    await service.stop();
    await assert.rejects(fetch(`${service.getStatus().baseUrl}/health`));
});
```

测试文件提供 `createFakeCore()`，其中 `listModels()` 返回空数组、`complete()` 返回固定 OpenAI 文本；服务启动后 `getStatus().baseUrl` 使用系统分配的实际端口。

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test src/apps/server/modules/chat2api/chat2api-proxy-service.test.js`

Expected: FAIL because the proxy service does not exist。

- [ ] **Step 3: Implement server lifecycle and connection tracking**

独立 HTTP Server 绑定配置的 host/port；启动重复调用返回同一个状态；停止时关闭 OAuth callback server、SSE 响应和 listener，保证端口释放。状态包含 `isRunning`、`host`、`port`、`startedAt`、`activeConnections`。

- [ ] **Step 4: Implement OpenAI routes and API Key middleware**

请求校验 `model` 和非空 `messages`；API Key 开启时支持 `Authorization: Bearer`、`X-API-Key` 和 `api_key` 查询参数，统一返回 OpenAI error 结构；完整密钥只在创建响应中返回一次。

- [ ] **Step 5: Implement streaming, response conversion and statistics**

非流式返回 `id/object/created/model/choices/usage`；流式按 `data: {...}` 和 `data: [DONE]` 输出，客户端断开时取消 Provider 请求；记录成功、失败、延迟、Provider 和账号统计，但不保存完整 prompt/response。

- [ ] **Step 6: Run proxy tests and commit**

Run: `node --test src/apps/server/modules/chat2api/chat2api-proxy-service.test.js`

Expected: PASS；Commit: `feat(chat2api): 提供 OpenAI 兼容代理服务`。

### Task 5: 实现 OAuth 登录、账号刷新和数据导入

**Files:**
- Create: `src/apps/server/modules/chat2api/chat2api-oauth-service.js`
- Create: `src/apps/server/modules/chat2api/chat2api-oauth-service.test.js`
- Modify: `src/apps/server/modules/chat2api/chat2api-management-service.js`
- Modify: `src/apps/server/modules/chat2api/chat2api-routes.js`

**Interfaces:**
- Produces `createChat2ApiOAuthService({ core, dataStore, browser, clock })`，提供 `start(providerId)`、`handleCallback(providerId, query)`、`cancel(id)`、`cleanupExpired()` 和 `getStatus(id)`。

- [ ] **Step 1: Write failing OAuth state tests**

```js
test('OAuth state 只能使用一次并绑定 Provider', async () => {
    const oauth = createChat2ApiOAuthService({
        core: createFakeCore(),
        dataStore: createFakeDataStore(),
        browser: { open: async () => true },
        clock: () => Date.now(),
        stateTtlMs: 60000
    });
    const session = await oauth.start('deepseek');
    await assert.rejects(oauth.handleCallback('glm', { state: session.state }), /Provider/);
    await oauth.handleCallback('deepseek', { state: session.state, code: 'fixture-code' });
    await assert.rejects(oauth.handleCallback('deepseek', { state: session.state, code: 'fixture-code' }), /state/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test src/apps/server/modules/chat2api/chat2api-oauth-service.test.js`

Expected: FAIL because OAuth state management does not exist。

- [ ] **Step 3: Implement state, timeout and callback validation**

每个登录会话生成随机 state、Provider、创建时间、过期时间和回调端口；回调必须验证 state、Provider 和未使用状态，成功/失败/超时后立即删除临时状态。

- [ ] **Step 4: Adapt OAuth provider flows and browser handoff**

复用上游 OAuth adapters，使用 AASC 注入的 browser opener 或返回登录 URL；成功后只将标准化凭据交给 `dataStore.saveAccount()`，不把原始 callback query 写入日志。

- [ ] **Step 5: Add account refresh and Chat2API data import**

管理服务提供账号健康检查、Token 刷新、Chat2API 导出预览和确认导入；导入字段映射失败时返回字段级错误且不写入部分数据。

- [ ] **Step 6: Run OAuth and import tests and commit**

Run: `node --test src/apps/server/modules/chat2api/chat2api-oauth-service.test.js src/apps/server/modules/chat2api/chat2api-data-store.test.js`

Expected: PASS；Commit: `feat(chat2api): 增加 OAuth 和账号导入`。

### Task 6: 将代理封装为 AASC 常驻内置任务

**Files:**
- Create: `src/apps/server/modules/task-engine/builtin-tasks/chat2api-proxy.js`
- Modify: `src/apps/server/modules/task-engine/builtin-tasks/registry.js`
- Create: `tests/chat2api-builtin-task.test.js`
- Modify: `docs/design.md`、`docs/spec.md`、`docs/todo.md`、`changelog.md`

**Interfaces:**
- `chat2apiProxyTask.run(context)` 返回 `{ type: 'service', stop: async () => void }`。
- Widget action `start`、`stop`、`refresh`、`saveConfig`、`importPreview`、`importConfirm`、`oauthStart` 和 `healthCheck` 通过 `onWidgetAction` 注册。

- [ ] **Step 1: Write failing task lifecycle tests**

```js
function fakeTaskContext() {
    return {
        params: { host: '127.0.0.1', port: 0 },
        taskName: 'chat2api.proxy',
        taskIO: { async getTaskConfig() { return {}; } },
        onWidgetAction() {}
    };
}

test('chat2api.proxy 是可停止的常驻服务任务', async () => {
    const task = registry.getTask('chat2api.proxy');
    assert.equal(task.mode, 'service');
    const result = await task.run(fakeTaskContext());
    assert.equal(result.type, 'service');
    await result.stop();
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test tests/chat2api-builtin-task.test.js`

Expected: FAIL because the task is not registered。

- [ ] **Step 3: Implement task startup and stop binding**

任务读取 `taskIO.getTaskConfig(taskName)`，合并端口、host、超时、负载均衡和 API Key 配置；创建服务并启动代理。`stop()` 必须调用代理、OAuth、Provider 和 SSE 清理函数。

- [ ] **Step 4: Implement widget state and actions**

widget 只返回脱敏 Provider/账号/API Key 状态、代理地址、连接数、统计和错误摘要；保存配置时先校验端口和策略，再原子更新任务配置，不把凭据放入任务索引。

- [ ] **Step 5: Register task and update project docs**

将任务加入 registry、任务列表和控制端导航；更新 design/spec 索引、todo 完成项和 changelog，明确实际文件、Provider 清单和 GPL 说明。

- [ ] **Step 6: Run task lifecycle tests and commit**

Run: `node --test tests/chat2api-builtin-task.test.js src/apps/server/modules/chat2api/chat2api-proxy-service.test.js`

Expected: PASS；Commit: `feat(task): 增加 Chat2API 代理常驻内置任务`。

### Task 7: 增加 AASC 控制端完整管理面板

**Files:**
- Create: `src/apps/web-mediacenter/ui/public/js/chat2api.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/task-panel.js`
- Modify: `src/apps/web-mediacenter/ui/public/upload.html`
- Create: `tests/chat2api-control-panel.test.js`

**Interfaces:**
- `Chat2ApiPanel.load(instanceId)` 获取状态和脱敏配置。
- `Chat2ApiPanel.saveConfig(instanceId, config)`、`saveProvider(provider)`、`saveAccount(account)`、`startOAuth(providerId)`、`createApiKey(name)` 和 `importData(file)` 只通过 task widget action 或 AASC 管理 API 通信。

- [ ] **Step 1: Write failing UI contract tests**

```js
const fs = require('node:fs');

test('控制端面板包含 Provider、OAuth、账号和 API Key 管理入口', () => {
    const read = (file) => fs.readFileSync(file, 'utf8');
    const html = read('src/apps/web-mediacenter/ui/public/upload.html');
    const panel = read('src/apps/web-mediacenter/ui/public/js/chat2api.js');
    assert.match(html, /Chat2ApiPanel/);
    assert.match(panel, /startOAuth/);
    assert.match(panel, /createApiKey/);
    assert.match(panel, /mask|脱敏/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test tests/chat2api-control-panel.test.js`

Expected: FAIL because the control panel does not exist。

- [ ] **Step 3: Implement status, configuration and Provider views**

状态区显示运行地址、端口、连接数、请求统计和上游版本；Provider 区支持启用/禁用、模型映射和删除前关联检查；所有输入通过统一 action 提交。

- [ ] **Step 4: Implement account, OAuth and API Key views**

账号列表只显示脱敏信息和健康状态；OAuth 按 Provider 显示登录进度和错误；API Key 创建后只显示一次完整值，之后仅显示前后缀和启用状态。

- [ ] **Step 5: Implement import preview and confirmation**

选择 Chat2API 导出文件后先显示 Provider/账号/模型映射预览；确认后提交导入，失败显示字段错误，不清空原有配置。

- [ ] **Step 6: Run UI contracts and commit**

Run: `node --test tests/chat2api-control-panel.test.js tests/chat2api-builtin-task.test.js`

Expected: PASS；Commit: `feat(ui): 增加 Chat2API 内置任务管理面板`。

### Task 8: 完成同步工具、全量回归和发布检查

**Files:**
- Modify: `src/apps/server/modules/chat2api/chat2api-upstream-sync.js`
- Create: `src/scripts/chat2api-sync-check.js`
- Create: `tests/chat2api-regression.test.js`
- Modify: `package.json`
- Modify: `docs/task/2026-08-30_Chat2API核心内置任务.md`
- Modify: `docs/design/chat2api-builtin-task.md`
- Modify: `docs/spec/chat2api-builtin-task.md`

**Interfaces:**
- `npm run check:chat2api` 校验上游清单、排除路径、许可证、AASC 适配层契约和依赖锁定。
- `runChat2ApiRegression()` 覆盖任务生命周期、代理协议、Provider、OAuth、API Key、导入和敏感信息脱敏。

- [ ] **Step 1: Write failing sync-check and regression tests**

```js
const projectRoot = process.cwd();

test('同步检查拒绝 Electron 文件和未记录的上游版本', async () => {
    const result = await runChat2ApiSyncCheck({ rootDir: projectRoot });
    assert.equal(result.forbidden.length, 0);
    assert.ok(result.upstream.commit);
    assert.equal(result.license, 'GPL-3.0');
});
```

- [ ] **Step 2: Run the checks and verify the new command fails**

Run: `npm run check:chat2api`

Expected: FAIL because the sync script and npm script do not exist。

- [ ] **Step 3: Implement deterministic upstream and dependency checks**

检查 `3rd/chat2api-core/UPSTREAM.md` 的 commit、许可证和 included/excluded paths；检查 AASC package 中的运行依赖版本已锁定；检查源码中不存在 `/mnt/Chat2API`、Electron IPC、Renderer 或外部 Chat2API `node_modules` 引用。

- [ ] **Step 4: Implement full regression harness**

使用 fake Provider、fake OAuth browser、fake clock 和随机可用端口测试成功与失败路径；真实 Provider 只通过显式环境变量启用，不在默认测试中访问远程账号。

- [ ] **Step 5: Run required verification**

Run:

```bash
npm run check:chat2api
node --test src/apps/server/modules/chat2api/*.test.js tests/chat2api-*.test.js
node --check src/apps/server/modules/chat2api/chat2api-proxy-service.js
node --check src/apps/server/modules/task-engine/builtin-tasks/chat2api-proxy.js
git diff --check
```

Expected: all tests pass; no forbidden runtime dependency or sensitive fixture remains。

- [ ] **Step 6: Update final documents and commit**

将任务文档从待处理改为已完成，记录实际 Provider、OAuth 覆盖范围、测试数量、上游版本和 GPL 发布说明；Commit: `feat(chat2api): 完成核心内置任务集成`。

## Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-30-chat2api-builtin-task.md`. Before implementation, choose one execution mode:

1. Subagent-Driven：按任务逐项执行，每项完成后独立复核。
2. Inline Execution：当前会话按任务批次执行，在关键节点暂停复核。
