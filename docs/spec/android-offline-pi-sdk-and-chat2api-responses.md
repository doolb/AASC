# Offline Pi SDK 与 Chat2API Responses 实现规范

本文使用伪代码描述 Offline Pi SDK 资源打包、active dependency 选择和 Chat2API Responses 回归契约，和实际 JavaScript/Kotlin 实现保持同步。

## Android Pi 运行时依赖

```text
REQUIRED_ANDROID_RUNTIME_DIRECTORIES = {
    "node_modules/openai/_vendor"
}

isAndroidAssetExcluded(relativePath, isDirectory):
    directorySegments = isDirectory ? relativePath 的全部段 : relativePath 去掉文件名
    if directorySegments 包含点号目录:
        return true
    if directorySegments 包含下划线目录，且不在 REQUIRED_ANDROID_RUNTIME_DIRECTORIES 目录树内:
        return true
    if relativePath 是 node_modules 下的 .manifest.json:
        return false
    if relativePath 是普通隐藏文件:
        return true
    return false

validateRequiredAndroidRuntimeAssets(packageRoot):
    if packageRoot/package.json 声明了 openai:
        要求 packageRoot/node_modules/openai/_vendor/partial-json-parser/parser.mjs
            是非空普通文件
        否则构建失败并报告缺失路径

copyServerRuntime(packageRoot, outputRoot):
    validateRequiredAndroidRuntimeAssets(packageRoot)
    按 isAndroidAssetExcluded 复制服务文件
    要求输出包含 server/node_modules/openai/_vendor/partial-json-parser/parser.mjs
```

```text
resolveActivePiModule(packageName, relativeEntry):
    root = AASC_NODE_MODULES_DIR 或项目 node_modules
    absolutePath = root/packageName/relativeEntry
    如果 absolutePath 是普通文件:
        返回 absolutePath 的 file URL
    否则返回裸包名作为兼容回退

loadPiRuntime():
    codingAgent = import(resolveActivePiModule("@earendil-works/pi-coding-agent", "dist/index.js"))
    readonlyTools 使用同一个 active root 加载 pi-ai、pi-ai/compat 和 pi-coding-agent
    不从 server 目录祖先的基础 node_modules 重新解析 Pi 依赖
```

## Android Runtime 资产映射

```text
常量 ANDROID_HIDDEN_MANIFEST_MARKER = "aasc-bundled-manifest.json"

isAndroidAssetExcluded(relativePath, isDirectory):
    if relativePath 的目录段包含点号目录:
        return true
    if relativePath 的目录段包含下划线目录，且不是 openai/_vendor 目录树:
        return true
    if isDirectory:
        return false
    filename = relativePath 最后一段
    if filename == ".manifest.json" 且 relativePath 位于 node_modules 下:
        return false
    return filename 以 "." 开头

mapPackagedAssetPath(relativePath, outputPrefix):
    outputPath = outputPrefix + relativePath
    if outputPrefix == "server"
        且 relativePath 位于 node_modules 下
        且 basename(relativePath) == ".manifest.json":
        return dirname(outputPath) + "/" + ANDROID_HIDDEN_MANIFEST_MARKER
    return outputPath

copyDirectoryWithManifest(sourceRoot, outputRoot, outputPrefix):
    for relativePath in listFiles(sourceRoot):
        if relativePath 被排除:
            continue
        outputPath = mapPackagedAssetPath(relativePath, outputPrefix)
        copyFileWithManifest(sourceRoot, relativePath, outputRoot, outputPath)
    return 包含 marker 路径、大小和 SHA-256 的 files
```

## Runtime 安装恢复

```text
materializeBundledPackageManifests(root):
    packageRoot = root + "/node_modules"
    for marker in packageRoot 递归文件:
        if marker.basename != ANDROID_HIDDEN_MANIFEST_MARKER:
            continue
        target = marker.parent + "/.manifest.json"
        marker.copyTo(target, overwrite=true)
        marker.delete()

installCodeFiles(root, staging, version):
    将 staging 校验通过后切换为 root
    迁移可变目录并保留用户文件
    materializeBundledPackageManifests(root)
    materializeBundledModelMarkers(root)
    materializeTaskMarkers(root)
    写入 .runtime-version

hasPiSdkManifest(root):
    piRoot = root + "/node_modules/@earendil-works/pi-coding-agent"
    if piRoot 不存在:
        return true
    return root + "/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/data/.manifest.json"
        是普通文件且大小大于 0

canReuseInstalledRuntime(root, version, mode):
    通过现有版本、启动文件、配置、Runtime 库和离线模型检查
    通过 hasPiSdkManifest(root)
    才允许快速复用
```

## Responses 服务契约

```text
createResponse(request):
    校验 model 和 input
    根据 conversation 或 previous_response_id 解析 session
    将 Responses input 转为 Chat Completions 请求
    调用 coreAdapter.forwardChatCompletion
    非流式：返回 response.id、object=response、status、output、output_text
    保存 conversation、response id 和 nativeState

streamResponse(request):
    首先发送 response.created
    将核心文本增量转换成 response.output_text.delta
    结束文本 item 后发送 response.output_text.done
    最后保存 session 并发送 response.completed

proxy POST /v1/responses:
    非流式 -> 返回 JSON response
    stream=true -> 每个事件写成 `data: JSON + 空行`
    coreAdapter 抛出 Chat2API 错误 -> 保留 statusCode、code、message 返回 JSON 错误
```

## 回归测试契约

```text
测试首轮和续聊:
    first = POST /v1/responses(input="第一轮")
    second = POST /v1/responses(previous_response_id=first.id, input="第二轮")
    断言两个 response 完成且第二轮携带 first.id

测试流式:
    stream = POST /v1/responses(stream=true)
    解析 SSE data 行
    断言事件顺序从 response.created 开始，以 response.completed 结束
    断言客户端收到完整 output_text

测试错误透传:
    coreAdapter 抛出 statusCode=503、code=no_available_account
    断言 proxy 返回 503 且 JSON 保留 code 和 message
```

## 当前实现状态

```text
已实现：node_modules Provider manifest 使用 aasc-bundled-manifest.json 打包，安装器恢复为 .manifest.json
已实现：保留 openai/_vendor/partial-json-parser/parser.mjs，并在声明 openai 依赖时执行 APK 资产预检
已实现：Pi SDK 与 readonly tools 从 AASC_NODE_MODULES_DIR 的 active dependency 根加载，避免基础 node_modules 覆盖更新依赖
已实现：Pi SDK 目录存在时，Runtime 快速复用要求 providers/data/.manifest.json 为非空普通文件
已实现：Responses 客户端非 2xx 流式响应先读取 JSON 错误，保留上游状态和错误字段
已验证：Node Runtime packaging、Pi active dependency 选择和 Chat2API Responses/proxy/client 回归通过
已验证：code-only v15 在已有 Offline v24 真机热更新后，Pi Agent 请求已进入本机 llm-server/MNN 链路，日志不再出现 partial-json/parser.mjs 缺失
待处理：真机单条 Pi 聊天仍受 MNN 请求超时/服务进程稳定性影响；该问题与本次依赖文件缺失不同，需另立任务处理
```
