# HTTP API 实现文档

## 文件上传

### POST /upload-file
上传文件并发送到显示端。

**请求**: multipart/form-data
- file: 文件数据
- displayId: 目标显示端ID

**响应**:
```json
{ "status": "success", "message": "媒体已发送到显示端" }
```

**实现** (server.js):
```
解析 multipart 数据
检测媒体类型 (detectMediaType)
生成唯一文件名: 时间戳_原文件名
写入文件到 uploads 目录
构建媒体数据:
    type: 'url'
    url: http://{本地IP}:{端口}/uploads/{文件名}
    fileName: 原文件名
    mediaType: image | video | gif
    timestamp: 时间戳
发送到指定显示端
```

## 媒体管理

### GET /media-list
获取已上传的媒体列表。

**响应**:
```json
{
  "status": "success",
  "list": [
    {
      "name": "1712016000000_image.jpg",
      "url": "http://192.168.1.39:8081/uploads/...",
      "mediaType": "image",
      "size": 102400,
      "time": "2024-04-02T00:00:00.000Z"
    }
  ]
}
```

**实现**:
```
读取 uploads 目录
过滤隐藏文件 (.开头)
映射每个文件:
    name: 文件名
    url: 公开访问URL
    mediaType: detectMediaType(文件名)
    size: 文件大小
    time: 修改时间
按时间倒序排序
```

### DELETE /media/:filename
删除指定媒体文件。

**实现**:
```
解码文件名
构建完整路径
检查文件存在
删除文件
```

## TTS API

### GET /api/tts/config
获取 TTS 配置。

**响应**:
```json
{
  "status": "success",
  "serviceUrl": "http://192.168.1.16:3000/api/tts",
  "defaultVoice": "Microsoft Xiaoxiao",
  "defaultSpeed": 0
}
```

### POST /api/tts/config
更新 TTS 配置。

**请求**:
```json
{
  "serviceUrl": "http://192.168.1.16:3000/api/tts",
  "defaultVoice": "Microsoft Xiaoxiao",
  "defaultSpeed": 0
}
```

**实现**:
```
调用 config.setTtsConfig()
调用 tts.init() 重新初始化
```

### POST /api/tts/generate
生成语音文件。

**请求**:
```json
{ "text": "测试语音", "voice": "Microsoft Xiaoxiao", "speed": 0 }
```

**实现**:
```
调用 tts.generateTTS(text, voice, speed)
生成文件保存到 uploads/tts/tts_{timestamp}_{random}.wav
返回音频URL: /uploads/tts/tts_{timestamp}_{random}.wav
```

## 整点报时 API

### GET /api/timeAnnounce/config
获取整点报时配置。

**响应**:
```json
{
  "status": "success",
  "config": {
    "enabled": true,
    "interval": 15,
    "repeatCount": 3,
    "repeatDelay": 3000
  }
}
```

### POST /api/timeAnnounce/config
更新整点报时配置。

**请求**:
```json
{
  "enabled": true,
  "interval": 30,
  "repeatCount": 3,
  "repeatDelay": 5000
}
```

**实现**:
```
调用 timeAnnounce.setConfig()
调用 config.set('timeAnnounce', config)
```

### POST /api/timeAnnounce/test
测试整点报时。

**实现**:
```
调用 timeAnnounce.checkAndAnnounce(displayClients, sendToDisplay, true)
```

## 聊天 API

### GET /api/chat/config
获取聊天配置。

**响应**:
```json
{
  "status": "success",
  "config": {
    "apiUrl": "http://192.168.1.12:8080/v1/chat/completions",
    "model": "gpt-3.5-turbo",
    "maxTokens": 1000,
    "temperature": 0.7,
    "systemPrompt": "你是一个友好的助手..."
  }
}
```

### POST /api/chat/config
更新聊天配置。

**实现**:
```
调用 chat.setConfig()
调用 config.set('chat', newConfig)
```

### GET /api/chat/history
获取聊天历史。

**响应**:
```json
{
  "status": "success",
  "history": [
    {
      "id": "1234567890",
      "user": "你好",
      "assistant": "你好！有什么可以帮助你的吗？",
      "timestamp": 1712016000000,
      "displayId": "abc123"
    }
  ]
}
```

### POST /api/chat/clear
清空聊天历史。

### GET /api/chat/templates
获取聊天模板。

### POST /api/chat/templates
更新聊天模板。

**请求**:
```json
{ "templates": [...] }
```

### POST /api/chat/templates/add
添加聊天模板。

**请求**:
```json
{
  "name": "模板名称",
  "content": "模板内容"
}
```

### DELETE /api/chat/templates/:id
删除聊天模板。

## 提醒 API

### GET /api/reminders
获取所有提醒。

**响应**:
```json
{
  "status": "success",
  "reminders": [
    {
      "id": "r_abc123_1712016000000",
      "content": "开会时间到了",
      "time": "14:30",
      "type": "once",
      "methods": ["voice", "popup"],
      "repeat": {
        "enabled": true,
        "interval": 5,
        "count": 3
      },
      "repeatCount": 1,
      "enabled": true,
      "createdAt": 1712016000000,
      "lastTriggered": null,
      "nextTrigger": 1712017800000
    }
  ]
}
```

### POST /api/reminders
创建提醒。

**请求**:
```json
{
  "content": "开会时间到了",
  "time": "14:30",
  "type": "once",
  "methods": ["voice", "popup"],
  "repeat": {
    "enabled": false,
    "interval": 5,
    "count": 10
  }
}
```

**实现**:
```
验证 content 和 time
调用 reminder.addReminder()
```

