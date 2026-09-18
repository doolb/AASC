# Chat2API 账号凭证导入导出与 Android 外部网页恢复

## 状态

- 已完成实现与定向回归；Android 真机网页恢复仍需真实账号现场验收。
- 本功能不改变现有完整配置导入导出接口；账号凭证使用独立的明文 JSON 包。

## 目标

1. 在控制端 Chat2API 面板单独导出和导入账号凭证，便于迁移账号而不携带 Provider、模型映射、API Key 和全局配置。
2. 导入前展示账号身份和新增/更新结果，用户明确确认后才写入；相同 `accountId` 更新，其他账号保留。
3. 新建账号优先使用可读的邮箱或手机号生成稳定 ID；已有账号的旧 ID 永不自动改写。
4. 控制端账号行增加“打开外部网页”，Android APK 使用隔离 WebView 尝试恢复选中账号的网页登录状态。
5. 账号凭证只在短期会话和 Android 原生内存中流转，避免通过控制端页面、日志或持久化 WebView 数据暴露。

## 非目标

- 不把 Provider、模型映射、API Key、服务端配置合并进账号包。
- 不自动删除导入文件中未出现的本地账号。
- 不保存 Android WebView 的长期登录数据，也不在外部网页中自动提交账号密码。
- 不强行恢复只有 Authorization 头、没有 Cookie 或 LocalStorage 映射的 Provider；这类账号只打开网页并提示手动登录。
- 暂不处理外部网页遮挡控制端的交互问题。

## 现有能力与改造边界

现有 `chat2api-data-store` 已有完整配置的导出、预览和合并；`chat2api-proxy-service` 已有账号 CRUD 和完整配置路由；Android 已有独立进程的 `Chat2ApiLoginActivity`、`Chat2ApiAuthWebView` 和登录捕获 profile。本功能在这些边界上增加账号专用包、一次性网页会话和恢复动作，不新建独立 HTTP 配置存储流程。

## 账号身份与 ID

### 新账号

- 邮箱优先：去除首尾空白并转小写，生成 `<providerId>:<normalizedEmail>`。
- 没有邮箱时使用手机号：去除空白、短横线和括号，保留国际区号，生成 `<providerId>:<normalizedPhone>`。
- 没有邮箱和手机号时保留现有随机 ID 生成方式，并在响应中标记为不可推导身份。

生成前检查本地和本次导入包内的重复 ID；同一导入包重复出现同一 ID 直接拒绝预览，不猜测覆盖顺序。显式带有 `accountId` 的旧账号继续使用原值，即使它不是新规则格式。

### 账号身份字段

账号包只允许导出以下身份和认证字段：`accountId`、`providerId`、`label`、`email`、`phone`、受白名单约束的 `accountInfo`、`credentials`、`cookie`、`authMethod` 和 `enabled`。任意未知字段不进入包；预览响应进一步脱敏认证值，只返回是否存在和字段名。

## 账号凭证包

```json
{
  "format": "aasc-chat2api-accounts",
  "version": 1,
  "exportedAt": "2026-09-18T00:00:00.000Z",
  "accounts": [
    {
      "accountId": "qwen:user@example.com",
      "providerId": "qwen",
      "label": "主账号",
      "email": "user@example.com",
      "phone": "+8613812345678",
      "accountInfo": {},
      "credentials": {},
      "cookie": "",
      "authMethod": "cookie",
      "enabled": true
    }
  ]
}
```

导出文件是明文 JSON。控制端下载前明确提醒文件包含 Token/Cookie 等敏感凭证；不提供 Provider、配置、模型映射或 API Key。导入格式、版本和数量上限必须校验，未知字段忽略，必需字段缺失则拒绝。

## 导入预览与合并

1. 上传后调用账号专用预览接口。
2. 服务端按 `accountId` 与本地账号比较，返回 `new`、`update`、`invalid` 三类结果及脱敏身份摘要。
3. 控制端以表格展示 Provider、label、邮箱/手机号、账号 ID、动作和错误原因；不把 Token、Cookie 或完整 `credentials` 写入 DOM。
4. 用户确认后提交预览返回的确认摘要/签名；服务端再次校验原始包和摘要，防止预览后被替换。
5. 合并采用 upsert：同 ID 更新允许字段，未出现的本地账号保持不变。写入使用现有数据存储的原子持久化和文件权限。
6. 合并成功返回新增、更新、失败数量及脱敏账号列表；服务端不回传完整凭证。

## Android 外部网页恢复

