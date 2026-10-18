# 显示端录音模式与控制端回放实现伪代码

## 数据结构

```text
VoiceRecordingMode = asr | single | realtime

DisplayRecordingSession:
    requestId
    displayId
    controlSocket
    mode
    nextSequence
    timeoutTimer

displayState.voiceRecordingMode = 'asr'
```

## 服务端配置和请求

```text
createDisplayState():
    state.voiceRecordingMode = 'asr'

displayList:
    item.voiceRecordingMode = state.voiceRecordingMode

显示端连接:
    send voiceRecordingConfig { mode: state.voiceRecordingMode }

控制端 setVoiceRecordingMode:
    mode = normalize(asr | single | realtime)
    若显示端不存在: 回传 displayRecordingModeError
    state.voiceRecordingMode = mode
    持久化 display state
    send display voiceRecordingConfig
    广播 displayRecordingModeChanged
    广播 displayList

控制端 requestDisplayRecording:
    读取 displayId + mode
    校验显示端在线、voiceRecording 能力和 mode != asr
    若该显示端已有 session: 回传 displayRecordingResult(error=busy)
    requestId = 生成唯一 ID
    保存 session(requestId, displayId, controlSocket, mode, sequence=0)
    设置 60 秒超时
    send displayRecordingRequest(start, requestId, mode, maxDurationMs=60000)

控制端 stopDisplayRecording:
    按 controlSocket + displayId 找到 session
    send displayRecordingRequest(stop, requestId, mode)

显示端 displayRecordingStatus/chunk/result:
    按 requestId 找 session
    校验 displayId 和消息类型
    只发送给 session.controlSocket
    result 或 error 后删除 session、清理超时
```

## Native PCM 频谱监视图

```text
NativePcmAudioCapture.feedPcm16(base64, sampleRate):
    解码 PCM16 为归一化 samples
    计算 latestRms，继续供 VAD 使用
    将 samples 写入 spectrumSamples 环形窗口
    若窗口达到 FFT_SIZE:
        对窗口乘 Hann 窗
        执行 FFT，计算正频率幅值
        将频率 bin 按对数频段合并为 latestSpectrum
        对频段幅值执行噪声门限、平滑和 0..255 映射

drawNativeMonitor(elapsed):
    latestLevelAt 未超时 -> 平滑读取 latestSpectrum 的每个频段
    latestLevelAt 超时 -> 频谱整体衰减
    每个显示柱读取对应频段高度，不复用同一个 barHeight
```

Native AudioRecord 仍只回传 PCM16；频谱计算在 JavaScript 采集器中完成，RMS 与频谱使用同一批样本，避免改变录音、VAD、WAV 和 ASR 数据流。

## 显示端录音模式

```text
voiceRecordingMode = 'asr'
displayRecordingSession = null

收到 voiceRecordingConfig(mode):
    voiceRecordingMode = normalize(mode)
    若 mode != asr 且 isListening:
        stopVoiceRecording(submitPendingAudio=false)
    若 mode == asr 且自动监听已启用且能力允许:
        startVoiceRecording()

收到 displayRecordingRequest(start, requestId, mode):
    校验 requestId、mode、voiceRecordingMode、voiceRecording 能力
    校验没有其他 displayRecordingSession
    displayRecordingSession = { requestId, mode }
    mode == single:
        使用 PcmAudioCapture(segmentMode=true, preRollMs=300)
        开启现有 VAD
    mode == realtime:
        使用 PcmAudioCapture(streamOnly=true, targetSampleRate=16000)
        每个 PCM 回调编码为 PCM16 base64
        发送 displayRecordingChunk(sequence, sampleRate=16000, audioData)
    开启 60 秒最大时长定时器
    回传 displayRecordingStatus(started)

single VAD 完成:
    wav = takeWav()
    释放本次采集资源
    wav 转 base64
    发送 displayRecordingResult(audioData, mimeType='audio/wav', durationMs)
    不调用 sendAudioForRecognition

收到 displayRecordingRequest(stop):
    single:
        取出当前 WAV；有音频则回传结果，无音频则回传 error=no_speech
    realtime:
        停止采集并回传 displayRecordingResult(completed=true)
    清理 session 和定时器
```

## 控制端播放

```text
选择模式:
    VAD 卡片 select.change -> send setVoiceRecordingMode(displayId, mode)
    树形显示端节点只渲染 voiceListening toggle

single 开始/停止:
    button -> request/stopDisplayRecording
    result.audioData -> Blob(audio/wav) -> 保存本次 Blob 与播放 URL -> Audio.play()
    已收到录音 -> 显示当前显示端的姓名输入框和注册为声纹按钮
    输入姓名 -> 保存当前显示端的草稿，界面重绘后恢复
    点击注册 -> 校验姓名和当前单次录音 Blob -> 锁定按钮
             -> VoiceprintPanel.submitRegistration(name, Blob)
             -> POST /api/voiceprint/register，使用现有声纹提取配置
             -> 显示注册成功或错误，并刷新声纹列表
             -> 解除按钮锁定；新录音替换旧 Blob 后只提交新录音
    播放结束或替换录音 -> revokeObjectURL

realtime:
    started -> 创建 AudioContext，nextPlayTime = currentTime + 0.05
    chunk -> base64 转 PCM16 -> Float32 AudioBuffer(16000Hz)
             source.start(nextPlayTime)
             nextPlayTime += buffer.duration
    completed/error -> 等待已排队音频结束，关闭 AudioContext 并刷新状态
```

## 实际代码映射

```text
PcmAudioCapture(streamOnly, onChunk):
    普通/单次模式保留 chunks，实时模式只回调 Float32 音频块
    encodePcm16 -> 16kHz little-endian PCM16

server-app.js:
    displayRecordingSessions[requestId] = { displayId, controlSocket, mode, nextSequence, timer }
    handleDisplayRecordingMessage -> 只调用 session.controlSocket.send
    handleControlMessageFallback -> 校验模式、能力、归属和 60 秒上限

display.html:
    startVoiceRecording -> 仅 voiceRecordingMode == asr
    handleDisplayRecordingRequest(single) -> VAD/WAV/result
    handleDisplayRecordingRequest(realtime) -> streamOnly/PCM16/chunk/result

device-list.js + websocket.js:
    处理 mode/status/chunk/result
    录音模式、录音按钮、重播按钮及声纹注册表单只由 VAD 卡片渲染
    single 使用可撤销 object URL 播放，realtime 使用单个 AudioContext 排队播放
voiceprint-panel.js:
    submitRegistration 复用已有 multipart 注册接口，普通录音和显示端录音共享同一个请求流程
```
