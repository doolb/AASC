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
        若匹配内置功能指令（确认/取消类必须是规范化后的完整短指令）:
            转交现有 voiceCommand 处理，不改变会话状态
        否则若匹配纯唤醒词（你好+助手名、助手名+你好或私聊唤醒）:
            设置 activeGroup 或 activePrivate
            发送唤醒确认
            不发送当前纯唤醒文本到聊天
        否则若文本包含助手名且还包含其他内容:
            设置 activeGroup
            保留完整原文并发送到聊天
        否则丢弃普通文本
    如果当前为 activeGroup/activePrivate:
        若匹配结束/退出命令:
            更新状态并发送确认
        否则将文本交给现有 voiceCommand 处理，并标记 conversationActive=true
        有效输入更新 lastValidInputAt

纯助手唤醒判断:
    先执行 parseConversationCommand(text, assistants)
    如果 command.type == 'wake':
        返回 wake 事件
    再执行 findAddressedAssistant(text, assistants)
    避免“你好，小爱。”先被识别为 addressedAssistant 而误发给聊天

waitingWake 中的免唤醒范围:
    包含报时、提醒、静音、取消静音、天气、搜索、播放、停止播报、确认、取消、录音控制和指令模式开关等现有内置功能指令
    确认/取消类仅接受规范化文本等于 "确认"、"确认添加"、"是"、"好的"、"拒绝" 或 "取消"
    不得因为普通文本包含 "拒绝" 或 "取消" 就判定为内置指令
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
        如果存在目标显示端:
            立即发送 { type: 'voiceCommand', action: 'response', text: helpText }
            目标显示端立即使用完整 helpText 打开语音响应弹窗
        如果来源是显示端:
            sentences = chat.splitIntoSentences(helpText)
            batchId = generateCorrelationId('voice-tts-batch')
            通过通用 TTS 调度器逐句串行调用 sendVoiceInputTts(sentence, { batchId, batchEnd })
        如果来源是控制端:
            sentences = chat.splitIntoSentences(helpText)
            batchId = generateCorrelationId('voice-tts-batch')
            通过定向 TTS 调度器逐句串行调用 sendVoiceCommandTts(sentence, targetDisplayId, { batchId, batchEnd })
        异步 TTS 生成不能阻塞完整帮助弹窗的首次下发
        所有句子按原文顺序生成和发送，全部完成后结束帮助播报

TTS 批次完成和中断:
    每条分句 playAudio 携带 voiceTtsBatchId，最后一句携带 voiceTtsBatchEnd=true
    显示端收到分句后记录批次句子，仍按队列逐句播放
    单句播放完成 -> 发送 voiceTtsPlaybackFinished，服务端更新该句播放状态
    只有批次结束句真正播放完成，且不存在未完成的批次句子时 -> 发送 voiceConversationTtsFinished
    显示端收到 tts action=stop -> 停止当前句、清空后续句子和批次状态，不发送会话完成事件

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
    显示端收到 action == 'weatherResult':
        如果存在 audioUrl: 将 text 放入 TTS 队列
        使用 detailText || text 调用 showVoiceResponsePopup
        visibleTextLength = 去除 detailText 空白后的 Unicode 字符数
        popupDurationMs = min(90000, max(30000, ceil(visibleTextLength / 3) * 1000))
        popupDurationMs 后自动移除 .voice-response-popup
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

跨显示端 TTS 播报状态:
    服务端 sendToDisplay(displayId, { type: 'tts', action: 'playAudio' }):
        如果消息没有 voiceTtsPlaybackId:
            生成唯一 voiceTtsPlaybackId 并写入消息
        如果消息带有 voiceTtsPlaybackRepeatCount:
            将同一 voiceTtsPlaybackId 视为一个重复播报组
            以重复总数初始化该目标的待完成次数
        向所有 capabilities.voiceRecording == true 的显示端发送:
            { type: 'voiceTtsPlaybackState', state: 'started', voiceTtsPlaybackId, playbackDisplayId: displayId }
        向 displayId 发送带 voiceTtsPlaybackId 的原 TTS 消息
        为 displayId + voiceTtsPlaybackId 设置超时结束清理
    显示端回传 voiceTtsPlaybackFinished:
        服务端按回传 displayId 和 voiceTtsPlaybackId 将该重复组已完成次数加一
        已完成次数小于重复总数 -> 保持活动状态，不广播 finished
        已完成次数达到重复总数 -> 清理该目标的活动状态并向所有录音显示端发送 state='finished'
    重复报时:
        复用同一个 voiceTtsPlaybackId 和 voiceTtsPlaybackRepeatCount
        显示端仍将每条音频依次加入本地 TTS 队列
        直到最后一条音频完成前，录音显示端不得恢复监听
    Web 显示端收到 voiceTtsPlaybackState:
        state='started' -> 加入 remoteTtsPlaybackIds；无声纹时调用 pauseVoiceRecordingForTts()
        state='finished' -> 移除 remoteTtsPlaybackIds；集合为空时调用 scheduleTtsRecordingResume()
        TTS 音频/文本句完成 -> 回传 voiceTtsPlaybackFinished
    Node 子显示端收到 voiceTtsPlaybackState:
        无声纹且有录音器 -> 按活动播放 ID 集合调用 recorder.pause()/resume()
        本地 AudioPlayer 队列结束 -> 回传队列内全部 voiceTtsPlaybackId
    旧显示端未回报完成:
        服务端超时清理状态，录音端按 finished 事件恢复

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

