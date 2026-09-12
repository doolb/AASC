# ASR 内存上传与 VAD 参数统一实现伪代码

## 服务器 ASR 上传

```text
ASR_MAX_AUDIO_BYTES = 10MB

创建 asrUpload:
  使用 multer.memoryStorage()
  限制 fileSize = ASR_MAX_AUDIO_BYTES

parseAsrUpload(request, response, next):
  执行 asrUpload.single("audio")
  如果 Multer 报文件过大:
    返回 413 JSON
  如果其他解析错误:
    返回 400 JSON
  否则 next()

处理 /api/asr/recognize:
  校验 request.file.buffer 存在且非空
  context = 读取 displayId、speechStartAt、speechEndAt
  如果 asr.device == "display":
    audioBase64 = request.file.buffer 转 Base64
    转发 audioBase64 到选中的 ASR 显示端
  否则:
    text = asr.recognize(request.file.buffer)
  根据 text/segments 执行统一显示端语音处理
  返回 JSON
```

## 子显示端 ASR 单次处理

```text
Node 子显示端 VAD 结束:
  通过 HTTP POST /api/asr/recognize 上传 WAV 和 displayId、语音时间上下文
  不再为同一段音频额外发送 voiceInput WebSocket 消息

服务器收到请求:
  执行 ASR
  根据 segments/text 执行声纹门控、显示端唤醒和语音命令处理
  返回完整响应（status、text、segments、ignoredText、reason 等）

Node 收到响应:
  success + segments -> 格式化说话人、相似度、阈值和每段文本
  success + text -> 格式化普通文本或未匹配声纹文本
  ignored + text -> 保留并显示服务器返回的无效文本
  只更新本地 TUI/日志，不重新触发服务器处理
```

## 子显示端 ASR 来源绑定

```text
Node 建立 WebSocket:
  发送 /display?subDisplay=true&displayId=<本地候选ID>
  等待服务器消息 displayId
  保存服务器返回的 data.id 作为 confirmedDisplayId
  confirmedDisplayId 未到达前，不启动普通 ASR 上传

Node 上传 ASR:
  表单携带 displayId = confirmedDisplayId
  请求头携带 X-AASC-Display-Id = confirmedDisplayId
  请求头携带 X-AASC-Display-Kind = subdisplay
  一次上传等待一次服务器响应

服务器解析 ASR 请求:
  requestedDisplayId = X-AASC-Display-Id，缺失时回退表单 displayId
  如果 requestedDisplayId 对应在线 displayClients:
    sourceDisplayId = requestedDisplayId
  否则如果请求明确标记 subdisplay:
    candidates = 在线、isSubDisplay=true 且 ip 等于请求来源 IP 的显示端
    candidates 恰好一个 -> sourceDisplayId = candidates[0].displayId
    其他数量 -> sourceDisplayId = 空
  否则:
    sourceDisplayId = 空

服务器执行结果:
  ASR 始终可以返回识别文本
  sourceDisplayId 非空 -> 执行声纹门控、显示端回显和语音命令处理
  sourceDisplayId 为空 -> 只返回识别结果并记录来源未绑定
  禁止通过 ASR 响应再次发送 voiceInput 触发同一语音段
```

## ASR 音频输入适配

```text
readAudioInput(audioInput):
  如果 audioInput 是 Buffer:
    如果是 RIFF/WAVE:
      返回 parseWavBuffer(audioInput)
    否则:
      convertedWav = ffmpeg 从 stdin 读取 audioInput 并向 stdout 输出 16kHz mono WAV
      返回 parseWavBuffer(convertedWav)
  如果 audioInput 是字符串路径:
    读取路径 Buffer
    WAV 直接解析，其他格式通过 ffmpeg stdin/stdout 管道转换
  否则:
    抛出音频输入类型错误

recognize(audioInput):
  检查模型和队列
  将任务加入既有串行队列
  performRecognition(audioInput):
    audioData = await readAudioInput(audioInput)
    创建 native stream
    acceptWaveform(audioData.samples, audioData.sampleRate)
    decode 并读取 text
    finally 销毁 stream、清空 samples 引用
```

## 独立 ASR 进程

```text
IsolatedAsrProcessClient.recognize(audioInput):
  检查 pendingCount
  fork ASR worker，启用 advanced IPC
  发送 { type: "recognize", id, audioBuffer 或 audioPath, options }
  等待 response/timeout/exit/error

worker 收到 recognize:
  创建 SherpaOnnxASR
  调用 recognize(audioBuffer 或 audioPath)
  回传 { type: "response", id, ok, text }
  退出子进程
```

