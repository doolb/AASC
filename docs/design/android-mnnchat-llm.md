# Android MNNChat 本地 LLM 与模型分流设计

## 状态

本设计已于 2026-09-12 确认，第一阶段服务端、Android bridge、WebSocket、控制页面、LLM 能力开关和 ModelScope 模型目录实现已落地；2026-09-13 已使用官方 MNN 3.6.1 固定提交构建、安装并在真实设备上完成文本、关闭思考和图片协议验收。
本次模型增量已确认接入 `Qwen3.5-0.8B-Claude-4.6-Opus-Reasoning-Distilled-MNN`：ModelScope 仓库为 `MNN/Qwen3.5-0.8B-Claude-4.6-Opus-Reasoning-Distilled-MNN`，固定 revision 为 `c1bc31b15286afa708f37f690099d10f21d1cc74`。该模型包含视觉权重；本次增量补齐按请求关闭思考和标准图片输入到 MNN Vision 的链路。

## 目标

在现有 Android 显示 APK 中集成阿里 MNN-LLM native 推理引擎，使 APK 能够作为 AASC 的本地 LLM 显示端。主服务器统一提供 OpenAI 兼容协议，服务器根据模型名把请求分配给已加载该模型的在线 APK。模型目录参考 MNNChat 的官方 `assets/model_market.json`，模型文件通过 ModelScope 仓库下载到 APK。

本功能必须满足：

- 不设置默认模型，首次使用前必须由用户选择模型。
- 每个 APK 本地最多保存一个 MNN 模型。
- LLM 使用独立的 CPU 核心配置，默认使用 2 个大核、0 个小核，并优先绑定大核。
- 主服务器维护模型清单，APK 只下载当前选中的模型。
- 切换模型时等待当前推理完成，再下载、校验和切换新模型。
- 一个模型名可以映射到多个显示端，并按最短队列分流。
- 指定 `displayId` 时固定调用该显示端，跳过分流。
- 目标 APK 离线、未选模型、模型未就绪或队列已满时直接返回错误，不回退到主服务器模型。
- 主服务器对外提供 `/v1/chat/completions`、`/v1/responses` 和 `/v1/models`。
- 控制端和 APK 内控制页面都可以为指定显示端选择模型。
- 显示端能力列表标注 MNNChat LLM、当前模型和运行状态。

## 非目标

- 不把 MNNChat 作为独立 APK 启动或通过外部应用 Intent 调用。
- 不在 APK 内再开放一个对外 LLM HTTP 端口。
- 不在第一阶段实现模型自动下载全部模型、默认模型自动选择或主服务器 LLM 回退。
- 不修改既有 ASR、TTS、声纹和媒体路由的协议语义。
- 不在本功能中引入鉴权系统；沿用当前 AASC 局域网无鉴权边界，并保留后续接入鉴权的扩展点。

## 总体架构

```text
外部 OpenAI 客户端 / 控制端任务
              │
              │ POST /v1/chat/completions
              │ POST /v1/responses
              ▼
      主服务器 LlmGatewayService
              │
              ├─ 根据 model 查找在线且 ready 的 APK 集合
              ├─ 指定 displayId 时固定目标
              ├─ 未指定目标时选择最短队列
              └─ 无可用目标时结构化失败，不回退
              │
              │ display WebSocket: llm.request
              ▼
       APK display.html
              │
              │ NativeDisplay.mnnLlmInferAsync
              ▼
      MnnLlmEngine JNI / MNN-LLM
              │
              └─ llm.chunk / llm.completed / llm.error
```

主服务器是唯一的 OpenAI 协议入口。APK 显示端只通过已经存在的主服务器显示 WebSocket 接收推理请求，并通过同一连接返回结果；内置 Node.js 子服务器不承载 LLM 协议入口。

## MNN 引擎集成

### Native 构建

Android 工程集成阿里 MNN 官方 `apps/Android/MnnLlmChat` 使用的 MNN-LLM 引擎能力，在当前 APK 的 `arm64-v8a` 构建中启用 LLM native 库。构建配置必须启用 MNN LLM、Transformer 融合和 ARM 优化，并保留现有 APK 的 Android 8/API 26 最低版本与 16 KB page size 兼容约束。

MNN 源码和生成的 native 库不直接提交大体积构建产物；通过可重复的准备脚本获取固定上游版本、构建 `arm64-v8a` 库并复制到 APK 构建输入。构建缺少 LLM native 库时必须明确失败，不能静默生成没有 LLM 能力的 APK。

