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
        若匹配唤醒词:
            设置 activeGroup 或 activePrivate
            发送唤醒确认
        否则丢弃普通文本
    如果当前为 activeGroup/activePrivate:
        若匹配结束/退出命令:
            更新状态并发送确认
        否则将文本交给现有 voiceCommand 处理
        有效输入更新 lastValidInputAt

显示端 TTS 队列结束:
    若监听开关仍开启且没有新的 LLM/TTS 任务:
        进入 waitingTts 或保留当前激活状态
        启动 180000ms 计时器
    计时器到期:
        状态改为 waitingWake
        清理当前助手目标
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
