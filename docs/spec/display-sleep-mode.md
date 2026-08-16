# 显示端睡眠模式 — 实现文档

## 概述

显示端（`display.html`）按本地时段自动隐藏媒体（睡眠）或整屏黑幕（深度睡眠），降低夜间干扰。时间判断在显示端本地，每 10 秒检查一次；优先级 临时激活 > 深度睡眠 > 睡眠 > 正常。

## 状态模型

```
sleepSettings = { enabled, startHour, endHour, deepStartHour, deepEndHour }
sleepState    = 'normal' | 'sleep' | 'deep' | 'active'
activationUntil = 临时激活截止时间戳

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

function applySleepState(state):
    prev = sleepState;  sleepState = state
    isHidden = (state == 'sleep' || state == 'deep')
    #sleepOverlay.display = (state == 'deep') ? 'block' : 'none'
    #mediaContainer.display = isHidden ? 'none' : 'flex'
    若 isHidden: pauseSleepMedia()
    否则若 prev 为 'sleep'/'deep': resumeSleepMedia()   # 仅隐藏态恢复时续播

function checkSleepMode():          # 每 10 秒，setInterval
    target = 'normal'
    若 sleepSettings.enabled:
        hour = now.getHours()
        若 now < activationUntil:  target = 'active'
        否则若 inSleepWindow(hour, deepStartHour, deepEndHour): target = 'deep'
        否则若 inSleepWindow(hour, startHour, endHour):         target = 'sleep'
    若 target != sleepState:  applySleepState(target)     # 状态变化才操作 DOM

function activateTemporarily():     # 控制端按钮 / showMedia 触发
    activationUntil = now + 60000
    applySleepState('active')
```

## 触发链路

```
控制端 SleepPanel 保存
  → sendControl('sleepSettings', settings)
  → 服务端 control 处理器持久化 displayStates[ip].sleep
  → 显示端 handleControl('sleepSettings') → 应用设置 + checkSleepMode()
  → ack 携带 extraData.sleepState → 控制端更新弹窗状态行

控制端「临时激活」/ 下发媒体
  → sendControl('sleepActivate') / 显示端 showMedia() 入口 activateTemporarily()
  → 60 秒激活窗口强制显示，之后 checkSleepMode() 恢复按时段隐藏

显示端刷新/重启
  → 服务端 restoreState(state) → handleRestoreState 读 state.sleep → checkSleepMode() 立即应用
```

## 媒体暂停/恢复

| 模式 | 睡眠/深度睡眠 | 恢复（normal/active） |
|------|--------------|----------------------|
| 视频 | `mediaVideo.pause()` | `mediaVideo.play().catch(...)` |
| html（iframe 滚动） | `stopHtmlScroll()` | `startHtmlScroll(mediaHtml, currentHtmlScroll)` |
| 图片 | 无需处理 | 无需处理 |

## 遮罩层

`#sleepOverlay`（`position:fixed;inset:0;background:#000;z-index:999999`）：深度睡眠时 `display:block` 全屏黑幕，z-index 高于 `#monitorOverlay`（render-display 监控层）等全部覆盖层；睡眠/正常/激活时 `display:none`。

## 消息协议

| 消息 | 值 | 处理 |
|------|----|------|
| `control` / `sleepSettings` | `{enabled,startHour,endHour,deepStartHour,deepEndHour}` | 应用设置 + checkSleepMode + ack(`extraData.sleepState`) |
| `control` / `sleepActivate` | 无 | `activateTemporarily()` + ack(`extraData.sleepState`) |
| `restoreState` | `state.sleep` | 恢复设置 + checkSleepMode |
| `GET /api/device-settings/:displayId` | — | 返回 `settings.sleep`（控制端填充弹窗） |
