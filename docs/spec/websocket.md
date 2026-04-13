# WebSocket 实现文档

## 连接处理

### 显示端连接 (/display)

**server.js 实现**:
```
wss.on('connection', (ws, req)):
    如果 url === '/display' 或以 '/display' 开头:
        displayId = generateId()
        clientIP = getClientIP(req)
        savedState = config.getDisplayState(clientIP)
        
        displayClients.set(displayId, {
            ws: ws,
            ip: clientIP,
            isSubDisplay: isSubDisplay,
            lastSeen: Date.now(),
            state: { ...createDisplayState(), ...savedState }
        })
        
        如果 aascSystem 存在:
            调用 aascSystem.handleDisplayConnect(displayId, clientIP, ws, savedState)
        
        发送 { type: 'serverStartTime', time: serverStartTime }
        发送 { type: 'displayId', id: displayId, ip: clientIP }
        
        如果 savedState 存在且有 currentMedia:
            发送 { type: 'restoreState', state: savedState }
        
        广播显示端列表到控制端
        
        监听消息:
            解析 JSON 数据
            更新 lastSeen = Date.now()
            data.displayId = displayId
            
            如果 aascSystem 存在:
                result = await aascSystem.handleDisplayMessage(displayId, data, ws)
                如果 result.success === false 且有 reason:
                    打印警告日志
            否则:
                调用 handleDisplayMessageFallback(displayId, data, ws)
        
        监听关闭:
            从 displayClients 删除
            如果 aascSystem 存在:
                调用 aascSystem.handleDisplayDisconnect(displayId)
            广播显示端列表
```

### 子显示端心跳检测

**server.js 实现**:
```
常量:
    SUB_DISPLAY_TIMEOUT_MS = 3 * 60 * 1000  // 3分钟超时
    SUB_DISPLAY_CHECK_INTERVAL_MS = 30 * 1000  // 每30秒检查一次

定时器检查逻辑:
    setInterval(() => {
        now = Date.now()
        遍历 displayClients:
            如果 displayData.isSubDisplay 且 displayData.lastSeen 存在:
                elapsed = now - displayData.lastSeen
                如果 elapsed > SUB_DISPLAY_TIMEOUT_MS:
                    打印日志 "[子显示端] {displayId} 超过3分钟未响应，执行离线指令"
                    
                    调用 executeDeviceEvent(ip, 'onDisconnect', displayId)
                    
                    从 displayClients 删除 displayId
                    
                    如果 aascSystem 存在:
                        调用 aascSystem.handleDisplayDisconnect(displayId)
                    
                    打印日志 "[子显示端] {displayId} 已强制断开"
                    广播显示端列表到控制端
    }, SUB_DISPLAY_CHECK_INTERVAL_MS)
```

### 控制端连接 (/control)

