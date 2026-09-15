# Android MNNChat 本地 LLM 实现规格

状态：已实现并完成真机验证；官方 MNN 3.6.1 固定 native 产物和 arm64-v8a Debug APK 已构建、安装和启动。服务器统一下载/缓存/分发修正已纳入本规格；LLM CPU 配置的顶层与 `mllm` 双 runtime `thread_num` 传递和下一请求 runtime 换代修正已完成构建、安装和短请求验收。本次增量已完成推理结束后的模型身份/线程数预检查、下一次推理前最终校验、实际运行时状态上报以及异步 CPU 配置失败重试保护。本次离线 APK 增量已完成：内置 `qwen3.5-0.8b-claude-opus-distilled-mnn`，默认从 APK assets 解压后的 `filesDir/aasc-server/res/models/llm` 直接加载；offline 构建、APK 内容和全量 Node 回归均已验证。
本次增量：显示端 LLM 能力开关、MNNChat 参考模型目录、ModelScope 固定 revision 代理、`enable_thinking` 和视觉图片消息已实现；定向契约测试 13/13 通过。
本次增量：LLM 网关任务卡片已增加默认模型映射按钮和 WebSocket 配置弹窗，配置服务端完成校验、持久化、连接初始化补发及多控制端权威广播；网关在 manifest 未命中时读取动态映射。
本次增量：配置文件缺少 `llm.defaultModelMappings` 时默认保留 `qwen3.5-0.8b` 到 `qwen3.5-0.8b-claude-opus-distilled-mnn` 的映射；显式保存空数组仍表示用户主动关闭该入口别名。
2026-09-15 已用当前源码和完整 Android Runtime 重新构建 offline APK：`aasc-display-offline.apk`，大小 1073094719 bytes，SHA-256 为 `7471f2db9f6f78a9e228399ae1e663c491e3d634233876663beb349b6a6dd53f`；已安装到 `192.168.1.6:5555` 的 SM-N9500，未生成 `.mmap`。
本次增量：任务引擎已增加实例级 URL 路由注册；服务端和显示端任务均复用 AASC `8081`，显示端通过 `task:route_request` / `task:route_response` 执行，不新增网页监听端口。
模型增量：新增 `qwen3.5-0.8b-claude-opus-distilled-mnn`，ModelScope source 固定为 `MNN/Qwen3.5-0.8B-Claude-4.6-Opus-Reasoning-Distilled-MNN@c1bc31b15286afa708f37f690099d10f21d1cc74`；清单包含 `llm.*` 与 `visual.*` 运行文件。本次任务补齐 `enable_thinking=false` 和图片消息到 MNN `MultimodalPrompt` 的实现。

## 1. 目标与边界

本模块为 Android MNNChat 增加基于阿里官方 MNN-LLM Android 引擎的本地大语言模型能力。主服务器负责 OpenAI 兼容协议、模型目录、模型下载缓存、文件分发、显示端能力登记和请求分流；Android APK 只负责从主服务器下载当前选中模型、校验、加载、推理和流式结果回传。

本模块不引入外部 LLM 供应商作为兜底，也不改变 ASR、TTS 的 CPU 配置。LLM 使用独立的 CPU 配置，默认大核 2、小核 0、优先大核。

## 2. 现有代码锚点

- `src/apps/server/boot/server-app.js`：WebSocket 显示端注册、能力广播、配置初始化、模型 HTTP 路由和任务引擎启动入口。
- `src/apps/server/modules/config/config-app-service.js`：现有 `cpuAffinity` 规范化、持久化和 `cpuConfig` WebSocket 消息。
- `src/apps/server/modules/model-distribution/model-manifest-service.js`：视觉和语音增强模型清单、文件白名单、大小和哈希校验逻辑。
- `src/apps/server/modules/task-engine/builtin-tasks/registry.js`：内置任务和常驻服务注册表。
- `src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt`：WebView 与原生能力桥接及 ASR/TTS CPU 配置入口。
- `src/apps/android-display/app/src/main/java/com/aasc/display/RemoteModelManager.kt`、`ModelDownloader.kt`：APK 模型安全下载、临时文件和原子切换基础能力。
- `src/apps/android-display/app/src/main/java/com/aasc/display/CpuCluster.kt`、`CpuAffinity.kt`：CPU 拓扑检测和线程亲和性设置。
- `src/apps/android-display/app/src/main/cpp/CMakeLists.txt`、`aasc_mnn_jni.cpp`：编译官方 MNN-LLM `LlmSession` JNI，并强制校验 native 依赖和 16 KB page-size 链接参数。
- `src/apps/web-mediacenter/ui/public/display.html`、`js/device-list.js`、`js/websocket.js`、`js/tts.js`、`upload.html`：显示端能力/请求桥接、控制端设备列表、模型选择和 CPU 配置界面。

## 3. 服务端数据结构

```text
LlmModelFile {
  filename: string                  // 仅允许 manifest 中声明的相对文件名
  sizeBytes: integer
  sha256: string
  cached: boolean                   // 服务器缓存是否已完整校验
  url: string                       // 由服务端生成的本地分发地址
}

LlmModelDefinition {
  modelId: string                   // 对外暴露的稳定模型名
  displayName: string
  engine: "mnn-llm"
 architecture: string
  multimodal: boolean
 files: list<LlmModelFile>
  totalBytes: integer
  revision: string
  enabled: boolean
  source: {
    provider: "modelscope"
    repository: string
    revision: string
  } | null
}

LlmDisplayState {
  displayId: string
  state: "no_model" | "switching" | "downloading" | "loading" | "ready" | "error" | "not_ready" | "disabled"
  llmSupported: boolean
  llmEnabled: boolean             // 服务端能力设置；缺失按 true 处理
  llmReady: boolean
  selectedModelId: string | null    // null 表示 APK 尚未选择模型
  selectedRevision: string | null
  loadedModelId: string | null      // 当前 native engine 实际加载的模型
  loadedRevision: string | null
  threadCount: integer              // 当前 LLM policy 要求的线程数
  loadedThreadCount: integer        // 当前 native engine 已配置的线程数
  activeRequests: integer
  queueDepth: integer
  lastError: string | null
}

LlmRequest {
  requestId: string
  modelId: string
  displayId: string | null           // 请求头显式指定时固定目标
  protocol: "chat.completions" | "responses"
  payload: object
  stream: boolean
}
```

