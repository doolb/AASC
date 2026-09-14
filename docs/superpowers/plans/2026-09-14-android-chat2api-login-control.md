# Android Chat2API Login and Display Control Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为普通 Android APK 和 Android Offline APK 增加按显示端开放控制端入口，并完成隔离 WebView 的 Chat2API Provider 自动登录、凭据捕获、服务端验证和账号保存。本次执行按用户范围只构建和验收普通 APK。

**Architecture:** 服务端保存每个显示端的 `androidControlPageOpen`，通过 WebSocket 向声明 Android 能力的显示端发送权威可见性状态。Android 通过独立进程中的登录 Activity/WebView 捕获 Provider 预定义的 Authorization、localStorage 和 Cookie，控制 WebView 只提交候选凭据，AASC Chat2API 服务端验证成功后保存账号。

**Tech Stack:** Node.js、Express/WebSocket、Node test runner、Kotlin Android Activity/WebView、Android WebView CookieManager、现有 AASC Chat2API runtime。

**Spec:** `docs/spec/android-chat2api-login-control.md`

## Global Constraints

- 本次只实现 Android APK；不增加桌面 Electron 登录助手。
- 普通 APK 和离线 APK 共用 Android 原生登录和控制端入口代码；本次只构建普通 APK，离线 APK 留待后续单独验收。
- `androidControlPageOpen` 默认 `false`，按显示端 ID 持久化。
- Provider 捕获只允许内置配置的域名、Authorization、localStorage 和 Cookie 字段。
- 完整凭据不得写入日志、显示列表、任务参数或普通持久化状态。
- 生产代码使用 `const/let`、`async/await`、`try-catch`，新增注释使用中文。
- 每个实现任务先写失败测试并确认失败，再写最小生产代码。

## File Map

- Create `src/apps/server/modules/chat2api/chat2api-login-profiles.js`: 内置 Provider 的 Android 捕获配置和凭据字段映射。
- Create `src/apps/server/modules/chat2api/chat2api-credential-validators.js`: Provider 真实接口验证器工厂，支持注入 HTTP 客户端。
- Create `src/apps/server/modules/display/android-control-page-access.js`: 显示端 Android 控制端开放状态和消息构造。
- Modify `src/apps/server/modules/chat2api/chat2api-oauth-service.js`: 登录配置返回、state 验证顺序和验证失败重试。
- Modify `src/apps/server/modules/chat2api/chat2api-data-store.js`: 读取未消费 OAuth session 的接口和状态校验。
- Modify `src/apps/server/modules/chat2api/chat2api-runtime.js`: 默认装配 Provider 验证器。
- Modify `src/apps/server/boot/server-app.js`: 显示端能力、开关消息、持久化状态和初始化下发。
- Modify `src/apps/web-mediacenter/ui/public/js/display-list.js` and `websocket.js`: 控制端开关和权威状态刷新。
- Modify `src/apps/web-mediacenter/ui/public/js/chat2api.js`: Android NativeControl 登录入口和自动完成。
- Create Android `Chat2ApiCredentialCapture.kt`, `Chat2ApiAuthWebView.kt`, `Chat2ApiLoginActivity.kt`, `Chat2ApiNativeBridge.kt`.
- Create Android `AndroidControlAccess.kt` for the pure native button visibility rule.
- Modify Android `MainActivity.kt`, `NativeBridge.kt`, `activity_main.xml`, `AndroidManifest.xml`.
- Test new Node modules with `node:test`; test Kotlin capture parsing and URL/state helpers with existing Gradle unit-test setup.

### Task 1: Provider Android 捕获配置

**Files:**
- Create: `src/apps/server/modules/chat2api/chat2api-login-profiles.js`
- Test: `src/apps/server/modules/chat2api/chat2api-login-profiles.test.js`
- Modify: `src/apps/server/modules/chat2api/chat2api-provider-registry.js`

**Interfaces:**
- Produces `getAndroidLoginProfile(providerId)` returning `{ loginUrl, allowedOrigins, authorization, localStorage, cookies, requiredFields }` or `null`.
- Consumes provider IDs and login extraction rules ported from `/mnt/Chat2API/src/main/oauth/tokenExtractionConfig.ts`.