**server.js 实现**:
```
如果 url === '/control' 或以 '/control' 开头:
    controlClients.add(ws)
    
    如果 aascSystem 存在:
        调用 aascSystem.handleControlConnect(ws)
    
    发送 { type: 'serverStartTime', time: serverStartTime }
    发送 { type: 'displayList', list: getDisplayList() }
    
    监听消息:
        解析 JSON 数据
        
        处理不需要显示端的消息 (无 displayData 检查):
            如果 type === 'voiceCommand':
                处理语音命令
            如果 type === 'confirmVoiceCommand':
                确认语音命令
            如果 type === 'getSearchHistory':
                返回搜索历史
            如果 type === 'clearSearchHistory':
                清空搜索历史
            如果 type === 'deleteSearchHistory':
                删除单条搜索历史
            如果 type === 'getAssistantConfig':
                返回助手配置
            如果 type === 'setAssistantConfig':
                设置助手配置
            如果 type === 'timeAnnounce':
                处理整点报时
            如果 type === 'getReminders':
                获取今日提醒
            如果 type === 'chatHistory':
                返回聊天历史
            如果 type === 'clearChatHistory':
                清空聊天历史
            如果 type === 'getChatSession':
                返回聊天会话
            如果 type === 'setChatSession':
                设置聊天会话
            如果 type === 'getChatCommands':
                返回自定义指令
            如果 type === 'setChatCommands':
                设置自定义指令
        
        检查显示端连接:
            如果 displayData 不存在:
                return (不处理后续需要显示端的消息)
        
        处理需要显示端的消息:
            如果 type === 'getState':
                获取显示端状态
                发送 { type: 'displayState', displayId, state }
            
            如果 type === 'media':
                更新 displayData.state.currentMedia
                发送媒体数据到显示端
            
            如果 type === 'control':
                根据 action 更新状态:
                    'rotate' -> state.rotation = value
                    'fit' -> state.fit = value
                    'crop' -> state.crop = value
                    'volume' -> state.volume = value
                    'play' -> state.isPlaying = value
                发送控制数据到显示端
                保存显示端状态
            
            如果 type === 'tts':
                处理 TTS 相关操作
            
            如果 type === 'chat':
                处理聊天相关操作
    
    监听关闭:
        从 controlClients 删除
        如果 aascSystem 存在:
            调用 aascSystem.handleControlDisconnect(ws)
```

## 显示端状态结构

```javascript
{
    currentMedia: null,          // 当前媒体
    rotation: 0,                 // 旋转角度 (0, 90, 180, 270)
    fit: 'contain',              // 填充模式 (contain, height, width, crop)
    crop: { x: 0, y: 0, width: 100, height: 100 },  // 裁剪区域
    volume: 100,                 // 音量 (0-100)
    isPlaying: false,            // 播放状态
    canvasSize: { width: 1920, height: 1080 },  // 画布尺寸
    browserInfo: null,           // 浏览器信息
    voiceSupported: false,       // 是否支持语音识别
    voiceListening: false        // 是否正在语音识别
}
```

## 消息类型

### 服务端 -> 显示端

| 类型 | 说明 | 数据 |
|------|------|------|
| serverStartTime | 服务器启动时间 | `{ type, time }` |
| displayId | 显示端ID | `{ type, id, ip }` |
| restoreState | 恢复状态 | `{ type, state }` |
| media | 媒体数据 | `{ type, url, mediaType, ... }` |
| control | 控制指令 | `{ type, action, value }` |
| reminder | 提醒消息 | `{ type, action, title, time, content }` |
| tts | TTS 播放 | `{ type, action, audioUrl, text }` |

### 服务端 -> 控制端

| 类型 | 说明 | 数据 |
|------|------|------|
| serverStartTime | 服务器启动时间 | `{ type, time }` |
| displayList | 显示端列表 | `{ type, list: [...] }` |
| displayState | 显示端状态 | `{ type, displayId, state }` |
| chatChunk | 聊天流式响应块 | `{ type, chunk, fullMessage }` |
| chatResponse | 聊天完整响应 | `{ type, message, history }` |
| chatHistory | 聊天历史 | `{ type, history }` |
| voiceInput | 显示端语音输入 | `{ type, displayId, text, isFinal, fullText }` |
| commandAck | 命令确认 | `{ type, displayId, commandType, success, details, timestamp }` |

### 显示端 -> 服务端

| 类型 | 说明 | 数据 |
|------|------|------|
| canvasSize | 画布尺寸 | `{ type, width, height }` |
| browserInfo | 浏览器信息 | `{ type, userAgent, browserName, ... }` |
| voiceInput | 语音输入 | `{ type, text, isFinal, fullText }` |
| voiceStatus | 语音识别状态 | `{ type, supported, listening }` |
| commandAck | 命令确认 | `{ type, commandType, success, details, timestamp }` |

### 控制端 -> 服务端

