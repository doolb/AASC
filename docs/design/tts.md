# 服务端 TTS 稳定性设计文档

## 功能目标

- 服务端调用外部 TTS 接口生成音频时，避免异常网络场景导致资源长期占用
- 失败路径需要释放请求连接、写入流和半成品文件，降低 RSS 波动风险
- 保持现有 `/api/tts/generate` 接口协议不变，改动仅限内部可靠性

## 设计方案

### 省略号句间停顿

- 连续英文句点 `..` 以上和中文省略号 `…` 作为句间边界，`你好......世界` 拆为 `你好`、`世界` 两句 TTS。
- 如果相邻分句自身都只包含标点，连续标点分句只保留第一个；例如 `喵呜……`、`？`、`！` 中删除 `！`，避免无意义的标点音频重复排队。
- 任意最终仅包含标点的 TTS 分句都直接跳过，不调用显示端或服务端合成；界面显示的原始文本不变。
- 不修改控制端/显示端显示的原始文本；只改变 TTS 句子队列。
- TTS 生成输入中的省略号边界标记转换为单个英文句点，避免单句音频包含过长省略号停顿；实际句间间隔由音频队列和 TTS 引擎决定。
- 单个英文句点仍遵守原有英文句末规则，不因普通小数点或缩写被误拆。
- 单个英文句点不转换，避免影响英文小数和普通英文句末。

### 统一显示端优先生成路由

显示端语音输入的 TTS 也纳入统一路由：输入来源 `displayId` 与播放目标分离。服务端统一生成音频后，按当前在线 `voicePlayback` 能力发送到语音播放显示端；来源显示端只接收需要展示的命令结果，不因发起输入而获得默认播放优先级。控制端显式指定目标和控制端本地播放继续沿用原路由。

### 显示端实际 CPU 并发

- Display APK 连接和 CPU 配置实际应用完成后回报实际 CPU topology 与 TTS 有效槽位。
- 服务端按目标显示端的 TTS 有效槽位限制生成并发，最多同时生成两句；生成完成顺序不作为播放顺序，播放仍按原句序发送。
- 普通 Chat、旧版 Chat、手动 TTS 和 Agent 流式 TTS 均使用有序并发调度器；显示端有两个有效 TTS 槽位时最多同时生成两句，发送/播放仍按句子进入顺序。
- 没有显示端 CPU 状态、目标为控制端播放、使用服务端 TTS，或显示端仅有一个 TTS 槽位时，调度器退回单路串行。
- 并发只发生在音频生成阶段，不改变前端文本流式回传和显示端音频播放器的串行播放模型。
- 2026-08-29 真机复测：跳过仅标点分句后，上述文本只生成 `喵呜……` 和正文两段；当前 APK 未回报 `cpuStatus`，串行总耗时约 2966ms，比原基线减少约 1766ms。

- `tts.device=display` 时，所有服务端 TTS 生成入口统一经过 `generateTtsWithFallback()`。
- 显示端在线且具备 `ttsGeneration` 能力时优先生成；显示端失败、离线或超时自动回退服务端。
- 显示端收到 `ttsGenerate` 后必须在 3 秒内回 `ttsGenerating`；未确认接受任务即回退服务端，确认后总生成超时仍为 60 秒。
- API、聊天、Agent、文本媒体、语音指令、提醒和整点报时不再各自直接调用底层 `tts.generateTTS()`。
- 底层 `tts.generateTTS()` 只保留在统一 fallback 函数的最终服务器分支；生成设备与播放目标仍然分离。

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

## 3rd/tts-server Wine TTS

- Wine TTS 使用常驻 worker 和 FIFO 队列；任务由调度器显式绑定 worker。
- 排队任务支持断连移除、排队超时和队列上限；100 字压测需同时观察请求延迟与进程树 RSS。
- Embedded Speech SDK 的 synthesizer 复用实验会加剧 RSS；Wine worker 默认每处理 10 个 S 请求后在任务完成边界重启，限制 native footprint 累积。首次合成常驻内存仍需按运行环境监控。

## 3rd/tts-server Linux TTS

- Linux TTS 服务设计见 `docs/design/tts-linux.md`。
- `tts-linux.js` 与 Wine TTS 保持 HTTP 接口兼容，但默认通过独立 Linux CLI 子进程执行合成。
- 正式运行时资源放在 `3rd/tts-server/linux` 或由环境变量指定，不依赖 `NaturalVoiceSAPIAdapter`。
- Linux/Wine/APK 使用同一硬编码授权串；Wine 默认 prefix 位于 `3rd/tts-server/wine/runtime/prefix`。

## 内置 tts.server 服务任务

- `tts.server` 是唯一的服务任务，通过实例参数 `engine=wine|linux` 选择本机 TTS HTTP 服务实现。
- 任务实例参数包含 `port`，监听地址固定为 `127.0.0.1`；默认端口为 `3001`，Wine 和 Linux 服务均使用与主服务器 TTS 客户端兼容的 `/api/tts`、`/api/voices` 和 `/api/tts/status` 接口。
- `engine=wine` 启动 `3rd/tts-server/tts-wine.js`，不依赖 Win7 虚拟机；`engine=linux` 启动 `3rd/tts-server/tts-linux.js` 并显式使用共享模型目录。
- 任务系统只创建一个 `tts.server` server service 实例，并根据该实例的 `running` 状态在主服务器启动时自动恢复；重复启动同一 server service scope 会先停止旧实例。
- 服务就绪后只更新主服务器通用 TTS URL；本阶段保持 `tts.serverEnabled=false`，不启用显示端失败后的服务器 TTS 回退。
- 主服务器继续使用 `src/external/tts/tts-service.js` 的 HTTP 客户端，不直接调用 Wine worker 或 Linux CLI。