- [ ] **Step 1: Write the failing test**

```js
test('内置 Provider 返回 Android WebView 捕获配置且不返回任意脚本', () => {
  const profile = getAndroidLoginProfile('deepseek');
  assert.equal(profile.loginUrl, 'https://chat.deepseek.com');
  assert.deepEqual(profile.localStorage, [{ key: 'userToken', field: 'token' }]);
  assert.equal(profile.script, undefined);
  assert.equal(getAndroidLoginProfile('custom'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/apps/server/modules/chat2api/chat2api-login-profiles.test.js`

Expected: FAIL because the profile module and `getAndroidLoginProfile` do not exist.

- [ ] **Step 3: Write minimal implementation**

添加九个内置 Provider 的静态配置：DeepSeek localStorage、GLM refresh Cookie、Kimi Authorization、MiniMax localStorage、MiMo 三个 Cookie、Perplexity session Cookie、Qwen SSO Cookie、Qwen AI token storage、Z.ai token storage。返回深拷贝并只暴露字段映射，不接受 Provider 输入的脚本。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/apps/server/modules/chat2api/chat2api-login-profiles.test.js`

Expected: PASS，且覆盖九个 Provider 的必填字段和允许域名。

- [ ] **Step 5: Commit**

```bash
git add src/apps/server/modules/chat2api/chat2api-login-profiles.js src/apps/server/modules/chat2api/chat2api-login-profiles.test.js src/apps/server/modules/chat2api/chat2api-provider-registry.js
git commit -m "feat(chat2api): 增加 Android 登录捕获配置"
```

### Task 2: OAuth session 与 Provider 验证

**Files:**
- Create: `src/apps/server/modules/chat2api/chat2api-credential-validators.js`
- Test: `src/apps/server/modules/chat2api/chat2api-credential-validators.test.js`
- Modify: `src/apps/server/modules/chat2api/chat2api-oauth-service.js`
- Modify: `src/apps/server/modules/chat2api/chat2api-data-store.js`
- Modify: `src/apps/server/modules/chat2api/chat2api-runtime.js`
- Modify: `src/apps/server/modules/chat2api/chat2api-oauth-service.test.js`

**Interfaces:**
- Produces `createChat2ApiCredentialValidators({ httpClient })` with `validate(credentials, provider)` for each built-in Provider.
- `oauth.startLogin(providerId)` adds `androidWebView` and public `captureProfile`.
- `oauth.completeLogin(input)` validates before consuming state; failed validation keeps an unexpired state available for retry.

- [ ] **Step 1: Write the failing tests**

```js
test('凭据验证器调用 Provider 检查接口并返回标准化账号信息', async () => {
  const calls = [];
  const validators = createChat2ApiCredentialValidators({
    httpClient: { request: async (config) => { calls.push(config); return { status: 200, data: { email: 'user@example.com' } }; } },
  });
  const result = await validators.deepseek.validate({ token: 'captured-token' }, { id: 'deepseek' });
  assert.equal(result.valid, true);
  assert.equal(result.credentials.token, 'captured-token');
  assert.equal(result.accountInfo.email, 'user@example.com');
  assert.equal(calls.length, 1);
});

