# 显示端本地语音识别 (sherpa-onnx-wasm) 实现文档

## 概述

显示端可使用浏览器本地 WASM 进行语音识别，无需发送音频到服务器。使用 sherpa-onnx-wasm 实现，懒加载模型。

## 模块结构

```
public/js/sherpa-asr.js
└── SherpaASR 对象
    ├── init()              # 初始化（检查模型可用性、加载WASM）
    ├── checkModelAvailable() # 检查模型文件是否存在
    ├── loadWasmScripts()   # 懒加载WASM脚本
    ├── createRecognizer()  # 创建识别器
    ├── startStreaming()    # 启动流式识别
    ├── stopStreaming()     # 停止流式识别
    └── destroy()           # 销毁释放资源
```

## SherpaASR 对象

### 属性
```
recognizer: 识别器实例
stream: 识别流
isLoaded: 是否已加载
isLoading: 是否正在加载
isEnabled: 是否启用
audioContext: AudioContext 实例
mediaStream: 媒体流
sourceNode: 音频源节点
scriptNode: 脚本处理器节点
modelPath: 模型路径 (默认 /models/sherpa-onnx-wasm-asr/)
onPartial: 部分结果回调
onResult: 最终结果回调
```

### 初始化流程
```
async init(config):
    检查 isEnabled
    调用 checkModelAvailable() 检查模型文件
    如果不可用，返回 false（回退到服务器ASR）
    调用 loadWasmScripts() 加载WASM
    调用 createRecognizer() 创建识别器
    设置 isLoaded = true
```

### 懒加载机制
```
async loadWasmScripts():
    如果正在加载，直接返回
    设置 isLoading = true
    动态创建 <script> 标签加载 sherpa-onnx-wasm-main-asr.js
    等待 Module.onRuntimeInitialized
    超时30秒后报错
```

### 流式识别
```
async startStreaming(mediaStream):
    检查 isLoaded 和 recognizer
    创建 AudioContext (sampleRate=16000)
    创建 MediaStreamSource
    创建 ScriptProcessor (bufferSize=4096)
    
    onaudioprocess:
        获取输入音频数据 (Float32Array)
        调用 recognizer.acceptWaveform(stream, samples)
        循环获取结果:
            isFinal=true: 调用 onResult(text)
            isFinal=false: 调用 onPartial(text), break
    
    连接音频节点: source -> scriptNode -> destination
```

### 停止识别
```
stopStreaming():
    断开 scriptNode 和 sourceNode
    关闭 AudioContext
    获取最终识别结果
    重置识别流
```

## 显示端集成

### checkAsrStatus 修改
```
async checkAsrStatus():
    1. 尝试 initLocalAsr() 初始化本地ASR
    2. 如果本地ASR可用，设置 localAsrAvailable=true
    3. 否则回退到服务器端 ASR (/api/asr/status)
```

### initLocalAsr
```
async initLocalAsr():
    检查 window.SherpaASR 是否存在
    从 /api/config/localAsr 获取启用状态
    调用 SherpaASR.init()
    设置回调:
        onPartial: 更新语音文本显示
        onResult: 发送语音输入到服务器
```

### startVoiceRecording 修改
```
async startVoiceRecording():
    如果 localAsrAvailable && SherpaASR.isLoaded:
        调用 SherpaASR.startStreaming(micStream)
        设置 localAsrStreaming = true
        直接返回（不使用 MediaRecorder）
    否则:
        使用原有的 MediaRecorder + 服务器ASR 流程
```

### sendVoiceStatus 修改
```
sendVoiceStatus():
    如果 !isListening && localAsrStreaming:
        调用 SherpaASR.stopStreaming()
        设置 localAsrStreaming = false
```

## 配置 API

### GET /api/config/localAsr
获取本地ASR启用状态。

### POST /api/config/localAsr
更新本地ASR启用状态。

## 回退策略

1. 优先尝试本地 WASM ASR
2. 模型文件不可用 → 回退到服务器 ASR
3. WASM 加载失败 → 回退到服务器 ASR
4. 本地 ASR 运行时错误 → 回退到服务器 ASR

