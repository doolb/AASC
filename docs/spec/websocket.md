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
            state: { ...createDisplayState(), ...savedState }
        })
        
        发送 { type: 'serverStartTime', time: serverStartTime }
        发送 { type: 'displayId', id: displayId, ip: clientIP }
        
        如果 savedState 存在且有 currentMedia:
            发送 { type: 'restoreState', state: savedState }
        
        广播显示端列表到控制端
        
        监听消息:
            如果 type === 'canvasSize':
                更新 state.canvasSize
                广播显示端列表
            如果 type === 'browserInfo':
                更新 state.browserInfo
                广播显示端列表
        
        监听关闭:
            从 displayClients 删除
            广播显示端列表
```

### 控制端连接 (/control)

**server.js 实现**:
```
如果 url === '/control' 或以 '/control' 开头:
    controlClients.add(ws)
    
    发送 { type: 'serverStartTime', time: serverStartTime }
    发送 { type: 'displayList', list: getDisplayList() }
    
    监听消息:
        解析 JSON 数据
        
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
    browserInfo: null            // 浏览器信息
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

### 控制端 -> 服务端

| 类型 | 说明 | 数据 |
|------|------|------|
| getState | 获取显示端状态 | `{ type, displayId }` |
| media | 发送媒体 | `{ type, displayId, media }` |
| control | 控制指令 | `{ type, displayId, action, value }` |
| tts | TTS 操作 | `{ type, displayId, action, ... }` |
| chat | 聊天请求 | `{ type, displayId, message, ... }` |

## 前端 WebSocket 客户端

**public/js/websocket.js**:

```
对象 WebSocketManager:
    属性:
        ws: WebSocket 实例
    
    connect():
        构建连接URL: ws://host/control
        创建 WebSocket
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
        config: {}            // 聊天配置
        isLoading: false      // 是否正在加载
    
    init():
        调用 loadHistory()
        调用 loadTemplates()
        调用 loadConfig()
        渲染界面
    
    renderHistory():
        遍历 history
        生成消息组HTML
        每条助手消息添加播放按钮
    
    playMessage(index):
        获取历史消息
        构建文本: "用户问：{user}。回答：{assistant}"
        发送 WebSocket { type: 'tts', displayId, action: 'play', text }
    
    服务端处理 TTS play:
        接收 { type: 'tts', action: 'play', text }
        调用 chat.splitIntoSentences(text) 分割句子
        遍历每个句子:
            调用 tts.generateTTS(sentence)
            发送 { type: 'tts', action: 'playAudio', audioUrl, text } 到显示端
    
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
    返回 [{ id, ip, canvasSize, browserInfo }, ...]

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