### Kotlin/JNI 边界

新增 `MnnLlmEngine` 和 `MnnLlmModelManager`：

- `MnnLlmModelManager` 管理清单、下载、hash 校验、单模型缓存和切换状态。
- `MnnLlmEngine` 只负责打开一个已校验模型、串行执行推理、发送 token 回调和释放 native 资源。
- `MnnLlmEngine` 使用独立的 LLM CPU policy，默认选择 2 个大核，不修改 ASR/TTS 的 policy 或线程池。
- `NativeBridge` 只暴露 JSON/字符串桥接方法，不把 MNN 对象泄漏到 JavaScript。
- 推理运行在 APK 专用单线程 executor；同一 APK 同时只执行一个 MNN 推理，后续请求由主服务器队列管理。
- 推理停止、页面重载或 WebSocket 断开时，NativeBridge 发送取消信号并释放对应 requestId。

建议桥接接口：

```text
mnnLlmStatus() -> JSON
mnnLlmCpuStatus() -> JSON
mnnLlmSelectModel(modelId) -> JSON { accepted, status }
mnnLlmInferAsync(requestId, requestJson) -> JSON { accepted }
mnnLlmCancel(requestId) -> JSON { accepted }
```

原生结果通过页面回调发送：

```text
window.onNativeLlmEvent({
    requestId,
    event: 'chunk' | 'completed' | 'error',
    text,
    usage,
    error
})
```

## 模型清单、下载与单模型缓存

主服务器新增 MNN 模型清单和白名单下载接口。模型目录参考 MNNChat v9 的官方目录；AASC 只发布已确认兼容 MNN-LLM、能从 ModelScope 获取完整文件元数据的模型，不把没有文件校验信息的目录项伪装成可下载模型：

```text
GET /api/llm/model-manifest
GET /api/llm/model/:modelId/:filename
```

模型清单至少包含：

```json
{
  "version": 1,
  "models": [
    {
      "id": "qwen3-1.7b",
      "name": "Qwen3 1.7B",
      "engine": "mnnchat",
      "files": [
        { "name": "config.json", "size": 0, "sha256": "..." },
        { "name": "llm.mnn", "size": 0, "sha256": "..." }
      ]
    }
  ]
}
```

远端模型定义额外包含 ModelScope 仓库和 revision；服务端通过固定的 ModelScope `resolve` 地址代理文件，不接受客户端传入任意上游 URL。清单文件仍必须记录每个文件的大小和 SHA-256，APK 下载的是当前选择模型的全部声明文件。实际文件不存在、远端元数据不完整或校验失败的模型不出现在可选列表中。`modelId`、仓库名和文件名必须使用白名单校验，禁止路径穿越。

APK 目录约定：

```text
filesDir/models/llm/
├── active/       # 当前唯一可用模型
├── staging/      # 下载中的新模型
└── backup/       # 新模型加载成功前保留的旧模型
```

切换流程：

1. 记录新的 `selectedModelId`，不改变当前 `loadedModelId`。
2. 当前 MNN 推理完成后进入 `switching`，拒绝新的推理请求或排队等待切换完成。
3. 下载到 `staging`，逐文件校验大小和 SHA-256。
4. 新模型加载成功后，将旧 `active` 原子切换到 `backup`，将 `staging` 切换为 `active`。
5. 更新 `loadedModelId` 和能力状态，再删除 `backup`。
6. 任何下载、校验或加载失败都保留旧模型，恢复 `ready` 状态并报告错误。

如果用户在下载过程中再次选择模型，只保留最后一次选择；当前下载可安全取消，完成当前推理后处理最后选择的模型。

## 模型与显示端映射

服务器不维护重复的手工映射表，映射由显示端状态自动形成：

```text
modelId -> [displayId...]
```

每个 APK 通过能力消息上报：

```json
{
  "llm": true,
  "llmEngine": "mnnchat",
  "selectedModelId": "qwen3-1.7b",
  "loadedModelId": "qwen3-1.7b",
  "llmStatus": "ready",
  "activeRequests": 0,
  "queueDepth": 0,
  "llmProtocols": ["chat.completions", "responses"]
}
```

