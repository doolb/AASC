# 独立 Android 声纹对比测试 APK设计

## 目标

在 `3rd/tts-server/android-asr` 独立 APK 中增加声纹对比测试能力，保留现有原生 ASR 页面，并通过 APK 内置 HTTPS 服务向电脑或手机浏览器提供测试网页。

本次测试保留两条 Sherpa 基础链路和一个针对已知人数的快速入口：

1. Sherpa 单段 `SpeakerEmbeddingExtractor + SpeakerEmbeddingManager` 匹配。
2. Sherpa `OfflineSpeakerDiarization` 多人分段匹配。
3. Sherpa 快速多人 `SHERPA_MULTI_FAST`，按已知人数和 cluster 复用 embedding。

WeSpeaker 测试入口、模型、运行时和网页模式全部移除；此前的 WeSpeaker 真机结果只作为历史记录保留。

## 边界

- 第一版支持本地 WAV 选择和网页录音。
- 测试音频在 APK 本地执行，不经过主项目服务器，不依赖 WebSocket。
- 网页通过 `https://APK_IP:端口/` 访问；APK 不自动打开内部 WebView。
- 三个入口统一使用 16 kHz、单声道、Float32 PCM 输入。
- 每次测试返回文本 JSON，包含模式、模型状态、耗时、匹配结果、分段和错误信息。
- 不改变主项目 `src/apps/android-display` 的生产 APK 和服务器声纹链路。

## 方案

独立 APK 的 `AsrHttpServer` 继续提供网页和 HTTP 接口。网页增加模式选择、声纹注册音频、待测音频、开始测试和结果面板。服务端收到测试请求后，由 `VoiceprintTestCoordinator` 根据模式分派到 Sherpa 单段或 Sherpa 多段实现。注册声纹保存在 APK 进程内存中，重启 APK 后清空。

## 结果与观测

每次请求返回：

- `mode`：`SHERPA_SINGLE`、`SHERPA_MULTI` 或 `SHERPA_MULTI_FAST`；
- `embeddingDim`：embedding 维度；
- `matchedSpeaker`：单段模式的匹配人名或 null；
- `segments`：多人模式的起止时间、聚类编号、匹配人名；
- `similarity`：Sherpa 原生 manager 未暴露分数时返回 null；
- `elapsedMs`：总耗时和阶段耗时；
- `error`：模型、音频、推理或匹配异常。

网页展示每次测试结果并保留最近结果，避免只依赖 logcat 判断 APK 是否成功。

## 风险控制

- 多人模式的未知说话人保留为 `speaker: null`，测试页面显示但不静默丢弃，便于判断是分段失败还是匹配阈值失败。
- 模型只加载一次，声纹任务串行执行；测试结束释放临时音频和 stream，异常通过 JSON 返回，不让 HTTP 工作线程崩溃。
- 现有 ASR HTTP 接口和原生页面行为保持不变。

## 原生 APK 页面接入 Sherpa 测试 UI（2026-09-11）

独立 ASR 测试 APK 的原生 `MainActivity` 原来只提供普通 ASR、录音、音频选择、播放和 HTTPS 服务控制；同一 APK 的 `AsrWebPage` 已经提供 Sherpa 声纹测试网页。为方便直接在手机 APK 页面上完成测试，将网页中的 Sherpa 测试相关 UI 和操作接入原生页面。

- 原生页面新增 Sherpa 声纹状态和已注册名称展示、注册名称输入框、声纹注册按钮、声纹降噪开关、Sherpa 单段/多段/快速多段按钮、多人模式人数选择和详细结果区域。
- 普通 ASR 文字降噪开关与声纹降噪开关分别保留，注册只使用声纹降噪开关；声纹测试同时将两个开关传入既有 `VoiceprintTestCoordinator.test`。
- 所有操作复用当前已选择或刚录制的 `selectedSamples`，直接调用 APK 内已有协调器，不经过本机 HTTPS 页面，不重复解码音频。
- 原生按钮操作使用现有后台线程；运行期间禁用注册和三种测试按钮，完成后恢复；异常显示在声纹结果区域，注册成功后刷新已注册名称。
- 结果至少显示模式、ASR 文本、匹配名称、`similarityScore`、`threshold`、阶段耗时和各分段的说话人/分数/文字/错误，便于与网页测试结果对照。
- 本次不新增模型、不改变 Sherpa 推理流程、不持久化声纹库、不新增 HTTP 路由；声纹阈值继续使用当前 `SherpaVoiceprintEngine.matchThreshold`。

