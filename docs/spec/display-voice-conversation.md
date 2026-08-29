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
- `voiceInput` 继续携带 `displayId`，服务端按目标显示端状态过滤。

## 控制端显示监听状态与 ASR 回传

```text
DeviceList:
    displayVoiceInputs = Map<displayId, { text, isFinal, timestamp }>

收到 displayList:
    保留在线显示端对应的 displayVoiceInputs
    渲染每个显示端的监听开关、监听状态和最近识别文本

收到 voiceInput(displayId, text, isFinal):
    displayVoiceInputs[displayId] = { text, isFinal, timestamp: now }
    调 DeviceList.render()
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
    创建 checkbox(data-display-id)
    不在 checkbox 上重复注册独立 change 处理器

bindVoiceListeningControls(container):
    只在容器上委托 change 事件
    读取 displayId 和 checked
    toggleVoiceListening(displayId, checked)

toggleVoiceListening(displayId, enabled):
    查找在线 display
    如果控制端 WebSocket 未连接:
        恢复 checkbox 原状态
        显示“监听开关发送失败”
        return
    显示“发送中”
    发送 updateCapabilities(displayId, 完整 capabilities)
    服务端广播 displayList 后:
        用 capabilities.voiceRecording 更新 checkbox
        显示“监听中/已关闭”
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
