# 服务端统一处理显示端 ASR 与声纹结果实现伪代码

## 显示端 ASR 长语音分流与远端配置（2026-10-18，已确认）

```text
已有声明 := /api/asr/recognize、sendAudioToDisplayAsr、asrAudio/asrResult、Android AsrEnginePool
新增定义 := DisplayAsrLongQueueConfig { thresholdSeconds: 10, concurrency: 1 }；整数范围 1..120 秒、1..8 条
新增定义 := DisplayAsrLongQueue { 按目标 displayId 隔离, 每目标在途长任务 <= concurrency, FIFO 等待列表 <= 8 }
控制端 := 语音识别设备面板读取权威 asrLongQueueConfig；修改阈值和并发后发送 setAsrLongQueueConfig { type, thresholdSeconds, concurrency, requestId }
服务端 := 严格校验类型和范围 → config.set('asr.displayLongQueue', 规范化值) → 广播 asrLongQueueConfig；失败回传原权威值
初始化 := 控制端连接/重连收到当前 asrLongQueueConfig；断线显示默认值并禁用保存；无新 HTTP 配置接口
操作流程 := 从有效 WAV 容器计算实际音频时长；无法解析时使用合法录音起止时间，仍未知则按旧直通路径处理
操作流程 := 时长 < thresholdSeconds → 直接调用现有 sendAudioToDisplayAsr；其余 → 目标显示端长队列等待准入 → 下发 asrAudio
操作流程 := 长队列运行时改并发 → 升高立即启动等待项，降低只约束后续准入、不取消在途识别
操作流程 := HTTP 客户端在等待期间断开 → 清除排队任务；长任务完成/失败 → 释放额度并启动下一项
操作流程 := 等待上限溢出 → 明确返回繁忙；显示端 60 秒超时从真正下发时开始，保留原 requestId 与结果处理契约
自测 := 配置校验/持久化/广播/重连、多控制端同步；同目标并发上限与运行时变更、不同目标独立、短任务直通、时长边界、断线/失败释放与队列满回错
状态 := 已实现服务端按目标显示端排队、控制端远端配置和离线定向测试；待真机验收
```

## 请求与响应契约

```text
显示端提交 multipart/form-data：
  audio: WAV 文件
  displayId: 当前显示端持久化 ID
  speechStartAt: 可选，录音开始时间戳（毫秒）
  speechEndAt: 可选，录音结束时间戳（毫秒）

服务端返回：
  status: success | ignored | error
  text: 单段文字（兼容字段）
  speaker: 单段说话人（可为 null）
  similarityScore: 单段分数
  threshold: 当前阈值
  segments: 服务端合并后的分段
    - text
    - speaker（可为 null）
    - start/end（存在时保留）
    - similarityScore（单段分数）
    - similarityScores（合并分数列表）
    - threshold

服务端 asrResult 日志配置：
  voiceprint.asrResultDetailLog = true（默认）
  控制端开关修改后通过 POST /api/voiceprint/config 保存
  服务端将字段通过 voiceprintConfig 广播给在线显示端（用于配置同步）

来源字段约束：
  浏览器显示端只在 multipart/form-data 中发送 displayId，不发送 X-AASC-Display-Id 请求头
  displayId 必须与建立 /display WebSocket 时使用的持久化 ID 相同
  服务端只通过 req.body.displayId 绑定在线显示端，不按 IP 猜测浏览器来源
```

TTS 期间无声纹语音配置：

```text
voiceprint.acceptVoiceInputDuringTtsWithoutVoiceprint = false（默认）

GET /api/voiceprint/config：
  返回 acceptVoiceInputDuringTtsWithoutVoiceprint
  缺失或非法值按 false 返回

POST /api/voiceprint/config：
  如果 acceptVoiceInputDuringTtsWithoutVoiceprint 存在且不是布尔值：
    返回 400，不修改配置
  如果字段存在：
    保存 voiceprint.acceptVoiceInputDuringTtsWithoutVoiceprint

控制端声纹面板：
  初始化复选框为 response.acceptVoiceInputDuringTtsWithoutVoiceprint === true
  修改时随现有声纹配置请求提交该字段
```

## 服务端处理伪代码

