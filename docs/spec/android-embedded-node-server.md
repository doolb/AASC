# Android APK 内置 Node.js 子服务器实现文档

## APK 启动伪代码

```text
MainActivity 启动
    → 读取持久化 mainServerUrl
    → 没有配置时使用 https://192.168.1.39:8081
    → Android 6.0(API 23)至 Android 9(API 28)检查 READ/WRITE_EXTERNAL_STORAGE
    → API 23..28 缺少读写权限时弹出运行时授权框
    → Android 10(API 29)及以上检查持久化 SAF tree URI
    → 缺少 URI 时启动 ACTION_OPEN_DOCUMENT_TREE，成功后持久化 READ|WRITE 授权
    → 选择取消或 URI 失效时提示“SAF 媒体库不可用”并继续正常启动
    → 启动 NodeServerService(mainServerUrl)
    → offline 模式显示原生启动状态遮罩
    → WebView 加载 mainServerUrl/display；本地服务未就绪时保持遮罩并继续重试
    → display 页面成功加载后隐藏遮罩
```

## offline 首次解包提示伪代码

```text
NodeServerService.startNodeProcess
    → 广播 node.status=preparing，提示正在准备离线服务
    → ensureInstalled() 解包并校验 Runtime、服务器运行包和离线模型
    → 解包期间广播 node.status=installing，提示首次启动可能需要几分钟
    → ProcessBuilder 启动 Node launcher
    → 广播 node.status=starting，提示本地服务已启动并等待 display
    → Node 启动失败时广播 node.status=failed 和错误详情

MainActivity offline 启动
    → 显示 startupStatusPanel、ProgressBar 和状态文案
    → 接收 node.status 广播并更新文案
    → WebView 主页面连接失败时保持遮罩，按间隔继续加载 /display
    → WebView 主页面成功完成且页面 URL 属于本地 display 时隐藏 startupStatusPanel
    → 重试次数达到上限或收到 failed 状态时显示失败文案和 retry 按钮
    → retry 按钮重新启动/唤醒 NodeServerService 并重置页面重试计数
```

> 验收约束：WebView 的 `onPageFinished` 也可能在连接错误页之后触发，错误页回调不得隐藏 startupStatusPanel。

## 共享存储访问伪代码

```text
SharedStorageAccess.requiredPermissions(sdkInt):
    如果 23 <= sdkInt <= 28:
        返回 [READ_EXTERNAL_STORAGE, WRITE_EXTERNAL_STORAGE]
    否则:
        返回 []

SharedStorageAccess.requiresTreeAccess(sdkInt):
    返回 sdkInt >= 29

MainActivity 启动存储权限流程:
    → 如果 API >= 29 且没有持久化 tree URI：启动 ACTION_OPEN_DOCUMENT_TREE
    → 如果 API <= 28：计算 requiredPermissions 并过滤缺失权限
    → 有缺失权限时 requestPermissions(缺失权限, REQ_STORAGE_PERMISSION)
    → 权限或 SAF 选择未完成时提示媒体库不可用并继续正常启动
    → 不因权限拒绝阻塞 WebView 显示端；仅共享存储媒体库操作不可用

媒体库配置:
    → API 23..28 的 LocalProvider(path) 接受 /storage/emulated/0/ 或其子目录
    → NodeServerService 读取 getExternalFilesDir(null)，通过 AASC_ANDROID_MEDIA_HOME 传入绝对路径
    → LocalProvider(path) 将 `~`、`~/`、`~/子路径` 映射到 AASC_ANDROID_MEDIA_HOME
    → Android APK 内部 HOME、配置、Runtime 和日志仍位于 files/aasc-server 私有目录
    → 首次 connect 时将工作目录下历史字面 `~` 目录的未冲突内容迁移到外部媒体根
    → rename 跨文件系统失败时改用复制后删除；目标同名文件不覆盖
    → API 29+ 的 AndroidSafProvider 根路径固定为 /，不保存 content:// URI 到 Node 媒体路径字段
    → NodeServerService 通过环境变量传递 SAF 网关 URL 和随机 token
    → AndroidSafProvider 仅发送相对路径，原生 ContentResolver 负责解析 tree URI
    → Node 与原生网关继续执行路径 traversal 校验
    → 只读媒体库仍禁止写操作

AndroidSafProvider 操作:
    → list(/相对目录) -> 原生网关返回当前目录子项及元数据
    → getFile(/相对文件) -> HEAD/元数据请求返回 size 和 modifiedTime
    → getFileStream(/相对文件, range) -> 原生网关流式返回 200/206
    → upload/delete/createFolder/deleteFolder -> 仅在 readonly=false 时转发到原生网关

原生 SAF 网关:
    → 仅监听 127.0.0.1 随机端口并要求 Authorization: Bearer <随机 token>
    → 将 / 映射为持久化 tree URI，将每个后续 path segment 映射为子 DocumentFile
    → list 时只列当前目录，不递归扫描
    → read/write/delete/folder 操作都通过 ContentResolver/DocumentFile 执行
    → 对 Range 读取先校验总长度，再跳过起始偏移并按区间流式复制
    → URI 授权丢失或系统拒绝时返回非 2xx 和中文错误信息
```

