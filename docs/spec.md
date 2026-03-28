# Web MediaCenter - 项目实现文档

## 项目概述

基于 WebSocket 的实时媒体展示控制系统，采用客户端-服务器架构。

## 功能模块实现

| 模块 | 文档 | 说明 |
|------|------|------|
| HTTP API | [api.md](spec/api.md) | 文件上传、媒体管理、TTS、提醒等 API |
| WebSocket | [websocket.md](spec/websocket.md) | 连接处理、消息类型、广播函数 |
| 配置管理 | [config.md](spec/config.md) | 配置文件、API、显示端状态 |
| 提醒功能 | [reminder.md](spec/reminder.md) | 提醒数据结构、触发逻辑 |
| 侧边栏导航 | [sidebar.md](spec/sidebar.md) | 侧边栏布局、交互逻辑 |

## 核心模块

| 模块 | 文件 | 说明 |
|------|------|------|
| 服务器 | server.js | Express + WebSocket 主入口 |
| 配置 | core/config.js | 配置加载、保存、获取 |
| 连接 | core/connection.js | WebSocket 连接管理 |
| 提醒 | core/reminder.js | 提醒逻辑处理 |
| TTS | core/tts.js | 语音合成 |
| 聊天 | core/chat.js | AI 聊天功能 |
| 整点报时 | core/timeAnnounce.js | 整点报时功能 |

## 前端模块

| 模块 | 文件 | 说明 |
|------|------|------|
| 控制端主页面 | public/upload.html | 控制端界面 |
| 显示端主页面 | public/display.html | 显示端界面 |
| WebSocket 客户端 | public/js/websocket.js | WebSocket 连接管理 |
| 控制逻辑 | public/js/controls.js | 播放控制、画面控制 |
| 裁剪功能 | public/js/crop.js | 裁剪框拖拽、缩放 |
| 媒体列表 | public/js/media-list.js | 媒体列表渲染 |
| 提醒界面 | public/js/reminder.js | 提醒管理界面 |
| 聊天界面 | public/js/chat.js | AI 聊天界面 |
