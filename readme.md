# Web MediaCenter

基于 WebSocket 的实时媒体展示控制系统，支持多显示端连接和统一控制。

## 功能特性

- 多显示端支持：支持多个显示设备同时连接
- 实时控制：通过 WebSocket 实现低延迟的实时控制
- 媒体管理：支持图片、GIF、视频的上传和播放
- 画面适配：支持多种画面填充模式（适应、高度铺满、宽度铺满、裁剪）
- 旋转裁剪：支持 0°、90°、180°、270° 旋转和实时裁剪
- 定时提醒：支持临时提醒和每天提醒，语音播报和弹窗提示
- AI 助手：内置 AI 聊天助手功能（基于 OpenAI API）

## 外部依赖
- 语音生成：可使用 balcon 程序 （windows 系统）本地生成语音
- 语言模型：可使用 MNN chat （android 系统）本地运行

## 快速开始

### 安装依赖

```bash
npm install
```

### 启动服务器

```bash
npm start
```

### 访问界面

- 控制端：`http://<服务器IP>:8081/upload`
- 显示端：`http://<服务器IP>:8081/display`

## 项目结构

```
web-mediacenter/
├── server.js           # 服务器入口
├── package.json        # 项目配置
├── config/             # 配置文件目录
│   ├── config.json     # 主配置
│   ├── chat-history.json
│   ├── media-libraries.json
│   └── reminders.json
├── core/               # 核心模块
│   ├── chat.js
│   ├── config.js
│   ├── connection.js
│   ├── media.js
│   ├── reminder.js
│   ├── timeAnnounce.js
│   └── tts.js
├── public/             # 静态文件
│   ├── css/
│   ├── js/
│   ├── display.html
│   └── upload.html
├── uploads/            # 上传文件存储
└── docs/               # 文档
    ├── design.md       # 设计文档索引
    ├── spec.md         # 实现文档索引
    ├── todo.md         # 任务列表
    ├── usage.md        # 使用说明
    ├── rules.md        # 代码规范
    └── ref.md          # 参考文档
```

## 文档

| 文档 | 说明 |
|------|------|
| [docs/design.md](docs/design.md) | 项目设计文档索引 |
| [docs/spec.md](docs/spec.md) | 项目实现文档索引 |
| [docs/usage.md](docs/usage.md) | 使用说明 |
| [docs/rules.md](docs/rules.md) | 代码规范 |
| [docs/todo.md](docs/todo.md) | 未完成任务列表 |

## 技术栈

- Node.js + Express
- WebSocket (ws 库)
- 原生 HTML/CSS/JavaScript

## 浏览器兼容性

| 浏览器 | 最低版本 |
|--------|----------|
| Chrome | 80+ |
| Firefox | 75+ |
| Safari | 13+ |
| Edge | 80+ |

## 许可证

MIT
