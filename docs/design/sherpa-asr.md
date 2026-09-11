# 服务端语音识别设计文档

## 功能目标

- 服务端提供统一的 ASR HTTP 接口，供控制端、显示端、子显示端上传音频识别
- 识别过程需要限制并发访问，避免 `sherpa-onnx-node` 的 native 资源在高频请求下持续堆积
- 识别完成后必须立即释放流对象和音频样本引用，防止 RSS 持续上涨；ASR HTTP 请求不再创建临时文件
- 当服务端 ASR 负载过高时，需要快速拒绝新请求，避免排队无限增长

## 设计方案

### 1. 单识别器串行执行

- `src/external/asr/asr-service.js` 中的 `SherpaOnnxASR` 维持单个 `OfflineRecognizer`
- 所有 `recognize()` 请求进入串行队列，同一时刻只允许一个识别任务访问 native recognizer
- 队列长度设置上限，超过上限时直接返回忙碌错误，避免请求堆积造成内存膨胀

### 2. 识别生命周期管理

- 每次识别独立创建 `stream`
- `decode()` 完成后统一走 `finally`
- 在 `finally` 中调用 `stream.destroy()` 释放 native 对象
- 同时清空 `audioData.samples` 引用，缩短大数组存活时间

### 3. 内存音频输入

- `src/apps/server/boot/server-app.js` 的 `/api/asr/recognize` 使用 `multer.memoryStorage()`，短音频直接以 `Buffer` 进入识别或显示端转发流程
- 上传大小限制为 10MB，解析失败或超限时直接返回 JSON 错误，不生成 ASR 临时文件
- `SherpaOnnxASR.recognize()` 同时接受历史文件路径和新的 `Buffer`；WAV 直接解析，其他输入通过 ffmpeg stdin/stdout 管道转换为 16kHz 单声道 WAV，不再生成转换临时文件
- 声纹注册等仍依赖路径的旧上传接口继续使用各自临时目录，不与 ASR HTTP 上传共用生命周期

### 4. 内存回收触发策略

- 识别队列为空时，按批次检查 `process.memoryUsage()`
- 仅在 RSS 超过 1GB 或 ArrayBuffers 超过阈值时尝试触发 `global.gc()`
- 避免每次识别后强制 GC，减少抖动

### 5. 压测验证工具

- 提供 `scripts/stress/asr-stress-test.js` 作为服务端 ASR 压测脚本
- 脚本直接以 multipart/form-data 调用 `/api/asr/recognize`
- 支持总请求数、并发数、超时、429 重试次数等参数
- 每隔固定进度输出一次 RSS / Heap / External / ArrayBuffers，便于观察是否进入平台期
- 未提供样本音频时自动生成 16kHz 单声道 WAV 测试文件
- 默认联动拉取 `/api/system-stats`，输出服务端进程 RSS / Heap / External / ArrayBuffers 峰值和 ASCII 曲线
- 支持关闭服务端指标采样，避免在纯接口连通性测试时产生额外请求

### 6. 识别进程隔离（一次性进程模式）

- 通过 `asr.mode` 配置切换运行模式，`"isolated"`（默认，独立进程模式）或 `"embedded"`（内嵌模式）
- 向后兼容旧的 `asr.isolateProcess.enabled` 配置
- 独立进程模式下，主服务进程不直接加载 `sherpa-onnx-node`，改为每次 `recognize()` 调用 `fork` 一个新的 ASR 子进程
- 子进程加载 SenseVoice 模型、执行识别、通过 IPC 返回结果，然后调用 `process.exit(0)` 退出
- 主进程通过 advanced IPC 发送 `{ type: 'recognize', id, audioBuffer 或 audioPath, options }` 请求，子进程返回 `{ type: 'response', id, ok, text }`
- 每个请求使用超时保护（`requestTimeoutMs`），超时后 `SIGKILL` 强制终止子进程
- 通过 `pendingCount` / `maxQueueLength` 限制并发子进程数量，防止同时加载多个模型实例导致内存暴涨
- 识别完成后子进程立即退出，native 模型内存完全释放回操作系统，仅在识别期间占用内存

### 8. 中文内容强制过滤

- 通过 `asr.requireChinese` 配置（默认 `false`）控制
- 启用后，ASR 识别结果中**不包含中文字符**的文本将被过滤，返回 `ignored`
- 该配置影响服务端 `/api/asr/recognize` 和显示端代理 ASR 两条路径
- 配置读取位置：`server-app.js` 的 `hasValidContent()` 函数

### 7. 运行时模式切换 API

- `GET /api/config/asrMode` 返回当前 ASR 运行模式
- `POST /api/config/asrMode` 运行时切换模式，请求体 `{ "mode": "embedded" | "isolated" }`
- 切换时调用 `asr.reset()` 销毁旧实例、根据新配置重建 ASR 实例
- `GET /api/asr/status` 返回 `mode` 字段标识当前模式
- 模式切换后通过 WebSocket 广播 `{ type: 'asrModeChanged', mode }` 给控制端

## 风险与约束

- 串行识别会降低峰值吞吐，但能换取更稳定的 native 内存占用
- 当客户端瞬时并发过高时，可能收到 429 忙碌响应，调用端需要具备重试能力
- `global.gc()` 依赖启动参数 `--expose-gc`，未开启时系统仍可正常工作，只是缺少主动回收
- **一次性独立进程模式**每次识别需要重新加载模型（~120MB ONNX），增加 ~200-500ms 冷启动延迟
- 并发识别时（`maxQueueLength > 1`），每个子进程独立加载模型，RSS 叠加为 `N × 模型内存`，需平衡并发数与可用内存
- 子进程 exit(0) 后模型内存完全释放，但频繁 fork/exit 可能增加 PID 压力和进程调度开销
