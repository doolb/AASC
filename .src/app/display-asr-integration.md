#skill: ai-code-translation

# 显示端 ASR 应用集成

## 模块
app

## 目标文件清单

- `src/apps/server/boot/server-app.js` // 注册 audioChunk handler，并让 HTTP ASR 入口直接处理内存 Buffer
- `src/external/asr/asr-service.js` // 让 SherpaOnnxASR 兼容 Buffer 输入

## 范围约束

- 保留 wsServer 的 audioChunk 兼容入口，同时统一 HTTP ASR 的 Buffer 处理
- 不修改现有 asrResult inline 处理和控制端 ASR 设备 API

## 已有声明（真实路径与行号）

- `wsServer.registerHandler` 在 server-app.js 中 wsServer 初始化后
- `displayTypes` 数组位于 `server-app.js:281` // 当前为 ['canvasSize','browserInfo','voiceInput','voiceStatus','capabilities','commandAck']
- `asr.recognize` 来自 `src/external/asr/asr-service.js`，接受 WAV Buffer 或历史文件路径
- `broadcastToControls` 位于 `server-app.js:1698`
- `voiceInput` 处理在 `handleDisplayMessageFallback:2137` // 显示端语音→控制端转发

## 操作流程

### 修改 displayTypes 注册

- displayTypes 数组新增 'audioChunk' // 注册 audioChunk handler
- handler 逻辑见 framework/display-asr-handler.md

### HTTP ASR Buffer 入口

- `/api/asr/recognize` 使用 multipart 内存存储
- `request.file.buffer` 直接传给 `asr.recognize`，或编码为 Base64 转发到显示端 ASR
- 识别完成后由服务端统一处理显示端语音结果，并返回 `processedByServer`

### 启动后完整 handler 注册表

当前 wsServer 初始化后注册的 displayTypes：
```
canvasSize, browserInfo, voiceInput, voiceStatus, capabilities, commandAck
```
新增后：
```
canvasSize, browserInfo, voiceInput, voiceStatus, capabilities, commandAck, audioChunk
```

### 注意：asrResult 不动

- asrResult 目前 inline 在 ws.on('message') 中（line 2003-2015）
- 不迁移到 wsServer handler，减少改动范围
