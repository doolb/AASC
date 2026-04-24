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

```text
web-mediacenter/
├── package.json                 # npm 配置
├── 3rd/                         # 第三方与子显示端程序
│   ├── voice-display/           # Go 子显示端
│   ├── voice-display-node/      # Node.js 子显示端
│   └── voice-display-cs/        # C# 子显示端
├── config/                      # 业务配置（json）
├── docs/                        # 项目文档（design/spec/task/todo）
├── res/                         # 统一资源目录（models/uploads/temp/certs）
├── skills/                      # 技能配置
├── src/                         # 分层代码主目录
│   ├── aasc/                    # AASC 消息总线与执行者
│   ├── auto-brain/              # Auto-Brain 决策分层模块
│   ├── core/                    # 核心能力层
│   ├── framework/               # 基础设施层
│   ├── external/                # 外部能力适配层
│   ├── scripts/                 # 工具脚本（测试/诊断/维护）
│   └── apps/                    # 应用层（服务端入口在 src/apps/server/boot/server-app.js）
└── node_modules/                # 依赖目录
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
