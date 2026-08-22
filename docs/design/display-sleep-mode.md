# 显示端睡眠模式 设计文档

## 概述

为显示端（`display.html`）增加**睡眠模式**与**深度睡眠模式**，按时间段使用媒体区域遮罩或全屏 UI 遮罩降低夜间干扰。遮罩不修改媒体容器的布局显示属性，避免画面填充计算因容器尺寸变为 0 而丢失。支持：

1. **睡眠模式（默认 23:00-8:00，跨天）**：显示媒体区域黑色遮罩，视频暂停，保留 UI 覆盖层（时钟/文件名/语音状态等）；TTS 默认不受影响。
2. **深度睡眠模式（默认 1:00-6:00）**：只显示全屏 UI 黑幕遮罩覆盖整个页面，媒体节点保持布局；TTS 默认不受影响。
3. **临时激活（60 秒）**：手动按钮或控制端下发媒体自动触发，期间强制显示媒体+UI，60 秒后回落（手动覆盖优先于时段判定）。
4. **手动覆盖**：控制端「立即切换」显式进入睡眠/深度睡眠/恢复正常，不随时段/开关自动切换，直到再下发才改变（刷新即重置，临时）。
5. **控制端配置**：显示控制面板新增「睡眠模式」入口 → 弹窗设置框（启用开关 + 可配时段 + 临时激活按钮 + 立即切换按钮 + 当前状态），按当前选中显示端生效并持久化到服务端。

## 需求背景

### 现状问题

显示端 24 小时持续显示媒体画面与 UI，夜间无操作时仍点亮屏幕、播放视频（含音频），干扰休息并浪费资源。

### 目标

- 夜间按时段遮住媒体（睡眠）或整屏熄灭（深度睡眠），视频暂停避免持续播放。
- 用户需要看画面时可手动临时激活 60 秒；控制端下发媒体时自动临时激活，保证操作即时可见。
- 时段/开关可在控制端按显示端独立配置并持久化，刷新/重启后沿用。

### 约束

- 时间判断在**显示端本地**（各设备用自己的本地时区），每 10 秒检查一次。
- 设置按**当前选中显示端**生效，持久化到服务端 `displayStates[ip].sleep`（沿用现有 rotation/fit/volume 状态流）。
- 优先级：**临时激活 > 手动覆盖 > 深度睡眠 > 睡眠 > 正常**。
- 睡眠使用媒体区域遮罩，深度睡眠使用全屏 UI 遮罩；两种遮罩均不通过 `display:none` 隐藏媒体容器，保证新增 UI 元素和媒体填充计算稳定。
- 视频睡眠时**暂停（画面+音频）**，恢复后继续播放。
- TTS 是否检查显示端睡眠由服务端下发接口按消息调用方显式指定；默认不检查，只有整点报时调用 `checkSleep=true`。
- 不产生一大段 if-else-else if 链（AASC 规则）。

## 核心架构

```
控制端 upload.html（显示控制面板）
  ├─ 「睡眠模式」入口按钮 → 弹窗设置框
  │     ├─ 启用开关 / 睡眠时段 / 深度睡眠时段
  │     ├─ 「临时激活」按钮
  │     └─ 「立即切换」按钮（睡眠/深度睡眠/恢复正常）
  │           │
  │           └─ sendControl('sleepSettings'/'sleepActivate'/'sleepOverride', ...)
  │                 │
  │                 ▼
  └─ 服务端（转发 control → 指定显示端）
                       │
                       ▼
显示端 display.html
  ├─ handleControl('sleepSettings') → 应用设置 + 回传状态 → 服务端 updateDisplayState 持久化
  ├─ handleControl('sleepActivate') → activateTemporarily()
  ├─ handleControl('sleepOverride') → manualSleepMode 枚举赋值 → checkSleepMode() 立即应用
  ├─ showMedia()（控制端下发媒体）→ activateTemporarily()；显示端内部调用（restore 恢复/播放列表切播）不激活
  ├─ setInterval(checkSleepMode, 10000)  → 本地时钟判断 → 应用/解除隐藏
  ├─ #mediaSleepOverlay 媒体区域遮罩（只覆盖 #mediaContainer 内媒体）
  └─ #uiSleepOverlay 全屏 UI 遮罩（z-index 999999，深度睡眠时覆盖全部页面）
```