## 相关文件

| 文件 | 说明 |
|------|------|
| public/js/sherpa-asr.js | 本地ASR模块 |
| public/display.html | 显示端集成 |
| server.js | 配置API端点 |

## 服务端 ASR (src/external/asr/asr-service.js)

### 概述

服务端使用 sherpa-onnx-node 进行语音识别，支持 WAV 文件和通过 ffmpeg 转换的其他音频格式。

### SherpaOnnxASR 类

```
类 SherpaOnnxASR:
    属性:
        modelDir: 模型目录路径
        initialized: 是否已初始化
        recognitionQueue: Promise 串行队列
        maxQueueLength: 最大排队数量
        pendingCount: 当前排队和执行数量
        completedCount: 已完成识别数量
    
    initRecognizer():
        加载 SenseVoice 模型 (model.int8.onnx)
        创建 OfflineRecognizer 实例:
            numThreads: 1（减少 ONNX Runtime arena 内存占用）
            provider: "cpu"
        设置 initialized = true
    
    isReady():
        返回 initialized && recognizer !== null
    
    recognize(audioPath):
        如果 pendingCount >= maxQueueLength:
            抛出 "ASR 忙" 错误
        pendingCount += 1
        将任务追加到 recognitionQueue:
            调用 performRecognition(audioPath)
            finally:
                pendingCount -= 1
                completedCount += 1
                tryCompactMemory()
        返回排队任务结果

    performRecognition(audioPath):
        创建 stream = recognizer.createStream()
        读取音频数据 = readWavFile(audioPath)
        stream.acceptWaveform(samples, sampleRate)
        recognizer.decode(stream)
        result = recognizer.getResult(stream)
        finally:
            destroyStreamSafely(stream)
            audioData.samples = null
        返回 result.text

    destroyStreamSafely(stream):
        如果 stream 支持 destroy():
            try 调用 stream.destroy()
            catch 记录日志

    tryCompactMemory():
        如果 pendingCount > 0，返回
        如果 completedCount 不是 20 的倍数，返回
        读取 process.memoryUsage()
        如果 RSS < 200MB，返回
        如果距上次回收 < 5分钟，返回
        lastTrimTime = now
        setImmediate:
            global.gc()  // V8 堆回收
            malloc_trim()  // glibc 原生堆回收（通过 C++ addon）
            如果 freed > 0:
                记录 RSS 变化
    
    readWavFile(filePath):
        读取文件到 buffer
        解析 WAV 头部获取 sampleRate、bitsPerSample、dataOffset
        使用 Buffer.from() 复制音频数据（避免持有完整文件引用）
        转换为 Float32Array samples
        返回 { samples, sampleRate }
    
    convertAudioFile(filePath):
        使用 ffmpeg 转换为 16kHz 单声道 WAV
        解析转换后的文件
        返回 { samples, sampleRate }
```

### 独立进程客户端 IsolatedAsrProcessClient（一次性进程模式）

```
类 IsolatedAsrProcessClient:
    属性:
        options: 构造选项
        requestTimeoutMs: 单次识别超时（默认 60000ms）
        maxQueueLength: 最大并发子进程数
        pendingCount: 当前正在执行的子进程数

    isReady():
        返回 true（不需要持久连接，随时可 fork）

    recognize(audioPath):
        如果 pendingCount >= maxQueueLength:
            抛出 "ASR 忙" 错误
        pendingCount += 1
        try:
            调用 spawnWorker(audioPath)
        finally:
            pendingCount -= 1

    spawnWorker(audioPath):
        fork('src/external/asr/asr-worker-process.js')
        生成唯一 requestId
        设置超时定时器（requestTimeoutMs）
        绑定 message/exit/error 事件
        发送 IPC 消息 {type:'recognize', id, audioPath, options}
        返回 Promise:
            resolve: 收到 {type:'response', id, ok:true, text}
            reject: 超时 / 进程异常退出 / 进程启动失败 / 识别错误

    关键设计:
        - 每次识别创建新进程，识别完进程自动退出
        - 超时后 SIGKILL 强制终止
        - settled 标志防止重复 resolve/reject
        - 通过 pendingCount/maxQueueLength 限制并发
```

