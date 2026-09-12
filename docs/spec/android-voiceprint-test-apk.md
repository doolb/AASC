# 独立 Android 声纹对比测试 APK 实现文档（伪代码）

## 数据结构

```text
VoiceprintTestMode:
  SHERPA_SINGLE
  SHERPA_MULTI
  SHERPA_MULTI_FAST

VoiceprintTestRequest:
  mode: VoiceprintTestMode
  speakerCount: AUTO 或 1..5，可选
  denoise: Boolean，默认 false
  audioWav: 二进制 WAV
  registeredAudioWav: 可选的注册音频列表
  speakerName: 可选的人名

VoiceprintTestResult:
  mode
  denoise
  denoiseMs
  embeddingDim
  matchedSpeaker
  segments: [{start, end, clusterId, speaker, text?}]
  elapsedMs
  diarizationMs
  embeddingMs
  asrMs
  error
```

## 网页流程

```text
页面加载:
  GET /health
  GET /api/voiceprint/status
  显示 ASR/Sherpa 模型状态

选择音频:
  用户选择 WAV 或网页录音
  页面校验扩展名和非空文件

注册声纹:
  用户填写 speakerName 并选择注册 WAV
  用户选择是否启用降噪
  POST /api/voiceprint/register?name=<speakerName>&denoise=<0|1>
  denoise=true -> 对完整注册音频执行一次 GTCRN 降噪
  使用选择后的音频执行 Sherpa embedding 提取
  将 embedding 和 speakerName 写入 APK 进程内存声纹库
  返回 embeddingDim 和状态

开始测试:
  页面选择 mode 和 audio
  页面选择是否启用降噪
  POST /api/voiceprint/test?mode=SHERPA_SINGLE|SHERPA_MULTI|SHERPA_MULTI_FAST&denoise=<0|1>
  body = WAV 二进制
  页面渲染 VoiceprintTestResult
```

## 测试协调器

```text
VoiceprintTestCoordinator.test(request):
  校验 audioWav 存在且可解码
  将 WAV 解码为 16k mono Float32 samples
  denoise=true -> 调用 SherpaDenoiseEngine.process(samples)，记录 denoiseMs
  denoise=false -> 直接使用原始 samples
  根据 mode 选择 Sherpa 单段或多段 engine
  记录总耗时
  调用 engine.test(samples, registeredDb)
  将阶段耗时、embeddingDim、匹配结果、分段和错误合并
  返回 VoiceprintTestResult
```

## Sherpa 单段

```text
SherpaSingleEngine.test(samples, db):
  embedding = sherpa SpeakerEmbeddingExtractor.compute(samples)
  将 db 的 embedding 加入 SpeakerEmbeddingManager
  speaker = manager.search(embedding, threshold)
  text = sherpa AsrEngine.recognize(samples)
  返回 text、speaker 和 embeddingDim
```

降噪音频准备:
  denoise=false -> preparedSamples = rawSamples，denoiseMs = 0
  denoise=true -> preparedSamples = SherpaDenoiseEngine.process(rawSamples)，denoiseMs = 推理耗时
  单次请求后将 preparedSamples 同时传给 embedding、match 和 ASR

## Sherpa 多人

```text
SherpaMultiEngine.test(samples, db):
  diarized = OfflineSpeakerDiarization.process(preparedSamples)
  merged = VoiceprintSegmentMerger.merge(diarized)
  遍历 merged:
    按 start/end 从 preparedSamples 切片，限制在样本数组范围内
    embedding = SpeakerEmbeddingExtractor.compute(segmentSamples)
    speaker = SpeakerEmbeddingManager.search(embedding, threshold)
    text = sherpa AsrEngine.recognize(segmentSamples)
    失败时保留当前分段并写入 error
  返回 text、start、end、clusterId、speaker、text、error
```

## HTTP 接口