只有 `online=true`、`llm=true`、`llmStatus=ready` 且 `loadedModelId` 与请求 `model` 相同的显示端才加入模型分流池。模型已选择但仍在下载时只显示为目标状态，不加入可执行分流池。

### 分流算法

对没有显式 `displayId` 的请求：

1. 按 `modelId` 找到候选显示端。
2. 过滤离线、非 ready、正在切换和超过队列上限的显示端。
3. 计算 `activeRequests + queueDepth`，选择数值最小者。
4. 数值相同时使用轮询游标打散请求。
5. 派发成功后增加目标显示端计数；完成、失败、取消和断线时减少计数。

对带 `displayId` 的请求：

- 必须校验该显示端在线、能力有效、模型匹配且可排队。
- 不参与其他显示端分流。
- 校验失败直接返回结构化错误，不改派其他显示端。

## 对外协议

### Chat Completions

```text
POST /v1/chat/completions
```

请求遵循 OpenAI Chat Completions 字段，至少支持 `model`、`messages`、`stream`、`temperature`、`max_tokens`。AASC 扩展通过 `X-AASC-Display-Id` 请求头指定显示端；不带该请求头时按模型分流。

非流式返回 `choices[0].message.content`；流式返回 `chat.completion.chunk` SSE 事件并以 `data: [DONE]` 结束。

### Responses

```text
POST /v1/responses
```

请求遵循 Responses 字段，至少支持 `model`、`input`、`stream`、`temperature`、`max_output_tokens`。不带显式目标时按模型分流，流式输出使用 `response.output_text.delta` 和完成事件。

### 思考控制与图片输入

两个协议都支持可选的 `enable_thinking` 布尔字段。APK 每次请求先恢复模型加载时的 MNN 基线配置，再应用 Jinja context；对 Qwen3.5 这类把 `<think>` 固定写入 generation prompt 的模板，只替换本次请求的最后一个生成前缀。`enable_thinking=false` 时同时在流式/最终结果边界过滤 `<think>...</think>` 和 `<thinking>...</thinking>`，保证客户端不收到思考内容；未提供该字段时保留模型默认行为。

图片使用 OpenAI 兼容的 data URL，不允许显示端或模型引擎访问任意外部 URL。Chat Completions 使用 `content` 数组中的 `type=image_url`；Responses 使用 `input` 消息的 `type=input_image`。服务器校验 MIME、Base64 和大小后把图片随 WebSocket 请求传给目标 APK，APK 解码为 MNN `PromptImagePart`，通过官方 `MultimodalPrompt` 的 `<img>placeholder</img>` 语法调用 `visual.mnn`。图片处理失败返回结构化 `LLM_IMAGE_INVALID` 或 `LLM_IMAGE_UNSUPPORTED`，不降级为文本推理，避免静默丢图。

### Models

```text
GET /v1/models
```

返回主服务器模型目录。每个模型附加 AASC 状态字段：

```json
{
  "id": "qwen3-1.7b",
  "object": "model",
  "owned_by": "aasc-mnnchat",
  "aasc": {
    "displayIds": ["APK-01", "APK-02"],
    "readyDisplayIds": ["APK-01"],
    "selectedDisplayIds": ["APK-01", "APK-02"]
  }
}
```

`model` 为必填字段；没有默认模型时缺少 `model` 返回 `400`。没有可用显示端时返回 `503`，队列已满返回 `429`，指定显示端但模型不匹配返回 `409`，均返回 `{ error: { code, message } }`。

## 内部 WebSocket 协议

主服务器向指定显示端发送：

```json
{
  "type": "llm.request",
  "requestId": "req-123",
  "model": "qwen3-1.7b",
  "protocol": "chat.completions",
  "stream": true,
  "payload": {}
}
```

显示端返回：

```json
{
  "type": "llm.chunk",
  "requestId": "req-123",
  "text": "你好",
  "index": 0,
  "done": false
}
```

完成、失败和取消分别使用 `llm.completed`、`llm.error`、`llm.cancelled`。所有消息必须携带 `requestId`，服务器只接受当前目标显示端和当前请求的回包，防止断线重连后的旧结果污染新请求。

服务端日志不逐条打印 `llm.chunk`：显示端回传的 chunk 只进入按 `displayId + requestId` 维护的临时聚合缓冲，收到 `llm.completed` 后只打印一次完整文本；推理失败时清理缓冲并只记录错误和已生成文本长度。该策略不改变 WebSocket 流式转发和 HTTP SSE 输出。

