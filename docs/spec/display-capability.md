# 显示端分布式能力 实现文档

## 概述

显示端能力声明、注册、路由的实现细节，使用伪代码描述。

## 数据结构

### DisplayCapabilities

```
DisplayCapabilities:
    mediaRendering: boolean     // 媒体渲染，默认 true
    voicePlayback: boolean      // 语音播放，默认 true
    voiceRecording: boolean     // 语音录音，默认 true
    voiceRecognition: boolean   // 语音识别，默认 false（需要检测）
    displayText: boolean        // 文本显示，默认 true
```

### 默认能力

```
DEFAULT_CAPABILITIES:
    mediaRendering: true
    voicePlayback: true
    voiceRecording: true
    voiceRecognition: false
    displayText: true

SUB_DISPLAY_CAPABILITIES:
    mediaRendering: false
    voicePlayback: true
    voiceRecording: true
    voiceRecognition: true
    displayText: false
```

## 服务端实现 (server.js)

### createDisplayState 修改

```
function createDisplayState():
    return {
        currentMedia: null,
        rotation: 0,
        fit: 'contain',
        crop: { x: 0, y: 0, width: 100, height: 100 },
        volume: 100,
        isPlaying: false,
        canvasSize: { width: 1920, height: 1080 },
        browserInfo: null,
        capabilities: null    // 新增：显示端能力，null 表示未声明（使用默认值）
    }
```

### 显示端连接处理修改

```
wss.on('connection', (ws, req)):
    if url 是显示端连接:
        savedState = config.getDisplayState(clientIP)  // 从 config.json 加载持久化状态
        ...
        // 初始化状态：capabilities 初始为 null，等待显示端声明
        // userCapabilities 从持久化恢复，声明能力后自动合并
        displayData.state = {
            ...createDisplayState(),
            ...savedState,
            isSubDisplay: isSubDisplay,
            capabilities: isSubDisplay
                ? { ...SUB_DISPLAY_CAPABILITIES }
                : null  // 非子显示端初始为 null，等硬件声明
        }
        // 非子显示端：从持久化恢复用户覆盖值
        if !isSubDisplay && savedState?.userCapabilities:
            displayData.state.userCapabilities = { ...savedState.userCapabilities }
        ...
```

### capabilities 消息处理

```
handleDisplayMessage(displayId, data, ws):
    if data.type === 'capabilities':
        displayData = displayClients.get(displayId)
        if displayData:
            // 以硬件声明为基础
            displayData.state.capabilities = {
                ...DEFAULT_CAPABILITIES,
                ...data.capabilities
            }
            // 重连后恢复用户手动覆盖的能力值
            if displayData.state.userCapabilities:
                Object.assign(displayData.state.capabilities, displayData.state.userCapabilities)
            broadcastToControls({ type: 'displayList', list: getDisplayList() })
        return
```

### updateCapabilities 消息处理（控制端修改能力）

```
handleControlMessage(ws, data):
    if data.type === 'updateCapabilities':
        displayId = data.displayId
        capabilities = data.capabilities
        displayData = displayClients.get(displayId)
        if displayData:
            displayData.state.capabilities = {
                ...DEFAULT_CAPABILITIES,
                ...capabilities
            }
            // 保存用户覆盖值，重连后恢复（与硬件能力分开跟踪）
            displayData.state.userCapabilities = { ...capabilities }
            // 通知显示端能力已更新
            sendToDisplay(displayId, {
                type: 'capabilitiesUpdated',
                capabilities: displayData.state.capabilities
            })
            // 持久化到 config.json，保存用户覆盖值
            config.updateDisplayState(displayData.ip, {
                capabilities: displayData.state.capabilities,
                userCapabilities: { ...capabilities }
            })
            broadcastToControls({ type: 'displayList', list: getDisplayList() })
        return
```

### getDisplayList 修改

```
function getDisplayList():
    list = []
    displayClients.forEach((data, id)):
        caps = data.state.capabilities || DEFAULT_CAPABILITIES
        list.push({
            id: id,
            ip: data.ip,
            isSubDisplay: data.isSubDisplay || data.state.isSubDisplay || false,
            canvasSize: data.state.canvasSize,
            rotation: data.state.rotation || 0,
            browserInfo: data.state.browserInfo,
            voiceSupported: data.state.voiceSupported,
            voiceListening: data.state.voiceListening,
            capabilities: caps    // 新增
        })
    return list
```

### 能力路由辅助函数