```text
GET /api/voiceprint/status:
  返回三种 Sherpa 模式的模型是否 ready、embeddingDim、threshold

POST /api/voiceprint/register:
  接收 name + denoise + audio
  解码音频
  denoise=true -> 对完整音频执行 GTCRN 降噪
  使用选择后的音频执行 Sherpa SpeakerEmbeddingExtractor 提取 embedding
  写入内存测试库
  返回 {success, name, embeddingDim, denoise, denoiseMs}

POST /api/voiceprint/test:
  接收 mode、可选 speakerCount、可选 denoise 查询参数 + audio，使用进程内注册库
  speakerCount 缺失、空白或 AUTO -> 动态聚类
  speakerCount 为 1..5 -> 已知人数聚类
  speakerCount 其他值 -> 返回 400
  调用 VoiceprintTestCoordinator.test
  成功返回 {success, mode, denoise, denoiseMs, embeddingDim, matchedSpeaker, text, segments, elapsedMs, diarizationMs, embeddingMs, asrMs}
  失败返回 {success:false, error}
```

## Sherpa 快速多人

```text
SherpaFastMultiEngine.test(samples, db, speakerCount):
  diarized = OfflineSpeakerDiarization.process(preparedSamples)
  speakerCount 为 AUTO -> clustering.numClusters = 0
  speakerCount 为 1..5 -> clustering.numClusters = speakerCount
  merged = VoiceprintSegmentMerger.merge(diarized)
  每个 cluster 选择持续时间最长的 merged segment
  对代表 segment 执行一次 embedding + SpeakerEmbeddingManager.search
  遍历全部 merged segment:
    使用 cluster -> speaker 映射
    对当前 segment 执行一次 ASR
    失败时保留当前分段并写入 error
  返回所有分段、匹配人名、ASR 文本和阶段耗时
```

## 流式 ASR

```text
StreamingAsrEngine.load(encoder, decoder, joiner, tokens):
  使用 OnlineRecognizerConfig + OnlineTransducerModelConfig 初始化一次

WebSocket /api/asr/stream:
  校验 Upgrade 和 Connection 请求头
  完成 Sec-WebSocket-Accept 握手
  创建一个 OnlineStream
  接收 binary frame:
    将 little-endian PCM16 转为 Float32
    stream.acceptWaveform(samples, 16000)
    while recognizer.isReady(stream): recognizer.decode(stream)
    返回 {type: "partial", text: recognizer.getResult(stream).text}
  接收 text frame {"type":"end"}:
    stream.inputFinished()
    继续 decode 直到不 ready
    返回 {type: "final", text: ...}
    释放 stream 并关闭 WebSocket
```

```text
浏览器流式录音:
  getUserMedia(audio)
  AudioContext 采集 Float32 音频
  重采样到 16 kHz 并编码为 PCM16
  WebSocket.send(binaryPcmChunk)
  onmessage 更新 partial/final 文本
  停止录音时发送 {"type":"end"}

浏览器 WAV 流式测试:
  读取当前选择的 WAV 并用 AudioContext 解码为 Float32 单声道
  重采样到 16 kHz，按 3200 样本分片发送 binary PCM16
  按接近实时的间隔发送，完成后发送 {"type":"end"}
```

## 错误处理

```text
音频为空或格式不支持:
  返回 400 和明确错误

模型未加载或 ONNX 输入不兼容:
  返回 503 和 engine/model 错误

单个分段失败:
  保留其他分段
  当前分段 error 字段记录失败原因

HTTP 或推理异常:
  try-catch
  清理临时资源
  返回 JSON
```

## 原生 APK 页面 Sherpa 声纹测试伪代码

