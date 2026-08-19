# Android 显示端原生声纹识别实现文档（伪代码）

## 桥接口（window.NativeDisplay）

```
voiceprintStatus() -> String JSON          # {"ready":bool,"dim":512,"speakers":["妲己"]}
voiceprintConfigure(configJson) -> String  # {"enabled":bool,"threshold":0.5,"multiSpeaker":bool}；触发模型下载+引擎加载；异步经 onVoiceprintModel 回调
voiceprintMatch(pcmBase64) -> String JSON  # 单段匹配：{"speaker":人名|null} 或 {"error":""}；同步阻塞≤20s
voiceprintDiarize(pcmBase64) -> String JSON# 多人分割：{"segments":[{start,end,text,speaker}]} 或 {"error":""}；同步阻塞≤30s
voiceprintExtract(pcmBase64) -> String JSON# 注册中转：{"dim":512,"embedding":[...]} 或 {"error":""}
voiceprintSyncDb(dbJson) -> String         # 接收 display.html 拉取的权威库 JSON，重建本地库；结果经 onVoiceprintDb 回调
window.onVoiceprintModel({state,progress,error,engineReady})  # 模型下载/引擎加载
window.onVoiceprintDb({state:'ready'|'error', speakers, error})  # 声纹库同步结果
```

## VoiceprintDbCodec（纯逻辑，JVM 单测）

```
speakersFromDb(dbJson) -> Map<String,FloatArray>  # 解析 {version,dim,speakers:{name:[...]}}
toJson(speakers) -> JSONObject                    # 序列化
```

## VoiceprintModelManager（Kotlin）

```
模型: embedding 3dspeaker eres2net(512维, 必下) + segmentation pyannote int8(multiSpeaker 才下)
ensureModel(baseUrl, needSegmentation, onEvent):
  ready/downloading 短路；后台线程 ModelDownloader.download（SSL-trust）→ ready|error
```

## VoiceprintEngine（Kotlin 单例，synchronized）

```
load(context, embeddingModel, segmentationModel?, threshold, multiSpeaker) -> Boolean
  # embeddingModel/segmentationModel 是 APK 私有目录绝对路径
  # SpeakerEmbeddingExtractor(null, config) + SpeakerEmbeddingManager(dim) + 可选 OfflineSpeakerDiarization(null, config)
  # 外部文件不能传非空 AssetManager，否则 sherpa-onnx 会按 APK assets 读取并加载失败
setDb(speakers: Map<String,FloatArray>)  # 全量重建 manager
extract(samples) -> FloatArray           # createStream → acceptWaveform(16000) → inputFinished → compute → stream.release
match(embedding) -> String?              # manager.search(embedding, threshold)；低于 threshold → null
diarize(samples) -> [{start,end,speakerIndex}]  # OfflineSpeakerDiarization.process
```

## NativeBridge（6 桥方法）

```
voiceprintStatus()            → VoiceprintEngine.ready/dim/speakers
voiceprintConfigure(json)     → 存 enabled/threshold/multiSpeaker → voiceprintModelManager.ensureModel{ ready 时 VoiceprintEngine.load }
voiceprintMatch(pcm)          → 未就绪回 error；Base64.decode→AsrPcm.decodeS16→extract→match → {speaker|null,dim}
voiceprintDiarize(pcm)        → diarize→按 speakerIndex 合并原始 PCM→extract/match→按同名 speaker 合并原始 PCM→AsrEngine.recognize → {segments:[{start,end,text,speaker}]}
voiceprintExtract(pcm)        → extract → {dim, embedding:[]}
voiceprintSyncDb(dbJson)      → VoiceprintDbCodec.speakersFromDb→VoiceprintEngine.setDb→onVoiceprintDb
```

## display.html（接入点）

```
全局: nativeVoiceprintAvailable/nativeVoiceprintEnabled/nativeVoiceprintReady/nativeVoiceprintMultiSpeaker
onVoiceprintModel: ready+engineReady → voiceprintReady=true；error → false
onVoiceprintDb: ready → voiceprintReady=true，log 人数
detectCapabilities: voiceprintAvailable = nativeVoiceprintAvailable
WS voiceprintConfig → 存 enabled/multiSpeaker → voiceprintConfigure + fetch('/api/voiceprint/db')→voiceprintSyncDb
WS speakerDbUpdated → fetch db → voiceprintSyncDb（静默）
WS voiceprintExtract → voiceprintExtract(audioBase64) → 回 voiceprintExtracted{embedding}
handleAsrAudio 原生路径:
  voiceprint enabled+ready:
    multiSpeaker → voiceprintDiarize → asrResult{segments}
    单段 → asrRecognize + voiceprintMatch → asrResult{text, speaker: vp.error?缺省: (vp.speaker||null)}
  否则 → 纯 asrRecognize → asrResult{text}（speaker 缺省放行）
sendAudioForRecognition:
  data.segments → 逐段发 voiceInput{text, speaker}
  data.speaker !== undefined → voiceInput 带 speaker
```

