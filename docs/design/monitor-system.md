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
