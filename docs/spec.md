# Web MediaCenter - 项目实现文档

## 项目概述

基于 WebSocket 的实时媒体展示控制系统，采用客户端-服务器架构。

## 功能模块实现

| 模块 | 文档 | 说明 |
|------|------|------|
| HTTP API | [api.md](spec/api.md) | 文件上传、媒体管理、TTS、提醒、聊天、整点报时等 API |
| WebSocket | [websocket.md](spec/websocket.md) | 连接处理、消息类型、广播函数、前端客户端 |
| 配置管理 | [config.md](spec/config.md) | 配置文件、API、显示端状态、播放列表 |
| 提醒功能 | [reminder.md](spec/reminder.md) | 提醒数据结构、触发逻辑、定时检查 |
| 时间监听 | [timeListener.md](spec/timeListener.md) | 时间变化事件监听、事件类型、API接口 |
| 侧边栏导航 | [sidebar.md](spec/sidebar.md) | 侧边栏布局、面板切换、交互逻辑 |
| 控制端主题与 UI 控件分类 | [ui-theme.md](spec/ui-theme.md) | 主题持久化、主题应用和控件语义标记伪代码 |
| 媒体库 | [media-library.md](spec/media-library.md) | 媒体库提供者、管理器、前端模块实现 |
| 聊天系统 | [chat-system.md](spec/chat-system.md) | 群聊/私聊、AI助手、系统指令、语音播报 |
| 语音命令 | [voiceCommand.md](spec/voiceCommand.md) | 语音状态显示、提醒、报时、搜索、AI助手响应 |
| AASC系统 | [aasc.md](spec/aasc.md) | 消息总线、执行者模型、消息路由、消息过滤 |
| Auto-Brain | [auto-brain.md](spec/auto-brain.md) | 独立分层决策流程、策略草案把关、AASC 主题协作 |
| 分层架构 | [layered-architecture.md](spec/layered-architecture.md) | 分层装配流程、依赖约束、模块组装伪代码 |
| DataSnapshot | [data-snapshot.md](spec/data-snapshot.md) | 数据快照、IFile/IFileSystem接口、RealFileSystem/JsonFile实现 |
| ViewBind | [viewbind.md](spec/viewbind.md) | 视图绑定、数据驱动UI更新、与DataSnapshot集成 |
| 显示端选择 | [display-selection.md](spec/display-selection.md) | 单选、全选、自适应选择模式 |
| 设备列表 | [device-list.md](spec/device-list.md) | 设备列表组件，合并 DisplayList 和 DeviceTree |
| 设备树 | [device-tree.md](spec/device-tree.md) | 树状结构设备列表（已合并到 device-list） |
| 地图可视化 | [map-visualization.md](spec/map-visualization.md) | 执行者能力可视化、PixiJS渲染器、数据模型 |
| 子服务器管理 | [sub-server.md](spec/sub-server.md) | 子服务器分发器、负载均衡、健康检查 |
| 本地语音识别 | [sherpa-asr.md](spec/sherpa-asr.md) | sherpa-onnx-wasm懒加载、流式识别、服务端兜底 |
| 服务端 TTS | [tts.md](spec/tts.md) | TTS 请求超时、pipeline 写盘、失败文件回收 |
| 独立 Android 离线语音识别 APK | [android-asr-apk.md](../3rd/tts-server/docs/spec/android-asr-apk.md) | SenseVoice 模型、音频输入、识别耗时和 HTTP 服务伪代码 |
| Linux TTS 服务 | [tts-linux.md](spec/tts-linux.md) | Linux Embedded Speech TTS HTTP 服务、队列与独立运行时路径 |
| 独立 Android 离线 TTS APK | [android-offline-tts-apk.md](../3rd/tts-server/docs/spec/android-offline-tts-apk.md) | 内置模型离线合成、WAV 播放和耗时显示伪代码 |
| Android TTS CPU 核心模式 | [android-tts-cpu-affinity.md](../3rd/tts-server/docs/spec/android-tts-cpu-affinity.md) | CPU 核心识别、JNI affinity、回退和状态显示伪代码 |
| 语音显示端 | [voice-display.md](spec/voice-display.md) | Go实现纯语音交互显示端、ASR、音频播放 |
| 显示端UI旋转 | [display-ui-rotation.md](spec/display-ui-rotation.md) | UI四角布局、旋转重力方向调整、设备事件防抖 |
| 显示端分布式能力 | [display-capability.md](spec/display-capability.md) | 显示端能力声明、能力路由、能力编辑 |
| 日志筛选与系统监控 | [log-viewer.md](spec/log-viewer.md) | 结构化日志缓冲区、多维度筛选、CPU/内存监控 |
| 日志大脑 | [log-brain.md](spec/log-brain.md) | 日志摘要、记忆体构建、LLM判断上下文接口 |
| 资源目录 | [resource-layout.md](spec/resource-layout.md) | 资源路径规范、目录整理、清理伪代码 |
| 工程目录结构 | [project-structure.md](spec/project-structure.md) | 目录扫描、分类归位、文档索引同步伪代码 |
| 远程任务系统 | [remote-task-system.md](spec/remote-task-system.md) | 远程 JS 代码执行、任务生命周期、三种运行时 |
| 上传功能 | [upload.md](spec/upload.md) | 普通上传 + 临时模式 base64 中转 |
| test-echo 用户任务 | [test-echo.md](spec/test-echo.md) | 测试用户任务参数定义与读取流程 |
| WebGPU 用户任务 | [webgpu-render.md](spec/webgpu-render.md) | 显示端 WebGPU 渲染图片并持久化到服务端 |
| Android GPU Compute 桥 | [android-compute-bridge.md](spec/android-compute-bridge.md) | 离屏 EGL 3.1 compute、SSBO/image2D 读回、NativeCompute JS 封装 |
| Android 显示端 | [android-display.md](spec/android-display.md) | APK WebView 显示端、Intent 注入服务器地址与自动连接 |
| Android 原生语音识别 | [android-native-asr.md](spec/android-native-asr.md) | sherpa-onnx AAR 原生推理、模型按需下载、服务器中转接入 |
| Android 原生语音生成 | [android-native-tts.md](spec/android-native-tts.md) | Embedded Speech 离线合成 Xiaoxiao、模型按需下载、显示端生成与回退伪代码 |
| Android 原生声纹识别 | [voiceprint.md](spec/voiceprint.md) | 说话人识别、多人分割、服务器权威库、声纹门控 |
| 独立 Android 声纹对比测试 APK | [android-voiceprint-test-apk.md](spec/android-voiceprint-test-apk.md) | APK HTTP 网页、Sherpa 声纹和流式 ASR 接口伪代码 |
| 3D 视图 | [viewer3d.md](spec/viewer3d.md) | 执行者 3D 可视化、动画循环、场景管理 |
| 显示端睡眠模式 | [display-sleep-mode.md](spec/display-sleep-mode.md) | 时段判定/媒体遮罩/深度 UI 遮罩/临时激活/控制端配置 |
| 音频媒体播放 | [audio-media.md](spec/audio-media.md) | audio 类型识别、服务器 MIME/WS、显示端播放与批量控制 |
| 纯文本分页 TTS 播放 | [text-media.md](spec/text-media.md) | txt/md 分页、显示端分句、单句 TTS 协议与批量控制伪代码 |
| 文本 TTS 路由与批量类型筛选 | [text-media-routing.md](spec/text-media-routing.md) | 批量类型上报、服务器筛选、手动语音路由和预生成伪代码 |
| AI 执行规则 | [ai-rules.md](spec/ai-rules.md) | 工作 AI 重启服务器时仅允许使用控制端接口 |
| 服务器重启命令 | [server-restart-script.md](spec/server-restart-script.md) | 原生 HTTP/HTTPS 调用控制端重启接口 |
| 工作 AI 角色 | [ai-roles.md](spec/ai-roles.md) | 控制端 AI 角色、角色定义自管理与任务历史 |
| LLM 配置 Agent 模式 | [llm-agent-mode.md](spec/llm-agent-mode.md) | 普通 LLM profile 的 Pi RPC 分流、历史隔离与只读权限伪代码 |
| 动态画面填充模式 | [dynamic-fit-mode.md](spec/dynamic-fit-mode.md) | 动态阶段控制器、显示端动画与控制协议伪代码 |

