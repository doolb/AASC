# 纯语音输入输出显示端 实现文档

## 概述

独立的客户端程序，作为纯语音交互的显示端，通过 WebSocket 连接到主服务器，接收 TTS 音频播放，并通过服务器端 ASR 发送语音输入。本地只负责录音和 VAD 检测，识别由服务器完成。

支持两种实现：
- **Go 实现** (`voice-display/`)：无窗口界面，适合后台运行
- **Node.js 实现** (`voice-display-node/`)：跨平台，依赖 ffmpeg

## 项目结构

### Go 实现

```
voice-display/
├── main.go        # 主程序，WebSocket 连接和消息处理
├── audio.go       # 音频播放器
├── asr.go         # 服务器端 ASR 客户端
├── recorder.go    # 音频录制器（录音 + VAD + WAV 编码）
├── config.json    # 配置文件
└── go.mod         # Go 模块定义
```

### Node.js 实现

```
voice-display-node/
├── main.js            # 主程序，WebSocket 连接和消息处理
├── audio-player.js    # 音频播放器（Speaker + wav 解码）
├── asr-client.js      # 服务器端 ASR 客户端
├── audio-recorder.js  # 音频录制器（ffmpeg + VAD + WAV 编码）
├── config.json        # 配置文件
└── package.json       # Node.js 模块定义
```

## 配置格式

```json
{
    "serverUrl": "http://localhost:3000",
    "displayId": "voice-display-1",
    "vadThreshold": 0.5
}
```

## VoiceDisplay 主结构

```
type VoiceDisplay struct:
    config: *Config
    ws: *websocket.Conn
    wsMutex: sync.Mutex
    asr: *ServerASR
    audio: *AudioPlayer
    recorder: *AudioRecorder
    stopChan: chan struct{}
    connected: bool
    connMutex: sync.Mutex
```

### 连接流程
```
Connect():
    解析服务器URL
    构建 WebSocket URL (ws:// 或 wss://)
    连接路径: /display?subDisplay=true&displayId=<displayId>
    建立 WebSocket 连接
    （不再需要发送 register 消息，服务端通过 URL 参数识别子显示端）
```

### 消息处理
```
handleMessage(msgType, data):
    "displayId": 记录服务端分配的显示端ID
    "serverStartTime": 记录服务器启动时间
    "restoreState": 记录恢复状态
    "tts":
        playAudio -> 从URL下载并播放音频
        play -> 播报文本
        stop -> 停止播放
    "voiceInput": 记录确认
    "control": 记录控制指令
    "media": 记录媒体指令（子显示端不支持媒体显示）
```

### 重连机制
```
reconnect():
    最多重试5次
    每次间隔递增 (2s, 4s, 6s, 8s, 10s)
    重连成功后恢复消息监听
    全部失败后退出程序
```

## AudioPlayer 音频播放器

```
type AudioPlayer struct:
    context: *oto.Context
    player: *oto.Player
    mu: sync.Mutex
    stopChan: chan struct{}
    playQueue: []queueItem
    queueMu: sync.Mutex
    processing: bool
    stopRequested: bool

type queueItem struct:
    itemType: string  // "url" 或 "data"
    url: string
    data: []byte
```

### 播放队列机制
```
QueueURL(url):
    重置 stopRequested = false
    将 {type: "url", url} 加入 playQueue
    启动 processQueue 协程

QueueData(data):
    重置 stopRequested = false
    将 {type: "data", data} 加入 playQueue
    启动 processQueue 协程

processQueue():
    如果 processing == true，返回（避免重复处理）
    设置 processing = true
    循环:
        如果 stopRequested 或队列为空，退出循环
        取出队列首项
        根据 itemType 调用 PlayFromURL 或 playData
    设置 processing = false

ClearQueue():
    清空 playQueue

Stop():
    设置 stopRequested = true
    设置 processing = false
    关闭当前 player
```

### 播放流程
```
PlayFromURL(url):
    加锁
    如果 stopRequested，跳过播放
    HTTP GET 下载音频
    读取全部数据到内存
    调用 playData 播放
    解锁

playData(data):
    如果 stopRequested，跳过播放
    关闭旧 player
    创建新 oto.Player 播放
```

## ServerASR 服务器端语音识别客户端