| 类型 | 说明 | 数据 |
|------|------|------|
| getState | 获取显示端状态 | `{ type, displayId }` |
| media | 发送媒体 | `{ type, displayId, media }` |
| control | 控制指令 | `{ type, displayId, action, value }` |
| tts | TTS 操作 | `{ type, displayId, action, ... }` |
| chatMessage | 聊天请求 | `{ type, content, mode, target, templateTarget, displayId, playOnControl }` |
| chat | 聊天请求(旧) | `{ type, displayId, message, ... }` |

**chatMessage 字段说明**:
- content: 消息内容
- mode: 'group' 或 'private'
- target: 私聊时的助手名字，群聊时为 null
- templateTarget: 群聊时使用的模板助手名字（用于系统提示词）
- displayId: 显示端ID
- playOnControl: 是否在控制端播放语音

## 前端 WebSocket 客户端

**public/js/websocket.js**:

```
对象 WebSocketManager:
    属性:
        ws: WebSocket 实例
    
    connect():
        构建连接URL: ws://host/control
        创建 WebSocket
        设置 onopen 回调:
            打印连接成功日志
            调用 Chat.onWebSocketOpen() 加载数据
        设置消息处理
        设置重连逻辑 (3秒延迟)
    
    handleMessage(data):
        如果 type === 'serverStartTime':
            检查服务器是否重启
            如果重启则刷新页面
        
        如果 type === 'displayList':
            更新 DisplayList.list
            渲染显示端列表
        
        如果 type === 'displayState':
            如果 displayId 匹配当前选择:
                更新 Crop 组件
                更新 Controls 组件
                更新音量显示
                更新播放状态
        
        如果 type === 'chatChunk':
            调用 Chat.handleChunk()
        
        如果 type === 'chatResponse':
            调用 Chat.handleResponse()
        
        如果 type === 'chatHistory':
            更新 Chat.history
            渲染历史
        
        如果 type === 'commandAck':
            如果 SelfTest 存在:
                调用 SelfTest.handleAck(data)
            如果 Chat 存在:
                调用 Chat.addCommandAckMessage(displayId, commandType, success, details)
    
    sendControl(action, value):
        检查 currentDisplayId
        发送 { type: 'control', displayId, action, value }
        显示成功提示
    
    sendMedia(mediaData):
        检查 currentDisplayId
        发送 { type: 'media', displayId, media: mediaData }
        显示成功提示
    
    sendTts(action, data):
        检查 currentDisplayId
        发送 { type: 'tts', displayId, action, ...data }
```

## Chat 模块