模型名可以映射多个 `displayId`。`modelId` 不映射任何可用显示端时，请求返回不可用错误，不转发到主服务器或外部模型。

## 3.1 网关默认模型映射

```text
LlmDefaultModelMapping {
  externalModelName: string
  modelId: string
}

llm.defaultModelMappings: list<LlmDefaultModelMapping>

缺少 `llm.defaultModelMappings` 字段时使用：
  [{ externalModelName: "qwen3.5-0.8b", modelId: "qwen3.5-0.8b-claude-opus-distilled-mnn" }]
显式保存 [] 时保留空数组，不自动恢复默认映射
```

控制端任务卡片：

```text
内置任务注册表 listTasks():
  对每个内置任务返回任务元数据
  保留 task.configButton（缺失时返回 null）

任务列表 WebSocket 格式化:
  configButton = task.configButton 或 null
  将 configButton 随 llm-server 条目发送到控制端

点击“默认映射”
  -> 打开映射弹窗
  -> 从当前 llm.modelManifest 读取内部 modelId 选项
  -> 编辑 externalModelName 与 modelId
  -> 发送 { type: "llm.defaultModelMappings.set", mappings }

收到 llm.defaultModelMappings 广播:
  更新本地权威映射
  if 弹窗没有未保存草稿:
    刷新弹窗行
  else:
    保留当前草稿并提示服务端配置已变化
发送失败:
  恢复保存按钮，保留草稿，允许连接恢复后重试
```

服务端配置流程：

```text
收到 llm.defaultModelMappings.set:
  读取当前模型清单
  规范化 mappings：去除外部名和 modelId 两端空白
  丢弃空白编辑行
  限制最多 64 条且每个外部名/modelId 不超过 256 个字符
  拒绝重复 externalModelName
  拒绝不存在的 modelId
  config.set("llm.defaultModelMappings", normalizedMappings)
  if config.set 返回 false:
    返回持久化失败错误，不广播
  broadcast { type: "llm.defaultModelMappings", mappings: normalizedMappings }
  向发起控制端返回同一份权威配置

收到非法配置:
  保留上一份有效配置
  返回 { type: "llm.defaultModelMappingsError", message }
```

网关解析：

```text
resolveModelId(requestedName):
  if requestedName 是内部 modelId 或 manifest alias:
    返回 manifest 解析结果
  if defaultModelMappings 中存在 externalModelName:
    返回对应 modelId
  返回未知模型
```

配置字段缺失时默认使用内置 Qwen 映射；显式保存空列表时保持空列表。映射目标即使已经发布但尚未 ready，也可以保存；真正请求仍由现有 `hasModel` 和 LLM 路由流程判断 ready 状态。

## 4. 模型目录与 APK 下载

### 4.1 服务端模型清单

新增 LLM 模型清单服务或在现有模型清单服务中增加独立 `llm` 分组。LLM 分组必须与 vision、speech-enhancement 的文件白名单隔离。模型目录参考 MNNChat `model_market.json`，ModelScope 模型记录固定仓库、revision 和逐文件大小/SHA-256。

```text
GET /api/llm/model-manifest
  return {
    type: "llmModelManifest",
    engine: "mnn-llm",
    models: list<LlmModelDefinition>
  }

GET /api/llm/model/:modelId/:filename
  validate modelId exists and enabled
  validate filename is an exact manifest basename
  require the server cache is complete and hash-valid
  stream the local cached file only
  reject path traversal, symlink escape, unknown file and hash mismatch
```

模型清单只声明在线可下载模型；在线 APK 不产生默认模型，offline APK 由构建变体声明固定的 `qwen3.5-0.8b-claude-opus-distilled-mnn` 默认模型。ModelScope `resolve` URL 只供服务器下载器使用，不返回给 APK，也不接受客户端任意上游地址。offline APK 的模型文件由离线构建脚本显式加入 assets，大文件和生成的 native 产物不提交到 Git。

### 4.2 服务器下载器与 npm 命令

```text
LlmModelDownloadService.downloadModel(modelId, force):
  definition = manifestService.findDefinition(modelId)
  require definition exists, enabled and has fixed ModelScope source
  acquire modelRoot/<directory>.lock without following external paths
  if complete local files match expected size and sha256 and force == false:
    return cached
  create modelRoot/<directory>.staging-<unique>
  for file in definition.files:
    build fixed ModelScope resolve URL from repository + revision + filename
    download URL, following bounded HTTPS redirects
    write to staging/<filename>.tmp
    require byte count == manifest size
    require SHA-256 == manifest sha256
    rename tmp to staging/<filename>
  atomically rename existing model directory to backup
  atomically rename staging to model directory
  remove backup and lock
  return ready manifest

npm run download:llm-model -- --id <modelId>
  parse one explicit model ID; support --force for a full refresh
  print per-file progress and final cache directory
  exit non-zero on unknown ID, download, size, hash or atomic-install failure
```

下载失败只清理本次 staging 和 lock；已存在的完整缓存不被删除。服务器进程和 CLI 使用同一 `res/models/llm` 缓存契约。

