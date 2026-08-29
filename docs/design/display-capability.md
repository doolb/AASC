# 显示端分布式能力设计文档

## 概述

显示端分布式能力是指每个显示端可以声明自身具备的能力（capabilities），服务端根据能力进行智能路由，将任务分发到具备对应能力的显示端执行。

## 1. 问题背景

当前系统中，所有显示端被视为同质化节点：
- TTS 语音播放广播到所有显示端，无法区分哪些显示端有扬声器
- 语音录音在所有显示端尝试开启，无法区分哪些显示端有麦克风
- 子显示端（voice-display）只有语音能力，但也会收到媒体渲染指令
- 控制端无法了解各显示端的实际能力分布

### 1.1 典型场景

| 场景 | 当前行为 | 期望行为 |
|------|----------|----------|
| 显示端A：有扬声器、无麦克风 | 收到录音指令但无法执行 | 不发送录音指令给A |
| 显示端B：有麦克风、无扬声器 | 收到TTS播放但无法播放 | 不发送TTS给B |
| 显示端A：有本地ASR能力 | 与B同等对待 | 优先使用A进行语音识别 |
| 子显示端（纯语音） | 收到媒体渲染指令 | 只收到语音相关指令 |

## 2. 显示端能力定义

### 2.1 能力列表

| 能力ID | 名称 | 说明 | 检测方式 |
|--------|------|------|----------|
| `media-rendering` | 媒体渲染 | 能显示图片/视频 | 默认 true，子显示端为 false |
| `voice-playback` | 语音播放 | 能播放TTS音频 | 浏览器检测 AudioContext / 子显示端默认 true |
| `voice-recording` | 语音录音 | 能录制音频 | 浏览器检测 getUserMedia / 子显示端默认 true |
| `voice-recognition` | 语音识别 | 能进行本地ASR | 检测 sherpa-onnx-wasm 可用性 / 服务端ASR可用性 |
| `display-text` | 文本显示 | 能显示文字覆盖层 | 默认 true，子显示端为 false |

### 2.2 能力数据结构

```typescript
interface DisplayCapabilities {
  mediaRendering: boolean;    // 媒体渲染
  voicePlayback: boolean;     // 语音播放
  voiceRecording: boolean;    // 语音录音
  voiceRecognition: boolean;  // 语音识别
  displayText: boolean;       // 文本显示
}
```

### 2.3 默认能力

| 显示端类型 | mediaRendering | voicePlayback | voiceRecording | voiceRecognition | displayText |
|------------|:-:|:-:|:-:|:-:|:-:|
| 普通显示端 | ✅ | ✅ | ✅ | 视ASR可用性 | ✅ |
| 子显示端（voice-display） | ❌ | ✅ | ✅ | ✅ | ❌ |

## 3. 能力声明流程

### 3.1 显示端自动检测

显示端连接时自动检测自身能力：

```
显示端启动
    ↓
检测浏览器能力:
    - AudioContext → voicePlayback
    - getUserMedia → voiceRecording
    - sherpa-onnx-wasm → voiceRecognition
    - 非子显示端 → mediaRendering, displayText
    ↓
发送 capabilities 消息到服务端
    ↓
服务端存储能力到 displayClients[displayId].state.capabilities
```

### 3.2 控制端手动标记

控制端可以手动修改显示端的能力标记：

```
控制端显示端列表
    ↓
点击显示端能力编辑
    ↓
修改能力标记
    ↓
发送 updateCapabilities 消息到服务端
    ↓
服务端更新 capabilities 并广播到控制端
```

### 3.3 子显示端自动声明

子显示端（voice-display Go/Node.js/C#）连接时通过 URL 参数 `subDisplay=true` 自动声明：

```
子显示端连接 (subDisplay=true)
    ↓
服务端自动设置:
    mediaRendering = false
    voicePlayback = true
    voiceRecording = true
    voiceRecognition = true (服务端ASR可用时)
    displayText = false
```

## 4. 能力路由规则

### 4.0 语音监听与声纹识别的边界

控制端能力编辑器中的 `voiceRecording` 同时作为对应显示端的语音监听开关：关闭后显示端停止麦克风和 ASR 结果处理，TTS 播放结束也不会自动恢复。重新开启后显示端进入等待唤醒状态。

`voiceprintConfig.enabled` 是独立的全局算法开关。关闭它不会停止 ASR，也不会阻止唤醒词或对话，只是不再匹配 `speaker`，因此任何能被 ASR 识别的说话人都可以触发对话。

### 4.1 TTS 语音播放路由

```
TTS 播放请求
    ↓
获取目标显示端列表
    ↓
过滤: 只保留 capabilities.voicePlayback === true 的显示端
    ↓
发送 TTS 播放指令到过滤后的显示端
```

### 4.2 语音录音路由

```
语音录音请求
    ↓
获取目标显示端列表
    ↓
过滤: 只保留 capabilities.voiceRecording === true 的显示端
    ↓
发送录音指令到过滤后的显示端
```

### 4.3 媒体渲染路由

```
媒体播放请求
    ↓
获取目标显示端列表
    ↓
过滤: 只保留 capabilities.mediaRendering === true 的显示端
    ↓
发送媒体指令到过滤后的显示端
```

### 4.4 广播场景

广播（broadcastAll）时，只发送给具备对应能力的显示端：

| 广播类型 | 过滤能力 |
|----------|----------|
| TTS 广播 | voicePlayback |
| 提醒弹窗 | displayText |
| 整点报时 | voicePlayback |
| 媒体播放 | mediaRendering |

## 5. 控制端 UI 设计

### 5.1 显示端列表增强

在显示端列表中，每个显示端项增加能力图标：

| 图标 | 能力 | 说明 |
|------|------|------|
| 🔊 | voicePlayback | 语音播放 |
| 🎙️ | voiceRecording | 语音录音 |
| 🧠 | voiceRecognition | 语音识别 |
| 🖥️ | mediaRendering | 媒体渲染 |

灰色图标表示不具备该能力，亮色表示具备。

### 5.2 能力编辑

点击显示端详情可编辑能力标记，支持手动覆盖自动检测结果。

## 6. 兼容性考虑

### 6.1 向后兼容

- 旧版显示端不发送 capabilities 消息时，服务端使用默认能力（全部 true）
- 旧版控制端不显示能力图标，不影响基本功能
- `voiceSupported` / `voiceListening` 字段保留，从 capabilities 派生

### 6.2 能力降级

- 显示端运行时能力变化（如麦克风权限被撤销），发送 capabilities 更新消息
- 服务端收到更新后重新路由后续消息

## 7. 与 AASC 系统集成

### 7.1 能力映射

显示端能力映射到 AASC Actor 能力：

| 显示端能力 | AASC 能力ID |
|-----------|-------------|
| voicePlayback | voice-broadcast |
| voiceRecording | voice-recognition (输入) |
| voiceRecognition | voice-recognition |
| mediaRendering | display-render |
| displayText | display-text |

### 7.2 地图可视化

地图可视化页面（/map）已展示 Actor 能力，显示端能力变化后自动更新地图数据。

## 相关文件

| 文件 | 说明 |
|------|------|
| server.js | 服务端能力存储和路由 |
| public/display.html | 显示端能力检测和声明 |
| public/js/display-list.js | 控制端能力展示和编辑 |
| aasc/actors/tts-actor.js | TTS 能力路由 |
| aasc/actors/display-render-actor.js | 显示端能力路由 |
| voice-display-node/main.js | 子显示端能力声明 |
| voice-display/main.go | 子显示端能力声明(Go) |
