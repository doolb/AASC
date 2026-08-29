# 显示端语音唤醒与监听控制实现文档

## 服务端状态与控制

```text
createDisplayState():
    capabilities.voiceRecording 保持物理录音能力和用户监听开关
    voiceConversation = {
        state: 'waitingWake',
        target: null,
        lastValidInputAt: null
    }

控制端 updateCapabilities(displayId, capabilities):
    保存目标显示端 userCapabilities
    如果 capabilities.voiceRecording 为 false:
        发送 capabilitiesUpdated
        将目标 voiceConversation.state 设为 disabled
    如果 capabilities.voiceRecording 为 true:
        发送 capabilitiesUpdated
        将目标 voiceConversation.state 设为 waitingWake

显示端 voiceInput(text):
    如果目标不存在或 capabilities.voiceRecording !== true:
        丢弃输入
    text 非空 -> 先广播 voiceInput 到控制端，用于显示最新 ASR 结果
    启用声纹且 speaker == null -> 只停止命令处理，不撤销已广播的文字
    如果目标是旧 Go/C#/Node 子显示端:
        沿用原有语音命令流程，不启用唤醒状态机
    如果当前为 disabled:
        丢弃输入
    如果当前为 waitingWake:
        若匹配内置功能指令:
            转交现有 voiceCommand 处理，不改变会话状态
        否则若匹配唤醒词:
            设置 activeGroup 或 activePrivate
            发送唤醒确认
        否则丢弃普通文本
    如果当前为 activeGroup/activePrivate:
        若匹配结束/退出命令:
            更新状态并发送确认
        否则将文本交给现有 voiceCommand 处理
        有效输入更新 lastValidInputAt

waitingWake 中的免唤醒范围:
    包含报时、提醒、静音、取消静音、天气、搜索、播放、停止播报、确认、取消、录音控制和指令模式开关等现有内置功能指令
    不包含普通聊天、自定义关键词命令、你好小爱/结束对话/退出私聊等会话控制词
    内置功能指令执行完成后仍保持 waitingWake，不启动普通对话计时器

控制端加载内置命令:
    Chat.init 或 WebSocket 重连 -> 发送 { type: 'getBuiltinVoiceCommands' }
    服务端 -> 返回 { type: 'builtinVoiceCommands', commands }
    Chat.handleBuiltinCommands(data) -> 保存 commands -> 刷新系统指令帮助弹窗
    每条 command 包含 id、examples、description、wakeRequired=false
    弹窗展示示例、说明和“无需唤醒”标记

系统指令语音帮助:
    isBuiltinVoiceCommand('系统。') == true
    processVoiceCommand('系统。') -> { type: 'showHelp' }
    getVoiceCommandHelpText():
        读取 getBuiltinVoiceCommands()
        读取 chat.getCommands() 中的自定义关键词和动作
        加入私聊、退出私聊、系统记录等会话/系统指令说明
        按当前配置拼接完整帮助播报文本
    服务端收到 showHelp:
        控制端发送 showHelp 打开帮助弹窗
        显示端来源通过 sendVoiceInputTts(helpText) 走通用 TTS 广播

显示端语音输入 TTS:
    服务端识别到 voiceInput 后记录 sourceDisplayId
    sourceDisplayId 只用于命令执行、媒体控制和结果界面，不直接作为 TTS 目标
    为语音命令注入 onTts(text) 回调
    onTts:
        audioPath = generateTtsWithFallback(text)
        targetDisplayIds = getOnlineVoicePlaybackDisplayIds()
        对每个 targetDisplayId 发送:
            { type: 'tts', action: 'playAudio', audioUrl, text }
    语音命令服务的所有响应（报时、提醒、静音、天气、搜索、播放、录音、停止播报）调用 speakVoiceResponse
    speakVoiceResponse 不直接导入或调用底层 tts.generateTTS
    需要弹窗/选择数据时，仍向 sourceDisplayId 发送不带 audioUrl 的 voiceCommand 消息
    天气响应发送:
        text = 天气短摘要，用于 TTS
        detailText = 完整天气详情，用于显示端弹窗
        weather = 本地归一化后的结构化天气对象
        旧显示端只读取 text 时保持兼容
    语音触发的普通对话使用 routeVoiceToAll=true，在每句 TTS 完成时重新读取在线 voicePlayback 目标

控制端语音命令兼容:
    playOnControl=true -> 继续通过 onResult/onError 生成并发送 playOnControl
    其他控制端语音命令 -> 使用 generateTtsWithFallback(text, ..., targetDisplayId)
    播放目标仍为控制端指定的 targetDisplayId，不套用显示端语音输入的广播目标

停止播报:
    显示端来源 -> 向全部在线 voicePlayback 显示端发送 tts.stop
    控制端来源 -> 只向 targetDisplayId 发送 tts.stop

显示端 TTS 队列结束:
    若监听开关仍开启且没有新的 LLM/TTS 任务:
        进入 waitingTts 或保留当前激活状态
        启动 180000ms 计时器
    计时器到期:
        状态改为 waitingWake
        清理当前助手目标

VAD 配置:
    createDisplayState().vadThreshold = 0.01
    显示端连接时发送 voiceVadConfig(vadThreshold)
    控制端发送 setVoiceVad(displayId, vadThreshold)
    服务端校验阈值范围并按 displayId 持久化
    服务端发送 voiceVadConfig 到目标显示端并广播 displayList
    显示端运行 VAD 时读取当前 vadThreshold

底噪检测:
    控制端发送 detectVoiceNoise(displayId, requestId)
    服务端转发 voiceVadNoiseTest 到目标显示端
    显示端确认麦克风监听和 Analyser 可用
    连续采样约 3000ms 的麦克风 RMS
    检测期间不执行语音段结束和 ASR 提交
    计算 sampleCount、averageRms、peakRms、p95Rms
    recommendedThreshold = clamp(p95Rms * 1.5, 0.001, 0.2)
    显示端回传 voiceVadNoiseResult
    服务端转发结果到控制端，控制端显示数值和建议阈值

持续监听资源生命周期:
    startVoiceRecording():
        如果 micStream、pcmCapture、analyser 已存在:
            只恢复 isListening 和 VAD 检测循环
            不重新 getUserMedia，不重新创建 AudioContext
        否则创建一次 micStream、PCM AudioContext 和 AnalyserNode

    finishVoiceSegment():
        audioBlob = takeRawPcmWav()
        仅清空当前 PCM chunks
        不调用 stopRawPcmCapture，不调用 stopSilenceDetection
        继续复用当前采集链路进行下一段检测

    ignored 或异常重启:
        releaseVoiceRecordingResources()
        停止媒体轨道、断开节点、关闭 AudioContext、取消检测循环
        再按需要启动下一次监听

    关闭监听/页面离开/冷却:
        调用同一个幂等 releaseVoiceRecordingResources()

TTS 与无声纹持续监听:
    PcmAudioCapture.setPaused(true):
        paused = true
        清空当前 chunks、preRollChunks 和段状态
        保留 AudioContext、MediaStreamSource、ScriptProcessor 和媒体轨道
    PcmAudioCapture.setPaused(false):
        paused = false
        清空恢复前残留缓冲
    playNextTts():
        如果开始处理第一个 TTS 且 voiceprintEnabled !== true 且正在持续监听:
            pauseVoiceRecordingForTts()
        队列还有项目 -> 继续播放，不重复暂停/恢复
        队列为空 -> resumeVoiceRecordingAfterTts()
    pauseVoiceRecordingForTts():
        记录本次 TTS 前是否正在监听
        停止 VAD 检测循环
        标记 isListening = false
        调用 pcmCapture.setPaused(true)
    resumeVoiceRecordingAfterTts():
        仅恢复本次 TTS 前正在监听且监听开关仍开启的显示端
        调用 pcmCapture.setPaused(false)
        重置 hasSpeech、speechStartTime、silenceStartTime
        标记 isListening = true 并重新启动 VAD 检测
    声纹已开启或 TTS 前未在持续监听:
        不进入上述暂停恢复流程

浏览器显示端 VAD 分段缓存:
    startRawPcmCapture(stream):
        PcmAudioCapture.start(stream, segmentMode=true, preRollMs=300)
        持续采集期间只维护短前置循环缓冲
    VAD 首次检测到 rms >= vadThreshold:
        pcmCapture.beginSegment()
        将前置循环缓冲并入当前语音段
        后续 PCM 帧写入当前语音段
    VAD 未检测到语音:
        不写入当前语音段，避免上一段之后的长静音上传 ASR
    finishVoiceSegment():
        继续收集判停所需的尾部静音
        audioBlob = takeRawPcmWav()
        提交包含短前置缓冲、语音和判停尾静音的 WAV
        清空当前段，继续复用同一个采集链路
```

