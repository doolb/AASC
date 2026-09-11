# ASR 内存上传与 VAD 参数统一设计

## 需求背景

当前 `/api/asr/recognize` 使用 Multer 磁盘存储，服务器先生成 ASR 临时文件，再读取文件进行服务端识别或转发到 ASR 显示端。一次短语音虽然通常只有几十 KB，但每次请求都会产生临时文件、清理日志和一次额外磁盘 I/O。

网页显示端和 `voice-display-node` 都已经使用 16kHz、单声道、16bit PCM 采集，但 VAD 的静音结束时间不一致：网页端约 1000ms，Node 子显示端约 300ms。VAD 阈值虽然默认都是 0.01，但子显示端没有接收服务器保存的 per-display 阈值配置。

## 设计目标

1. ASR HTTP 请求在服务器进程内使用内存 `Buffer`，不再为 `/api/asr/recognize` 创建或清理临时文件。
2. 内嵌 ASR 和独立 ASR 子进程都支持 Buffer 输入；当前 WAV 请求不改变识别结果，非 WAV 输入通过 ffmpeg 标准输入/输出转换，避免生成转换临时文件。
3. 服务端按显示端保存并下发 VAD 配置，统一默认阈值 `0.01`、阈值范围 `0.001..0.2` 和静音结束时间 `500ms`。
4. 网页显示端、`voice-display-node` 两端使用同一份配置语义：`vadThreshold` 表示 RMS 阈值，`vadSilenceDurationMs` 表示低于阈值持续多久后结束语音段。
5. 保留 `vadMinSpeechDurationMs=300` 作为最短有效语音长度，不把“最短语音长度”和“静音结束时间”混为一个字段。
6. 声纹注册、视觉上传和普通媒体上传的临时文件链路不在本次范围内。

## 配置与消息

服务器保存每个显示端的：

```text
vadThreshold: number = 0.01
vadSilenceDurationMs: number = 500
vadMinSpeechDurationMs: number = 300
```

显示端连接和控制端修改阈值后，服务器发送：

```text
{
  type: "voiceVadConfig",
  threshold: 0.01,
  silenceDurationMs: 500,
  minSpeechDurationMs: 300
}
```

旧客户端忽略新增字段时，服务器和网页端继续使用既有默认值。

## ASR 数据流

```text
multipart audio
       │
       ▼
内存 Buffer（限制最大请求大小）
       │
       ├── asr.device=server  → SherpaOnnxASR.recognize(Buffer)
       │                              └→ WAV 解析或 ffmpeg pipe 转换
       │
       └── asr.device=display → Buffer.toString(base64) → WebSocket ASR 显示端
```

HTTP 上传解析失败、超过大小或没有音频时返回 JSON 错误，不留下文件。

## 新的语音段流程

```text
启动录音:
  创建 16kHz mono s16le PCM 采集链路
  使用服务端下发的 vadThreshold 和 vadSilenceDurationMs

检测到 RMS >= vadThreshold:
  开始或继续当前语音段

检测到 RMS < vadThreshold 且持续 vadSilenceDurationMs:
  如果语音长度 >= vadMinSpeechDurationMs:
    封装当前 PCM 为 WAV
    提交统一 ASR 接口，并携带 displayId、speechStartAt、speechEndAt
  清空当前段并继续复用采集链路
```

普通 ASR 录音和播放期间的语音检测统一复用这组 VAD 参数；现有 `mute/cut/hard/soft` 播放兼容代码暂不删除，避免影响已部署的 Node 子显示端。新的 ASR 业务始终进入统一服务器入口，Node 客户端收到 `processedByServer` 后不再重复发送旧 `voiceInput`。

## 兼容与风险

- `SherpaOnnxASR.recognize()` 继续接受历史文件路径，并新增 Buffer 输入，兼容声纹服务和其他内部调用。
- 独立 ASR 进程通过 advanced IPC 传递 Buffer；输入很短时减少磁盘 I/O，仍受 HTTP 文件大小和 ASR 队列限制。
- 内存上传会使请求音频在识别完成前驻留堆内存，因此必须设置最大音频大小并在异常路径释放引用。
- VAD 阈值仍按显示端保存，避免不同麦克风的底噪使用一个动态值；静音结束时间先统一为 500ms。

## 实现状态

- 已完成 ASR HTTP 内存上传、内嵌/独立 ASR Buffer 适配和 ffmpeg 管道转换。
- 已完成服务端 VAD 配置持久化、连接下发和控制端修改后的即时同步。
- 已完成网页显示端、Node PvRecorder/naudiodon 两种录音器的动态 VAD 参数应用。
- 已完成 Node 子显示端对 `pauseRecordingDuringPlayback` 的同步，播放期间的录音暂停策略与网页显示端一致。
- 已完成 Node 子显示端携带显示端上下文并使用 `processedByServer` 避免旧 WS 重复上报。
