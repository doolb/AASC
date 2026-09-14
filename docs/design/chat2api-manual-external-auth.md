# Chat2API 普通网页手动外部认证设计

## 需求

普通网页控制端需要提供 Chat2API 外部账号添加界面。用户在浏览器中自行完成供应商登录后，从开发者工具或浏览器扩展复制 Cookie，回到 AASC 控制端粘贴并提交；AASC 不在普通网页中打开供应商登录页，也不承担 OAuth 回调。

登录字段和凭据提取规则参考 `/mnt/Chat2API` 的账号添加与 OAuth 管理实现，但页面只复用其 Provider 专属字段语义，不复制 Electron 登录页面。Android 端现有隔离 WebView 自动捕获能力继续保留。

## 设计

### 控制端

- 在 Chat2API 账号区域先选择 Provider，再进入一个统一的“外部认证”表单；不再提供“手动 Token/外部 Cookie”认证方式下拉框。
- 统一表单按 Provider 同时渲染其手动字段；支持完整 Cookie 的 Provider 额外显示 Cookie 粘贴框，用户填写 Token 字段或粘贴 Cookie 均从同一个入口提交。
- 普通网页不调用 `/oauth/start`，不弹出供应商登录页；Android 环境在同一表单中额外显示当前 Provider 的隔离 WebView 登录按钮，非 Android 环境不渲染该按钮。
- 完整 Cookie 粘贴框只给支持完整 Cookie 认证的 Provider 展示：MiMo、Perplexity、Qwen；DeepSeek、GLM、Kimi、MiniMax、Qwen AI、Z.ai 继续展示对应 Token/字段。Kimi 的 `kimi-auth` 是手动 Token 字段提示，不是完整 Cookie 认证方式。
- 提交后展示服务端校验结果，不在浏览器日志、提示文本或网络响应中回显完整凭据。
- Android 环境仍可在统一表单中显示“打开 Android 登录页”入口，用于当前 Provider 的隔离 WebView 捕获；该入口和普通网页手动填写互不依赖。

### 服务端

- 新增独立的手动账号添加服务和 `POST /api/chat2api/accounts/manual` 路由。
- 服务端解析标准 Cookie 字符串，按 Provider 的已知 Cookie 名称转换成现有账号字段：
  - MiMo：`serviceToken`、`userId`、`xiaomichatbot_ph` → `service_token`、`user_id`、`ph_token`
  - Perplexity：`__Secure-next-auth.session-token` 或 `next-auth.session-token` → `sessionToken`
  - Qwen：`tongyi_sso_ticket` → `ticket`
- 手动字段沿用各 Provider 的既有字段和说明，例如 GLM 的 `refresh_token`、Kimi 的 `kimi-auth` 值、Qwen AI/Z.ai 的 `token`；完整 Cookie 与手动字段同时提交时，以已知 Cookie 映射结果覆盖对应字段。
- 不把未知 Cookie 自动映射为 Token；不支持完整 Cookie 认证的 Provider 必须由用户填写现有 Token/字段。
- 手动添加复用现有 Provider 注册表、凭据适配器和真实接口校验，校验成功后调用现有账号数据存储；校验失败不保存账号。
- 路由只接收控制端现有请求边界内的数据，不新增独立配置读取/保存接口。

### 安全和兼容

- 原始 Cookie 只在服务端请求生命周期内参与解析和校验，不保存为未知凭据；日志中禁止输出原始 Cookie、Token 和 Authorization。
- 保持现有 `/api/chat2api/oauth/start`、`/api/chat2api/oauth/complete` 和 Android WebView 链路不变。
- 账号列表仍只返回现有脱敏结构；手动账号与 OAuth/Android 捕获账号使用同一存储格式。

## 验收标准

- 普通网页可选择 Provider、粘贴 Cookie 并添加账号，不会打开登录页。
- 已知 Provider 能按 Chat2API 规则提取凭据并通过校验后保存。
- 缺少必要 Cookie、输入格式错误、Provider 校验失败时不保存账号且返回可读错误。
- Android 自动登录回归不受影响。