```text
MainActivity 初始化:
  绑定 Sherpa 状态、注册名称、ASR 降噪、声纹降噪、注册按钮、三种测试按钮、人数选择和结果文本
  继续复用 selectedSamples、selectedCpuMode、background、voiceprintCoordinator
  模型加载完成后显示声纹模型状态、embeddingDim、当前阈值和已注册名称

注册当前音频:
  如果 selectedSamples 不存在或为空:
    在声纹结果区显示“请先录音或选择音频”
    结束
  如果注册名称为空:
    在声纹结果区显示“请填写注册名称”
    结束
  禁用注册和三种测试按钮
  后台调用 voiceprintCoordinator.register(
    name, selectedSamples, selectedCpuMode, voiceprintDenoise
  )
  成功:
    显示名称、embeddingDim、声纹降噪状态和耗时
    重新读取 registeredSpeakers()
  失败:
    显示解包后的异常信息
  回到主线程恢复按钮状态

测试当前音频(mode):
  如果 selectedSamples 不存在或音频校验失败:
    显示校验信息
    结束
  mode 为 SHERPA_SINGLE 时使用 AUTO 人数；
  mode 为 SHERPA_MULTI 或 SHERPA_MULTI_FAST 时读取 1-5/AUTO 人数
  禁用注册和三种测试按钮
  后台调用 voiceprintCoordinator.test(
    mode,
    selectedSamples,
    selectedCpuMode,
    speakerCount,
    asrDenoise,
    voiceprintDenoise,
    AsrLanguageMode.ZH
  )
  成功:
    显示 mode、text、matchedSpeaker、similarityScore、threshold
    显示 denoise 状态、diarizationMs、embeddingMs、asrMs、elapsedMs
    逐段显示 start/end、clusterId、speaker、similarityScore、text、error
  失败:
    显示解包后的异常信息
  回到主线程恢复按钮状态

声纹状态刷新:
  读取 voiceprintCoordinator.isReady()
  读取 embeddingDim()、matchThreshold()、registeredSpeakers()
  模型未就绪时禁用声纹操作并显示原因
```

## 原生页面实现映射与验收（2026-09-11）

```text
activity_main.xml:
  在普通识别区域增加 Switch#asrDenoise
  增加 voiceprintStatus、speakerName、Switch#voiceprintDenoise
  增加 registerSpeaker、Spinner#speakerCount、testSingle、testMulti、testMultiFast
  增加可选择文本 voiceprintResult

MainActivity.bindViews/setupVoiceprintSpeakerCount:
  绑定上述控件
  Spinner 显示 AUTO 和 1-5 人
  多段测试通过 VoiceprintSpeakerCount.parse(position 对应的 AUTO/1-5 字符串)

VoiceprintUiRequest.create:
  单段模式统一将 speakerCount 归一为 AUTO
  多段模式保留已校验的 AUTO/1-5
  独立保存 asrDenoise 和 voiceprintDenoise，按原顺序传给 coordinator

普通 ASR:
  复制 selectedSamples
  读取 asrDenoise.isChecked
  调用 coordinator.submit(samples, selectedCpuMode, ZH, asrDenoise)

声纹注册:
  校验 voiceprint 模型、名称和 selectedSamples
  复制 selectedSamples
  后台调用 voiceprintCoordinator.register(name, samples, selectedCpuMode, voiceprintDenoise)
  使用 UiStatus.voiceprintRegistration 展示名称、维度、降噪状态和耗时
  完成后刷新 registeredSpeakers()

声纹测试:
  单段使用 SHERPA_SINGLE + AUTO
  多段使用 SHERPA_MULTI + Spinner 人数
  快速多段使用 SHERPA_MULTI_FAST + Spinner 人数
  后台调用 voiceprintCoordinator.test(mode, samples, selectedCpuMode,
    speakerCount, asrDenoise, voiceprintDenoise, ZH)
  使用 UiStatus.voiceprintResult 展示整体结果和所有分段诊断字段
  成功、异常和 finally 均回到主线程恢复按钮状态
```

验收结果:
  `node --test tests/android-asr-apk.test.js` 通过 3/3
  Android `:app:testDebugUnitTest` 通过
  `npm --prefix 3rd/tts-server run build:android-asr` 通过
  相关 Node 回归测试通过 10/10
  Debug APK 已安装到 `192.168.1.6:5555`，`com.aasc.asr/.MainActivity` 获得窗口焦点且无崩溃日志

## 当前音频播放

