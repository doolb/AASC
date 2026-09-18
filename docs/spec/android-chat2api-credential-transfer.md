# Chat2API 账号凭证导入导出与 Android 外部网页恢复实现规格

本文件使用伪代码描述实现契约；当前实现已落到对应模块，函数名和响应字段以本文件为准，行为、字段边界和安全约束必须保持一致。

## 数据结构

```text
AccountCredentialBundle {
  format = "aasc-chat2api-accounts"
  version = 1
  exportedAt = ISO8601
  accounts = AccountCredential[]
}

AccountCredential {
  accountId
  providerId
  label?
  email?
  phone?
  accountInfo = allowedIdentityFieldsOnly
  credentials = providerCredentialFields
  cookie?
  authMethod?
  enabled?
}

WebSession {
  sessionId = randomOpaqueToken
  accountId
  expiresAt
  consumed = false
  restoreProfile = sanitizedProviderProfile
}
```

`AccountCredential` 不允许包含 Provider 定义、全局 config、modelMappings、API keys、任意未知对象或内部存储元数据。导出和消费响应均禁止把完整凭证写入日志。

## 新账号 ID

```text
function normalizeEmail(value):
  text = trim(value)
  if text is empty: return null
  return lowerCase(text)

function normalizePhone(value):
  text = removeWhitespaceHyphenParentheses(value)
  if text is empty: return null
  return text

function deriveNewAccountId(providerId, email, phone, existingIds, incomingIds):
  normalizedEmail = normalizeEmail(email)
  if normalizedEmail exists:
    candidate = providerId + ":" + normalizedEmail
  else:
    normalizedPhone = normalizePhone(phone)
    if normalizedPhone exists:
      candidate = providerId + ":" + normalizedPhone
    else:
      candidate = existingRandomIdFormat(providerId)
  if candidate conflicts with another identity in existingIds or incomingIds:
    return existingRandomIdFormat(providerId)
  return candidate

function selectAccountId(input, context):
  if input.accountId is non-empty:
    return input.accountId                 // 保留旧 ID
  return deriveNewAccountId(input.providerId, input.email, input.phone,
                            context.existingIds, context.incomingIds)
```

新建手动账号和 OAuth 完成账号都调用 `selectAccountId`；更新已有账号时只使用显式 `accountId`，不因邮箱或手机号变化而重命名。

## 账号包导出

```text
function exportAccountCredentials():
  accounts = dataStore.listAccounts(includeSecrets = true)
  bundleAccounts = []
  for account in accounts:
    bundleAccounts.push(selectAllowedCredentialFields(account))
  return {
    format: "aasc-chat2api-accounts",
    version: 1,
    exportedAt: nowIsoString(),
    accounts: bundleAccounts
  }
```

下载接口设置 JSON attachment、`Cache-Control: no-store`，并沿用现有 API 认证。控制端下载前显示敏感凭证提示。

## 账号包校验与预览

```text
function validateAccountBundle(payload):
  require payload is object
  require payload.format == "aasc-chat2api-accounts"
  require payload.version == 1
  require payload.accounts is array and size <= MAX_IMPORT_ITEMS
  seenIds = empty set
  normalized = []
  for raw in payload.accounts:
    account = selectAllowedCredentialFields(raw)
    require nonEmpty(account.providerId)
    account.accountId = selectAccountId(account, {
      existingIds: dataStore.listAccountIds(),
      incomingIds: seenIds
    })
    if account.accountId in seenIds:
      reject("duplicate accountId in bundle")
    seenIds.add(account.accountId)
    normalized.push(account)
  return normalized

function previewAccountImport(payload):
  incoming = validateAccountBundle(payload)
  existing = dataStore.getAccountsById()
  result = {items: [], counts: {new: 0, update: 0, invalid: 0}}
  for account in incoming:
    provider = dataStore.getProvider(account.providerId)
    if provider missing or provider.disabled:
      result.items.push(sanitizedInvalidItem(account, "provider_unavailable"))
      result.counts.invalid += 1
      continue
    action = existing[account.accountId] exists ? "update" : "new"
    result.items.push(sanitizedPreviewItem(account, action))
    result.counts[action] += 1
  result.confirmation = hashCanonicalPayloadAndPreview(incoming, result)
  return result
```

