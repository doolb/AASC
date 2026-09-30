# 服务端 TTS 稳定性实现文档

## 2026-09-30 内存音频下发（已实现）

```text
已有声明:
  tts.generateTTS、generateTtsWithFallback、/api/tts/generate、uploads静态路由
  下发消息中的audioUrl、basename音频引用、有序调度、播放目标/完成回执
新增定义:
  AudioEntry { name, buffer, expiresAt }
  AudioCache { entries, totalBytes, ttlMs=10分钟, maxBytes=128MiB默认, maxAudioBytes=16MiB, maxEntries=1024 }
  AudioCacheConfig { audioCacheMaxMiB=128默认, 范围16..1024, 整数MiB }
  容量规范化 -> 有限数字或非空数字字符串取整并限制16..1024，其余回退128
  启动 -> getTtsConfig读取并规范化持久化容量 -> configure缓存（含Android禁用外部TTS场景）
  tts.init完整配置 -> 热应用容量；外部服务启用策略不影响缓存配置加载
  部分tts.init不携带容量 -> 保留当前缓存上限
  控制端连接/重连 -> 服务端补发ttsAudioCacheConfig当前容量
  控制端语音生成设备卡片 -> 容量输入/保存 -> setTtsAudioCacheConfig {maxMiB, requestId}
  服务端仅接受控制端 -> 规范化maxMiB -> config.set(tts.audioCacheMaxMiB)
    保存失败 -> 回传旧权威容量和错误；不改变缓存运行值
    保存成功 -> configure缓存 -> 广播ttsAudioCacheConfig {maxMiB, requestId}
  控制端仅在回包后应用权威值；自己的请求回包显示成功/失败，其他端静默同步
  断线取消等待；10秒无回包显示未收到结果并解除等待；重连初始化恢复持久化值
  不新增HTTP配置入口
  降低容量 -> 保留有效音频，超过新上限时拒绝新增，直到自然过期释放
操作流程（用户确认服务端和Node一起改）:
  外部TTS成功响应 -> 限长收集Buffer；错误/超时/截断 -> 清理请求与收集引用
  显示端回传base64 -> 校验解码大小 -> 同一缓存入口
  缓存入口 -> 删除过期项 -> 单段/总量超限则失败 -> 随机name -> 缓存完整音频
  generateTTS/统一fallback -> 返回字符串音频引用，保持basename调用方式
  原发送逻辑 -> /uploads/tts/name -> 保持目标、句序、队列及打断信息
  uploads静态路由前:
    GET/HEAD内存音频 -> 查询缓存，返回audio/wav、长度、no-store
    单段Range有效 -> 206/Content-Range；范围不可满足 -> 416
    HEAD -> 只返回头；GET -> 发送Buffer/切片，响应持有引用直到发送结束
    不因首次读取删除 -> 多端/重试在有效期内继续读取
    旧磁盘WAV -> 兼容静态路由；过期内存引用 -> 明确失败
  清理 -> 释放过期Buffer与总量计数；旧文件清理仅处理已有历史WAV
  历史目录不存在或所有旧WAV已过期清理 -> 后续周期仅清内存，不再扫描磁盘
  Node播放无文件:
    URL下载 -> Buffer -> 系统播放器标准输入；直接Buffer同一入口
    Windows -> stdin -> MemoryStream/SoundPlayer；Linux -> aplay stdin
    保留队列/打断/回执/PCM-AEC，macOS使用ffplay
  Windows数据通过stdin传base64，不嵌入命令行；Linux stdin传WAV
  下载设置AbortController/长度上限，停止取消下载并杀当前播放器
  播放与队列携带代次，旧任务完成不得覆盖新播放/空闲状态
  stop同步通知当前队列播放结束以恢复录音，旧回调不重复通知
  缓存条数最多1024；满额只拒绝新增，不重新触发已经完成的显示端合成
  WAV解析遍历RIFF块，确认16位PCM后才给AEC回调
  macOS Buffer使用ffplay stdin；显式本地文件播放仍可用afplay
  Offline servicePackage=true；不执行测试、重启或发布
```