模型选择消息：

```json
{
  "type": "llm.selectModel",
  "displayId": "APK-01",
  "modelId": "qwen3-1.7b"
}
```

服务器向目标 APK 转发选择命令；APK 完成切换后用 `llm.status` 上报 `selectedModelId`、`loadedModelId`、`llmStatus` 和错误信息，并触发标准 `capabilities` 更新。

## `llm-server` 任务

新增内置常驻任务 `llm-server`，作为主服务器 LLM 网关的控制入口。任务负责：

- 启用或停用 `/v1/*` 网关。
- 显示当前模型目录、在线分流池和请求统计。
- 配置请求超时、单显示端最大队列长度和分流策略。
- 通过任务 Widget 展示每个模型的 ready 显示端数量。

实际 HTTP 路由由独立 `LlmGatewayService` 注册到主服务器，任务只调用该服务的启动、停止和配置接口，避免让任务模块直接持有 Express 对象。网关停止时接口返回 `503`，不会改变 APK 已加载的模型。

## 控制端与显示面板

设备列表保留每个显示端的 `MNNChat LLM` 能力标签，不在列表项内放置模型选择框。

控制页面在设备列表下方增加一个独立的 LLM 模型卡片，只显示当前选中的显示端：
- 显示当前显示端、当前选中模型、当前加载模型和状态。
- 从主服务器模型清单生成选择框。
- 选择后发送 `llm.selectModel`，显示下载/切换进度。
- 当前显示端切换时，卡片同步切换目标；没有选中显示端时显示明确占位提示。
- 在“显示端能力设置”中增加“本地 LLM”开关。开关关闭时该显示端不参与本地 LLM 分流，模型选择控件禁用；不覆盖 APK 原生 `supported` 检测结果。
- 在现有“APK 大小核并发”面板增加 LLM 大核/小核输入，默认显示“大核 2 / 小核 0 / 优先大核”。

APK 的控制页面复用现有控制端页面和设备列表代码，因此控制端和 APK 内控制页使用相同的模型选择、状态回显和错误提示逻辑。普通显示页面只负责上报能力、转发 MNN 请求和回传结果，不增加独立的模型管理 UI。

## 状态与错误处理

```text
no_model       已安装引擎但没有选择模型
downloading    正在下载当前选择模型
switching      当前推理完成后正在加载新模型
ready          当前模型已加载，可接收请求
busy           正在执行推理
error          当前模型下载或加载失败
```

服务器端必须区分：

- `llmDisplayOffline`：指定显示端不在线。
- `llmModelNotSelected`：显示端没有选择模型。
- `llmModelNotReady`：选择模型尚未加载完成。
- `llmModelMismatch`：请求模型与目标显示端不一致。
- `llmQueueFull`：目标显示端队列已满。
- `llmRequestTimeout`：推理超过网关超时。
- `llmResponseStale`：收到旧 requestId 的回包并丢弃。

服务器和 APK 都记录 requestId、modelId、displayId、协议类型、排队耗时、推理耗时和最终状态；普通 token 不写高噪声日志。

## LLM CPU 核心配置

LLM 在现有 APK 大小核并发面板中增加独立一行，不复用 ASR 或 TTS 的数量。服务器配置扩展为：

```json
{
  "asr": { "bigCoreCount": 1, "littleCoreCount": 1, "preferBigCores": false },
  "tts": { "bigCoreCount": 1, "littleCoreCount": 1, "preferBigCores": false },
  "llm": { "bigCoreCount": 2, "littleCoreCount": 0, "preferBigCores": true }
}
```

规则：

- `llm.bigCoreCount` 默认 `2`，`llm.littleCoreCount` 默认 `0`，`llm.preferBigCores` 默认 `true`。
- 控制端仍通过 `/api/config/cpuAffinity` 保存配置；`cpuConfig` 消息新增 `llm` 字段。
- APK 收到 `llm` 配置后调用已有 `CpuCluster.policy` 计算实际 CPU mask，并在 MNN 模型加载和推理 worker 上应用 affinity。
- MNN native 必须显式接收 `thread_num = max(1, 实际选中的 LLM 核心数)`，不使用模型配置或 MNN 默认线程数；线程数不超过实际选中的 LLM 核心数。
- MNN 模型加载和每次推理前先对调用线程应用 LLM affinity，使 native 创建的工作线程继承同一 CPU mask；设备大核不足时沿用现有 policy 的确定性回退和状态提示。
- LLM 配置更新只影响后续 MNN 模型加载/推理 worker，不重建 ASR/TTS pool，不改变现有语音录音和播放行为。
- 控制端状态显示实际选择的大核/小核数量、CPU mask、显式 `thread_num`、affinity 是否回退；APK `mnnLlmStatus` 同步返回相同状态。

