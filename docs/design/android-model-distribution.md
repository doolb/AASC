# 正式 Android 显示端统一模型分发

## 需求等级与范围

这是一次 L7 架构级变更：正式 Android 显示 APK 不再内置任何可更新的推理模型或模型字典，统一通过当前 AASC 服务器按需下载。推理仍然发生在显示端本机，服务器只提供清单、文件下载和已有的任务/WebSocket 路由。

本次覆盖正式 APK 的六类模型资源：

- SenseVoice ASR：沿用现有 `/api/asr/model/:filename` 按需下载。
- Embedded Speech TTS：沿用现有 `/api/tts/model-manifest` 和 `/api/tts/model/*` 下载。
- 声纹模型：沿用现有 `/api/voiceprint/model/*` 下载。
- RapidOCR：服务器提供四个 pipeline 文件和 SHA-256 清单。
- YOLO11：服务器按模型 ID 提供 `yolo11n/s/m/l/x` ONNX；APK 默认只请求 `yolo11n`，后续新增尺寸只需准备服务器资源和配置模型 ID。
- GTCRN 语音降噪：服务器按清单提供 `gtcrn_simple.onnx`。

独立的 ASR、RapidOCR、YOLO 测试 APK 保持原有离线测试定位，不随正式显示 APK 的模型分发策略改造。

## 运行架构

```text
正式 APK NativeBridge
    ├─ AsrModelManager / TtsModelManager / VoiceprintModelManager
    ├─ VisionModelManager ── GET /api/vision/model-manifest
    └─ DenoiseModelManager ─ GET /api/speech-enhancement/model-manifest
                                  │
                                  ▼
                         AASC HTTP 模型分发路由
                                  │
                       res/models/{group}/... 资源
```

模型管理器在推理线程或已有模型工作线程内执行下载，使用服务器 SHA-256、临时目录和完整目录切换。模型未准备好时不加载 ONNX session；下载失败返回结构化错误并保留旧缓存，已验证缓存可以离线继续使用。模型清单变化后会释放旧 session，再加载新模型。

## 服务器接口

- `GET /api/vision/model-manifest`：返回 RapidOCR 和已准备好的 YOLO 模型文件清单，清单包含 `id`、文件名、字节数和 SHA-256。
- `GET /api/vision/model/:modelId/:filename`：只允许清单中对应模型的文件名，禁止路径穿越。
- `GET /api/speech-enhancement/model-manifest`：返回降噪模型清单。
- `GET /api/speech-enhancement/model/:filename`：下载清单内的降噪模型文件。

YOLO 清单由服务器实际存在的 ONNX 文件生成。`yolo11*.pt` 只作为导出输入，不进入 APK 或 git；新增更大模型时运行服务器准备命令生成 ONNX，发布后清单自动暴露它，APK 通过模型 ID 下载。

## APK 存储与能力

- `filesDir/models/vision/rapidocr/`：四个 RapidOCR 文件。
- `filesDir/models/vision/yolo11/`：按模型 ID 保存 ONNX。
- `filesDir/models/speech-enhancement/`：GTCRN 文件。
- ASR/TTS/声纹目录保持现有路径和 hash/manifest 机制。

状态查询只报告本地缓存是否就绪，不触发下载或 session 加载；首次真正推理前由对应 manager 确保模型完整。视觉仍使用单 worker、单小核、ORT 线程数 1/1；模型下载不会改变 CPU affinity 配置。

## 安全与兼容性

- 文件名和模型 ID 都使用固定白名单，路由不接受任意文件路径。
- APK 下载先写 staging 目录内的 `.tmp`，hash 校验通过后再切换完整目录；失败只清理 staging，保留旧缓存。
- HTTPS 普通地址使用系统证书链；当前本机自签名证书只接受内置指纹，且仅允许本机/局域网开发地址，避免“信任所有证书”。
- 新 APK + 旧服务器：模型清单返回 404 时，相关本地能力报错但不影响媒体显示和已有 ASR/TTS 缓存。
- 旧 APK + 新服务器：`yolo11n` 继续使用旧协议；选择 s/m/l/x 时服务端要求新 APK 声明对应模型能力，旧 APK 返回不支持，不静默降级到 n。
- APK 包中不再生成 `speech-enhancement`、`vision/rapidocr`、`vision/yolo11` 资源；运行时只从服务器缓存目录加载。
