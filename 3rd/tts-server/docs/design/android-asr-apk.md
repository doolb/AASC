# 独立 Android 离线语音识别 APK 设计

## 需求

在 `3rd/tts-server/android-asr/` 新增独立 Android APK，内置 SenseVoice int8 模型，提供录音、选择音频、识别文本、识别耗时和自动/大核/小核 CPU 模式选择，并内置 HTTP 服务供外部测试。

## 方案

- 复制独立 Gradle 工程，不修改现有显示端业务流程。
- 构建阶段从 `res/models/sensevoice` 复制 `model.int8.onnx` 与 `tokens.txt` 到 assets。
- 使用 sherpa-onnx OfflineRecognizer，统一把输入转换为 16kHz 单声道 Float32。
- 录音使用 Android `AudioRecord`；文件输入使用 WAV 解析和 Android 媒体解码器。
- HTTP 服务绑定 `0.0.0.0:18080`，通过同一串行 ASR 管线识别。
- CPU affinity 使用独立 APK 内的 JNI 库，无法绑定时自动回退。

## 边界

APK 默认不自动启动 HTTP 服务；用户显式启动后才接受局域网请求。服务不提供鉴权，只用于受信任局域网测试，单次音频最长 60 秒。
