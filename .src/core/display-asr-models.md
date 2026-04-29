#skill: ai-code-translation

# 显示端语音识别 - 核心模型

## 模块
core

## 目标文件清单

- `src/apps/server/boot/server-app.js` // WS 消息处理 + ASR 设备 API + pendingDisplayAsrRequests
- `src/external/asr/asr-service.js` // 服务端 ASR 引擎 SherpaOnnxASR
- `src/core/viewbind/WSViewBindServer.js` // 注册 ASR 相关 handler

## 范围约束

- 只改服务端 handler 注册和消息流转，不动前端 WASM 加载逻辑
- 服务端 ASR（asr-service.js）不动，只新增 audioChunk 流转 handler
- 现有 pendingDisplayAsrRequests + asrResult 模式不动，只补 audioChunk 支线

## 已有声明（真实路径与行号）

- `class SherpaOnnxASR` 位于 `src/external/asr/asr-service.js:14` // 服务端 ASR
- `asr.recognize(audioData)` 位于 `asr-service.js` // 语音识别方法
- `pendingDisplayAsrRequests = new Map()` 位于 `server-app.js:155` // 显示端 ASR 请求池
- `function sendAudioToDisplayAsr(display, audioBase64, requestId)` 位于 `server-app.js:1737` // 发送音频到显示端
- `function findDisplayWithAsr()` 位于 `server-app.js:1715` // 查找支持 ASR 的显示端
- `asrResult` 处理位于 `server-app.js:2003-2015` // 显示端回传识别结果
- `voiceInput` 处理位于 `handleDisplayMessageFallback:2137` // 显示端语音转发到控制端
- `asrDeviceChanged` 广播位于 `server-app.js:632-635` // ASR 设备切换通知
- `broadcastToControls` 位于 `server-app.js:1698` // 广播消息
- `sendToDisplay` 位于 `server-app.js:1749` // 发送消息到显示端
- `config.set('asr.device')` 位于 `server-app.js:630` // ASR 设备配置持久化

## 新增定义

无  // 不新增独立模型类，现有 pendingDisplayAsrRequests + sendAudioToDisplayAsr 已覆盖核心需求
    // 仅需在 wsServer 上注册 audioChunk handler 处理显示端→服务端的音频流转

## 操作流程

### ASR 设备切换（现有完整，不动）

- 控制端切换 ASR 设备 → POST /api/config/asrDevice { device: 'server'|'display' }
- 服务端保存 device 到 config
- 服务端广播 asrDeviceChanged 给所有控制端和显示端
- 显示端收到后加载/卸载 sherpa-onnx-wasm（前端逻辑）

### 显示端 ASR 处理（现有完整，不动）

- 服务端调用 sendAudioToDisplayAsr → 发送 asrAudio 到显示端
- 显示端本地识别 → 返回 asrResult{ requestId, text }
- 服务端 ws.on('message') 中匹配 pendingDisplayAsrRequests → resolve

### 显示端→服务端音频流转（新增 audioChunk handler）

- 显示端采集音频（device=server 模式）
- 显示端分片发送 audioChunk{ requestId, data: base64, isLast, sampleRate }
- wsServer 注册 'audioChunk' handler
  - 按 requestId 创建 AsrSession，累积 audioChunks
  - isLast 为 true → 合并 chunks 为完整音频 Buffer
  - 调用 asr.recognize(fullAudioBuffer)
  - 结果通过 broadcastToControls 作为 voiceInput 推送给控制端
  - 超过 30 秒未收全 → 丢弃并报错
