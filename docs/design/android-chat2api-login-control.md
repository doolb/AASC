# Android Chat2API 登录与显示端控制端开放

## 需求

Android 普通 APK 和离线 APK 都需要能够在本机控制端完成 Chat2API Provider 登录。登录不能依赖用户手工复制 Token 或 Cookie，而应在 APK 内使用独立 WebView 打开 Provider 登录网页，捕获登录后的认证信息，交由 AASC Chat2API 服务端验证并保存账号。

普通 Android 显示端默认不显示控制端入口；离线 APK 因为本地服务和控制端同包，启动后默认显示控制端入口。主控制端仍可针对普通 Android 显示端提供“开放控制端”开关，普通 APK 开关关闭时不显示按钮，开启后可打开同源 `/control` 页面。

## 范围

- 支持普通 Android APK 和 Android Offline APK。
- 普通 Android 显示端独立保存“开放控制端”状态，默认关闭，断线重连后保持；离线 APK 使用本地内置控制端入口，默认开启。
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

登录页面顶部原生操作栏固定显示“完成”和“取消”两个按钮，顺序为“完成”在前、“取消”在后。用户点击“完成”时，Activity 先读取当前允许域名的 localStorage/Cookie 并合并已捕获的 Authorization；必填字段齐全则立即返回候选凭据，字段不全则保留登录页面并提示继续登录。该按钮位于原生 WebView 之外，外部 Provider 页面覆盖控制端时仍可操作。

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

离线 APK 收到服务端默认的 `enabled=false` 时仍保留本地控制端入口，因为该入口用于访问同一 APK 内的本地 `/control` 页面；普通 APK 继续严格遵循服务端授权状态。

## 控制端页面图层

Android 原生按钮、显示端 WebView、控制端 WebView 和首次启动遮罩都位于同一个 `FrameLayout` 时，必须明确维护显示顺序：显示端 WebView 作为底层，控制端 WebView 作为可切换的上层页面，控制端按钮位于控制端页面之上，启动遮罩仅在离线服务未就绪期间位于最上层。控制端页面打开后，显示端 WebView 不得继续覆盖控制端 WebView；否则按钮虽然收到点击，用户仍只能看到原显示页。

该图层约束同时适用于普通 APK 和 offline APK，不能仅依赖注释推断 Android 的绘制顺序；当前实现将控制端 WebView 插入 display WebView 之上，并通过运行时层级和真机点击回归确认。

## Android 登录捕获

服务端 `oauth/start` 返回登录地址和脱敏捕获配置。捕获配置只包含 Provider 预定义的域名、网络 Authorization 捕获规则、localStorage 字段和 Cookie 字段，不允许控制端网页下发任意脚本或任意域名。

Android 登录 WebView：

- 仅对配置允许的 Provider 域名处理请求头。
- 从 `WebResourceRequest` 请求头中提取 Bearer Authorization，并映射到 Provider 凭据字段。
- 在页面完成和登录轮询期间读取配置的 localStorage 键。
- 通过 `CookieManager` 获取配置域名的 Cookie，并按 Cookie 名称映射凭据。
- 只有必填凭据字段齐全时提交一次候选；服务端验证失败时保留登录页面，允许重新捕获。
- 不向普通日志打印候选值；取消、关闭、超时和成功后清理临时状态。
- 用户可以手动点击原生“完成”触发一次即时捕获；未捕获完整凭据时不会关闭登录窗口，轮询捕获仍继续运行。

当前内置 Provider 的捕获映射复用 `/mnt/Chat2API` 的 `tokenExtractionConfig.ts`：DeepSeek、GLM、Kimi、MiniMax、MiMo、Perplexity、Qwen、Qwen AI 和 Z.ai。自定义 Provider 没有安全捕获配置时继续使用手工凭据表单。

## 服务端验证与保存

服务端按 Provider 使用真实接口验证候选凭据，并生成标准化账号凭据和可选账号信息。验证失败不得消耗未过期登录 state，避免用户必须重新打开网页登录页；验证成功后才原子消费 state、保存账号并返回脱敏账号。

