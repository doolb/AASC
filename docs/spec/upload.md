# 上传功能实现文档

## 裁剪功能 (crop.js)

### 裁剪框交互

裁剪框支持通过四角手柄缩放和整体拖拽移动。

**缩放手柄** (`onMouseMove` resize 分支):
```
四个手柄: nw, ne, se, sw
每个手柄始终控制相同的视觉边缘, 不随旋转重映射:
  nw(含 w): 调整视觉左边缘(data.x + width)
  ne(含 e): 调整视觉右边缘(data.width)
  sw(含 w): 调整视觉左边缘(data.x + width)
  se(含 e): 调整视觉右边缘(data.width)
  s(含 s):  调整视觉下边缘(data.height)
  n(含 n):  调整视觉上边缘(data.y + height)

东/西手柄用 dx(屏幕横向)作为 delta, 南/北手柄用 dy(屏幕纵向)。
因为 updateBox 始终把 data.x→视觉横向、data.y→视觉纵向,
数据坐标与视觉坐标的映射关系不随旋转改变。
```

其中 dx/dy 为屏幕空间位移占 getBoundingClientRect() 宽高的百分比。

**缩放计算**:

**拖拽移动**:
```
data.x += dx
data.y += dy
updateBox 始终用 data.x 推 boxLeft(横向)、data.y 推 boxTop(纵向),
因此拖拽直接用原始屏幕 dx/dy, 不做旋转变换。
```

**手柄光标**:
```
根据旋转角度动态设置光标样式:
0°:   nw→nw-resize, ne→ne-resize, se→se-resize, sw→sw-resize
90°:  nw→sw-resize, ne→nw-resize, se→ne-resize, sw→se-resize
180°: nw→se-resize, ne→sw-resize, se→nw-resize, sw→ne-resize
270°: nw→ne-resize, ne→se-resize, se→sw-resize, sw→nw-resize
```

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

## 显示面板拖拽/粘贴上传

### 概述
在显示控制面板的画面裁剪区域支持拖入文件或 Ctrl+V 粘贴，走临时模式（base64 中转，不存盘）。

### 数据流
```
用户在裁剪预览区 (#cropPreviewContainer) 拖入/粘贴文件
  → upload.js sendTempFile(file)
  → fileToBase64 → getMediaDimensions
  → WebSocketManager.sendMedia({type:'base64', data, fileName, mediaType, mimeType, temp:true, width, height})
  → WS mediaBatch → 服务器 → 显示端（复用临时模式）
```

### 事件绑定 (upload.js init)
```
cropPreviewContainer.addEventListener('dragover'):
    e.preventDefault(), 添加 drag-over class

cropPreviewContainer.addEventListener('dragleave'):
    移除 drag-over class

cropPreviewContainer.addEventListener('drop'):
    e.preventDefault(), 移除 drag-over
    file = e.dataTransfer.files[0]
    sendTempFile(file)

document.addEventListener('paste'):
    if 显示控制面板不可见: return
    file = e.clipboardData.files[0]
    if file: sendTempFile(file); return
    遍历 clipboardData.items:
        if type 以 image/ 或 video/ 开头:
            blob = item.getAsFile()
            new File([blob], 'clipboard_时间戳.ext', {type})
            sendTempFile(namedFile)
```

### sendTempFile 实现 (upload.js)
```
async sendTempFile(file):
    if file.size > 300 * 1024 * 1024: showToast error, return
    
    base64 = fileToBase64(file)
    mediaType = detectMediaType(file.name)
    dims = getMediaDimensions(file, base64)
    
    WebSocketManager.sendMedia({
        type: 'base64',
        data: base64,
        fileName: file.name,
        mediaType,
        mimeType: file.type || undefined,
        temp: true,
        width: dims.width,
        height: dims.height
    })
```

### 样式 (upload.css)

```
.temp-mode-row: flex 行布局, 居中, gap 16px
.temp-mode-label: inline-flex, checkbox + 文字
.temp-size-input: 60px 宽度, 深色背景, 居中数字
.crop-preview-container.drag-over:
    border: 3px dashed #4CAF50
    background: rgba(76, 175, 80, 0.08)
```
