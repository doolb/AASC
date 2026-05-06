# 子显示端录音模式设计文档

## 概述

为 voice-display-node（子显示端）增加可配置的录音模式，解决播放 TTS 时麦克风拾取扬声器声音造成的回声问题。提供 4 种不同的处理策略，适应不同平台和场景。

## 四种录音模式

| # | 模式ID | 名称 | 说明 | 依赖 |
|---|--------|------|------|------|
| 1 | `mute` | 播放暂停录音 | 播放 TTS 时暂停录音，播放完恢复。当前默认行为 | 无 |
| 2 | `cut` | 语音打断 | 播放时继续录音，检测到人声即停止 TTS 播放，切回录音模式 | 无 |
| 3 | `hard` | 系统 AEC | 使用操作系统提供的回声消除接口 | Windows WASAPI / Linux PulseAudio |
| 4 | `soft` | 软件 AEC | 纯 JS NLMS 自适应滤波器 AEC，跨平台，零原生依赖 | 无 |

## 配置

### config.json

```json
{
    "serverUrl": "http://localhost:3000",
    "displayId": "voice-display-node-1",
    "vadThreshold": 0.01,

    "recordingMode": "mute"
}
```

可选值：`"mute"` | `"cut"` | `"hard"` | `"soft"`

### 能力声明

录音模式不影响能力声明（voiceRecording 始终为 true），仅在本地决定录音行为。

## 各模式详细设计

### 模式1: mute（默认）

保持当前行为不变，`setupPlaybackPause()` 逻辑：

```
AudioPlayer.onPlayStart → AudioRecorder.pause()
AudioPlayer.onPlayEnd   → AudioRecorder.resume()  (仅当 recordingEnabled)
```

### 模式2: cut（语音打断）

播放时**不暂停录音**，录音器输出两路分流：

```
麦克风 PCM → VAD 检测
                ├── 有语音 → 触发 AudioPlayer.stop() + clearQueue()
                │               → 已累积的语音段送 ASR 识别
                └── 无语音 → 丢弃
```

关键点：
- 播放开始时语音终止标记重置（防止旧语音触发打断）
- VAD 检测到人声后立即调用 `audio.stop()`，清空播放队列
- 打断触发后，当前累积的语音段（从开始录音到打断点）编码为 WAV 送 ASR
- 不需要 AEC，因为打断策略是"检测到人声就停播"，不要求"边播边听清"

风险：
- 播放音量较大时 VAD 可能将 TTS 输出误判为人声（麦克风拾取扬声器声音）
- 需要设置合理的 VAD 阈值或加高通滤波区分 TTS 和人声

### 模式3: hard（系统 AEC）

使用操作系统层面的 AEC 接口，录音设备直接输出已消除回声的音频。

#### Windows: WASAPI AEC

Windows Vista+ 的 WASAPI 提供了 `AUDCLNT_STREAMFLAGS_ECHO_CANCELLATION` 标志。调用方式：

- 通过 WASAPI 枚举支持 AEC 的录音终端
- 开启 AEC 标志后，录音数据自动包含回声消除处理
- 需要系统扬声器和麦克风驱动支持（通常 Realtek / Intel HD Audio 都支持）

实现方案：
- 新增 `audio-recorder-wasapi-aec.js`，通过 Edge.js / node-win32-api 调用 Windows COM 接口
- 或使用 child_process 调用 PowerShell `New-Object -ComObject` 操作 AudioDevice
- 回退：若系统 AEC 不可用，降级到 mute

#### Linux: PulseAudio echo-cancel source

PulseAudio 内置 echo-cancel 模块：

```
pactl load-module module-echo-cancel
→ 生成新的 echo-cancel 录音源
→ naudiodon 直接指定该源为录音设备
```

实现方案：
- PulseAudio echo-cancel source 检测
- naudiodon 通过 `deviceId` 指定 echo-cancel 源

#### macOS

macOS 没有系统级 AEC 接口暴露给用户态程序。模式 3 在 macOS 上降级为 mute。

### 模式4: soft（软件 AEC）

使用 NLMS（归一化最小均方）自适应滤波器算法在应用层做回声消除，跨平台，不需要系统配置，零原生依赖。