Qwen3.5 视觉推理模型的运行清单固定为：`config.json`、`configuration.json`、`llm.mnn`、`llm.mnn.json`、`llm.mnn.weight`、`llm_config.json`、`tokenizer.txt`、`visual.mnn`、`visual.mnn.weight`。`README.md`、`.gitattributes` 和 `export_args.json` 仅为仓库说明/导出记录，不下载到服务器缓存或 APK。模型声明 `multimodal=true` 后，Chat `image_url` 和 Responses `input_image` 均进入视觉推理路径。

### 4.3 APK 模型状态机

在线 APK 同时只保存一个模型的有效选择；`selectedModelId == null` 是合法初始状态。offline APK 在没有历史选择时自动将 `qwen3.5-0.8b-claude-opus-distilled-mnn` 作为选择，但模型目录直接指向安装器解压的 bundled 目录，不进入在线下载的 `active` 目录。

```text
filesDir/models/llm/
  active/    // 当前可推理模型
  staging/   // 新模型完整下载和校验目录
  backup/    // 原子切换期间的旧模型
  state.json // selectedModelId、revision、hash 状态

filesDir/aasc-server/res/models/llm/
  manifest.json
  qwen3.5-0.8b-claude-opus-distilled-mnn/ // offline APK bundled model
```

```text
selectModel(modelId):
  require modelId exists in latest manifest
  mark latest selection request
  wait until inferenceCount == 0
  require server manifest says modelId is ready
  download only files of modelId from the server cache into staging
  verify every file size and sha256
  load staging model with MNN-LLM
  if load fails:
    delete staging
    keep active model and report llm.modelSwitchFailed
  else:
    atomically move active -> backup
    atomically move staging -> active
    persist selectedModelId and revision
    release backup after the new engine is ready
    report llm.status with selected model and ready=true

ensureOfflineDefaultModel():
  if offline mode and selectedModelId is null:
    require installed .manifest.json contains every model file with expected size/hash
    enqueue the fixed qwen3.5-0.8b-claude-opus-distilled-mnn model

offline asset marker:
  package source .manifest.json as bundled-manifest.json because aapt excludes hidden assets
  after asset extraction, NodeRuntimeInstaller restores bundled-manifest.json as .manifest.json

offline task assets:
  listOfflineTaskFiles skips Android-unsupported hidden paths, including the runtime state file .task-links.json
  package task definitions and configuration only; do not package task instance results or task-link state
  when TaskIO.loadTaskLinks() sees the missing .task-links.json, use an empty task-link map

switchModel(modelId):
  wait until inferenceCount == 0
  if modelId is the configured offline bundled model and its installed directory is valid:
    load the installed directory directly with MNN-LLM
    do not call RemoteModelManager.ensureModel
    do not copy files to filesDir/models/llm/active
  else:
    use the online staging/active atomic download flow above
  persist selectedModelId and revision only after the candidate engine is ready
```

切换期间的新选择覆盖尚未开始的旧选择；不会中断正在执行的推理。下载失败、校验失败或加载失败都不能留下半成品，也不能自动回退到主服务器。

## 5. Android MNN-LLM 集成

### 5.1 native 构建

固定阿里官方 MNN 源码 revision，并记录 revision、编译参数、ABI、Android API 和 16 KB page-size 链接参数。目标 ABI 为 `arm64-v8a`，最低 API 保持现有 APK 约束。

```text
prepareMnnLlmNative():
  checkout pinned Alibaba MNN revision
  configure MNN_BUILD_LLM=true
  enable transformer fusion and ARM optimizations
  build/install MNN LLM, transformer and ARM libraries
  link with -Wl,-z,max-page-size=16384
  copy only arm64-v8a .so and JNI headers into Android build inputs
  emit native-artifact-manifest.json with revision and sha256
```

构建脚本应复用仓库现有 `npm run` 入口；如果没有现成脚本，新增专用 prepare 脚本，再由 `build:apk` 调用。不得让 APK 在运行时下载 native 库。

### 5.2 原生生命周期

新增 `MnnLlmModelManager` 和 `MnnLlmEngine`，通过 `NativeBridge` 暴露最小 JSON 接口：模型清单同步、选择模型、状态查询、异步推理和取消/释放。

```text
NativeDisplay.llmStatus():
  return {
    supported, selectedModelId, selectedRevision,
    loadedModelId, loadedRevision,
    ready, activeRequests, queueDepth,
    threadCount, loadedThreadCount, error
  }

NativeDisplay.llmSelectModel(modelId):
  validate modelId and enqueue latest model switch
  return accepted status immediately
  send window.onNativeLlmStatus with switching/ready/error status

server.handleDisplayLlmStatus(message):
  status = message.status if it is an object else message
  normalize status.state, ready, selectedModelId, queue counters and error
  broadcast the normalized state to control clients

serverModelCache:
  ModelScope URL is resolved and downloaded only by the server CLI/service
  APK request never receives an upstream ModelScope URL

streamCachedModelFile(modelId, filename):
  resolve the fixed local path inside res/models/llm/<directory>
  require server cache manifest is complete and hash-valid
  stream local file with Content-Length
  return MODEL_NOT_READY when the CLI download has not completed

downloadModelFile(url, expectedHash):
  download to the current file's temporary path
  on transport EOF or hash failure, retry the same file up to 3 times
  keep already verified files in staging and never expose the partial file as active

NativeDisplay.llmInferAsync(requestId, payload):
  require selected model is ready
  increment inferenceCount
  run MNN-LLM inference on dedicated executor
  emit llm.chunk for each decoded piece
  emit llm.completed or llm.error exactly once
  decrement inferenceCount and notify pending model switch
```

