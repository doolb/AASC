# Android offline 模型资产按需加载实现规格

状态：2026-09-16 已实现；38 项 Node 定向回归、143 项 Android JVM 测试通过，offline APK 已重建并安装到真机完成默认模型加载和 `/v1/chat/completions` 验证。

## 伪代码

```text
prepareAndroidNodeRuntime(options):
    selected = resolveSelectedModelFiles(modelRoot, modelIds)
    files = 复制 Runtime、服务器代码、证书和非 LLM 离线资源
    modelAssets = []
    bundledModels = []

    for each selected LLM file:
        output = display-models/<modelId>/<filename>
        复制到 APK assets
        记录 { path, size, sha256 } 到 modelAssets
        记录 { name, assetPath, size, sha256 } 到 bundledModels[modelId].files

    复制 llm/manifest.json 到 server/res/models/llm/manifest.json
    写入 offline-model-manifest.json:
        { version, models: [{ modelId, revision, assetPrefix, files }] }
    runtime-manifest.json.files 只包含安装器要解包的文件
    runtime-manifest.json.modelAssets = modelAssets
    contentVersion 同时指纹 files、modelAssets 和 Node native library
```

```text
NodeRuntimeManifest.parse:
    解析并校验 files
    若存在 modelAssets:
        按相同路径安全规则、大小和 SHA-256 规则校验
        禁止与 files 重复
    返回 files + modelAssets
```

```text
NodeRuntimeInstaller.ensureInstalled:
    读取 runtime-version.txt 和 runtime-mode.txt
    offline 快速复用时只校验 Node 启动文件、配置、动态库和
        offline-model-manifest.json 中存在至少一个 models 条目
    完整安装时只遍历 manifest.files
    不打开、不复制、不校验 manifest.modelAssets 的内容
    原子替换 aasc-server；旧 res/models/llm 权重不进入新目录
```

```text
LlmModelManifestService:
    offlineReadyModelIds = 读取 offline-model-manifest.json.models[].modelId
    createModelManifest(definition):
        files = 使用模型定义中的 size/sha256 生成公开清单
        ready = 本地服务器缓存完整
                或 (offline 模式且 definition.modelId 在 offlineReadyModelIds)
    resolveDownload():
        仍要求实际服务器文件存在且 hash 正确
```

```text
MnnLlmModelManager.switchModel(modelId):
    if modelId 是 offline bundled 模型:
        modelDirectory = ensureBundledModelFromAssets(modelId)
    else:
        modelDirectory = RemoteModelManager.ensureModel(... active ...)
    candidate = MnnLlmEngine.load(modelDirectory)
    加载成功后更新 selected/loaded 状态并释放旧 engine

ensureBundledModelFromAssets(modelId):
    metadata = AssetManager.open("offline-model-manifest.json")
    model = metadata.models 中匹配 modelId 的条目
    cache = files/models/llm/bundled/<modelId>
    if isBundledModelReady(cache): return cache
    创建 cache 的父目录 files/models/llm/bundled
    staging = files/models/llm/.bundled-<modelId>-<timestamp>
    按 metadata.files 从 display-models asset 复制到 staging
    校验每个文件的 size 和 SHA-256
    写入 staging/.manifest.json
    创建 files/models/llm/bundled
    原子替换 cache
    return cache
```

```text
失败回归：
    destination = files/models/llm/bundled/<modelId>
    staging = files/models/llm/.bundled-<modelId>.staging-<timestamp>
    写入 staging 前创建 bundled 父目录
    否则 staging.renameTo(destination) 会因目标父目录不存在而失败
```

## 受影响代码

- `scripts/ops/prepare-android-node-runtime.js`：分类 LLM asset、生成 `modelAssets` 和 offline 模型元数据。
- `src/apps/android-display/app/src/main/java/com/aasc/display/NodeRuntimeManifest.kt`：解析非安装模型资产条目。
- `NodeRuntimeInstaller.kt`：offline 快速复用和安装逻辑不再依赖 LLM 权重已解包。
- `MnnLlmModelManager.kt`：显示端 AssetManager 按需物化 bundled 模型。
- `llm-model-manifest-service.js`、`server-app.js`：offline 元数据 ready 语义。
- Node、Android 和 APK 集成测试及 design/spec/task/changelog 文档。

## 验证契约

- Node 打包测试确认 LLM 权重不在 `manifest.files` 或 `server/res/models`，而在 `modelAssets` 和 `display-models`。
- Node 服务测试确认 offline 元数据模型可报告 ready，缺少实际文件时下载接口仍失败。
- Android manifest 测试确认 `modelAssets` 可选、路径安全且不影响旧 manifest。
- Android 静态契约确认显示端创建 bundled 父目录，从 `AssetManager` 复制到 `files/models/llm/bundled` 后再调用 MNN。
- Gradle 单元测试、APK 构建和真机聊天回归确认 `/v1` 仍能路由到 display，且 Node Runtime 目录不含内置 LLM 权重。
