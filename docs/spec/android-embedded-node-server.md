# Android APK 内置 Node.js 子服务器实现文档

## APK 启动伪代码

```text
MainActivity 启动
    → 读取持久化 mainServerUrl
    → 没有配置时使用 https://192.168.1.39:8081
    → 启动 NodeServerService(mainServerUrl)
    → WebView 加载 mainServerUrl/display
```

## Runtime 安装伪代码

```text
NodeRuntimeService.start
    → 读取 assets/runtime-manifest.json
    → 校验 runtime 和 server 包版本、大小、SHA-256
    → 当前私有目录版本一致时复用已安装目录
    → 版本不同或目录不完整时解压到 staging
    → 拒绝绝对路径和包含 .. 的条目
    → 检查 node 可执行文件和 src/apps/server/boot/server-launcher.js
    → 原子切换 staging 为 active
    → 保留 config、res/uploads、res/certs、logs 和用户媒体
```

```text
准备 Runtime assets
    → 要求 runtime/arm64-v8a/node 和服务器入口存在
    → 忽略 npm 生成的 node_modules/.bin 软链接
    → 拒绝其他软链接、绝对路径和路径穿越
    → 为 node、动态库、服务器包和证书生成大小/SHA-256 清单
    → Gradle 只打包生成的 arm64 assets
```

## 子服务器配置伪代码

```text
读取 APK 配置
    → 写入 config/config.json
    → aasc.role = subserver
    → aasc.mainServerUrl = 用户输入的主服务器地址
    → aasc.nodeId = 已保存 ID 或首次生成的稳定 ID
    → aasc.nodeName = APK 节点名称
    → aasc.advertisedUrl = 当前局域网地址 + 服务端口
    → 禁用 ASR 隔离、Wine、Puppeteer、外部 CLI 和桌面 TUI 能力
```

## 双进程启动伪代码

```text
NodeServerService.start
    → 设置工作目录为私有 AASC 根目录
    → 设置 HOME 和配置目录为 APK 私有目录
    → 设置 LD_LIBRARY_PATH 为私有 Runtime 动态库目录
    → 设置 OPENSSL_CONF=/dev/null，避免访问 Termux 私有配置路径
    → 设置 AASC_SERVER_VERSION 和 Android 能力环境变量
    → ProcessBuilder 启动 node runtime/server-launcher.js --no-tui
    → launcher fork server-app.js
    → Service 读取 launcher 输出并更新前台通知
    → server-app 监听本地服务并主动连接主服务器 /server
```

```text
launcher 子进程退出
    → server-app 正常重启由 launcher 按现有规则处理
    → launcher 异常退出由 NodeServerService 退避重启
    → 用户停止服务时取消重启任务并终止进程树
    → destroy() 等待最多 2 秒，仍存活时 destroyForcibly()
```

## AASC 主动连接伪代码

```text
server-app 启动且本地媒体库初始化完成
    → AASC_ROLE = subserver
    → AascNodeConnector 连接 wss://mainServerUrl/server
    → 发送 node.register，能力只包含 Android 节点实际可用能力
    → 每 30 秒发送 node.heartbeat
    → 收到 media.index.local 或媒体库管理请求时访问本地媒体库
    → 收到禁用能力请求时返回 androidCapabilityUnavailable
    → 断线按 1 秒起步、30 秒封顶退避重连
```

## 显示端连接伪代码

```text
WebView 页面地址
    → 永远取 mainServerUrl + /display
    → 不使用 127.0.0.1、localhost 或子服务器 advertisedUrl
    → 主服务器 WebSocket 断线时沿用现有页面重连
```

## 禁用子进程能力伪代码

```text
如果运行环境是 APK Android 节点:
    → 不创建 ASR 隔离 worker/child_process
    → 不启动 Wine、Puppeteer、浏览器和外部 CLI
    → 不启动 TUI
    → 不构造 Node/Puppeteer 任务 runner
    → 不恢复或启动 Claude/Codex 等外部 Agent 子进程
    → Codex Runtime 请求直接返回 externalCli 不可用错误
    → 保留 HTTP、HTTPS、WebSocket、媒体库和 AASC 节点连接
    → 能力上报移除不可用能力
    → 请求命中不可用能力时返回结构化错误
```

## 失败处理伪代码

```text
Runtime 校验失败
    → 不启动 Node
    → 前台通知显示安装失败和校验错误

Node 启动失败
    → 记录退出码和最近日志
    → 按上限退避重试
    → 超过上限后等待用户手动重试

主服务器连接失败
    → 不停止本地媒体服务
    → AascNodeConnector 按退避策略重连

本地端口冲突
    → Service 报告端口占用
    → 不覆盖其他应用数据
```
