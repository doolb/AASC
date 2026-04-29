#skill: ai-code-translation

# 显示端 ASR 应用集成

## 模块
app

## 目标文件清单

- `src/apps/server/boot/server-app.js` // 在 wsServer 注册段添加 audioChunk handler

## 范围约束

- 只修改 wsServer 初始化后的 handler 注册段
- 不修改现有 asrResult inline 处理（line 2003-2015）和控制端 ASR 设备 API（line 619-641）

## 已有声明（真实路径与行号）

- `wsServer.registerHandler` 在 server-app.js 中 wsServer 初始化后
- `displayTypes` 数组位于 `server-app.js:281` // 当前为 ['canvasSize','browserInfo','voiceInput','voiceStatus','capabilities','commandAck']
- `asr.recognize` 来自 `src/external/asr/asr-service.js`
- `broadcastToControls` 位于 `server-app.js:1698`
- `voiceInput` 处理在 `handleDisplayMessageFallback:2137` // 显示端语音→控制端转发

## 操作流程

### 修改 displayTypes 注册

- displayTypes 数组新增 'audioChunk' // 注册 audioChunk handler
- handler 逻辑见 framework/display-asr-handler.md

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
