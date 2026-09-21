# 正式 Android 显示端完整离线 APK 实现规格（伪代码）

## 构建伪代码

```text
build:apk:offline:
    projectRoot = 当前仓库根目录
    runtimeDir = AASC_ANDROID_NODE_RUNTIME_DIR 或 projectRoot/3rd/android-node-runtime/arm64-v8a
    packageDir = AASC_ANDROID_NODE_PACKAGE_DIR（必填）
    certDir = AASC_ANDROID_NODE_CERT_DIR 或 projectRoot/res/certs
    modelRoot = projectRoot/res/models

    prepareAndroidNodeRuntime(
        runtimeDir,
        packageDir,
        certDir,
        includeOfflineModels = true,
        modelRoot
    )
    生成 runtime-manifest.json、runtime-version.txt、runtime-mode.txt
    生成离线模型元数据并将每个模型文件加入 server/res/models

    gradle :app:assembleDebug -PaascOffline=true
    将 app-debug.apk 复制为 app/build/outputs/apk/debug/aasc-display-offline.apk
```

```text
offlineModelFiles = 固定白名单：
    sensevoice/model.int8.onnx
    sensevoice/model.int8.onnx.sha256
    sensevoice/tokens.txt
    sensevoice/tokens.txt.sha256
    streaming-zipformer/encoder.int8.onnx
    streaming-zipformer/decoder.int8.onnx
    streaming-zipformer/joiner.int8.onnx
    streaming-zipformer/tokens.txt
    voiceprint/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx
    voiceprint/pyannote_segmentation_3_0_int8.onnx
    speech-enhancement/gtcrn_simple.onnx
    tts/manifest.json 以及 TtsModelFiles 全部文件
    rapidocr/VisionModelFiles 全部文件
    yolo11/yolo11n.onnx
    yolo11/yolo11n.classes.json
```

## Runtime 安装伪代码

```text
NodeRuntimeInstaller.ensureInstalled:
    读取 runtime-mode.txt（不存在时按 online 兼容）
    读取 runtime-version.txt
    如果版本一致且关键入口、Node 动态库存在：
        如果 mode == offline：
            读取 offline-model-manifest.json
            校验每个 res/models 文件存在且大小一致
            任一失败则进入完整安装
        否则直接复用
    读取 runtime-manifest.json
    解压 manifest 所有条目到 staging
    校验大小和 SHA-256
    替换 runtime、src、node_modules、package 文件、res/certs、res/models
    替换离线模式元数据文件
    保留 config、res/uploads、res/temp、logs
    写入版本标记
```

## Android 启动伪代码

