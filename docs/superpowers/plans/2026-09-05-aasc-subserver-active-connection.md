# AASC 子服务器主动连接架构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AASC 服务器节点改为子服务器主动连接主服务器 `/server` WebSocket，同时保持 HTTP `/server` 代码下发、`/control` 控制端和现有双进程启动模型兼容。

**Architecture:** 主服务器继续在同一 HTTPS server 上提供 HTTP `/server` 清单/代码包，并在 WebSocket Upgrade `/server` 接收子服务器连接。子服务器服务进程使用独立 `AascNodeConnector` 主动建立长连接，注册、心跳和远程请求通过连接完成；节点实际媒体地址只用于显示端和网页访问。

**Tech Stack:** Node.js CommonJS、`ws`、Express、Node.js `node:test`、现有 Termux runit Bootstrap。

**Spec:** `docs/superpowers/specs/2026-09-05-aasc-subserver-active-connection-design.md`

## Global Constraints

- 主服务器入口固定为 `https://192.168.1.39:8081/`，子服务器 WebSocket 为 `wss://主服务器/server`。
- HTTP `/server` 和 `/server/package` 继续负责代码清单和代码包，不能改成 WebSocket 专用路径。
- `aasc.role` 只有 `main` 和 `subserver`，默认 `main`；主服务器不能主动请求子服务器 URL。
- 子服务器继续使用 `server-launcher.js` + `server-app.js` 两进程，不创建第三个常驻 Node 服务。
- 暂不实现权限认证、自动发现、最近节点算法、媒体文件同步和主服务器故障转移。
- 使用 `const/let`、`async/await`、`try-catch` 和中文详细注释，不新增第三方依赖。
- 保留 `/display`、`/control`、`/runtime-bridge`；控制页面正式入口为 `/control`，`/upload` 只重定向兼容。

---

### Task 1: 定义 AASC 节点消息协议与地址转换

**Files:**
- Create: `src/framework/aasc/node-protocol.js`
- Test: `tests/aasc-node-protocol.test.js`

**Interfaces:**
- Produces `NODE_WS_PATH`, `createNodeMessage(type, payload, requestId)`, `normalizeNodeRegistration(input)`, `toNodeWebSocketUrl(baseUrl)` and `isNodeMessage(value)`.

- [ ] **Step 1: Write the failing test**

```js
test('将主服务器 HTTPS 地址转换为 /server WebSocket 地址', () => {
    assert.equal(
        toNodeWebSocketUrl('https://192.168.1.39:8081/'),
        'wss://192.168.1.39:8081/server'
    );
});

test('节点注册消息只保留受控字段', () => {
    const result = normalizeNodeRegistration({
        nodeId: 'node-a', name: '客厅', url: 'https://node-a:8081', version: '1.0.0',
        capabilities: { mediaLibrary: true }, metadata: { role: 'subserver' }, secret: 'drop'
    });
    assert.deepEqual(result, {
        nodeId: 'node-a', name: '客厅', url: 'https://node-a:8081', version: '1.0.0',
        capabilities: { mediaLibrary: true }, metadata: { role: 'subserver' }
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/aasc-node-protocol.test.js`
Expected: FAIL because `node-protocol.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
const NODE_WS_PATH = '/server';

function toNodeWebSocketUrl(baseUrl) {
    const url = new URL(baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = NODE_WS_PATH;
    url.search = '';
    url.hash = '';
    return url.toString();
}

function createNodeMessage(type, payload = {}, requestId = null) {
    return { type, requestId, timestamp: Date.now(), payload };
}
```

