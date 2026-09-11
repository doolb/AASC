# Android APK 内置 Node.js 子服务器设计

## 需求

`apk-display` 需要从单纯的 WebView 显示端升级为“显示端 + Node.js 子服务器”节点。APK 启动器启动 Node.js 服务，Node.js 服务以 `subserver` 角色主动连接主服务器；WebView 显示端继续连接主服务器 `/display`，不连接本机地址。

## 设计结论

- 使用 APK 私有目录中的 arm64 Node.js Runtime，不依赖 Termux。
- Runtime 输入使用 Android 可执行 Node 二进制及其动态库；当前已验证 Termux 官方 arm64 `nodejs 26.4.0-1` 可在 API 26+ 设备执行，Runtime 本身不提交仓库。
- Android 前台 `NodeServerService` 启动 `server-launcher.js`；launcher 再 fork `server-app.js`，保持现有双进程模型。
- Service 为 Node 设置私有 `HOME`、`LD_LIBRARY_PATH` 和 `OPENSSL_CONF=/dev/null`，避免 Termux 默认 OpenSSL 配置路径不可访问导致进程退出。
- APK 只启用 HTTP/HTTPS、WebSocket、AASC 主动连接和媒体库能力；任务 runner、Puppeteer、Codex/Claude 外部 Agent、ASR/外部 TTS 服务均不在 APK 节点启动。
- Android 9/API 28 的共享存储媒体库通过 READ/WRITE_EXTERNAL_STORAGE 运行时授权访问 `/storage/emulated/0/`；Android 10+ 不申请 MANAGE_EXTERNAL_STORAGE。
- ASR 隔离进程、Wine、Puppeteer、外部 CLI 和桌面 TUI 等额外子进程能力关闭。
- 主服务器地址默认 `https://192.168.1.39:8081`，保留手动修改；该地址同时用于子服务器主动连接和 WebView `/display`。

## 子服务器就绪后的正常媒体流程重播

APK 子服务器可能在 WebView 显示端恢复播放之后才完成 AASC 注册，或因局域网地址变化而更新注册信息。主服务器以 AASC 注册/心跳为就绪信号，使用当前保存的显示端播放状态，按正常播放流程重新发送原有 `url`、`base64` 或 `playlistStart` 消息。

- 播放状态带有来源节点标识；主服务器只重播当前属于该 APK 子服务器的媒体。
- 子服务器 IP 变化时，主服务器按最新 `node.url` 重写直连地址，并保留主服务器代理地址。
- 其他显示端如果正在播放同一子服务器媒体，也由主服务器统一重播。
- 显示端继续只连接主服务器，不识别子服务器就绪事件，不增加重播协议或节点切换逻辑。

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

- Android：`MainActivity.kt`、`SharedStorageAccess.kt`、`NodeServerService.kt`、`NodeRuntimeInstaller.kt`、`NodeServerConfig.kt`、Manifest 和 Gradle assets 配置。
- Node.js：现有 `server-launcher.js`、`server-app.js`、配置模块和 AASC NodeConnector。
- 构建：新增 Android Node Runtime/服务器运行包准备脚本和校验测试。
- 文档：`docs/spec/android-embedded-node-server.md`、本设计文档和对应 task 文档。

## 构建输入边界

`npm run prepare:android-node` 要求显式传入：

- `AASC_ANDROID_NODE_RUNTIME_DIR`：包含 `node` 和 arm64 动态库的目录；每个动态库必须是实体文件，不能是软链接。
- `AASC_ANDROID_NODE_PACKAGE_DIR`：只包含 `src/`、`package.json`、`package-lock.json` 和 Android 可用的生产 `node_modules`。
- `AASC_ANDROID_NODE_CERT_DIR`：可选，只复制 `cert.pem`、`key.pem`。

生成的 manifest 会记录每个 assets 文件的大小和 SHA-256。APK 私有目录只覆盖运行时代码、依赖和证书，保留用户配置、媒体、临时文件和日志。