```
type ServerASR struct:
    serverURL: string
    client: *http.Client
}
```

### 检查 ASR 可用性
```
IsReady() bool:
    发送 GET /api/asr/status 请求
    解析响应: { ready: bool }
    返回 ready 状态
```

### 识别音频
```
Recognize(wavData []byte) (string, error):
    创建 HTTP POST 请求到 /api/asr/recognize
    构造 multipart/form-data，字段名 "audio"，文件名 "audio.wav"
    发送请求
    解析响应:
        status == "success": 返回 text
        status == "ignored": 返回空字符串
        其他: 返回错误
```

## AudioRecorder 音频录制器

```
type AudioRecorder struct:
    recording: bool
    mu: sync.Mutex
    sampleRate: int (16000)
}
```

### 录音流程
```
Start(audioChan chan<- []byte, stopChan <-chan struct{}) error:
    使用 malgo 初始化麦克风录音
    配置: 16kHz, 单声道, 16bit PCM
    循环读取音频数据
    转换为 int16 格式
    计算 RMS 音量
    RMS >= 阈值: 标记有语音，累积音频数据
    RMS < 阈值 且 有语音 且 持续足够长:
        将累积的 int16 数据编码为 WAV 格式
        发送 WAV 字节到 audioChan
    监听 stopChan 退出
```

### WAV 编码
```
encodeWAV(samples []int16, sampleRate int) []byte:
    写入 RIFF 头
    写入 fmt 子块 (PCM, 单声道, 16bit, sampleRate)
    写入 data 子块 (原始 PCM 数据)
    返回完整 WAV 字节
```

### VAD 静音检测
```
参数:
    silenceThreshold: 0.01 (RMS阈值)
    minSpeechDuration: 300 (最短语音时长ms)

逻辑:
    有语音 + RMS < 阈值 + 语音持续 > minSpeechDuration -> 编码WAV并发送
```

## 语音识别流程

```
startVoiceRecognition():
    检查服务器 ASR 是否可用 (asr.IsReady())
    启动 goroutine:
        创建 audioChan (chan []byte)
        启动 recorder.Start(audioChan, stopChan)
        循环从 audioChan 读取 WAV 数据
        调用 asr.Recognize(wavData) 发送到服务器识别
        如果识别结果非空，调用 sendVoiceInput(text)
```

## 启动流程

```
main():
    加载配置文件
    创建 VoiceDisplay
    注册信号处理 (SIGINT, SIGTERM)
    调用 Start():
        初始化 AudioPlayer
        初始化 ServerASR (传入服务器URL)
        检查服务器 ASR 可用性
        初始化 AudioRecorder
        连接服务器
        启动语音识别 (如果服务器ASR可用)
        启动消息监听
    等待退出信号
    调用 Stop() 清理资源
```

## Go 实现依赖

| 包 | 版本 | 说明 |
|------|------|------|
| github.com/gorilla/websocket | v1.5.1 | WebSocket 客户端 |
| github.com/hajimehoshi/oto/v2 | v2.4.0 | 音频播放 |
| github.com/gen2brain/malgo | v0.11.6 | 音频录制（麦克风输入） |

---

## Node.js 实现

### VoiceDisplay 主类

```
class VoiceDisplay:
    config: Object
    ws: WebSocket
    asr: ServerASR
    audio: AudioPlayer
    recorder: AudioRecorder
    connected: boolean
    stopController: AbortController
    reconnectAttempts: number
    heartbeatInterval: 定时器引用
    heartbeatIntervalMs: number (60000)
```

### 连接流程
```
connect():
    解析服务器URL
    构建 WebSocket URL (ws:// 或 wss://)
    连接路径: /display?subDisplay=true&displayId=<displayId>
    创建 WebSocket 连接
    监听 open 事件:
        设置 connected = true
        重置 reconnectAttempts = 0
        调用 startHeartbeat() 启动心跳
    监听 message 事件处理消息
    监听 close 事件触发重连
    监听 error 事件处理错误
```