服务器 TTS 下发接口：

```text
sendToDisplay(displayId, message, { checkSleep })
  ├─ checkSleep=true 且目标 displayData.state.sleepState 为 sleep/deep → 跳过下发
  └─ checkSleep=false/缺省 → 正常下发
```

## 状态模型与判定

### 优先级

```
正常(显示) < 睡眠(媒体遮罩, 保留 UI) < 深度睡眠(UI 全屏遮罩) < 手动覆盖(显式进入睡眠/深度) < 临时激活(强制显示)
```

### 时段判定（跨天）

```
时段表示：startHour ~ endHour（小时，0-23）
跨天：startHour > endHour 时，落在时段内 ⇔ (h >= startHour || h < endHour)
非跨天：h >= startHour && h < endHour
```

每次 `checkSleepMode()`（每 10 秒，`const hour = new Date().getHours()`）计算：

```
当前状态 = 
  若 activationUntil > now         → 临时激活（强制显示，覆盖手动与时段）
  若 manualSleepMode = 'deep'       → 手动深度睡眠（全黑）
  若 manualSleepMode = 'sleep'      → 手动睡眠（媒体遮罩，保留 UI）
  若 深度睡眠启用 且 当前在深度时段  → 深度睡眠（全黑）
  若 睡眠启用 且 当前在睡眠时段      → 睡眠（媒体遮罩，保留 UI）
  否则                              → 正常（显示）
```

状态与上一次不同才执行 DOM 操作，避免每 10 秒重复。

### 临时激活

- `activateTemporarily()`：`activationUntil = Date.now() + 60000`，立即切换到显示状态。
- 触发来源：控制端「临时激活」按钮、显示端 `showMedia()`（控制端下发媒体）。
- 60 秒后下一次 `checkSleepMode()` 回落：若存在手动覆盖则回到手动状态，否则按时段判定。

### 手动覆盖

- `manualSleepMode = null | 'sleep' | 'deep'`（枚举），控制端「立即切换」显式进入睡眠/深度睡眠/恢复正常。
- 与「启用睡眠」开关无关：`sleepSettings.enabled=false` 时手动覆盖仍生效。
- 不随时间流逝/时段切换自动退出；需再下发 `sleepOverride('normal')` 或切换才改变。刷新/重启即重置（临时、不持久化）。
- 60 秒临时激活优先级更高：手动深度睡眠中下发媒体仍可见 60 秒，过期后回落手动深度睡眠。

## 显示端实现（display.html）

### 双遮罩层

HTML 末尾追加（`display.html` body 内）：

```html
<div id="mediaSleepOverlay" class="sleep-overlay sleep-overlay-media"></div>
<div id="uiSleepOverlay" class="sleep-overlay sleep-overlay-ui"></div>
```

- `z-index:999999` 高于现有所有覆盖层（render-display 监控层 `#monitorOverlay`、任务状态、语音状态等）。
- 深度睡眠：只显示 `#uiSleepOverlay`，覆盖 UI 和媒体，媒体容器不隐藏，视频暂停。
- 睡眠：只显示 `#mediaSleepOverlay`，覆盖媒体区域并保留 UI，视频暂停。
- 正常/临时激活：两个遮罩都隐藏，媒体节点保持原有布局，按播放状态恢复媒体。

### 状态变量与函数

```
sleepSettings   = { enabled:true, startHour:23, endHour:8, deepStartHour:1, deepEndHour:6 }
sleepState      = 'normal'   // 'normal' | 'sleep' | 'deep' | 'active'
activationUntil = 0          // 临时激活截止时间戳
manualSleepMode = null       // 手动覆盖枚举：null | 'sleep' | 'deep'
```

