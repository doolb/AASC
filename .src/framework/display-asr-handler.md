#skill: ai-code-translation

# 显示端 ASR handler 注册

## 模块
framework

## 目标文件清单

- `src/apps/server/boot/server-app.js` // 注册 audioChunk handler + 整合 ASR 流程
- `src/core/viewbind/WSViewBindServer.js` // 注册 handler

## 范围约束

- 不修改现有 asrResult 处理（位于 server-app.js:2003 ws.on('message') inline）
- 不修改 sendAudioToDisplayAsr 和 pendingDisplayAsrRequests
- 只新增 audioChunk handler 注册到 wsServer
- 未来 asrResult 可从 inline ws.on('message') 迁移到 wsServer handler

## 已有声明（真实路径与行号）

- `asr.recognize(audioData)` 位于 `src/external/asr/asr-service.js` // 服务端语音识别
- `pendingDisplayAsrRequests` 位于 `server-app.js:155` // Map<requestId, { resolve, reject, timer }>
- `asrResult` 处理位于 `server-app.js:2003-2015` // inline 在 ws.on('message') 中
- `AudioBuffer` 来自 Node.js 原生 Buffer // 接收显示端音频分片后合并

## 新增定义

`AsrAudioSession { requestId, chunks[], lastSeen, timer }`  // 临时累积音频分片

## 操作流程

### 注册 audioChunk handler

- wsServer.registerHandler('audioChunk', handlerFn)
- handlerFn 逻辑：
  - 从 data 中读取 requestId, chunk (base64编码), isLast, sampleRate
  - 在 AsrAudioSession 池中查找或创建 session
  - session.chunks.push(Buffer.from(chunk, 'base64'))
  - 更新 session.lastSeen
  - 若 session 首次创建，设置 30 秒超时定时器 // 超过 30 秒未收全则丢弃
  - 若 isLast 为 true：
    - 清除超时定时器
    - 合并 session.chunks 为完整 Buffer
    - await 调用 asr.recognize(fullBuffer) // 服务端识别，避免把 Promise 当成文本
    - 结果通过 broadcastToControls({ type: 'voiceInput', text, displayId, isFinal: true }) 推送
    - 清理 session

### 未来可迁移：asrResult handler

- 现有 asrResult 处理在 ws.on('message') inline 中
- 可迁移为 wsServer.registerHandler('asrResult', handlerFn)，逻辑不变
- 匹配 pendingDisplayAsrRequests → resolve/reject

### wsServer 初始化处注册

- 在 wsServer 创建后的 handler 注册段增加 audioChunk
- displayTypes 数组新增 'audioChunk'

### HTTP ASR 内存上传

- `/api/asr/recognize` 使用 multer memoryStorage，读取 `request.file.buffer`
- Buffer 直接传给服务端 ASR 或 Base64 转发给显示端 ASR
- 接口不调用 ASR 临时文件清理函数；声纹注册的独立临时文件流程保持不变