```text
原生 APK 选择/录音完成:
  selectedSamples = 16k mono Float32
  用户点击播放:
    停止并释放上一个 AudioTrack
    Float32 转为 16-bit PCM
    创建 16 kHz 单声道 AudioTrack
    写入 PCM 并开始播放
  用户再次点击或切换音频/页面销毁:
    停止 AudioTrack
    释放 AudioTrack

网页选择/录音完成:
  selectedAudio = 当前 WAV Blob/File
  释放旧 currentAudioUrl
  currentAudioUrl = URL.createObjectURL(selectedAudio)
  currentAudio.src = currentAudioUrl
  播放按钮调用 currentAudio.play()
  停止按钮调用 currentAudio.pause() 并回到起始位置
```

## 离线 ASR 语言模式与中英混合过滤

```text
AsrLanguageMode:
  AUTO: engineLanguage = "auto", 不做文字过滤
  ZH_EN_FILTER: engineLanguage = "auto", 识别后执行中英文字过滤
  ZH: engineLanguage = "zh", 不做文字过滤
  EN: engineLanguage = "en", 不做文字过滤

解析 language 查询参数:
  缺失或空白 -> AUTO
  auto -> AUTO
  zh-en-filter -> ZH_EN_FILTER
  zh -> ZH
  en -> EN
  其他值 -> HTTP 400

普通离线 ASR:
  从请求解析 languageMode
  将 audio 解码为 16k mono Float32
  使用单个缓存的 SenseVoice recognizer
  languageMode 变化 -> 在同步区内按 engineLanguage 重建 recognizer
  text = recognizer.recognize(samples)
  ZH_EN_FILTER -> text = ChineseEnglishTextFilter.filter(text)
  返回 text 和耗时

声纹测试:
  diarization、embedding、match 始终使用原有音频准备流程
  每个分段调用 ASR 时传入 languageMode
  ZH_EN_FILTER -> 仅过滤每个分段的 text 和汇总 text
  声纹匹配结果不受文字过滤影响
```

```text
ChineseEnglishTextFilter.filter(text):
  遍历 Unicode 字符
  保留 Han 脚本字符
  保留 ASCII A-Z/a-z 和 0-9
  保留空白和常用中英文标点
  删除日文假名、韩文及其他脚本字符
  清理过滤产生的多余空白
  返回过滤后的文字
```

## HTTP 接口变更

```text
POST /api/asr?language=auto|zh-en-filter|zh|en
  其他 body、Content-Type、错误码保持不变

POST /api/voiceprint/test?language=auto|zh-en-filter|zh|en
  与 mode、speakerCount、denoise 共同使用
  语言参数只作用于分段 ASR
```
```

## 历史真机验证记录（2026-08-27）

```text
注册库:
  zh.wav → ZH
  en.wav → EN

对照音频:
  zh.wav
  en.wav
  zh-en.wav = 中文后串接英文
  zh-en-mix.wav = 中文与英文混合

Sherpa 单段:
  四个音频均返回 text + SpeakerEmbeddingManager 匹配名称

Sherpa 多段:
  zh.wav、en.wav 各返回一个已匹配分段
  zh-en.wav 返回多个分段并识别出 ZH/EN，存在短未知段和时间重叠
  zh-en-mix.wav 返回重叠的 ZH/EN 分段，文字以 EN 为主

本次实现删除 WeSpeaker 测试入口及其模型/运行时；以上 WeSpeaker 结果仅用于说明删除原因，不再属于 APK 验收项。
```

## 本次 Sherpa-only 真机验收（2026-08-27）

```text
环境: SM-N9500 / Android 9 / arm64-v8a
注册: zh.wav → ZH，en.wav → EN，embeddingDim=512
输入: zh.wav，en.wav，zh-en.wav（串接），zh-en-mix.wav（混合）

SHERPA_SINGLE: 4/4 成功，四个文件均返回 ASR 文本和匹配 speaker。
SHERPA_MULTI: 4/4 成功，单语音频各返回一个匹配分段；串接音频分出 ZH/EN；混合音频返回重叠分段。
异常回归: 非法 mode 返回 400；错误 Content-Type 返回 400；网页提供三种 SHERPA 模式。
```

## 本次流式 ASR 验收（2026-08-27）

```text
StreamingAsrModelFiles:
  从 assets/streaming 复制 encoder、decoder、joiner、tokens 到 APK 私有目录