```
function inWindow(hour, start, end):
    若 start > end:  return hour >= start || hour < end
    否则:            return hour >= start && hour < end

function checkSleepMode():
    若 Date.now() < activationUntil: 目标 = 'active'                    # 临时激活最高优先，与开关/手动无关
    否则若 manualSleepMode 为 'deep'/'sleep': 目标 = manualSleepMode     # 手动覆盖优先于时段
    否则若 !sleepSettings.enabled: 目标 = 'normal'
    否则若 inWindow(hour, deepStartHour, deepEndHour): 目标 = 'deep'
    否则若 inWindow(hour, startHour, endHour): 目标 = 'sleep'
    否则: 目标 = 'normal'
    若 目标 !== sleepState: 应用该状态

function applySleepState(state):
    记录状态到 sleepState
    'normal'/'active': 隐藏 #mediaSleepOverlay 和 #uiSleepOverlay，恢复视频
    'sleep':           显示 #mediaSleepOverlay（保 UI），保持 #mediaContainer 布局，暂停视频
    'deep':            隐藏 #mediaSleepOverlay，显示 #uiSleepOverlay（全黑），保持 #mediaContainer 布局，暂停视频

function activateTemporarily():
    activationUntil = Date.now() + 60000
    applySleepState('active')      // 覆盖手动与时段；过期后回落手动或时段
```

- 视频暂停/恢复：`mediaVideo.pause()` / `mediaVideo.play().catch(...)`；html 模式（iframe 滚动）暂停/恢复滚动播放；图片无需暂停。
- TTS 语音：显示端不再按睡眠状态暂停或清空通用 TTS 队列；聊天、Agent、手动 TTS、提醒和语音指令正常播放。定时报时是否跳过由服务器发送接口的 `checkSleep=true` 决定。
- 启动时 `checkSleepMode()` 立即执行一次 + `setInterval(checkSleepMode, 10000)`。

### handleControl 扩展

- `case 'sleepSettings'`：`sleepSettings = data.value`（合法化），应用一次并立即判定（服务端已在其 control 处理器持久化）。
- `case 'sleepActivate'`：`activateTemporarily()`。
- `case 'sleepOverride'`：`manualSleepMode = (value === 'sleep' || value === 'deep') ? value : null`，立即判定。

### handleRestoreState 扩展

```
若 state.sleep 存在: sleepSettings = state.sleep（含启用/时段），checkSleepMode() 立即应用
```

### showMedia 扩展

`showMedia(data, noActivate, paused)` 入口处仅当非显示端内部调用时调用 `activateTemporarily()`（控制端下发媒体自动进入激活窗口）；显示端内部调用（restoreState 恢复持久化媒体、播放列表自动切播）传 `noActivate=true`，不触发 60 秒激活窗口，仅在睡眠时段静默隐藏，避免重启/维护时睡眠模式被击穿。`paused=true` 时（restoreState 恢复且 `state.isPlaying === false`）视频 `pause()` 不自动播放、html 不自动滚动，避免控制端暂停的视频重连后自动播放；`showMedia` 末尾 `reportPlayState(!paused)` 上报真实播放状态。

## 服务端（config）

### displayStates[ip].sleep 默认值

`src/apps/server/modules/config/config-app-service.js` 的 `defaultDisplayState` 追加：

```
sleep: { enabled:true, startHour:23, endHour:8, deepStartHour:1, deepEndHour:6 }
```

沿用现有 `updateDisplayState(ip, partialState)` 持久化——显示端回传时带上 `sleep` 字段即自动合并保存。

## 控制端实现

### upload.html 显示控制面板

在「显示控制」控件区（如「画面填充」控件后）加入口按钮：

```html
<button class="control-btn" onclick="Controls.showSleepModePanel()">睡眠模式</button>
```

### 弹窗设置框（SleepPanel）

新弹窗（复用项目现有弹窗样式，如 HTML 模式弹窗），内容：

- **启用睡眠模式** 开关（checkbox）
- **睡眠时段**：起 hour 下拉（0-23）— 止 hour 下拉（0-23），默认 23-8
- **深度睡眠时段**：起 hour 下拉 — 止 hour 下拉，默认 1-6
- **临时激活** 按钮 + 状态说明文字（当前状态 / 剩余激活秒数）
- **立即切换** 按钮组：「立即睡眠」「立即深度睡眠」「恢复正常」→ `sendControl('sleepOverride', value)`
- 保存按钮 → `sendControl('sleepSettings', settings)`；打开时 `fetch('/api/device-settings/' + displayId)` 查询当前选中显示端的 `settings.sleep` 填充（无则用默认值）

