# Android APK 内置 Node.js 子服务器实现文档

## APK 启动伪代码

```text
MainActivity 启动
    → 读取持久化 mainServerUrl
    → 没有配置时使用 https://192.168.1.39:8081
    → Android 6.0(API 23)至 Android 9(API 28)检查共享存储读写权限
    → 缺少权限时弹出系统授权框；回调完成后继续启动流程
    → Android 10(API 29)及以上不申请 MANAGE_EXTERNAL_STORAGE
    → 启动 NodeServerService(mainServerUrl)
    → WebView 加载 mainServerUrl/display
```

## 共享存储访问伪代码

```text
SharedStorageAccess.requiredPermissions(sdkInt):
    如果 23 <= sdkInt <= 28:
        返回 [READ_EXTERNAL_STORAGE, WRITE_EXTERNAL_STORAGE]
    否则:
        返回 []

MainActivity 启动存储权限流程:
    → 计算 requiredPermissions(Build.VERSION.SDK_INT)
    → 过滤当前尚未授予的权限
    → 有缺失权限时 requestPermissions(缺失权限, REQ_STORAGE_PERMISSION)
    → 收到结果后提示“共享存储未授权”或继续正常启动
    → 不因权限拒绝阻塞 WebView 显示端；仅共享存储媒体库操作不可用

媒体库配置:
    → LocalProvider(path) 接受 /storage/emulated/0/ 或其子目录作为 basePath
    → Node fs 操作由 Android 进程的共享存储权限控制
    → LocalProvider 继续执行 canonical path/path traversal 校验
    → 只读媒体库仍禁止写操作
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
    → 将 node 复制为 jniLibs/arm64-v8a/libaasc_node.so，并设置可执行权限
    → 在 Gradle packaging.jniLibs 中声明 useLegacyPackaging=true，保证旧版 Android 设备将该库解压到 nativeLibraryDir
    → Android assets 不再携带 runtime/arm64-v8a/node，避免从应用私有目录执行时丢失权限
    → 忽略 npm 生成的 node_modules/.bin 软链接和下划线/隐藏目录
    → 保留下划线命名的依赖文件（例如 readable-stream/lib/_stream_readable.js）
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
    → ProcessBuilder 启动 applicationInfo.nativeLibraryDir/libaasc_node.so server-launcher.js --no-tui
    → 若 nativeLibraryDir 中没有可执行文件，启动失败并进入重试；不回退到不可执行的 assets/runtime/arm64-v8a/node
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
    → Node WebSocket 客户端显式关闭自签名证书校验（仅 APK 节点与已配置主服务器通信）
    → 发送 node.register，能力只包含 Android 节点实际可用能力
    → 每 30 秒发送 node.heartbeat
    → 收到 media.index.local 或媒体库管理请求时访问本地媒体库
    → path 位于 /storage/emulated/0/ 时使用 Android 已授予的共享存储权限读写
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

APK WebView HTTPS/WSS 证书错误
    → APK 的 Network Security Config 只额外信任构建时绑定的主服务器公开证书
    → 证书不匹配或 SAN 不包含访问地址时取消页面/WSS 连接
    → display.html 保留 error/close 唯一定时器，证书恢复后自动重连

本地端口冲突
    → Service 报告端口占用
    → 不覆盖其他应用数据
```