## 显示端实现伪代码

```text
onCapabilitiesUpdated(data):
    listeningEnabled = data.capabilities.voiceRecording === true
    如果 listeningEnabled 为 false:
        stopVoiceRecording()
        clearConversationTimer()
        conversationState = 'disabled'
    否则如果之前为 disabled:
        conversationState = 'waitingWake'
        startVoiceRecording()

onRecognizedText(text):
    updateVoiceTextDisplay(text, true)
    如果 listeningEnabled 为 false:
        return
    发送 voiceInput，由服务端按显示端状态决定是否处理

onTtsAudioEnded():
    播放下一段；只有队列为空时调用 onTtsQueueFinished()

onTtsQueueFinished():
    如果监听关闭:
        return
    clearConversationTimer()
    conversationTimer = setTimeout(enterWaitingWake, 180000)
                    startVoiceRecording()

reportVoiceAvailability(available):
    voiceSupported = (available == true)
    不覆盖 currentCapabilities.voiceRecognition（它表示本地 ASR 提供能力）
    发送 voiceStatus(supported=voiceSupported, listening=isListening)
    发送最新 capabilities

checkAsrStatus 完成:
    公共服务端 ASR 状态确定后调用 reportVoiceAvailability
    异常或服务不可用调用 reportVoiceAvailability(false)

完整 detectCapabilities 完成:
    currentCapabilities = full
    // full.voiceRecognition 仅表示本显示端是否可被服务器选为提供端
    发送 capabilities
    发送 voiceStatus

原生 ASR 模型 ready:
    更新 capabilities.voiceRecognition；不改变 voiceSupported

## 统一服务端 ASR 识别链路

checkAsrStatus():
    GET /api/asr/status
    ready == true -> reportVoiceAvailability(true)
    其他结果或异常 -> reportVoiceAvailability(false)

startVoiceRecording():
    getUserMedia(audio)
    PcmAudioCapture.start(stream)
    VAD 检测到语音结束 -> takeWav()
    POST /api/asr/recognize(audio=wav)

sendAudioForRecognition(wav):
    POST /api/asr/recognize
    服务端 device=server -> 服务端 ASR 识别
    服务端 device=display -> 按 displayClients 当前连接顺序选择第一个 voiceRecognition=true 的显示端
    读取公共接口统一返回
    segments 非空 -> 逐段发送 voiceInput(text, speaker)
    否则 text 非空 -> 发送 voiceInput(text, speaker)
    ignored/error -> 按公共接口结果处理并恢复下一段监听

录音显示端:
    共享上述录音和 POST /api/asr/recognize 流程，不调用自己的 ASR

被选中的 APK ASR 提供端:
    接收服务器 asrAudio
    使用 NativeDisplay.asrRecognizeAsync/asrRecognize 回传 asrResult
    仅作为服务器选择的识别执行节点，不作为录音端本地识别入口
```