预览项只能包含 `accountId`、Provider、label、邮箱/手机号、动作、凭证字段名/存在标记和错误原因。任何 Token、Cookie、Authorization 值都必须被掩码或省略。

## 账号包合并

```text
function mergeAccountImport(payload, confirmation, confirmed):
  require confirmed == true
  incoming = validateAccountBundle(payload)
  preview = previewAccountImport(payload)
  require constantTimeEqual(confirmation, preview.confirmation)
  require preview has no invalid items
  beginAtomicStoreUpdate()
  for account in incoming:
    old = dataStore.getAccount(account.accountId)
    merged = mergeAllowedAccountFields(old, account)
    dataStore.saveAccount(merged)
  commitAtomicStoreUpdate()
  return sanitizedMergeResult(incoming, preview)
```

合并不会删除未出现在包内的账号；同 ID 更新，其他 ID 原样保留。确认摘要失效时要求重新预览。

## WebSession 服务端

```text
function createAccountWebSession(accountId):
  account = dataStore.getAccount(accountId)
  require account exists and account.enabled
  provider = dataStore.getProvider(account.providerId)
  require provider exists and provider.enabled
  profile = getAndroidLoginProfile(account.providerId)
  session = sessionStore.create({
    accountId,
    expiresAt: now + WEB_SESSION_TTL,
    restoreProfile: profile.restoreOnlyFields,
    oneTime: true
  })
  return {sessionId: session.id, consumeUrl: configuredConsumeUrl(),
          providerId: account.providerId, loginUrl: profile.loginUrl}

function consumeAccountWebSession(sessionId):
  session = sessionStore.consumeOnce(sessionId)
  require session exists and session.expiresAt > now
  account = dataStore.getAccount(session.accountId)
  require account exists and account.enabled
  return {
    loginUrl: session.restoreProfile.loginUrl,
    allowedOrigins: session.restoreProfile.allowedOrigins,
    cookieMappings: session.restoreProfile.cookieMappings,
    localStorageMappings: session.restoreProfile.localStorageMappings,
    credentials: selectAllowedCredentialFields(account).credentials,
    cookie: account.cookie,
    authMethod: account.authMethod
  }
```

服务端内存/短期缓存保存会话，消费后立即删除；HTTP 响应不缓存，错误统一为过期、无权限、Provider 不可用或会话已消费。控制端只接收创建结果，不接收消费响应中的凭证。

## 控制端伪代码

```text
function renderAccountTools():
  addButton("导出账号凭证", downloadAccountBundle)
  addFileInput("导入账号凭证", previewAccountBundle)

async function previewAccountBundle(file):
  payload = parseJson(file)
  preview = await POST("/api/chat2api/accounts/import/preview", payload)
  renderSanitizedPreviewTable(preview.items, preview.counts)
  if preview.counts.invalid > 0:
    disableConfirm()
  else if userConfirms("确认按账号 ID 新增/更新？"):
    await POST("/api/chat2api/accounts/import/merge", {
      payload, confirmation: preview.confirmation, confirmed: true
    })
    reloadAccounts()

async function openExternalAccountPage(accountId):
  session = await POST("/api/chat2api/accounts/" + encode(accountId) + "/web-session")
  if NativeControl is available:
    NativeControl.openChat2ApiAccountWeb(stringifyOpaqueSession(session))
  else:
    showMessage("请在 Android APK 中打开外部网页")
```

凭证导入文件读取失败、预览过期和合并失败必须显示错误；页面状态不把原始 JSON 放入可见文本或 localStorage。

## Android WebView 伪代码

