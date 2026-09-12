# ASR 内存上传与 VAD 参数统一设计

## 需求背景

当前 `/api/asr/recognize` 使用 Multer 磁盘存储，服务器先生成 ASR 临时文件，再读取文件进行服务端识别或转发到 ASR 显示端。一次短语音虽然通常只有几十 KB，但每次请求都会产生临时文件、清理日志和一次额外磁盘 I/O。

网页显示端和 `voice-display-node` 都已经使用 16kHz、单声道、16bit PCM 采集，但 VAD 的静音结束时间不一致：网页端约 1000ms，Node 子显示端约 300ms。VAD 阈值虽然默认都是 0.01，但子显示端没有接收服务器保存的 per-display 阈值配置。

## 设计目标

1. ASR HTTP 请求在服务器进程内使用内存 `Buffer`，不再为 `/api/asr/recognize` 创建或清理临时文件。
2. 内嵌 ASR 和独立 ASR 子进程都支持 Buffer 输入；当前 WAV 请求不改变识别结果，非 WAV 输入通过 ffmpeg 标准输入/输出转换，避免生成转换临时文件。
3. 服务端按显示端保存并下发 VAD 阈值，统一默认阈值 `0.01`、阈值范围 `0.001..0.2`；声纹面板全局保存并下发静音结束时间 `500ms` 和最短有效语音长度 `300ms`。
4. 网页显示端、`voice-display-node` 两端使用同一份配置语义：`vadThreshold` 表示 RMS 阈值，`vadSilenceDurationMs` 表示低于阈值持续多久后结束语音段，`vadMinSpeechDurationMs` 表示语音段的最短有效长度。
5. 保留 `vadMinSpeechDurationMs=300` 作为最短有效语音长度，不把“最短语音长度”和“静音结束时间”混为一个字段。
6. 声纹注册、视觉上传和普通媒体上传的临时文件链路不在本次范围内。

## 配置与消息

服务器按显示端保存阈值，并在声纹全局配置中保存两项时长：

```text
vadThreshold: number = 0.01
voiceprint.vadSilenceDurationMs: number = 500
voiceprint.vadMinSpeechDurationMs: number = 300
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

声纹面板提供两个全局输入框：

```text
VAD 静音时长: 100..5000ms，默认 500ms
VAD 最短语音时长: 100..5000ms，默认 300ms
```

控制端保存到 `/api/voiceprint/config` 后，服务端归一化并持久化
`voiceprint.vadSilenceDurationMs`、`voiceprint.vadMinSpeechDurationMs`，通过
`voiceprintConfig` 广播给所有在线网页显示端和 Node 子显示端；新连接同时在初始
`voiceVadConfig` 中收到相同的时长配置。

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

## 子显示端 ASR 单次处理与回显

子显示端录音段只向统一 `/api/asr/recognize` 上传一次。服务器负责选择 ASR 提供端、取得识别结果、执行声纹门控和语音命令流程，并通过响应返回回显所需的数据；子显示端不再把同一结果通过旧的 `voiceInput` WebSocket 消息二次上报。

服务器响应中的 `segments`、`ignoredText` 和普通 `text` 都属于同一次 ASR 请求的结果。Node 子显示端只将这些字段格式化到 TUI 和日志中，不能使用回显文本重新触发命令。

回显规则与网页显示端一致：

- 已匹配说话人显示 `[说话人] 文本`。
- 未匹配声纹显示相似度、阈值和原始文本。
- 有效分段附带的无效文本显示为 `[未识别有效内容] 文本`。
- `status=ignored` 仍显示服务器返回的原始 `text`（如果有），不能在客户端清空。

回显只改变本地显示，不改变提交给服务器的原始识别文本；工作角色名、群聊前缀和其他语音命令内容保持完整。

## 子显示端 ASR 来源绑定

Node 子显示端不能把本地配置中的 `displayId` 当作最终身份。WebSocket 建立后，服务器会发送
`displayId` 消息；Node 必须保存并等待这个服务器确认的 ID，再用它上传 ASR 音频。

ASR 请求同时携带 `X-AASC-Display-Id` 和 `X-AASC-Display-Kind: subdisplay` 请求头，表单中的
`displayId` 继续保留用于兼容和诊断。服务器先将请求 ID 绑定到当前在线的 `displayClients`，
只有绑定成功后才进入声纹门控和语音命令处理链路。

如果请求中的 ID 缺失或已失效，服务器只对明确标记为 `subdisplay` 的请求按来源 IP 回退绑定，
且同一 IP 必须只有一个在线子显示端；不能根据 IP 在多个候选中猜测。无法唯一绑定时仍可完成
ASR 识别和回显，但不触发显示端语音指令，日志中记录未绑定原因。

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

普通 ASR 录音和播放期间的语音检测统一复用这组 VAD 参数；现有 `mute/cut/hard/soft` 播放兼容代码暂不删除，避免影响已部署的 Node 子显示端。新的 ASR 业务始终进入统一服务器入口，Node 客户端只回显响应，不再重复发送旧 `voiceInput`。

## 兼容与风险

- `SherpaOnnxASR.recognize()` 继续接受历史文件路径，并新增 Buffer 输入，兼容声纹服务和其他内部调用。
- 独立 ASR 进程通过 advanced IPC 传递 Buffer；输入很短时减少磁盘 I/O，仍受 HTTP 文件大小和 ASR 队列限制。
- 内存上传会使请求音频在识别完成前驻留堆内存，因此必须设置最大音频大小并在异常路径释放引用。
- VAD 阈值仍按显示端保存，避免不同麦克风的底噪使用一个动态值；静音结束时间先统一为 500ms。

## 实现状态

- 已完成 ASR HTTP 内存上传、内嵌/独立 ASR Buffer 适配和 ffmpeg 管道转换。
- 已完成服务端按显示端保存 VAD 阈值、声纹面板全局保存 VAD 时长、连接下发和控制端修改后的即时同步。
- 已完成网页显示端、Node PvRecorder/naudiodon 两种录音器的动态 VAD 参数应用。
- 已完成 Node 子显示端对 `pauseRecordingDuringPlayback` 的同步，播放期间的录音暂停策略与网页显示端一致。
- 已完成 Node 子显示端携带显示端上下文并取消 ASR 结果的旧 WS 二次上报。
- 已完成 Node 子显示端 ASR 单次上传、服务器处理、客户端只回显的链路；回显支持分段、声纹信息和 ignored 文本，ASR 结果不再二次发送。
- 已完成 Node 子显示端服务器确认 `displayId` 的等待与传递，以及服务器对 ASR 来源的在线显示端绑定；来源未绑定时不再错误地依赖 ASR 后的第二次 `voiceInput`。

## 子显示端底噪检测

服务端和网页显示端已有 `voiceVadNoiseTest` / `voiceVadNoiseResult` 协议。Node 子显示端也必须处理该协议，避免控制端对 Node 显示端发起底噪检测时落入未知消息分支。

- Node 录音器复用已经打开的音频输入，不重复创建录音设备。
- PvRecorder 和 naudiodon 在录音帧经过 RMS 计算时，同时采集底噪检测窗口内的 RMS 样本。
- 检测完成后计算均值、峰值、P95 和建议阈值；录音器未启动、已暂停或重复检测时返回明确错误。
- Node 通过当前 WebSocket 回传 `voiceVadNoiseResult`，服务端继续按原协议转发控制端。
- 当前实现已覆盖 PvRecorder 和 naudiodon 两种录音器，未采集到任何音频帧时返回错误结果。