## 流式 ASR 扩展

- 独立 APK 增加 Sherpa `OnlineRecognizer`，使用官方小型双语 Zipformer int8 模型，支持中文和英文。
- 浏览器通过 WebSocket `/api/asr/stream` 发送 16 kHz、单声道、16-bit PCM 二进制帧；服务端按帧解码并返回 partial/final 文本 JSON。
- 页面同时提供“流式发送当前 WAV”入口，避免普通 HTTP 页面因浏览器安全上下文限制无法调用麦克风时无法验证流式链路；麦克风入口仍支持 HTTPS/localhost。
- 流式 ASR 与现有离线 SenseVoice、Sherpa 声纹模型独立加载；每个连接使用一个 stream，结束或断开时显式释放 native stream。
- 暂不实现流式声纹；声纹仍在完整语音段或 diarization 分段上执行。

## 2026-08-27 首轮真机验证结论

- 使用 SM-N9500（Android 9，arm64-v8a）和 `zh.wav`、`en.wav`、`zh-en.wav`、`zh-en-mix.wav` 完成四流程对照；注册库固定使用 `zh.wav → ZH`、`en.wav → EN`。
- WeSpeaker 单段四个音频均能完成文字识别和余弦匹配；相同音频相似度约为 1.0，串接音频匹配为 ZH（0.731），混合音频匹配为 EN（0.670）。
- WeSpeaker 多段滑窗 embedding 四个音频均在重复提取阶段触发 `OutOfMemoryError`；不加载 234MB ASR 模型的最小隔离测试仍复现，优先怀疑多次 native embedding 提取的内存增长或 AAR/运行时边界，暂不进入 APK 接入。
- Sherpa 单段四个音频均完成文字识别和 `SpeakerEmbeddingManager` 匹配；Sherpa 多段四个音频均返回分段，串接音频能分出 ZH/EN，混合音频返回重叠的 ZH/EN 段，但文字内容以 EN 为主。
- 本轮只验证算法和模型行为，未改变生产 APK、服务器或网页；临时 instrumentation 测试和设备临时文件已清理。

## Sherpa-only APK 实现验收（2026-08-27）

- 独立 APK 已内置 Sherpa embedding 模型和 pyannote 分割模型，HTTPS 页面提供 `SHERPA_SINGLE`、`SHERPA_MULTI`、`SHERPA_MULTI_FAST`。
- `zh.wav`、`en.wav`、中文后串接英文、中文与英文混合四个 WAV 均完成基础两种流程测试；注册 `ZH/EN` 成功，embedding 维度为 512。
- 单段四个文件均返回文字和匹配名称；多段四个文件均返回成功，串接音频分出 ZH/EN，混合音频保留重叠分段。
- 非法模式和错误音频类型均返回明确 400 JSON；原有 `/api/asr` 和 `/health` 路由保留。

## 流式 ASR 实现验收（2026-08-27）

- APK 内置 `encoder.int8.onnx`、`decoder.int8.onnx`、`joiner.int8.onnx` 和 `tokens.txt`，启动时独立加载 `OnlineRecognizer`。
- `GET /api/asr/stream` 在 WebSocket 握手后接受 masked binary PCM16 帧，逐帧返回 `partial`；收到 `{ "type": "end" }` 后追加尾部静音、flush 并返回 `final`。
- 网页通过 `getUserMedia` 采集麦克风，重采样到 16 kHz 后发送 PCM16；停止按钮发送结束命令并展示最终文本。
- 真机验证：SM-N9500 Android 9 / arm64-v8a 返回 `streamingReady:true`；`zh.wav` 分片收到 29 个 partial/final 帧，WebSocket 握手和 native stream 释放正常；离线 SenseVoice `/api/asr` 返回“开放时间早上9点至下午5点。”。
- 说明：本次确认了流式链路可用；小型双语流式模型对 `zh.wav` 的识别文本为“太放九鼎鼎”，属于模型识别质量表现，不影响链路回包测试。

## HTTPS/WSS 扩展

- 测试 APK 的网页服务默认使用 `SSLServerSocket`，浏览器页面从 HTTPS 同源地址建立 `wss://` 流式连接。
- 证书使用独立测试 TLS 证书，不复用 display APK 的 Android 签名证书；证书 SAN 包含测试真机 IP `192.168.1.6` 和 `localhost`。
- APK 中的私钥仅用于局域网测试，打包后可被提取，不作为生产安全凭据；浏览器首次访问仍需安装/信任该自签名证书。
- 原有明文 HTTP 测试构造和服务类兼容保留，便于 JVM 单元测试及 WAV 流式回归。

