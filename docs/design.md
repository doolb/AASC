# Web MediaCenter - 项目设计文档

## 项目概述

基于 WebSocket 的实时媒体展示控制系统，支持多显示端连接和统一控制。

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                        Server (server.js)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Express   │  │  WebSocket  │  │  File Management    │  │
│  │   HTTP API  │  │   Server    │  │  (uploads/)         │  │
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
| 显示端 | [display.md](design/display.md) | 媒体展示、画面适配、旋转裁剪 |
| 控制端 | [control.md](design/control.md) | 媒体管理、显示控制、裁剪预览 |
| 媒体库 | [media-library.md](design/media-library.md) | 多媒体库管理、多协议支持、文件操作 |
| 提醒功能 | [reminder.md](design/reminder.md) | 定时提醒、语音播报、弹窗提示 |
| 聊天系统 | [chat-system.md](design/chat-system.md) | 群聊/私聊、AI助手、系统指令、语音播报 |
| WebSocket | [websocket.md](design/websocket.md) | 通信协议、消息类型 |
| AASC架构 | [aasc.md](design/aasc.md) | 消息总线架构、执行者模型、用户模型、能力继承 |