## 核心模块

| 模块 | 文件 | 说明 |
|------|------|------|
| 服务器 | src/apps/server/boot/server-app.js | Express + WebSocket 主入口 |
| 配置 | src/apps/server/modules/config/config-app-service.js | 配置加载、保存、获取 |
| 连接 | src/framework/transport/ws/connection.js | WebSocket 连接管理 (备用) |
| 时间监听 | src/apps/web-mediacenter/modules/time/time-listener-app-service.js | 时间变化事件监听 |
| 提醒 | src/apps/web-mediacenter/modules/reminder/reminder-app-service.js | 提醒逻辑处理 |
| TTS | src/external/tts/tts-service.js | 语音合成功能 |
| 聊天 | src/external/llm/llm-service.js | AI 聊天功能 |
| 整点报时 | src/apps/web-mediacenter/modules/time/time-announce-app-service.js | 整点报时功能 |
| 语音命令 | src/apps/web-mediacenter/modules/voice/voice-command-app-service.js | 语音命令处理模块 |
| 媒体库 | src/apps/web-mediacenter/modules/media/media-library-app-service.js | 媒体库管理和多源访问 |
| 子服务器 | src/framework/cluster/sub-server-manager.js | 子服务器管理、负载均衡 |
| 日志缓冲区 | src/framework/observability/log-buffer.js | 结构化日志存储和筛选 |
| 系统监控 | src/framework/observability/system-monitor.js | CPU和内存监控数据采集 |
| 任务引擎 | src/apps/server/modules/task-engine/task-manager.js | 远程任务生命周期管理、分支分发 |

## 前端模块