```
function getDisplaysWithCapability(capabilityName):
    result = []
    displayClients.forEach((data, id):
        caps = data.state.capabilities || DEFAULT_CAPABILITIES
        if caps[capabilityName] === true:
            result.push({ id, data })
    )
    return result

function sendToDisplaysWithCapability(capabilityName, message):
    displays = getDisplaysWithCapability(capabilityName)
    for each display in displays:
        sendToDisplay(display.id, message)
    return displays.length
```

### TTS 播放路由修改

```
// broadcastAll 场景：只发送给有 voicePlayback 能力的显示端
if data.broadcastAll:
    displaysWithPlayback = getDisplaysWithCapability('voicePlayback')
    for each display in displaysWithPlayback:
        sendToDisplay(display.id, {
            type: 'tts',
            action: 'playAudio',
            audioUrl: audioUrl,
            text: sentence
        })
```

### 提醒/报时路由修改

```
// 整点报时：只发送给有 voicePlayback 能力的显示端
async function checkAndAnnounce():
    ...
    displaysWithPlayback = getDisplaysWithCapability('voicePlayback')
    for each display in displaysWithPlayback:
        sendToDisplay(display.id, { type: 'tts', action: 'playAudio', ... })
    ...

// 提醒弹窗：只发送给有 displayText 能力的显示端
function sendReminderPopup(displayId, reminder):
    caps = displayClients.get(displayId)?.state.capabilities || DEFAULT_CAPABILITIES
    if caps.displayText:
        sendToDisplay(displayId, { type: 'reminder', ... })
```

### 媒体渲染路由修改

```
// 媒体播放：只发送给有 mediaRendering 能力的显示端
function sendMediaToDisplay(displayId, mediaData):
    caps = displayClients.get(displayId)?.state.capabilities || DEFAULT_CAPABILITIES
    if caps.mediaRendering:
        sendToDisplay(displayId, mediaData)
    else:
        console.log(`[能力] 显示端 ${displayId} 无媒体渲染能力，跳过`)
```

### 地图数据 API 修改

```
app.get('/api/map-data', (req, res)):
    ...
    displayClients.forEach((state, displayId):
        caps = state.state.capabilities || DEFAULT_CAPABILITIES
        capabilities = []
        if caps.mediaRendering:
            capabilities.push({ id: 'display', name: '显示', category: 'basic', level: 2 })
        if caps.voicePlayback:
            capabilities.push({ id: 'voice-broadcast', name: '语音播报', category: 'professional', level: 3 })
        if caps.voiceRecording:
            capabilities.push({ id: 'voice-recording', name: '语音录音', category: 'professional', level: 2 })
        if caps.voiceRecognition:
            capabilities.push({ id: 'voice-recognition', name: '语音识别', category: 'professional', level: 3 })
        if caps.displayText:
            capabilities.push({ id: 'display-text', name: '文本显示', category: 'basic', level: 2 })
        
        actors.push({
            address: { ip: state.browserInfo?.ip || 'unknown', role: 'display', name: displayId },
            status: state.state.isPlaying ? 'busy' : 'ready',
            capabilities: capabilities,
            ...
        })
    )
    ...
```

## 显示端实现 (public/display.html)

### 能力检测

```
async function detectCapabilities():
    capabilities = {
        mediaRendering: true,      // 普通显示端默认有
        voicePlayback: true,       // 浏览器默认有
        voiceRecording: false,     // 需要检测
        voiceRecognition: false,   // 需要检测
        displayText: true          // 普通显示端默认有
    }
    
    // 检测语音录音能力
    try:
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        capabilities.voiceRecording = true
        stream.getTracks().forEach(track => track.stop())
    catch:
        capabilities.voiceRecording = false
    
    // 检测语音识别能力（本地 sherpa-onnx-wasm）
    localAsrReady = await initLocalAsr()
    if localAsrReady:
        capabilities.voiceRecognition = true
    else:
        // 检测服务端 ASR
        try:
            response = await fetch('/api/asr/status')
            result = await response.json()
            if result.available:
                capabilities.voiceRecognition = true
        catch:
            capabilities.voiceRecognition = false
    
    return capabilities
```

### 能力声明

```
async function declareCapabilities():
    capabilities = await detectCapabilities()
    
    if displayWs && displayWs.readyState === WebSocket.OPEN:
        displayWs.send(JSON.stringify({
            type: 'capabilities',
            capabilities: capabilities
        }))
    
    // 根据能力决定是否启动语音录音
    if capabilities.voiceRecording && capabilities.voiceRecognition:
        if isAlwaysListening:
            startVoiceRecording()
```

### 接收能力更新