## 模块位置

- `src/external/tts/tts-service.js`
- `src/external/tts/tts-audio-cache.js`
- `src/external/tts/tts-audio-cache-config.js`
- `src/apps/server/modules/tts/tts-audio-http.js`
- `src/apps/voice-display-node/audio-player.js`
- `src/apps/server/modules/config/config-app-service.js`
- `src/apps/server/boot/server-app.js`
- `src/apps/server/modules/media/ordered-task-scheduler.js`
- `src/apps/server/modules/chat/agent-chat-tts.js`

## 配置结构

```
tts:
    serviceUrl: string
    defaultVoice: string
    defaultSpeed: number
    requestTimeoutMs: number
    maxErrorBytes: number
```

## 核心流程伪代码

### 显示端实际 CPU 并发

```text
显示端连接或 CPU 配置应用成功:
    APK 读取当前 topology 和 TTS policy
    通过 WS 发送 cpuStatus

服务端生成文本 TTS:
    读取目标显示端 tts.totalCoreCount
    并发上限 = max(1, min(2, tts.totalCoreCount))
    创建有序 TTS 调度器
    普通 Chat、旧版 Chat、手动 TTS、Agent 流式 TTS 将每句生成任务按顺序入队
    如果句子 trim 后仅包含 Unicode 标点和波浪号:
        直接跳过，不调用 TTS，不发送失败回退
    最多同时生成两句
    某句生成完成后先放入按 sentenceIndex 排序的完成表
    只有前序句已完成时才发送当前句音频
    调度器空闲后才结束本次 Chat/TTS 请求

实测复测:
    当前 Android 显示端 cpuStatus=null 时，文本“喵呜……？！（耳朵瞬间变得通红”跳过“？”后只生成两段
    两段生成到播放下发耗时约为 211ms、448ms，播放端按顺序播放
    从服务端收到请求到最后一段播放结束约 2966ms，不再触发第二段失败回退

有序 TTS 调度器:
    enqueue(task):
        为任务分配递增 sentenceIndex
        active < concurrency 且有待处理任务时立即启动
        task 只负责生成 WAV，不直接发送音频
        生成完成后保存结果，按连续 sentenceIndex 依次 resolve

选择并发上限:
    如果目标是控制端播放:
        返回 1
    如果 tts.device != display:
        返回 1
    找到目标显示端的 ttsGeneration 能力和 cpuStatus:
        返回 max(1, min(2, cpuStatus.tts.totalCoreCount))
    否则:
        返回 1
```

### 省略号句间停顿

```text
splitIntoSentences(text):
    连续两个及以上英文句点的最后一个字符作为句末边界
    连续中文省略号的最后一个字符作为句末边界
    例如“你好......世界” -> [“你好......”, “世界”]
    如果当前分句和前一个分句都只包含标点:
        丢弃当前分句
    例如“喵呜……？！ （耳朵瞬间变得通红” ->
        [“喵呜……”, “？”, “（耳朵瞬间变得通红”]

isPunctuationOnly(text):
    trim text
    如果非空且全部为 Unicode 标点或波浪号:
        返回 true
    否则返回 false

所有 TTS 入口:
    分句入队或单句生成前调用 isPunctuationOnly
    true -> 直接跳过该句
    false -> 继续统一 TTS 路由

normalizeTtsPauseText(text):
    如果 text 不是字符串:
        原样返回
    将句子末尾的连续英文句点或中文省略号替换为一个英文句点
    返回合成输入文本

TTS 生成:
    先按原始文本分句
    保留原始句子用于显示消息
    每个句子单独调用统一 TTS 路由
```

省略号会改变 TTS 句子数量，但不会修改界面展示文本。

### 所有服务端 TTS 统一路由

