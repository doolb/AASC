# 上传功能实现文档

## 普通上传

### POST /upload-file
上传文件并发送到显示端。

**请求**: multipart/form-data
- file: 文件数据
- displayId: 目标显示端ID

**响应**:
```json
{ "status": "success", "message": "媒体已发送到显示端" }
```

**实现** (server-app.js):
```
解析 multipart 数据
检测媒体类型 (detectMediaType)
生成唯一文件名: 时间戳_原文件名
写入文件到 res/uploads/ 目录
构建媒体数据:
    type: 'url'
    url: http://{本地IP}:{端口}/uploads/{文件名}
    fileName: 原文件名
    mediaType: image | video | gif
    timestamp: 时间戳
发送到指定显示端
持久化到 config.updateDisplayState
```

## 临时上传模式

### 概述
临时模式通过 base64 中转，文件不保存到服务器磁盘。控制端读取文件为 base64，经 WebSocket 发送，服务器原样转发到显示端。

### 数据流
```
控制端选择文件
  → 勾选"临时模式"
  → 校验文件大小 ≤ 配置上限（默认 300MB）
  → FileReader.readAsDataURL → 提取纯 base64
  → 载入 Image/Video 获取宽高
  → WebSocketManager.sendMedia({type:'base64', data, fileName, mediaType, temp:true, width, height})
  → WS mediaBatch 消息
  → 服务器检测 media.temp === true:
      跳过 dd.state.currentMedia 赋值
      跳过 config.updateDisplayState()
      原样 sendToDisplay(id, media)
  → 显示端 showMedia 走 type:'base64' 分支:
      构建 data:application/octet-stream;base64,...
      设置 img.src / video.src
```

### WebSocket 消息结构
```json
{
    "type": "mediaBatch",
    "displayIds": ["id1", "id2"],
    "media": {
        "type": "base64",
        "data": "<base64编码数据>",
        "fileName": "原始文件名",
        "mediaType": "image|video|gif",
        "temp": true,
        "width": 1920,
        "height": 1080
    }
}
```

### 服务端处理

**mediaBatch handler**:
```
displayIds.forEach(id -> {
    dd = displayClients.get(id)
    if (dd) {
        if (!data.media.temp) {
            dd.state.currentMedia = data.media       // 临时模式跳过
            config.updateDisplayState(...)             // 临时模式跳过
        }
        sendToDisplay(id, data.media)                  // 始终转发
    }
})
```

**WebSocket 配置**:
```
wss = new WebSocket.Server({
    server,
    maxPayload: 500 * 1024 * 1024    // 500MB, 容纳 300MB 文件的 base64 开销
})
```

### 控制端实现 (upload.js)

**fileToBase64(file)**:
```
创建 FileReader
reader.readAsDataURL(file)
提取逗号后的纯 base64 字符串
```

**getMediaDimensions(file, base64)**:
```
构建 data:application/octet-stream;base64,...
根据 mediaType:
    video: 创建 Video 元素, 读 videoWidth/videoHeight
    image/gif: 创建 Image 元素, 读 naturalWidth/naturalHeight
异常时返回 null
```

**uploadFile(file)** 临时分支:
```
读取 tempMode checkbox
读取 tempMaxSize input（默认 300）
校验 file.size ≤ maxSizeMB * 1024 * 1024
调用 fileToBase64(file)
调用 getMediaDimensions(file, base64)
调用 WebSocketManager.sendMedia({
    type: 'base64', data, fileName, mediaType,
    temp: true, width, height
})
```

### 控制端 UI (upload.html)

```
<div class="temp-mode-row">
    <label class="temp-mode-label">
        <input type="checkbox" id="tempMode">
        <span>临时模式（仅中转，不保存文件）</span>
    </label>
    <label class="temp-size-label">
        <span>上限</span>
        <input type="number" id="tempMaxSize" value="300" min="1">
        <span>MB</span>
    </label>
</div>
```

### 显示端处理 (display.html)

复用现有 `type:'base64'` 分支：
```
const src = 'data:application/octet-stream;base64,' + data.data
if (data.mediaType === 'video'):
    设置 video.src = src, 调用 video.load() + video.play()
else:
    设置 img.src = src
```

### 限制

- 临时媒体在显示端重连后不会恢复（无持久化状态）
- 文件大小受 `maxPayload` 和浏览器内存限制
- base64 编码导致约 33% 体积膨胀

### 样式 (upload.css)

```
.temp-mode-row: flex 行布局, 居中, gap 16px
.temp-mode-label: inline-flex, checkbox + 文字
.temp-size-input: 60px 宽度, 深色背景, 居中数字
```
