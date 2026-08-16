# Web MediaCenter - 项目设计文档

## 项目概述

基于 WebSocket 的实时媒体展示控制系统，支持多显示端连接和统一控制。

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│             Server (src/apps/server/boot/server-app.js)      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Express   │  │  WebSocket  │  │  File Management    │  │
│  │   HTTP API  │  │   Server    │  │  (res/uploads/)     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   Control UI    │  │   Display 1     │  │   Display N     │
│  (upload.html)  │  │ (display.html)  │  │ (display.html)  │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

## 功能模块设计

| 模块 | 文档 | 说明 |
|------|------|------|
| 显示端 | [display.md](design/display.md) | 媒体展示、画面适配、旋转裁剪、选择模式 |
| 控制端 | [control.md](design/control.md) | 媒体管理、显示控制、裁剪预览 |
| 媒体库 | [media-library.md](design/media-library.md) | 多媒体库管理、多协议支持、文件操作 |
| 提醒功能 | [reminder.md](design/reminder.md) | 定时提醒、语音播报、弹窗提示 |
| 聊天系统 | [chat-system.md](design/chat-system.md) | 群聊/私聊、AI助手、系统指令、语音播报 |
| WebSocket | [websocket.md](design/websocket.md) | 通信协议、消息类型 |
| AASC架构 | [aasc.md](design/aasc.md) | 消息总线架构、执行者模型、用户模型、能力继承 |
| Auto-Brain 架构 | [auto-brain.md](design/auto-brain.md) | 独立决策分层、LLM 策略规划、Guard 把关回滚 |
| 分层架构 | [layered-architecture.md](design/layered-architecture.md) | Core/Framework/External/App 分层与依赖规则 |
| DataSnapshot | [data-snapshot.md](design/data-snapshot.md) | 数据快照、内存数据持久化、调试友好 |
| ViewBind | [viewbind.md](design/viewbind.md) | 视图绑定、数据驱动UI更新、与DataSnapshot集成 |
| 地图可视化 | [map-visualization.md](design/map-visualization.md) | 执行者能力可视化、2D地图渲染、PixiJS渲染器 |
| 子服务器 | [sub-server.md](design/sub-server.md) | 子服务器分发器、负载均衡、健康检查 |
| 服务端语音识别 | [sherpa-asr.md](design/sherpa-asr.md) | ASR 串行识别、native 资源释放、临时文件清理 |
| 服务端 TTS | [tts.md](design/tts.md) | 外部 TTS 调用超时、流式写盘、失败清理与内存保护 |
| 显示端分布式能力 | [display-capability.md](design/display-capability.md) | 显示端能力声明、能力路由、分布式协调 |
| 日志筛选与系统监控 | [log-viewer.md](design/log-viewer.md) | 结构化日志缓冲区、多维度筛选、CPU/内存监控 |
| 日志大脑 | [log-brain.md](design/log-brain.md) | 类人脑日志摘要、模式提取、LLM诊断上下文 |
| 资源目录 | [resource-layout.md](design/resource-layout.md) | res 目录分层、路径边界、统一资源规范 |
| 工程目录结构 | [project-structure.md](design/project-structure.md) | 根目录分层、模块归位策略、文档同步规则 |
|| 远程任务系统 | [remote-task-system.md](design/remote-task-system.md) | 远程 JS 代码执行、任务生命周期、三种运行时 |
|| 显示端模型推理任务 | [model-inference-task.md](design/model-inference-task.md) | ModelManager 通用推理架构、LFM-VL 适配器、内置任务集成 |
|| 硬件监控系统 | [monitor-system.md](design/monitor-system.md) | 任务链采集→渲染、通用渲染任务协议 |
| Android显示端监控 | [android-display-stats.md](design/android-display-stats.md) | APK 自身资源监控 + render-display 横条化 |
| Android显示端 GPU Compute | [android-compute-bridge.md](design/android-compute-bridge.md) | 离屏 EGL 3.1 compute 桥、SSBO/image2D 数值与图像读回 |
| Android原生语音识别 | [android-native-asr.md](design/android-native-asr.md) | sherpa-onnx AAR 原生加载 SenseVoice、模型按需下载、服务器中转接入 |
