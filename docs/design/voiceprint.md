# Android 显示端原生声纹识别设计补充

## 2026-09-19 声纹模型启动预热与注册等待

### 目标

Offline APK 在显示页初始化阶段与原生 ASR 一起预热声纹模型，保证声纹注册和声纹识别共享同一个已加载的 `VoiceprintEngine`。模型正在加载时，注册请求进入显示端等待队列；模型失败或等待超时才返回错误，不要求用户重新录音。

### 生命周期约束

- Node Runtime 先完成 Offline 模型文件解包，WebView 连接服务端后才触发原生引擎加载。
- ASR、声纹 embedding、声纹分割模型分别维护 ready 状态，不使用单一模型状态互相覆盖。
- 注册只依赖声纹引擎 ready；单人识别依赖声纹引擎和声纹库；多人识别额外依赖 ASR。
- 声纹库同步完成不能单独声明声纹能力 ready。
- Offline 内置模型只校验和加载，不发起本机 HTTP 下载；在线 APK 保留原有按需下载流程。

### 请求策略

- `voiceprintConfig.enabled=true` 到达后立即启动声纹预热。
- `voiceprintExtract` 在引擎加载中等待 ready 回调，最长等待 60 秒。
- ready 后继续执行所有等待中的提取请求；error、禁用、WebSocket 断开或超时则逐个回传明确错误。
- `voiceprintMatch`、`voiceprintDiarize` 沿用识别端 ready 门控，禁止在模型未 ready 时误报声纹能力。

## 外部模型加载

APK 下载的声纹模型保存在应用私有目录，并通过绝对路径传给 sherpa-onnx。`SpeakerEmbeddingExtractor` 和 `OfflineSpeakerDiarization` 构造时必须传入空 `AssetManager`，使 AAR 走文件系统加载分支；非空 `AssetManager` 只适用于 APK assets 中的资源。

## 验证目标

1. 启用服务器声纹配置时，APK 不因外部声纹模型加载失败而退出。
2. 使用已注册声纹和同一个测试 WAV 调用 `/api/asr/recognize`，返回识别文本及匹配的说话人。
3. 多人分段识别后，先按 pyannote 的 speakerIndex 合并相邻原始 PCM 片段，再做声纹匹配和 ASR，避免短分段边界截断文本。

## 验证记录（2026-08-19）

- 声纹模型通过 `AssetManager=null` 从 APK 私有目录加载，APK 保持在线。
- 注册 `3rd/ttslive/models/sensevoice/zh.wav` 为“测试声纹”。
- 使用同一个 WAV 调用 `/api/asr/recognize`，返回文本“开饭时间早上9点至下午5点。”，speaker 为“测试声纹”。
- 将 `zh.wav` 与 `en.wav` 按轮流说话方式串接为 12.744 秒测试音频；声纹门控只返回 zh 内容，en 段被过滤。
- 将两路 WAV 从同一时间点重叠混音为 7.152 秒音频；结果为“未识别到已注册声纹”，zh/en 均未返回，当前链路不会从重叠语音中强行输出误识别文本。
- 修复原始片段合并后：`zh.wav` 返回一段完整文本；串接 `zh.wav + en.wav` 只返回一段 zh 文本“开放时间早上9点至下午5点。”，en 未注册声纹片段被过滤。

## 正式 APK 分段后处理与相似度阈值（2026-09-11）

- 正式 `android-display` APK 与独立 ASR 测试 APK 共用保护性分段后处理：先按 diarization cluster 合并，再匹配注册声纹；对短未知片段尝试与相邻已知片段合并，合并后的完整音频必须重新提取声纹并仍匹配同一人，才接受合并。
- `SHERPA_MULTI` 与 `SHERPA_MULTI_FAST` 保持现有快速路径，不更换 ERes2Net 512 维模型；最终 ASR 只对后处理后的完整区间执行一次，避免同一段单人语音被重复识别。
- 声纹配置新增可持久化的 `threshold` 设置，控制端提供 `(0,1]` 输入，默认值为 `0.3`。已有配置值不被迁移覆盖；仅缺少配置时使用 `0.3`。
- `similarityScore` 表示本次 embedding 与注册声纹的余弦相似度诊断值；`threshold` 只决定 `speaker` 是否命中。未命中时仍返回最高诊断分数，空库或分数不可计算时返回 `null`。
- 正式 APK 的单段、多段桥接结果均返回 `similarityScore` 与 `threshold`，多段每个最终分段返回对应分数；服务器只继续按 `speaker` 做声纹门控，不改变既有命令过滤语义。
