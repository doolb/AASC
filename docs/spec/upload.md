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

### 角度切换 (applyRotation / recalculateSize)

控制端切换角度按钮 → `sendControl('rotate', 角度)`，显示端 `applyRotation` + `applyCrop` 重新适配画面。

**recalculateSize**（角度切换 350ms 后重算裁剪框与数据）:
```
recalculateSize(sendToDisplay = true):
    mediaRect = currentMedia().getBoundingClientRect()
    mediaRect 尺寸为 0 → return（无媒体）
    aspectRatio = canvasSize.width / canvasSize.height
    mediaAspect = mediaRect.width / mediaRect.height
    等比计算 newW/newH（居中），写回 data.{x,y,width,height}
    非裁剪模式(currentFit ≠ crop) → updateBox; return
      # 只重算裁剪框 UI，不发 crop——否则显示端收到 crop 会被强制切成裁剪放大
      # （bug 修复：切换角度误进裁剪模式）
    控制模式(controlModeOn) → return
      # 不发 crop（截图强制全屏，坐标按截图比例）
    box.display = block; updateBox
    sendToDisplay → sendData()    # 仅裁剪模式发 crop，显示端保持裁剪
```

**适配模式同步**: 控制端 `Controls.sendFitMode/setFitMode` 把当前适配模式记录到
`Crop.currentFit`（默认 contain，与显示端一致），供 recalculateSize 判断是否发 crop。

### sendData（裁剪下发统一出口，非裁剪模式自动切裁剪）

拖拽/缩放/重置裁剪框都走 `sendData()` 下发 `crop`。当 `currentFit ≠ crop` 时（画面填充仍是
contain/cover 等），裁剪框操作应同时把适配模式切为裁剪，否则显示端虽被 `case 'crop'` 强制裁剪，
但控制端按钮不高亮、服务端持久化 `fit` 仍是旧值，刷新/重连后 restoreState 恢复旧 fit，
`applyCrop` 里 `currentFit ≠ crop` 直接跳过 → 裁剪区域视觉丢失。

```
sendData():
    若 currentFit ≠ 'crop' 且 window.Controls 存在:
        Controls.sendFitMode('crop')   # 高亮裁剪按钮 + currentFit='crop' + 下发 fit='crop'（内部已带 crop 数据）
        return                          # 避免重复发 crop
    否则:
        WebSocketManager.sendControl('crop', this.data)
```

- 首次操作裁剪框时 guard 触发一次切为裁剪模式，之后 `currentFit === 'crop'` 走正常 crop 下发。
- `recalculateSize` 非裁剪模式早退逻辑不变，切换角度不误发。
- 重置裁剪（`Crop.reset`）在非裁剪模式下同样经 guard 切为裁剪模式，保证重置后立即生效。

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

## APK CPU 并发控制

控制端把 APK 大小核并发配置放在现有显示控制面板内，沿用 `tts.js` 作为 ASR/TTS 配置辅助逻辑，`websocket.js` 只负责广播消息分发。

```text
CpuAffinitySettings.normalizeCoreCount(raw):
  parsed = Number.parseInt(raw, 10)
  parsed 非有限数 -> 0
  parsed < 0 -> 0
  return parsed

CpuAffinitySettings.normalizeEngineConfig(engine):
  big = normalizeCoreCount(engine.bigCoreCount)
  little = normalizeCoreCount(engine.littleCoreCount)
  if big + little <= 0:
    little = 1
  return { bigCoreCount: big, littleCoreCount: little }

CpuAffinitySettings.normalizeConfig(raw):
  asr = normalizeEngineConfig(raw.asr)
  tts = normalizeEngineConfig(raw.tts)
  return { asr, tts }

CpuAffinitySettings.loadConfig():
  GET /api/config/cpuAffinity
  data.status == 'success' -> applyConfig(data.cpuAffinity)
  否则保持输入框当前值并显示错误 toast

CpuAffinitySettings.readConfigFromInputs():
  读取 asrBigCoreCountInput / asrLittleCoreCountInput / ttsBigCoreCountInput / ttsLittleCoreCountInput
  return normalizeConfig({ asr, tts })

CpuAffinitySettings.saveConfig():
  payload = readConfigFromInputs()
  POST /api/config/cpuAffinity with JSON payload
  data.status == 'success' -> applyConfig(data.cpuAffinity), 更新状态文案
  失败 -> toast(error)

CpuAffinitySettings.handleConfigChanged(cpuAffinity):
  applyConfig(cpuAffinity)
  更新状态文案为“已同步服务器配置”

WebSocketManager.handleMessage(data):
  data.type == 'cpuAffinityChanged' -> CpuAffinitySettings.handleConfigChanged(data.cpuAffinity)
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
