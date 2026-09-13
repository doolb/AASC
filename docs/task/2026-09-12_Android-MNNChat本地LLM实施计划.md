# Android MNNChat 本地 LLM 实施计划

状态：用户已确认，第一阶段实现已完成；官方 MNN 3.6.1 native 与 arm64-v8a Debug APK 已构建，等待真实设备与实际模型验收。

## 1. 任务描述

继续实现 AASC 的 Android MNNChat 本地 LLM 功能。主服务器提供 OpenAI 兼容的 `/v1/chat/completions`、`/v1/responses`、`/v1/models`，使用 WebSocket 将请求路由到具备目标模型的 Android 显示端；APK 使用阿里官方 MNN-LLM Android 引擎完成本地推理。

每个 APK 只保存一个当前选中模型，不设置默认模型，只下载当前选中模型。模型切换等待当前推理完成；目标 APK 不可用时不改派、不回退主服务器。控制端和 APK 控制页面均可选择模型，设备列表标注 LLM 能力。LLM 独立使用 CPU 配置，默认大核 2、小核 0、优先大核，不影响 ASR/TTS。

## 2. 工作区基线

- 工作区：`/mnt/AASC`，当前分支为 `master`；Windows 共享盘 `Z:\AASC` 与 SSH 目录内容一致。
- 已确认设计提交：`5c0bb354 docs: design android mnnchat llm routing`、`9d64e69c docs: define mnnchat cpu affinity`。
- 已检查并更新 `package.json`：新增 `prepare:mnnllm-android`，并由 `build:apk` 调用；Android Node Runtime 准备和 APK 上传脚本保持兼容。
- 现有工作区包含用户未提交改动和未跟踪文件。本任务只在相关文档上增量修改，不重置、覆盖或清理其他改动。
- 现有可复用入口：`server-app.js` 的 WebSocket/HTTP/任务装配，`config-app-service.js` 的远端 CPU 配置，模型分发服务，`NativeBridge.kt`、`RemoteModelManager.kt`、`ModelDownloader.kt`、`CpuCluster.kt`、`CpuAffinity.kt`，以及控制端设备列表和 CPU 配置组件。

## 3. 需求等级与风险判定

采用 `analyze-requirement-level` 的 enterprise 模式评估：

| 维度 | 判定 | 依据 |
|------|------|------|
| 主需求等级 | L7 系统级能力 | 同时跨主服务器、WebSocket、Android native、模型分发、协议网关和两个控制 UI |
| 次级等级 | L6 架构级 + L5 工作流级 | 需要新增路由边界、模型生命周期、请求队列、状态广播和配置持久化 |
| 落地规格 | L4 伪代码契约 | 当前项目要求 `docs/spec/*.md` 用伪代码同步实现边界，先冻结数据结构和消息流程 |
| 综合评分 | 89/100 | 设计与验收项明确；原生 API、模型格式、设备性能和真机环境仍有实施风险 |
| 置信度 | 0.86 | 需求来自已确认设计和两个相关提交，现有代码锚点已完成检查；官方 MNN revision/JNI 细节需在实施阶段锁定 |
| 结论 | 可进入实施，但先确认计划 | 不确定项不会改变已确认的产品边界，只影响 native 适配方式和具体文件落点 |

已核实的关键证据包括：

1. 设计文档已明确官方 MNN-LLM Android 引擎、`arm64-v8a`、模型清单、状态机、WebSocket 事件和 OpenAI 三个接口。
2. CPU affinity 设计已明确 `llm` 独立于 ASR/TTS，默认大核 2、小核 0、优先大核。
3. 当前服务端已有显示端能力登记、`cpuConfig` 广播、模型清单服务和内置任务注册点，可作为增量接入位置。
4. 当前 Android 工程已存在模型下载/原子切换和 CPU affinity 基础能力，但 CMake 仍只有 affinity JNI，尚未接入 MNN。
5. `package.json` 已有 Android 构建脚本，因此 native 准备应接入现有 `npm run` 工作流而不是另建无关入口。

主要风险：