StreamingAsrEngine:
  OnlineRecognizerConfig 使用 16 kHz、80 维特征、zipformer、CPU、1 线程
  每个 WebSocket 连接创建一个 OnlineStream
  binary PCM16 -> Float32 -> acceptWaveform
  while isReady: decode
  返回 getResult.text 作为 partial
  finish 时追加 400 ms 静音、inputFinished、继续 decode，返回 final
  close/异常时 release OnlineStream

真机结果:
  /health: modelReady=true, streamingReady=true
  zh.wav: WebSocket 握手成功，收到 28 个 partial + 1 个 final 文本帧
  /api/asr: 离线 SenseVoice 返回正常中文文本
```

流式模型本轮使用官方小型双语 Zipformer int8 版本；链路已验证可用，但 `zh.wav` 的模型输出仍需后续更换/调优模型时单独评估。

本次 WSS 复测:
  zh.wav -> partial 28 次 -> final “太放九鼎鼎”，约 1.26 秒
  en.wav -> partial 36 次 -> final “THE DRIVE THEM GOD FOR THE BOY AND PRESENTED HIM THAT FIFTY PIECES OF GOOD”，约 1.65 秒
  结论: 流式协议和资源释放正常，文本准确率偏低，属于当前模型质量问题

## HTTPS/WSS

```text
TlsMaterial.load(certPem, keyPem):
  读取 X.509 PEM 证书
  读取 PKCS#8 RSA 私钥
  创建内存 KeyStore 和 KeyManagerFactory
  创建 TLS SSLContext

AsrHttpServer:
  tlsContext 存在 -> 创建 SSLServerSocket
  tlsContext 不存在 -> 创建普通 ServerSocket（仅用于 JVM 测试兼容）
  HTTPS 连接沿用同一 HTTP 路由和 WebSocket 握手

AsrWebPage:
  location.protocol == https: -> 使用 wss://
  其他情况 -> 使用 ws://
```

## HTTPS/WSS 验收结果（2026-08-27）

```text
证书:
  android-asr-cert.pem: X.509 自签名证书，SAN=192.168.1.6/localhost/127.0.0.1
  android-asr-key.pem: PKCS#8 RSA 私钥，仅作为测试资产

启动:
  MainActivity 加载 TlsMaterial
  AsrHttpServer(tlsContext) 创建 SSLServerSocket
  addressText 返回 https://<device-ip>:<port>

协议:
  HTTPS GET /health 成功
  HTTPS 页面使用 wss://<same-host>/api/asr/stream
  TLS WebSocket 握手成功，binary PCM 和 final JSON 回包成功
```

## Sherpa 单段/多段速度复测（2026-08-27）

```text
环境:
  SM-N9500 / Android 9 / arm64-v8a / cpuMode=BIG
  注册库: zh.wav -> ZH，en.wav -> EN

APK 内部 elapsedMs:
  文件              单段       多段       多段分段数
  zh.wav            5745 ms    5553 ms    1
  en.wav            7290 ms    7050 ms    1
  zh-en.wav        14335 ms   31683 ms    6
  zh-en-mix.wav     8097 ms   14249 ms    2

结论:
  单段为一次 embedding + 一次 ASR，速度基本随音频长度增长。
  多段先 diarization，再对每个合并分段分别 embedding + ASR。
  单语音频只有一个分段，耗时与单段接近；多语音频约为单段 1.76-2.21 倍。
  HTTP wall time 比 elapsedMs 多约几十毫秒，主要是请求传输和 TLS 开销。
```

## Sherpa 快速多人复测（2026-08-27）

```text
输入: zh-en.wav，注册 zh.wav -> ZH、en.wav -> EN，排除 zh-en-mix.wav
通用 SHERPA_MULTI: elapsedMs=35268，diarizationMs=19226，embeddingMs=5977，asrMs=10053，segments=6
快速 SHERPA_MULTI_FAST speakerCount=2:
  elapsedMs=33113，diarizationMs=19224，embeddingMs=3883，asrMs=9998，segments=6