## 兼容性与安全

- 旧显示端不声明 `llm` 时保持现有媒体、语音和任务行为，不加入 LLM 分流池。
- 旧服务器不认识 `llm.*` 消息时，APK 只显示 LLM 不可用，不影响显示页面。
- 模型下载只接受清单内 modelId 和文件名，使用 staging、SHA-256 和原子目录切换。
- 请求中的 `displayId` 只能匹配当前已连接的显示端 ID，不能作为文件路径或任意网络地址使用。
- 网关不接受客户端传入任意上游 URL，所有推理目标只能来自当前 AASC 显示端注册表。
- LLM 图片只接受受限 data URL；服务端限制图片类型、数量和请求体大小，APK 解码后限制像素尺寸并及时释放临时 Bitmap/VARP。
- `enable_thinking=false` 只影响当前请求，不改变模型默认配置、其他请求或 ASR/TTS。
- APK 内 MNN native 库缺失时，能力上报 `llm=false` 并保留媒体/ASR/TTS 能力。

## 验收标准

1. APK 构建包含 arm64 MNN-LLM native 库，native 缺失时构建失败。
2. 无默认模型时，APK 状态为 `no_model`，`/v1` 请求缺少模型返回 `400`。
3. 控制端选择模型后，APK 只下载该模型；下载、hash 校验、加载和能力状态可观察。
4. 切换模型时当前推理不被中断；新模型失败时旧模型继续可用。
5. 两个 APK 加载同一模型时，模型请求按最短队列分流。
6. 指定 `displayId` 时只调用目标 APK；目标不可用时不改派。
7. `/v1/chat/completions` 和 `/v1/responses` 的 JSON、SSE、错误响应符合协议约定。
8. 两个协议携带 `enable_thinking=false` 时不返回思考内容，未指定时保持兼容行为。
9. Chat Completions `image_url` 和 Responses `input_image` 均能在 Qwen3.5 真机显示端触发视觉推理；图片无效或视觉加载失败时返回结构化错误且不改派文本请求。
10. `/v1/models` 能返回模型目录、已选择显示端和 ready 显示端。
11. 控制端和 APK 内控制页都能选择模型并显示状态，设备列表标注 LLM 能力。
12. LLM 默认使用 2 个大核、0 个小核；修改 LLM 核心配置不会改变 ASR/TTS 配置或线程池。
13. 旧显示端、无 MNN 库 APK、服务器无模型文件时，原有媒体和语音功能不受影响。

## 影响模块

| 模块 | 影响 |
|------|------|
| Android APK | MNN native 构建、JNI 引擎、模型管理、NativeBridge、能力上报 |
| 主服务器 | 模型清单/下载、LLM WebSocket 路由、分流器、OpenAI 网关、LLM CPU 配置广播 |
| 任务引擎 | `llm-server` 内置常驻任务和 Widget |
| 显示端前端 | LLM 请求转发、Native 回调、模型状态同步、LLM CPU 配置消费 |
| 控制端前端 | 模型选择、能力标签、分流状态、LLM 大小核配置 |
| 文档与测试 | design/spec/task、协议和路由回归测试 |

## 实施计划状态

- 2026-09-12 已完成服务端 LLM manifest/router/gateway、`/v1` 协议、显示端 WebSocket 状态和请求转发、APK 单模型管理、官方 MNN JNI 接入、控制端模型选择和独立 LLM CPU 配置。
- 2026-09-13 已完成 `enable_thinking=false` 和 Chat Completions/Responses 图片理解：服务端校验 data URL，APK 生成临时 PNG，JNI 使用 MNN `MultimodalPrompt`，并清理请求级图片资源。
- 已新增 `npm run prepare:mnnllm-android`；该脚本要求固定 `AASC_MNN_ROOT` 和 `AASC_MNN_REVISION`，`build:apk` 会先准备官方依赖，CMake 缺少官方产物时直接失败。
- Android Gradle 配置已按 AGP 9 的 DSL 分层：`CMakeLists.txt` 路径保留在模块级 `externalNativeBuild`，`-DAASC_MNN_ROOT` 放入 `defaultConfig.externalNativeBuild.cmake.arguments`。
- 已通过 Node 定向测试 13/13（本次协议边界测试）；使用官方 MNN 3.6.1 提交 `d407447ed56c4121a11ccbd266dc184ca1ead0c2`、Android NDK 28.2.13676358 完成 `npm run build:apk`，安装到 `192.168.1.6:5555` 并以 `npm run start:apk:display` 无参数启动。Chat/Responses 文本和图片协议已用 Qwen3.5 真机验证；长稳压测仍属于后续可选项。
## 任务实例入口