- 官方 MNN 上游 revision 的 JNI/API 类名、模型导出目录和所需运行库必须以锁定源码和真实构建结果为准。
- MNN native 首次构建、16 KB page-size、Android API 26 和 APK 产物大小需要真实设备验证。
- 服务端是较大的单体 `server-app.js`，路由计数、断线、迟到事件和模型切换的并发边界必须用契约测试固定。
- 模型切换期间可能同时占用 active、staging 和 backup 空间，必须在下载前检查磁盘容量。

## 4. 设计需求与实现规格

已确认的产品设计继续以 `docs/design/android-mnnchat-llm.md` 为准，实现伪代码和协议契约以 `docs/spec/android-mnnchat-llm.md` 为准，主要包括：

- `modelId -> displayIds` 多显示端映射，自动请求按 `activeRequests + queueDepth` 最短队列选择，显式 `X-AASC-Display-Id` 不改派。
- APK 初始无模型；选择模型后只下载该模型，下载、SHA-256、加载成功后原子切换；切换等待 `inferenceCount == 0`，失败保留旧模型。
- 显示端上报 `llm` capability 和 `llm.status`；服务端维护 ready、选中模型、活动请求和队列状态并同步到控制端。
- `chat.completions` 和 `responses` 都支持非流式/流式转换；`models` 返回模型和显示端 ready/selected 元数据。
- 目标不可用返回 503，队列满返回 429，模型不匹配返回 409，缺失/未知模型返回 400；不使用外部 LLM 或主服务器回退。
- 复用现有远端配置流程扩展 `cpuConfig.llm`，默认 `{ big: 2, little: 0, preferBig: true }`，LLM 线程与 ASR/TTS 线程池隔离。

## 5. 分阶段实施计划

### 阶段 0：固定上游与构建基线

1. 固定阿里官方 MNN 源码 revision，确认官方 `MnnLlmChat` Android 入口、模型格式、JNI 接口和 arm64 依赖。
2. 新增/调整 `npm run` native prepare 脚本，记录 revision、编译参数、ABI、Android API、16 KB linker 参数和产物 SHA-256。
3. 先完成 MNN native 最小构建与 APK 链接检查，再进入 Java/Kotlin 业务桥接，避免基于未验证 API 编写业务代码。

### 阶段 1：服务端模型目录与分发

1. 新增 LLM 模型清单服务或为现有模型服务增加隔离的 `llm` 分组，建议文件边界为 `src/apps/server/modules/llm/`。
2. 注册 `/api/llm/model-manifest` 和 `/api/llm/model/:modelId/:filename`，复用安全流式下载、大小、SHA-256、basename 白名单和路径逃逸检查。
3. 在 `res/models/llm/<modelId>/` 约定资源目录和清单格式；不提交大模型二进制，仅提交必要的示例/测试元数据。

### 阶段 2：显示端状态、WebSocket 和路由

1. 在 `server-app.js` 接入 capability、`llm.status`、模型选择确认和 `llm.request`/chunk/completed/error 消息。
2. 新增 LLM 路由器，维护显示端在线状态、模型匹配、`activeRequests`、`queueDepth`、并发上限、超时和断线释放。
3. 在 `src/apps/server/modules/llm/llm-gateway-service.js` 实现协议转换，不调用现有外部 LLM profile；将 `llm-server` 注册为内置常驻服务任务。
4. 严格实现显式目标不改派、无目标不回退、唯一终态和迟到事件丢弃。

### 阶段 3：Android 模型管理和 MNN 推理

1. 新增 `MnnLlmModelManager.kt`，复用 `ModelDownloader.kt` 的安全下载能力，实现 active/staging/backup、单模型状态、校验、加载、原子切换、回滚和 latest-selection-wins。
2. 新增 `MnnLlmEngine.kt` 与对应 JNI/C++ bridge，隔离 MNN executor、模型生命周期和推理回调。
3. 扩展 `NativeBridge.kt` 和 `CMakeLists.txt`，向 WebView 提供异步 JSON 接口；每次推理都保证 chunk/completed/error 唯一终态并释放计数。
4. 构建阶段缺少官方 native 库时直接失败；运行阶段没有选中模型或模型加载失败时只报告 LLM 不可用，不影响已有媒体、ASR、TTS。

### 阶段 4：独立 CPU 配置

