# 显示端睡眠模式 — 实现文档

## 概述

显示端（`display.html`）按本地时段自动隐藏媒体（睡眠）或整屏黑幕（深度睡眠），降低夜间干扰。时间判断在显示端本地，每 10 秒检查一次；优先级 临时激活 > 手动覆盖 > 深度睡眠 > 睡眠 > 正常。

## 状态模型

```
sleepSettings   = { enabled, startHour, endHour, deepStartHour, deepEndHour }
sleepState      = 'normal' | 'sleep' | 'deep' | 'active'
activationUntil = 临时激活截止时间戳
manualSleepMode = null | 'sleep' | 'deep'   # 手动覆盖：控制端显式进入睡眠/深度睡眠，直到再下发恢复/切换

function inSleepWindow(hour, start, end):
    若 start > end:  return hour >= start || hour < end    # 跨天（23-8）
    否则:            return hour >= start && hour < end    # 非跨天（1-6）

function clampHour(h):
    h = parseInt(h); 若 isNaN(h) 返回 0
    返回 clamp(h, 0, 23)

function pauseSleepMedia():
    mediaVideo.pause()
    若 mediaHtml 显示中: stopHtmlScroll()

function resumeSleepMedia():
    若 mediaHtml 显示中: startHtmlScroll(mediaHtml, currentHtmlScroll)
    否则若 mediaVideo.src 非空: mediaVideo.play().catch(...)

function isSleepPaused():
    返回 sleepState == 'sleep' || sleepState == 'deep'    # 睡眠/深度睡眠期间暂停语音

function pauseSleepTts():       # 睡眠暂停 TTS：暂停当前语音、清空待播队列、隐藏语音文本
    ttsAudio.pause()            # 保留 currentTime，唤醒后 play() 续播当前 utterance
    ttsQueue = []               # 睡眠期间新 TTS 已丢弃，队列残留一并清空（只续播当前）
    hideTtsText()

function resumeSleepTts():      # 恢复（normal/active）时续播睡眠前被暂停的那条
    若 isPlayingTts 且 ttsAudio.paused:  ttsAudio.play().catch(...)

function applySleepState(state):
    prev = sleepState;  sleepState = state
    isHidden = (state == 'sleep' || state == 'deep')
    #sleepOverlay.display = (state == 'deep') ? 'block' : 'none'
    #mediaContainer.display = isHidden ? 'none' : 'flex'
    若 isHidden:
        pauseSleepMedia()
        pauseSleepTts()             # 睡眠/深度睡眠暂停语音播放
    否则若 prev 为 'sleep'/'deep':
        resumeSleepMedia()          # 仅隐藏态恢复时续播
        resumeSleepTts()            # 续播睡眠前暂停的语音

function checkSleepMode():          # 每 10 秒，setInterval
    target = 'normal'
    若 Date.now() < activationUntil:  target = 'active'      # 临时激活最高优先，且与开关/手动无关
    否则若 manualSleepMode 为 'deep'/'sleep':  target = manualSleepMode   # 手动覆盖，不随时段/开关，直到恢复
    否则若 sleepSettings.enabled:
        hour = now.getHours()
        若 inSleepWindow(hour, deepStartHour, deepEndHour): target = 'deep'
        否则若 inSleepWindow(hour, startHour, endHour):     target = 'sleep'
    若 target != sleepState:  applySleepState(target)     # 状态变化才操作 DOM

function activateTemporarily():     # 控制端按钮 / 控制端下发媒体（showMedia noActivate=false）触发
    activationUntil = now + 60000
    applySleepState('active')       # 覆盖手动与时段；60 秒过期后下次检查回落到手动覆盖或时段判定

function reportSleepState():        # 上报当前睡眠状态给服务端（连接成功 + 每次状态变化）
    displayWs.send({ type: 'sleepStateReport', sleepState })
    # 服务端：存 displayData.state.sleepState（getState/device-settings 可返回）+ broadcastToControls
    # 控制端：收到 sleepStateReport / displayState 更新睡眠卡片按钮文字
```

## 触发链路

