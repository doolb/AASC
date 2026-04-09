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
