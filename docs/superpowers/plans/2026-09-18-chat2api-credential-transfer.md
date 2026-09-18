# Chat2API 账号凭证导入导出与 Android 外部网页恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在控制端提供独立 Chat2API 账号凭证 JSON 导入导出，并让 Android 隔离 WebView 按选中账号尝试恢复外部网页登录状态。

**Architecture:** 服务端在现有 Chat2API 数据存储和管理路由上增加账号包白名单、预览确认合并、稳定新账号 ID 和短 TTL 一次性网页会话。控制端只处理脱敏预览和不含凭证的会话令牌；Android 原生进程消费令牌，在独立 WebView 内设置允许来源的 Cookie、注入 LocalStorage，并在 Activity 销毁时清理。

**Tech Stack:** Node.js 内置 `node:test`、现有 Chat2API data store/proxy/management service、控制端原生 JavaScript、Android Kotlin WebView/JVM tests。

**Spec:** `docs/design/android-chat2api-credential-transfer.md`、`docs/spec/android-chat2api-credential-transfer.md`

## Global Constraints

- 账号导出使用明文 `aasc-chat2api-accounts` v1 JSON，只包含账号身份与凭证白名单字段。
- 同一 `accountId` 更新，其他本地账号保留；显式旧 ID 永不自动改写。
- 新账号邮箱优先、手机号次之生成 `<providerId>:<normalizedIdentity>`，无身份时沿用随机 ID。
- 预览结果脱敏；合并必须携带未过期的预览确认摘要。
- WebSession 短 TTL、一次性消费；控制端和 Intent 不接触完整凭证，Android 只在原生内存处理。
- Cookie/LocalStorage 只能用于 profile 白名单的 origin 和字段；Authorization-only profile 回退手动登录。
- 修改代码前先写失败测试并运行到预期失败；实现后运行定向测试，再运行项目现有测试入口。
- 不重置、清理或覆盖工作区中与本任务无关的已有改动。

---

### Task 1: 账号身份规则与账号凭证包数据层

**Files:**
- Create: `src/apps/server/modules/chat2api/chat2api-account-identity.js`
- Modify: `src/apps/server/modules/chat2api/chat2api-data-store.js`
- Test: `src/apps/server/modules/chat2api/chat2api-data-store.test.js`
- Test: `src/apps/server/modules/chat2api/chat2api-account-identity.test.js`

**Interfaces:**
- `deriveAccountId({ providerId, email, phone, existingIds, incomingIds }) -> string`
- `selectAccountId(account, context) -> string`
- `dataStore.exportAccountCredentials() -> AccountCredentialBundle`
- `dataStore.previewAccountImport(payload) -> { items, counts, confirmation }`
- `dataStore.mergeAccountImport(payload, confirmation, confirmed) -> sanitized result`

- [x] **Step 1: Write failing identity tests**

```js
test('新账号优先使用规范化邮箱生成可读 ID，显式旧 ID 保留', () => {
  assert.equal(deriveAccountId({ providerId: 'qwen', email: ' User@Example.COM ' }), 'qwen:user@example.com');
  assert.equal(selectAccountId({ accountId: 'legacy-7', providerId: 'qwen', email: 'new@example.com' }), 'legacy-7');
});

test('没有邮箱时使用规范化手机号，没有身份时生成随机 ID', () => {
  assert.equal(deriveAccountId({ providerId: 'qwen', phone: ' +86 138-1234-5678 ' }), 'qwen:+8613812345678');
  assert.match(deriveAccountId({ providerId: 'qwen' }), /^qwen-[a-f0-9]{12}$/);
});
```

- [x] **Step 2: Run identity tests and verify expected failure**

Run: `node --test src/apps/server/modules/chat2api/chat2api-account-identity.test.js`

Expected: FAIL because the identity module and exported functions do not exist.

- [x] **Step 3: Implement identity normalization**

Implement `normalizeEmail`, `normalizePhone`, `deriveAccountId`, and `selectAccountId` using `crypto.randomBytes(6).toString('hex')`; when a candidate collides with `existingIds` or `incomingIds`, use a random ID rather than silently changing another account.

- [x] **Step 4: Run identity tests and verify pass**

Run: `node --test src/apps/server/modules/chat2api/chat2api-account-identity.test.js`

- [x] **Step 5: Write failing data-store tests**

Add tests for account-only export exclusion, duplicate incoming IDs, sanitized preview, update/new counts, confirmation mismatch, and preservation of an account omitted from the bundle. The test fixture must include `config`, `providers`, `modelMappings`, and an API key so the export assertion proves they are absent.

- [x] **Step 6: Run the data-store tests and verify expected failure**

Run: `node --test src/apps/server/modules/chat2api/chat2api-data-store.test.js`

Expected: FAIL with missing account export/preview/merge methods.

- [x] **Step 7: Implement account bundle methods in the existing data store**

