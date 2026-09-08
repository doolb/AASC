# APK 内置 Node.js 子服务器设计

## 目标

将现有 `apk-display` 扩展为“显示端 + AASC Node.js 子服务器”组合 APK。APK 启动后由 Android Service 启动内置 Node.js Runtime，Node.js 以子服务器角色主动连接主服务器 `/server`；WebView 显示端仍然连接主服务器 `/display`，不切换到本机地址。

## 已确认范围

- 首版只支持当前 Android 工程的 `arm64-v8a` 和 Android 8/API 26+。
- Node.js 服务保持 `server-launcher.js` → `server-app.js` 的双进程模型。
- Android Service 负责启动、停止、重启和前台保活；`server-launcher.js` 负责服务子进程崩溃重启。
- 子服务器默认监听局域网地址，提供媒体库、文件访问、HTTP/HTTPS、WebSocket 和 AASC 节点接口。
- WebView 始终加载主服务器地址的 `/display`；主服务器地址默认 `https://192.168.1.39:8081`，保留手动输入和持久化配置。
- 子服务器通过 `aasc.role=subserver`、`aasc.mainServerUrl`、节点 ID 和可访问地址完成主动注册。
- 需要额外运行时子进程的 ASR 隔离、TTS Wine、Puppeteer、外部 CLI 和类似能力在 APK 节点禁用，并在能力上报中标记不可用。
- `server-launcher.js` 启动 `server-app.js` 是服务基础进程，不属于被禁用的可选能力子进程。
- 当前阶段不增加权限认证、自动发现或自动更新策略；主服务器已有的手动更新协议保留。

## 方案选择

采用“APK 私有目录中的 Node.js Android 可执行文件 + Android 前台 Service”的方案，而不是重写服务器或依赖 Termux：

1. 构建阶段准备固定版本、固定 ABI 的 Node.js Runtime 和服务器运行包，作为 APK assets 输入。
2. 首次启动将不可变 assets 解压到 `filesDir/aasc-server/`，运行时只读代码包，配置、媒体和日志写入应用私有目录。
3. `NodeServerService` 通过 `ProcessBuilder` 启动 Node.js 可执行文件，执行 `server-launcher.js --no-tui`；标准输出和错误输出写入 Android 服务日志。
4. Service 退出或被系统回收时按退避策略恢复；用户停止服务时同时终止 launcher 和 server-app，避免残留孤儿进程。
5. Node.js 服务器使用已有 AASC 节点连接器主动连接主服务器，APK 不额外实现一套节点协议。

## 组件与边界

### Android 层

- `MainActivity`：读取主服务器地址，启动/停止 `NodeServerService`，然后加载主服务器 `/display`。
- `NodeServerService`：维护 Node.js launcher 进程、前台通知、日志管道和生命周期状态。
- `NodeRuntimeInstaller`：校验 assets 清单，安全解压 runtime/server 包到私有目录，使用版本标记避免每次启动重复复制。
- `NodeServerConfig`：将 APK 设置映射为 `config/config.json`，写入 `role=subserver`、主服务器地址、节点名和节点 ID。
- `ServerOrigin`：继续只处理 WebView 的主服务器 URL，不把本机子服务器 URL 传给显示页面。

### Node.js 层

- 复用 `src/apps/server/boot/server-launcher.js` 和 `server-app.js`。
- 通过工作目录让现有相对路径继续生效：`config/`、`res/`、`src/`、`node_modules/` 和 `logs/` 位于同一运行根目录。
- Android 节点启动前写入能力配置，关闭依赖额外进程或不可移植系统环境的模块；HTTP、WebSocket、媒体库和主动节点连接必须继续启动。
- 子服务器的 `advertisedUrl` 使用设备当前局域网地址和端口，供主服务器索引生成直连媒体 URL；主服务器不可直连时继续使用代理 URL。

## 启动与连接流程

```text
用户启动 APK
    → 读取主服务器地址，缺省为 https://192.168.1.39:8081
    → 启动 NodeServerService
    → 校验/安装 Node.js Runtime 和 AASC 服务器运行包
    → 写入本机 aasc.role=subserver 和 aasc.mainServerUrl
    → Service 启动 node server-launcher.js --no-tui
    → launcher fork server-app.js
    → server-app 启动本地 HTTP/HTTPS、媒体库和 WebSocket
    → server-app 主动连接 wss://主服务器/server 并发送 node.register
    → MainActivity 加载主服务器 /display
    → 主服务器按节点会话聚合本机媒体库和运行状态
```