| 模块 | 文件 | 说明 |
|------|------|------|
| 控制端主页面 | src/apps/web-mediacenter/ui/public/upload.html | 控制端界面，包含侧边栏导航 |
| 显示端主页面 | src/apps/web-mediacenter/ui/public/display.html | 显示端界面 |
| WebSocket 客户端 | src/apps/web-mediacenter/ui/public/js/websocket.js | WebSocket 连接管理 |
| 控制逻辑 | src/apps/web-mediacenter/ui/public/js/controls.js | 播放控制、画面控制 |
| 裁剪功能 | src/apps/web-mediacenter/ui/public/js/crop.js | 裁剪框拖拽、缩放 |
| 媒体库 | src/apps/web-mediacenter/ui/public/js/media-library.js | 媒体库列表、文件管理、播放控制 |
| 提醒界面 | src/apps/web-mediacenter/ui/public/js/reminder.js | 提醒管理界面 |
| 聊天界面 | src/apps/web-mediacenter/ui/public/js/chat.js | AI 聊天界面 |
| 搜索界面 | src/apps/web-mediacenter/ui/public/js/search.js | 搜索历史管理、手动搜索 |
| 主入口 | src/apps/web-mediacenter/ui/public/js/main.js | 初始化、导航切换 |
| 上传功能 | [upload.md](spec/upload.md) | 普通上传 + 临时模式 base64 中转 |
| 显示端列表 | src/apps/web-mediacenter/ui/public/js/device-list.js | 设备列表组件，支持列表/树形视图切换 |
| TTS控制 | src/apps/web-mediacenter/ui/public/js/tts.js | TTS 前端控制 |
| 本地ASR | src/apps/web-mediacenter/ui/public/js/sherpa-asr.js | sherpa-onnx-wasm 本地语音识别 |
| Toast提示 | src/apps/web-mediacenter/ui/public/js/toast.js | 消息提示组件 |
| 日志查看器 | src/apps/web-mediacenter/ui/public/js/log-viewer.js | 日志筛选、系统监控显示 |
| 远程任务面板 | src/apps/web-mediacenter/ui/public/js/task-panel.js | 远程任务提交、实时日志、实例列表 |

## 配置文件

| 文件 | 说明 |
|------|------|
| config/config.json | 主配置文件 (服务器端口、TTS 等静态配置) |
| ~/.config/aasc-user/userconfig.json | 私人运行状态 (显示端播放状态、设备语音事件) |
| ~/.config/aasc-user/chat-history.json | 聊天历史记录 |
| ~/.config/aasc-user/media-libraries.json | 媒体库配置 |
| ~/.config/aasc-user/reminders.json | 提醒数据 |

## 数据流

```
控制端 (upload.html)
    ↓ WebSocket (/control)
服务器 (server.js)
    ↓ WebSocket (/display)
显示端 (display.html)

远程任务数据流:
控制端 → task:submit → 服务器 TaskManager → NodeJsRunner/PuppeteerRunner/显示端
                                                    ↓
                              task:progress / task:log / task:result → 控制端
```

## 消息流程

1. **控制端发送媒体**
   - 控制端调用 `WebSocketManager.sendMedia()`
   - 服务端接收并转发到指定显示端
   - 显示端接收并播放媒体

2. **控制端发送控制指令**
   - 控制端调用 `WebSocketManager.sendControl()`
   - 服务端更新显示端状态
   - 服务端转发指令到显示端

3. **提醒触发**
   - 服务端定时检查提醒
   - 触发时发送消息到所有显示端
   - 显示端播放语音/显示弹窗

## 页面结构

### 控制端 (upload.html)

```
侧边栏 (60px)
├── 媒体管理 (media)
│   ├── 显示端选择
│   ├── 上传文件
│   ├── URL上传
│   └── 服务器资源
├── 显示控制 (display)
│   ├── 显示端选择
│   ├── 画面填充
│   ├── 播放控制
│   ├── 音量控制
│   ├── TTS播报
│   ├── 整点报时设置
│   └── 画面裁剪
├── 提醒设置 (reminder)
│   ├── 提醒表单
│   └── 提醒列表
├── AI助手 (chat)
│   └── 聊天界面
└── 远程任务 (task)
    ├── 任务类型/目标/环境选择
    ├── 文件上传
    ├── 实时日志
    └── 任务实例列表
```

### 显示端 (display.html)

```
全屏媒体展示
├── 图片/GIF显示
├── 视频播放
├── 提醒弹窗
└── 语音播报
```

## 技术栈

- **后端**: Node.js, Express, WebSocket (ws)
- **前端**: 原生 JavaScript, CSS3
- **存储**: JSON 文件
- **外部服务**: TTS API, AI Chat API

## 相关文档

| 文档 | 说明 |
|------|------|
| [design.md](design.md) | 项目设计文档索引 |
| [usage.md](usage.md) | 项目使用说明 |
| [rules.md](rules.md) | 代码规范、文件结构 |
| [todo.md](todo.md) | 项目未完成任务列表 |