### 心跳机制
```
startHeartbeat():
    调用 stopHeartbeat() 停止已有心跳
    设置 heartbeatInterval = setInterval(() => {
        如果 WebSocket 已连接 (readyState === OPEN):
            发送 { type: 'heartbeat' }
    }, heartbeatIntervalMs)
    打印日志 "[心跳] 已启动，间隔 60 秒"

stopHeartbeat():
    如果 heartbeatInterval 存在:
        清除定时器
        设置 heartbeatInterval = null

心跳时机:
    启动: WebSocket 连接成功后
    停止: stop() 方法中
```

### 消息处理
```
handleMessage(msgType, data):
    "displayId": 记录服务端分配的显示端ID
    "serverStartTime": 记录服务器启动时间
    "restoreState": 记录恢复状态
    "tts":
        playAudio -> 从URL下载并播放音频
        play -> 播报文本
        stop -> 停止播放
    "voiceInput": 记录确认
    "control": 记录控制指令
    "media": 记录媒体指令（子显示端不支持媒体显示）
```

### 重连机制
```
reconnect():
    检查是否达到最大重连次数 (5次)
    计算延迟 (重试次数 * 2000ms)
    延迟后尝试重新连接
    重连成功后重置计数器
    全部失败后退出程序
```

### AudioPlayer 音频播放器

```
class AudioPlayer:
    isPlaying: boolean
    stopRequested: boolean
    currentProcess: ChildProcess
    tempDir: string
    playQueue: Array<{type: 'url'|'buffer', url?: string, buffer?: Buffer}>
    isProcessingQueue: boolean
```

#### 播放队列机制
```
queueURL(url):
    重置 stopRequested = false
    将 {type: 'url', url} 加入 playQueue
    调用 processQueue()

queueBuffer(wavBuffer):
    重置 stopRequested = false
    将 {type: 'buffer', buffer: wavBuffer} 加入 playQueue
    调用 processQueue()

processQueue():
    如果 isProcessingQueue == true，返回（避免重复处理）
    设置 isProcessingQueue = true
    循环:
        如果 stopRequested 或队列为空，退出循环
        取出队列首项
        根据 type 调用 playFromURL 或 playWavBuffer
    设置 isProcessingQueue = false

clearQueue():
    清空 playQueue
```

#### 播放流程
```
playFromURL(url):
    如果 stopRequested，跳过播放
    下载音频到临时文件
    调用 playFile(tempFile)
    删除临时文件

playFile(filePath):
    如果 stopRequested，跳过播放
    根据平台选择播放命令:
        Windows: powershell -c "(New-Object Media.SoundPlayer filePath).PlaySync()"
        macOS: afplay filePath
        Linux: aplay filePath
    创建子进程执行命令
    等待播放完成
```

#### 停止播放
```
stop():
    设置 stopRequested = true
    调用 currentProcess.kill() 终止子进程
    重置 isPlaying = false
    重置 isProcessingQueue = false
```

### ServerASR 服务器端语音识别客户端

```
class ServerASR:
    serverURL: string
    ready: boolean
```

#### 检查 ASR 可用性
```
checkReady():
    发送 GET /api/asr/status 请求
    解析响应: { ready: boolean }
    更新 ready 状态
    返回 ready 状态
```

#### 识别音频
```
recognize(wavData):
    创建 HTTP POST 请求到 /api/asr/recognize
    使用 FormData 构造 multipart/form-data
    字段名 "audio"，文件名 "audio.wav"
    发送请求
    解析响应:
        status == "success": 返回 { text, status: "success" }
        status == "ignored": 返回 { text: "", status: "ignored" }
        其他: 抛出错误
```

### AudioRecorder 音频录制器

```
class AudioRecorder:
    sampleRate: number (16000)
    vadThreshold: number (0.01)
    minSpeechDuration: number (300)
    recording: boolean
    audioInput: naudiodon.AudioIO
```

#### 录音流程
```
start(onAudioData, signals):
    创建 naudiodon.AudioIO 实例:
        channelCount: 1
        sampleFormat: SampleFormat16Bit
        sampleRate: 16000
        deviceId: -1 (默认设备)
    监听 data 事件接收音频数据
    按帧处理 (20ms/帧):
        转换为 int16 格式
        计算 RMS 音量
        RMS >= 阈值: 标记有语音，累积音频数据
        RMS < 阈值 且 有语音 且 持续足够长:
            编码为 WAV 格式
            调用 onAudioData(wavData)
    监听 stopSignal 退出
    调用 audioInput.start() 开始录音
```

