# Android Termux 服务器节点设计

## 功能状态

当前已完成一次 Termux 试运行验证，目标设备为 Android 9、arm64、Termux 0.118.3。AASC 服务以独立 Termux 服务运行，暂不包含 ASR 原生模块和 TTS Wine 服务。

## 目标

将现有 Node.js 服务器以 Termux 节点方式部署到 Android 设备，使每台 Android 设备都能独立提供 HTTP、HTTPS、WebSocket、媒体管理和显示端连接能力，并为后续主服务器统一管理多个 Android 节点保留入口。

## 架构

```text
Android 设备
└── Termux
    ├── Node.js Runtime
    ├── AASC Server
    ├── runit/aasc-server 服务监督
    ├── AASC HTTPS :8081（当前端口）
    └── Codex CLI（独立开发工具）
```

试运行阶段保留现有服务器代码，使用独立目录 `~/aasc-server-test`。初始试运行曾使用 18081 端口，因设备原有 code-server 占用 8081；本次已停止并禁用 code-server 自动启动，AASC 已切换到 8081，18081 已释放。正式部署时再把目录、端口和节点身份改为可配置项。

## 运行边界

### 已验证

- Express HTTPS 服务启动
- 静态控制端 `/upload` 返回 200
- 静态显示端 `/display` 返回 200
- `/api/status` 返回服务状态
- 局域网通过 `https://192.168.1.6:8081` 访问
- runit 服务监督可以在无 SSH 前台会话时保持进程运行
- code-server 已停止，runit `down` 标记已持久化，自动启动已禁用

### 暂不支持或待处理

- `sherpa-onnx-node` 未安装，服务端 ASR 不可用
- `tts-wine` 任务依赖 Linux/Wine，Android 节点启动时失败并记录日志
- Puppeteer 浏览器未下载，相关任务不可用
- Android 电池优化、Termux:Boot 和设备重启后的自动拉起尚未验收
- 主服务器节点注册与心跳已接入主服务器；Termux 代码下发、双进程热更新和失败回滚已完成真实设备验收。当前正在将节点注册从 HTTP 主动登记迁移为子服务器主动 WebSocket 连接，媒体同步、权限认证和负载均衡仍未启用

## 后续演进

1. 增加 `android-node` 运行配置，明确关闭 ASR、TTS Wine、Puppeteer 等不可用能力。
2. 增加节点 ID、主服务器地址、连接角色和 WebSocket 注册/心跳协议。
3. 将现有 `SubServerManager` 的主服务器主动访问路径迁移为 AASC 节点连接目录；旧接口保留兼容。
4. 增加媒体缓存/同步策略，避免每个节点依赖主服务器本地文件路径。
5. 使用 Termux:Boot 或定制 APK 完成设备重启后的自动恢复。

## 6. 服务器代码下发与双进程热更新

### 6.1 运行模型

Termux 节点继续使用与主服务器相同的双进程模型：

```text
runit/启动器进程
    → 启动 server-launcher.js
    → server-launcher.js fork server-app.js
    → 服务进程提供 HTTP、HTTPS、WebSocket 和 AASC 接口
```

Bootstrap 是一次性更新工具，不作为第三个常驻服务进程。更新时由 Bootstrap 直接停止现有服务，再启动原有启动器；启动器负责拉起新的服务进程。

### 6.2 代码包边界

主服务器的 `/server` 提供当前版本清单和 gzip 压缩包。代码包只包含运行所需的 `src/`、`package.json` 和 `package-lock.json`；其中 Android 工程本地目录和语音显示端本地 `node_modules` 会额外排除。不包含 `logs/`、`3rd/`、`node_modules/`、用户配置、媒体文件、任务运行数据、模型和 HTTPS 证书。

Termux 根目录继续保留：

- `config/`：节点配置和主服务器地址。
- `res/`：媒体、证书、模型和运行时数据。
- `node_modules/`：已安装依赖。
- `logs/`：运行日志。

### 6.3 更新与回滚

```text
Bootstrap update
    → 从主服务器 GET /server 获取版本、包地址、大小和 SHA-256
    → 下载到临时文件并校验大小与 SHA-256
    → 解压到 staging 目录并检查 server-app.js/package.json
    → 直接停止 aasc-server-test 服务
    → 备份当前 src、package.json、package-lock.json 到 previous 目录
    → 将 staging 的代码文件复制到节点根目录
    → 启动 aasc-server-test 服务
    → 检查 /api/status、/upload、/display 和 /api/aasc/servers
    → 成功则保留 previous；失败则恢复 previous 并重启旧代码
```

更新仅覆盖代码白名单，`src/` 采用合并复制以保留未随包发布的本地目录；服务停止期间不触碰配置、媒体、证书、依赖和日志；任一校验或启动检查失败都不得删除旧版本。

### 6.4 主动连接迁移

正式 Termux 子服务器启动后，服务进程读取 `server.role=subserver` 和 `aasc.mainServerUrl`，主动连接主服务器的 WebSocket `/server`。节点注册、心跳、远程索引请求、服务节点任务和热更新命令通过该连接处理；主服务器不再通过子服务器 `advertisedUrl` 主动健康检查或下发控制请求。`advertisedUrl` 仅供显示端、网页和媒体访问。

HTTP `/server` 和 `/server/package` 继续保留，收到 `server.update` 命令后由子服务器主动拉取并复用 Bootstrap。Bootstrap 仍只负责一次性更新，服务进程重启后重新建立 WebSocket，保持启动器进程和服务进程双进程模型。

### 6.5 安全边界

当前 `/server` 暂不增加认证，仍属于局域网内部测试接口。下载包必须经过大小和 SHA-256 校验，解压目标固定在 staging 目录，拒绝路径穿越；权限认证在 AASC 后续阶段实现。
