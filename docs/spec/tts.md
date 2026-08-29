# 服务端 TTS 稳定性实现文档

## 模块位置

- `src/external/tts/tts-service.js`
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
            成功 → 保存 WAV 并返回路径
            失败/超时 → 继续服务端生成
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

    outputPath = generateUniquePath()
    await callExternalTTS(text, voice, speed, outputPath)

    if outputPath 不存在:
        throw 错误

    return outputPath
```

### callExternalTTS

```
callExternalTTS(text, voice, speed, outputPath):
    初始化 settled=false
    构建 POST JSON 请求

    定义 done(error, resultPath):
        如果已 settled 直接返回
        标记 settled=true
        如果 error:
            删除 outputPath 半成品文件
            reject(error)
        否则:
            resolve(resultPath)

    req = http.request(options, onResponse)
    req.setTimeout(requestTimeoutMs)
    req.on('error', done(error))
    req.write(postData)
    req.end()

onResponse(res):
    if statusCode != 200:
        读取错误体(最多 maxErrorBytes)
        end 时 done(错误)
        return

    writeStream = fs.createWriteStream(outputPath)
    pipeline(res, writeStream, (error) => {
        if error:
            done(写入失败错误)
        else:
            done(null, outputPath)
    })
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
- 写入流统一由 `pipeline` 收敛成功和错误路径
- 失败路径删除半成品音频文件
- 错误响应体读取做字节上限控制

## Wine TTS 队列实现索引

`3rd/tts-server/docs/spec/tts-wine-queue-stability.md` 描述 Wine worker 显式派发、FIFO 队列、断连/排队超时和 100 字稳定性测试伪代码。

`3rd/tts-server/docs/spec/tts-wine-rss-stability.md` 描述 Embedded Speech SDK synthesizer 的每请求释放、worker 请求数上限回收和 RSS 回归测试伪代码。

## Linux TTS 服务

Linux TTS 的 HTTP、队列、CLI 和运行时路径伪代码见 `docs/spec/tts-linux.md`。

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
