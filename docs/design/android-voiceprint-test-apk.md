# 独立 Android 声纹对比测试 APK设计

## 目标

在 `3rd/tts-server/android-asr` 独立 APK 中增加声纹对比测试能力，保留现有原生 ASR 页面，并通过 APK 内置 HTTP 服务向电脑或手机浏览器提供测试网页。

本次对比固定四条链路：

1. WeSpeaker 单段 embedding + 已注册声纹库匹配。
2. WeSpeaker 多人分段 + embedding 匹配。
3. Sherpa 单段 `SpeakerEmbeddingExtractor + SpeakerEmbeddingManager` 匹配。
4. Sherpa `OfflineSpeakerDiarization` 多人分段匹配。

之前的 WeSpeaker 滑窗余弦聚类 Benchmark 不纳入本次正式测试入口，只保留历史编译产物作为参考。

## 边界

- 第一版支持本地 WAV 选择和网页录音。
- 测试音频在 APK 本地执行，不经过主项目服务器，不依赖 WebSocket。
- 网页通过 `http://APK_IP:端口/` 访问；APK 不自动打开内部 WebView。
- 四条链路统一使用 16 kHz、单声道、Float32 PCM 输入。
- 每次测试返回文本 JSON，包含模式、模型状态、耗时、匹配结果、分段和错误信息。
- 不改变主项目 `src/apps/android-display` 的生产 APK 和服务器声纹链路。

## 方案

独立 APK 的 `AsrHttpServer` 继续提供网页和 HTTP 接口。网页增加模式选择、声纹注册音频、待测音频、开始测试和结果面板。服务端收到测试请求后，由 `VoiceprintTestCoordinator` 根据模式分派到 WeSpeaker 或 Sherpa 实现。

WeSpeaker 路径使用独立的 WeSpeaker/3D-Speaker ONNX embedding 推理和余弦相似度逻辑，不调用 Sherpa 的 `SpeakerEmbeddingManager`；Sherpa 路径调用现有 sherpa-onnx AAR 声纹 API。两条路径使用同一组注册音频和相同的输入采样率，便于比较推理时延、匹配结果和分段差异。

## 结果与观测

每次请求返回：

- `mode`：四种模式标识；
- `embeddingDim`：embedding 维度；
- `matchedSpeaker`：单段模式的匹配人名或 null；
- `segments`：多人模式的起止时间、聚类编号、匹配人名；
- `similarity`：WeSpeaker 直接余弦匹配的最高分；Sherpa 原生 manager 未暴露分数时返回 null；
- `elapsedMs`：总耗时和阶段耗时；
- `error`：模型、音频、推理或匹配异常。

网页展示每次测试结果并保留最近结果，避免只依赖 logcat 判断 APK 是否成功。

## 风险控制

- WeSpeaker ONNX 模型输入预处理和 APK 运行时必须与模型导出约定一致；若输入签名或算子不兼容，请在加载阶段明确返回错误，不回退到 Sherpa，避免比较失真。
- 多人模式的未知说话人保留为 `speaker: null`，测试页面显示但不静默丢弃，便于判断是分段失败还是匹配阈值失败。
- 模型只加载一次，测试结束释放临时音频和 stream；异常通过 JSON 返回，不让 HTTP 工作线程崩溃。
- 现有 ASR HTTP 接口和原生页面行为保持不变。