```text
MainActivity.onCreate:
    offlineMode = resources.getBoolean(aasc_offline_mode)
    selectedUrl = chooseUrl(intentUrl, savedUrl, offlineMode)
    如果离线模式且无 intent/saved 地址：使用 https://127.0.0.1:8081
    现有共享存储权限流程完成后调用 continueStartup()
    continueStartup():
        如果已经继续过启动：返回
        如果 offlineMode 或 serverInput 非空：connect()
        申请音频焦点
        requestNextStartupPermission()

requestNextStartupPermission:
    依次检查 RECORD_AUDIO、CAMERA、Android 13+ POST_NOTIFICATIONS
    找到第一个尚未授权的权限：
        requestPermissions(该权限)
        等待 onRequestPermissionsResult 后再次调用 requestNextStartupPermission
        不因用户拒绝当前权限而中断后续检查
        返回
    如果本轮音频或摄像头权限已获准：
        webView.reload()
    否则不重载 WebView

onRequestPermissionsResult:
    REQ_STORAGE_PERMISSION -> 延续现有存储提示与 continueStartup()
    REQ_AUDIO_PERMISSION -> 记录是否获准；requestNextStartupPermission()
    REQ_CAMERA_PERMISSION -> 记录是否获准；requestNextStartupPermission()
    REQ_NOTIFICATION_PERMISSION -> requestNextStartupPermission()

connect:
    baseUrl = ServerConfig.baseUrl(input)
    start NodeServerService(mainServerUrl = baseUrl, offlineMode = offlineMode)
    displayId = offlineMode ? "offline-display" : null
    displayUrl = ServerConfig.pageUrl(baseUrl, displayId)
    创建显示 WebView(context, offlineMode) 并加载 displayUrl
    在 webContainer 左上角（top|start）创建控制按钮并显示
    创建控制 WebView(context, offlineMode)（仍在按钮下方）但初始隐藏

MainActivity.onPageStarted(displayView):
    如果 offlineMode：在页面脚本执行前将 localStorage.displayId 预置为 "offline-display"
    兼容已安装 full APK 尚未通过服务 code-only 热更更新 display.html 的情况

WebViewScalePolicy.deviceClass(smallestScreenWidthDp):
    如果 smallestScreenWidthDp > 0 且 smallestScreenWidthDp < 600：返回 PHONE
    返回 COMPUTER

WebViewScalePolicy.scaleFactor(offlineMode, widthPixels, heightPixels, densityDpi, deviceClass):
    如果 offlineMode 为 false：返回 1.0
    如果 widthPixels <= 0 或 heightPixels <= 0 或 densityDpi <= 0：返回 1.0
    longEdgePixels = max(widthPixels, heightPixels)
    resolutionRatio = longEdgePixels / 1280
    densityRatio = densityDpi / 320
    deviceCoefficient = deviceClass == PHONE ? 1.108705 : 1.0
    rawScaleFactor = resolutionRatio × densityRatio × deviceCoefficient
    返回 clamp(rawScaleFactor, 1.0, 3.0)

WebViewScalePolicy.initialScalePercent(offlineMode, widthPixels, heightPixels, densityDpi, deviceClass):
    scaleFactor = scaleFactor(offlineMode, widthPixels, heightPixels, densityDpi, deviceClass)
    返回 round(scaleFactor × 100)

DisplayWebView.init(context, offlineMode):
    初始化现有 WebSettings
    metrics = context.resources.displayMetrics
    deviceClass = WebViewScalePolicy.deviceClass(context.resources.configuration.smallestScreenWidthDp)
    scale = WebViewScalePolicy.initialScalePercent(
        offlineMode, metrics.widthPixels, metrics.heightPixels, metrics.densityDpi, deviceClass
    )
    setInitialScale(scale)

DisplayWebView.initControlPageZoomPolicy(disableInputAutoZoom):
    如果 disableInputAutoZoom == false：不注入控制端专用 viewport
    否则：页面完成加载后查找 meta[name="viewport"]
        如果不存在：创建 viewport meta 并加入 head
        将 content 规范化为 width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no
    不修改显示 WebView、普通 APK 或服务端 upload.html 源文件

实现状态（2026-09-18）：
    DisplayWebView 增加 disableInputAutoZoom 参数，MainActivity 仅为 Offline 控制 WebView 传入 true
    onPageFinished 调用 applyInputAutoZoomPolicy()
    Offline 静态回归 26/26 通过，Android :app:testDebugUnitTest BUILD SUCCESSFUL

发布状态（2026-09-18）：
    min v11（versionCode 11、versionName 0.2.9-offline-min）已发布到 LAN/WAN
    APK 大小 89235646 bytes，SHA-256 为 0b3ab8871ca17e32fa1dc5db767ef8b31049a973d8d678faa471e1ad4ac396da
    两站点 HTTP 200、Content-Length、远端 hash、签名清单和 APK ZIP 完整性校验通过

toggleControl:
    如果 controlWebView 可见：隐藏并将按钮文字设为“控制端”
    否则：显示 controlWebView，加载 baseUrl/control，并将按钮文字设为“隐藏控制端”

DisplayWebView 页面 ID:
    configuredId = 从当前 /display URL 的 displayId 查询参数读取
    如果 configuredId 非空且符合显示端 ID 格式：
        localStorage.displayId = configuredId
        WebSocket 连接使用 configuredId
    否则：沿用原有 localStorage 持久化 ID；不存在时生成 display-* 随机 ID

OfflineDisplayInfo:
    如果 offlineMode == false：隐藏诊断浮层
    metrics = 当前 display Context.resources.displayMetrics
    scale = WebViewScalePolicy.initialScalePercent(
        true, metrics.widthPixels, metrics.heightPixels, metrics.densityDpi
    )
    将浮层文字设置为“分辨率 {width}×{height} | DPI {densityDpi} | 缩放 {scale}%”
    将浮层放在 webContainer 右下角，保持非交互、低于启动遮罩和更新卡片

MainActivity.onConfigurationChanged:
    如果 Offline 模式：重新读取 displayMetrics 并刷新 OfflineDisplayInfo

Release 任务恢复:
    Offline APK 的 render-display 任务结果 target/displayId = "offline-display"
    显示端 WebSocket 连接后以 displayId 查找并恢复该任务

NodeServerService Offline 启动迁移:
    Runtime 安装和服务更新完成后读取 res/tasks/render-display/results/index.json
    只对 taskName == "render-display" 的实例替换 displayId 为 "offline-display"
    保留实例状态、参数和其他任务；文件不存在或已是固定 ID 时跳过

onBackPressed:
    如果控制页可见：先隐藏控制页
    否则：隐藏显示 WebView 和控制按钮，恢复配置栏
```

