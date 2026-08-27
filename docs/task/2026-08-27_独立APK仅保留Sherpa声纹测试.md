# 独立 APK 仅保留 Sherpa 声纹测试

## 任务描述

删除独立 `3rd/tts-server/android-asr` APK 中的 WeSpeaker 测试范围，保留 Sherpa 单段、通用多段和快速多段声纹匹配，并通过 APK HTTP 网页执行注册与四个 WAV 回归测试。

## Design 需求

- 保留原有 SenseVoice ASR、`/api/asr`、`/health` 和浏览器入口。
- 提供 `SHERPA_SINGLE`、`SHERPA_MULTI`、`SHERPA_MULTI_FAST` 三种声纹模式；快速模式支持 `AUTO` 或实际人数 1–5。
- 内置 Sherpa embedding 和 pyannote segmentation 模型。
- 注册接口接收 WAV 二进制和 URL speaker 名称，声纹库只保存在 APK 进程内存。
- 多段流程合并相邻同 cluster 分段，逐段执行声纹匹配和 ASR，并保留分段错误。

## 追加需求：流式 ASR

- 使用 Sherpa `OnlineRecognizer` 和官方小型双语 Zipformer int8 模型。
- 通过 WebSocket 接收浏览器的 PCM16 音频帧，返回 partial/final 文本。
- 不改变现有离线 ASR 和 Sherpa 声纹流程，不接入流式声纹。

## Spec 设计

- `SherpaVoiceprintEngine`：加载模型、提取 embedding、manager 匹配、diarization。
- `VoiceprintTestCoordinator`：串行化注册/测试任务，分派三种 Sherpa 流程。
- `AsrHttpServer`：新增 `/api/voiceprint/status`、`/api/voiceprint/register`、`/api/voiceprint/test`。
- `AsrWebPage`：新增注册、Sherpa 单段、多段测试按钮和 JSON 结果面板。

## 受影响功能模块和代码

- `3rd/tts-server/android-asr/app/build.gradle.kts`
- `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/`
- `3rd/tts-server/android-asr/app/src/test/java/com/aasc/asr/`
- `docs/design/android-voiceprint-test-apk.md`
- `docs/spec/android-voiceprint-test-apk.md`

## 自测用例

- 单元测试：模式枚举、网页/状态接口模式列表、分段合并。
- 真机注册 `zh.wav → ZH`、`en.wav → EN`。
- 真机测试 `zh.wav`、`en.wav`、中文后串接英文、中文与英文混合四个 WAV 的单段和多段流程。
- 非法模式、错误 Content-Type、未加载模型返回明确错误。
- 检查 APK 源码和网页不再包含 WeSpeaker 测试入口。

## 兼容性测试

- SM-N9500、Android 9、arm64-v8a。
- 电脑/手机浏览器访问 `https://APK_IP:18080/`；首次访问需信任测试自签名证书。
- 不改变 `src/apps/android-display` 生产 APK。

## 性能测试

- 模型只加载一次，声纹任务单线程串行。
- 返回 `diarizationMs`、`embeddingMs`、`asrMs` 和总耗时。
- 四个 WAV 的基础两种流程均在 120 秒 HTTP 超时内完成；快速模式另以 `zh-en.wav` 做已知 2 人对比。

## 风险评估

- 多段流程包含 diarization 和多个 embedding，耗时高于单段；结果必须显示分阶段耗时。
- 声纹库为进程内存，APK 重启后需要重新注册。
- 原生模型异常由 HTTP JSON 返回，避免工作线程直接退出。

## 完成记录

- ✅ [2026-08-27][2026-08-27] 删除 WeSpeaker 测试并接入 Sherpa 两种流程。
  - Debug APK 构建成功，内置 512 维 embedding 模型和 pyannote 分割模型。
  - Android unit tests 26 个任务通过；真机 Sherpa 单段 4/4、多段 4/4 通过。
  - 改动文件：独立 APK 构建配置、HTTP 服务、网页、MainActivity、Sherpa 声纹类及纯逻辑测试；同步 design/spec/todo/changelog。

- ✅ [2026-08-27][2026-08-27] 追加 Sherpa 流式 ASR。
  - 需求：新增 `OnlineRecognizer` 流式识别，不接入流式声纹；网页通过 WebSocket 发送 16 kHz PCM16 并显示 partial/final，并支持当前 WAV 分片流式测试。
  - 设计：使用官方小型双语 Zipformer int8 模型，连接级 `OnlineStream`，结束时尾部静音 flush 并释放 native 资源。
  - 代码：新增 `StreamingAsrEngine`、模型复制器、WebSocket 帧/握手协议；更新 `AsrHttpServer`、`AsrWebPage`、`MainActivity` 和 Gradle 资源打包。
  - 自测：Android JVM 单测通过；Debug APK 268 MB 构建成功并安装；真机 `/health` 为 `streamingReady:true`，`zh.wav` 分片收到 partial/final，离线 ASR 正常。
  - 兼容性：SM-N9500 / Android 9 / arm64-v8a；浏览器页面可通过 `https://192.168.1.6:18080/` 访问。
  - 性能：流式分片使用 Sherpa native decode；本次 `zh.wav` 约 5.6 秒音频在 WebSocket 端到端约 1.5 秒完成 final。
  - 风险：当前小型双语模型对 `zh.wav` 的文本输出为“太放九鼎鼎”，需要把识别质量与链路可用性分开评估。

- ✅ [2026-08-27][2026-08-27] 追加 HTTPS/WSS 传输支持（本轮）。
  - 目标：测试 APK 默认通过 HTTPS 提供网页，使浏览器具备麦克风安全上下文；流式 WebSocket 自动升级为 WSS。
  - 证书：使用独立测试 TLS 证书，SAN 包含 `192.168.1.6` 与 `localhost`；不复用 display APK 签名证书，不替换服务器现有证书。
  - 影响模块：`TlsMaterial`、`AsrHttpServer`、`MainActivity`、Gradle assets、网页协议选择、Android JVM 测试。
  - 实现：新增带 `192.168.1.6`/`localhost` SAN 的测试 TLS 证书；APK 使用内存 KeyStore 和 `SSLServerSocket`，网页自动使用 `wss://`。
  - 验证：28 项 Android JVM 单测通过；APK 构建/安装成功；真机 HTTPS `/health` 和 WSS partial/final 回包成功。
  - 使用：浏览器访问 `https://192.168.1.6:18080/`，首次需信任自签名证书；证书私钥只适用于测试 APK。

- ✅ [2026-08-27][2026-08-27] 完成流式 ASR WSS 复测。
  - `zh.wav`：28 个 partial，final“太放九鼎鼎”，端到端约 1.26 秒。
  - `en.wav`：36 个 partial，final“The drive them god for the boy and presented him that fifty pieces of good”，端到端约 1.65 秒。
  - WSS 握手、PCM16 分片、partial/final 回包均正常；当前流式模型识别准确率偏低，后续需更换或调优模型。

- ✅ [2026-08-27][2026-08-27] 增加 Sherpa 快速多人模式并支持最多 5 人。
  - 页面和状态接口增加 `SHERPA_MULTI_FAST`；`speakerCount` 支持 `AUTO` 或 `1–5`，非法值返回 400。
  - 快速模式按 cluster 选择最长代表片段，只做一次 embedding 匹配；每个分段仍保留独立 ASR 文本。
  - 真机 `zh-en.wav`：通用多段 35268ms，快速 2 人 33113ms，约快 6.1%；embedding 5977ms 降至 3883ms。
