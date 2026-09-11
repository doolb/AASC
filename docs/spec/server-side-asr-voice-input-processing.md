# 服务端统一处理显示端 ASR 与声纹结果实现伪代码

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
  读取 voiceprint.asrResultDetailLog
  如果开关为 true：
    日志打印 requestId、总文字、顶层 speaker/similarityScore/threshold/error
    日志逐段打印 text、start、end、clusterId、speaker、similarityScore、threshold、error
  如果开关为 false：
    日志只打印 requestId、总文字和错误摘要
  继续执行原有 pending ASR 请求响应，不改变结果处理
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
  如果命中修复模式：转入修复模式输入
  否则执行显示端会话门控
  通过唤醒门控后，转入现有 voiceCommand 处理链路
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