快速 SHERPA_MULTI_FAST speakerCount=AUTO:
  elapsedMs=33113，diarizationMs=19273，embeddingMs=3847，asrMs=9986，segments=6
结论: 快速模式本轮约快 6.1%，收益主要来自减少重复 embedding；diarization 和逐段 ASR 仍是主要耗时。
```

## zh-en-mix 混合语音复测（2026-08-27）

```text
SHERPA_SINGLE:
  matchedSpeaker=EN
  ASR 以英文为主，不输出多人分段

SHERPA_MULTI:
  EN: 1.0772188-6.375969s
  ZH: 1.0772188-5.0090938s
  两段时间重叠；两个分段 ASR 均主要输出英文
  elapsedMs=11955，diarizationMs=320，embeddingMs=4538，asrMs=7095

SHERPA_MULTI_FAST speakerCount=2:
  得到相同的 EN/ZH 两个重叠分段
  elapsedMs=11920，diarizationMs=324，embeddingMs=4588，asrMs=7003

结论:
  diarization 只标注时间和说话人，不做 source separation；重叠波形仍会同时进入 ASR。
```

## 本次降噪开关验收（2026-08-27）

```text
环境: SM-N9500 / Android 9 / arm64-v8a / CPU BIG
模型: Sherpa GTCRN gtcrn_simple.onnx
音频: zh.wav
注册: ZH，denoise=true，denoiseMs=1556

SHERPA_SINGLE:
  denoise=true，denoiseMs=1536，matchedSpeaker=ZH，成功返回中文 ASR
SHERPA_MULTI:
  denoise=true，denoiseMs=1542，分段 speaker=ZH，成功返回中文 ASR
SHERPA_MULTI_FAST:
  denoise=true，denoiseMs=1615，分段 speaker=ZH，成功返回中文 ASR

结论:
  降噪开关已覆盖注册、单段、普通多段和快速多段；流式 ASR 保持原链路。
```

## 2026-08-29 移除其他文字过滤

```text
AsrLanguageMode:
  AUTO -> engineLanguage = auto
  ZH -> engineLanguage = zh
  EN -> engineLanguage = en
  zh-en-filter -> null（HTTP 400）

普通 ASR 和声纹分段 ASR:
  直接返回 recognizer text.trim()
  不执行 ChineseEnglishTextFilter

## 三个声纹模型对比测试（2026-09-12）

