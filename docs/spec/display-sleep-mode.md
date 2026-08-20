# 显示端睡眠模式 — 实现文档

## 概述

显示端（`display.html`）按本地时段使用媒体区域遮罩（睡眠）或全屏 UI 遮罩（深度睡眠），降低夜间干扰。遮罩不隐藏媒体容器，保证 `clientWidth/clientHeight` 和画面填充模式稳定。时间判断在显示端本地，每 10 秒检查一次；优先级 立即手动覆盖 > 临时激活 > 深度睡眠 > 睡眠 > 正常。

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
    #mediaSleepOverlay.display = (state == 'sleep') ? 'block' : 'none'
    #uiSleepOverlay.display = (state == 'deep') ? 'block' : 'none'
    #mediaContainer.display 保持原值，不因睡眠状态改变
    若 state 为 'sleep'/'deep':
        pauseSleepMedia()
        pauseSleepTts()             # 睡眠/深度睡眠暂停语音播放
    否则若 prev 为 'sleep'/'deep':
        resumeSleepMedia()          # 仅隐藏态恢复时续播
        resumeSleepTts()            # 续播睡眠前暂停的语音

function checkSleepMode():          # 每 10 秒，setInterval
    target = 'normal'
    若 manualSleepMode 为 'deep'/'sleep':  target = manualSleepMode   # 立即切换优先，直到恢复或再次切换
    否则若 Date.now() < activationUntil:  target = 'active'      # 临时激活高于时段判定，与开关无关
    否则若 sleepSettings.enabled:
        hour = now.getHours()
        若 inSleepWindow(hour, deepStartHour, deepEndHour): target = 'deep'
        否则若 inSleepWindow(hour, startHour, endHour):     target = 'sleep'
    若 target != sleepState:  applySleepState(target)     # 状态变化才操作 DOM

function activateTemporarily():     # 控制端按钮 / 控制端下发媒体（showMedia noActivate=false）触发
    activationUntil = now + 60000
    applySleepState('active')       # 覆盖时段判定；60 秒过期后下次检查按手动覆盖或时段判定

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
  → 取消手动覆盖（manualSleepMode=null）+ 60 秒激活窗口强制显示
  → 激活窗口过期后 checkSleepMode() 按时段判定（不再回落手动覆盖）

控制端「立即切换」（睡眠/深度睡眠/恢复正常）
  → sendControl('sleepOverride', 'sleep' | 'deep' | 'normal')
  → 显示端 handleControl('sleepOverride') → activationUntil = 0 + manualSleepMode = value 合法化 → checkSleepMode() 立即应用
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
- 优先级高于 60 秒临时激活窗口（`checkSleepMode()` 先判 `manualSleepMode` 再判 `activationUntil`）。
- 立即切换指令会清除已有临时激活窗口：处理 `sleepOverride` 时将 `activationUntil` 置零，保证立即睡眠、立即深度睡眠、恢复正常都立即生效。
- 临时激活/下发媒体会**取消手动覆盖**：`activateTemporarily()` 把 `manualSleepMode` 置 null——下发媒体即退出覆盖、显示媒体，之后按正常时段判定。
- 与「启用睡眠」开关无关：`sleepSettings.enabled=false` 时手动覆盖仍生效。
- 不随时间流逝/时段切换自动退出，需再下发 `sleepOverride('normal')` 或切到另一状态才改变；刷新/重启即重置（临时、不持久化）。

## 媒体/语音 暂停与恢复

| 模式 | 睡眠/深度睡眠 | 恢复（normal/active） |
|------|--------------|----------------------|
| 视频 | `mediaVideo.pause()` | 检查控制端播放/暂停状态后决定：单媒体 `mediaIsPlaying` 或播放列表 `ps.paused` 为暂停 → 保持暂停；否则 `mediaVideo.play().catch(...)` |
| html（iframe 滚动） | `stopHtmlScroll()` | 同上：暂停状态 → 保持停滚；否则 `startHtmlScroll(mediaHtml, currentHtmlScroll)` |
| 图片 | 无需处理 | 无需处理 |
| TTS 语音 | `ttsAudio.pause()`（保留进度）+ 清空队列 + 隐藏文本 | 当前 utterance `play()` 续播（睡眠中新 TTS 已丢弃，不重放） |

### 恢复时检查控制端播放/暂停状态

`resumeSleepMedia()` 恢复媒体前先判断当前媒体该不该播放：