## 服务器（server-app.js）

```
GET  /api/voiceprint/model/<file>       # 白名单 {embedding, pyannote int8}；流式 + Content-Length + error/close 清理
GET  /api/voiceprint/config             # {enabled, extraction, threshold, multiSpeaker}
POST /api/voiceprint/config             # 校验 + 保存 + 广播 voiceprintConfig
GET  /api/voiceprint/db                 # {version, dim, speakers}
POST /api/voiceprint/remove             # 删除某 name 声纹
POST /api/voiceprint/register           # multipart(audio+name)；extraction='server'→voiceprint-service 提取 / 'display'→中转 APK
WS  voiceprintExtract(requestId, audioBase64) → APK 回 voiceprintExtracted{embedding}
WS  speakerDbUpdated                     # 库变更广播
asrResult resolve 升级: {text, speaker?, segments?}
/api/asr/recognize display 分支:
  segments → 过滤 speaker null 段 → 空 ignored / 有则 {status:'success', segments:[{text,speaker}]}
  speaker 字段存在且 null → ignored('未识别到已注册声纹')；非 null → success{text,speaker}；缺省 → success{text}
voiceInput: speaker===null → 丢弃（防御性）；否则转发（带 speaker）
```

## VoiceprintSegmentMerger（Android 纯逻辑）

```
merge(classifiedSegments):
  按 diarization 原顺序遍历 {start,end,speakerIndex}
  speakerIndex 相同且相邻 → 合并原始 start/end 区间
  speakerIndex 不同 → 创建新的原始音频区间
voiceprintDiarize:
  diarize → VoiceprintSegmentMerger.merge
  每个 index 合并区间从原始 PCM 切片 → extract/match 一次
  再按相同的 speaker 名合并原始区间；短于 1 秒的未匹配间隔视为分段边界，可合并；较长未知区间阻断合并
  最终合并区间 → AsrEngine.recognize 一次
  返回重识别后的 {start,end,text,speaker}
```

## 真机验证记录（2026-08-19）

```text
注册：POST /api/voiceprint/register，audio=3rd/ttslive/models/sensevoice/zh.wav，name=测试声纹 → success，dim=512
识别：POST /api/asr/recognize，audio=同一个 zh.wav
结果：success，segments[0].text="开饭时间早上9点至下午5点。"，segments[0].speaker="测试声纹"
混合测试：串接 zh.wav + en.wav → 仅返回一段完整 zh 文本“开放时间早上9点至下午5点。”，en 片段未返回
重叠混音：zh.wav 与 en.wav 同时叠加 → ignored("未识别到已注册声纹")，segments=[]
原始片段合并复测：zh.wav → 单段“开饭时间早上9点至下午5点。”；zh.wav + en.wav → 单段“开放时间早上9点至下午5点。”，speaker 均为“测试声纹”
```

## voiceprint-service（服务器，extraction='server' 注册用）

```
懒加载 SpeakerEmbeddingExtractor(3dspeaker eres2net) → extractEmbedding(audioPath) → Array(512)
```

## 控制端（upload.html + voiceprint-panel.js）

```
输入名字 + getUserMedia 录音(3-10s) → POST /api/voiceprint/register → 列表刷新
GET /api/voiceprint/db → 列表显示 + 删除
GET/POST /api/voiceprint/config → enabled/multiSpeaker/extraction 切换
chat.js: sendAudioForRecognition → data.segments 逐段 / data.speaker 归属
```

## 数据流

```
识别（单段）: 录音→/api/asr/recognize→asrAudio→display.html [asrRecognize+voiceprintMatch]
  → asrResult{text,speaker}→服务器: speaker null→ignored；非 null→success{text,speaker}→上传端 voiceInput{text,speaker}→voiceCommand
识别（多人）: asrAudio→voiceprintDiarize→asrResult{segments}→服务器过滤 null 段
  → success{segments:[{text,speaker}]}→上传端逐段 voiceInput→逐段命令
注册（server）: 控制端录音→/api/voiceprint/register→voiceprint-service 提取→store.add→持久化+广播
注册（display）: 控制端录音→register→中转 APK voiceprintExtract→回 embedding→store.add→广播
库同步: APK connect/变更→fetch /api/voiceprint/db→voiceprintSyncDb→本地重建
```