## Runtime 安装伪代码

```text
NodeRuntimeService.start
    → 读取 assets/runtime-manifest.json
    → 读取 manifest.verifyRuntime（缺省 true）
    → 读取私有目录 .runtime-version
    → 版本一致且关键启动文件存在、大小正确时走快速复用路径
    → 快速复用路径不遍历和计算全部 Runtime 文件的 SHA-256
    → 版本不同或关键文件缺失时解压到 staging
    → verifyRuntime=true 时校验全部文件大小和 SHA-256
    → verifyRuntime=false 时只校验文件存在且为普通文件，跳过 SHA-256 内容校验
    → 拒绝绝对路径和包含 .. 的条目
    → 检查 node 可执行文件和 src/apps/server/boot/server-launcher.js
    → 安装成功后写入 Runtime 版本标记
    → latest marker 指向空实例目录时创建该目录后再恢复 results/latest
    → 保留 config、res/uploads、res/certs、logs 和用户媒体
```

```text
Android Node Runtime 版本生成
    → 收集已复制的 Runtime、server、node_modules 和证书文件元数据
    → 同时收集 APK 内置 Node 原生库的大小和 SHA-256
    → 未显式提供版本时，对上述稳定排序后的元数据计算内容指纹
    → 将内容指纹写入 runtime-manifest.version
    → APK 更新但 Node.js 版本不变时，仅因 server 包内容变化触发一次安装
```

```text
准备 Runtime assets
    → 要求 runtime/arm64-v8a/node 和服务器入口存在
    → 要求 runtime/arm64-v8a/lib 包含 Node 所需的实体动态库（libz、c-ares、SQLite、FFI、OpenSSL 和 ICU）
    → 动态库缺失时在构建阶段失败，不生成不可启动的 APK
    → 将 node 复制为 jniLibs/arm64-v8a/libaasc_node.so，并设置可执行权限
    → 在 Gradle packaging.jniLibs 中声明 useLegacyPackaging=true，保证旧版 Android 设备将该库解压到 nativeLibraryDir
    → Android assets 不再携带 runtime/arm64-v8a/node，避免从应用私有目录执行时丢失权限
    → 忽略 npm 生成的 node_modules/.bin 软链接和下划线/隐藏目录
    → 保留下划线命名的依赖文件（例如 readable-stream/lib/_stream_readable.js）
    → 拒绝其他软链接、绝对路径和路径穿越
    → 为 node、动态库、服务器包和证书生成大小/SHA-256 清单
    → Gradle 只打包生成的 arm64 assets
```

```text
准备 offline APK 服务器运行包
    → 生成当前源码服务器包
    → 解包到 AASC_ANDROID_NODE_PACKAGE_DIR
    → 合并 Android 可用的生产 node_modules
    → 校验 Chat2API 合并入口源码和控制端 chat2api.js 已进入输入目录
    → prepare-android-node 将源码、依赖、配置资源和离线模型写入 APK assets/server
    → 安装器校验运行包 manifest 后再替换应用私有目录中的版本
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

```text
offline 语音默认配置
    → asr.serverEnabled = false
    → asr.device = display
    → tts.serverEnabled = false
    → tts.device = display
    → display 页面连接 WebSocket 后默认开启语音监听
    → 本地 server-app 收到 ASR/TTS 请求时只路由到在线显示端原生能力
    → 显示端能力不可用时返回结构化错误，不启动服务器 ASR/TTS 作为回退
```

```text
offline 配置种子:
    → 构建脚本读取当前 config/config.json
    → 只保留 { llm, chat }，写入 assets/offline-config.json 并加入 runtime manifest
    → NodeRuntimeInstaller 将其复制到 staging
    → 如果 files/aasc-server/config/config.json 已存在：保留用户配置
    → 否则将 staging/offline-config.json 写为 config/config.json

offline 原生语音模型:
    → NativeBridge(offlineMode=true) 将 ASR 目录设为 files/aasc-server/res/models/sensevoice
    → NativeBridge(offlineMode=true) 将 TTS 目录设为 files/aasc-server/res/models/tts
    → ASR 校验内置 model/tokens/hash 后直接加载
    → TTS 校验内置 manifest.json 和全部文件 hash 后直接加载
    → 不请求在线模型接口，不创建 files/models/sensevoice 或 files/models/tts 副本
    → online 模式继续使用 files/models 下的下载缓存
```

```text
offline 原生 LLM 模型:
    → Node Runtime 只解包 res/models/llm/manifest.json 和 offline-model-manifest.json 元数据
    → APK assets/display-models/<modelId>/ 保留 LLM 权重，不复制到 aasc-server
    → 显示端首次加载时校验并物化到 files/models/llm/bundled/<modelId>
    → /v1 模型清单按 offline 元数据声明模型 ready，推理请求仍路由到显示端
    → MNN 按当前运行时策略处理 bundled 目录下的 mmap 缓存；不在打包或 Runtime 安装阶段预生成