### ASR 子进程脚本 asr-worker-process.js（一次性生命周期）

```
process.on('message') type='recognize':
    asr = new SherpaOnnxASR(options)  // 加载模型
    if !asr.isReady():
        send {type:'response', id, ok:false, error:'初始化失败'}
        process.exit(1)
    try:
        text = await asr.recognize(audioPath)
        send {type:'response', id, ok:true, text}
    catch error:
        send {type:'response', id, ok:false, error}
    setImmediate(() => process.exit(0))

### 运行模式选择（默认 isolated）

```
resolveIsolateProcessConfig(options):
    如果 options.mode == 'isolated':         // 优先使用新 mode 字段
        返回 {enabled: true, ...}
    如果 options.mode == 'embedded':
        返回 {enabled: false, ...}
    向后兼容: 检查 options.isolateProcess.enabled

init(options):
    isolateConfig = resolveIsolateProcessConfig(options)
    如果 isolateConfig.enabled:
        asrInstance = new IsolatedAsrProcessClient(options)
        currentMode = 'isolated'
    否则:
        asrInstance = new SherpaOnnxASR(options)
        currentMode = 'embedded'

reset(options):        // 运行时切换模式
    销毁 asrInstance
    asrInstance = null
    调用 init(options)

getMode():
    返回 currentMode
```

### 运行时 API

```
GET /api/config/asrMode
    -> {status:'success', mode:'embedded'|'isolated'}

POST /api/config/asrMode {mode:'isolated'}
    -> 更新配置，调 asr.reset() 重建实例
    -> broadcast {type:'asrModeChanged', mode}
    -> {status:'success', mode}

GET /api/asr/status
    -> {..., mode:'embedded'|'isolated', ...}
```

### 内存管理

- `recognize()` 中创建的 stream 必须在获取结果后调用 `destroy()` 释放 native 内存
- `readWavFile()` 使用 `Buffer.from()` 复制音频数据片段，避免 `buffer.slice()` 持有完整文件引用
- 异常路径中也必须调用 `stream.destroy()` 防止泄漏
- `recognize()` 采用串行队列访问单个 recognizer，避免并发请求导致 native 资源叠加
- 服务端在 ASR 空闲且 RSS 超过 1GB 或 ArrayBuffers 偏高时按批次触发 `global.gc()`，帮助回收外部内存
- **独立进程模式（一次性进程）：**
  - 每次 `recognize()` 调用 fork 新进程，识别完成后子进程自动 exit(0)，native 模型内存完全释放回 OS
  - 主进程不加载 `sherpa-onnx-node`，仅持有轻量 child_process 句柄
  - `pendingCount` / `maxQueueLength` 控制并发子进程数量，避免同时加载多个模型实例导致 RSS 暴涨
  - 子进程默认 60 秒超时，超时后 SIGKILL 强制终止，不会泄漏僵尸进程
  - 每次识别都有完整的模型加载/销毁周期，适合低频识别场景；高频场景建议使用内嵌模式

## ASR 压测脚本 (src/scripts/asr-stress-test.js)

```
main():
    解析命令行参数:
        --url 服务端地址
        --file 音频文件路径
        --total 总请求数
        --concurrency 并发数
        --timeout 单请求超时
        --output-every 输出频率
        --retry-429 429 重试次数
        --stats-interval 服务端指标采样间隔
        --no-system-stats 关闭服务端指标采样

    如果 file 不存在:
        自动生成 16kHz 单声道 WAV 样本

    读取音频文件为 Buffer
    构造 multipart/form-data 请求体
    记录初始进程内存

    如果启用服务端指标采样:
        周期性请求 /api/system-stats
        记录服务端 process.rss / heapUsed / external / arrayBuffers
        输出实时服务端内存日志

    启动多个 worker 并发发送请求:
        调用 /api/asr/recognize
        统计 success / ignored / busy429 / failed
        统计平均延迟和最大延迟
        每 outputEvery 次输出一次 RSS / Heap / External / ArrayBuffers

    全部完成后输出总耗时、成功率、内存快照
    如果启用服务端指标采样:
        输出服务端峰值指标
        输出 RSS / External / ArrayBuffers ASCII 曲线
