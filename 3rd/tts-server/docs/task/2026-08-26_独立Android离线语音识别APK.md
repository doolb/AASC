# 独立 Android 离线语音识别 APK

## 任务描述

新增独立 Android ASR APK，内置 SenseVoice int8 模型，支持录音、选择音频、离线识别、识别文本、识别耗时、自动/大核/小核选择，并提供局域网 HTTP 服务供外部测试。

## design 需求

- 新增 `3rd/tts-server/android-asr/` 独立工程。
- 内置 `res/models/sensevoice/model.int8.onnx` 与 `tokens.txt`。
- 统一输入为 16kHz 单声道 Float32，支持录音和文件输入。
- HTTP 提供 `/health` 和 `/api/asr`，默认 `0.0.0.0:18080`，单请求串行，最长 60 秒。
- CPU 模式支持自动、大核、小核，native 失败自动回退。

## spec 设计

- `AsrEngine` 负责模型加载和一次性识别。
- `AudioInput` 负责录音、WAV/PCM 解析、Android 媒体解码和重采样。
- `AsrHttpServer` 负责 HTTP 请求解析、状态接口和 JSON 响应。
- `CpuAffinity` 负责线程核心绑定和回退文案。

## 受影响功能模块和代码

- 新增 Android ASR 工程、Kotlin UI、JNI C++ affinity、测试。
- 新增根目录及 `3rd/tts-server` 的 design/spec 索引和变更记录。
- 不修改现有 Android 显示端 ASR/TTS 运行流程。

## 自测用例

- 模型文件完整时成功加载，缺失时进入 error 状态。
- 录音开始/停止、权限拒绝、空音频和超长音频均有明确状态。
- WAV、16kHz 原始 PCM 能正确识别；常见媒体文件可解码后识别。
- `/health` 返回 ready 状态；`/api/asr` 成功返回 text 和 elapsedMs。
- 并发 HTTP 请求返回 409，不破坏当前识别。
- 自动/大核/小核模式持久化，绑定失败自动回退。

## 兼容性测试

- Android 8.0/API 26 及以上、arm64-v8a。
- 真实设备录音、文件选择和局域网客户端请求。

## 性能测试

- 记录模型首次加载耗时，但识别耗时只统计 `OfflineRecognizer.decode` 阶段。
- 验证 60 秒以内音频在单并发条件下可完成识别。

## 风险评估

- 模型约 234MB，APK 体积和安装时间增加。
- 低内存设备可能加载失败，需要在 UI 和 HTTP 中明确提示。
- Android 媒体解码器能力因设备而异，WAV/PCM 作为稳定基线。
- HTTP 无鉴权，只允许在受信任局域网中启用。

## 预计工时

- 工程和模型打包：0.5 天
- 录音、文件解码、识别 UI：1 天
- HTTP 服务和测试：0.5 天
- 构建、真机和文档验证：0.5 天

## 执行结果

- ✅ 已完成：新增 `android-asr/` 独立工程，内置 SenseVoice int8 模型，支持录音、音频选择、识别文本和耗时显示。
- ✅ 已完成：新增自动/大核/小核 CPU affinity 选择，native 绑定失败时自动回退。
- ✅ 已完成：新增 `GET /health`、`POST /api/asr` HTTP 服务，默认端口 `18080`，单识别串行。
- ✅ 验证：Android JVM 单测通过，静态验收 3/3 通过，debug APK 构建成功，APK 包含模型和 `arm64-v8a` native 库，adb 安装成功。