```text
VoiceprintModel:
  ERES2NET_BASE:
    id = "eres2net-base"
    displayName = "ERes2Net-base"
    embeddingFileName = "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"
  ERES2NET_LARGE:
    id = "eres2net-large"
    displayName = "ERes2Net-large"
    embeddingFileName = "3dspeaker_speech_eres2net_large_sv_zh-cn_3dspeaker_16k.onnx"
  ERES2NET_V2:
    id = "eres2netv2"
    displayName = "ERes2NetV2"
    embeddingFileName = "3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx"

VoiceprintModelFiles.ensureCopied(assetManager, modelDir):
  复制三个 embedding 模型和 pyannote segmentation 模型
  每个文件使用临时文件完成复制后再改名

VoiceprintTestCoordinator.loadModel(model, embeddingFile, segmentationFile):
  串行提交模型加载任务
  调用 SherpaVoiceprintEngine.load(embeddingFile, segmentationFile)
  清空进程内注册声纹库
  记录当前 VoiceprintModel
  返回模型是否加载成功

MainActivity:
  初始化三个模型选项，默认 ERES2NET_BASE
  启动时只加载当前选中的 embedding 模型
  用户切换模型:
    禁用注册、测试和模型选择控件
    加载目标模型并释放旧模型
    清空注册库并提示重新注册
    成功后显示模型名、embeddingDim 和阈值
    失败后显示未就绪原因

AsrHttpServer:
  GET /api/voiceprint/status:
    返回当前 modelId、modelName 和三个可选模型
  POST /api/voiceprint/model?model=<modelId>:
    校验模型 ID
    串行切换 embedding 模型
    成功返回当前模型和 ready 状态
    推理忙时返回 409，模型无效时返回 400

AsrWebPage:
  显示三个声纹模型下拉选项
  选择变化时调用 POST /api/voiceprint/model
  切换成功后刷新状态并提示注册库已清空
  注册和测试请求继续复用当前选择的模型

实现同步（2026-09-12）:
  VoiceprintModel.values() = [ERES2NET_BASE, ERES2NET_LARGE, ERES2NET_V2]
  VoiceprintModelFiles.ALL_FILE_NAMES = 三个 embedding 文件 + pyannote_segmentation_3_0_int8.onnx
  MainActivity 和 AsrWebPage = 共享 modelId，默认 eres2net-base，不持久化选择
  POST /api/voiceprint/model = 校验 ID -> 检查忙状态 -> 通过串行协调器加载 -> 清空注册库
  voiceprint/status、register、test = 返回 modelId、modelName；原有 ASR 和流式 ASR 接口不变

真机验证结果（2026-09-12）:
  设备 = SM-N9500 / Android 9 / API 28 / arm64-v8a
  ERes2Net-base = embeddingDim 512，注册和单段匹配成功，相似度 1.0
  ERes2Net-large = embeddingDim 512，注册和单段匹配成功，相似度 1.0
  ERes2NetV2 = embeddingDim 192，注册和单段匹配成功，相似度 1.0
  切换后状态 = modelReady true，registeredSpeakers 0；ASR 文本返回正常
```

## 声纹 FP32/INT8 A/B 对比测试验收（2026-09-12）

```text
量化工具:
  3rd/tts-server/scripts/quantize-voiceprint-models.py
  使用 kaldi_native_fbank 的 80 维 Fbank、dither=0、snip_edges=true
  使用模型 metadata 的 feature_normalize_type=global-mean
  ONNX Runtime QDQ 静态 INT8，权重和激活使用对称 QInt8、per-channel 权重

资源体积:
  base:  FP32 39.6MB -> INT8 10.5MB
  large: FP32 116.1MB -> INT8 29.8MB
  V2:    FP32 71.4MB -> INT8 18.6MB

主机输出校验:
  四段校准/验证 WAV 的 FP32/INT8 embedding cosine 范围为 0.9672-0.9900
  三个 INT8 输出保持 FLOAT，embedding 维度分别为 base=512、large=512、V2=192

真机单段验收:
  设备 = SM-N9500 / Android 9 / API 28 / arm64-v8a
  注册 = 妲已妈妈.wav -> 妲己妈妈，voiceprintDenoise=false
  测试 = 你好，小爱.wav、你好啊你好啊你好啊.wav、zh.wav

  base INT8:
    你好，小爱 -> 妲己妈妈 / 0.6854 / embeddingMs=1310
    你好啊你好啊你好啊 -> 妲己妈妈 / 0.5414 / embeddingMs=2369
    zh -> null / 0.0370 / embeddingMs=2746
  large INT8:
    你好，小爱 -> 妲己妈妈 / 0.6467 / embeddingMs=4212
    你好啊你好啊你好啊 -> 妲己妈妈 / 0.5110 / embeddingMs=7530
    zh -> null / -0.0090 / embeddingMs=9001
  V2 INT8:
    你好，小爱 -> 妲己妈妈 / 0.6502 / embeddingMs=2842
    你好啊你好啊你好啊 -> 妲己妈妈 / 0.5476 / embeddingMs=5132
    zh -> null / 0.1733 / embeddingMs=6341

对应 FP32 分数:
  base  = 0.7108、0.5456、0.0492
  large = 0.6684、0.5080、0.0022
  V2    = 0.6622、0.5626、0.1928

结论:
  三个 INT8 变体均被 Sherpa AAR 真机加载并完成注册/测试；ASR 文本正常。
  量化没有让本次跨音频误匹配发生，默认阈值 0.5 暂不改变；本轮 embeddingMs 均低于对应 FP32，但端到端 elapsedMs 还受 ASR 波动影响，不能据此宣称整体一致提速。
```

