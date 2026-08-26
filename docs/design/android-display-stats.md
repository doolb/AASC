# Android APK 显示端自身资源监控 + render-display 横条化 设计文档

## 概述

两个相互独立但相关的改动：

1. **APK 原生资源接口**：在 `NativeBridge` 新增 `getSystemStats()`，返回 APK 设备自身的 CPU 使用率与内存信息（对齐 PC 端 `win-monitor` 数据格式）。
2. **render-display 横条化**：将硬件监控覆盖层从 260×260 圆形双仪表改为**单行内联横条**布局，大幅降低占空间。

APK 设备自身的资源信息**在本地渲染**：render.js 检测到 `window.NativeDisplay` 时定时轮询 `getSystemStats()`，将 APK 设备作为监控覆盖层里的一个独立来源展示（来源名 = 设备型号），无需改服务端。

## 需求背景

### 现状问题

| 问题 | 根因 |
|------|------|
| render-display 监控覆盖层太占空间 | 每个来源渲染为 260×260 圆形双仪表（CPU/内存双环），3 个来源时覆盖层高约 780px+ |
| APK 显示端看不到自身资源 | NativeBridge 仅有截图/输入/屏幕尺寸接口，无系统资源信息 |

### 目标

1. APK 可获取并展示自身 CPU 使用率、内存占用（横条形式）
2. render-display 改为单行横条，覆盖层高度降到 ~40px/来源
3. 浏览器显示端不受影响（无桥则不轮询，仅布局变化）

### 约束

- 数据格式对齐 PC 端 `win-monitor`：`cpuPercent`/`memPercent`/`memTotal`/`memUsed`（内存单位 GB，1 位小数）
- APK 本地来源不产生 GPU/温度数据（Android 无 nvidia-smi），对应字段缺省不渲染
- 覆盖层维持现有细边框样式（`border:1px solid rgba(255,255,255,0.06)` + 圆角），不新增整体面板框或每行独立框
- 旋转 90°/180°/270° 适配逻辑保留；来源条目重建后按新覆盖层尺寸重新定位，并避让媒体名（90°右侧、180°下侧、270°左侧），保持覆盖层与媒体名的 0°相对层级关系

## 核心架构

```
APK 内 WebView（display.html）
  └─ render-display 覆盖层（render.js）
       ├─ 远端来源：服务端 system-stats 推送（task:renderUpdate）→ 现有链路
       └─ 本地来源【新增】：检测 window.NativeDisplay → setInterval 轮询
            NativeDisplay.getSystemStats() → JSON → 作为独立来源（hostname=设备型号）
```

两种来源共用同一份**单行横条**渲染，PC 来源有 GPU/温度时多显示 GPU 条与温度小字。

## APK 原生接口（NativeBridge.kt）

### getSystemStats()

同步返回 JSON 字符串（与现有桥方法一致，`@JavascriptInterface`）：

```json
{
  "hostname": "Pixel 6",
  "cpuPercent": 62.5,
  "memPercent": 38.2,
  "memTotal": 8.0,
  "memUsed": 3.1
}
```

| 字段 | 来源 | 说明 |
|------|------|------|
| hostname | `Build.MODEL`，为空回退 `MANUFACTURER + " " + MODEL` | 来源标识 |
| cpuPercent | 读取 `/proc/stat` `cpu` 行，前后两次采样差值算 busy/total | 1 位小数；首次调用无基线返回 0 |
| memPercent / memUsed / memTotal | `ActivityManager.getMemoryInfo()` → `totalMem`/`availMem`（字节），`memUsed = total - avail`，GB 换算 | 1 位小数 |

**CPU 采样实现**：类字段保存上次的 idle/total 时间戳，每次调用计算两次差值。首次调用仅有当前值，无基线 → `cpuPercent = 0`。

**线程**：`@JavascriptInterface` 在 JavaBridge 后台线程执行，`/proc/stat` 与 `getMemoryInfo()` 读取极快，不阻塞主线程，无需额外线程切换。