## VAD 配置

```text
DEFAULT_VAD_THRESHOLD = 0.01
DEFAULT_VAD_SILENCE_DURATION_MS = 500
DEFAULT_VAD_MIN_SPEECH_DURATION_MS = 300

normalizeVadConfig(input):
  threshold = clamp(input.threshold, 0.001, 0.2, 0.01)
  silenceDurationMs = clampInteger(input.silenceDurationMs, 100, 5000, 500)
  minSpeechDurationMs = clampInteger(input.minSpeechDurationMs, 100, 5000, 300)
  返回规范化配置

显示端连接:
  发送 voiceVadConfig(threshold, silenceDurationMs, minSpeechDurationMs)

声纹面板设置全局时长:
  读取 /api/voiceprint/config 的 vadSilenceDurationMs、vadMinSpeechDurationMs
  输入框将两个值限制在 100..5000ms
  POST /api/voiceprint/config 携带两个字段
  服务端归一化并保存 voiceprint.vadSilenceDurationMs、voiceprint.vadMinSpeechDurationMs
  通过 voiceprintConfig 广播给所有在线网页显示端和 Node 子显示端

控制端设置阈值:
  按 displayId 更新并持久化 vadThreshold
  发送完整 voiceVadConfig 到目标显示端

收到 voiceprintConfig:
  网页显示端和 Node 子显示端应用 vadSilenceDurationMs、vadMinSpeechDurationMs
  后续 VAD 分段立即使用新的全局时长
```

## 网页显示端 VAD

```text
收到 voiceVadConfig:
  vadThreshold = message.threshold
  vadSilenceDurationMs = message.silenceDurationMs
  vadMinSpeechDurationMs = message.minSpeechDurationMs

VAD 循环:
  rms >= vadThreshold -> 标记 hasSpeech
  hasSpeech 且 rms < vadThreshold:
    silenceStartTime 未设置 -> 设置当前时间
    当前时间 - silenceStartTime >= vadSilenceDurationMs:
      语音时长 >= vadMinSpeechDurationMs -> 提交当前 WAV
      清空分段状态并恢复检测
```

## Node 子显示端 VAD

```text
AudioRecorder:
  vadThreshold = config.threshold
  vadSilenceDurationMs = config.silenceDurationMs
  vadMinSpeechDurationMs = config.minSpeechDurationMs

处理 PCM 帧:
  rms >= vadThreshold -> 累积语音
  rms < vadThreshold 且已累计语音:
    silenceFrameCount += 当前帧时长
    silenceFrameCount >= vadSilenceDurationMs:
      语音时长 >= vadMinSpeechDurationMs -> 回调 WAV
      清空语音段状态

收到 voiceVadConfig:
  更新 recorder 的三个配置字段
  后续 VAD 帧立即使用新值

收到 voiceVadNoiseTest:
  校验录音器已经启动且当前没有其他底噪检测
  在当前采集循环中收集 durationMs 内每帧 RMS
  计算 averageRms、peakRms、p95Rms
  recommendedThreshold = p95Rms * 1.5，并限制在 0.001..0.2
  通过当前 WebSocket 回传 voiceVadNoiseResult
  录音器不可用、已暂停或检测失败时回传 error

播放期间录音:
  收到 voiceprintConfig 的 pauseRecordingDuringPlayback
  与网页显示端使用相同的默认暂停策略
  关闭暂停时清理远程 TTS 暂停状态并恢复录音器
```

## 测试伪代码

```text
测试 Buffer WAV 解析得到正确采样率和采样值
测试 ASR HTTP 入口使用 memoryStorage，不读取 req.file.path
测试独立进程消息携带 audioBuffer
测试服务器下发 silenceDurationMs = 500
测试声纹面板提交 vadSilenceDurationMs、vadMinSpeechDurationMs
测试 voiceprintConfig 广播全局 VAD 时长并由网页/Node 显示端应用
测试网页端和 Node 端读取动态静音时间
测试 Node 端处理 voiceVadConfig
测试 Node 端按网页规则回显 segments、ignoredText 和 ignored.text
测试 Node 端 ASR 响应不二次发送 voiceInput，工作角色名原文不变
测试 Node 保存并等待服务器确认的 displayId
测试 Node ASR 请求携带 displayId 和 subdisplay 来源头
测试服务器优先绑定在线 displayId，失效 ID 只在唯一子显示端 IP 候选时回退
测试来源无法绑定时仍回显 ASR，但不进入语音命令处理
测试旧的声纹注册临时文件链路仍然存在
```
