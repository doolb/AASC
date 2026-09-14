# Android Chat2API 登录与显示端控制端开放

## 任务描述

为普通 Android APK 和 Android Offline APK 增加显示端控制端开放开关，并在 Android 控制端内使用隔离 WebView 完成 Chat2API Provider 网页登录、Authorization/localStorage/Cookie 捕获、Provider 接口验证和账号保存。

## 执行状态

实现已完成。本次只按用户确认范围构建和测试普通 APK；离线 APK 未构建，Provider 真实账号网页登录留待现场使用测试账号验收。

## design 需求

- 使用 `docs/design/android-chat2api-login-control.md` 的 Android 专用方案。
- 每个显示端持久保存 `androidControlPageOpen`，默认关闭。
- 当前不实现桌面 Electron 登录助手。
- 不把敏感凭据写入日志、显示列表、任务参数或普通页面存储。

## spec 设计

- 显示端能力增加 `androidControlPage`。
- 增加 `setAndroidControlPage` / `displayControlAccess` WebSocket 消息。
- Android 原生控制按钮由服务端权威开关控制。
- `oauth/start` 返回安全的 Android 捕获配置。
- Android 登录 Activity 使用独立进程和 WebView 数据目录。
- `oauth/complete` 先验证、后消费 state、再保存账号；验证失败保留未过期 state。

## 受影响功能模块和代码

- 服务端显示端状态、WebSocket、控制端显示列表：`src/apps/server/boot/server-app.js`、`src/framework/transport/ws/connection.js`、`src/apps/web-mediacenter/ui/public/js/display-list.js`、`src/apps/web-mediacenter/ui/public/js/websocket.js`。
- Chat2API Provider 登录配置、OAuth 验证、任务运行时：`src/apps/server/modules/chat2api/chat2api-login-profiles.js`、`src/apps/server/modules/chat2api/chat2api-credential-validators.js`、`chat2api-oauth-service.js`、`chat2api-runtime.js`、`chat2api-data-store.js`。
- Android 原生入口和登录容器：`MainActivity.kt`、`NativeBridge.kt`、新增 `AndroidControlAccess.kt`、`Chat2ApiNativeBridge.kt`、`Chat2ApiLoginActivity.kt`、`Chat2ApiAuthWebView.kt`、`Chat2ApiCredentialCapture.kt`、`activity_main.xml`、`AndroidManifest.xml`。
- 控制端 Chat2API 登录和显示端详情开关：`src/apps/web-mediacenter/ui/public/js/chat2api.js`、`display-list.js`、`websocket.js`。
- 回归测试：`chat2api-android-login.test.js`、`tests/android-control-page-access.test.js`、`Chat2ApiCredentialCaptureTest.kt`、`ServerConfigTest.kt`。
- 文档：本任务对应 design/spec、`docs/todo.md`、`changelog.md`。

## 自测用例

- Android 控制端按钮默认隐藏，服务端开放后显示，关闭后立即隐藏。
- 普通 APK 和离线 APK 均能加载 `/control`。
- APK 能从假登录页面捕获 Authorization、localStorage 和 Cookie，并按 Provider 字段合并。
- 非允许域名的 Authorization、Cookie 和 localStorage 不被捕获。
- 取消、超时、重复点击和 WebView 销毁后不残留登录状态。
- Provider 验证成功保存脱敏账号；验证失败不保存账号且 state 仍可重试。
- state 过期、Provider 不匹配、重复完成均被拒绝。
- 现有手工登录路径和旧版非 Android 显示端不回归。

## 兼容性测试

- Android API 28 设备离线 APK。
- Android API 28 设备普通 APK。
- Android 新版本设备普通 APK。
- 未升级 APK：不声明 `androidControlPage` 时不显示开关。
- 无 WebView 原生桥的桌面控制端：保留手工登录回退。

## 性能测试

- 登录 WebView 不影响显示 WebView 和本地 MNN 推理内存。
- 轮询 localStorage/Cookie 的周期固定为 1000ms，登录结束立即停止。
- 同时只允许一个登录 Activity，不产生多份 Provider Cookie 容器。
- 控制端开关消息只写一次显示端状态，不产生高频广播。

## 风险评估

- Android WebView 对部分 Provider 的网络 Authorization 暴露字段可能因系统版本不同而不完整；保留 localStorage/Cookie 捕获，并将缺字段错误反馈到控制端。
- 第三方登录页可能要求验证码、设备校验或禁止 WebView；此类失败只返回可定位错误，不绕过 Provider 安全机制。
- 外部 Provider 接口变化会导致验证器失效；验证器必须有假 HTTP 回归用例和脱敏错误。
- 本功能需要外部网络；离线 APK 无网络时只能使用已有账号或导入配置，不能完成新网页登录。

## 预计工时

服务端协议与验证 1.5 天，Android 隔离 WebView 与页面桥接 2 天，控制端开关与状态同步 1 天，测试和 APK 真机验收 1.5 天，合计约 6 个工作日。

## 实际执行结果

- Node：`npm run check:chat2api` 通过，84/84；显示端控制端和 Chat2API 合并定向回归通过，83/83；新增 Android 登录候选保存、失败重试和敏感字段不回显测试通过。
- Android：在固定 MNN checkout `d407447ed56c4121a11ccbd266dc184ca1ead0c2` 下执行 `:app:testDebugUnitTest`，构建成功；包括凭据捕获、控制端按钮和控制端地址测试。
- 普通 APK：`npm run build:apk` 构建成功，安装到 `192.168.1.6:5555` 并启动 `com.aasc.display/.MainActivity`，进程正常且无 `AndroidRuntime` 崩溃日志；Manifest 包含独立进程 `Chat2ApiLoginActivity`。
- 本次未执行 `npm run build:apk:offline`，也未使用真实 Provider 账号完成网页登录、凭据捕获和接口验证；这些作为后续现场验收项保留。
