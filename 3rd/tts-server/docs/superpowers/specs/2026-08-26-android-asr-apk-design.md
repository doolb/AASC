# 独立 Android 离线语音识别 APK 设计

## 目标

新增 `3rd/tts-server/android-asr/` 独立 Android 应用，内置 SenseVoice int8 模型，提供录音、音频文件选择、离线识别、耗时显示、CPU 核心模式选择，以及用于外部测试的 HTTP 服务。

## 范围

- APK 不依赖服务器即可完成模型加载和识别。
- 模型由 `res/models/sensevoice/model.int8.onnx` 和 `tokens.txt` 在构建时复制到 APK assets。
- 使用现有 `sherpa-onnx-1.12.35.aar` 的 `OfflineRecognizer`，输入统一转换为 16kHz 单声道 Float32 样本。
- 界面识别和 HTTP 识别共用同一个串行识别管线。
- 复用已验证的 CPU affinity 规则，支持自动、大核、小核，失败时回退系统调度。

## 交互设计

1. 启动后复制并加载内置模型，状态区显示模型状态和 CPU 模式实际结果。
2. “录音”按钮在开始和停止之间切换；录音使用 `AudioRecord` 采集 16kHz、单声道、16-bit PCM，并保存为临时 WAV。
3. “选择音频”使用系统文件选择器；WAV/PCM 直接读取，MP3/M4A 等 Android 支持的媒体由 `MediaExtractor`/`MediaCodec` 解码后重采样到识别格式。
4. “识别”按钮将当前录音或选中文件送入串行 ASR executor，完成后显示识别文本和识别阶段耗时。
5. CPU 模式使用 Spinner 选择并持久化；每次模型加载和识别前应用一次 affinity。

## HTTP 契约

- 服务绑定 `0.0.0.0`，默认端口 `18080`，端口可编辑。
- `GET /health` 返回模型状态、服务状态和当前 CPU 模式。
- `POST /api/asr` 接收请求体音频；支持 `audio/wav` 和 `application/octet-stream`。
- WAV 支持常见 PCM 格式，服务端转换为 16kHz 单声道 Float32；原始 PCM 按 16kHz、单声道、16-bit little-endian 解释。
- 成功返回 `{ "success": true, "text": "...", "elapsedMs": 1234 }`。
- 失败返回 `{ "success": false, "error": "...", "elapsedMs": 0 }` 和对应 HTTP 状态码。
- 同时只执行一个识别任务；忙时返回 `409`，请求体限制为 60 秒以内音频。
- 服务默认关闭，由用户在界面显式启动；界面显示局域网访问地址。

## 错误处理和安全边界

- 麦克风权限拒绝时不启动录音，并显示可操作错误。
- 模型缺失、损坏或加载失败时禁止识别和 HTTP 任务。
- 音频格式不支持、采样率异常、空音频和超长音频均返回明确错误。
- HTTP 服务仅用于局域网测试，不提供鉴权；服务关闭后立即释放监听 socket。
- native 库不可用或 CPU 核心无法识别时保持识别可用，并显示自动回退原因。

## 验收标准

- APK 独立构建，包含 SenseVoice 模型和 `arm64-v8a` native 库，不依赖运行时下载。
- 真机可录音、选择音频、识别并显示文本和毫秒耗时。
- 至少验证 WAV 文件、原始 PCM 请求和模型未就绪错误。
- `/health` 与 `/api/asr` 可被局域网客户端调用，识别结果与界面调用共用模型。
- Android JVM 单元测试、HTTP 协议测试、APK 构建和安装验证通过。
