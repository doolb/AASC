#skill: ai-code-translation

# 显示端 ASR 自测

## 模块
core

## 目标文件清单
- `src/apps/server/boot/server-app.js` // wsServer 注册段

## 测试场景

### audioChunk 消息处理

- 显示端发送 audioChunk（isLast=false）→ 服务端累积，不触发识别
- 显示端发送 audioChunk（isLast=true）→ 服务端合并缓冲区，调用 asr.recognize
- 多分片发送 → 按 requestId 正确合并
- 超时未收全 → 丢弃并清理 session
- 无对应 asr 引擎时不崩溃