#### 架构

```
AudioPlayer 播放 PCM ──────────┐
                               ├──→ AECProcessor(NLMS) ──→ 干净 PCM → WAV编码 → ASR
AudioRecorder 麦克风 PCM ──────┘
```

#### 算法说明

NLMS 自适应滤波器：
- 滤波器长度：1024 阶（约 64ms 回声尾长，覆盖大多数室内反射）
- 步长因子 μ：0.1（收敛速度与稳态误差的平衡）
- 参考信号：AudioPlayer 播放的 PCM 数据
- 麦克风信号：AudioRecorder 采集的 int16 音频
- 误差信号 = 麦克风信号 - 滤波器估计的回声 → 输出为干净语音
- 每帧更新滤波器系数（帧大小 160 采样点 = 10ms）

#### AECProcessor 模块

```
class AECProcessor:
    W: Float64Array[1024]         // 自适应滤波器系数
    playBuf: Float64Array[1184]    // 远端参考信号环形缓冲区
    pendingPlayFrames: Queue       // 播放帧队列（用于帧对齐）
    frameSize: number (160)        // 10ms @ 16kHz
    sampleRate: number (16000)
    mu: number (0.1)              // 自适应步长
    filterLength: number (1024)   // 滤波器阶数

    setPlaybackReference(samples, sampleRate):
        // 由 AudioPlayer 播放时调用，提供参考信号
        将 samples 分帧加入 pendingPlayFrames 队列

    process(micFrame):
        // 处理一帧麦克风数据
        从 pendingPlayFrames 取一帧参考信号
        NLMS 自适应滤波 → 输出干净语音帧
        返回 Int16Array

    processSamples(micSamples):
        // 处理整个麦克风采样序列（分帧调用 process）
    
    reset():
        清空滤波器系数和缓冲区（播放开始时调用）
```

#### 数据流

1. `AudioPlayer.playFromURL()` 下载 WAV 后，通过 `extractPCMFromWav()` 提取 PCM
2. 调用 `AECProcessor.setPlaybackReference(samples, sampleRate)` 传入参考信号
3. `AudioRecorder` 采集麦克风数据，回调中包含 WAV 编码的音频
4. `VoiceDisplay.startVoiceRecognition()` 将 WAV 解码为 PCM → 调用 `AECProcessor.processSamples()` → 重新编码为 WAV → 送 ASR
5. 帧对齐自动处理（AECProcessor 内部维护 pendingPlayFrames 队列）

#### 帧对齐

| 参数 | 值 |
|------|-----|
| 采样率 | 16000 Hz |
| 帧大小 | 160 采样点（10ms） |
| 播放 PCM 来源 | AudioPlayer 解码 WAV 后的 PCM Buffer |
| 录音 PCM 来源 | AudioRecorder 原始 int16 数据 |

## 受影响代码

| 文件 | 改动 |
|------|------|
| `config.json` | 添加 `recordingMode` 字段 |
| `main.js` | 根据 `config.recordingMode` 选择初始化路径 |
| `audio-recorder.js` | `pause()` → 对不同模式有不同的暂停行为 |
| `audio-recorder-pv.js` | 与 audio-recorder.js 同步修改 |
| `audio-player.js` | 模式2：暴露 `onBargeIn` 回调；模式4：暴露播放 PCM 回调 |
| `aec-processor.js` (新) | 模式4：纯 JS NLMS AEC 处理器，零原生依赖 |
| `package.json` | 无需改动（AECProcessor 纯 JS 实现，无额外依赖） |

## 降级策略

| 配置模式 | Windows | Linux | macOS |
|----------|---------|-------|-------|
| mute | ✅ | ✅ | ✅ |
| cut | ✅ | ✅ | ✅ |
| hard | ✅ WASAPI | ✅ PulseAudio | ❌ → mute |
| soft | ✅ | ✅ | ✅ |

所有模式在初始化失败时自动降级到 `mute`，保证录音功能不中断。

## 相关文档

| 文档 | 说明 |
|------|------|
| docs/spec/voice-display.md | 实现文档（需更新） |
| docs/task/2026-05-06_录音模式选项.md | 任务文档 |