## render.js 本地轮询

- 初始化时检测 `window.NativeDisplay && NativeDisplay.isAvailable()` 存在 → `setInterval(800ms)` 轮询 `getSystemStats()`。
- 结果 JSON.parse 后走与远端相同的 `update(data)` 路径。
- **自清理**：定时器每次触发先检查 `window._renderTaskUpdates[api.instanceId]` 是否仍存在（display.html 的 `task:stop` 会删除它）。不存在 → `clearInterval` 退出，避免覆盖层移除后定时器泄漏。

## 单行横条布局（render.html + render.js）

- render.html 保留 `#monitorOverlay` 覆盖层结构与细边框样式，内部容器 `#gaugeContainer` 改为来源列表容器。
- 每个来源一行（纯 DOM/CSS，不用 canvas）：

```
[Pixel 6]   CPU ▓▓▓▓▓▓░░░░ 62%        MEM ▓▓▓░░░░░░░ 38%  3.1/8.0G
[PC-1]      CPU ▓▓▓░░░░░░░ 34%  45°C  MEM ▓▓░░░░░░░░ 21%  6.4/32G  GPU ▓▓░░ 12%
```

- 来源名固定宽，左对齐。
- 每个指标 = 小标签 + 填充条（横条）+ 百分比文字。
- 温度（`cpuTemp`/`gpuTemp`）、GPU 利用率、显存（`gpuMemUsed/gpuMemTotal`）、功耗为小字后缀，**有数据才显示**。APK 本地来源无 GPU/温度，不显示。
- 复用现有 `pctColor()` 渐变着色；GPU 条仅在有 GPU 数据时出现。
- 内存文字格式：`已用GB/总量GB`（如 `3.1/8.0G`），与 PC 端 `memUsed/memTotal` 单位一致。
- 覆盖层保持左下角定位（沿用现有旋转适配逻辑）。

## 兼容与降级

| 场景 | 处理 |
|------|------|
| 浏览器显示端（无 NativeDisplay） | 不轮询，仅远端来源；布局换成横条，行为不变 |
| 覆盖层被 task:stop 移除 | 定时器自检退出，无泄漏 |
| getSystemStats 首次调用 | cpuPercent=0，后续正常 |
| PC 来源无 GPU/温度 | 对应条/小字不渲染 |
| getSystemStats 解析失败/异常 | 跳过本次更新，下次轮询继续 |
| 旋转 90°/270° | 保留现有 applyRotationStyle 适配，覆盖层结构不变 |

## 测试计划

1. **APK 真机**：启动 render-display 任务 → 覆盖层出现横条，来源名为设备型号，CPU/内存数值每 ~1s 刷新，CPU 百分比随负载变化（如播放视频时上升）
2. **PC 来源回归**：PC 端 system-stats 推送正常渲染横条（CPU/内存/GPU/温度），覆盖层高度明显下降
3. **多来源**：APK + PC 同时显示为两行横条，互不干扰
4. **task:stop**：停止任务后覆盖层移除，无定时器泄漏（控制端无报错）
5. **浏览器显示端**：行为与现在一致，仅布局为横条，无桥不轮询
6. **旋转**：90°/270° 下横条覆盖层位置正确

## 改动文件

| 文件 | 改动 |
|------|------|
| `src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt` | 新增 `getSystemStats()` + `/proc/stat` CPU 采样逻辑 |
| `res/tasks/render-display/render.js` | 横条渲染替代圆形仪表；本地轮询 + 自清理 |
| `res/tasks/render-display/render.html` | 覆盖层内部结构适配横条 |
| `docs/spec/android-display.md` | 增补 getSystemStats 伪代码 |
| `docs/spec/monitor-system.md` | 增补横条渲染 + 本地来源伪代码 |
| `docs/todo.md` / `changelog.md` / `docs/task/*.md` | 按项目规范更新 |

## 预计工时

- APK 原生接口：0.5h
- render.js 横条化 + 本地轮询：1.5h
- 文档更新：0.5h
- 真机自测：1h
