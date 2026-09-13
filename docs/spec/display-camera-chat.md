# 显示端摄像头拍照、实时预览与 AI 图片聊天实现

## WebSocket 伪代码

```text
控制端刷新摄像头(displayId):
    发送 { type: "listDisplayCameras", displayId, requestId }

控制端首次渲染支持摄像头的显示端:
    如果摄像头列表未加载且没有进行中的列表请求:
        标记自动刷新已发起
        异步发送 listDisplayCameras
        列表返回前显示“正在自动刷新摄像头…”

服务端处理控制端摄像头请求:
    校验控制端和 displayId
    校验目标显示端在线且 capabilities.cameraCapture=true
    转发请求到目标显示端

显示端收到 listDisplayCameras:
    更新显示端摄像头状态为“正在刷新摄像头”
    按需申请 video 权限
    enumerateDevices() 并只保留 videoinput
    回传 { type: "displayCameraDevices", requestId, devices }
    更新显示端摄像头状态为“摄像头已就绪”或“摄像头错误”

显示端收到 requestDisplayCamera(mode, cameraId):
    停止旧轨道和旧定时器
    更新显示端摄像头状态为“正在拍照”或“正在启动实时预览”
    以 cameraId 打开一个 MediaStream
    如果 mode=single:
        优先使用视频轨道创建 ImageCapture 并调用 takePhoto 获取照片 Blob
        将照片 Blob 转换为 JPEG Base64
        如果 ImageCapture 不支持或拍照失败:
            等待 video.readyState 达到可绘制状态和稳定视频帧
            canvas 绘制一帧 JPEG
        首帧等待超时则返回明确错误并释放轨道
        回传 displayCameraResult
        更新显示端摄像头状态为“拍照完成”
        释放轨道
    如果 mode=realtime:
        每约 400ms 绘制低分辨率 JPEG
        回传 displayCameraFrame
        更新显示端摄像头状态为“实时预览中”
        直到 stopDisplayCamera

显示端收到 stopDisplayCamera:
    释放轨道和定时器
    更新显示端摄像头状态为“实时预览已停止”

服务端收到显示端摄像头消息:
    校验消息类型、displayId、requestId 和数据大小
    转发给控制端
    不写磁盘、不广播给其他控制端
```

## 控制端 UI 伪代码

```text
renderCameraCard(display):
    展示 cameraCapture 能力
    展示 cameraDevices 下拉框
    展示刷新、拍照、开始/停止实时预览按钮
    展示最后一帧预览和最近单次照片

收到 displayCameraDevices:
    更新 displayId 对应设备列表

收到 displayCameraFrame:
    仅更新当前卡片 img.src

收到 displayCameraResult:
    保存最近单次照片
    展示“发送给 AI”按钮

发送给 AI:
    调用 Chat.attachImage(dataUrl, mimeType)
    不发送 WebSocket，等待用户发送文本消息时一起发送

控制端收到 llm.status 或 llm.statusList 中的单条状态:
    更新对应显示端的 LLM 状态和 LLM 能力状态
    只刷新 LLM 模型面板
    不调用 DeviceList.render()
    保留摄像头卡片及其 cameraDevices 下拉框的 DOM，避免列表展开时被状态更新收起
```

## AI 图片消息伪代码

```text
Chat.attachImage(image):
    校验 image 类型和大小
    追加到 pendingImages
    渲染待发送缩略图

Chat.sendMessage():
    收集文本和 pendingImages
    发送 chatMessage.images = [{ mimeType, dataUrl }]
    清空 pendingImages

服务端 handleChatMessage:
    校验图片数量、MIME 类型和 Base64 大小
    普通 LLM: 传入 llm-service 的 multimodal user content
    Agent: 返回“不支持图片输入”错误

llm-service.buildMessages:
    普通文本仍使用 string content
    有图片时使用 [{ type: "text" }, { type: "image_url" }] 内容数组
```

## 兼容性

- 浏览器和 Android WebView 使用 `navigator.mediaDevices.getUserMedia`。
- Android Manifest 声明 CAMERA，WebView 授权同时放行 VIDEO_CAPTURE；Windows Node 显示端能力为 false。
- 不修改已有录音模式、VAD、声纹和显示端能力编辑语义。