## 服务器重启后的显示端监听恢复

```text
connectWebSocket.onopen:
    建立连接、声明能力和发送当前状态
    重新执行 checkAsrStatus()

checkAsrStatus:
    请求 /api/asr/status
    ready == true:
        取消 ASR 重试定时器
        reportVoiceAvailability(true)
        能力允许且 isAlwaysListening == true 且当前未监听 -> startVoiceRecording()
    ready == false 或请求失败:
        reportVoiceAvailability(false)
        如果页面仍活跃且监听开关仍开启:
            安排下一次 ASR 状态重试

WebSocket error:
    如果仍是当前 socket:
        清理 displayWs 和异常连接
        设置断开状态
        进入 scheduleDisplayReconnect()，保持重连单飞

页面离开:
    取消 WebSocket 重连定时器和 ASR 重试定时器
    关闭当前 socket
    不再执行旧 ASR 请求的恢复回调
```

## 显示端语音状态、旋转布局与音频监视图

```text
getVoiceDisplayState:
    如果 voiceSupported != true:
        返回 { key: 'not-ready', text: '未就绪', title: '不支持语音识别' }
    如果 ttsRecordingPaused == true:
        返回 { key: 'paused', text: '暂停监听', title: '语音监听因 TTS 播放暂时暂停' }
    如果 isListening == true:
        返回 { key: 'listening', text: '监听中', title: '语音识别监听中' }
    返回 { key: 'not-ready', text: '未就绪', title: '语音监听尚未启动或已关闭' }

updateVoiceStatusDisplay:
    state = getVoiceDisplayState()
    voiceStatus.textContent = state.text
    voiceStatus.className = 'voice-status-' + state.key
    voiceStatus.title = state.title
    voiceStatus.dataset.state = state.key

applyRotation:
    清理 voiceStatus 和 monitorWrapper 的旧 transform、锚点与边缘样式
    按 currentRotation 设置两者的屏幕角位置
    voiceStatus 使用 currentRotation 旋转，文字方向与其他显示端状态文本一致
    monitorWrapper 使用 currentRotation 旋转
    0 度以 bottom right、90 度以 bottom left、180 度以 top left、270 度以 top right 作为变换原点
    继续使用旋转后的逻辑画布校正文本最大尺寸和固定边缘

animateMonitor(timestamp):
    使用 timestamp 的秒级增量推进 monitorTime
    如果 isListening 且 analyser 有效:
        复用 monitorDataArray 读取 AnalyserNode 频谱
        绘制频谱柱；低于可见幅度时叠加微弱动态基线
    否则:
        绘制低幅、随 monitorTime 变化的待机柱
    重置 canvas globalAlpha 后请求下一帧
```

## 显示端语音 UI 顶部居中