登录 state 继续绑定 Provider、一次性使用并设置过期时间。服务端完成验证和保存期间按 state 串行化，避免同一个候选被重复保存。

## 兼容性与安全

- 离线 APK 的本地 Chat2API 服务仍使用 `https://127.0.0.1:8081`；外部 Provider 登录和验证需要设备具备网络访问能力。
- Android 设备只负责捕获和提交候选凭据，账号持久化和 Provider 验证仍由本地 Node Chat2API 服务完成。
- 控制端开关是显示端入口授权，不等同于 Chat2API API Key 鉴权。
- Android WebView、服务端和控制端都禁止输出完整 Token、Cookie、Authorization 和 API Key。

## Offline 本机账号导入验证（2026-09-18）

- Offline Chat2API 账号迁移通过本地同源网关的“预览 → 明确确认合并”接口执行，只导入账号集合，不覆盖 Offline 端已有 Provider、代理配置和模型映射。
- 导入过程不输出凭据；导入后只通过脱敏账号列表、可用模型列表和最小 Chat Completions 请求验证账号可用性。

## Offline 控制端手动聊天验证（2026-09-18）

- 控制端手动聊天必须使用 `mode=llm`、`protocol=openai-completions` 和当前 Chat2API 代理端口；`agent/pi` 配置会转入 Pi Agent 运行时，不会发送 Chat2API 请求。
- 真机现有 `qwen3.5` 配置的模型为 `Qwen3.6-Flash` 且模式为 `agent/pi`，实际错误来自缺失的 Pi Provider manifest；临时切换为 `Qwen3.6` 的 Chat Completions 配置后，控制端 WebSocket 请求返回 `OK`，测试结束恢复原配置。
- 历史已发布包曾因 Android 资源打包过滤隐藏文件而遗漏 Pi SDK 的 `pi-ai/dist/providers/data/.manifest.json`；新实现将该文件安全改名为 marker 并在 Runtime 安装后恢复，详见 `android-offline-pi-sdk-and-chat2api-responses.md`。含新资源的 APK 仍需真机安装后完成 agent/pi 验收。

## 实现状态与本次验收

- 服务端已实现按显示端保存 `androidControlPageOpen`、能力校验、断线重连补发和控制端权威广播。
- 控制端开关位于选中的 Android 显示端详情/功能面板中，不放在设备卡片本身；Chat2API 登录优先调用 Android 原生桥，桌面端仍保留原有手工登录回退。
- 普通 APK 和离线 APK 共用原生控制端及隔离登录 WebView 代码；本次已重新构建、安装和启动 offline APK，Provider 真实账号网页登录仍需测试账号现场验收。
- 原生 Chat2API 登录页顶部已增加“完成”按钮并置于“取消”之前；按钮会即时合并当前页面 localStorage/Cookie 与已捕获 Authorization，字段不全时保留登录页并提示重试。
- 离线 APK 默认显示控制端入口；启动状态遮罩仅在本地 display 页面成功加载后隐藏，错误页完成回调不得误隐藏遮罩。

### 原生控制端入口的边缘收缩

为避免原生控制端入口长期遮挡显示端内容，按钮默认以贴近屏幕边缘的小型收缩标签显示。第一次点击只展开完整“控制端”按钮，不立即打开控制端页面；第二次点击完整按钮后才显示 `/control` WebView。控制端页面关闭后入口恢复收缩状态。入口授权、Offline 默认可用规则、WebView 图层和返回键行为保持不变。

收缩标签固定吸附在左侧边缘，使用独立的短文案和无障碍描述；展开状态使用原有完整按钮文案。启动遮罩或更新卡片显示时，入口仍遵循现有层级和可见性约束。
- 普通 APK 已完成真机启动冒烟和无崩溃检查；Provider 真实网页登录需要测试账号，暂留现场验收，不将测试凭据写入项目或日志。
- 2026-09-18 已将本机 Qwen 账号导入 SM-N9500 Offline Chat2API，账号列表和 6 个 Qwen 模型可见，最小 Chat Completions 请求返回成功；凭据未写入项目或日志。