- `mediaIsPlaying`：显示端本地跟踪的控制端播放/暂停设置（`showMedia` 末尾与 `handleControl('play')` 同步更新；restoreState 恢复 `isPlaying` 时由 showMedia 一并写入）
- `shouldPlayMedia()`：播放列表激活时读 `playlistState.paused`（睡眠前控制端暂停播放列表则保持暂停），否则读单媒体 `mediaIsPlaying`

```
shouldPlayMedia():
    若 playlistState 激活: 返回 !playlistState.paused
    返回 mediaIsPlaying !== false

resumeSleepMedia():
    若 !shouldPlayMedia(): return      # 控制端暂停的媒体 → 睡眠恢复保持暂停
    html 显示: startHtmlScroll(...)
    else 若 currentMediaType == audio 且 mediaAudio.src: playAudioAuto(mediaAudio)
    else 若 mediaVideo.src: mediaVideo.play().catch(...)
```

## 睡眠期间新 TTS 丢弃

- `queueTts(item)` 入口：若 `isSleepPaused()` 返回 true，直接 return（不入队、不播放）——睡眠期间新到的 TTS（整点报时、语音响应、提醒等）全部丢弃，避免夜间积压整晚内容。
- `playTTS(text)`（媒体名播报）同样在睡眠期间丢弃。
- `playNextTts()` 入口守卫：防止 `ended`/`error` 回调在睡眠态被误触发继续播放。

## 睡眠期间视频播放路径守卫

进入睡眠只 `pause()` 一次不够——睡眠中还有多处路径会把视频重新播起来（此前缺陷：单视频被点击恢复、批量播放自动切播）。所有视频播放/恢复入口统一加 `isSleepPaused()` 守卫：

- `document click` 监听：睡眠中点击页面不 `mediaVideo.play()`（此前 `display:block && paused` 时任何点击都恢复视频，无人值守盒子睡眠中点击遮罩/UI 即恢复）
- `keydown` 空格（播放/暂停切换）：睡眠中忽略
- `handleControl('play', value=true)`：睡眠中拒绝播放命令（`value=false` 暂停仍生效并上报）
- `playCurrentItem()`（播放列表切播）：睡眠中不切播下一项（`ended`/`error`/`timer` 触达时直接跳过），唤醒后恢复当前项
- `playlistNext()`（自动 timer/ended 入口）：睡眠中提前返回，确保索引不推进、不排队；控制端手动 next 先临时激活后再调用
- 媒体 `play` 事件：睡眠已生效后若 WebView/原生层延迟触发播放，立即调用 `pauseSleepMedia()`，拦截延迟续播并清理恢复计时器
- 媒体 watchdog：每秒检查当前 video/audio；睡眠/深度睡眠中发现媒体正在播放时再次暂停，作为 Android/WebView 延迟播放的兜底

## 双遮罩层

`#mediaSleepOverlay` 位于 `#mediaContainer` 内，只在普通睡眠时显示，遮住媒体并保留 UI；`#uiSleepOverlay` 为 `position:fixed;inset:0;background:#000;z-index:999999` 的全屏遮罩，只在深度睡眠时显示，覆盖 UI 和媒体。睡眠状态切换不得修改 `#mediaContainer.style.display`，避免媒体容器尺寸变为 0、触发 `applyCrop()` 清除填充样式。

## 消息协议

| 消息 | 值 | 处理 |
|------|----|------|
| `control` / `sleepSettings` | `{enabled,startHour,endHour,deepStartHour,deepEndHour}` | 应用设置 + checkSleepMode + ack(`extraData.sleepState`) |
| `control` / `sleepActivate` | 无 | `activateTemporarily()` + ack(`extraData.sleepState`) |
| `control` / `sleepOverride` | `'sleep'` \| `'deep'` \| `'normal'` | `manualSleepMode` 赋值（`normal`→null）+ checkSleepMode + ack(`extraData.sleepState`) |
| `sleepStateReport`（显示端上行） | `sleepState` | 服务端存 `displayData.state.sleepState` + broadcastToControls → 控制端更新按钮（需在 server-app 的 `displayTypes` 注册表注册，否则走 viewbind 同步不落 `displayClients.state`） |
| `restoreState` | `state.sleep` | 恢复设置 + checkSleepMode |
| `GET /api/device-settings/:displayId` | — | 返回 `settings.sleep`（控制端填充弹窗） |

## 批量播放手动 next

```text
收到 playlistControl(action='next'):
    activateTemporarily()       // 用户主动操作，退出 sleep/deep，进入 60 秒 active
    playlistNext()               // 立即执行下一项

自动 timer/ended 调用 playlistNext:
    保持 playCurrentItem 的 isSleepPaused 守卫
    睡眠期间不推进 index、不排队
```
