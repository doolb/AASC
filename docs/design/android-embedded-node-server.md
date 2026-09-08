# Android APK 内置 Node.js 子服务器设计

## 需求

`apk-display` 需要从单纯的 WebView 显示端升级为“显示端 + Node.js 子服务器”节点。APK 启动器启动 Node.js 服务，Node.js 服务以 `subserver` 角色主动连接主服务器；WebView 显示端继续连接主服务器 `/display`，不连接本机地址。

## 设计结论

- 使用 APK 私有目录中的 arm64 Node.js Runtime，不依赖 Termux。
- Android 前台 `NodeServerService` 启动 `server-launcher.js`；launcher 再 fork `server-app.js`，保持现有双进程模型。
- APK 只启用 HTTP/HTTPS、WebSocket、AASC 主动连接和媒体库能力。
- ASR 隔离进程、Wine、Puppeteer、外部 CLI 和桌面 TUI 等额外子进程能力关闭。
- 主服务器地址默认 `https://192.168.1.39:8081`，保留手动修改；该地址同时用于子服务器主动连接和 WebView `/display`。

## 数据流

```text
APK Launcher
  ├─ NodeServerService → node server-launcher.js → server-app.js
  │                         └─ wss://主服务器/server（注册/心跳/媒体请求）
  └─ MainActivity/WebView → https://主服务器/display
```

子服务器监听局域网地址，主服务器使用注册上报的 `advertisedUrl` 生成媒体直连地址；直连失败时使用主服务器代理。WebView 的控制和播放入口不改为本机地址。

## 依赖边界

Node.js 服务器运行包必须在构建时生成并校验，运行时只从 APK 私有目录读取。用户媒体、配置、证书和日志不能写入 APK assets，也不能随代码包覆盖。Node.js 服务缺少可选 Android 不兼容依赖时必须保持主服务启动，并在能力和请求错误中明确反映。

## 相关代码

- Android：`MainActivity.kt`、`NodeServerService.kt`、`NodeRuntimeInstaller.kt`、`NodeServerConfig.kt`、Manifest 和 Gradle assets 配置。
- Node.js：现有 `server-launcher.js`、`server-app.js`、配置模块和 AASC NodeConnector。
- 构建：新增 Android Node Runtime/服务器运行包准备脚本和校验测试。
- 文档：`docs/spec/android-embedded-node-server.md`、本设计文档和对应 task 文档。