```text
function openAccountWeb(sessionJson):
  session = parseOpaqueSession(sessionJson)
  startIsolatedLoginActivity(mode = ACCOUNT_WEB, session)

async function loadAccountWebSession(session):
  response = HTTPS_POST(session.consumeUrl, {sessionId: session.sessionId})
  require response.success
  memoryState = response.body
  if memoryState.cookieMappings is empty and memoryState.localStorageMappings is empty:
    showManualLoginBanner()
  webView.start(memoryState.loginUrl)

onPageStarted(url):
  if not originAllowed(url, memoryState.allowedOrigins):
    disableRestoreForCurrentPage()
    return
  for mapping in memoryState.cookieMappings:
    CookieManager.setCookie(mapping.origin, mapping.name + "=" + mapping.value)

onPageFinished(url):
  if originAllowed(url, memoryState.allowedOrigins):
    script = buildLocalStorageScript(memoryState.localStorageMappings)
    evaluateJavascript(script)       // value never enters logs
    reloadOnceIfStorageWasInjected()
  showRestoreResultOrManualLogin()

onActivityDestroyed():
  memoryState = null
  webView.clearCookiesStorageCacheHistory()
```

只使用 profile 白名单中的 Cookie 名称、LocalStorage key 和 origin。Authorization-only profile 不注入请求头，直接显示手动登录提示。恢复失败不提交账号、不更新服务端凭证。

## 错误处理

```text
if invalid bundle: return 400 with field errors
if preview confirmation mismatch: return 409 and require new preview
if session missing/expired/consumed: return 410 without credential data
if provider disabled/account missing: return 404/409 without credential data
if unsupported restore mapping: open page and show manual login
if page origin disallowed: skip restore and show security error
if WebView load fails: show retry and cleanup temporary data
```

## 测试契约

### Node.js

- 新账号邮箱/手机号/无身份 ID 生成，旧显式 ID 保留。
- 账号导出不含 Provider、config、modelMappings、API keys；字段白名单和敏感预览脱敏。
- 预览能返回 new/update/invalid，重复 incoming ID 被拒绝。
- 合并确认摘要失效、重复提交和未出现账号保留。
- web-session TTL、一次性消费、重放、账号禁用和 Provider 禁用。
- HTTP 路由和静态控制端按钮行为；旧完整导入导出回归。

### Android

- Cookie 映射、LocalStorage 映射和允许 origin 判断。
- Authorization-only/无映射时手动登录回退。
- 不允许 origin 不写 Cookie、不注入脚本。
- Activity 销毁清理 Cookie、WebStorage、缓存和历史；凭证不进入日志或持久化。

## 验证命令

```text
npm run test -- src/apps/server/modules/chat2api/chat2api-data-store.test.js
npm run test -- tests/chat-config-transport.test.js
./gradlew :app:testDebugUnitTest   (src/apps/android-display)
npm test
```

实现完成后应记录每条定向测试和全量测试结果；全量测试中的既有失败必须单独标明，不得用新功能结果覆盖。

## 已实现模块与验证结果

- `chat2api-account-identity.js`：新账号 ID 规范化与旧 ID 保留。
- `chat2api-data-store.js`：`exportAccountCredentials`、`previewAccountImport`、`mergeAccountImport`，预览摘要在进程内短期保存以保证无身份随机 ID 在确认时保持一致。
- `chat2api-account-web-session-service.js`：短 TTL、一次性消费和 profile 白名单恢复映射。
- `chat2api-proxy-service.js` / `chat2api-management-service.js`：账号导出、预览/合并和 WebSession 五个管理路由，凭证导出/消费响应设置 `Cache-Control: no-store`。
- `chat2api.js`：独立账号包入口、脱敏表格、按当前网关地址重写 Android 消费 URL。
- Android `Chat2ApiCredentialRestore`、`Chat2ApiAuthWebView`、`Chat2ApiLoginActivity`、`Chat2ApiNativeBridge`：隔离网页恢复、非法 origin 防护、手动登录回退和销毁清理。
- 定向验证：`npm run check:chat2api` `91/91`；Android `:app:testDebugUnitTest` 通过；全量 `npm test` `848/848`。