### 会话流程

1. 控制端账号行点击“打开外部网页”，只发送 `accountId` 和当前服务器地址。
2. 服务端校验账号存在、Provider 启用并创建短期一次性 `webSession`，返回不含凭证的会话令牌、消费地址和登录 profile 摘要。
3. Android 原生桥启动独立进程 `Chat2ApiLoginActivity` 的网页模式；Activity 用一次性令牌向消费地址取回登录 URL、允许来源、恢复映射和凭证。
4. 凭证只保存在原生进程内存，禁止写入 Intent 日志、控制端页面、SharedPreferences、普通日志和长期 WebView Cookie 数据。
5. Cookie 映射通过 `CookieManager` 写入允许来源；LocalStorage 映射在页面加载到允许 origin 后注入，并在必要时只重载一次。
6. 页面加载完成后显示“已尝试恢复，可继续手动登录”；关闭 Activity 或失败时清空 Cookie、LocalStorage、缓存和历史。
7. 会话只能消费一次并设置短 TTL；过期、重放、账号删除或 Provider 禁用都只返回可显示的错误，不返回凭证。

### 恢复能力

- 有受信任 Cookie 映射：自动设置 Cookie。
- 有受信任 LocalStorage 映射：按 key/value 注入，value 不进入 JS 日志。
- 只有 Authorization 头或没有恢复映射：打开登录页并提示手动登录。
- origin 不在 profile 白名单：不注入、不设置 Cookie，并显示安全错误。

## 接口

保留现有 `GET /api/chat2api/export` 作为完整配置导出，新增：

- `GET /api/chat2api/accounts/export`：下载账号凭证包。
- `POST /api/chat2api/accounts/import/preview`：校验账号包并返回脱敏预览与摘要。
- `POST /api/chat2api/accounts/import/merge`：携带账号包、预览摘要和用户确认后合并。
- `POST /api/chat2api/accounts/:accountId/web-session`：创建一次性外部网页会话。
- `POST /api/chat2api/accounts/web-session/consume`：Android 原生消费一次性会话。

所有接口使用现有 Chat2API 认证、错误格式和数据存储；不得增加独立的配置读取/保存接口。

## 受影响模块

- 服务端：`chat2api-data-store.js`、账号手动/OAuth 服务、`chat2api-proxy-service.js`、登录 profile。
- 控制端：`chat2api.js` 账号工具栏、账号行和导入预览。
- Android：`Chat2ApiNativeBridge.kt`、`Chat2ApiLoginActivity.kt`、`Chat2ApiAuthWebView.kt`、恢复映射辅助类及测试。
- 文档：本设计、对应 spec、任务文档、索引、todo 和 changelog。

## 风险与回退

- 明文包泄露风险通过下载警告、最小字段、权限 0600、预览脱敏和不写日志降低；用户仍需自行保护导出文件。
- Provider 页面变化可能使映射失效；失败时保留网页并提示手动登录，不阻断账号管理。
- 一次性会话失败不影响现有登录捕获和手动账号保存流程；可直接回退到旧登录入口。

## 验收标准

- 能导出仅含账号的 v1 JSON，完整配置中的 Provider/映射/API Key 不出现。
- 导入预览能区分新增、更新和无效项；确认后只 upsert 同 ID 账号，旧 ID 保留。
- 新建邮箱/手机号账号得到稳定可读 ID，缺少身份时仍能随机创建。
- Android 能消费一次性会话并按 profile 恢复 Cookie/LocalStorage；不支持时安全回退手动登录。
- 会话重放、过期、非法 origin、Provider 禁用和页面加载失败均有可操作错误提示。
- 现有完整导入导出、Android 登录捕获、Chat2API 请求回归不受影响。

## 实现结果

- 服务端已实现账号字段白名单、账号包导出、预览确认摘要、按账号 ID 合并、邮箱/手机号新 ID 和短 TTL 一次性网页会话。
- 控制端已增加账号凭证独立导入/导出、脱敏预览表和账号行“打开外部网页”。同源网关地址会在交给 Android 前替换为当前控制端可访问的消费地址。
- Android 已增加 `account-web` 隔离 Activity 模式、原生一次性会话消费、Cookie/LocalStorage 白名单恢复、非法来源跳过和销毁清理。
- 验证：Chat2API 定向测试 `91/91`、Android `:app:testDebugUnitTest`、项目全量 `npm test` `848/848` 通过。Android 真机 Provider 页面及恢复结果未在本任务中发布包现场复验。
