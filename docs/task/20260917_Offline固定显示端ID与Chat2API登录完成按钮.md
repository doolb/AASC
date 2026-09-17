# Offline 固定显示端 ID 与 Chat2API 登录完成按钮

## 任务描述

为 Offline APK 增加独立固定显示端 ID `offline-display`，使 release 任务恢复不再依赖 WebView 随机 ID；同时在 Android 外部 Chat2API 登录 Activity 顶部增加原生“完成”按钮，放在“取消”按钮之前，避免 Provider 页面覆盖控制端后无法提交登录结果。

本次明确暂不处理显示端/控制端 WebView 的遮挡层级改造。

## design 需求

- 依据 `docs/design/android-display-offline-apk.md` 的固定 ID 约定。
- 依据 `docs/design/android-chat2api-login-control.md` 的原生登录操作栏约定。
- 普通 APK、浏览器显示端和现有远程控制端授权流程保持不变。

## spec 设计

- Offline 启动加载 `/display?displayId=offline-display`；MainActivity 在页面脚本执行前预置 localStorage，display.html 同时优先使用查询参数建立 WebSocket ID。
- release Offline render-display 任务目标使用 `offline-display`。
- Chat2ApiLoginActivity 创建“完成”“取消”两个原生按钮；完成按钮即时合并捕获结果，字段不全时不关闭页面。

## 受影响功能模块和代码

- Android Offline URL 与显示端 ID：`src/apps/android-display/app/src/main/java/com/aasc/display/ServerConfig.kt`、`MainActivity.kt`、`src/apps/web-mediacenter/ui/public/display.html`。
- release 任务结果与已安装数据迁移：`release/task/render-display/results/index.json`、对应开发任务结果索引、`NodeServerService.kt`。
- Chat2API 原生登录：`Chat2ApiLoginActivity.kt`、`Chat2ApiAuthWebView.kt`。
- 回归测试：Android `ServerConfigTest`、Chat2API/Offline 静态契约测试及凭据捕获测试。
- 文档：对应 design/spec、`docs/todo.md`、`changelog.md`。

## 自测用例

- Offline `ServerConfig.pageUrl` 包含 `displayId=offline-display`，普通 APK URL 不包含固定 ID。
- display.html 存在查询参数时优先使用该 ID，未配置时保留原有随机持久化行为。
- release render-display 任务目标为 `offline-display`。
- 旧 full APK 私有数据中的 render-display 索引在 Node 服务启动前迁移为 `offline-display`。
- 原生登录顶部按钮顺序为“完成”在前、“取消”在后；完成按钮能调用即时捕获，凭据不全时不结束 Activity。
- 已有自动捕获、取消、超时和手工网页登录回退测试不回归。

## 兼容性测试

- Android API 28 Offline APK JVM 测试和 Debug 构建。
- 普通 APK URL、控制端和桌面浏览器手工登录路径静态回归。

## 性能测试

- 固定 ID 不增加额外网络请求；仅在 WebView URL 和 WebSocket 连接阶段读取一次查询参数。
- 手动完成只执行一次当前页面凭据读取，不改变既有 1 秒轮询周期。

## 风险评估

- 同一服务端同时运行多个 Offline APK 会共享 `offline-display` 身份，部署时需保持一个服务对应一个 Offline 显示端。
- Provider 页面禁止 WebView 或凭据字段尚未出现时，完成按钮会提示重试，不绕过服务端验证。

## 预计工时

约 0.5 个工作日，包含定向测试和 Android JVM 构建验证。

## 执行状态

已完成：已确认暂不处理遮挡层级改造；固定 ID、原生完成按钮和 min 热更包均已生成并通过定向验证。

## 实际执行结果

- Offline `ServerConfig` 使用 `offline-display`，MainActivity 同时在页面 URL 和旧 display.html 的 localStorage 中预置该 ID；release 与开发任务结果索引已同步。
- Chat2ApiLoginActivity 顶部按钮顺序为“完成”“取消”；完成按钮调用 `Chat2ApiAuthWebView.completeCapture`，字段不完整时只提示、不关闭登录页面。
- `allserver-min` 已升至 versionCode `6`、versionName `0.2.4-offline-min`，生成 `release/offline-update/output/apk/aasc-display-offline-min-v6.apk`；v5 保留为不含任务索引迁移的中间工件。
- min APK 大小 `89208438` bytes，SHA-256 `0f7af47dbba366758ebbe818994da37f39028bd8174ba6b3dfa8754f33366b68`；签名证书 SHA-256 `a57fd4c34c0c769246239a7d8c606b5edb62c215ecf9659448ea178eda3fb7df`。
- Node Chat2API 定向测试 `84/84`、Offline/Chat2API 静态回归 `24/24`、Android `:app:testDebugUnitTest` 和 APK ZIP/签名校验通过；未执行真实 Provider 账号登录。
- min v6 已正式发布到 LAN `http://192.168.1.39/mnt/aasc-offline/` 与 WAN `http://120.79.245.103/mnt/aasc-offline/`；两站点 manifest 字节一致且验签通过，APK 大小 `89208438` bytes、SHA-256 `0f7af47dbba366758ebbe818994da37f39028bd8174ba6b3dfa8754f33366b68`，LAN/WAN HTTP 返回 200 和正确 Content-Length，WAN 远端文件 hash 一致。