Add constants for `aasc-chat2api-accounts`, v1 and the existing import limit. Implement a field whitelist for `accountId`, `providerId`, `label`, `email`, `phone`, a safe identity subset of `accountInfo`, `credentials`, `cookie`, `authMethod`, and `enabled`; reject duplicate IDs in one incoming bundle; derive missing IDs through the identity module; hash canonical normalized payload plus action summary for confirmation; merge only accounts with existing `mergeByKey` semantics and write account data atomically. Preview uses `publicAccount`-style secret presence markers and never returns credential values.

- [x] **Step 8: Run data-store and existing Chat2API tests**

Run: `node --test src/apps/server/modules/chat2api/chat2api-data-store.test.js src/apps/server/modules/chat2api/chat2api-account-identity.test.js`

Expected: all new and existing data-store tests pass.

### Task 2: New-account ID integration and one-time WebSession service

**Files:**
- Modify: `src/apps/server/modules/chat2api/chat2api-manual-account-service.js`
- Modify: `src/apps/server/modules/chat2api/chat2api-oauth-service.js`
- Create: `src/apps/server/modules/chat2api/chat2api-account-web-session-service.js`
- Test: `src/apps/server/modules/chat2api/chat2api-oauth-service.test.js`
- Create: `src/apps/server/modules/chat2api/chat2api-account-web-session-service.test.js`

**Interfaces:**
- `createChat2ApiAccountWebSessionService({ dataStore, providerRegistry, baseUrl, ttlMs })`
- `createSession(accountId) -> { sessionId, consumeUrl, providerId, loginUrl }`
- `consumeSession(sessionId) -> { loginUrl, allowedOrigins, cookieMappings, localStorageMappings, credentials, cookie, authMethod }`

- [x] **Step 1: Write failing integration tests**

```js
test('手动和 OAuth 新账号使用邮箱/手机号 ID，显式 accountId 不变', async () => {
  const result = await manual.addManualAccount({ providerId: 'qwen', email: ' User@Example.com ', credentials: { ticket: 'x' } });
  assert.equal(result.account.accountId, 'qwen:user@example.com');
});

test('网页会话只能成功消费一次并且不返回 profile 外的字段', async () => {
  const created = await service.createSession('qwen:user@example.com');
  const first = await service.consumeSession(created.sessionId);
  assert.equal(first.credentials.ticket, 'secret');
  await assert.rejects(() => service.consumeSession(created.sessionId), /已消费|无效/);
});
```

- [x] **Step 2: Run new tests and verify expected failure**

Run: `node --test src/apps/server/modules/chat2api/chat2api-account-web-session-service.test.js src/apps/server/modules/chat2api/chat2api-oauth-service.test.js`

Expected: FAIL because new service and identity integration are missing.

- [x] **Step 3: Integrate `selectAccountId` in manual and OAuth account creation**

Pass provider ID, email, phone and current account IDs into `selectAccountId`; keep an explicit `accountId` untouched; use validated account info to fill email/phone before deriving the ID. Do not change validation or public secret sanitization.

- [x] **Step 4: Implement in-memory one-time WebSession service**

Use a `Map` of opaque random session IDs with `expiresAt`, account ID and sanitized profile. On create, require enabled account and Provider and copy only profile `loginUrl`, `allowedOrigins`, `cookies`, and `localStorage`; on consume, atomically remove the entry, recheck TTL/account/Provider, and return only the restore payload plus the account credential fields. Mark errors with stable 404/409/410 codes and never include secret values in error messages.

- [x] **Step 5: Run service tests and existing OAuth tests**

Run: `node --test src/apps/server/modules/chat2api/chat2api-account-web-session-service.test.js src/apps/server/modules/chat2api/chat2api-oauth-service.test.js src/apps/server/modules/chat2api/chat2api-android-login.test.js`

### Task 3: HTTP routes and control-side account transfer UI

**Files:**
- Modify: `src/apps/server/modules/chat2api/chat2api-proxy-service.js`
- Modify: `src/apps/server/modules/chat2api/chat2api-management-service.js`
- Modify: `src/apps/server/modules/chat2api/chat2api-runtime.js` to construct and inject the web-session service
- Modify: `src/apps/web-mediacenter/ui/public/js/chat2api.js`
- Modify: `src/apps/web-mediacenter/ui/public/css/chat2api.css` only if the existing semantic classes need one compact preview-table rule
- Test: `src/apps/server/modules/chat2api/chat2api-proxy-service.test.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/chat2api.test.js`

**Interfaces:**
- `GET /api/chat2api/accounts/export`
- `POST /api/chat2api/accounts/import/preview`
- `POST /api/chat2api/accounts/import/merge`
- `POST /api/chat2api/accounts/:accountId/web-session`
- `POST /api/chat2api/accounts/web-session/consume`

- [x] **Step 1: Write failing route/static tests**

Extend the proxy fixture with `exportAccountCredentials`, `previewAccountImport`, `mergeAccountImport`, `createAccountWebSession`, and `consumeAccountWebSession` methods. Assert attachment headers, request bodies, confirmation forwarding, and account web-session routing. Extend the static test to require the account export/import button IDs, `/api/chat2api/accounts/export`, preview/merge endpoints, and `openChat2ApiAccountWeb`.