```text
处理 /api/asr/recognize 请求：
  校验 audio
  读取 displayId、请求起止时间
  调用 server ASR 或指定的 ASR 显示端
  归一化文字和 segment 字段

  如果存在 segments：
    保留有文字的所有分段，包括 speaker=null
    segments = mergeAdjacentSameSpeakerSegments(segments)
    对每个 segments：
      转换为 voiceInput
      补充绝对 speechStartAt/speechEndAt
      processDisplayVoiceInput(displayId, voiceInput)
    返回 segments 和 ignoredText 兼容字段

  如果只有 text：
    保留 speaker、similarityScore、threshold
    当 displayId 对应在线显示端时：
      processDisplayVoiceInput(displayId, voiceInput)
      返回原识别结果

显示端 WebSocket 回传 asrResult：
  先将当前消息规范化为 logData（完成态消息使用已聚合字段，普通 asrResult 使用原消息）
  读取 voiceprint.asrResultDetailLog
  如果开关为 true：
    formatAsrResultLog(logData, true)
    日志打印 requestId、总文字、顶层 speaker/similarityScore/threshold/error
    日志逐段打印 text、start、end、clusterId、speaker、similarityScore、threshold、error
  如果开关为 false：
    formatAsrResultLog(logData, false)
    日志只打印 requestId、总文字和错误摘要
  继续执行原有 pending ASR 请求响应，不改变结果处理
```

## 浏览器显示端来源伪代码

```text
显示端初始化:
  displayId = ''

connectWebSocket():
  persistentId = getPersistentDisplayId()
  displayId = persistentId
  连接 /display?displayId=persistentId

收到服务端 displayId 消息:
  displayId = data.id

sendAudioForRecognition(audioBlob, timing):
  requestDisplayId = trim(displayId)
  如果 requestDisplayId 为空:
    requestDisplayId = getPersistentDisplayId()
  formData.append('audio', audioBlob)
  formData.append('displayId', requestDisplayId)
  formData.append('speechStartAt', timing.speechStartAt)
  formData.append('speechEndAt', timing.speechEndAt)
  POST /api/asr/recognize(formData)
```

## 合并伪代码

```text
mergeAdjacentSameSpeakerSegments(segments):
  result = []
  for segment in segments 按原顺序：
    normalize(segment)
    if segment.text 为空：continue
    previous = result.last
    if previous 存在 且 previous.speaker 非空 且 previous.speaker == segment.speaker：
      previous.text += segment.text
      previous.end = segment.end
      previous.similarityScores += segment.similarityScore
      previous.clusterIds += segment.clusterId
    else：
      result.push(copy(segment))
  return result
```

## 统一语音输入伪代码

```text
processDisplayVoiceInput(displayId, data):
  根据 voiceprint.enabled 决定是否执行跨显示端去重
  重复结果直接结束
  广播 voiceInput 到控制端，包含 speaker、similarityScore、threshold
  如果声纹启用且 speaker=null：
    记录“未识别声纹，仅回传”并结束
  如果声纹未启用 且 TTS 播放计时器非空
      且 acceptVoiceInputDuringTtsWithoutVoiceprint != true：
    记录 TTS 播放期间忽略无声纹输入并结束
  如果声纹未启用 且 TTS 播放计时器非空
      且 acceptVoiceInputDuringTtsWithoutVoiceprint == true：
    继续进入修复模式或显示端会话门控
  如果命中修复模式：转入修复模式输入
  否则执行显示端会话门控
  通过唤醒门控后，转入现有 voiceCommand 处理链路

服务器 ASR 音频流入口：
  使用相同的声纹开关、TTS 播放计时器和配置值判断是否忽略识别结果
  新配置打开时不在 ASR 音频流入口提前丢弃结果
```

## 显示端伪代码

```text
sendAudioForRecognition(audioBlob, timing):
  formData.append(audioBlob)
  formData.append(displayId)
  formData.append(timing.speechStartAt/speechEndAt)
  response = POST /api/asr/recognize
  显示服务端返回的合并分段
  不再发送 voiceInput WebSocket
```

旧版显示端发送的 `voiceInput` 仍由 WebSocket 适配层调用同一个 `processDisplayVoiceInput`。

## 实现对应

- ASR 日志格式化：`src/apps/server/modules/asr/asr-result-log-formatter.js`
- 分段合并：`src/apps/server/modules/voice/voiceprint-segment-grouper.js`
- HTTP ASR 入口及统一语音处理：`src/apps/server/boot/server-app.js`
- 显示端上传和回显：`src/apps/web-mediacenter/ui/public/display.html`
- 控制端最近识别面板的声纹诊断字段：`src/apps/web-mediacenter/ui/public/js/device-list.js`
- 控制端详细日志开关：`src/apps/web-mediacenter/ui/public/upload.html`、`src/apps/web-mediacenter/ui/public/js/voiceprint-panel.js`
- TTS 播放期间无声纹输入开关：`upload.html`、`voiceprint-panel.js`、`server-app.js`、`config-app-service.js`
- 浏览器显示端来源绑定回归：`tests/display-asr-audio-pipeline.test.js`