### PUT /api/reminders/:id
更新提醒。

### DELETE /api/reminders/:id
删除提醒。

### POST /api/reminders/:id/toggle
启用/禁用提醒。

**请求**:
```json
{ "enabled": true }
```

### POST /api/reminders/test
测试提醒。

**请求**:
```json
{
  "content": "测试提醒",
  "methods": ["voice", "popup"],
  "repeatCount": 1
}
```

### POST /api/reminders/:id/test
测试指定提醒。

**请求**:
```json
{ "displayId": "abc123" }
```

**实现**:
```
获取提醒数据
如果指定 displayId:
    发送到指定显示端
否则:
    发送到所有显示端
```

## 系统 API

### GET /api/config
获取完整配置。

**响应**:
```json
{
  "status": "success",
  "config": { ... }
}
```

### POST /api/restart
重启服务器。

**实现**:
```
关闭所有 WebSocket 连接
关闭 HTTP 服务器
使用 spawn 启动新进程
退出当前进程
```

### GET /api/display-version
显示端代码版本检测接口。显示端前端按 AASC 远端配置的间隔轮询，返回 `version` 变化即自动 reload 加载最新代码（无需重启 APK）。默认间隔为 30 秒，控制端可通过 WebSocket 设置 5–300 秒；控制端没有独立的文件变化轮询。

检测间隔配置键为 `display.versionCheckIntervalMs`，由控制端发送 `updateDisplayVersionConfig`，服务端保存并广播 `displayVersionConfig`。不提供独立的配置读取或保存 HTTP 接口。

**响应**:
```json
{ "version": 1712016000000 }
```

**实现**:
```
publicDir = PROJECT_ROOT + '/src/apps/web-mediacenter/ui/public'
函数 getDisplayVersion():
    maxMtime = 0
    递归遍历 publicDir 下所有文件（含子目录）:
        statSync 取 mtimeMs
        mtimeMs > maxMtime 则更新 maxMtime
    return maxMtime
返回 { version: getDisplayVersion() }
```

## 地图位置 API

### GET /api/map-positions
获取所有建筑的保存位置。

**响应**:
```json
{
  "status": "success",
  "positions": {
    "building-id": {
      "position": { "x": 100, "y": 200 },
      "updatedAt": 1712016000000
    }
  }
}
```

**实现**:
```
读取 ~/.config/aasc-user/map-positions.json
如果文件不存在，返回空对象
```

### PUT /api/map-positions/:id
保存建筑位置。

**请求**:
```json
{
  "position": { "x": 100, "y": 200 }
}
```

**响应**:
```json
{
  "status": "success",
  "message": "位置保存成功"
}
```

**实现**:
```
验证位置数据 (x, y 必须是数字)
读取现有位置数据
更新指定建筑的位置
写入 ~/.config/aasc-user/map-positions.json
```

## 媒体类型检测

```
function detectMediaType(name):
    ext = 文件扩展名 (小写)
    如果 ext in ['gif']:
        返回 'gif'
    如果 ext in ['mp4', 'webm', 'mov', 'avi', 'mkv']:
        返回 'video'
    否则:
        返回 'image'
```

## 相关文件

| 文件 | 说明 |
|------|------|
| server.js | HTTP API 路由定义 |
| src/apps/server/modules/config/config-app-service.js | 配置管理 |
| src/external/tts/tts-service.js | TTS 功能 |
| src/external/llm/llm-service.js | 聊天功能 |
| src/apps/web-mediacenter/modules/reminder/reminder-app-service.js | 提醒功能 |
| src/apps/web-mediacenter/modules/time/time-announce-app-service.js | 整点报时功能 |
| src/framework/cluster/sub-server-manager.js | 子服务器管理 |

## 本地 ASR 配置 API

### GET /api/config/localAsr
获取本地 ASR 配置。

**响应**:
```json
{
  "status": "success",
  "enabled": false
}
```

**实现**:
```
从 config 读取 localAsr 配置
返回 enabled 状态
```

### POST /api/config/localAsr
更新本地 ASR 配置。

**请求**:
```json
{
  "enabled": true
}
```

**实现**:
```
调用 config.set('localAsr', { enabled })
返回更新后的配置
```

## 子服务器管理 API

### GET /api/subservers
获取所有子服务器列表。

**响应**:
```json
{
  "status": "success",
  "servers": [
    {
      "id": "sub1",
      "url": "http://192.168.1.100:3001",
      "name": "子服务器1",
      "maxDisplays": 10,
      "currentDisplays": 3,
      "priority": 0,
      "enabled": true,
      "healthy": true,
      "latency": 15,
      "lastHealthCheck": "2026-04-09T10:00:00.000Z"
    }
  ]
}
```

**实现**:
```
从 subServerManager 获取所有服务器
映射为 JSON 格式返回
```

### POST /api/subservers
添加子服务器。

**请求**:
```json
{
  "id": "sub1",
  "url": "http://192.168.1.100:3001",
  "name": "子服务器1",
  "maxDisplays": 10,
  "priority": 0,
  "enabled": true
}
```

**实现**:
```
验证 id 和 url 必填
调用 subServerManager.addServer()
持久化配置到 config
```

### DELETE /api/subservers/:id
删除子服务器。

**实现**:
```
调用 subServerManager.removeServer()
持久化配置到 config
```

### GET /api/subservers/health
检查所有子服务器健康状态。

**响应**:
```json
{
  "status": "success",
  "total": 3,
  "healthy": 2,
  "unhealthy": 1
}
```

**实现**:
```
并行执行所有子服务器的 healthCheck
汇总结果返回
```