```text
applyVoiceTopCenterLayout(rotationLayout):
    voiceStatusRow 包含 voiceStatus 和 monitorWrapper，使用 flex 横向排列并整体居中
    voiceStatusRow 内状态和柱状图禁止换行，monitorWrapper 宽度固定为 140px，内容水平居中
    voiceStatusRow 使用 1 倍边距，voiceTextDisplay 使用 8 倍边距并单独位于下一行
    voiceTextDisplay 使用独立的固定边缘锚点，柱状图尺寸变化不能改变其逻辑中心位置

applyVoiceCenteredAnchor(element, rotationLayout):
    根据元素未旋转时的实际宽高和当前旋转角度，计算语音状态行或识别文字的固定边缘锚点
    90°/270° 直接写入对应的 left/right 与 top 补偿，不叠加上一次排版的补偿值
    0°/180° 保持水平中心定位，仅在必要时按实际包围盒校正

scheduleRotationTextLayout():
    文本内容变化时先同步更新可见语音元素的确定性锚点，再在下一帧更新尺寸限制，不重新初始化整套语音 UI
    首次显示识别文字时在下一帧重新读取实际尺寸，再调用 applyVoiceCenteredAnchor，避免显示位置跳动
    currentRotation == 0 -> top + left = '50%' 的顶部中间、translateX(-50%)
    currentRotation == 90 -> top = '50%'、right = offset，transformOrigin = 'center right'
    currentRotation == 180 -> bottom + left = '50%' 的底部中间、transformOrigin = 'bottom center'
    currentRotation == 270 -> top = '50%'、left = offset，transformOrigin = 'center left'
    所有角度都按 currentRotation 旋转状态、柱状图和识别文本方向

语音群聊输入:
    waitingWake 状态下，如果原始文本包含已配置角色名且角色名后仍有内容:
        接受输入并切换到 activeGroup
    voiceCommand 处理群聊时不删除角色名前缀
    服务端群聊路由使用聊天系统的全部角色模板和原始文本

applyRotation:
    完成媒体、监视图和其他固定 UI 的四向布局后
    调用 applyVoiceTopCenterLayout(rotationLayout)
    按实际包围盒把状态+柱状图整体和识别文本对齐到对应逻辑边缘中心
    旋转文本包围盒校正遇到语音 UI 的百分比定位时不按百分比数值执行像素偏移
```

## 语音详情弹窗 Markdown

```text
页面加载 ChatMarkdown 渲染器

收到 voiceCommand.response 或 voiceCommand.weatherResult:
    detailText = data.detailText 或 data.text
    如果存在 audioUrl:
        TTS 队列仍使用 data.text，保持纯文本播报
    创建天气/语音通用弹窗
    将 detailText 交给 ChatMarkdown.render
    只把安全渲染结果插入弹窗内容
    弹窗显示时长继续按原始文本可见字符计算，最短 5 秒，最长 90 秒

Markdown 渲染器:
    支持标题、强调、删除线、列表、表格、引用、代码块和安全链接
    转义原始 HTML、代码文本和属性
    拒绝 javascript、vbscript、data 等危险链接协议
```

## 媒体文件名统一 TTS

```text
显示端 announceAndReport(mediaName, data):
    autoTtsEnabled 且文件名非空:
        提取可播报文件名
        发送 mediaNameTts(text) 到服务器
    不在显示端本地调用 playTTS，避免只暂停当前设备

服务器收到 mediaNameTts(displayId, text):
    调用 generateTtsWithFallback(text, preferredDisplayId=displayId)
    通过 sendToDisplay(displayId, { type='tts', action='playAudio', audioUrl, text }) 下发
    sendToDisplay 内部调用 prepareVoiceTtsPlayback
    分配 voiceTtsPlaybackId 并广播 voiceTtsPlaybackState='started'

所有显示端收到 voiceTtsPlaybackState='started':
    非声纹模式调用 pauseVoiceRecordingForTts()
    将播放状态加入 remoteTtsPlaybackIds

目标显示端播放完成:
    回传 voiceTtsPlaybackFinished(voiceTtsPlaybackId)
    服务器广播结束状态
    所有相关远程播放结束后恢复非声纹监听
```

## 显示端普通语音聊天

```text
显示端普通语音聊天:
    语音门控确认文本不是内置指令后
    调用 handleChatMessage({ content, displayContent, displayId, voiceOriginDisplayId: displayId, mode, sendToControl })
    handleChatMessage 先生成 effectiveRequestId
    通过 sendToControl 发送 chatInput(requestId, content, displayId, mode)
    控制端只复用正常聊天临时消息节点，不再次发送 chatMessage
    chatChunk/chatResponse 继续沿用 requestId 更新正常聊天流
    完成后 sendToDisplay(displayId, { type: 'voiceCommand', action: 'response', text, detailText: fullMessage })
    TTS 生成完成后继续使用原有通用 voicePlayback 目标列表
    voiceOriginDisplayId 只用于 response 的 detailText 弹窗回传
    普通 response 和 weatherResult 都调用 calculateWeatherPopupDuration(detailText)
    calculateWeatherPopupDuration 按每 3 个可见字符 1 秒计算，结果限制为 5～90 秒
```

```text
显示端语音状态文案:
    保存 voiceConversationState.state 和 voiceConversationState.target
    waitingWake -> “监听中 · 等待唤醒”
    activeGroup -> “监听中 · 群聊”
    activePrivate -> “监听中 · 私聊：” + target
    ttsRecordingPaused 时保留上述会话范围，并将前缀改为“暂停监听”
    voiceSupported=false 或监听未启动 -> “未就绪”

显示端唤醒倒计时:
    服务端 voiceConversationState 携带 expiresAt
    activeGroup 或 activePrivate -> 第一行显示状态+柱状图，第二行只显示 MM:SS
    每秒按 expiresAt - Date.now() 更新剩余时间
    expiresAt <= now 或状态回到 waitingWake/disabled -> 隐藏第二行并停止计时器
```