1. 扩展 `config-app-service.js` 的 `cpuAffinity` 默认值、规范化和权威 `cpuConfig` 消息，保持 ASR/TTS 字段和旧客户端兼容。
2. 服务端通过现有 `/api/config/cpuAffinity` 与 WebSocket `config.set` 流程保存/广播 `llm` 字段，不增加同职责的新 HTTP 配置接口。
3. APK 通过 `CpuCluster.policy` 计算 LLM mask，在 MNN load/inference worker 上应用 affinity；LLM 更新不重建 ASR/TTS pool。
4. 在控制端 `upload.html`/`tts.js` 和 APK `display.html` 增加 LLM CPU 配置、实际 mask、回退状态和默认值显示。

### 阶段 5：控制页面与验收可观测性

1. 扩展 `device-list.js`、`websocket.js` 显示 LLM capability、模型、ready、切换中、错误、活动数和队列数。
2. 控制端和 APK 控制页增加模型选择器；控制端模型选择器位于设备列表下方的单个当前显示端卡片，选择消息带目标 `displayId` 和 requestId，状态以服务端/目标端权威回报为准。
3. 增加结构化日志和指标：选择目标、入队、首 token、完成、失败、切换耗时、模型 hash、断线释放和 CPU mask。

### 阶段 6：分层测试与真机验证

1. 先运行现有 `npm test`，补充服务端单元/契约测试和前端消息契约测试。
2. 运行 Android JVM 单测、native prepare、Gradle `testDebugUnitTest` 和 `assembleDebug`，确认 arm64 与 16 KB 产物。
3. 使用两个真实 APK 加载同一模型验证最短队列、流式输出、显式目标、目标不可用、切换等待和断线。
4. 使用不同模型验证不跨模型路由；确认无模型/无 native/无服务端资源时原有媒体、ASR、TTS 仍可用。

## 6. 受影响文件与新增文件预案

以下是计划边界，不代表已修改：

| 区域 | 文件预案 | 变更内容 |
|------|----------|----------|
| 文档 | `docs/design/android-mnnchat-llm.md`、`docs/spec/android-mnnchat-llm.md`、本任务文档、`docs/spec.md`、`docs/todo.md`、`changelog.md` | 设计、伪代码、任务、索引、待办和变更记录 |
| 服务端 | `src/apps/server/boot/server-app.js`、`src/apps/server/modules/config/config-app-service.js` | 装配 HTTP/WS、状态广播和 LLM CPU 配置 |
| 服务端新增 | `src/apps/server/modules/llm/llm-model-manifest-service.js`、`llm-router.js`、`llm-gateway-service.js` | 清单分发、分流队列、OpenAI 网关 |
| 任务 | `src/apps/server/modules/task-engine/builtin-tasks/registry.js` 及 LLM service/task 文件 | `llm-server` 常驻服务生命周期 |
| Android | `MnnLlmModelManager.kt`、`MnnLlmEngine.kt`、`NativeBridge.kt`、`CMakeLists.txt`、JNI C++ 文件 | 单模型管理、MNN native、异步推理、CPU affinity |
| 前端 | `display.html`、`device-list.js`、`websocket.js`、`upload.html`、`tts.js` | 能力、模型选择、状态和独立 CPU 配置 |
| 测试 | `tests/*llm*.test.js`、Android JVM/native 契约测试 | 路由、协议、模型状态、CPU 隔离和兼容性 |

实际新增文件已按官方 API 和现有代码依赖复核落地；模型分发复用既有下载/hash/原子安装契约，LLM 路由和协议保持独立。

## 7. 实施结果

