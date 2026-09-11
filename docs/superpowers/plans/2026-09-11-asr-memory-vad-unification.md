# ASR 内存上传与 VAD 统一实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 ASR HTTP 请求不再生成临时文件，并让网页显示端与 Node 子显示端使用统一的 VAD 阈值和 500ms 静音结束时间。

**Architecture:** 服务器 ASR 上传使用 Multer memoryStorage，ASR 服务接收 Buffer 或历史文件路径；WAV 直接解析，非 WAV 通过 ffmpeg pipe 转换。服务端将 per-display VAD 配置扩展到 `voiceVadConfig`，网页端和 Node 子显示端都动态更新本地 VAD 状态。

**Tech Stack:** Node.js、Express、Multer、child_process IPC、sherpa-onnx-node、浏览器 PCM 采集、PvRecorder/naudiodon。

**Spec:** `docs/spec/asr-memory-upload-vad-unification.md`

## Global Constraints

- ASR HTTP 音频最大 10MB，超过后返回 413 JSON。
- `vadThreshold` 默认 `0.01`，范围 `0.001..0.2`。
- `vadSilenceDurationMs` 默认 `500`，`vadMinSpeechDurationMs` 默认 `300`。
- 声纹注册、视觉上传和普通媒体上传临时文件不在本次范围内。
- 保留历史 `recognize(filePath)` 和旧 WebSocket `voiceInput` 兼容。

### Task 1: Buffer 音频适配与 ASR HTTP 内存上传

**Files:**
- Modify: `src/apps/server/boot/server-app.js`
- Modify: `src/external/asr/asr-service.js`
- Modify: `src/external/asr/asr-worker-process.js`
- Test: `tests/asr-memory-vad-unification.test.js`
- Test: `tests/asr-audio-buffer.test.js`

- [ ] 写 Buffer WAV 解析、memoryStorage 和 worker Buffer 契约测试。
- [ ] 运行测试确认在当前实现上失败。
- [ ] 实现 Buffer 解析、ffmpeg pipe 转换和 ASR 路由内存上传。
- [ ] 保留路径输入、独立进程超时和队列限制。
- [ ] 运行 ASR 定向测试和服务器语法检查。

### Task 2: 服务端 VAD 配置扩展

**Files:**
- Modify: `src/apps/server/boot/server-app.js`
- Modify: `src/apps/web-mediacenter/ui/public/display.html`
- Test: `tests/asr-memory-vad-unification.test.js`

- [ ] 增加 500ms 静音配置常量和规范化消息字段。
- [ ] 连接初始化、阈值修改和 displayList 状态返回完整 VAD 配置。
- [ ] 网页端读取动态阈值、静音时间和最短语音时间。
- [ ] 运行网页 VAD/语音回归测试。

### Task 3: Node 子显示端 VAD 配置同步

**Files:**
- Modify: `src/apps/voice-display-node/main.js`
- Modify: `src/apps/voice-display-node/audio-recorder.js`
- Modify: `src/apps/voice-display-node/audio-recorder-pv.js`
- Modify: `src/apps/voice-display-node/asr-client.js`
- Test: `tests/asr-memory-vad-unification.test.js`

- [ ] 增加动态 VAD 配置入口，默认 500ms 静音结束。
- [ ] 处理 `voiceVadConfig` WebSocket 消息并立即应用到当前录音器。
- [ ] 保持 PvRecorder 和 naudiodon 的 RMS 量纲一致。
- [ ] 新 ASR 上传携带显示端上下文时避免重复 `voiceInput` 处理。
- [ ] 运行 Node 语法和 VAD 契约测试。

### Task 4: 文档、回归与交付

**Files:**
- Modify: `docs/design.md`
- Modify: `docs/spec.md`
- Modify: `docs/design/sherpa-asr.md`
- Modify: `docs/spec/voice-display.md`
- Modify: `docs/todo.md`
- Modify: `changelog.md`

- [ ] 更新 design/spec 索引和既有实现文档中的临时文件、VAD 说明。
- [ ] 从 todo 删除本任务，记录完成内容和验证结果到 changelog。
- [ ] 运行相关定向测试、`npm test`、语法检查和 `git diff --check`。
- [ ] 检查 diff 只包含本任务文件和必要文档，不覆盖用户已有改动。