本地 LLM 网关作为 `llm-server` 内置服务任务，创建实例必须复用任务引擎已有的实例配置、目标设备选择、提交、运行、停止和恢复流程。控制端不得为 LLM 网关增加单独的创建入口或固定服务端目标。

```text
点击“创建实例”
  -> 打开通用内置任务配置页
  -> 用户选择 target=server/display/subdisplay 和对应 displayId
  -> task:submit 创建 draft 实例
  -> task:run 或现有服务启动流程运行 llm-server
  -> 任务引擎按 target + displayId 管理实例生命周期
```

不同运行设备的实例必须沿用任务引擎现有的服务作用域隔离规则；LLM 网关本身只提供任务上下文需要的网关服务，不读取或绕过通用任务目标字段。
## 外部模型名映射

主服务器允许 OpenAI 兼容客户端使用外部模型名，服务端在请求进入路由前解析为模型清单中的内部 `modelId`。模型别名只影响网关请求入口，APK、显示端状态和模型下载始终使用内部 `modelId`。

```text
externalModelName -> manifest.aliases -> internal modelId
```

同一别名不得映射到多个模型；`/v1/models` 返回内部模型 ID，并在 metadata 中附带 aliases。兼容 Responses 的标准 `/v1/responses` 和历史客户端使用的 `/v1/chat/responses` 都走同一解析和路由流程。
## LLM 能力关闭时的内存释放

控制端关闭显示端的 `capabilities.llm.enabled` 后，显示端只释放 MNN-LLM native engine 和模型运行时内存，保留已下载的模型文件与选中模型状态。当前推理完成后才执行释放；重新开启时优先从本地缓存重新加载，不重复下载。该流程不改变 ASR/TTS 引擎和 CPU 配置。

## 流式网关连接生命周期

OpenAI 兼容网关的流式请求在请求体解析完成后仍保持 HTTP 响应连接，直到推理完成、取消或客户端主动关闭响应。断开检测必须绑定响应对象的 `close` 事件，不能把请求体对象的 `close` 事件当作客户端断开；请求对象在 body-parser 完成请求体读取后可能进入关闭状态，但这不代表 SSE 响应已断开。

流式错误必须以 SSE `event: error` 搭配 `data` JSON 返回；命令行客户端至少显示错误 `code` 和 `message`，不能静默结束。

## 客户端断开后的原生取消

HTTP 客户端主动关闭流式响应后，服务端向目标显示端发送 `llm.cancel`。显示端必须按 `requestId` 标记排队或执行中的请求已取消；如果请求尚未进入 native 推理，不得在之后启动；如果已经进入 MNN-LLM 推理，JNI 取消标志必须使官方回调在下一个 token 边界返回停止信号。

取消请求不得影响其他请求、模型切换或 ASR/TTS。取消后的显示端不得发送 `llm.completed`，服务端释放对应路由计数；native 当前 token 计算完成后再安全退出，不强制释放仍在使用的 MNN session。

## 流式请求超时

本地 LLM 网关的 `llm.requestTimeoutMs` 定义为“无响应活动超时”，默认 120 秒。它用于保护模型加载、prefill 或推理卡死场景，不是固定的请求总时长。每收到目标显示端的 `llm.chunk` 都重置计时器，因此持续生成的长回答不会因为总时长超过 120 秒而被截断。

如果在超时时间内没有收到任何 chunk，网关必须通过统一的 `cancel(requestId)` 发送 `llm.cancel`，再拒绝 HTTP 请求并释放路由；不能只释放服务端 pending 状态而让 APK 继续生成。超时取消与客户端主动断开使用相同的 requestId 隔离和原生取消链路。