## 进程生命周期

```text
Service start
    → 启动 launcher 进程
    → 读取 launcher stdout/stderr，更新通知状态
    → launcher 启动 server-app
    → server-app 正常退出：launcher 按现有规则重启
    → launcher 异常退出：Service 按退避策略重新启动 launcher
    → Service stop：先发送 SIGTERM，超时后终止 launcher 及其子进程树
    → Android 重启/Service 被回收：按系统允许的前台服务策略恢复
```

服务重启不重新创建 WebView 的主服务器地址；显示端按已有 WebSocket 重连逻辑恢复。子服务器主动连接断开时由 `AascNodeConnector` 负责退避重连，不阻塞本地媒体服务。

## 配置与数据目录

```text
filesDir/aasc-server/
├── runtime/       # Node.js 可执行文件及其运行时依赖
├── src/            # AASC 服务器代码
├── node_modules/   # APK 首版允许的纯 JS/Android 兼容依赖
├── config/         # 节点配置和运行时生成配置
├── res/
│   ├── uploads/    # 子服务器本地媒体
│   ├── certs/      # APK 节点 HTTPS 证书
│   └── temp/       # 临时文件
└── logs/           # 服务日志
```

安装包不携带用户媒体、用户配置、日志和模型。节点 ID、主服务器地址、节点名和媒体库配置必须在 APK 卸载重装之外持久化；首次启动生成的节点 ID不能因 Service 重启变化。

## 可用能力策略

APK 节点首版允许：

- Express HTTP/HTTPS、WebSocket 和静态 Web UI；
- 本地媒体库增删改、目录操作、上传和 Range 播放；
- AASC 主动注册、心跳、远程媒体索引和主服务器下发的媒体库请求；
- 不依赖额外进程的轻量服务逻辑。

APK 节点首版禁用：

- ASR 隔离子进程和 Linux/Wine ASR/TTS 服务；
- Puppeteer/浏览器子进程；
- 外部 CLI、桌面 TUI 和依赖 Linux 桌面的任务；
- 任何通过 `child_process.spawn` 启动的可选任务。

能力禁用必须在配置和 `node.register` 能力字段中一致体现；请求进入禁用能力时返回结构化“Android APK 节点不支持”错误，不得导致 HTTP/WS 主服务退出。

## 错误处理与安全边界

- Runtime 或服务器包缺失、校验失败：Service 不启动 Node 进程，通知显示明确错误和重试入口。
- Node 进程启动失败：保留退出码和最后 64KB 日志，按上限退避，避免死循环占满 CPU。
- 主服务器不可达：本机媒体库和本地服务仍启动；主动连接器按指数退避重连。
- 本地端口冲突：Service 报告端口占用，不覆盖其他应用数据。
- 服务器包只解压到 APK 私有目录并拒绝路径穿越；包清单包含版本、文件大小和 SHA-256。
- 首版不实现认证；主服务器地址和节点连接继续遵守现有内网测试边界。

## 验收标准

1. 安装 APK 后无需 Termux，能启动 Node.js launcher 和 server-app 两个进程。
2. WebView 加载的是主服务器 `/display`，不是 `127.0.0.1`。
3. 主服务器节点列表能看到 APK 子服务器，节点 ID 在重启后保持不变。
4. 主服务器控制端能聚合 APK 子服务器的媒体库，并可完成目录浏览、上传、删除和播放。
5. APK 子服务器断开主服务器时本地媒体 HTTP 服务不退出，网络恢复后自动重新注册。
6. 停止/启动/重启服务不会遗留 server-app 孤儿进程；server-app 崩溃时 launcher 能按现有策略恢复。
7. ASR 隔离、Wine、Puppeteer 和外部 CLI 不启动，节点能力和错误响应正确。
8. 通过 Gradle debug 构建和 Android 单元测试；在 Android 9 arm64 真机完成安装、启动、局域网访问、媒体库及主连接验收。

## 未纳入首版

- 多 ABI Node.js Runtime；
- 在 APK 内实现 Node.js Runtime 的在线更新；
- 权限认证、自动发现和设备重启后的强保活保证；
- 将显示端改为连接本机子服务器；
- 在 APK 内启动任何额外 AI、浏览器或桌面服务进程。
