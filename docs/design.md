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
| 控制端主题与 UI 控件分类 | [control-ui-theme.md](design/control-ui-theme.md) | 控制端主题切换、交互控件语义分类与统一样式 |
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
| 独立 Android 离线语音识别 APK | [android-asr-apk.md](../3rd/tts-server/docs/design/android-asr-apk.md) | 内置 SenseVoice、录音/文件识别、HTTP 测试和 CPU 核心模式 |
| Linux TTS 服务 | [tts-linux.md](design/tts-linux.md) | Embedded Speech Linux TTS HTTP 服务与 NaturalVoice 运行时解耦 |
| 独立 Android 离线 TTS APK | [android-offline-tts-apk.md](../3rd/tts-server/docs/design/android-offline-tts-apk.md) | 内置 Xiaoxiao 模型、离线生成、播放和耗时显示 |
| Android TTS CPU 核心模式 | [android-tts-cpu-affinity.md](../3rd/tts-server/docs/design/android-tts-cpu-affinity.md) | 自动/大核/小核选择、JNI affinity 和自动回退 |
| 显示端分布式能力 | [display-capability.md](design/display-capability.md) | 显示端能力声明、能力路由、分布式协调 |
| 显示端语音唤醒与监听控制 | [display-voice-conversation.md](design/display-voice-conversation.md) | 按显示端监听开关、唤醒状态、TTS完成后3分钟超时 |
| 日志筛选与系统监控 | [log-viewer.md](design/log-viewer.md) | 结构化日志缓冲区、多维度筛选、CPU/内存监控 |
| 日志大脑 | [log-brain.md](design/log-brain.md) | 类人脑日志摘要、模式提取、LLM诊断上下文 |
| 资源目录 | [resource-layout.md](design/resource-layout.md) | res 目录分层、路径边界、统一资源规范 |
| 工程目录结构 | [project-structure.md](design/project-structure.md) | 根目录分层、模块归位策略、文档同步规则 |
|| 远程任务系统 | [remote-task-system.md](design/remote-task-system.md) | 远程 JS 代码执行、任务生命周期、三种运行时 |
|| 显示端模型推理任务 | [model-inference-task.md](design/model-inference-task.md) | ModelManager 通用推理架构、LFM-VL 适配器、内置任务集成 |
|| 硬件监控系统 | [monitor-system.md](design/monitor-system.md) | 任务链采集→渲染、通用渲染任务协议 |
| Android显示端监控 | [android-display-stats.md](design/android-display-stats.md) | APK 自身资源监控 + render-display 横条化 |
| Android显示端 | [android-display.md](design/android-display.md) | WebView 显示端、原生桥、部署后自动恢复服务器地址 |
| render-display 文字内嵌 | [render-display-inline-text.md](design/render-display-inline-text.md) | 条内居中浮层文字、GPU/显存第二行占位对齐 |
| Android显示端 GPU Compute | [android-compute-bridge.md](design/android-compute-bridge.md) | 离屏 EGL 3.1 compute 桥、SSBO/image2D 数值与图像读回 |
| Android原生语音识别 | [android-native-asr.md](design/android-native-asr.md) | sherpa-onnx AAR 原生加载 SenseVoice、模型按需下载、服务器中转接入 |
| Android原生语音生成 | [android-native-tts.md](design/android-native-tts.md) | Microsoft Embedded Speech 离线合成 Xiaoxiao、模型按需下载、显示端生成与服务端回退 |
| Android原生声纹识别 | [voiceprint.md](design/voiceprint.md) | 外部声纹模型加载、说话人匹配与 APK 端声纹门控 |
| 独立 Android 声纹对比测试 APK | [android-voiceprint-test-apk.md](design/android-voiceprint-test-apk.md) | 通过浏览器访问 APK，测试 Sherpa 声纹及流式 ASR 流程 |
| 显示端睡眠模式 | [display-sleep-mode.md](design/display-sleep-mode.md) | 按时段媒体遮罩/深度 UI 全屏遮罩/60s 临时激活，控制端可配 |
| 音频媒体播放 | [audio-media.md](design/audio-media.md) | WAV/OGG/MP3 普通播放、批量播放、控制端进度与睡眠手动切换 |
| 纯文本分页 TTS 播放 | [text-media.md](design/text-media.md) | txt/md 分页显示、显示端分句 TTS、单文档控制与批量播放 |
| 文本 TTS 路由与批量类型筛选 | [text-media-routing.md](design/text-media-routing.md) | 服务器媒体类型筛选、手动语音能力路由、下一句预生成 |
| AI 执行规则 | [ai-rules.md](design/ai-rules.md) | 工作 AI 重启服务器时仅允许使用控制端接口 |
| 服务器重启命令 | [server-restart-script.md](design/server-restart-script.md) | 通过控制端接口重启服务器，绕过 HTTPS 代理 |
| 工作 AI 角色 | [ai-roles.md](design/ai-roles.md) | 控制端 AI 角色、角色定义自管理与任务历史 |
| LLM 配置 Agent 模式 | [llm-agent-mode.md](design/llm-agent-mode.md) | 普通 LLM profile 的 Pi Agent 模式、只读工具与服务器进程管理 |
| 动态画面填充模式 | [dynamic-fit-mode.md](design/dynamic-fit-mode.md) | 适应与铺满循环过渡、控制端时间配置 |
