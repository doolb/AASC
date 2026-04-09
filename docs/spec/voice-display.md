# 纯语音输入输出显示端 实现文档

## 概述

独立的 Go 程序，作为纯语音交互的显示端客户端，通过 WebSocket 连接到主服务器，接收 TTS 音频播放，并通过本地 ASR 发送语音输入。

## 项目结构

```
voice-display/
├── main.go        # 主程序，WebSocket 连接和消息处理
├── audio.go       # 音频播放器
├── asr.go         # ASR 语音识别引擎
├── recorder.go    # 音频录制器
├── config.json    # 配置文件
└── go.mod         # Go 模块定义
```

## 配置格式

```json
{
    "serverUrl": "http://localhost:3000",
    "asrModelPath": "",
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
    asr: *ASREngine
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

## ASREngine 语音识别引擎

```
type ASREngine struct:
    model: whisper.Model
    language: string
```

### 流式识别
```
ProcessStream(audioChan, callback):
    创建 whisper.Context
    从 audioChan 读取音频数据
    累积到 buffer
    buffer 达到 3秒 (48000 samples) 时执行识别
    识别结果通过 callback 返回
    isFinal=true 表示最终结果
```

### 识别函数
```
recognize(audio):
    创建新的 whisper.Context
    设置语言为中文
    调用 Process 处理音频
    遍历 NextSegment 获取结果文本
    返回拼接的文本
```

## AudioRecorder 音频录制器

```
type AudioRecorder struct:
    context: *oto.Context
    recording: bool
    mu: sync.Mutex
```

### 录音流程
```
Start(audioChan, stopChan):
    创建 oto.Context (16kHz, 单声道, 16bit)
    循环读取音频数据
    转换为 float32 格式
    计算 RMS 音量
    RMS >= 阈值: 标记有语音
    RMS < 阈值 且 有语音 且 持续足够长: 发送到 audioChan
    监听 stopChan 退出
```

### VAD 静音检测
```
参数:
    silenceThreshold: 0.01 (RMS阈值)
    minSpeechDuration: 300 (最短语音时长ms)
    
逻辑:
    有语音 + RMS < 阈值 + 语音持续 > minSpeechDuration -> 发送识别
```

## 启动流程

```
main():
    加载配置文件
    创建 VoiceDisplay
    注册信号处理 (SIGINT, SIGTERM)
    调用 Start():
        初始化 AudioPlayer
        初始化 ASREngine (可选)
        初始化 AudioRecorder
        连接服务器
        启动语音识别 (如果ASR可用)
        启动消息监听
    等待退出信号
    调用 Stop() 清理资源
```

## 依赖

| 包 | 版本 | 说明 |
|------|------|------|
| github.com/gorilla/websocket | v1.5.1 | WebSocket 客户端 |
| github.com/hajimehoshi/oto/v2 | v2.4.0 | 音频播放 |
| github.com/maxhawkins/go-whisper | v0.1.0 | Whisper 语音识别 |