- 服务端：新增 `llm-model-manifest-service.js`、`llm-router.js`、`llm-gateway-service.js` 和 `llm-server.js`，装配模型下载、状态路由、队列计数、OpenAI 兼容响应和断线释放。
- Android：新增 `MnnLlmModelManager.kt`、`MnnLlmEngine.kt`、`aasc_mnn_jni.cpp`；扩展 `NativeBridge.kt`、`RemoteModelManager.kt` 和 CMake，模型选择等待当前推理结束且不自动回退。
- 页面：扩展 `display.html`、`device-list.js`、`websocket.js`、`upload.html`、`tts.js` 和 `upload.css`，支持 LLM 能力/模型/状态和独立 CPU 配置；控制端模型选择只在设备列表下方的当前显示端卡片中出现。
- 模型资源：新增 `res/models/llm/README.md`，不提交大模型二进制；部署时在该目录提供带实际 size/SHA-256 的 `manifest.json`。
- 自测：`tests/llm-local-routing.test.js`、`tests/apk-cpu-affinity-config.test.js`、`tests/apk-cpu-affinity-display.test.js` 共 17/17 通过；相关 JS 语法检查通过。
- 构建结果：设置 `AASC_MNN_ROOT=/mnt/AASC/build/third_party/MNN`、`AASC_MNN_REVISION=d407447ed56c4121a11ccbd266dc184ca1ead0c2` 和 `ANDROID_NDK_HOME=/opt/android-sdk/ndk/28.2.13676358` 后，官方 MNN 3.6.1 native 编译/安装成功，`npm run build:apk` 成功生成 `src/apps/android-display/app/build/outputs/apk/debug/app-debug.apk`。最新 APK 大小为 109372747 bytes，SHA-256 为 `4d26488f79b2f5e0f69f75d43471095202ad5af3bd19a1db4c38b2caa3968b21`；MNN 与 bridge ELF 的 LOAD 对齐均为 `0x4000`，并已通过 `npm run upload:apk` 安装到 ADB 真机。

## 8. 自测、兼容性和性能测试

### 自测用例

- 清单只接受启用的 `modelId`、精确文件名和正确 hash；未知文件、路径逃逸和 hash 错误均拒绝。
- APK 无默认模型时状态为 `no_model`；只选择模型 A 时不下载 B；重复选择只保留最新请求。
- 推理期间切换模型必须等待旧推理完成；下载/加载失败时旧模型继续可用，且不发送主服务器回退请求。
- 两个显示端同模型时按 `activeRequests + queueDepth` 分配；显式目标不可用返回 503 且不改派。
- `/v1/chat/completions`、`/v1/responses` 的 stream/non-stream、`[DONE]`、错误 code 和 requestId 符合规格；`/v1/models` 元数据完整。
- `cpuConfig.llm` 的默认值、边界值、持久化、广播和断线默认值正确；变更 LLM 不改变 ASR/TTS。

### 兼容性测试

- 旧显示端忽略新增 LLM 字段仍能播放媒体、录音、ASR 和 TTS。
- APK 缺少 MNN native、模型文件或服务端模型目录时，LLM 标记不可用且其他能力正常。
- Android API 26+、arm64-v8a、16 KB page-size 设备加载 native 库；非目标 ABI 不被误打包。
- 控制端与 APK 控制页同时操作时，最终状态以服务端广播和 APK `llm.status` 为准，不出现错误覆盖。

### 性能与容量测试

- 测量模型下载校验耗时、切换等待耗时、native 加载耗时、首 token、tokens/s、P95 排队和流式完成时间。
- 压测多个并发请求，确认队列上限生效、计数无泄漏、断线后无僵尸请求，内存不会无限增长。
- 在切换 active/staging/backup 期间验证磁盘空间保护；模型大内存加载失败时不影响 ASR/TTS。
- 检查 MNN worker 实际 CPU mask 与配置一致；LLM 压测期间确认 ASR/TTS affinity 和延迟无回归。

## 9. 预计工时

预计 4–6 个开发日（约 24–36 小时），不包含真实设备长稳压测等待时间；官方 MNN native 首次适配和模型格式确认可能额外需要 0.5–1 个开发日。阶段 0 的构建基线若无法在当前环境完成，应先停在 native 依赖问题上，不进入未验证的 Kotlin/JNI 实现。

## 10. 计划确认点

用户已确认计划；阶段 0 → 5 已完成并通过可执行的 Node 定向测试。阶段 6 的官方 MNN revision/native 构建已完成：固定提交为 `d407447ed56c4121a11ccbd266dc184ca1ead0c2`，使用 NDK 28.2.13676358，`npm run build:apk` 和 Gradle `assembleDebug` 均成功；Gradle Kotlin DSL 的 `arguments` 配置已修正。剩余工作是使用真实 APK 和实际模型执行设备验收。