## HTTPS/WSS 实现验收（2026-08-27）

- 使用 `res/certs/android-asr-cert.pem` 和 `android-asr-key.pem` 作为测试证书资产；证书 SAN 覆盖 `192.168.1.6`、`localhost`、`127.0.0.1`。
- `TlsMaterial` 将 PEM 证书和 PKCS#8 RSA 私钥加载到内存 KeyStore，`AsrHttpServer` 使用 `SSLServerSocket` 接受 TLS 连接。
- 真机地址为 `https://192.168.1.6:18080/`；`/health` 返回正常，网页中流式 WebSocket 自动切换为 `wss://`，加密 WebSocket partial/final 回包正常。
- 由于证书为测试自签名证书，电脑或手机浏览器首次访问需手动信任/继续访问；APK 内私钥可被提取，仅限本地测试使用。

## 2026-08-29 过滤功能移除

独立测试 APK 不再提供“过滤其他文字”选项和 `zh-en-filter` 参数。普通网页和声纹测试网页继续固定使用 `zh`；直接 HTTP 调用只接受 `auto`、`zh`、`en`，识别结果不再执行 Unicode 脚本过滤。

## 流式 ASR 真机复测（2026-08-27）

- 通过 `wss://192.168.1.6:18080/api/asr/stream`，按 3200 样本分片发送 16 kHz PCM16。
- `zh.wav`：28 个 partial，final 为“太放九鼎鼎”，端到端约 1.26 秒。
- `en.wav`：36 个 partial，final 为“THE DRIVE THEM GOD FOR THE BOY AND PRESENTED HIM THAT FIFTY PIECES OF GOOD”，端到端约 1.65 秒。
- 结论：WSS、分片接收、增量回包和 final flush 正常；当前小型双语 Zipformer 的中文、英文识别准确率需要后续单独优化。

## Sherpa 单段/多段速度复测（2026-08-27）

- 测试设备为 SM-N9500（Android 9，arm64-v8a），CPU 模式为 `BIG`；注册库为 `zh.wav → ZH`、`en.wav → EN`。
- 单段在四个 WAV 上的 APK 内部总耗时分别为：`zh.wav 5745ms`、`en.wav 7290ms`、`zh-en.wav 14335ms`、`zh-en-mix.wav 8097ms`。
- 多段在四个 WAV 上的 APK 内部总耗时分别为：`zh.wav 5553ms`、`en.wav 7050ms`、`zh-en.wav 31683ms`、`zh-en-mix.wav 14249ms`。
- 单语音频被多段流程合并为一个分段，因此与单段耗时接近；中英串接和混合音频产生多个分段，多段流程额外执行 diarization，并按分段重复 embedding 和 ASR，耗时约为单段的 `1.76–2.21` 倍。
- 当前速度瓶颈在多段的 diarization 和分段 ASR；阶段耗时已通过 `diarizationMs`、`embeddingMs`、`asrMs` 返回，后续优化应优先减少分段数量或避免过短分段。

## Sherpa 快速多段人数上限（2026-08-27）

- 在通用 `SHERPA_MULTI` 之外增加 `SHERPA_MULTI_FAST`，人数参数支持 `AUTO` 或实际人数 `1–5`。
- `AUTO` 使用 Sherpa 动态聚类；明确人数时设置 `FastClusteringConfig.numClusters`，适用于已知本段实际说话人数的场景。注册库人数不自动等同于音频中的实际人数。
- 快速模式在 diarization 后按 cluster 选择最长代表片段，每个 cluster 只执行一次 embedding 和匹配；每个输出时间段仍单独执行 ASR，保持文本分段信息。
- 网页默认使用 `AUTO`，人数超过 5 或格式非法由 HTTP 接口返回 400；通用模式继续作为混合、未知人数音频的兼容路径。

## Sherpa 快速多段真机复测（2026-08-27）