原生 JNI/API 细节以锁定的官方 MNN revision 为准；不得凭空复制未验证的类名或方法签名。所有 native 资源在生命周期结束时显式释放，加载失败必须返回结构化错误。

```text
display websocket receives llm.chunk:
  append data.text to logBuffer[displayId + requestId]
  continue forwarding data to llm gateway
  do not write a WS log line

display websocket receives llm.completed:
  finalText = data.text if present else logBuffer[displayId + requestId]
  delete logBuffer[displayId + requestId]
  write one complete WS log line

display websocket receives llm.error or disconnects:
  delete logBuffer[displayId + requestId or displayId prefix]
  write error and generated text length only
```

LLM 日志聚合仅作用于服务端日志，不改变 `llm.chunk` 到网关、控制端或 HTTP SSE 客户端的实时传输。

## 6. WebSocket 协议与分流

### 6.1 显示端注册

显示端连接初始化时在 `capabilities` 中声明 `llm` 能力，并上报 `llm.status`。服务端把能力、选中模型、ready 状态、活动请求数和排队数纳入 `displayList`。

```text
capabilities: {
  ...existingCapabilities,
  llm: { enabled: boolean, supported: boolean, engine: "mnn-llm" }
}

llm.status: {
  displayId, supported, ready, selectedModelId,
  selectedRevision, activeRequests, queueDepth, error
}
```

服务端断线清除该显示端的 LLM 可用状态；重连时以显示端初始化消息和后续状态作为权威运行状态。已有客户端忽略新增字段即可继续工作。

显示端页面收到服务端初始化的 `llm.status` 时，仅将其视为状态消息并结束当前消息处理；不能落入普通媒体消息兜底分支，否则会误调用 `showMedia()` 并打开睡眠模式的临时激活窗口。

### 6.2 请求分配

```text
resolveTarget(request):
  candidates = displays where
    llm.supported == true
    llm.ready == true
    selectedModelId == request.modelId
    websocket is connected

  if request.displayId is not null:
    if request.displayId not in candidates:
      return target-unavailable
    return request.displayId

  if candidates is empty:
    return target-unavailable

  return candidate with minimum (activeRequests + queueDepth)
         then stable displayId tie-breaker
```

显式 `displayId` 只允许请求到指定显示端；目标不可用时返回错误，不改派其他显示端，也不回退主服务器。自动分流在入队时增加 `queueDepth`，在显示端确认接收后转为 `activeRequests`，完成、错误、断线和超时都必须释放计数。

请求携带唯一 `requestId`。服务端只接受同一请求的首个终态，忽略迟到的 chunk 或 completed，避免切换模型、断线重连造成重复响应。

## 7. OpenAI 兼容网关

新增常驻 `LlmGatewayService`，由 `llm-server` 内置服务任务负责启停和状态展示；`llm-server` 通过任务上下文注册四个 OpenAI 兼容路由，网关只负责协议转换和本地显示端路由。

```text
POST /v1/chat/completions
  require body.model and body.messages
  parse stream, temperature, max_tokens
  resolveTarget(LlmRequest)
  send llm.request to display
  non-stream: collect chunks and return OpenAI chat response
  stream: convert llm.chunk to text/event-stream and terminate with [DONE]

POST /v1/responses
  require body.model and body.input
  parse stream, temperature, max_output_tokens
  resolveTarget(LlmRequest)
  convert chunks to output_text delta events

GET /v1/models
  return enabled model definitions
  include aasc displayIds, readyDisplayIds, selectedDisplayIds metadata
```

请求头 `X-AASC-Display-Id` 用于显式目标。错误映射固定为：缺少或未知模型 400，目标不可用 503，队列达到上限 429，目标模型不匹配 409。错误体保持 OpenAI 风格，同时包含 `code`、`requestId` 和可诊断的 `displayId`。

网关不能调用现有外部 LLM profile，也不能在没有本地目标时把请求转到主服务器自身。

### 7.1 思考控制和图片消息

```text
normalizeLlmPayload(protocol, body):
  require model and protocol-specific messages/input
  enableThinking = body.enable_thinking if boolean else null
  normalize text parts and image parts
  image part must be data:image/{jpeg,jpg,png,webp};base64,...
  reject invalid MIME, invalid base64, too many images or oversized request
  return payload with enable_thinking and normalized content
```

```text
display receives llm.request:
  thinking = payload.enable_thinking
  restore the load-time MNN config
  if thinking is boolean:
    native.setJinjaContext({ enable_thinking: thinking })
    if the model hard-codes the Qwen3.5 <think> generation prefix:
      replace only the final generation prefix for this request
  prompt = convert text messages to PromptItem
  for each image part:
    decode data URL with bounded pixel size
    create MNN PromptImagePart(image_data, width, height)
    replace part with <img>image_N</img> placeholder
  if image exists:
    call official LlmSession multimodal response
  else:
    call normal text response
  stream text after suppressing <think> and <thinking> blocks when thinking == false
```

Chat Completions image parts are `{ type: "image_url", image_url: { url: dataUrl } }`; Responses image parts are `{ type: "input_image", image_url: dataUrl }`. Text parts are preserved in order. Remote HTTP(S) image URLs are rejected in this phase. A failed image decode must return `LLM_IMAGE_INVALID` or `LLM_IMAGE_UNSUPPORTED` and must not silently call the text-only path.

## 8. CPU 配置

扩展现有 `config.cpuAffinity` 和 `cpuConfig` 消息，保留 `asr`、`tts` 字段并增加 `llm` 字段；继续使用现有控制端配置保存、`config.set` 持久化和 WebSocket 权威广播流程，不新增同职责的 HTTP 配置接口。

