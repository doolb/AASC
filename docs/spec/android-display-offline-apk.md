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
    完成权限流程后：
        如果 offlineMode 或 serverInput 非空：connect()

connect:
    baseUrl = ServerConfig.baseUrl(input)
    start NodeServerService(mainServerUrl = baseUrl, offlineMode = offlineMode)
    显示 WebView 加载 baseUrl/display
    创建顶部控制按钮并显示
    创建控制 WebView（仍在按钮下方）但初始隐藏

toggleControl:
    如果 controlWebView 可见：隐藏并将按钮文字设为“控制端”
    否则：显示 controlWebView，加载 baseUrl/control，并将按钮文字设为“隐藏控制端”

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