当前选中显示端的睡眠状态显示：显示端**连接成功即上报**当前 `sleepState`，之后每次状态变化（睡眠/深度/激活/正常切换、手动覆盖、激活过期回落）自动上报。服务端存 `displayData.state.sleepState` 并广播控制端；控制端睡眠卡片按钮文字实时显示当前状态（设置/睡眠中/深度睡眠中/临时激活中），切换显示端时通过 getState 响应（`displayState.state.sleepState`）刷新或回落「设置」。操作后 ack（`extraData.sleepState`）也即时更新。

## 数据流

```
控制端 SleepPanel 保存
  → sendControl('sleepSettings', {enabled,startHour,endHour,deepStartHour,deepEndHour})
  → 服务端 control 处理器收到 action==='sleepSettings' → updateDisplayState(ip, {sleep: data.value}) → config.json 持久化
  → 转发 control → 显示端 handleControl('sleepSettings') 应用设置 + checkSleepMode() 立即判定
  → 显示端刷新/重启后 restoreState(state.sleep) 恢复
```

```
控制端「临时激活」按钮
  → sendControl('sleepActivate')
  → 显示端 activateTemporarily()（60s 强制显示）

控制端「立即切换」按钮
  → sendControl('sleepOverride', 'sleep' | 'deep' | 'normal')
  → 显示端 manualSleepMode 赋值 → checkSleepMode() 立即应用（不持久化，刷新重置）

控制端下发媒体（sendMedia 等）
  → 显示端 showMedia()
  → activateTemporarily()（60s 强制显示，覆盖手动覆盖；过期后回落手动）
```

```
显示端连接成功 / 睡眠状态变化（applySleepState 末尾）
  → displayWs.send({ type: 'sleepStateReport', sleepState })
  → 服务端 displayData.state.sleepState = sleepState（不持久化）+ broadcastToControls
  → 控制端 sleepStateReport 分支（匹配当前选中显示端）→ 更新睡眠卡片按钮文字
  → 控制端切换显示端发 getState → displayState.state.sleepState → 更新按钮 / 未上报回落「设置」
```

```
服务端产生 TTS 音频
  → 普通聊天/Agent/手动/提醒/语音指令：sendToDisplay(..., { checkSleep:false })
  → time.announce：sendToDisplay(..., { checkSleep:true })
  → checkSleep=true 时按每个目标显示端的 sleepState 独立过滤
```

## 边界情况与降级

| 场景 | 处理 |
|------|------|
| 睡眠/深度睡眠时段重叠 | 深度睡眠优先级更高（先判深度再判睡眠） |
| 手动覆盖与时段/开关 | 手动覆盖优先于时段判定，且与 `enabled` 开关无关；手动持续生效直到再下发 |
| 手动深度睡眠中下发媒体 | 60s 临时激活覆盖手动强制显示，过期后回落手动深度睡眠 |
| 跨天时段（23-8 / 1-6） | `startHour > endHour` 时 `h >= start \|\| h < end` 判定 |
| 睡眠中下发媒体 | showMedia 触发 60s 临时激活，媒体可见 |
| 临时激活结束后仍处睡眠时段 | 恢复对应遮罩（视频暂停） |
| 睡眠中视频播放 | `mediaVideo.pause()`；恢复时 `play()` 续播（catch 拦截自动播放限制） |
| 睡眠中普通 TTS 播放 | 不暂停、不清空队列，聊天/Agent/手动/提醒/语音指令继续播放 |
| 睡眠中整点报时 | 服务器 `checkSleep=true` 检查目标显示端状态，睡眠/深度睡眠时跳过该显示端 |
| html 模式（iframe 滚动）睡眠 | 暂停滚动（`stopHtmlScroll`），恢复时 `startHtmlScroll` |
| 未启用睡眠模式 | 全部判定返回正常，遮罩永不显示 |
| 深度睡眠黑幕盖过监控层 | `#uiSleepOverlay` z-index 高于 `#monitorOverlay`（render-display）等全部覆盖层 |
| 设置合法化 | hour 值 clamp 到 0-23；`enabled` 布尔化 |