```text
llm default = { big: 2, little: 0, preferBig: true }

normalizeCpuAffinity(input):
  preserve existing asr and tts values
  normalize llm.big and llm.little to non-negative integers
  normalize llm.preferBig to boolean
  clamp each value to detected or configured CPU limit
  return authoritative { asr, tts, llm }
```

APK 收到 `cpuConfig` 后只将 `llm` 部分交给 MNN-LLM executor/thread pool；ASR/TTS 继续使用各自配置。LLM 配置断线时使用上述本地默认值，重连后接受服务端权威配置。控制端和 APK 控制页面都显示并可选择 LLM CPU 配置，但模型选择仍是每个 APK 独立状态。

```text
applyLlmCpuPolicy(cpuConfig, topology):
  policy = topology.policy(cpuConfig.big, cpuConfig.little, cpuConfig.preferBig)
  threadCount = max(1, policy.totalCoreCount)
  return { policy, threadCount }

onLlmCpuPolicyChanged(policy):
  update current llm policy
  increment policyGeneration
  keep current MNN runtime for the active request

loadMnnModel(modelDirectory, llmPolicy):
  apply affinity to current thread using llmPolicy.cpuMask
  sessionConfig.thread_num = llmPolicy.threadCount
  sessionConfig.mllm.thread_num = llmPolicy.threadCount
  extraOptions.keep_history = false
  extraOptions.mmap_dir = modelDirectory/.mmap
  extraOptions.thread_num = absent
  create official LlmSession(modelDirectory, sessionConfig, extraOptions)
  require official LlmSession forwards both sessionConfig.thread_num and
    sessionConfig.mllm.thread_num to MNN Llm.set_config

inferMnn(messages, llmPolicy):
  enqueue request without capturing the old engine
  after earlier request completes:
    if no active request and no model switch is running:
      if loadedModelId != selectedModelId or loadedRevision != selectedRevision:
        keep the existing model-switch queue responsible for model replacement
      if loadedPolicyGeneration != policyGeneration
          or loadedEngine.threadCount != max(1, llmPolicy.totalCoreCount):
        candidate = load the same active model directory with current llmPolicy
        require candidate.threadCount == max(1, llmPolicy.totalCoreCount)
        require model identity and policy generation did not change during load
        if candidate succeeds:
          replace current engine with candidate
          release old MNN engine
          set loadedModelId/loadedRevision to the candidate identity
          set loadedPolicyGeneration = policyGeneration
        else:
          release candidate if it was created
          keep old MNN engine and mismatch for a later retry
  before native generate:
    compare loadedModelId/revision with selectedModelId/revision
    compare loadedEngine.threadCount with max(1, current llmPolicy.totalCoreCount)
    compare loadedPolicyGeneration with policyGeneration
    if any comparison differs:
      perform the same safe candidate reload or report a structured mismatch
    generate using the verified engine
  apply affinity to current thread using llmPolicy.cpuMask
  call the verified LlmSession with explicit thread_num
```

LLM 不得依赖模型目录中的 `thread_num` 或 MNN 默认值；`thread_num` 必须由 APK 根据当前生效的 LLM CPU policy 同时写入官方 `LlmSession` 主配置的顶层 `thread_num` 和 `mllm.thread_num`，并由 `LlmSession` 转交给 MNN `Llm.set_config`。两处值必须保持一致，分别覆盖文本主 runtime 和视觉/多模态 processor runtime；只放入 `extra_config` 不算生效，因为官方会用主配置初始化 runtime。模型加载/推理调用线程先设置 affinity；ASR/TTS 的线程池和 affinity 不变。状态 JSON 需要返回 `threadCount`、`selectedCpus`、`cpuMask` 和 `fallback`，真机验收还必须通过 native 线程观测确认实际线程数。

CPU policy 变化不立即中断当前请求，也不重新下载模型。当前请求结束后，串行推理 worker 预检查模型身份和线程数并尽量提前换代 MNN runtime；下一条已接受请求在调用 native 前再次校验 generation、实际线程数和模型身份。换代失败时保留旧 runtime、报告状态错误并保留差异，后续请求可以重试。模型名/revision 的实际加载状态与 selected 状态分开记录，模型切换继续复用原有等待当前请求和队列的流程。服务端路由优先使用 `loadedModelId`，缺失时回退旧 APK 的 `selectedModelId`。

CPU 配置的 WebSocket 消息到达页面后，`cpuConfigureAsync` 的 `accepted` 只表示进入 APK 后台队列，不得直接视为已应用。页面保留 pending key，原生 worker 完成后通过主线程回调 `{ configKey, applied, error? }`；仅 `applied=true` 才更新已应用 key，失败则清除对应 pending，允许后续同配置重试，避免必须重启 APK 才恢复配置下发。

CPU 配置应用时，ASR/TTS pool 的独立失败只记录到错误汇总，不能阻断 `llmCpuPolicy` 更新和 `llmModelManager.onCpuPolicyChanged()`；因此 LLM 线程配置不依赖语音池是否可重建。

## 9. 控制页面

- 控制端设备列表只显示 `llm` 能力标签；模型选择移动到设备列表下方的独立卡片，且只显示当前选中的显示端、当前模型和 ready/切换中/错误状态。
- 当前显示端变化、模型清单更新或 `llm.status` 到达时，卡片重新渲染；没有当前显示端时显示占位提示。
- 能力编辑器提供“本地 LLM”开关，读写 `capabilities.llm.enabled`；开关缺失按 `true` 兼容旧状态，原生 `supported` 不允许由控制端伪造。
- 服务端收到 `updateCapabilities` 后规范化并持久化 `llm.enabled`，广播权威能力；`llm.enabled=false` 时路由器过滤该显示端，模型切换命令返回能力已禁用。
- APK 控制页面复用现有 control 页面和设备/模型组件，选择模型后显示下载、校验、加载、可用状态。
- 不支持 LLM 的旧显示端不显示可操作的模型控件；旧服务端消息字段保持兼容。