```
// 处理服务端发来的能力更新
function handleCapabilitiesUpdated(data):
    currentCapabilities = data.capabilities
    
    // 媒体渲染能力关闭 → 停止媒体播放，清空画面
    if !data.capabilities.mediaRendering:
        mediaVideo.pause(); mediaVideo.src = ''
        mediaImage.style.display = 'none'
        mediaVideo.style.display = 'none'
        fileNameDisplay.textContent = ''
        waitingMessage.style.display = 'block'
    
    // 语音播放能力关闭 → 停止 TTS，清空队列
    if !data.capabilities.voicePlayback:
        ttsQueue = []
        ttsAudio.pause(); ttsAudio.currentTime = 0
        isPlayingTts = false
        voiceTextDisplay.className = 'voice-text-hidden'
    
    // 语音录音能力关闭 → 停止录音
    if !data.capabilities.voiceRecording && isListening:
        stopVoiceRecording()
    
    // 语音识别能力关闭 → 停止 ASR
    if !data.capabilities.voiceRecognition && localAsrStreaming:
        SherpaASR.stopStreaming()
        localAsrStreaming = false
    
    // 文本显示能力关闭 → 隐藏提醒弹窗和文字覆盖层
    if !data.capabilities.displayText:
        document.querySelector('.reminder-popup')?.remove()
        voiceTextDisplay.className = 'voice-text-hidden'
```

### TTS 播放完恢复录音

```
function playNextTts():
    if isPlayingTts: return
    if ttsQueue.length === 0:
        // TTS 队列播放完毕，始终监听模式下恢复录音（需能力允许）
        if isAlwaysListening && currentCapabilities?.voiceRecording:
            setTimeout(() => startVoiceRecording(), 500)
        return
    // ... 正常播放流程
```

### stopVoiceRecording

```
function stopVoiceRecording():
    if !isListening: return
    isListening = false
    mediaRecorder?.stop() (如果 recording 状态)
    stopSilenceDetection()
    SherpaASR.stopStreaming() (如果 streaming)
    micStream.getTracks().forEach(t => t.stop())
    sendVoiceStatus()
```

### 初始化流程修改

```
// 显示端初始化时
displayWs.onopen:
    ...
    declareCapabilities()  // 新增：声明能力
```

## 子显示端实现 (voice-display-node/main.js)

### 能力声明

```
// 子显示端连接时自动声明能力
class VoiceDisplay:
    connect():
        // 连接 URL 已包含 subDisplay=true
        // 服务端会自动设置 SUB_DISPLAY_CAPABILITIES
        // 子显示端也发送 capabilities 消息确认
        ws.on('open'):
            ws.send(JSON.stringify({
                type: 'capabilities',
                capabilities: {
                    mediaRendering: false,
                    voicePlayback: true,
                    voiceRecording: true,
                    voiceRecognition: true,  // 子显示端使用服务端ASR
                    displayText: false
                }
            }))
```

## 子显示端实现 (voice-display/main.go)

### 能力声明

```
func (vd *VoiceDisplay) handleMessage(msgType int, data []byte):
    // 连接成功后发送能力声明
    if 消息类型是 displayId:
        vd.sendCapabilities()

func (vd *VoiceDisplay) sendCapabilities():
    msg := map[string]interface{}{
        "type":         "capabilities",
        "capabilities": map[string]bool{
            "mediaRendering":   false,
            "voicePlayback":    true,
            "voiceRecording":   true,
            "voiceRecognition": true,
            "displayText":      false,
        },
    }
    vd.sendMessage(msg)
```

## 控制端实现 (public/js/display-list.js)

### 能力图标展示

```
function renderCapabilityIcons(capabilities):
    if !capabilities:
        return ''  // 旧版显示端不显示
    
    icons = ''
    
    // 媒体渲染
    icons += `<span class="cap-icon ${capabilities.mediaRendering ? 'active' : 'inactive'}" 
                title="媒体渲染${capabilities.mediaRendering ? '' : '（不可用）'}">🖥️</span>`
    
    // 语音播放
    icons += `<span class="cap-icon ${capabilities.voicePlayback ? 'active' : 'inactive'}" 
                title="语音播放${capabilities.voicePlayback ? '' : '（不可用）'}">🔊</span>`
    
    // 语音录音
    icons += `<span class="cap-icon ${capabilities.voiceRecording ? 'active' : 'inactive'}" 
                title="语音录音${capabilities.voiceRecording ? '' : '（不可用）'}">🎙️</span>`
    
    // 语音识别
    icons += `<span class="cap-icon ${capabilities.voiceRecognition ? 'active' : 'inactive'}" 
                title="语音识别${capabilities.voiceRecognition ? '' : '（不可用）'}">🧠</span>`
    
    // 文本显示
    icons += `<span class="cap-icon ${capabilities.displayText ? 'active' : 'inactive'}" 
                title="文本显示${capabilities.displayText ? '' : '（不可用）'}">📝</span>`
    
    return icons
```

