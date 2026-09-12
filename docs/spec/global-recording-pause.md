# 控制端一键暂停所有录音实现伪代码

## 目标文件

- `src/apps/server/boot/server-app.js` // 保存运行时状态并门控所有 ASR/临时录音入口
- `src/apps/web-mediacenter/ui/public/upload.html` // 提供右下角浮动按钮节点
- `src/apps/web-mediacenter/ui/public/js/floating-control.js` // 更新圆形图标并发送控制消息
- `src/apps/web-mediacenter/ui/public/js/websocket.js` // 接收权威状态
- `src/apps/web-mediacenter/ui/public/display.html` // 浏览器录音暂停、临时录音终止和普通监听恢复
- `src/apps/voice-display-node/main.js` // Windows/Android Node 录音暂停和恢复

## 范围约束

- 全局状态只存在服务端内存，不写入 `config`，默认 `paused = false`。
- 不调用能力更新接口，不改 `voiceRecordingMode`、声纹配置和播放期间暂停配置。
- “暂停”优先级高于普通监听、播放暂停恢复和能力确认后的自动启动。

## 已有声明

- 服务端已有 `displayClients`、`displayRecordingSessions`、`pendingDisplayAsrRequests`、`processDisplayVoiceInput()` 和 `sendToDisplay()`。
- 控制端已有 `/control` WebSocket、`WebSocketManager` 和 `FloatingControl`。
- 浏览器显示端已有 `startVoiceRecording()`、`stopVoiceRecording()`、`handleDisplayRecordingRequest()`。
- Node 显示端已有 `recordingEnabled`、`recorder.pause()/resume()`、`startVoiceRecognition()`。

## 消息契约

```text
控制端 -> 服务端:
    { type: 'setGlobalRecordingPause', paused: boolean }

服务端 -> 控制端和显示端:
    { type: 'globalRecordingPauseState', paused: boolean }

服务端暂停:
    对每个 display 发送 globalRecordingPauseState(paused=true)
    对每个 displayRecordingSession 发送 stop(discard=true)
    删除服务端临时录音会话
```

## 服务端流程

```text
globalRecordingPaused = false

连接控制端:
    发送 globalRecordingPauseState(globalRecordingPaused)

连接显示端:
    发送 globalRecordingPauseState(globalRecordingPaused)

setGlobalRecordingPause(data):
    如果 data.paused 不是布尔值:
        回传错误
        返回
    globalRecordingPaused = data.paused
    如果 globalRecordingPaused:
        对所有临时录音会话 fail(discard=true, reason='全局录音已暂停')
    广播 globalRecordingPauseState

收到新的 ASR/音频流/临时录音请求:
    如果 globalRecordingPaused:
        丢弃或返回“全局录音已暂停”

异步 ASR 完成后:
    如果 globalRecordingPaused:
        不调用本地文本输入、声纹、语音命令和控制端广播
        返回 ignored
    否则继续原有流程
```

## 浏览器显示端流程

```text
globalRecordingPaused = false

收到 globalRecordingPauseState:
    globalRecordingPaused = data.paused === true
    如果暂停:
        pendingAutoStart = false
        如果临时录音会话存在:
            finalizeDisplayRecording(false, '全局录音已暂停')
        如果普通 ASR 正在监听:
            停止 VAD 和普通采集，不提交未完成音频
    如果恢复:
        只在录音模式为 asr、能力允许、页面处于持续监听且没有 TTS 暂停时启动普通监听

startVoiceRecording():
    如果 globalRecordingPaused:
        返回
```

## Windows/Android Node 流程

```text
收到 globalRecordingPauseState:
    globalRecordingPaused = data.paused === true
    如果暂停且 recorder 正在普通监听:
        recorder.pause()
    如果恢复且 recordingEnabled 且没有 TTS 播放暂停:
        recorder.resume()

onAudioData():
    如果 globalRecordingPaused:
        返回，不创建新的 ASR 请求
    await asr.recognize()
    如果 globalRecordingPaused:
        丢弃结果
    否则继续原有文本输入和语音命令流程
```

## 控制端浮动按钮流程

```text
初始化:
    paused = false
    renderGlobalRecordingPauseButton()

收到 globalRecordingPauseState:
    paused = data.paused === true
    如果 paused:
        图标 = 红色麦克风 + 斜杠
        title、aria-label = '恢复所有录音'
    否则:
        图标 = 麦克风
        title、aria-label = '暂停所有录音'

点击按钮:
    如果 WebSocket 未连接:
        提示控制端尚未连接服务端
        返回
    nextPaused = !paused
    paused = nextPaused
    立即渲染图标、颜色、title、aria-label
    WebSocket.send({
        type: 'setGlobalRecordingPause',
        paused: nextPaused
    })
    如果发送失败:
        paused = !nextPaused
        恢复渲染
```

## 验证

```text
服务端重启 -> 初始 paused=false
控制端连接 -> 收到当前 paused
显示端重连 -> 收到当前 paused
暂停 -> 三类显示端停止普通监听
暂停 -> 新 ASR、临时录音和在途 ASR 结果均不进入命令链路
暂停 -> 临时录音被丢弃且不自动恢复
恢复 -> 仅普通 ASR 监听恢复
按钮 -> 位于自测按钮正上方并与齿轮按钮右侧竖直排列
按钮 -> 正常状态显示麦克风，暂停状态显示红色麦克风和斜杠
按钮 -> 点击后立即切换图标，服务端权威状态到达后保持一致
```