## 唤醒后群聊放行

```text
显示端 activeGroup 普通文本:
    voiceConversationActive=true 传入 processVoiceCommand
    内置系统命令和自定义命令仍按原优先级解析
    commandMode=true 时不再过滤普通聊天文本
    返回 chat -> handleChatMessage -> 发送 chatInput 并进入正常 LLM/Pi 路径
等待唤醒状态:
    保持原有 commandMode 过滤和免唤醒内置指令规则

## 全局语音对话确认模式

```text
conversationConfirmationMode = off | manual | auto
默认值 = off

控制端请求 getConversationConfirmationConfig:
    返回当前全局模式

控制端界面:
    语音对话确认设置归入 panel-voiceprint 的“声纹识别设置”卡片
    不在 panel-display 单独占用显示控制卡片
    VoiceprintPanel 负责渲染模式下拉框并发送配置

控制端发送 setConversationConfirmationConfig(mode):
    校验 mode 只能是 off/manual/auto
    持久化 voiceCommand.conversationConfirmationMode
    广播 conversationConfirmationConfig 到所有控制端和显示端

语音命令:
    “开启对话确认” -> 设置 manual
    “关闭对话确认” -> 设置 off
    “开启自动确认” -> 设置 auto
    上述命令无需唤醒词，不能被普通对话确认再次拦截

activeGroup/activePrivate 收到普通语音文本:
    内置指令仍先执行
    mode == off -> 原样走正常聊天路径
    mode == manual 或 auto -> 创建 pendingConversationConfirmation
        保存 displayId、原始 text、chat mode、target、sessionId 和 createdAt
        不调用 Pi，不写入聊天历史
        先向来源显示端发送 conversationConfirmation/detailText
        通过通用 TTS 路由播报确认文本

manual 待确认:
    expiresAt = createdAt + 30000
    确认词 -> 删除记录 -> 使用保存的原始文本调用正常聊天路径
    取消词或 expiresAt <= now -> 删除记录，不发送聊天

auto 待确认:
    sendVoiceInputTts 为每个实际播放目标登记 playbackDisplayId/playbackId
    所有已登记播放目标收到 voiceTtsPlaybackFinished 后设置 cancelUntil = now + 7000
    cancelUntil 内收到取消词 -> 删除记录，不发送聊天
    cancelUntil 到期 -> 删除记录 -> 使用保存的原始文本调用正常聊天路径
    没有播放目标或 TTS 生成失败 -> 保留弹窗并开启 7 秒取消窗口

声纹管理页面:
    panel-voiceprint 内所有主要 control-item 使用 voiceprint-card 大卡片样式
    语音对话确认使用独立 voiceprint-card，与声纹识别设置卡片并列

显示端收到 conversationConfirmation:
    复用天气详情弹窗安全 Markdown 渲染器显示完整原文和确认提示
    弹窗至少保持当前待确认窗口时长
    第二行在唤醒倒计时后显示确认 MM:SS，带独立背景
    确认、取消、超时或监听关闭 -> 立即隐藏弹窗并清理确认计时器

确认倒计时样式:
    .voice-conversation-countdown-confirmation 使用加粗文字和独立背景
    深色主题 -> 白色文字 + 深红背景 + 浅红边框
    浅色主题 -> 深红文字 + 浅红背景 + 深红边框
```
```

## Pi Agent 会话路由

```text
进入 activeGroup:
    chat.setMode('group', null)
    回收原 activePrivate 会话的 Pi 进程
    后续 chat 返回 mode=group、target=null、sessionId=default

进入 activePrivate(target):
    chat.setMode('private', target)
    回收原群聊或其他私聊角色会话的 Pi 进程
    后续 chat 返回 mode=private、target=target、sessionId=default

控制端切换私聊 sessionId:
    chat.switchSession(target, sessionId)
    回收原私聊 target/sessionId 的 Pi 进程
    保留应用层历史，下一次请求按新 target/sessionId 创建进程

processVoiceCommand 私聊分支:
    返回 chat.message
    返回 mode='private'
    返回 target=chatSession.privateTarget
    返回 sessionId=chatSession.privateSessionId
    返回 templateTarget=chatSession.privateTarget

server audioChunk 完成 ASR:
    conversation = handleDisplayConversationInput(displayId, text)
    conversationState = conversation.state.state
    activeGroup 或 activePrivate -> conversationActive=true
    记录 displayId、conversationState、accepted、event.type 和 conversationActive，便于诊断门控结果
    调用 voiceCommand.processVoiceCommand(text, ..., { conversationActive })
```
