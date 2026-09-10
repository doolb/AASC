# 独立 Android 离线语音识别 APK 设计

## 需求

在 `3rd/tts-server/android-asr/` 新增独立 Android APK，内置 SenseVoice int8 模型，提供录音、选择音频、识别文本、识别耗时和自动/大核/小核 CPU 模式选择，并内置 HTTP 服务供外部测试。

## 方案

- 复制独立 Gradle 工程，不修改现有显示端业务流程。
- 构建阶段从 `res/models/sensevoice` 复制 `model.int8.onnx` 与 `tokens.txt` 到 assets。
- 使用 sherpa-onnx OfflineRecognizer，统一把输入转换为 16kHz 单声道 Float32。
- 录音使用 Android `AudioRecord`；文件输入使用 WAV 解析和 Android 媒体解码器。
- HTTP 服务绑定 `0.0.0.0:18080`，根路径提供内置普通网页，网页支持选择 WAV 和浏览器录音，并通过同一串行 ASR 管线识别；同时保留页面内部使用的 `/api/asr` 和状态接口。
- CPU affinity 使用独立 APK 内的 JNI 库，无法绑定时自动回退。
- 当前音频支持保存为 WAV：Android 10 及以上写入系统下载目录，旧系统写入 APK 专属外部音频目录；网页通过浏览器下载当前 WAV。
- 普通非流式 ASR 和声纹测试网页固定使用中文 `zh`，不再显示语言选择；流式 Zipformer 继续使用固定中英双语模型。
- 不再提供“过滤其他文字”开关或 `zh-en-filter` 模式；普通 ASR 结果不删除日文、韩文等字符，只保留模型原始文本的首尾清理。

## 边界

APK 默认不自动启动 HTTP 服务；用户显式启动后才接受局域网请求。访问根路径即可打开普通网页，选择 WAV 或使用浏览器录音，并在浏览器中显示识别文本和耗时。浏览器录音遵循安全上下文权限限制；服务不提供鉴权，只用于受信任局域网测试，单次音频最长 60 秒。
Android 原生界面在已有录音或选择音频后启用“保存当前 WAV”，保存内容统一为 16kHz、单声道、16-bit PCM WAV。

## 2026-09-09 真机部署验收

- 使用项目已有 `npm --prefix 3rd/tts-server run build:android-asr` 重新构建 Debug APK，构建成功。
- 通过 ADB 设备 `192.168.1.6:5555`（`SM-N9500`）覆盖安装 `com.aasc.asr`，安装后版本为 `0.1.0`。
- 已授予 `RECORD_AUDIO` 权限并启动 `com.aasc.asr/.MainActivity`；进程保持运行且 Activity 位于前台。
- 启动日志显示 Sherpa 声纹分割和 GTCRN 降噪模型初始化，无 `FATAL EXCEPTION` 或 `AndroidRuntime` 崩溃记录。

## 2026-09-10 声纹匹配分数与阈值可观测性

### 需求

在不替换声纹模型、不改变单段/多段识别流程和既有命中判定的前提下，公开每次声纹匹配使用的阈值和相似度分数。命中时返回命中说话人的分数；未命中时仍返回注册声纹中最高分，帮助区分“没有注册声纹”和“分数低于阈值”。

### 方案

- 保留 `SpeakerEmbeddingManager.search(embedding, threshold)` 作为唯一的命中/未命中判定来源。
- 在引擎内保存当前注册 embedding，仅使用余弦相似度计算观测分数，不用该计算结果替换原有 `search` 判定。
- 单段结果增加顶层 `similarityScore` 和 `threshold`。
- 多段结果增加顶层 `threshold`，每个 segment 增加 `similarityScore`。
- 声纹状态接口增加当前 `threshold`，便于测试端确认运行配置。
- 当声纹库为空或无法计算分数时，分数返回 `null`；低于阈值时说话人仍为 `null`，但保留最高相似度分数。

### 边界

本次不调整阈值默认值、不替换模型、不修改聚类、不增加单人/多人自动判断，也不改变现有 `matchedSpeaker` 和 `speaker` 字段的语义。

## 2026-09-10 声纹分段后处理优化

### 需求

修复单人 WAV 被分成相邻短片段后，短片段声纹向量不稳定、相似度略低于阈值而被判定为未知，并导致同一句话被重复 ASR 的问题。保留当前声纹模型、相似度算法和阈值含义，同时兼容真实多人场景。

### 方案