## 声纹关闭语义

```text
voiceprintConfig.enabled = false:
    display.html 设置 useVoiceprint = false
    原生 ASR 继续识别
    不执行 voiceprintMatch/voiceprintDiarize
    asrResult 不携带 speaker
    server 以普通文本继续执行唤醒和对话流程
```

## 协议

- 继续使用 `updateCapabilities`/`capabilitiesUpdated` 的 `voiceRecording` 字段控制每个显示端监听。
- 继续使用 `voiceprintConfig` 控制全局声纹算法开关。
- `voiceInput` 继续携带 `displayId`，服务端先向控制端回传有效文字，再按目标显示端状态和声纹匹配结果决定是否进入命令处理。

## 控制端显示监听状态与 ASR 回传

```text
DeviceList:
    displayVoiceInputs = Map<displayId, { text, isFinal, timestamp }>

收到 displayList:
    保留在线显示端对应的 displayVoiceInputs
    渲染每个显示端的监听开关、监听状态和最近识别文本

收到 voiceInput(displayId, text, isFinal, speaker):
    displayVoiceInputs[displayId] = { text, isFinal, timestamp: now }
    调 DeviceList.render()
    新结果覆盖该 displayId 的旧结果，只保留最新一条
    继续调用 Chat.handleDisplayVoiceInput(data)

点击监听开关(displayId, enabled):
    读取目标显示端当前 capabilities
    只修改 capabilities.voiceRecording = enabled
    发送 updateCapabilities(displayId, capabilities)
    服务端广播 capabilitiesUpdated 和 displayList

VAD 独立卡片:
    DeviceList.renderVoiceVadPanel():
        读取 window.currentDisplayId 并定位当前在线显示端
        当前未选择显示端 -> 显示“请选择显示端”
        当前已选择显示端 -> 在 voiceVadPanel 中渲染一张卡片
        卡片包含 vadThreshold 输入、detectVoiceNoise 按钮和统计结果
        不把 VAD 控件渲染到设备列表的 renderVoiceControl/renderVoiceControlHtml
    设备列表仍只显示监听开关、监听状态和最近识别文字

监听状态显示:
    voiceSupported=false -> 不可用
    capabilities.voiceRecording=false -> 已关闭
    voiceListening=true -> 监听中
    conversation.state=waitingWake -> 等待唤醒
    其他已启用状态 -> 已启用

## 控制端监听开关可靠发送

```text
renderVoiceControl(display):
    创建 checkbox
    checkbox.checked = display.capabilities.voiceRecording == true
    checkbox.onchange(event):
        停止事件冒泡
        updateCapability(display.id, 'voiceRecording', event.target.checked)
    updateCapability:
        发送 updateCapabilities(displayId, 完整 capabilities)
        服务端广播 displayList 后用 voiceRecording 更新 checkbox 和状态

