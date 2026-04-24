# 服务端语音识别设计文档

## 功能目标

- 服务端提供统一的 ASR HTTP 接口，供控制端、显示端、子显示端上传音频识别
- 识别过程需要限制并发访问，避免 `sherpa-onnx-node` 的 native 资源在高频请求下持续堆积
- 识别完成后必须立即释放流对象、音频样本引用和临时文件，防止 RSS 持续上涨
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

### 3. 临时文件清理

- `server.js` 的 `/api/asr/recognize` 在成功、忽略、异常三条路径都调用统一的临时文件清理函数
- 清理失败只记录日志，不影响接口响应

### 4. 内存回收触发策略

- 识别队列为空时，按批次检查 `process.memoryUsage()`
- 仅在 RSS 超过 1GB 或 ArrayBuffers 超过阈值时尝试触发 `global.gc()`
- 避免每次识别后强制 GC，减少抖动

### 5. 压测验证工具

- 提供 `scripts/asr-stress-test.js` 作为服务端 ASR 压测脚本
- 脚本直接以 multipart/form-data 调用 `/api/asr/recognize`
- 支持总请求数、并发数、超时、429 重试次数等参数
- 每隔固定进度输出一次 RSS / Heap / External / ArrayBuffers，便于观察是否进入平台期
- 未提供样本音频时自动生成 16kHz 单声道 WAV 测试文件
- 默认联动拉取 `/api/system-stats`，输出服务端进程 RSS / Heap / External / ArrayBuffers 峰值和 ASCII 曲线
- 支持关闭服务端指标采样，避免在纯接口连通性测试时产生额外请求

### 6. 识别进程隔离开关

- 在 `asr` 配置增加 `isolateProcess.enabled` 开关，默认关闭
- 开关打开时，主服务进程不直接加载 `sherpa-onnx-node`，改为 `fork` 独立 ASR 子进程
- 主进程通过 IPC 发送 `recognize(audioPath)` 请求，子进程返回识别结果
- 子进程异常退出时，按 `isolateProcess.autoRestart` 策略自动拉起，减少人工干预
- 每个请求使用超时保护（`requestTimeoutMs`），防止子进程阻塞导致接口长期挂起
- 通过进程隔离把 native 模型内存固定在子进程，降低主服务 RSS 压力和波动范围

## 风险与约束

- 串行识别会降低峰值吞吐，但能换取更稳定的 native 内存占用
- 当客户端瞬时并发过高时，可能收到 429 忙碌响应，调用端需要具备重试能力
- `global.gc()` 依赖启动参数 `--expose-gc`，未开启时系统仍可正常工作，只是缺少主动回收
