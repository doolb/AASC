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
| 媒体库 | [media-library.md](spec/media-library.md) | 媒体库提供者、管理器、前端模块实现 |
| 聊天系统 | [chat-system.md](spec/chat-system.md) | 群聊/私聊、AI助手、系统指令、语音播报 |
| 语音命令 | [voiceCommand.md](spec/voiceCommand.md) | 语音状态显示、提醒、报时、搜索、AI助手响应 |
| AASC系统 | [aasc.md](spec/aasc.md) | 消息总线、执行者模型、消息路由、消息过滤 |
| DataSnapshot | [data-snapshot.md](spec/data-snapshot.md) | 数据快照、IFile/IFileSystem接口、RealFileSystem/JsonFile实现 |
| ViewBind | [viewbind.md](spec/viewbind.md) | 视图绑定、数据驱动UI更新、与DataSnapshot集成 |
| 显示端选择 | [display-selection.md](spec/display-selection.md) | 单选、全选、自适应选择模式 |

## 核心模块

| 模块 | 文件 | 说明 |
|------|------|------|
| 服务器 | server.js | Express + WebSocket 主入口 |
| 配置 | core/config.js | 配置加载、保存、获取 |
| 连接 | core/connection.js | WebSocket 连接管理 (备用) |
| 时间监听 | core/timeListener.js | 时间变化事件监听 |
| 提醒 | core/reminder.js | 提醒逻辑处理 |
| TTS | core/tts.js | 语音合成 |
| 聊天 | core/chat.js | AI 聊天功能 |
| 整点报时 | core/timeAnnounce.js | 整点报时功能 |
| 语音命令 | core/voiceCommand.js | 语音命令处理模块 |

## 前端模块

| 模块 | 文件 | 说明 |
|------|------|------|
| 控制端主页面 | public/upload.html | 控制端界面，包含侧边栏导航 |
| 显示端主页面 | public/display.html | 显示端界面 |
| WebSocket 客户端 | public/js/websocket.js | WebSocket 连接管理 |
| 控制逻辑 | public/js/controls.js | 播放控制、画面控制 |
| 裁剪功能 | public/js/crop.js | 裁剪框拖拽、缩放 |
| 媒体库 | public/js/media-library.js | 媒体库列表、文件管理、播放控制 |
| 提醒界面 | public/js/reminder.js | 提醒管理界面 |
| 聊天界面 | public/js/chat.js | AI 聊天界面 |
| 搜索界面 | public/js/search.js | 搜索历史管理、手动搜索 |
| 主入口 | public/js/main.js | 初始化、导航切换 |
| 上传功能 | public/js/upload.js | 文件上传处理 |
| 显示端列表 | public/js/display-list.js | 显示端选择器 |
| TTS控制 | public/js/tts.js | TTS 前端控制 |
| Toast提示 | public/js/toast.js | 消息提示组件 |

## 配置文件

| 文件 | 说明 |
|------|------|
| config/config.json | 主配置文件 (服务器端口、TTS、显示端状态) |
| config/chat-history.json | 聊天历史记录 |
| config/media-libraries.json | 媒体库配置 |
| config/reminders.json | 提醒数据 |

## 数据流

```
控制端 (upload.html)
    ↓ WebSocket (/control)
服务器 (server.js)
    ↓ WebSocket (/display)
显示端 (display.html)
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
└── AI助手 (chat)
    └── 聊天界面
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