```
控制端 SleepPanel 保存
  → sendControl('sleepSettings', settings)
  → 服务端 control 处理器持久化 displayStates[ip].sleep
  → 显示端 handleControl('sleepSettings') → 应用设置 + checkSleepMode()
  → ack 携带 extraData.sleepState → 控制端更新弹窗状态行

控制端「临时激活」/ 下发媒体
  → sendControl('sleepActivate') / 显示端 showMedia(data)（noActivate=false）入口 activateTemporarily()
  → 60 秒激活窗口强制显示，之后 checkSleepMode() 回落（手动覆盖优先于时段）

控制端「立即切换」（睡眠/深度睡眠/恢复正常）
  → sendControl('sleepOverride', 'sleep' | 'deep' | 'normal')
  → 显示端 handleControl('sleepOverride') → manualSleepMode = value 合法化 → checkSleepMode() 立即应用
  → 手动覆盖不随时段/开关自动切换，直到再下发 sleepOverride 才改变；刷新/重启即重置（不持久化）

显示端内部调用（restoreState 恢复持久化媒体、播放列表自动切播）
  → showMedia(data, noActivate=true) → 不触发激活窗口，仅在睡眠时段静默隐藏

显示端刷新/重启
  → 服务端 restoreState(state) → handleRestoreState 读 state.sleep → checkSleepMode() 立即应用
  → 状态变化触发 reportSleepState()

显示端连接成功 / 每次睡眠状态变化
  → displayWs.send({ type: 'sleepStateReport', sleepState })
  → 服务端 displayData.state.sleepState = sleepState（不持久化，连接即上报）
  → broadcastToControls 转发 → 控制端更新睡眠卡片按钮文字（匹配当前选中显示端）
```

## 手动覆盖（sleepOverride）

- `manualSleepMode = null | 'sleep' | 'deep'`，控制端显式进入睡眠/深度睡眠的枚举变量。
- 优先级介于 60 秒临时激活 与 时段判定 之间：激活窗口覆盖手动，激活过期后回落手动；手动覆盖覆盖时段判定。
- 与「启用睡眠」开关无关：`sleepSettings.enabled=false` 时手动覆盖仍生效。
- 不随时间流逝/时段切换自动退出，需再下发 `sleepOverride('normal')` 或切到另一状态才改变；刷新/重启即重置（临时、不持久化）。

## 媒体/语音 暂停与恢复

| 模式 | 睡眠/深度睡眠 | 恢复（normal/active） |
|------|--------------|----------------------|
| 视频 | `mediaVideo.pause()` | `mediaVideo.play().catch(...)` |
| html（iframe 滚动） | `stopHtmlScroll()` | `startHtmlScroll(mediaHtml, currentHtmlScroll)` |
| 图片 | 无需处理 | 无需处理 |
| TTS 语音 | `ttsAudio.pause()`（保留进度）+ 清空队列 + 隐藏文本 | 当前 utterance `play()` 续播（睡眠中新 TTS 已丢弃，不重放） |

## 睡眠期间新 TTS 丢弃

- `queueTts(item)` 入口：若 `isSleepPaused()` 返回 true，直接 return（不入队、不播放）——睡眠期间新到的 TTS（整点报时、语音响应、提醒等）全部丢弃，避免夜间积压整晚内容。
- `playTTS(text)`（媒体名播报）同样在睡眠期间丢弃。
- `playNextTts()` 入口守卫：防止 `ended`/`error` 回调在睡眠态被误触发继续播放。

## 遮罩层

`#sleepOverlay`（`position:fixed;inset:0;background:#000;z-index:999999`）：深度睡眠时 `display:block` 全屏黑幕，z-index 高于 `#monitorOverlay`（render-display 监控层）等全部覆盖层；睡眠/正常/激活时 `display:none`。

## 消息协议

| 消息 | 值 | 处理 |
|------|----|------|
| `control` / `sleepSettings` | `{enabled,startHour,endHour,deepStartHour,deepEndHour}` | 应用设置 + checkSleepMode + ack(`extraData.sleepState`) |
| `control` / `sleepActivate` | 无 | `activateTemporarily()` + ack(`extraData.sleepState`) |
| `control` / `sleepOverride` | `'sleep'` \| `'deep'` \| `'normal'` | `manualSleepMode` 赋值（`normal`→null）+ checkSleepMode + ack(`extraData.sleepState`) |
| `sleepStateReport`（显示端上行） | `sleepState` | 服务端存 `displayData.state.sleepState` + broadcastToControls → 控制端更新按钮（需在 server-app 的 `displayTypes` 注册表注册，否则走 viewbind 同步不落 `displayClients.state`） |
| `restoreState` | `state.sleep` | 恢复设置 + checkSleepMode |
| `GET /api/device-settings/:displayId` | — | 返回 `settings.sleep`（控制端填充弹窗） |