```

```text
offline server-app 任务启动:
    → restoreAutoStartServices()
    → AASC_OFFLINE_MODE == "1" 时 ensureBuiltinServiceInstance("llm-server")
    → 已存在 running 服务实例则复用
    → 没有 running 实例则通过普通 submit/runInstance 创建并持久化实例
    → llm-server 在当前 Node 进程注册四个 /v1 路由
    → 未注册时 /v1 路由返回结构化 503
    → target=server 且 mode=service 不创建任务 Runner；需要子进程的非服务端任务继续拒绝
```

## 双进程启动伪代码

```text
NodeServerService.start
    → 设置工作目录为私有 AASC 根目录
    → 设置 HOME 和配置目录为 APK 私有目录
    → 读取 getExternalFilesDir(null) 并设置 AASC_ANDROID_MEDIA_HOME；目录不可用时省略该变量
    → 启动 SafMediaServer；将回环 URL 和随机 token 写入 Node 环境
    → 设置 LD_LIBRARY_PATH 为私有 Runtime 动态库目录
    → 设置 OPENSSL_CONF=/dev/null，避免访问 Termux 私有配置路径
    → 若 APK 私有目录存在 res/certs/cert.pem，则设置 NODE_EXTRA_CA_CERTS 为该路径；仅让该 Node 子进程信任 APK 内置主服务器证书，保留其他 HTTPS 默认校验
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
    → Android 9/API 28 的 path 位于 /storage/emulated/0/ 时使用系统已授予的共享存储权限读写
    → Android APK 的 path 为 `~/` 时访问 AASC_ANDROID_MEDIA_HOME；Android 10/API 29 及以上的 SAF 媒体库根仍为虚拟 /
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

```text
NodeServerService 快速恢复
    → Service 启动时记录恢复开始时间
    → NodeRuntimeInstaller 先执行版本标记和关键文件轻量检查
    → 检查通过后立即启动 launcher，不等待全量 Runtime 校验
    → launcher 输出启动时间和 AASC connected 时间
    → 将启动耗时、Runtime 路径和失败原因写入 AASC-Node 日志
```

```text
APK 子服务器媒体就绪后的主服务器处理
    → APK AascNodeConnector 注册时上报当前可访问 url
    → 运行期间每次 heartbeat 重新计算并上报当前可访问 url
    → 主服务器收到 node.register 后读取所有显示端播放状态
    → 主服务器收到 node.heartbeat 且 url 变化后读取所有显示端播放状态
    → 仅选择来源为当前 nodeId 的 currentMedia/currentPlaylist
    → 按最新 node.url 重写直连地址，保留主服务器代理地址
    → 单媒体沿用 url/base64，播放列表沿用 playlistStart
    → 显示端继续按现有正常播放处理，不处理节点就绪或 IP 变化消息
```

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

## 2026-09-15 offline 本机 LLM 聊天传输伪代码

```text
server-app 创建聊天服务:
  localLlmBaseUrl = `${useHttps ? "https" : "http"}://127.0.0.1:${PORT}/v1`
  chat.init(chatConfig, {
    offlineNodeMode: OFFLINE_NODE_MODE,
    localLlmBaseUrl,
    localLlmHostnames: [getLocalIP()]
  })

normalizeChatTransport(profile, runtimeOptions):
  configuredBaseUrl = 去除 /chat/completions 的 profile.apiUrl
  if runtimeOptions.offlineNodeMode 且 configured 地址的主机名属于
     127.0.0.1、localhost、当前设备地址，且端口等于内置 LLM 端口:
    baseUrl = runtimeOptions.localLlmBaseUrl
    requestUrl = `${baseUrl}/chat/completions`
    requestOptions = { rejectUnauthorized: false }
    return protocol、baseUrl、requestUrl、requestOptions、local=true
  return 原有 profile 地址和默认 HTTPS 校验
```

```text
offline 本机 LLM 请求:
  Responses:
    使用归一化后的 baseUrl + /responses
    仅对内置本机目标传入 rejectUnauthorized=false
  Chat Completions:
    使用归一化后的 requestUrl
    仅对内置本机目标传入 rejectUnauthorized=false
  外部模型地址:
    不改写 URL，不关闭证书校验
  连接错误:
    通过 chatStream.onError 回传 chatResponse(success=false)
    不让控制端无限等待
```

## 2026-09-15 聊天 WebSocket 统一入口伪代码

```text
WSViewBindServer 初始化:
  注册控制端 chatMessage handler
  handler 调用 handleControlMessageFallback(data, ws)

handleControlMessageFallback(data, ws):
  if data.type == "chatMessage":
    await handleChatMessageRequest(data, { displayId: data.displayId, ws })
    return

显示端旧 WebSocket 入口:
  if data.type == "chatMessage":
    await handleChatMessageRequest(data, { displayId: 当前显示端 ID, ws })

handleChatMessageRequest:
  if assistantType == "agent" 或兼容 mode == "role":
    执行 Agent 聊天并回传 chatChunk/chatResponse
  else:
    执行普通 LLM handleChatMessage
    通过 sendToControl 回传 chatChunk/chatResponse
  发生异常:
    回传带 requestId 的 chatResponse(success=false)
```
