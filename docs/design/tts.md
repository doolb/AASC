# 服务端 TTS 稳定性设计文档

## 功能目标

- 服务端调用外部 TTS 接口生成音频时，避免异常网络场景导致资源长期占用
- 失败路径需要释放请求连接、写入流和半成品文件，降低 RSS 波动风险
- 保持现有 `/api/tts/generate` 接口协议不变，改动仅限内部可靠性

## 设计方案

### 0. 显示端睡眠检查由调用方指定

- `tts.generateTTS()` 只负责调用外部服务生成音频，不读取显示端睡眠状态。
- 服务器向显示端发送 TTS 音频时支持 `checkSleep` 选项，默认 `false`。
- 只有 `time.announce` 使用 `checkSleep=true`；聊天 Agent、普通 LLM、手动 TTS、提醒和语音指令不受显示端睡眠影响。
- 多显示端广播按目标显示端分别检查 `sleepState`，一个显示端睡眠不影响其他显示端。

### 1. 请求超时保护

- 在 `tts` 配置增加 `requestTimeoutMs`，默认 20000ms
- 超时后主动 `destroy` 请求，避免连接悬挂

### 2. 流式写盘统一回收

- 成功响应使用 `pipeline(res, writeStream)` 写入音频文件
- `pipeline` 错误路径统一回调，避免只监听单一事件造成漏回收

### 3. 失败文件清理

- 请求失败、写入失败、超时失败都尝试删除目标输出文件
- 防止半写 `.wav` 累积占用磁盘并延长对象生命周期

### 4. 错误体上限

- 在 `tts` 配置增加 `maxErrorBytes`，默认 64KB
- 非 200 响应仅收集有限错误体，避免异常大响应导致内存突增

### 5. 配置透传

- `config/config.json` 与 `src/apps/server/modules/config/config-app-service.js` 扩展 TTS 配置项
- `/api/tts/config` 支持读写新增字段，便于线上动态调优

### 6. 压测验证工具

- 新增 `src/scripts/tts-stress-test.js`，直接压测 `/api/tts/generate`
- 支持总请求数、并发数、超时、输出频率、文本/音色/语速参数
- 默认联动拉取 `/api/system-stats`，输出服务端 RSS/Heap/External/ArrayBuffers 峰值与 ASCII 曲线
- 支持 `--no-system-stats` 关闭服务端采样，适配纯链路连通性测试

## 风险与约束

- 超时值过小会增加误判失败率，需要根据实际 TTS 服务耗时调参
- 错误体截断会损失部分调试信息，但可以换取更稳定的内存上限