```
对象 Chat:
    属性:
        history: []           // 聊天历史
        templates: []         // 聊天模板
        config: {}            // 聊天配置 { systemPrompt, assistantName }
        isLoading: false      // 是否正在加载
        isListening: false    // 是否正在语音输入
        recognition: null     // SpeechRecognition 实例
        voiceParts: []        // 语音识别分段
    
    init():
        调用 loadHistory()
        调用 loadTemplates()
        调用 loadConfig()
        调用 initVoiceRecognition()
        渲染界面
    
    initVoiceRecognition():
        检查浏览器是否支持 SpeechRecognition
        创建 SpeechRecognition 实例
        设置 continuous = true, interimResults = true
        设置 lang = 'zh-CN'
        绑定 onstart, onend, onerror, onresult 事件
    
    handleVoiceResult(event):
        获取语音识别结果
        更新输入框显示（带…表示正在输入）
        如果结果为最终结果:
            检查是否以"聊天"开头
            如果是，提取消息并发送
    
    handleDisplayVoiceInput(data):
        接收显示端语音输入
        更新输入框显示
        如果结果为最终结果:
            调用 processVoiceCommand(fullText)
    
    processVoiceCommand(text):
        如果 text 包含 "提醒":
            调用 handleReminderCommand(text)
        否则如果 text 包含 "报时" 或 "现在几点":
            调用 handleTimeAnnounceCommand(text)
        否则如果 text 包含 "搜索":
            调用 handleSearchCommand(text)
        否则如果 text 包含 assistantName (默认"小爱"):
            清空聊天记录
            使用助手名字模板响应用户
        否则:
            其他语音识别文字，触发助手响应
    
    handleReminderCommand(text):
        解析时间: "几分钟/几秒后/几点几分"
        解析重复规则: "每天"/"每周"/"每月"/"每年"
        默认: 临时提醒，重复3次，间隔10秒，重复间隔3分钟
        语音播放提醒内容和规则，显示端显示确认信息
        等待5秒用户确认:
            如果用户说"拒绝"或"取消": 不添加提醒
            否则: 添加提醒
    
    handleTimeAnnounceCommand(text):
        如果 text 包含 "关闭报时":
            关闭报时功能
            语音播放"已关闭报时功能"，显示端显示
        否则如果 text 包含 "开启报时":
            开启报时功能
            语音播放"已开启报时功能"，显示端显示
        否则:
            立刻报时，次数为1次
    
    handleSearchCommand(text):
        提取搜索关键词
        语音播放"正在搜索..."
        调用搜索 API
        语音播放搜索结果，显示端显示结果
        控制端记录搜索历史
    
    toggleVoice():
        切换语音输入状态
        启动/停止 SpeechRecognition
    
    renderHistory():
        遍历 history
        生成消息组HTML
        每条助手消息添加播放按钮
    
    playMessage(index):
        获取历史消息
        构建文本: "用户问：{user}。回答：{assistant}"
        发送 WebSocket { type: 'tts', displayId, action: 'play', text }
    
    服务端处理 TTS play:
        接收 { type: 'tts', action: 'play', text, displayId, playOnControl }
        调用 chat.splitIntoSentences(text) 分割句子
        splitIntoSentences 函数:
            如果 text 为空或非字符串，返回空数组
            句子结束符包括: '.', '!', '?', '~', '～', '。', '！', '？', '；', ';', '"', '"', ''', ''', '…'
        遍历每个句子:
            调用 tts.generateTTS(sentence)
            如果 playOnControl 为 true:
                发送 { type: 'playOnControl', audioUrl, text } 到控制端
            否则如果 displayId 存在:
                发送 { type: 'tts', action: 'playAudio', audioUrl, text } 到显示端
    
    handlePlayOnControl(data):
        接收 { type: 'playOnControl', audioUrl, text }
        将音频加入播放队列
        如果当前没有播放，从队列取出音频播放
        播放完成后自动播放下一个队列中的音频
    
    handleChunk(data):
        更新流式消息内容
    
    handleResponse(data):
        完成流式消息
        添加播放按钮到新消息
        更新历史记录
```

## 广播函数

```
function broadcastToControls(data):
    message = JSON.stringify(data)
    遍历 controlClients:
        如果 client.readyState === OPEN:
            client.send(message)

function sendToDisplay(displayId, data):
    获取 displayData
    如果存在且 ws.readyState === OPEN:
        ws.send(JSON.stringify(data))
        返回 true
    返回 false
```

## 辅助函数

```
function generateId():
    返回 Math.random().toString(36).substring(2, 10)

function getClientIP(req):
    如果有 x-forwarded-for 头:
        返回第一个IP
    否则:
        返回 req.socket.remoteAddress

function getDisplayList():
    遍历 displayClients
    返回 [{ id, ip, canvasSize, browserInfo, voiceSupported, voiceListening }, ...]

function getLocalIP():
    获取网络接口
    查找非内部IPv4地址
    返回地址或 '127.0.0.1'
```

## 相关文件

| 文件 | 说明 |
|------|------|
| server.js | 服务端 WebSocket 处理 |
| core/connection.js | 连接管理模块 (备用) |
| public/js/websocket.js | 控制端 WebSocket 客户端 |

## 显示端语音识别

**public/display.html**:

```
变量:
    mediaRecorder: MediaRecorder 实例
    audioChunks: 音频数据块
    micStream: 麦克风流
    audioContext: AudioContext 实例
    analyser: 音频分析器
    silenceStartTime: 静音开始时间
    isListening: 是否正在录音
    voiceSupported: 是否支持语音识别

initVoiceRecognition():
    调用 checkAsrStatus()

checkAsrStatus():
    发送 GET /api/asr/status 请求
    如果 data.ready:
        设置 voiceSupported = true
        调用 startVoiceRecording()
    否则:
        设置 voiceSupported = false
        调用 updateVoiceStatusDisplay()

startVoiceRecording():
    如果 isListening 为 true, 返回
    调用 navigator.mediaDevices.getUserMedia() 获取麦克风
    创建 MediaRecorder 实例
    设置 ondataavailable: 收集音频数据
    设置 onstop: 发送音频识别请求，重新开始录音
    启动录音
    设置 isListening = true
    调用 sendVoiceStatus()
    调用 startSilenceDetection()

startSilenceDetection():
    创建 AudioContext 和 Analyser
    循环检测音量:
        如果平均音量 < 5:
            记录静音开始时间
            如果静音超过 1500ms:
                停止录音并发送识别
        否则:
            重置静音时间

stopSilenceDetection():
    关闭 AudioContext

sendAudioForRecognition(audioBlob):
    创建 FormData，添加音频文件
    发送 POST /api/asr/recognize 请求
    如果成功:
        更新语音文本显示
        发送 WebSocket 消息 { type: 'voiceInput', text, isFinal: true, fullText }

updateVoiceStatusDisplay():
    获取 #voiceStatus 元素
    如果不支持:
        设置 class = 'voice-status-unsupported'
        设置 title = '不支持语音识别'
    否则如果正在识别:
        设置 class = 'voice-status-listening'
        设置 title = '语音识别中...'
    否则:
        设置 class = 'voice-status-ready'
        设置 title = '语音识别就绪'

sendVoiceStatus():
    调用 updateVoiceStatusDisplay()
    如果 WebSocket 已连接:
        发送 { type: 'voiceStatus', supported, listening }
```

## 控制端语音识别

**public/js/chat.js**:

```
变量:
    mediaRecorder: MediaRecorder 实例
    audioChunks: 音频数据块
    micStream: 麦克风流
    audioContext: AudioContext 实例
    analyser: 音频分析器
    silenceStartTime: 静音开始时间
    isListening: 是否正在录音
    asrSupported: ASR 服务是否可用

initVoiceRecognition():
    发送 GET /api/asr/status 请求
    设置 asrSupported = data.ready

toggleVoice():
    如果 isListening:
        调用 stopListening()
    否则:
        调用 startListening()

startListening():
    如果 isListening 为 true, 返回
    调用 navigator.mediaDevices.getUserMedia() 获取麦克风
    创建 MediaRecorder 实例
    设置 ondataavailable: 收集音频数据
    设置 onstop: 发送音频识别请求
    启动录音
    设置 isListening = true
    调用 updateVoiceButton()
    调用 startSilenceDetection()

stopListening():
    停止 MediaRecorder
    设置 isListening = false
    调用 updateVoiceButton()
    调用 stopSilenceDetection()

startSilenceDetection():
    创建 AudioContext 和 Analyser
    循环检测音量:
        如果平均音量 < 5:
            记录静音开始时间
            如果静音超过 1500ms:
                调用 stopListening()
        否则:
            重置静音时间

stopSilenceDetection():
    关闭 AudioContext

sendAudioForRecognition(audioBlob):
    创建 FormData，添加音频文件
    发送 POST /api/asr/recognize 请求
    如果成功:
        更新输入框内容
        如果以"聊天"开头:
            发送消息

updateVoiceButton():
    更新语音按钮状态（🔴/🎤）
```

## ASR 模块

**core/asr.js**:

```
类 SherpaOnnxASR:
    属性:
        modelDir: 模型目录路径
        initialized: 是否已初始化

    构造函数(options):
        设置 modelDir
        调用 initRecognizer()

    initRecognizer():
        检查模型文件是否存在
        创建 sherpaOnnx.OfflineRecognizer 实例
        设置 initialized = true

    isReady():
        返回 initialized && recognizer !== null

    recognize(audioPath):
        创建识别流
        读取音频文件
        调用 recognizer.decode()
        返回识别结果文本

    readWavFile(filePath):
        读取 WAV 文件
        解析音频数据
        返回 { samples, sampleRate }

    convertAudioFile(filePath):
        使用 ffmpeg 转换音频格式
        返回转换后的音频数据

模块导出:
    init(options): 初始化 ASR 实例
    recognize(audioPath): 识别音频文件
    isReady(): 检查 ASR 是否就绪
```

## ASR API 接口

**server.js**:

```
GET /api/asr/status:
    返回:
        { status: 'success', ready: boolean }

POST /api/asr/recognize:
    请求:
        FormData { audio: 音频文件 }
    处理流程:
        1. 检查音频文件是否存在
        2. 检查 ASR 服务是否就绪
        3. 调用 ASR 识别音频
        4. 删除临时音频文件
        5. 检查识别结果是否为空
        6. 调用 hasValidContent() 检查有效性
    返回:
        { status: 'success', text: 识别结果 }
        或 { status: 'ignored', message: '未检测到有效内容', text: 识别结果 }
        或 { status: 'error', message: 错误信息 }

hasValidContent(text):
    检查是否包含中文/英文/数字
    屏蔽无效输入（um, uh, yeah 等）
    屏蔽过短输入（中文<2字，英文<4字符）
    返回 boolean
```

## 语音识别模式

### 不打断模式

**public/js/chat.js**:

```
属性:
    noInterruptMode: true (默认开启)
    wasListeningBeforePlayback: false
    isAlwaysListening: false

processAudioQueue():
    如果音频队列为空:
        如果 noInterruptMode && wasListeningBeforePlayback && !isLoading:
            恢复监听
    如果 noInterruptMode && isListening:
        保存监听状态
        停止录音
    播放音频
```

### 自动监听模式

**public/display.html**:

```
WebSocket 连接成功后:
    如果 voiceSupported && !isAlwaysListening:
        延迟 1 秒
        设置 isAlwaysListening = true
        调用 startVoiceRecording()
```

### 无效语音处理

```
sendAudioForRecognition():
    如果 data.status === 'ignored':
        显示提示 '无效语音输入'
        如果 isAlwaysListening:
            延迟 500ms 恢复监听
```

## 控制端显示端列表

**public/js/display-list.js**:

```
renderToContainer(containerId):
    遍历显示端列表:
        生成语音状态 HTML:
            如果 voiceSupported === true:
                如果 voiceListening:
                    显示 "语音" (listening 样式，绿色背景闪烁)
                否则:
                    显示 "语音" (ready 样式，半透明)
            否则如果 voiceSupported === false:
                显示 "语音" (unsupported 样式，灰色)
```

## 裁剪信息显示

**public/js/websocket.js**:

```
function updateCropDisplayInfo(info):
    获取容器元素
    如果容器不存在，返回
    
    显示容器
    
    创建空 items 数组
    
    如果 info.容器尺寸 存在:
        添加容器宽度和高度信息
    
    如果 info.媒体原始尺寸 存在:
        添加媒体宽度和高度信息
    
    如果 info.当前旋转 不为 undefined:
        添加旋转角度信息
    
    如果 info.当前适配模式 存在:
        添加适配模式信息
    
    如果 info.当前裁剪百分比 存在:
        crop = info.当前裁剪百分比
        如果 crop.x 不为 null: 添加裁剪X信息
        如果 crop.y 不为 null: 添加裁剪Y信息
        如果 crop.width 不为 null: 添加裁剪宽度信息
        如果 crop.height 不为 null: 添加裁剪高度信息
    
    如果 info.最终样式 存在:
        添加显示宽度、高度、左边距、上边距信息
    
    如果 info.状态 存在:
        添加状态信息
    
    渲染 items 到 grid 容器
```