```

## 内存优化

### RSS 分布诊断 (server-app.js)

```
getRssLayout():
    读取 /proc/self/smaps_rollup
    输出 RSS/PSS/Heap/External 汇总

getTopSmapsRss(topN=8):
    读取 /proc/self/smaps
    解析每个内存区段（[heap]、[anon]、共享库等）的 Rss
    按 RSS 从大到小排序，取 topN 输出
    用于定位 ONNX Runtime 原生内存占用分布
```

### malloc-trim 原生回收模块

路径: `src/native/malloc-trim/malloc-trim.cc`

```
C++ N-API addon:
    导出 trim() 函数
    调用 glibc malloc_trim(0) 释放 heap 中空闲内存页回 OS
    编译: node-gyp rebuild
    作用: 回收 ONNX Runtime arena 在 glibc 堆中的空闲内存
    触发: ASR 每 20 次识别 / 最少 5 分钟间隔

开关控制:
    选项: mallocTrimEnabled (构造函数 options 传入)
    默认: true
    作用: false 时跳过 malloc_trim 调用，V8 GC 仍正常执行
    场景: 某些环境下 malloc_trim 可能引起性能抖动，可通过此开关关闭
```

### ONNX Runtime 内存特性

```
问题:
    - sherpa-onnx 加载 229MB model.int8.onnx
    - 首次推理时 ONNX Runtime 分配完整计算图内存（arena + mmap）
    - RSS 从 ~375MB 跳至 ~800MB（V8 Heap 仅 ~12MB）
    - arena 内存管理机制导致 RSS 不回落

缓解措施:
    1. numThreads: 1 减少线程池和中间缓冲区
    2. malloc_trim() 定期回收 glibc heap 空闲页
    3. RSS 超 500MB 时报警并打印 Top RSS 区段分布
    4. 服务端定时清理 ASR 临时文件时打印文件大小

改动的文件:
    - src/external/asr/asr-service.js (numThreads, tryCompactMemory, RSS 监控)
    - 3rd/ttslive/core/asr.js (numThreads)
    - src/native/malloc-trim/malloc-trim.cc (新增 malloc_trim addon)
    - src/native/malloc-trim/binding.gyp (新增编译配置)
    - src/apps/server/boot/server-app.js (getRssLayout, getTopSmapsRss, 清理日志)
```

## 内容过滤 (server-app.js)

```
常量 IGNORED_PATTERNS = [
    /^(the|a|an|is|are|was|were|it|this|that|so|um|uh|oh|ah|yeah|yes|no|ok|okay|hey|hi|hello)[.!?]?$/i,
    /^[a-z]{1,3}[.!?]?$/i,
    /^[\s\p{P}]+$/u,
    /^[\s.!?，。！？、]+$/
]

函数 hasValidContent(text):
    hasChinese = /[一-龥]/.test(text)
    hasEnglish = /[a-zA-Z]/.test(text)
    hasNumber = /[0-9]/.test(text)

    // 无任何有效字符
    如果 not hasChinese and not hasEnglish and not hasNumber:
        返回 false

    // requireChinese 配置：强制要求包含中文
    如果 config.get('asr.requireChinese', false) 且 not hasChinese:
        记录日志 "忽略非中文输入"
        返回 false

    // 检查忽略模式
    trimmed = text.trim().toLowerCase()
    对于 IGNORED_PATTERNS 中的每个 pattern:
        如果 pattern.test(trimmed):
            返回 false

    // 纯英文短输入过滤
    wordCount = trimmed.split(/\s+/).filter 非空
    如果 hasEnglish and not hasChinese and wordCount < 2:
        cleanWord = trimmed.replace 标点
        如果 cleanWord.length < 4:
            返回 false

    // 中文短输入过滤
    如果 hasChinese:
        chineseChars = text.match(/[一-龥]/g)
        如果 chineseChars.length < 2:
            返回 false

    返回 true
```
