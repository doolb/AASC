# 独立 Android 声纹对比测试 APK 实现文档（伪代码）

## 数据结构

```text
VoiceprintTestMode:
  WESPEAKER_SINGLE
  WESPEAKER_MULTI
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
  similarity
  segments: [{start, end, clusterId, speaker, text?}]
  elapsedMs: {total, load, embedding, match, diarization, asr}
  error
```

## 网页流程

```text
页面加载:
  GET /health
  GET /api/voiceprint/status
  显示 ASR/WeSpeaker/Sherpa 模型状态

选择音频:
  用户选择 WAV 或网页录音
  页面校验扩展名和非空文件

注册声纹:
  用户填写 speakerName 并选择注册 WAV
  POST /api/voiceprint/register
  APK 对注册音频执行 WeSpeaker embedding 提取
  将 embedding 和 speakerName 写入测试页临时声纹库
  返回 embeddingDim 和状态

开始测试:
  页面选择 mode 和 audio
  POST /api/voiceprint/test
  body = multipart(audio, mode, registeredDb)
  页面渲染 VoiceprintTestResult
```

## 测试协调器

```text
VoiceprintTestCoordinator.test(request):
  校验 audioWav 存在且可解码
  将 WAV 解码为 16k mono Float32 samples
  根据 mode 选择唯一 engine
  记录总耗时
  调用 engine.test(samples, registeredDb)
  将阶段耗时、embeddingDim、匹配结果、分段和错误合并
  返回 VoiceprintTestResult
```

## WeSpeaker 单段

```text
WeSpeakerSingleEngine.test(samples, db):
  embedding = WeSpeakerRuntime.extractEmbedding(samples)
  对 embedding 做 L2 归一化
  遍历 db:
    candidateScore = cosine(embedding, registeredEmbedding)
    保留最高分和对应 speaker
  如果最高分 >= threshold:
    返回 matchedSpeaker 和 similarity
  否则:
    返回 matchedSpeaker=null 和 similarity=最高分
```

## WeSpeaker 多人

```text
WeSpeakerMultiEngine.test(samples, db):
  segments = WeSpeakerRuntime.diarize(samples)
  遍历 segments:
    从原始 samples 切片
    embedding = WeSpeakerRuntime.extractEmbedding(segmentSamples)
    对 embedding 做 L2 归一化
    用 cosine 与 db 匹配
    低于 threshold 的 speaker 保留为 null
    对该片段执行 ASR，保存 text
  按时间顺序返回所有 segments
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
  遍历 diarized:
    按 start/end 从原始 samples 切片
    embedding = SpeakerEmbeddingExtractor.compute(segmentSamples)
    speaker = SpeakerEmbeddingManager.search(embedding, threshold)
    text = sherpa AsrEngine.recognize(segmentSamples)
    返回 start、end、clusterId、speaker、text
```

## HTTP 接口

```text
GET /api/voiceprint/status:
  返回四种模式的模型是否 ready、embeddingDim、threshold

POST /api/voiceprint/register:
  接收 name + audio
  解码音频
  使用当前 WeSpeaker runtime 提取 embedding
  写入内存测试库
  返回 {success, name, embeddingDim}

POST /api/voiceprint/test:
  接收 mode + audio + 可选测试库
  调用 VoiceprintTestCoordinator.test
  成功返回 {success, result}
  失败返回 {success:false, error}
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