- 保留 Pyannote 原始分段和 Sherpa 聚类作为候选边界来源。
- 在候选分段上执行注册声纹匹配，使用注册说话人结果作为后处理依据，不只依赖 `clusterId`。
- 对相邻的短片段进行保护性合并：短片段低于最小稳定声纹时长且未匹配注册说话人时，尝试与相邻已知说话人片段合并，并重新提取合并音频的声纹。
- 只有合并后的声纹仍命中同一注册说话人时才确认合并；相邻两侧为不同已知说话人时保留原始边界。
- 对确认合并后的区间只执行一次 ASR，避免同一语音被重复拼接。
- `SHERPA_MULTI_FAST` 继续使用最长片段优化，但最终短片段处理遵循同一注册说话人合并规则。
- `SHERPA_MULTI` 支持传递已知 `speakerCount`，其中 `speakerCount=1` 可用于已知单人音频。

### 边界和风险

- 不更换 `ERes2Net-base`，不改变 `embeddingDim`、余弦相似度和默认匹配阈值 `0.5`。
- 短片段合并只在时长和相邻说话人条件满足、且合并后重新匹配成功时生效，避免把快速换人的片段强行归入前一个人。
- 合并会增加少量声纹提取耗时；多人重叠或极短的真实换人语音仍可能需要更长录音验证。

### 验证结果

- Android JVM 全量单元测试通过，包含短未知片段合并、合并失败保留原段、不同说话人不误合并和相邻同人片段合并用例。
- 使用 `npm --prefix 3rd/tts-server run build:android-asr` 构建 Debug APK 成功，APK 已覆盖安装到 `SM-N9500`（`192.168.1.6:5555`）。
- 使用 `res/models/sensevoice/zh.wav` 注册 `z` 后，`SHERPA_MULTI` 返回一个分段：`0.7059688-5.110344`，`speaker=z`，`similarityScore=0.9773119`，文本只识别一次。
- 使用同一 WAV 调用 `SHERPA_MULTI_FAST&speakerCount=1` 返回相同的一个分段和分数 `0.9773119`。
- 真机进程保持运行，启动和测试日志未发现 `FATAL EXCEPTION`、`AndroidRuntime` 或 `OutOfMemory`。

## 2026-09-10 ASR 文字与声纹双降噪开关

### 需求

将当前共用的降噪开关拆分为“ASR 文字降噪”和“声纹降噪”，允许分别比较降噪对识别文字和声纹匹配的影响。

### 方案

- ASR 文字降噪只作用于普通 `/api/asr` 和声纹测试返回的 `text`。
- 声纹降噪作用于声纹注册、Pyannote 分段、声纹 embedding 提取和注册声纹匹配。
- 声纹测试同时准备两份音频；分段边界和声纹匹配使用声纹音频，ASR 使用文字音频，时间轴保持一致。
- 声纹注册接口只接受声纹降噪设置；注册和测试时声纹降噪开关应保持一致。
- 新接口参数使用 `asrDenoise` 和 `voiceprintDenoise`；旧 `denoise` 参数继续保留并同时控制两条链路。
- 返回结果增加两类降噪状态和耗时；旧 `denoise`、`denoiseMs` 字段保留为兼容字段，其中声纹测试继续反映声纹链路。

### 边界和风险

- 两个开关都关闭时保持原始音频流程。
- 两个开关同时打开时尽量复用同一份降噪结果，避免重复执行 GTCRN。
- 只有一个开关打开时会执行一次降噪；两个开关分别打开时最多执行两次降噪，耗时和内存会增加。
- ASR 和声纹使用的音频必须保持相同采样率、采样数和时间轴，避免分段时间错位。

### 验证结果

- Android JVM 全量单元测试通过，共 52 个测试。
- 使用 `npm --prefix 3rd/tts-server run build:android-asr` 构建 Debug APK 成功。
- APK 已覆盖安装到 `SM-N9500`（`192.168.1.6:5555`）并启动 HTTPS 服务；进程和 `MainActivity` 保持前台，测试后日志未发现 `FATAL EXCEPTION`、`AndroidRuntime` 或 `OutOfMemory`。
- 使用 `res/models/sensevoice/zh.wav`（16 kHz、单声道、约 5.6 秒）注册 `z` 后，普通 ASR 的 `asrDenoise=1` 返回 `denoise=true`、`denoiseMs=959`；关闭时返回 `denoise=false`、`denoiseMs=0`。
- 声纹单段使用 `asrDenoise=1&voiceprintDenoise=0` 命中 `z`，`similarityScore=1.0`、`threshold=0.5`，返回 `asrDenoiseMs=955`、`voiceprintDenoiseMs=0`；快速多段同样只对文字降噪，并返回一个 `z` 分段。
- 两个开关同时打开时返回 `asrDenoiseMs=941` 和 `voiceprintDenoiseMs=941`，证明同一请求复用一次降噪结果；旧 `denoise=1` 请求同时打开两条链路并保持兼容。
