# 显示端睡眠模式 设计文档

## 概述

为显示端（`display.html`）增加**睡眠模式**与**深度睡眠模式**，按时间段自动隐藏媒体/UI，降低夜间干扰。支持：

1. **睡眠模式（默认 23:00-8:00，跨天）**：隐藏媒体（图片/视频/iframe），视频暂停，保留 UI 覆盖层（时钟/文件名/语音状态等）。
2. **深度睡眠模式（默认 1:00-6:00）**：全屏黑幕遮罩，媒体与 UI 全部隐藏（含连接状态/语音状态/监控层等所有覆盖层）。
3. **临时激活（60 秒）**：手动按钮或控制端下发媒体自动触发，期间强制显示媒体+UI，60 秒后回落（手动覆盖优先于时段判定）。
4. **手动覆盖**：控制端「立即切换」显式进入睡眠/深度睡眠/恢复正常，不随时段/开关自动切换，直到再下发才改变（刷新即重置，临时）。
5. **控制端配置**：显示控制面板新增「睡眠模式」入口 → 弹窗设置框（启用开关 + 可配时段 + 临时激活按钮 + 立即切换按钮 + 当前状态），按当前选中显示端生效并持久化到服务端。

## 需求背景

### 现状问题

显示端 24 小时持续显示媒体画面与 UI，夜间无操作时仍点亮屏幕、播放视频（含音频），干扰休息并浪费资源。

### 目标

- 夜间按时段自动隐藏媒体（睡眠）或整屏熄灭（深度睡眠），视频暂停避免持续播放。
- 用户需要看画面时可手动临时激活 60 秒；控制端下发媒体时自动临时激活，保证操作即时可见。
- 时段/开关可在控制端按显示端独立配置并持久化，刷新/重启后沿用。

### 约束

- 时间判断在**显示端本地**（各设备用自己的本地时区），每 10 秒检查一次。
- 设置按**当前选中显示端**生效，持久化到服务端 `displayStates[ip].sleep`（沿用现有 rotation/fit/volume 状态流）。
- 优先级：**临时激活 > 手动覆盖 > 深度睡眠 > 睡眠 > 正常**。
- 深度睡眠用全屏黑幕遮罩实现（不逐元素枚举隐藏），保证新增 UI 元素也能被完整覆盖。
- 视频睡眠时**暂停（画面+音频）**，恢复后继续播放。
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
  └─ #sleepOverlay 全屏黑幕遮罩（z-index 999999，盖全部覆盖层）
```

## 状态模型与判定

### 优先级

```
正常(显示) < 睡眠(隐藏媒体, 保留 UI) < 深度睡眠(全黑) < 手动覆盖(显式进入睡眠/深度) < 临时激活(强制显示)
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
  若 manualSleepMode = 'sleep'      → 手动睡眠（隐藏媒体，保留 UI）
  若 深度睡眠启用 且 当前在深度时段  → 深度睡眠（全黑）
  若 睡眠启用 且 当前在睡眠时段      → 睡眠（隐藏媒体，保留 UI）
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

### 遮罩层

HTML 末尾追加（`display.html` body 内）：

```html
<div id="sleepOverlay" style="display:none;position:fixed;inset:0;background:#000;z-index:999999;"></div>
```

- `z-index:999999` 高于现有所有覆盖层（render-display 监控层 `#monitorOverlay`、任务状态、语音状态等）。
- 深度睡眠：`#sleepOverlay` 显示（黑屏全遮），媒体容器隐藏，视频暂停。
- 睡眠：`#sleepOverlay` 隐藏（保留 UI），`#mediaContainer` 隐藏，视频暂停。
- 正常/临时激活：`#sleepOverlay` 隐藏，`#mediaContainer` 显示，视频恢复。

### 状态变量与函数

```
sleepSettings   = { enabled:false, startHour:23, endHour:8, deepStartHour:1, deepEndHour:6 }
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
    'normal'/'active': 隐藏 #sleepOverlay，显示 #mediaContainer，恢复视频
    'sleep':           隐藏 #sleepOverlay（保 UI），隐藏 #mediaContainer，暂停视频
    'deep':            显示 #sleepOverlay（全黑），隐藏 #mediaContainer，暂停视频

function activateTemporarily():
    activationUntil = Date.now() + 60000
    applySleepState('active')      // 覆盖手动与时段；过期后回落手动或时段
```

- 视频暂停/恢复：`mediaVideo.pause()` / `mediaVideo.play().catch(...)`；html 模式（iframe 滚动）暂停/恢复滚动播放；图片无需暂停。
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

