# 独立 Android 声纹对比测试 APK 实现文档（伪代码）

## 数据结构

```text
VoiceprintTestMode:
  SHERPA_SINGLE
  SHERPA_MULTI

VoiceprintTestRequest:
  mode: VoiceprintTestMode
  audioWav: 二进制 WAV
  registeredAudioWav: 可选的注册音频列表
  speakerName: 可选的人名

VoiceprintTestResult:
  mode
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
  POST /api/voiceprint/register?name=<speakerName>
  APK 对注册音频执行 Sherpa embedding 提取
  将 embedding 和 speakerName 写入 APK 进程内存声纹库
  返回 embeddingDim 和状态

开始测试:
  页面选择 mode 和 audio
  POST /api/voiceprint/test?mode=SHERPA_SINGLE|SHERPA_MULTI
  body = WAV 二进制
  页面渲染 VoiceprintTestResult
```

## 测试协调器

```text
VoiceprintTestCoordinator.test(request):
  校验 audioWav 存在且可解码
  将 WAV 解码为 16k mono Float32 samples
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

## Sherpa 多人

```text
SherpaMultiEngine.test(samples, db):
  diarized = OfflineSpeakerDiarization.process(samples)
  merged = VoiceprintSegmentMerger.merge(diarized)
  遍历 merged:
    按 start/end 从原始 samples 切片，限制在样本数组范围内
    embedding = SpeakerEmbeddingExtractor.compute(segmentSamples)
    speaker = SpeakerEmbeddingManager.search(embedding, threshold)
    text = sherpa AsrEngine.recognize(segmentSamples)
    失败时保留当前分段并写入 error
  返回 text、start、end、clusterId、speaker、text、error
```

## HTTP 接口

```text
GET /api/voiceprint/status:
  返回两种 Sherpa 模式的模型是否 ready、embeddingDim、threshold

POST /api/voiceprint/register:
  接收 name + audio
  解码音频
  使用 Sherpa SpeakerEmbeddingExtractor 提取 embedding
  写入内存测试库
  返回 {success, name, embeddingDim}

POST /api/voiceprint/test:
  接收 mode 查询参数 + audio，使用进程内注册库
  调用 VoiceprintTestCoordinator.test
  成功返回 {success, mode, embeddingDim, matchedSpeaker, text, segments, elapsedMs, diarizationMs, embeddingMs, asrMs}
  失败返回 {success:false, error}
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
异常回归: 非法 mode 返回 400；错误 Content-Type 返回 400；网页只出现两种 SHERPA 模式。
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