## Node 配置伪代码

```text
NodeServerService.onStartCommand:
    offlineMode = intent.offlineMode 或保存的 offline_mode
    selectedUrl = intent.mainServerUrl 或保存地址
    NodeServerConfig.write(root, selectedUrl, nodeName, offlineMode)

NodeServerConfig.write(..., offlineMode):
    aasc.role = offlineMode ? main : subserver
    aasc.mainServerUrl = 规范化地址
    写入稳定 nodeId 和节点名称
    关闭 Android 节点不支持的 ASR/TTS 服务能力

buildNodeEnvironment:
    AASC_ANDROID_NODE = 1
    AASC_OFFLINE_MODE = offlineMode ? 1 : 0
```

## 测试伪代码

```text
Node 构建测试：
    普通 Runtime 不包含 res/models
    离线 Runtime 包含固定白名单全部模型且不包含测试 WAV/其他 YOLO/PT
    缺失白名单模型时构建失败
    runtime manifest 的离线模型路径均有大小和 SHA-256

Android JVM 测试：
    离线无地址时选择 127.0.0.1:8081
    离线配置 role == main，普通配置 role == subserver
    离线环境包含 AASC_OFFLINE_MODE=1，普通环境为 0

静态构建/UI 测试：
    Gradle 离线属性设置 applicationId、label、versionName
    新 npm 命令调用离线准备和 -PaascOffline=true
    activity_main.xml 含控制按钮且按钮位于 webContainer 顶层

验证：
    运行 Node 定向测试
    运行 Android :app:testDebugUnitTest
    在可用环境运行 npm run build:apk:offline
    检查 APK 包名、版本名、文件名和模型 assets
    Offline APK 启动页固定使用 displayId = "offline-display"；min 热更原生代码在旧 display.html 上预置同名 localStorage
```

## 已验证结果

```text
Node 离线构建/Runtime/HTTPS 定向测试：20/20 通过
Android :app:testDebugUnitTest：BUILD SUCCESSFUL
普通 :app:assembleDebug：BUILD SUCCESSFUL
离线 :app:assembleDebug -PaascOffline=true：BUILD SUCCESSFUL
离线 APK applicationId：com.aasc.display.offline
离线 APK versionName：0.1.0-offline
离线 APK 模型条目：32，451266757 bytes
离线 APK Runtime manifest：无重复路径，runtime-mode=offline
```

## Offline 发布更新日志伪代码

```text
OfflineUpdateManifest.parse:
    apkMin.releaseNotes 缺失时返回 null
    存在时校验为非空字符串且长度不超过 4096 个 Unicode 字符

MainActivity.showMinApkUpdatePrompt:
    显示版本和大小
    releaseNotes 非空时显示更新内容 TextView，最多 6 行并省略尾部
    releaseNotes 为空时隐藏更新内容 TextView

MainActivity 更新卡片自动收起:
    更新卡片显示或用户触摸卡片时启动 10 秒无触摸计时
    如果计时结束且卡片仍可见:
        隐藏完整更新卡片
        显示右侧收起入口
    如果服务更新或 min APK 下载/校验正在进行:
        不取消后台任务
        不因进度回调自动展开卡片
    用户点击右侧收起入口:
        显示完整更新卡片
        重新启动 10 秒无触摸计时
    下载失败或需要系统安装确认:
        显示完整更新卡片

MainActivity Offline 缩放诊断提示:
    Node 服务状态变为 starting:
        显示分辨率、DPI 和 WebView 缩放值
        设置 10 秒后的隐藏时间
    到达隐藏时间:
        隐藏 offlineDisplayInfo
    配置变化时:
        重新计算并刷新提示文本
        保留原隐藏截止时间
```

