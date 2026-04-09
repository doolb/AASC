# 纯语音输入输出显示端 实现文档

## 概述

独立的 Go 程序，作为纯语音交互的显示端客户端，通过 WebSocket 连接到主服务器，接收 TTS 音频播放，并通过服务器端 ASR 发送语音输入。本地只负责录音和 VAD 检测，识别由服务器完成。

## 项目结构

```
voice-display/
├── main.go        # 主程序，WebSocket 连接和消息处理
├── audio.go       # 音频播放器
├── asr.go         # 服务器端 ASR 客户端
├── recorder.go    # 音频录制器（录音 + VAD + WAV 编码）
├── config.json    # 配置文件
└── go.mod         # Go 模块定义
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
    建立 WebSocket 连接
    发送注册消息: { type: "register", clientType: "display", displayId }
```

### 消息处理
```
handleMessage(msgType, data):
    "tts":
        playAudio -> 从URL下载并播放音频
        play -> 播报文本
        stop -> 停止播放
    "voiceInput": 记录确认
    "control": 记录控制指令
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
```

### 播放流程
```
PlayFromURL(url):
    HTTP GET 下载音频
    读取全部数据到内存
    创建 oto.Player 播放
    等待播放完成
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

## 依赖

| 包 | 版本 | 说明 |
|------|------|------|
| github.com/gorilla/websocket | v1.5.1 | WebSocket 客户端 |
| github.com/hajimehoshi/oto/v2 | v2.4.0 | 音频播放 |
| github.com/gen2brain/malgo | v0.11.6 | 音频录制（麦克风输入） |