test('Provider 验证失败时 OAuth state 可以在过期前重试', async () => {
  let consumed = false;
  const store = {
    createOAuthSession: async () => ({ state: 'state-1', expiresAt: Date.now() + 300000 }),
    getOAuthSession: async () => consumed ? null : { state: 'state-1', providerId: 'deepseek', expiresAt: Date.now() + 300000 },
    consumeOAuthSession: async () => { consumed = true; return true; },
    saveAccount: async (account) => ({ ...account, secretConfigured: true }),
  };
  const provider = { id: 'deepseek', name: 'DeepSeek', credentialFields: [{ name: 'token', required: true }] };
  const service = createChat2ApiOAuthService({
    dataStore: store,
    providerRegistry: { getProvider: async () => provider },
    credentialAdapters: { deepseek: { validate: async (credentials) => ({ valid: credentials.token === 'ok', credentials }) } },
  });
  await assert.rejects(() => service.completeLogin({ state: 'state-1', providerId: 'deepseek', credentials: { token: 'bad' } }), /校验失败/);
  assert.equal(consumed, false);
  await service.completeLogin({ state: 'state-1', providerId: 'deepseek', credentials: { token: 'ok' } });
  assert.equal(consumed, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/apps/server/modules/chat2api/chat2api-credential-validators.test.js src/apps/server/modules/chat2api/chat2api-oauth-service.test.js`

Expected: FAIL because the validator factory and non-consuming validation flow do not exist.

- [ ] **Step 3: Write minimal implementation**

从上游适配器迁移 Provider 检查所需的请求方法和响应字段归一化，HTTP 请求通过注入的 `httpClient`，不复用聊天请求的账号选择逻辑。OAuth service 增加 `getOAuthSession`/完成锁，先检查未过期 state，再调用 validator，成功保存后消费 state。保留现有手工凭据字段校验作为无 validator 的回退。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/apps/server/modules/chat2api/chat2api-credential-validators.test.js src/apps/server/modules/chat2api/chat2api-oauth-service.test.js src/apps/server/modules/chat2api/chat2api-runtime.test.js`

Expected: PASS，验证失败不会写入账号，成功只消费一次 state。

- [ ] **Step 5: Commit**

```bash
git add src/apps/server/modules/chat2api/chat2api-credential-validators.js src/apps/server/modules/chat2api/chat2api-credential-validators.test.js src/apps/server/modules/chat2api/chat2api-oauth-service.js src/apps/server/modules/chat2api/chat2api-data-store.js src/apps/server/modules/chat2api/chat2api-runtime.js src/apps/server/modules/chat2api/chat2api-oauth-service.test.js
git commit -m "feat(chat2api): 增加 Provider 凭据验证"
```

### Task 3: 服务端 Android 显示端开放协议

**Files:**
- Test: `tests/android-control-page-access.test.js`
- Create: `src/apps/server/modules/display/android-control-page-access.js`
- Modify: `src/apps/server/boot/server-app.js`
- Modify: `src/framework/transport/ws/connection.js`

**Interfaces:**
- Control message: `{ type: 'setAndroidControlPage', displayId, enabled }`.
- Display message: `{ type: 'displayControlAccess', enabled }`.
- Display list fields: `androidControlPageSupported`, `androidControlPageOpen`.

- [ ] **Step 1: Write the failing test**

```js
const assert = require('assert/strict');
const test = require('node:test');
const { createAndroidControlPageAccess } = require('../src/apps/server/modules/display/android-control-page-access');

test('只有声明 Android 控制端能力的显示端可以被开放控制端', () => {
  const sent = [];
  const saved = [];
  const display = { displayId: 'display-1', state: { capabilities: { androidControlPage: true }, androidControlPageOpen: false } };
  const access = createAndroidControlPageAccess({ sendToDisplay: (id, message) => sent.push({ id, message }), persist: (target, patch) => saved.push({ target, patch }) });
  const result = access.set(display, true);
  assert.equal(result.enabled, true);
  assert.deepEqual(sent, [{ id: 'display-1', message: { type: 'displayControlAccess', enabled: true } }]);
  assert.deepEqual(saved[0].patch, { androidControlPageOpen: true });
});

test('旧显示端或未声明能力时拒绝开放控制端', () => {
  const display = { displayId: 'display-1', state: { capabilities: {} } };
  const access = createAndroidControlPageAccess();
  assert.throws(() => access.set(display, true), /不支持 Android 控制端/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/android-control-page-access.test.js`

Expected: FAIL because the message type and state field are not handled.

- [ ] **Step 3: Write minimal implementation**

在显示状态创建、连接初始化、能力合并、显示列表和控制消息处理处增加 `androidControlPageOpen` 与 `androidControlPage`；目标不存在、离线、无能力或布尔值非法时返回结构化错误；成功后持久化并向目标显示端和所有控制端发送权威状态。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/android-control-page-access.test.js src/apps/server/modules/chat2api/*.test.js`

Expected: PASS，旧消息和旧显示端连接流程保持兼容。

- [ ] **Step 5: Commit**

```bash
git add tests/android-control-page-access.test.js src/apps/server/boot/server-app.js src/framework/transport/ws/connection.js
git commit -m "feat(android): 增加显示端控制端开放协议"
```

### Task 4: 控制端开关与 Android WebView 登录入口

**Files:**
- Test: `src/apps/web-mediacenter/ui/public/js/chat2api.test.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/display-list.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/websocket.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/chat2api.js`

**Interfaces:**
- `DisplayList.setAndroidControlPage(displayId, enabled)` sends the control WebSocket message.
- `Chat2APIControl.startLogin(providerId)` calls `NativeControl.openChat2ApiLogin(JSON.stringify(session))` when the Android bridge is available.
- `Chat2APIControl.completeNativeLogin(result)` submits returned credentials to the existing OAuth complete endpoint without rendering them.

- [ ] **Step 1: Write the failing test**

```js
test('控制端显示 Android 控制端开关并发送按设备的更新消息', () => {
  const source = read('src/apps/web-mediacenter/ui/public/js/display-list.js');
  assert.match(source, /setAndroidControlPage/);
  assert.match(source, /androidControlPageOpen/);
});

test('Chat2API Android 登录优先调用 NativeControl，未提供桥接时保留手工回退', () => {
  const source = read('src/apps/web-mediacenter/ui/public/js/chat2api.js');
  assert.match(source, /openChat2ApiLogin/);
  assert.match(source, /completeNativeLogin/);
  assert.match(source, /window\.open/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/apps/web-mediacenter/ui/public/js/chat2api.test.js`

Expected: FAIL because the Android bridge and display switch are not referenced.

- [ ] **Step 3: Write minimal implementation**

在显示端详情/能力面板中仅对 `androidControlPageSupported` 显示开关，收到 `displayControlAccessUpdated` 后更新列表。Chat2API 登录成功取得 session 后调用 Android bridge；原生结果只作为内存对象进入 `completeNativeLogin`，仍由现有 `/oauth/complete` 负责保存，桌面控制端保留 `window.open` 和手工字段。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/apps/web-mediacenter/ui/public/js/chat2api.test.js src/apps/server/modules/chat2api/chat2api-gateway.test.js`

Expected: PASS，控制端 UI 文本和消息字段契约通过。

- [ ] **Step 5: Commit**

```bash
git add src/apps/web-mediacenter/ui/public/js/display-list.js src/apps/web-mediacenter/ui/public/js/websocket.js src/apps/web-mediacenter/ui/public/js/chat2api.js src/apps/web-mediacenter/ui/public/js/chat2api.test.js
git commit -m "feat(control): 增加 Android 控制端开关和登录桥接"
```

### Task 5: Android 隔离 WebView 捕获器

**Files:**
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/Chat2ApiCredentialCapture.kt`
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/Chat2ApiAuthWebView.kt`
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/Chat2ApiLoginActivity.kt`
- Test: `src/apps/android-display/app/src/test/java/com/aasc/display/Chat2ApiCredentialCaptureTest.kt`
- Modify: `src/apps/android-display/app/src/main/AndroidManifest.xml`

**Interfaces:**
- `Chat2ApiCredentialCapture.extractAuthorization(headers, profile)` returns a mapped field or null.
- `Chat2ApiCredentialCapture.extractCookies(rawCookie, profile)` returns only configured fields.
- `Chat2ApiLoginActivity` accepts login session extras and returns `success`, `state`, `providerId`, `credentials` or a non-secret error.

- [ ] **Step 1: Write the failing test**

```kotlin
@Test
fun 只从允许域名和配置字段合并凭据() {
    val profile = Chat2ApiCaptureProfile(
        allowedOrigins = listOf("https://chat.example"),
        authorizationField = "token",
        cookieFields = mapOf("session" to "sessionToken"),
        localStorageFields = mapOf("userToken" to "token")
    )
    val captured = Chat2ApiCredentialCapture.merge(
        profile,
        url = "https://chat.example/app",
        authorization = "Bearer auth-token",
        cookies = "session=cookie-token; other=ignored",
        localStorage = mapOf("userToken" to "storage-token")
    )
    assertEquals("storage-token", captured["token"])
    assertEquals("cookie-token", captured["sessionToken"])
    assertFalse(Chat2ApiCredentialCapture.isAllowed(profile, "https://evil.example"))
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/apps/android-display && ./gradlew :app:testDebugUnitTest --tests '*Chat2ApiCredentialCaptureTest' --no-daemon`

Expected: FAIL because capture data classes and parser do not exist.

- [ ] **Step 3: Write minimal implementation**

实现纯 Kotlin 捕获配置解析，严格匹配 origin、Authorization Bearer、Cookie 名称和 localStorage 键。`Chat2ApiAuthWebView` 在 `shouldInterceptRequest` 捕获请求头，在 `onPageFinished`/1000ms 轮询中读取 storage 和 Cookie；`Chat2ApiLoginActivity` 放在 `:chat2api_login` 独立进程，创建 WebView 前设置独立数据目录，完成或取消时清理资源。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/apps/android-display && ./gradlew :app:testDebugUnitTest --tests '*Chat2ApiCredentialCaptureTest' --no-daemon`

Expected: PASS，且 Android lint/编译不产生凭据日志。

- [ ] **Step 5: Commit**

```bash
git add src/apps/android-display/app/src/main/java/com/aasc/display/Chat2ApiCredentialCapture.kt src/apps/android-display/app/src/main/java/com/aasc/display/Chat2ApiAuthWebView.kt src/apps/android-display/app/src/main/java/com/aasc/display/Chat2ApiLoginActivity.kt src/apps/android-display/app/src/test/java/com/aasc/display/Chat2ApiCredentialCaptureTest.kt src/apps/android-display/app/src/main/AndroidManifest.xml
git commit -m "feat(android): 增加 Chat2API 隔离登录 WebView"
```

### Task 6: Android 原生桥与 APK 控制端入口

**Files:**
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/Chat2ApiNativeBridge.kt`
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/AndroidControlAccess.kt`
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt`
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt`
- Modify: `src/apps/android-display/app/src/main/res/layout/activity_main.xml`
- Modify: `src/apps/android-display/app/src/main/res/values/strings.xml`
- Test: `src/apps/android-display/app/src/test/java/com/aasc/display/ServerConfigTest.kt`

**Interfaces:**
- `NativeBridge.setControlPageAccess(enabled: Boolean)` updates native button visibility through a main-thread callback.
- `Chat2ApiNativeBridge.openChat2ApiLogin(sessionJson: String): Boolean` starts the isolated login Activity.
- `MainActivity.onActivityResult` sends only the one-time result to `Chat2APIControl.completeNativeLogin`.
- `AndroidControlAccess.shouldShowButton(allowed: Boolean, pageVisible: Boolean)` returns the safe native button state.

- [ ] **Step 1: Write the failing test**

```kotlin
@Test
fun 控制端未开放时原生按钮必须隐藏() {
    assertFalse(AndroidControlAccess.shouldShowButton(allowed = false, pageVisible = false))
    assertTrue(AndroidControlAccess.shouldShowButton(allowed = true, pageVisible = false))
}

@Test
fun 普通APK与离线APK均使用同源控制端地址() {
    assertEquals("https://server.example/control", ServerConfig.controlPageUrl("https://server.example"))
    assertEquals("https://127.0.0.1:8081/control", ServerConfig.controlPageUrl("https://127.0.0.1:8081"))
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/apps/android-display && ./gradlew :app:testDebugUnitTest --tests '*ServerConfigTest' --no-daemon`

Expected: FAIL until the native control bridge and server-controlled visibility contract are wired into MainActivity.

- [ ] **Step 3: Write minimal implementation**

给控制 WebView 注入 `NativeControl`，新增登录 Activity 启动和结果回传；给显示 WebView 的 `NativeBridge` 注入控制按钮回调；按钮初始隐藏，只接受 `display.html` 的 `displayControlAccess` 指令，不再用 `offlineMode` 直接决定可见性。普通 APK 与离线 APK 均加载现有 `ServerConfig.controlPageUrl`。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/apps/android-display && ./gradlew :app:testDebugUnitTest --tests '*ServerConfigTest' --no-daemon`

Expected: PASS，随后执行 Android 全部 JVM 单元测试。

- [ ] **Step 5: Commit**

```bash
git add src/apps/android-display/app/src/main/java/com/aasc/display/AndroidControlAccess.kt src/apps/android-display/app/src/main/java/com/aasc/display/Chat2ApiNativeBridge.kt src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt src/apps/android-display/app/src/main/res/layout/activity_main.xml src/apps/android-display/app/src/main/res/values/strings.xml src/apps/android-display/app/src/test/java/com/aasc/display/ServerConfigTest.kt
git commit -m "feat(android): 支持 APK 控制端入口和登录结果桥接"
```

### Task 7: 全链路回归与 APK 验收

**Files:**
- Modify: `docs/design/android-chat2api-login-control.md`
- Modify: `docs/spec/android-chat2api-login-control.md`
- Modify: `docs/task/20260914_Android Chat2API登录与显示端控制端开放.md`
- Modify: `docs/todo.md`
- Modify: `changelog.md`
- Test: `src/apps/server/modules/chat2api/*.test.js`, `tests/android-control-page-access.test.js`, Android JVM tests

- [ ] **Step 1: Write the failing integration assertions**

```js
const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { createChat2ApiDataStore } = require('../src/apps/server/modules/chat2api/chat2api-data-store');
const { createChat2ApiOAuthService } = require('../src/apps/server/modules/chat2api/chat2api-oauth-service');

test('Android 登录候选只在 Provider 验证成功后出现在账号列表', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-chat2api-android-login-'));
  const dataStore = createChat2ApiDataStore({ rootDir });
  const provider = { id: 'deepseek', name: 'DeepSeek', enabled: true, credentialFields: [{ name: 'token', required: true }] };
  const runtime = createChat2ApiOAuthService({
    dataStore,
    providerRegistry: { getProvider: async (providerId) => providerId === provider.id ? provider : null },
    credentialAdapters: { deepseek: { validate: async (credentials) => ({ valid: credentials.token === 'captured', credentials }) } },
  });
  const started = await runtime.startLogin('deepseek');
  const result = await runtime.completeLogin({ state: started.state, providerId: 'deepseek', credentials: { token: 'captured' } });
  assert.equal(result.account.secretConfigured, true);
  assert.doesNotMatch(JSON.stringify(result), /captured/u);
  await fs.rm(rootDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run all focused tests**

Run: `npm run check:chat2api`

Run: `node --test tests/android-control-page-access.test.js src/apps/server/modules/chat2api/*.test.js src/apps/web-mediacenter/ui/public/js/chat2api.test.js`

Run: `cd src/apps/android-display && ./gradlew :app:testDebugUnitTest --no-daemon`

Expected: PASS，所有输出不包含测试 Token 原文。

- [ ] **Step 3: Build APKs**

Run: `npm run build:apk`

本次不执行 `npm run build:apk:offline`。仅运行 `npm run build:apk`。

Expected: 普通 APK 构建成功，Manifest 包含独立登录 Activity，Node HTTPS 默认地址仍为 `https://127.0.0.1:8081`。

- [ ] **Step 4: 真机验收**

本次仅在 Android 设备上打开普通 APK，确认：服务端关闭开关时无控制端按钮；控制 WebView 可打开 `/control`；关闭开关立即隐藏控制页。Provider 登录 WebView 的真实账号捕获和验证、Offline APK 验收留待后续现场测试。

- [ ] **Step 5: Update documentation and close task**

将 design/spec 标记为已实现，删除 `docs/todo.md` 中的进行中条目，在 `changelog.md` 记录实际改动文件、Provider 覆盖范围、普通/离线 APK 构建结果和真机测试结果。运行 `git diff --check`，确认无敏感字段和无关文件进入提交。

- [ ] **Step 6: Commit**

```bash
git add docs/design/android-chat2api-login-control.md docs/spec/android-chat2api-login-control.md docs/task/20260914_Android\ Chat2API登录与显示端控制端开放.md docs/todo.md changelog.md
git commit -m "feat(android): 完成 Chat2API 登录和控制端开放"
```