### 能力编辑

```
function showCapabilityEditor(displayId):
    displayData = 找到对应显示端数据
    capabilities = displayData.capabilities || DEFAULT_CAPABILITIES
    
    // 显示编辑弹窗
    html = `
        <div class="capability-editor">
            <h3>显示端 ${displayData.ip} 能力设置</h3>
            <label><input type="checkbox" ${capabilities.mediaRendering ? 'checked' : ''} data-cap="mediaRendering"> 媒体渲染</label>
            <label><input type="checkbox" ${capabilities.voicePlayback ? 'checked' : ''} data-cap="voicePlayback"> 语音播放</label>
            <label><input type="checkbox" ${capabilities.voiceRecording ? 'checked' : ''} data-cap="voiceRecording"> 语音录音</label>
            <label><input type="checkbox" ${capabilities.voiceRecognition ? 'checked' : ''} data-cap="voiceRecognition"> 语音识别</label>
            <label><input type="checkbox" ${capabilities.displayText ? 'checked' : ''} data-cap="displayText"> 文本显示</label>
            <button onclick="saveCapabilities('${displayId}')">保存</button>
        </div>
    `
    显示弹窗

function saveCapabilities(displayId):
    capabilities = 收集所有 checkbox 状态
    ws.send(JSON.stringify({
        type: 'updateCapabilities',
        displayId: displayId,
        capabilities: capabilities
    }))
    关闭弹窗
```

## CSS 样式 (public/css/upload.css)

```
.cap-icon:
    font-size: 12px
    margin-left: 2px
    opacity: 1
    transition: opacity 0.2s

.cap-icon.inactive:
    opacity: 0.3
    filter: grayscale(1)

.capability-editor:
    position: fixed
    top: 50%
    left: 50%
    transform: translate(-50%, -50%)
    background: white
    padding: 20px
    border-radius: 12px
    box-shadow: 0 4px 20px rgba(0,0,0,0.3)
    z-index: 1000

.capability-editor label:
    display: block
    margin: 8px 0
    cursor: pointer
```

## AASC 集成

### DisplayRenderAgent 修改

```
class DisplayRenderAgent:
    async handleMediaControl(message):
        targetDisplayId = message.payload.displayId
        caps = getDisplayCapabilities(targetDisplayId)
        
        if !caps.mediaRendering:
            return { success: false, error: '显示端无媒体渲染能力' }
        
        // 正常处理
```

### TTSActor 修改

```
class TTSActor:
    async handleBroadcast(message):
        text = message.payload.text
        audioPath = await tts.generateTTS(text)
        audioUrl = `/uploads/tts/${path.basename(audioPath)}`
        
        // 只发送给有 voicePlayback 能力的显示端
        displaysWithPlayback = getDisplaysWithCapability('voicePlayback')
        for each display in displaysWithPlayback:
            sendToDisplay(display.id, {
                type: 'tts',
                action: 'playAudio',
                audioUrl: audioUrl,
                text: text
            })
```

## WebSocket 消息类型

### 新增消息

| 方向 | 类型 | 说明 |
|------|------|------|
| 显示端→服务端 | capabilities | 显示端声明自身能力 |
| 控制端→服务端 | updateCapabilities | 控制端修改显示端能力 |
| 服务端→显示端 | capabilitiesUpdated | 通知显示端能力已更新 |

### capabilities 消息格式

```json
{
    "type": "capabilities",
    "capabilities": {
        "mediaRendering": true,
        "voicePlayback": true,
        "voiceRecording": true,
        "voiceRecognition": false,
        "displayText": true
    }
}
```

### updateCapabilities 消息格式

```json
{
    "type": "updateCapabilities",
    "displayId": "abc123",
    "capabilities": {
        "mediaRendering": true,
        "voicePlayback": false,
        "voiceRecording": true,
        "voiceRecognition": true,
        "displayText": true
    }
}
```

### capabilitiesUpdated 消息格式

```json
{
    "type": "capabilitiesUpdated",
    "capabilities": {
        "mediaRendering": true,
        "voicePlayback": false,
        "voiceRecording": true,
        "voiceRecognition": true,
        "displayText": true
    }
}
```