```text
generateTtsWithFallback(text, voice, speed, preferredDisplayId):
    if config.tts.device == display:
        display = 优先查找 preferredDisplayId，否则查找任意支持 ttsGeneration 的显示端
        if display 存在:
            下发 ttsGenerate
            3 秒内未收到 ttsGenerating → 判定失败并回退
            收到 ttsGenerating 后等待 WAV
            成功 → 校验并缓存 WAV Buffer，返回音频引用字符串
            失败/超时 → 继续服务端生成；缓存满额则直接失败，不重复合成
    return generateTTS(text, voice, speed)

服务端入口:
    API / 聊天 / Agent / 文本媒体 / 语音指令 / 提醒 / 整点报时
    → generateTtsWithFallback

TTS 显示端回包:
    ttsGenerating(requestId) → 表示显示端已接受生成任务
    ttsResult(requestId,audioData) → 成功
    ttsResult(requestId,error) → 失败
    未收到 ttsGenerating(3 秒) → 失败

TaskManager:
    注入 generateTtsWithFallback 到内置任务上下文
    time.announce 使用 context.generateTTS

显示端语音输入 TTS:
    sourceDisplayId = voiceInput.displayId
    preferredDisplayId = sourceDisplayId
    每句 TTS 在生成开始和发送前读取 getOnlineVoicePlaybackDisplayIds()
    targetDisplayId = resolveVoicePlaybackTarget(preferredDisplayId, availableDisplayIds)
    如果 sourceDisplayId 在线且 voicePlayback == true:
        targetDisplayId = sourceDisplayId
    否则:
        targetDisplayId = availableDisplayIds[0]
    如果 targetDisplayId 存在:
        只向 targetDisplayId 发送 {
            type: 'tts',
            action: 'playAudio',
            audioUrl: audioPath,
            text: text
        }
    否则:
        跳过当前 TTS，并记录没有可用语音播放显示端

语音触发的普通对话:
    使用 sourceDisplayId 优先的单目标语音路由
    每句生成完成时重新解析唯一 targetDisplayId

控制端定向语音:
    preferredDisplayId = 显式 targetDisplayId
    targetDisplayId 在线且 voicePlayback == true 时优先该目标
    否则按在线 voicePlayback 列表第一个目标兜底
    TTS 生成仍调用 generateTtsWithFallback

停止播报:
    记录当前语音会话实际 targetDisplayId
    只向实际目标发送 tts.stop
    不向全部 voicePlayback 显示端广播
```

### 显示端 TTS 下发睡眠检查

```text
sendToDisplay(displayId, message, options={}):
    if options.checkSleep == true:
        display = displayClients.get(displayId)
        if display.state.sleepState 为 sleep/deep:
            return false
    发送 message
    return true

time.announce:
    生成一次音频
    对每个 displayId:
        sendToDisplay(displayId, message, { checkSleep: true })

聊天/Agent/其他 TTS:
    sendToDisplay(displayId, message, { checkSleep: false })
```

`tts.generateTTS()` 不负责睡眠判断；睡眠策略属于目标显示端的服务器发送接口。

### generateTTS

```
generateTTS(text, voice, speed):
    if text 为空:
        throw 错误

    audioBuffer = await callExternalTTS(text, voice, speed)
    audioReference = cache.storeAudio(audioBuffer)
    返回audioReference字符串（供basename/URL使用，不是磁盘路径）

```

### callExternalTTS

```
callExternalTTS(text, voice, speed):
    初始化settled、chunks和received
    创建POST请求，保留按排队数量增加的请求超时
    非200响应 -> 最多收集maxErrorBytes，截断或结束时失败
    200响应 -> Content-Length或累积大小超过16MiB则销毁连接并失败
    data -> 保存有限chunk；aborted/error/超时 -> 清除chunks与连接，失败
    end且响应完整 -> 合并为Buffer并清除chunks引用，成功
    生成入口再校验RIFF/WAVE并存入缓存，返回字符串引用
```

## 配置 API 伪代码

### GET /api/tts/config

```
返回:
    serviceUrl
    defaultVoice
    defaultSpeed
    requestTimeoutMs
    maxErrorBytes
```

### POST /api/tts/config