实现注册字段校验、深复制和消息类型校验，拒绝数组、空 `nodeId`、非法地址和未知顶层字段。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/aasc-node-protocol.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/framework/aasc/node-protocol.js tests/aasc-node-protocol.test.js
git commit -m "feat: 定义 AASC 节点消息协议"
```

### Task 2: 实现子服务器主动连接客户端

**Files:**
- Create: `src/framework/aasc/node-connector.js`
- Test: `tests/aasc-node-connector.test.js`

**Interfaces:**
- Consumes `node-protocol.js`。
- Produces `new AascNodeConnector(options)`, `start()`, `stop()`, `send(type, payload)`, `getState()`。
- `options.onRequest({ type, requestId, payload })` 返回结果后自动发送 `node.response`。

- [ ] **Step 1: Write the failing test**

```js
test('连接成功后发送注册并按间隔发送心跳', async () => {
    const socket = new FakeWebSocket();
    const connector = new AascNodeConnector({
        WebSocketClass: class { constructor() { return socket; } },
        mainServerUrl: 'https://main.test:8081', nodeId: 'node-a',
        nodeName: '客厅', advertisedUrl: 'https://node-a:8081',
        heartbeatIntervalMs: 10, reconnectMinMs: 10, reconnectMaxMs: 20,
        schedule: (callback) => { callback(); return 1; }, clearSchedule() {}
    });
    connector.start();
    socket.open();
    assert.equal(JSON.parse(socket.sent[0]).type, 'node.register');
    assert.equal(JSON.parse(socket.sent[1]).type, 'node.heartbeat');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/aasc-node-connector.test.js`
Expected: FAIL because `AascNodeConnector` does not exist.

- [ ] **Step 3: Write minimal implementation**

实现以下状态机：`idle → connecting → connected → reconnecting → stopped`。连接成功发送 `node.register`；收到 `node.registered` 后启动心跳；断开时清理心跳和未完成请求并按 1 秒起步、30 秒封顶的指数退避重连。HTTPS 主服务器使用 `rejectUnauthorized: false` 兼容当前局域网自签名证书，但该行为集中在连接客户端，不扩散到其他 HTTP 请求。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/aasc-node-connector.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/framework/aasc/node-connector.js tests/aasc-node-connector.test.js
git commit -m "feat: 增加 AASC 子服务器主动连接客户端"
```

### Task 3: 扩展节点注册表保存连接状态

**Files:**
- Modify: `src/framework/aasc/server-registry.js`
- Test: `tests/aasc-server-registry.test.js`

**Interfaces:**
- Produces `attachConnection(nodeId, connection)`, `detachConnection(nodeId, connection)`, `getConnection(nodeId)`, `request(nodeId, type, payload, timeoutMs)`。
- Snapshot 继续不返回 WebSocket、请求表和内部连接对象。

- [ ] **Step 1: Write the failing test**

```js
test('新连接接管同节点旧连接并支持有限时请求', async () => {
    const registry = new AascServerRegistry({ now: () => 1000 });
    registry.register({ nodeId: 'node-a', url: 'https://node-a:8081' });
    const oldConnection = { request: async () => 'old' };
    const newConnection = { request: async (type, payload) => ({ type, payload }) };
    registry.attachConnection('node-a', oldConnection);
    registry.attachConnection('node-a', newConnection);
    assert.equal(registry.getConnection('node-a'), newConnection);
    assert.deepEqual(await registry.request('node-a', 'media.index.local', { path: '/' }), {
        type: 'media.index.local', payload: { path: '/' }
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/aasc-server-registry.test.js`
Expected: FAIL because connection methods do not exist。

- [ ] **Step 3: Write minimal implementation**

为每条节点记录增加内部 `connection` 和 `connectionGeneration`，新连接关闭旧连接并更新在线状态；`detachConnection` 只允许当前连接改变状态；`request` 检查在线连接并将超时转换为结构化错误。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/aasc-server-registry.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/framework/aasc/server-registry.js tests/aasc-server-registry.test.js
git commit -m "feat: 让 AASC 注册表管理节点连接"
```

### Task 4: 在主服务器 `/server` 接收子服务器 WebSocket

**Files:**
- Modify: `src/apps/server/boot/server-app.js`
- Modify: `tests/server-api-contract.test.js`
- Create: `tests/aasc-node-server-contract.test.js`

**Interfaces:**
- Consumes `AascServerRegistry` connection API and `node-protocol.js`。
- Produces HTTP `/server`、`/server/package` 原行为，以及 WebSocket `/server` 的 `node.register`、`node.heartbeat`、`node.response` 处理。

- [ ] **Step 1: Write the failing test**

```js
test('服务器同时保留 HTTP /server 并声明 WebSocket /server 节点入口', () => {
    const source = fs.readFileSync(path.join(root, 'src/apps/server/boot/server-app.js'), 'utf8');
    assert.match(source, /app\.get\(['"]\/server['"]/);
    assert.match(source, /url === ['"]\/server['"]/);
    assert.match(source, /node\.register/);
    assert.match(source, /node\.heartbeat/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/aasc-node-server-contract.test.js`
Expected: FAIL because the WebSocket branch and node messages do not exist。

- [ ] **Step 3: Write minimal implementation**

在 `wss.on('connection')` 中优先处理 `/server`：首条消息必须是 `node.register`；注册成功后创建会话请求表，接收心跳刷新注册表，接收响应完成主服务器请求；连接关闭时校验连接身份并标记离线。HTTP Express 路由不改，确保普通 GET `/server` 仍进入 `sendServerReleaseManifest`。

主服务器 `GET /api/aasc/servers` 只返回主动连接注册表节点；旧 `/api/subservers` 保留但不再注入 AASC 动态目录。主服务器启动仍登记 `main-server`，不创建 `AascNodeConnector`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/aasc-node-server-contract.test.js tests/server-api-contract.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/apps/server/boot/server-app.js tests/aasc-node-server-contract.test.js tests/server-api-contract.test.js
git commit -m "feat: 接收 AASC 子服务器主动连接"
```

### Task 5: 按 `aasc.role` 启动子服务器连接客户端

**Files:**
- Modify: `src/apps/server/modules/config/config-app-service.js`
- Modify: `src/apps/server/boot/server-app.js`
- Modify: `tests/server-api-contract.test.js`
- Test: `tests/aasc-node-connector.test.js`

**Interfaces:**
- Consumes `AascNodeConnector`。
- Produces配置：`aasc.role`、`mainServerUrl`、`nodeId`、`nodeName`、`advertisedUrl`、`heartbeatIntervalMs`、`reconnectMinMs`、`reconnectMaxMs`。

- [ ] **Step 1: Write the failing test**

```js
test('默认服务器角色为 main 并提供 AASC 主服务器地址配置', () => {
    const source = fs.readFileSync(path.join(root, 'src/apps/server/modules/config/config-app-service.js'), 'utf8');
    assert.match(source, /aasc:/);
    assert.match(source, /role:\s*['"]main['"]/);
    assert.match(source, /mainServerUrl/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/server-api-contract.test.js`
Expected: FAIL because the `aasc` defaults and role branch do not exist。

- [ ] **Step 3: Write minimal implementation**

主服务器默认 `aasc.role=main`。子服务器首次启动生成不超过 128 字符的节点 ID并持久化；监听成功后创建 `AascNodeConnector`，连接失败只记录日志，不阻塞本地服务启动；服务关闭时调用 `stop()`。只有 `main` 角色执行 `registerMainAascServer` 和旧配置健康检查。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/server-api-contract.test.js tests/aasc-node-connector.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/apps/server/modules/config/config-app-service.js src/apps/server/boot/server-app.js tests/server-api-contract.test.js tests/aasc-node-connector.test.js
git commit -m "feat: 按角色启动 AASC 子服务器连接"
```

### Task 6: 迁移远程媒体索引与服务节点请求到主动连接

**Files:**
- Modify: `src/framework/aasc/media-index-service.js`
- Modify: `src/apps/server/boot/server-app.js`
- Modify: `src/apps/server/modules/task-engine/task-manager.js`
- Test: `tests/aasc-media-index.test.js`
- Test: `tests/aasc-task-router.test.js`

**Interfaces:**
- `AascMediaIndexService` consumes `requestRemoteIndex(node, path)`，不再默认用主服务器 HTTP 请求远程节点。
- `TaskManager` receives `sendToServer(nodeId, message)`，显示端优先规则保持不变。

- [ ] **Step 1: Write the failing test**

```js
test('远程媒体索引使用节点连接请求而不是节点 URL HTTP 请求', async () => {
    const requests = [];
    const service = new AascMediaIndexService({
        mediaLibraryManager: localLibraryManager,
        getNode: () => ({ nodeId: 'main-server', url: 'https://main.test:8081' }),
        getRemoteNodes: () => [{ nodeId: 'node-a', url: 'https://node-a:8081', status: 'online' }],
        requestRemoteIndex: async (node, path) => { requests.push({ node, path }); return remoteIndex; }
    });
    await service.buildNetworkIndex('/');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].node.nodeId, 'node-a');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/aasc-media-index.test.js`
Expected: FAIL because the service still calls `fetchJson`。

- [ ] **Step 3: Write minimal implementation**

增加 `requestRemoteIndex` 注入点；主服务器使用 `aascServerRegistry.request(node.nodeId, 'media.index.local', { path })`。保留索引结果中的 `ownerUrl` 给浏览器/显示端访问，但主服务器不再通过该 URL 请求节点。

服务节点任务只在路由结果明确含有 `nodeId` 且不是 `main-server` 时通过注册表连接发送；显示端任务仍复用现有 `task:execute`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/aasc-media-index.test.js tests/aasc-task-router.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/framework/aasc/media-index-service.js src/apps/server/boot/server-app.js src/apps/server/modules/task-engine/task-manager.js tests/aasc-media-index.test.js tests/aasc-task-router.test.js
git commit -m "feat: 通过 AASC 连接请求远程节点能力"
```

### Task 7: 接入主动连接下发的重启/热更新命令

**Files:**
- Modify: `scripts/termux/aasc-server-bootstrap.cjs`
- Modify: `src/apps/server/boot/server-app.js`
- Modify: `tests/termux-server-bootstrap.test.js`
- Test: `tests/server-api-contract.test.js`

**Interfaces:**
- `server.update` 返回 `accepted`，Bootstrap 主动请求主服务器 HTTP `/server` 和 `/server/package`。
- 更新成功或回滚后新服务重新注册当前版本。

- [ ] **Step 1: Write the failing test**

```js
test('主动连接命令包含 server.update 和 server.restart 处理', () => {
    const source = fs.readFileSync(path.join(root, 'src/apps/server/boot/server-app.js'), 'utf8');
    assert.match(source, /server\.update/);
    assert.match(source, /server\.restart/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/server-api-contract.test.js`
Expected: FAIL because服务端尚未处理主动节点命令。

- [ ] **Step 3: Write minimal implementation**

子服务器收到 `server.update` 后启动一次性 Bootstrap update 子进程，Bootstrap 使用节点配置中的主服务器地址下载并校验包，复用已有备份、停止、安装、启动、健康检查和回滚流程；Bootstrap 不成为常驻服务。服务恢复后通过新连接的注册消息带回版本。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/termux-server-bootstrap.test.js tests/server-api-contract.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add scripts/termux/aasc-server-bootstrap.cjs src/apps/server/boot/server-app.js tests/termux-server-bootstrap.test.js tests/server-api-contract.test.js
git commit -m "feat: 支持 AASC 主动连接热更新命令"
```

### Task 8: 收口路由文档、控制端入口和验证

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/server-list.js`
- Modify: `src/apps/server/boot/server-app.js`
- Modify: `tests/server-api-contract.test.js`
- Modify: `tests/server-list-ui.test.js`
- Modify: `docs/design/*.md`、`docs/spec/*.md`、`docs/task/*.md`、`docs/usage.md`、`docs/todo.md`、`changelog.md`

**Interfaces:**
- 正式控制页面为 `GET /control`，控制 WebSocket 为 `WS /control`。
- 旧 `/upload` 和 `/` 重定向到 `/control`；服务器列表手动连接跳转 `/control`。

- [ ] **Step 1: Write the failing test**

路由迁移测试已在本次任务中先行加入：`tests/server-api-contract.test.js` 和 `tests/server-list-ui.test.js`。

- [ ] **Step 2: Run test to verify it fails**

已完成红测：旧实现下 `/control` HTTP 路由不存在，手动连接仍跳转 `/upload`。

- [ ] **Step 3: Write minimal implementation**

已完成 `/control` 页面路由、`/upload` 兼容跳转、根路径跳转、启动日志和服务器列表目标地址迁移；内部 `upload.html` 文件名保持不变。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/server-api-contract.test.js tests/server-list-ui.test.js`
Expected: PASS 8/8；随后执行 `node --check` 检查变更的 JavaScript 文件和 `git diff --check`。

- [ ] **Step 5: Commit**

```bash
git add src/apps/server/boot/server-app.js src/apps/web-mediacenter/ui/public/js/server-list.js tests/server-api-contract.test.js tests/server-list-ui.test.js docs
git commit -m "feat: 统一控制端 control 页面入口"
```