## 10. 测试与验收

```text
server unit:
  manifest path/file/hash validation
  modelId -> multiple displayIds mapping
  shortest activeRequests + queueDepth selection
  explicit target no-reroute and no-server-fallback
  OpenAI chat/responses streaming and error shapes
  enable_thinking=false applies MNN Jinja context and removes think output
  chat image_url and responses input_image reach visual.mnn on a real APK
  invalid/oversized image returns structured error without text fallback
  cpuConfig normalization and persistence

android/unit:
  no selected model initial state
  selected-model-only download
  switch waits for inferenceCount == 0
  latest selection wins
  hash/load failure rollback
  independent LLM CPU affinity

integration/device:
  two APKs with same model receive shortest-queue distribution
  different selected models are not cross-routed
  unavailable target returns 503
  control page and APK page can select models
  LLM capability toggle persists, disables routing and model selection, and survives reconnect
  ModelScope metadata and remote file proxy preserve per-file size/SHA-256 verification
  MNN arm64-v8a native library loads on API 26+ and 16 KB page-size device
  ASR/TTS behavior and CPU affinity remain unchanged
```

验证顺序：先运行已有 `npm test` 和新增 Node 测试，再执行 MNN native prepare、Gradle APK 构建，最后使用至少两个真实显示端验证下载、切换、流式输出、断线恢复和 CPU 状态。线程数修正已使用固定 MNN checkout 完成 Gradle 构建、安装和短流式请求；推理期间快照观察到两个主要高负载推理相关线程，进程总 CPU 仍包含 WebView 等线程。没有真实 MNN 模型或目标设备时，不把 mock 通过误判为端到端完成。

## 11. 失败处理、可观测性与性能约束

- 所有跨 WebSocket 的请求、状态、错误都带 `requestId` 或 `displayId`，服务端记录选型、排队、首 token、完成和失败原因。
- 队列长度和单显示端并发上限可配置；达到上限立即返回 429，不无限堆积内存。
- 模型切换短时间需要同时保留 active 和 staging/backup，必须检查磁盘空间；不足时在下载前失败。
- 流式连接断开时释放路由计数并请求 APK 停止生成；迟到事件不得污染后续请求。
- native 加载或推理失败只影响该显示端的 LLM ready 状态，不能改变 ASR/TTS 状态，也不能触发主服务器或外部 LLM 兜底。

## 12. 实施状态

本规格根据已确认设计完成伪代码落地，并已同步到服务端、Android bridge、WebSocket 页面和 CPU 配置实现。`enable_thinking` 与图片理解的增量任务为 `docs/task/2026-09-13_LLM不思考与图片理解支持.md`。模型二进制和官方 MNN checkout 不提交到仓库；构建必须设置固定 `AASC_MNN_ROOT`、`AASC_MNN_REVISION` 并运行 `npm run prepare:mnnllm-android`，缺失依赖时 CMake 直接失败。Gradle 将根目录通过 `defaultConfig.externalNativeBuild.cmake.arguments` 传给 CMake，避免 AGP 9 模块级 DSL 不提供 `arguments` 属性。当前已使用 MNN 3.6.1 提交 `d407447ed56c4121a11ccbd266dc184ca1ead0c2` 和 NDK 28.2.13676358 完成 `npm run build:apk`；native ELF 的 LOAD 对齐为 `0x4000`；APK 已安装到 `192.168.1.6:5555` 并用 `npm run start:apk:display` 无参数启动。Chat `image_url` 和 Responses `input_image` 已用 Qwen3.5 真机验证，图片进入 `MultimodalPrompt` 并清理临时文件。双 runtime 线程配置同步任务 `docs/task/2026-09-13_MNN双runtime线程配置同步.md` 已完成，真机同一 APK 进程 PID `27146` 的下一次推理日志同时显示顶层与 `mllm` `thread_num=2`。
本次任务已完成：默认模型映射配置由 `llm-server` 任务卡片入口维护，服务端使用 `llm.defaultModelMappings.set/get` WebSocket 消息完成规范化校验、持久化、重连补发和多控制端广播；配置字段缺失时保留内置 Qwen 映射，显式空数组仍可关闭；`LlmGatewayService` 在 manifest 内置模型名/alias 未命中时再查找动态映射。
## 11. 本地 LLM 网关任务实例

`llm-server` 是任务引擎中的常驻内置服务。它的创建入口不使用 LLM 专用分支：

```text
createBuiltinInstance(taskName):
  task = taskList.find(taskName)
  if task.mode == "service" or task.params 非空 or task 是视觉内置任务:
    openBuiltinTaskForm(taskName)
  else:
    submitBuiltinDraft(taskName)

openBuiltinTaskForm("llm-server"):
  复用通用执行目标、执行环境、模式和目标设备选择器
  用户选择 server/display/subdisplay 与 displayId
  复用 task:submit 创建实例

runInstance(taskName, instanceId):
  从实例索引恢复 target、displayId、mode 和 params
  复用任务路由器和服务作用域隔离
target/displayId 决定实例的运行节点
  llm-server 只从 context.llmGatewayService 获取网关，不改变任务生命周期
```

创建、运行、停止、重连恢复和日志回传均沿用 `TaskManager`，不得为本地 LLM 网关增加单独的 HTTP 或 WebSocket 实例协议。

## 11.1 任务 URL 路由注册

