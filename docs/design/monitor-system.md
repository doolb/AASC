# 硬件监控系统 — 设计文档

## 概述

在 Web MediaCenter 中新增硬件监控系统，通过任务链实现 Windows 机器或 Linux 服务器的 CPU/GPU/内存实时监控，并在显示端渲染可视化仪表盘。

## 系统架构

```
控制端任务面板
  │
  ├── ① 创建 win-monitor (subdisplay/service)
  │     └── 采集 CPU/GPU/内存 → sendProgress
  │
  ├── ② 创建 render-display (display/service)
  │     └── 在显示端加载 render.html/render.js → Canvas 仪表盘
  │
  └── task:link (任务链绑定)
        └── win-monitor 的 progress → 自动路由到 render-display 的显示端
```

## 数据流

```
win-monitor (子显示端/服务器)
  │ setInterval 采集
  │   ├── systeminformation / nvidia-smi (Windows)
  │   └── sensors -j / /proc/stat / os 模块 (Linux)
  │
  ├── sendProgress({ cpuPercent, gpuPercent, memPercent, ... })
  │
  ▼
子显示端 → task:progress → 服务端 TaskManager
  │
  ├── 广播到控制端 (widget 实时更新)
  │
  └── 任务链路由 → sendToDisplay(displayId, { type: 'task:renderUpdate', data })
        │
        ▼
     显示端 → onmessage → window._renderTaskUpdates[id](data)
        │
        └── Canvas 环形图 + 折线图 + 内存条
```

## 任务链机制

新增 `taskManager.linkTasks(sourceInstanceId, targetTask, targetInstanceId)` 实现任务输出到输入的绑定：

- source 的 `progress` 事件触发时，检查 `taskLinks`
- 找到下游任务实例的参数 `targetDisplay`
- 将数据通过 `sendToDisplay` 转发到显示端
- 一个来源实例允许同时绑定多个目标实例，因此同一个 `win-monitor` 可以把数据分发到多个 `render-display` 显示端。
- `render-display` 在不同 `displayId` 上独立运行，只有同一显示端的同名服务互斥，避免后启动任务清理先启动显示端的条目。
- 同一个 `render-display` 目标也允许接收多个来源任务的链接，解除一个来源不会影响其他来源继续更新该显示端。
- 解除多来源中的一个链接时只向渲染任务发送该来源的停止标记，隐藏对应子条目，保留其他来源子条目。
- 任务列表响应同时返回规范化的有效链接，控制端使用现有“链接到...”弹窗统一查看、新增和解除链接。
- 返回链接前校验来源和目标实例仍存在，并按来源实例、目标任务和目标实例去重；历史文件中的失效链接不在面板中展示。
- 解除链接必须携带明确的目标实例 ID；缺少目标 ID 的请求拒绝执行，避免单项操作误解除来源的全部目标。
- 解除仍运行的目标后，目标条目从“已链接目标”移动到“添加目标”，便于立即重新绑定；已停止目标只从已链接列表移除。
- 选择添加目标后保持链接弹窗打开，允许连续为同一来源实例选择多个目标显示端。

## 通用渲染任务

任何 `files[]` 包含 `render.html` 的任务，display.html 自动识别为渲染任务：

- **不走 Web Worker**，在主线程执行
- 注入 `render.html` → DOM 覆盖层
- 执行 `render.js` → 返回 `update(data)` 函数
- 注册到 `window._renderTaskUpdates` 供数据推送

支持的消息类型：
- `task:renderUpdate` — 按 instanceId 分发的实时数据
- `hardwareStats` — 兼容旧版转发方式

实时更新不产生命令回执：

- `task:renderUpdate` 和兼容的 `hardwareStats` 是高频状态推送，不代表一次需要用户确认的控制命令。
- 显示端只更新已注册的渲染任务，不发送 `commandAck`，避免控制端把每次监控刷新显示成 Toast/Tips。
- 播放、控制、TTS、提醒和其他显式控制消息仍按原协议发送 `commandAck`。
