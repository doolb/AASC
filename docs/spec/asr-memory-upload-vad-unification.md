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

控制端设置阈值:
  按 displayId 更新并持久化 vadThreshold
  发送完整 voiceVadConfig 到目标显示端
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
测试网页端和 Node 端读取动态静音时间
测试 Node 端处理 voiceVadConfig
测试旧的声纹注册临时文件链路仍然存在
```