## INT8 分段复测验收（2026-09-12）

```text
流程:
  mode = SHERPA_MULTI
  speakerCount = AUTO
  asrDenoise = false
  voiceprintDenoise = false
  每个模型/精度独立重启 APK，注册 妲已妈妈.wav -> 妲己妈妈

平均阶段耗时（你好，小爱、你好啊你好啊你好啊、zh.wav）:
  base INT8:  diarization=244ms，embedding=563ms，elapsed=3387ms
  base FP32:  diarization=251ms，embedding=1299ms，elapsed=4106ms
  large INT8: diarization=235ms，embedding=1833ms，elapsed=4740ms
  large FP32: diarization=302ms，embedding=4465ms，elapsed=8025ms
  V2 INT8:    diarization=251ms，embedding=1653ms，elapsed=4479ms
  V2 FP32:    diarization=240ms，embedding=3041ms，elapsed=6079ms

分段行为:
  你好，小爱.wav:
    三个模型/精度均为 1 段；INT8 speaker 均为 妲己妈妈
  你好啊你好啊你好啊.wav:
    base/large 的 FP32 和 INT8 均为 2 段；V2 的 FP32 和 INT8 均为 1 段
    base INT8 两段分数=0.4944、0.2198，均未过阈值
    large INT8 两段分数=0.4579、0.3034，均未过阈值
    V2 INT8 单段分数=0.5039，匹配 妲己妈妈
  zh.wav:
    所有模型/精度均为 1 段，speaker=null，未过阈值

结论:
  INT8 不改变本轮 Pyannote 分段耗时，主要降低 embedding 阶段耗时。
  直接连续切换多个大模型时观察到 Android lmkd signal 9；独立进程测试均完成，默认仍使用 base FP32。
```

## 声纹 FP32/INT8 A/B 对比（2026-09-12）

```text
VoiceprintPrecision:
  FP32: id = "fp32"，显示名 = "FP32"
  INT8: id = "int8"，显示名 = "INT8"

VoiceprintModelVariant(model, precision):
  id = model.id + "-" + precision.id
  embeddingFileName:
    FP32 -> 原始 embedding 文件名
    INT8 -> 原始 embedding 文件名去掉 .onnx 后追加 _int8.onnx

VoiceprintModelFiles:
  ALL_FILE_NAMES = 三个 FP32 embedding、三个 INT8 embedding、pyannote segmentation
  paths(modelDir, variant) -> variant 对应 embedding + 共用 segmentation

VoiceprintTestCoordinator:
  activeVariant 初始为 ERES2NET_BASE + FP32
  loadVariant(variant, embeddingFile, segmentationFile):
    串行调用 SherpaVoiceprintEngine.load
    成功或失败后清空当前进程注册库
    记录 activeVariant
  model() -> activeVariant.model（保留旧调用兼容）
  precision() / variant() -> 当前精度和组合

MainActivity / AsrWebPage:
  同时显示模型和精度选择，默认 base + FP32
  任一选择改变 -> POST /api/voiceprint/model?model=<id>&precision=<id>
  切换期间禁用注册、测试和选择控件
  切换成功提示注册库已清空，并显示变体信息

AsrHttpServer:
  GET /api/voiceprint/status:
    返回 modelId、modelName、precisionId、precisionName、variantId
    models 数组返回三个模型及其 fp32/int8 可选精度
  POST /api/voiceprint/model:
    model 缺省时按 base 解析；precision 缺省时按 fp32 解析（兼容旧客户端）
    校验 model + precision 组合
    通过变体加载器串行切换，忙时返回 409，无效参数返回 400
  register/test 结果继续返回同一组变体字段

量化工具:
  读取 16 kHz WAV -> Sherpa 兼容 80 维 Fbank -> CalibrationDataReader
  ONNX Runtime quantize_static 生成三个 _int8.onnx 文件
  使用未参与校准的 WAV 对 FP32/INT8 输出做 cosine 和推理耗时对比
```
```