- [x] **Step 2: Run route/static tests and verify expected failure**

Run: `npm run check:chat2api`

Expected: FAIL only on the new route/static assertions.

- [x] **Step 3: Add routes without changing existing route precedence**

Handle account export before the JSON body read; add account preview/merge and web-session create/consume branches before generic account `PUT`/`DELETE` matching. Reuse `sendJsonAttachment`, `sendJson`, `sendError`, current authorization and no-store headers for credential responses.

- [x] **Step 4: Add control UI actions**

Add a separate file input and `导出账号凭证` button. Add per-row `打开外部网页`. Implement `exportAccountCredentials`, `previewAccountCredentialsFile`, `mergeAccountCredentials`, and `openExternalAccountWeb`; render only sanitized identity/action/secret-presence fields; call `window.confirm` only after preview; call `NativeControl.openChat2ApiAccountWeb` with the opaque session JSON and show a non-Android fallback message. Keep the existing full configuration import/export input and behavior unchanged.

- [x] **Step 5: Run route/static tests and JavaScript syntax check**

Run: `npm run check:chat2api && node --check src/apps/web-mediacenter/ui/public/js/chat2api.js`

### Task 4: Android isolated WebView restore flow

**Files:**
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/Chat2ApiNativeBridge.kt`
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/Chat2ApiLoginActivity.kt`
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/Chat2ApiAuthWebView.kt`
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/Chat2ApiCredentialCapture.kt`
- Create or modify: Android JVM restore-helper test under `src/apps/android-display/app/src/test/java/com/aasc/display/`

**Interfaces:**
- `NativeControl.openChat2ApiAccountWeb(sessionJson) -> Boolean`
- `Chat2ApiCredentialRestore` profile mapping/origin helpers
- `Chat2ApiAuthWebView.restoreLoginState(state)`

- [x] **Step 1: Write failing Android JVM tests**

Cover cookie mapping, LocalStorage script escaping, allowed-origin rejection, Authorization-only manual fallback, and one-time reload decision. Assert that arbitrary cookie names/keys are ignored.

- [x] **Step 2: Run Android tests and verify expected failure**

Run: `cd src/apps/android-display && ./gradlew :app:testDebugUnitTest --tests 'com.aasc.display.*Chat2Api*'`

Expected: FAIL on missing restore helpers and account bridge method.

- [x] **Step 3: Add account-web mode to the native bridge and Activity**

Add a distinct `EXTRA_MODE` or equivalent mode marker; preserve existing capture mode result handling. The account-web Activity consumes the opaque `consumeUrl`/`sessionId` with a background `HttpURLConnection`, keeps the returned credentials in a private in-memory state, and never puts them into Intent extras or logs. Reuse the existing independent process and `WebView.setDataDirectorySuffix`.

- [x] **Step 4: Implement restore helpers and WebView lifecycle**

Extend the parsed profile with restore mappings derived from the existing cookie/LocalStorage declarations. Set only allowed cookies on allowed origins. Build a JavaScript string using JSON encoding for LocalStorage values, inject on `onPageFinished`, and reload at most once. For profiles with no restore mapping show a manual-login banner. On destroy clear cookies, WebStorage, cache and history as the existing capture flow does.

- [x] **Step 5: Run Android JVM tests and static checks**

Run: `cd src/apps/android-display && ./gradlew :app:testDebugUnitTest`

Expected: all existing Android tests plus restore tests pass.

### Task 5: End-to-end regression, documentation synchronization, and release readiness

**Files:**
- Modify: `docs/spec/android-chat2api-credential-transfer.md` to match final method names and actual response fields
- Modify: `docs/design/android-chat2api-credential-transfer.md` if implementation constraints changed
- Modify: `docs/task/20260918_Chat2API账号凭证导入导出与Android网页恢复.md` with execution results
- Modify: `docs/todo.md` remove the completed in-progress item only after all required tests pass
- Modify: `changelog.md` add a ✅ implementation entry and retain the design history

- [x] **Step 1: Run focused server/UI tests**

Run: `npm run check:chat2api`

- [x] **Step 2: Run Android unit tests**

Run: `cd src/apps/android-display && ./gradlew :app:testDebugUnitTest`

- [x] **Step 3: Run the full project test script**

Run: `npm test`

Record the exact pass/fail counts and distinguish pre-existing failures from regressions.

- [x] **Step 4: Perform static/security checks**

Run: `git diff --check`; inspect the changed source for credential values in logs, DOM text, Intent extras, SharedPreferences, or WebView persistent storage; verify JSON export response has `Cache-Control: no-store` and account files remain mode 0600.

- [x] **Step 5: Update task/spec/changelog and stop before publishing**

Record tests, limitations and any Android real-device requirement. Do not build or publish an APK unless the user separately requests release packaging after implementation verification.