## 测试计划

1. **睡眠模式（23-8 模拟）**：将睡眠时段调成覆盖当前时间，确认媒体区域被遮罩、UI（时钟/文件名）保留、视频暂停且媒体容器尺寸不变
2. **深度睡眠（1-6 模拟）**：将深度时段调成覆盖当前时间，确认整屏全黑（含连接状态/监控层）、视频暂停
3. **临时激活**：深度睡眠中点击「临时激活」→ 强制显示；60 秒后恢复全黑
4. **媒体自动激活**：睡眠中控制端下发媒体 → 显示 60 秒，之后恢复媒体区域遮罩
5. **设置持久化**：配置睡眠时段 → 显示端刷新 → 设置恢复并立即生效
6. **优先级**：深度时段与睡眠时段重叠时按深度睡眠；临时激活覆盖两者；手动覆盖优先于时段
7. **手动覆盖**：立即睡眠/立即深度睡眠/恢复正常即时生效；`enabled=false` 时手动仍生效；激活覆盖手动、过期回落手动
8. **跨天**：startHour > endHour（如 23-8）在当前时间判定正确
9. **视频恢复**：睡眠隐藏暂停后，恢复时视频继续播放
10. **普通 TTS 不受睡眠影响**：睡眠中播放聊天/Agent/手动/提醒 TTS → 不暂停、不清空队列
11. **定时报时检查睡眠**：服务器 `checkSleep=true` 时，睡眠/深度睡眠显示端不接收定时报时，正常显示端继续接收
12. **批量手动 next**：睡眠期间自动 timer/ended 不推进批量索引；控制端手动点击“下一个”先临时激活 60 秒，再立即切换当前项

## 改动文件

| 文件 | 改动 |
|------|------|
| `src/apps/web-mediacenter/ui/public/display.html` | `#mediaSleepOverlay`/`#uiSleepOverlay` 双遮罩 + `checkSleepMode`/`applySleepState`/`activateTemporarily`/`reportSleepState` + `handleControl` 新增 `sleepSettings`/`sleepActivate`/`sleepOverride` + `handleRestoreState` 恢复 + `showMedia` 触发激活 + 连接/状态变化上报（默认开启） |
| `src/apps/web-mediacenter/ui/public/css/display.css` | 双遮罩定位、层级与媒体容器相对定位；睡眠状态不改变媒体布局 |
| `src/apps/web-mediacenter/ui/public/upload.html` | 显示控制面板「睡眠模式」入口按钮（`#sleepSettingsBtn` 文字随状态变化）+ 弹窗设置框（SleepPanel） |
| `src/apps/web-mediacenter/ui/public/js/controls.js` | SleepPanel 逻辑（打开/填充/保存/临时激活/立即切换/状态显示）+ `updateSleepStatus` 更新按钮文字 |
| `src/apps/server/boot/server-app.js` | 显示端上行 `sleepStateReport`：存 `displayData.state.sleepState` + 转发控制端 |
| `src/apps/server/modules/config/config-app-service.js` | `defaultDisplayState` 追加 `sleep` 字段 |
| `docs/spec/config.md` | `defaultDisplayState` 伪代码补 `sleep` 字段 |
| `docs/spec/monitor-system.md` 或新增 spec | 睡眠模式伪代码（据实现位置定） |
| `docs/todo.md` / `changelog.md` / `docs/design.md` / `docs/task/*.md` | 按项目规范更新 |

## 批量播放手动 next

播放列表的自动 timer/ended 回调在睡眠或深度睡眠期间不得推进索引；控制端手动点击“下一个”属于主动操作，显示端先执行 `activateTemporarily()` 进入 60 秒 `active` 状态，再执行 `playlistNext()`，因此可以立即切换下一项。

## 预计工时

- 显示端判定/遮罩/激活：1.5h
- 控制端弹窗设置框：1.5h
- 服务端配置字段：0.5h
- 文档更新：0.5h
- 真机自测：1h
- 合计：**5h**
