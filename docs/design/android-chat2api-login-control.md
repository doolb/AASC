# Android Chat2API 登录与显示端控制端开放

## 需求

Android 普通 APK 和离线 APK 都需要能够在本机控制端完成 Chat2API Provider 登录。登录不能依赖用户手工复制 Token 或 Cookie，而应在 APK 内使用独立 WebView 打开 Provider 登录网页，捕获登录后的认证信息，交由 AASC Chat2API 服务端验证并保存账号。

Android 显示端默认不显示控制端入口。主控制端需要针对单个 Android 显示端提供“开放控制端”开关，开关关闭时 APK 不显示按钮，开启后普通 APK 和离线 APK 都显示按钮并可打开同源 `/control` 页面。

## 范围

- 支持普通 Android APK 和 Android Offline APK。
- 每个显示端独立保存“开放控制端”状态，默认关闭，断线重连后保持。
- Android 使用独立登录进程和 WebView，不复用显示端 WebView、控制端 WebView 或系统浏览器 Cookie。
- 当前不增加桌面端 Electron 登录助手；桌面浏览器继续保留现有手工登录回退路径。
- 当前不把 Provider Token、Cookie 或完整登录网页内容写入日志、显示端状态、任务参数或控制端列表。

## 架构

```text
主控制端
    └─ 按 Android 显示端设置 androidControlPageOpen
         ↓ WebSocket displayControlAccess
Android display.html
    └─ NativeDisplay.setControlPageAccess(enabled)
         ↓
MainActivity 原生“控制端”按钮
    └─ Control WebView 加载同源 /control
         └─ NativeControl.openChat2ApiLogin(loginSession)
              ↓ Activity 独立进程
         Chat2ApiLoginActivity + 独立 WebView
              ├─ 捕获允许域名的 Authorization
              ├─ 读取允许字段的 localStorage
              ├─ 读取允许域名和 Cookie 名称的 Cookie
              └─ 返回候选凭据
                   ↓
         Control WebView POST /api/chat2api/oauth/complete
              ↓
         Chat2API Provider 验证器
              ↓ 成功
         task 自己的 accounts.json
```

登录 Activity 使用单独 Android 进程，使其可以在创建首个 WebView 前设置独立的 WebView 数据目录。登录完成、取消或超时后销毁 WebView 并删除临时 WebView 数据，不影响显示页和控制页的 Cookie。

## 显示端开放协议

Android `display.html` 在能力声明中增加 `androidControlPage: true`。服务端只对声明该能力的显示端显示“开放控制端”设置。

控制端向服务端发送：

```text
type = setAndroidControlPage
displayId = 目标显示端 ID
enabled = true 或 false
```

服务端验证目标在线且具备 Android 控制端能力，更新该显示端持久状态，发送：

```text
type = displayControlAccess
enabled = true 或 false
```

显示端收到消息后同步原生按钮可见性；服务端在显示端连接初始化时补发当前值。旧版 APK 未声明能力时不显示该设置，也不受该协议影响。

## Android 登录捕获

服务端 `oauth/start` 返回登录地址和脱敏捕获配置。捕获配置只包含 Provider 预定义的域名、网络 Authorization 捕获规则、localStorage 字段和 Cookie 字段，不允许控制端网页下发任意脚本或任意域名。

Android 登录 WebView：

- 仅对配置允许的 Provider 域名处理请求头。
- 从 `WebResourceRequest` 请求头中提取 Bearer Authorization，并映射到 Provider 凭据字段。
- 在页面完成和登录轮询期间读取配置的 localStorage 键。
- 通过 `CookieManager` 获取配置域名的 Cookie，并按 Cookie 名称映射凭据。
- 只有必填凭据字段齐全时提交一次候选；服务端验证失败时保留登录页面，允许重新捕获。
- 不向普通日志打印候选值；取消、关闭、超时和成功后清理临时状态。

当前内置 Provider 的捕获映射复用 `/mnt/Chat2API` 的 `tokenExtractionConfig.ts`：DeepSeek、GLM、Kimi、MiniMax、MiMo、Perplexity、Qwen、Qwen AI 和 Z.ai。自定义 Provider 没有安全捕获配置时继续使用手工凭据表单。

## 服务端验证与保存

服务端按 Provider 使用真实接口验证候选凭据，并生成标准化账号凭据和可选账号信息。验证失败不得消耗未过期登录 state，避免用户必须重新打开网页登录页；验证成功后才原子消费 state、保存账号并返回脱敏账号。

登录 state 继续绑定 Provider、一次性使用并设置过期时间。服务端完成验证和保存期间按 state 串行化，避免同一个候选被重复保存。

## 兼容性与安全

- 离线 APK 的本地 Chat2API 服务仍使用 `https://127.0.0.1:8081`；外部 Provider 登录和验证需要设备具备网络访问能力。
- Android 设备只负责捕获和提交候选凭据，账号持久化和 Provider 验证仍由本地 Node Chat2API 服务完成。
- 控制端开关是显示端入口授权，不等同于 Chat2API API Key 鉴权。
- Android WebView、服务端和控制端都禁止输出完整 Token、Cookie、Authorization 和 API Key。

## 实现状态与本次验收

- 服务端已实现按显示端保存 `androidControlPageOpen`、能力校验、断线重连补发和控制端权威广播。
- 控制端开关位于选中的 Android 显示端详情/功能面板中，不放在设备卡片本身；Chat2API 登录优先调用 Android 原生桥，桌面端仍保留原有手工登录回退。
- 普通 APK 和离线 APK 共用原生控制端及隔离登录 WebView 代码；本次按范围只重新构建、安装和启动普通 APK，未构建离线 APK。
- 普通 APK 已完成真机启动冒烟和无崩溃检查；Provider 真实网页登录需要测试账号，暂留现场验收，不将测试凭据写入项目或日志。
