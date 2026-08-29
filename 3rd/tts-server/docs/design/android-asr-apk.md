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