```
从 body 读取 serviceUrl/defaultVoice/defaultSpeed/requestTimeoutMs/maxErrorBytes
调用 config.setTtsConfig()
调用 tts.init(config.getTtsConfig())
返回 success
```

## 内存与资源回收要点

- 请求超时后立即销毁 socket，避免连接悬挂
- HTTP响应在内存收集，成功结束后才发布；连接/响应错误和超时统一收敛
- 失败路径释放连接和收集Buffer，不发布半成品；历史磁盘文件仅按原有效期清理
- 错误响应体读取做字节上限控制

## Wine TTS 队列实现索引

`3rd/tts-server/docs/spec/tts-wine-queue-stability.md` 描述 Wine worker 显式派发、FIFO 队列、断连/排队超时和 100 字稳定性测试伪代码。

`3rd/tts-server/docs/spec/tts-wine-rss-stability.md` 描述 Embedded Speech SDK synthesizer 的每请求释放、worker 请求数上限回收和 RSS 回归测试伪代码。

## Linux TTS 服务

Linux TTS 的 HTTP、队列、CLI 和运行时路径伪代码见 `docs/spec/tts-linux.md`。

## tts.server 内置服务任务

```text
tts.server:
    id = 'tts.server'
    target = 'server'
    mode = 'service'
    params = [engine, port]
    engine 默认 'wine'
    port 默认 3001

run(context):
    engine = 校验 params.engine，只允许 wine 或 linux
    port = 校验 params.port，为 1024..65535 的整数
    如果 engine == wine:
        entry = 3rd/tts-server/tts-wine.js
        环境变量 PORT = port
        环境变量 WINEPREFIX = 3rd/tts-server/wine/runtime/prefix
        环境变量 WINE_BIN_DIR = 3rd/tts-server/wine/bin
    如果 engine == linux:
        entry = 3rd/tts-server/tts-linux.js
        环境变量 PORT = port
        环境变量 TTS_LINUX_BIN = 3rd/tts-server/linux/bin/tts_linux
        环境变量 TTS_LINUX_MODEL_DIR = 3rd/tts-server/models/extracted
        环境变量 TTS_LINUX_SDK_DIR = 3rd/tts-server/linux/lib

    启动 process.execPath + entry，绑定 stdout/stderr 日志
    轮询 http://127.0.0.1:port/api/tts/status，直到 HTTP 200 或启动超时
    服务未就绪:
        终止子进程
        返回启动失败
    服务已就绪:
        setTtsServiceUrl('http://127.0.0.1:port/api/tts')
        推送 widget 状态 { engine, port, status: 'running' }
        返回 { type: 'service', stop }

stop():
    发送 SIGTERM，超时后发送 SIGKILL
    恢复任务启动前的通用 TTS serviceUrl
    推送 widget 状态为 stopped
```

自动恢复流程:

```text
任务索引中存在一个 tts.server server service 实例且 status == 'running'
    -> TaskManager.restoreAutoStartServices()
    -> submit(instance) 保留 instanceId、params 和 builtinId
    -> runInstance(instance)
    -> tts.server.run(context)
    -> 更新主服务器内存中的通用 serviceUrl
```

## TTS 压测脚本 (src/scripts/tts-stress-test.js)

```
main():
    解析命令行参数:
        --url 服务端地址
        --text 合成文本
        --voice 音色
        --speed 语速
        --total 总请求数
        --concurrency 并发数
        --timeout 单请求超时
        --output-every 输出频率
        --stats-interval 服务端指标采样间隔
        --no-system-stats 关闭服务端指标采样

    如果启用服务端指标采样:
        周期拉取 /api/system-stats
        记录并输出服务端 CPU 与进程内存指标

    启动 worker 并发请求 /api/tts/generate:
        统计 success / failed
        统计平均延迟与最大延迟
        周期输出压测进度和本地进程内存

    压测结束后:
        输出汇总结果
        输出服务端峰值与 RSS/External/ArrayBuffers ASCII 曲线
```