语音设备选项:
    在 panel-voiceprint 内保留 asrDeviceServerBtn/asrDeviceDisplayBtn
    在 panel-voiceprint 内保留 ttsDeviceServerBtn/ttsDeviceDisplayBtn
    AsrDevice/TtsDevice 继续通过原配置接口加载和保存

服务端语音功能开关:
    GET /api/config/serverVoice -> { asrEnabled, ttsEnabled }
    POST /api/config/serverVoice({ asrEnabled?, ttsEnabled? }):
        校验各字段为 boolean
        保存 asr.serverEnabled / tts.serverEnabled，默认 true
        如果 asrEnabled == false 且 asr.device == 'server': 设置 asr.device = 'display'
        如果 ttsEnabled == false 且 tts.device == 'server': 设置 tts.device = 'display'
        广播 serverVoiceChanged 和实际设备 changed
        返回最新开关与设备配置
    声纹面板加载配置并绑定两个 checkbox
    服务端按钮 disabled = 对应 serverEnabled == false
    开关关闭且当前设备为 server -> 自动选择 display；无显示端能力时请求失败，不调用服务器引擎
```

## 全局降噪与固定中文

```text
GET /api/voiceprint/config:
    返回 voiceprint 配置和 asr.denoise

POST /api/voiceprint/config({ denoise }):
    校验 denoise 为 boolean
    保存 asr.denoise
    广播 voiceprintConfig(含 denoise)
    广播 asrConfig(languageMode='zh', denoise)

显示端收到 asrConfig:
    asrLanguageMode = 'zh'
    asrDenoiseEnabled = data.denoise

显示端收到 voiceprintConfig:
    声纹流程使用 denoise
    普通 ASR 仍使用同一个 asrDenoiseEnabled
```
```