- 设备：SM-N9500，Android 9，arm64-v8a；注册 `ZH/EN`，输入 `zh-en.wav`，排除 `zh-en-mix.wav`。
- 通用 `SHERPA_MULTI`：`elapsedMs=35268`，其中 diarization `19226ms`、embedding `5977ms`、ASR `10053ms`，6 个分段。
- 快速 `SHERPA_MULTI_FAST&speakerCount=2`：`elapsedMs=33113`，其中 diarization `19224ms`、embedding `3883ms`、ASR `9998ms`，6 个分段，匹配结果为 ZH/EN 交替。
- 快速模式总耗时约降低 `6.1%`；主要减少 embedding，当前最大瓶颈仍是 diarization 和逐段 ASR。
- `speakerCount=AUTO` 本轮同样为 `33113ms`；人数参数主要影响聚类约束，不能单独消除分割模型推理成本。

## zh-en-mix 混合语音真机复测（2026-08-27）

- `SHERPA_SINGLE` 将整段混合语音作为一个输入，匹配结果为 `EN`，ASR 文本也以英文为主；该模式不区分重叠说话人。
- `SHERPA_MULTI` 检测出两个时间重叠的分段：`EN 1.077–6.376s`、`ZH 1.077–5.009s`；两个分段的 ASR 文本都主要输出英文。
- `SHERPA_MULTI_FAST` 在 `speakerCount=2` 下得到相同的两个重叠分段和匹配名称，耗时 `11920ms`，与普通多段 `11955ms` 基本相同。
- 结论：Sherpa diarization 能给重叠语音打上不同 cluster/声纹标签，但不执行语音源分离；混合波形送入 ASR 后，较强或较清晰的英文会主导识别结果。快速模式在此类仅有两个分段的输入上收益很小。

## 降噪开关设计（2026-08-27）

- 测试网页增加“ASR/声纹降噪”开关，默认关闭；开关对 Sherpa 单段、普通多段、快速多段和声纹注册生效，流式 ASR 不接入。
- 关闭开关时，原始 16 kHz 单声道 Float32 音频同时用于 diarization、embedding 提取、声纹匹配和 ASR。
- 开启开关时，先使用 Sherpa `OfflineSpeechDenoiser` 对完整音频执行一次 GTCRN 降噪，再将降噪音频同时用于 diarization、embedding 提取、声纹匹配和 ASR，避免注册与匹配使用不同的声学域。
- 注册接口和测试接口都通过 `denoise=1` 传递开关状态；注册库只保存在进程内存中，启用降噪后需要使用同样的开关重新注册声纹。
- 结果增加 `denoise` 和 `denoiseMs`，用于确认实际使用的音频链路和降噪耗时；降噪模型加载失败时返回明确错误，不静默回退到原始音频。

## 降噪开关验收（2026-08-27）

- 测试 APK 内置 `gtcrn_simple.onnx`，启动状态显示 Sherpa GTCRN 降噪模型已就绪。
- 真机 SM-N9500 上以 `zh.wav` 验证降噪注册、单段、普通多段和快速多段，四个请求均成功返回 `denoise: true`。
- 降噪注册耗时 `1556ms`；单段测试降噪耗时 `1536ms`、匹配 `ZH`；普通多段 `1542ms`、匹配 `ZH`；快速多段 `1615ms`、匹配 `ZH`。
- 单段、多段和快速多段的 ASR 均实际使用降噪音频；流式 ASR 未增加降噪参数或处理。

## 当前音频播放与中英混合过滤设计（2026-08-28）

- 原生 APK 在选择音频/录音后增加“播放当前音频”入口，使用已解码的 16 kHz 单声道 PCM 播放；切换音频、停止播放和页面销毁时释放 `AudioTrack`。
- 测试网页增加当前音频播放器，选择 WAV 或完成网页录音后更新播放器资源；切换文件时撤销旧的 object URL，避免浏览器资源泄漏。
- 网页增加离线 ASR 语言模式：自动（不限制语言）、中英混合并过滤其他文字、中文、英文。中英混合模式底层仍使用 SenseVoice `auto`，因为模型不接受 `zh,en` 双语言参数。
- `/api/asr` 和 `/api/voiceprint/test` 接收 `language` 查询参数；语言模式只影响 ASR，不影响声纹 embedding、diarization 和匹配。声纹注册不需要语言参数。
- 中英混合过滤在 ASR 返回后执行：保留中文 Han 字符、ASCII 英文字母、数字、空白和常用中英文标点，删除日文假名、韩文等其他脚本。日文 Kanji 与中文 Han 共用字符范围，过滤器不承诺区分两者。
- 流式 ASR 本轮保持当前固定双语 Zipformer 识别路径，不增加后处理过滤，以免 partial 文本和最终文本规则不一致。
