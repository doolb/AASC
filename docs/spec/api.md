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

### DELETE /media/:filename
删除指定媒体文件。

## TTS API

### GET /api/tts/config
获取 TTS 配置。

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

### POST /api/tts/generate
生成语音文件。

**请求**:
```json
{ "text": "测试语音", "voice": "Microsoft Xiaoxiao", "speed": 0 }
```

## 整点报时 API

### GET /api/timeAnnounce/config
获取整点报时配置。

### POST /api/timeAnnounce/config
更新整点报时配置。

**请求**:
```json
{
  "enabled": true,
  "interval": 30,
  "repeatCount": 3,
  "repeatDelay": 5
}
```

### POST /api/timeAnnounce/test
测试整点报时。

## 聊天 API

### GET /api/chat/config
获取聊天配置。

### POST /api/chat/config
更新聊天配置。

### GET /api/chat/history
获取聊天历史。

### POST /api/chat/clear
清空聊天历史。

### GET /api/chat/templates
获取聊天模板。

### POST /api/chat/templates
更新聊天模板。

### POST /api/chat/templates/add
添加聊天模板。

### DELETE /api/chat/templates/:id
删除聊天模板。

## 提醒 API

### GET /api/reminders
获取所有提醒。

### POST /api/reminders
创建提醒。

### PUT /api/reminders/:id
更新提醒。

### DELETE /api/reminders/:id
删除提醒。

### POST /api/reminders/:id/toggle
启用/禁用提醒。

### POST /api/reminders/test
测试提醒。

### POST /api/reminders/:id/test
测试指定提醒。

## 系统 API

### GET /api/config
获取完整配置。

### POST /api/restart
重启服务器。
