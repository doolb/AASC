# 服务端 TTS 稳定性设计文档

## 2026-09-30 TTS 音频内存下发（已实现，待现场验收）

用户希望消除服务端下发TTS时的临时WAV及逐文件清理日志。原实现有两个写盘入口：`src/external/tts/tts-service.js` 将外部HTTP音频通过pipeline写盘，`server-app.js` 的 `generateTtsWithFallback` 将显示端回传base64写盘。API、普通聊天、Agent、提醒、报时及文本媒体均主要通过basename构造 `/uploads/tts/<name>.wav` 下发；继续沿用URL可以兼容网页/控制端/Android/Node的队列、播放目标与打断消息。

新增进程内音频缓存：完整合成成功后保存WAV Buffer并生成随机音频引用，原生成接口保留字符串引用与basename用法；在uploads静态路由之前提供内存音频GET/HEAD处理，支持Content-Type、长度和单段Range。多显示端重复读取同一条音频，不在第一次下载后立即删除；在有效期内可重复读取。服务端重启后临时引用失效，与永久媒体分离。

采用10分钟TTL、缓存总量128MiB、最多1024条及单段16MiB限制，并在请求生成/存取时清理过期缓存。容量不足时拒绝新增，不驱逐仍有效但可能尚在队列中的音频；响应中保留Buffer引用直到传输结束。HTTP响应超限、异常断连或超时停止收集，不缓存半成品，错误体继续有上限。显示端回传音频进入同一缓存，不再二次写盘。既有WAV仅沿用历史过期清理和兼容读取，不删除整个目录，新音频不再产生逐文件清理日志。历史文件清理完成后不再定时扫描磁盘，兼容旧静态文件读取。128MiB限制仅指缓存，合成在途响应、解码及正在发送的Buffer另占内存。

另发现 `src/apps/voice-display-node/audio-player.js` 在下载及Buffer播放时均写 `audio_*.wav`。用户已确认一起去掉；Linux通过aplay标准输入播放，Windows通过PowerShell标准输入转MemoryStream/SoundPlayer播放，保留队列、停止、完成回执及PCM/AEC回调。macOS Buffer播放改用ffplay标准输入，显式本地文件继续支持afplay。上游TTS引擎自身的输出方式不属于此次服务端中转优化。

用户已确认服务端和Node子显示端一起改，已完成实现；停止须取消下载/子进程，播放与队列以代次隔离，旧任务不得覆盖新会话。WAV按RIFF块解析16位PCM，保留AEC回调；Windows音频经stdin，不放进命令行。无需新增npm生产依赖。新增 `tts-audio-cache.js` 与 `tts-audio-http.js`，源脚本静态语法与定向差异空白检查通过，未执行自动/实际声音播放测试。Offline服务包已处于待构建状态，保持servicePackage=true；按用户要求提交；尚未重启或发布。

## 音频缓存容量远端设置（2026-09-30，已实现）

缓存默认总上限提高到128MiB；控制端“语音生成设备”卡片可设置16–1024整数MiB，单段16MiB、1024条和10分钟有效期保持。服务端合成和显示端回传共享同一容量。

控制端通过setTtsAudioCacheConfig发送容量，服务端共用规范化规则，config.set持久化tts.audioCacheMaxMiB后立即应用，并广播ttsAudioCacheConfig权威值。连接/重连补发当前容量；没有新增HTTP配置读取/保存入口。保存失败回传旧容量，运行值不变；控制端等待权威回包，断线或10秒无回应解除保存等待。

首次加载无配置时使用128MiB；Android禁用外部TTS时也会独立恢复缓存容量；tts.init部分配置不包含容量时保留当前值。降低上限不清除有效音频，已占容量超过新上限时拒绝新增，等待过期释放；提高上限立即允许新音频。此上限不包含在途响应、解码和发送占用，不是进程RSS上限。Windows Node仍通过内存流播放，无新增临时WAV。

涉及tts-audio-cache-config/cache/service、config-app-service、server-app、控制端upload.html/tts.js/websocket.js；仅静态检查，未新增或执行测试、重启或发布。

## 功能目标

- 服务端调用外部 TTS 接口生成音频时，避免异常网络场景导致资源长期占用
- 失败路径需要释放请求连接和收集中的Buffer，降低RSS波动风险
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

### 显示端语音输入单目标动态播放路由

显示端语音输入的 TTS 也纳入统一路由：输入来源 `displayId` 与播放目标分离。服务端统一生成音频后，按文本媒体相同的动态目标规则选择一个在线 `voicePlayback` 显示端：来源显示端具备语音播放能力时优先来源端，否则按稳定顺序选择第一个可用显示端。每个 TTS 句子在生成开始和发送前重新解析目标，来源端断开或关闭能力后，后续句子可以切换到备用显示端。

语音命令、语音触发的普通对话、搜索、帮助、确认和模式提示均只向本句选中的一个显示端发送 `tts/playAudio`，不再向全部语音播放显示端广播。控制端显式指定的目标也遵循“指定目标优先、其他可用语音显示端兜底”；`playOnControl` 继续由控制端播放。停止播报、播放状态和完成回执必须绑定实际选中的显示端，不能因为存在备用显示端而产生重复播放或错误恢复。

该路由已于 2026-09-12 实现，并由纯函数目标解析器与文本媒体 TTS 共用来源优先、能力兜底规则。

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

### 2. 内存音频统一回收

- 成功响应有限收集到Buffer，校验RIFF/WAVE后才入缓存
- 响应error/aborted、请求超时、大小超限统一销毁连接并释放收集引用

### 3. 过期音频和历史文件清理

- 新音频仅内存缓存，定期/存取时释放过期Buffer；满额拒绝新增，不驱逐有效排队引用
- 旧磁盘WAV保留原过期规则，严格文件名和普通文件检查；汇总清理数量，迁移结束后不再扫描

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