#### 停止录音
```
stop():
    设置 recording = false
    调用 audioInput.quit() 关闭录音器
    重置 audioInput = null
```

#### 获取设备列表
```
static getDevices():
    调用 naudiodon.getDevices()
    过滤出 maxInputChannels > 0 的设备
    返回可用音频输入设备列表
```

#### WAV 编码
```
encodeWAV(samples, sampleRate):
    创建 Buffer (44字节头 + 数据)
    写入 RIFF 头
    写入 fmt 子块 (PCM, 单声道, 16bit, sampleRate)
    写入 data 子块 (原始 PCM 数据)
    返回 Buffer
```

#### VAD 静音检测
```
参数:
    vadThreshold: 0.01 (RMS阈值)
    minSpeechDuration: 300 (最短语音时长ms)

逻辑:
    有语音 + RMS < 阈值 + 语音持续 > minSpeechDuration -> 编码WAV并发送
```

#### 计算 RMS
```
computeRMS(samples):
    计算所有采样点的平方和
    除以采样点数量
    返回平方根
```

### 启动流程

```
main():
    加载配置文件 (config.json 或命令行参数)
    创建 VoiceDisplay 实例
    注册信号处理 (SIGINT, SIGTERM)
    调用 start():
        初始化 AudioPlayer
        初始化 ServerASR (传入服务器URL)
        检查服务器 ASR 可用性
        初始化 AudioRecorder
        连接服务器
        启动语音识别 (如果服务器ASR可用)
    等待退出信号
    调用 stop() 清理资源
```

### Node.js 依赖

| 包 | 版本 | 说明 |
|------|------|------|
| ws | ^8.16.0 | WebSocket 客户端 |
| form-data | ^4.0.0 | 构造 multipart/form-data |
| node-fetch | ^2.7.0 | HTTP 请求 |
| @picovoice/pvrecorder-node | ^1.2.8 | 音频录制（可选，预编译无需 Python） |
| naudiodon | ^2.3.3 | 音频录制（可选，需要编译） |

### 系统依赖

| 依赖 | 说明 |
|------|------|
| node-gyp | naudiodon 模块编译（可选，仅用于录音） |
| PortAudio | naudiodon 底层依赖（Windows 通常已内置） |

**注意**：音频播放已改用系统命令，无需编译原生模块：
- Windows: PowerShell `(New-Object Media.SoundPlayer).PlaySync()`
- macOS: `afplay`
- Linux: `aplay`

### Windows 安装步骤

1. **安装项目依赖**
   ```bash
   cd voice-display-node
   npm install
   ```

2. **（可选）安装录音支持**
   如果需要本地录音功能，需要安装编译工具：
   - 安装 Python 3.x 并添加到 PATH
   - 安装 Visual Studio Build Tools（选择 "Desktop development with C++"）
   - 运行 `npm install -g windows-build-tools`

   或使用预编译的 PvRecorder（推荐）：
   ```bash
   npm install @picovoice/pvrecorder-node
   ```

### 常见问题

**Q: npm install 报错 "gyp ERR! find Python"**
- 仅录音功能需要 Python，播放功能不受影响
- 如需录音，安装 Python 3.x 并添加到 PATH

**Q: npm install 报错 "gyp ERR! find VS"**
- 仅录音功能需要 VS Build Tools
- 如需录音，安装 Visual Studio Build Tools

**Q: 音频播放失败**
- Windows: 确保 PowerShell 可用
- macOS: 确保 afplay 命令存在
- Linux: 安装 alsa-utils (`apt install alsa-utils`)

### 使用方法

```bash
# 安装依赖
cd voice-display-node
npm install

# 启动（使用默认配置）
npm start

# 启动（使用指定配置文件）
node main.js /path/to/config.json
```

### 注意事项

1. **原生模块编译**：Speaker 和 naudiodon 需要编译，需要 node-gyp 和编译工具链
2. **Windows 编译工具**：运行 `npm install -g windows-build-tools` 安装编译工具
3. **PortAudio**：naudiodon 基于 PortAudio，Windows 上通常已内置
4. **跨平台兼容**：naudiodon 支持 Windows、Linux、macOS
