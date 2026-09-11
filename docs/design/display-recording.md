# 显示端录音模式与控制端回放设计

## 需求

控制端显示面板为每个在线显示端提供三种录音模式：

- `asr`：沿用当前持续监听、VAD 分段和普通 ASR 识别流程。
- `single`：单次录音，复用公共 PCM/WAV/VAD 采集逻辑，最长 60 秒，不调用 ASR，录音完成后只回传控制端播放。
- `realtime`：复用公共 PCM 采集逻辑，边录边通过 WebSocket 分片回传，控制端近实时播放，不调用 ASR。

## 交互规则

- 控制端在当前选中显示端的 VAD 卡片中选择模式；默认模式为 `asr`，树形显示端节点只保留监听开关。
- `single` 和 `realtime` 模式提供开始/停止按钮；`asr` 模式继续由监听开关控制自动监听。
- 单次录音检测到语音后，连续静音约 1 秒自动完成；没有语音时由手动停止或 60 秒超时结束。
- 实时录音由控制端手动停止，最长同样限制为 60 秒；结束时发送结束事件，控制端播放队列自然排空后停止。
- 录音请求只允许回到发起请求的控制端，不广播给其他控制端，不写入媒体库。
- 显示端正在持续 ASR 监听时切换到另外两种模式，先丢弃未完成的 ASR 片段并释放/复用当前采集链路，避免同一麦克风建立两条采集图。

## 非目标

- 不改变 ASR 文字识别、声纹识别、语音命令和 TTS 逻辑。
- 不把单次/实时录音送到 `/api/asr/recognize`、`audioChunk` 或 `voiceInput` 链路。
- 不在显示端播放录音结果；结果只在控制端播放。

## 协议

- 控制端→服务端：`setVoiceRecordingMode`、`requestDisplayRecording`、`stopDisplayRecording`。
- 服务端→显示端：`voiceRecordingConfig`、`displayRecordingRequest`。
- 显示端→服务端：`displayRecordingStatus`、`displayRecordingChunk`、`displayRecordingResult`。
- 服务端→发起控制端：同名状态/分片/结果消息，并携带 `displayId`、`requestId`。
- 单次录音结果为 16kHz 单声道 WAV base64；实时分片为 16kHz 单声道 PCM16 base64，控制端使用 Web Audio 定时排队播放。

## 状态和安全边界

- 服务端按 `requestId` 保存目标显示端、发起控制端、模式、序号和 60 秒超时。
- 同一显示端同一时间只允许一个单次或实时回传请求。
- 服务端校验显示端在线、具备 `voiceRecording` 能力、模式匹配和请求归属；控制端断开或显示端断开时主动清理并通知另一端。
- 分片序号必须递增，非法或超大音频消息丢弃并结束请求，避免控制端收到其他会话音频。

## 已完成实现

- 服务端在 `server-app.js` 中维护按 `requestId` 绑定控制端 socket 的临时会话，并在显示端/控制端断开、超时和异常时清理。
- 显示端在 `display.html` 中以 `activeRecordingPurpose` 保证同一时间只有 ASR、单次或实时一种采集用途；普通 ASR 未完成片段切换模式时直接丢弃。
- 控制端在 `device-list.js` 的 VAD 卡片中提供模式选择、录音操作和单次/实时播放；树形和列表视图中的显示端节点不重复放置录音入口。