实现验证：更新内容使用原生 `TextView` 纯文本显示，布局限制最多 6 行并省略尾部；Node 静态回归 39/39、Android `OfflineUpdateManifestTest` 均通过。

## v10 缩放曲线验证记录（2026-09-18）

- min v10（`0.2.8-offline-min`）已正式发布到 LAN 和 WAN 直连 IP；清单签名有效，APK v2 签名有效。
- APK SHA-256：`713a0ecd53536afadf5115864e1ea28a90409717aa2bbd95655fbad155ce139e`；发布清单 SHA-256：`bc613aba55e41fced9b01d38cbfc83d0541c4eb5b8b61b4b0d6545dbd6134ac0`。
- SM-N9500 Display 2 UI 自动化读取 `分辨率 1920×1018 | DPI 160 | 缩放 100%`；固定显示端 ID `offline-display` 和服务健康接口正常。

## APK 原生 OpenAI `_vendor` 资源路径（2026-09-21）

```text
prepareAndroidNodeRuntime:
    从服务器生产依赖读取 node_modules/openai/_vendor/**
    运行包逻辑路径继续保留 node_modules/openai/_vendor/**
    写入 APK assets 时，将该目录映射为 node_modules/openai/aasc-openai-vendor/**
    runtime-manifest 使用映射后的可打包路径，避免 Gradle 的 <dir>_* 过滤规则丢失资源

NodeRuntimeInstaller:
    从 manifest 读取并校验 aasc-openai-vendor/**
    安装到 staging 后，将 node_modules/openai/aasc-openai-vendor 重命名为 node_modules/openai/_vendor
    之后才切换 staging 为正式 aasc-server 目录

验证：
    APK 中必须存在 aasc-openai-vendor/partial-json-parser/parser.mjs
    APK 中不得依赖 openai/_vendor 物理目录
    安装完成后的私有目录必须存在 openai/_vendor/partial-json-parser/parser.mjs
    Pi SDK 内嵌的 node_modules/openai/_vendor/** 使用同样的映射和恢复规则
    ChatCompletionStream.mjs 的 ../_vendor 导入必须可解析
```

实现验证：完整 Offline APK v22（`0.2.20-offline`）已生成；APK ZIP 中顶层和 Pi SDK
嵌套 OpenAI 包均包含 `aasc-openai-vendor/partial-json-parser/parser.mjs`，不存在物理
`openai/_vendor` assets 路径；`unzip -t` 全量校验通过。Node 定向测试 25/25、Android
JVM `:app:testDebugUnitTest` BUILD SUCCESSFUL。

发布验证（2026-09-21）：完整 APK 升级为 v23（`0.2.21-offline`），min APK 升级为 v32
（`0.2.30-offline-min`）；两端发布根目录仅保留当前完整/min 版本，服务清单保留 code v19
和 dependencies v4。LAN/WAN 的完整 APK 和 min APK 均返回 HTTP 200，Content-Length 与
本地构建产物一致。

## 完整 APK 基线 active release 初始化（待处理，2026-09-21）

```text
首次完整 Offline APK 安装:
    安装根目录代码与 node_modules
    读取 offline-update-client.json 作为 bundled-baseline
    不创建 updates/active-release.json

首次 code-only 更新且没有对应版本化 dependencies:
    代码安装到 updates/code/code-vN
    依赖回退到 Runtime 根目录 node_modules
    写入 active-release.json(legacyDependencies = true)
```

该行为暂时保留，后续需要决定是否在首次安装时生成版本化基线 release，或增加独立的
`bundled-baseline` 依赖来源字段，避免把完整包内置依赖显示为 `legacy-root`。