```text
service.run(context):
  unregister = await context.registerRoute({ method, path, handler })
  save unregister in current service instance
  return { type: "service", stop: unregister all routes }

HTTP :8081:
  if TaskRouteRegistry has method + path:
    request = copy method/path/query/headers/body
    if target == server:
      await handler({ request, response, taskName, instanceId, params })
    if target == display/subdisplay:
      send task:route_request with routeId/requestId
      wait task:route_response(headers/chunk/end/error)
  else:
    continue existing Express routes

display.on task:route_request:
  find local route handler
  create response adapter
  await handler({ request, response, taskName, instanceId, params })
  return task:route_response
```

路由注册器限制绝对路径和常用 HTTP 方法，并在同一 AASC 设备内拒绝重复 `method + path`。实例停止、服务替换、启动异常、实例删除、显示端断开和服务端销毁都调用实例级清理；显示端断开时等待中的 HTTP 请求返回 `503`，处理超时返回 `504` 并发送 `task:route_cancel`。浏览器显示端和 Node 子显示端均实现相同消息字段，消息始终包含 `type`、`routeId`、`requestId` 和必要的实例标识。

`llm-server` 通过该接口注册 `GET /v1/models`、`POST /v1/chat/completions`、`POST /v1/responses` 和 `POST /v1/chat/responses`。服务端目标调用现有 LLM handler；显式选择 Android 显示端时，网页端用本地 MNN-LLM bridge 执行请求并将 OpenAI 响应通过任务路由回传。不同设备各自使用 `8081`，本次不实现跨设备统一负载均衡。
## 12. 外部模型名映射与协议入口

模型清单定义外部别名，服务端网关统一归一化请求：

```text
normalizeDefinition(model):
  aliases = trim、去重、过滤空字符串
  reject alias 与其他 modelId/alias 冲突
  return model + aliases

resolveModelId(externalName):
  find model.modelId == externalName
  or find externalName in model.aliases
  return model.modelId

validateRequest(protocol, body):
  requestedModelId = body.model
  modelId = resolveModelId(requestedModelId)
  require modelId 对应已发布模型
  payload.model = modelId
  route and display message use modelId
  HTTP response.model 保留 requestedModelId
```

协议入口：

```text
POST /v1/chat/completions -> chat.completions
POST /v1/responses -> responses
POST /v1/chat/responses -> responses 兼容入口
```

以上三个入口共享模型别名解析、显示端最短队列分流、显式 displayId 校验和错误结构。
## 13. LLM 能力关闭与模型内存释放

```text
handleCapabilitiesUpdated(data):
  enabled = data.capabilities.llm.enabled != false
  nativeBridge.llmSetEnabled(enabled)

llmSetEnabled(false):
  enabled = false
  清除尚未开始的模型切换请求
  等待 activeRequests 和 queueDepth 清零
  release currentEngine
  保留 active 模型目录、state.json 和 selectedModelId
  publish state=disabled, ready=false

llmSetEnabled(true):
  enabled = true
  if selectedModelId 存在且 currentEngine 未加载:
    从 active 本地缓存重新加载
    缓存不完整时按正常模型下载流程补齐
  publish switching/loading/ready 状态
```

能力开关只控制 LLM；不得释放 ASR/TTS engine、改变它们的 CPU affinity 或删除 LLM 磁盘缓存。

## 14. 流式请求生命周期与错误输出

```text
handleLlmHttpRequest(req, res, protocol):
  validate request and start gateway request
  if stream:
    set text/event-stream headers
    on res.close:
      if response is not finished:
        cancel request with LLM_CLIENT_DISCONNECTED
    await started.promise
    write protocol completion event and [DONE]
    remove res.close listener before ending response
```

不得使用 `req.close` 作为流式响应断开依据；请求体完成解析后该事件不等价于客户端关闭 SSE 响应。客户端解析 SSE 时：

```text
for each data line:
  if data == [DONE]: stop
  parse JSON
  if JSON.error exists:
    print error.code and error.message to stderr
  else:
    print choices[0].delta.content
```

HTTP 非 2xx 和 SSE `event: error` 都必须可见，不得把错误响应当作空的正常回答。

## 15. 客户端断开与 MNN 原生取消

```text
gateway response close:
  if response not finished:
    send display message { type: 'llm.cancel', requestId }
    reject HTTP request promise
    release router request

display inferAsync(requestId):
  add requestId to pendingInferenceIds
  executor starts:
    mark requestId active
    if cancelled(requestId): skip native generate
    else native.generate(...)
    if cancelled(requestId): do not send llm.completed
    finally remove requestId and notify model-switch waiters

display cancel(requestId):
  if requestId is queued or active:
    mark requestId cancelled
    if requestId is active:
      native.cancel()

JNI nativeCancel(session):
  set atomic cancellation flag for session
native generation callback:
  if atomic cancellation flag:
    return true
  return Java listener stop result
```

取消只在当前 requestId 的 token 回调边界停止生成；不删除模型文件、不释放 session、不改变 ASR/TTS 和其他 LLM 请求。

## 16. 流式请求空闲超时与超时取消

```text
startRequest(request):
  timeoutMs = config.llm.requestTimeoutMs（默认 120000）
  scheduleIdleTimeout(request.requestId)
  send llm.request

handleDisplayMessage(llm.chunk):
  if pending request exists:
    scheduleIdleTimeout(request.requestId)  // 每个 chunk 续期
    append text and forward chunk

idleTimeout(requestId):
  cancel(requestId, LLM_REQUEST_TIMEOUT)

cancel(requestId, error):
  send llm.cancel to target display
  reject HTTP promise
  clear timeout
  remove pending request
  release router request
```

`requestTimeoutMs` 是无 chunk 活动超时，覆盖首 token、prefill 和生成间隙；持续收到 chunk 的长请求不受固定总时长限制。超时必须复用 `cancel(requestId)`，确保 APK 停止 native 推理，不能只执行 `fail + release`。

## 17. offline APK display 2 真机语音验收