`showMedia(data, noActivate)` 入口处仅当非显示端内部调用时调用 `activateTemporarily()`（控制端下发媒体自动进入激活窗口）；显示端内部调用（restoreState 恢复持久化媒体、播放列表自动切播）传 `noActivate=true`，不触发 60 秒激活窗口，仅在睡眠时段静默隐藏，避免重启/维护时睡眠模式被击穿。

## 服务端（config）

### displayStates[ip].sleep 默认值

`src/apps/server/modules/config/config-app-service.js` 的 `defaultDisplayState` 追加：

```
sleep: { enabled:false, startHour:23, endHour:8, deepStartHour:1, deepEndHour:6 }
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

当前选中显示端的睡眠状态显示：控制端根据该显示端最近一次回传的状态（显示端收到 sleepSettings 后回传 ack 含当前 sleepState）或设备在线状态展示「当前: 睡眠中/深度睡眠/正常/激活中」。

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

## 边界情况与降级

| 场景 | 处理 |
|------|------|
| 睡眠/深度睡眠时段重叠 | 深度睡眠优先级更高（先判深度再判睡眠） |
| 手动覆盖与时段/开关 | 手动覆盖优先于时段判定，且与 `enabled` 开关无关；手动持续生效直到再下发 |
| 手动深度睡眠中下发媒体 | 60s 临时激活覆盖手动强制显示，过期后回落手动深度睡眠 |
| 跨天时段（23-8 / 1-6） | `startHour > endHour` 时 `h >= start \|\| h < end` 判定 |
| 睡眠中下发媒体 | showMedia 触发 60s 临时激活，媒体可见 |
| 临时激活结束后仍处睡眠时段 | 恢复隐藏（视频暂停） |
| 睡眠中视频播放 | `mediaVideo.pause()`；恢复时 `play()` 续播（catch 拦截自动播放限制） |
| html 模式（iframe 滚动）睡眠 | 暂停滚动（`stopHtmlScroll`），恢复时 `startHtmlScroll` |
| 未启用睡眠模式 | 全部判定返回正常，遮罩永不显示 |
| 深度睡眠黑幕盖过监控层 | `#sleepOverlay` z-index 高于 `#monitorOverlay`（render-display）等全部覆盖层 |
| 设置合法化 | hour 值 clamp 到 0-23；`enabled` 布尔化 |

## 测试计划

1. **睡眠模式（23-8 模拟）**：将睡眠时段调成覆盖当前时间，确认媒体隐藏、UI（时钟/文件名）保留、视频暂停
2. **深度睡眠（1-6 模拟）**：将深度时段调成覆盖当前时间，确认整屏全黑（含连接状态/监控层）、视频暂停
3. **临时激活**：深度睡眠中点击「临时激活」→ 强制显示；60 秒后恢复全黑
4. **媒体自动激活**：睡眠中控制端下发媒体 → 显示 60 秒，之后恢复隐藏
5. **设置持久化**：配置睡眠时段 → 显示端刷新 → 设置恢复并立即生效
6. **优先级**：深度时段与睡眠时段重叠时按深度睡眠；临时激活覆盖两者；手动覆盖优先于时段
7. **手动覆盖**：立即睡眠/立即深度睡眠/恢复正常即时生效；`enabled=false` 时手动仍生效；激活覆盖手动、过期回落手动
8. **跨天**：startHour > endHour（如 23-8）在当前时间判定正确
9. **视频恢复**：睡眠隐藏暂停后，恢复时视频继续播放

## 改动文件

| 文件 | 改动 |
|------|------|
| `src/apps/web-mediacenter/ui/public/display.html` | `#sleepOverlay` 遮罩 + `checkSleepMode`/`applySleepState`/`activateTemporarily` + `handleControl` 新增 `sleepSettings`/`sleepActivate`/`sleepOverride` + `handleRestoreState` 恢复 + `showMedia` 触发激活 |
| `src/apps/web-mediacenter/ui/public/upload.html` | 显示控制面板「睡眠模式」入口按钮 + 弹窗设置框（SleepPanel） |
| `src/apps/web-mediacenter/ui/public/js/controls.js` | SleepPanel 逻辑（打开/填充/保存/临时激活/立即切换/状态显示） |
| `src/apps/server/modules/config/config-app-service.js` | `defaultDisplayState` 追加 `sleep` 字段 |
| `docs/spec/config.md` | `defaultDisplayState` 伪代码补 `sleep` 字段 |
| `docs/spec/monitor-system.md` 或新增 spec | 睡眠模式伪代码（据实现位置定） |
| `docs/todo.md` / `changelog.md` / `docs/design.md` / `docs/task/*.md` | 按项目规范更新 |

## 预计工时

- 显示端判定/遮罩/激活：1.5h
- 控制端弹窗设置框：1.5h
- 服务端配置字段：0.5h
- 文档更新：0.5h
- 真机自测：1h
- 合计：**5h**