```text
verifyOfflineVoice(displayId = 2):
  启动 com.aasc.display.offline/MainActivity 到 display 2 的 fullscreen window
  等待 display WebSocket capabilities.voiceRecognition == true
  POST /api/asr/recognize multipart audio=你好，小爱.wav, displayId=当前 displayId
  require HTTP 200
  require response.status == "success"
  require response.text 或 response.segments 非空
  记录 asrElapsedMs 和 voiceprintElapsedMs

  POST /api/tts/generate { text: "TTS 真机复测" }
  require HTTP 200
  require response.audioUrl 非空
  GET response.audioUrl
  require Content-Type == "audio/wav" and Content-Length > 0

  通过控制端发送 { type: "tts", displayId, action: "play", text }
  require display 日志收到 ttsGenerating 和 ttsResult
  require 网页播放日志收到 "TTS 当前句完成: ended"
```

本次真机结果：ASR 识别为“你好，小爱。”；TTS 生成 WAV 为 `141046` bytes，播放完成事件已收到。测试设备为 `192.168.1.6:5555` 的 SM-N9500，APK 实际运行于 display 2。

## 2026-09-14 Android offline 服务启动与模型路径增量

```text
TaskManager.runInstance(task):
  if Android 节点且 task.target 是 server/subserver:
    if task.mode == service:
      在当前 server-app Node 进程执行 _runServiceTask
      不创建 nodeRunner、puppeteerRunner 或其他外部子进程
    else if 内置任务明确声明无需 Runner:
      允许当前进程内的一次性任务继续执行
    else:
      返回“Android APK 节点不支持需要创建子进程的服务端任务”

TaskManager.ensureBuiltinServiceInstance(taskName, options):
  读取 taskName 的实例索引
  if 存在 mode=service 且 status=running 的实例:
    返回已有实例
  submit builtin task draft，使用 options.target/options.mode/options.params
  runInstance(taskName, instanceId)
  返回新建实例的状态

offline server-app 启动:
  await taskManager.restoreAutoStartServices()
  if AASC_OFFLINE_MODE == "1":
    await taskManager.ensureBuiltinServiceInstance("llm-server", {
      target: "server",
      mode: "service"
    })
```

```text
HTTP /v1 路由注册:
  任务路由中间件先调用 taskManager.handleHttpRoute(req, res)
  llm-server running 时由 context.registerRoute() 处理四个 /v1 路径
  llm-server 未运行时固定兜底只返回结构化 503
  固定兜底不得直接调用 LlmGatewayService，避免绕过任务生命周期
```

```text
NativeBridge(offlineMode=true):
  asrDirectory = filesDir/aasc-server/res/models/sensevoice
  ttsDirectory = filesDir/aasc-server/res/models/tts
  AsrModelManager(asrDirectory)
  TtsModelManager(ttsDirectory)

offline ASR ensureModel:
  校验内置 model.int8.onnx、tokens.txt 及随包 sha256
  校验成功后直接加载，不请求服务器、不写 files/models/sensevoice

offline TTS ensureModel:
  读取内置 manifest.json
  校验清单声明的每个文件存在且 hash 正确
  校验成功后直接加载，不请求服务器、不写 files/models/tts

online 模式:
  保持 files/models/sensevoice 和 files/models/tts 的原有下载缓存路径
```

## 2026-09-15 offline 聊天传输补充伪代码

```text
offline server-app 初始化 chat:
  传入当前 AASC 监听协议、127.0.0.1、8081 和设备本机地址

chat profile 地址归一化:
  if profile.apiUrl 指向回环/设备本机的 8081:
    使用内置 server 实际协议
    baseUrl = `${实际协议}://127.0.0.1:8081/v1`
    completionsUrl = `${baseUrl}/chat/completions`
    requestOptions = { rejectUnauthorized: false }
  else:
    保持用户配置的 URL 和系统默认 TLS 校验

发送聊天:
  openai-responses 使用 baseUrl/responses
  openai-completions 使用 completionsUrl
  两条请求都只对内置本机目标应用 requestOptions
  连接错误通过 onError 回传 chatResponse(success=false)

## 2026-09-15 offline 首包解包启动补充伪代码

```text
NodeRuntimeInstaller.ensureInstalled:
  if 已安装版本、运行模式、必需文件和离线模型尺寸均有效:
    直接复用正式 Runtime 目录
  else:
    staging = filesDir/.aasc-node-runtime-staging-<version>-<timestamp>
    将 APK Runtime assets 解包到 staging
    在 staging 对 manifest 中的全部文件执行大小和 SHA-256 校验
    atomicInstall(staging, filesDir/aasc-server, runtimeVersion):
      if 正式目录存在:
        将正式目录重命名为同级 backup
      将 staging 重命名为正式目录
      从 backup 恢复 config、home、logs、res/tasks、res/uploads、res/temp
      正式目录缺少 config/config.json 时，用随包 offline-config.json 初始化
      生成随包模型的轻量 marker，写入 runtime 版本标记
      删除 backup
    if 任一步骤失败:
      将已恢复的可变目录移回 backup
      删除不完整的新正式目录
      将 backup 重命名回正式目录
```

该安装路径不执行 staging 到正式目录的第二次文件复制；模型仍按原 APK 内容首次解包，不生成 `.mmap`。

2026-09-15 真机复测：完全卸载 `com.aasc.display.offline` 后重新安装 APK，display 2 的 `MainActivity` 正常恢复；Runtime 完整安装耗时约 145 秒，Node 服务随后监听 8081，并自动创建 `llm-server` 任务。`/v1/models` 显示 `qwen3.5-0.8b-claude-opus-distilled-mnn` 已对 display 2 ready，Chat Completions 实际返回非空内容；普通包已停止。
