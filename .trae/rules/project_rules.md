# Web MediaCenter - 项目规则

## 项目概述

这是一个基于 WebSocket 的实时媒体展示控制系统，包含：
- **server.js**: Node.js 服务器 (Express + WebSocket)
- **public/upload.html**: 控制端页面
- **public/display.html**: 显示端页面

## 技术栈

- Node.js + Express
- WebSocket (ws 库)
- 原生 HTML/CSS/JavaScript (无框架)

## 开发命令

```bash
# 安装依赖
npm install

# 启动服务器
npm start

# 指定端口启动
PORT=3000 npm start
```

## 代码规范

### 命名约定

- 变量/函数: camelCase (如 `currentFit`, `applyCrop`)
- 常量: UPPER_SNAKE_CASE (如 `UPLOADS_DIR`)
- CSS 类: kebab-case (如 `.crop-box`, `.control-btn`)
- CSS ID: camelCase (如 `#mediaContainer`)

### 文件结构

- HTML 文件内嵌 CSS 和 JavaScript，不使用外部文件
- 按功能分组代码：状态管理 → DOM 元素 → 核心功能 → 事件处理 → 初始化
- 拆分代码为多个文件，每个文件负责一个功能模块
- 单个文件代码行数不超过 1000 行

### WebSocket 消息格式

所有消息使用 JSON 格式，包含 `type` 字段标识消息类型。

## 关键功能

### 画面适配模式

| 模式 | 说明 |
|------|------|
| contain | 适应屏幕，保持比例 |
| height | 高度铺满屏幕 |
| width | 宽度铺满屏幕 |
| crop | 裁剪模式，铺满屏幕 |

### 旋转处理

- 支持 0°、90°、180°、270°
- 旋转 90° 或 270° 时，height/width 模式效果互换

### 裁剪功能

- 裁剪区域使用百分比 (0-100)
- 裁剪框比例与显示端屏幕比例一致
- 只支持等比缩放

## 注意事项

1. 不使用 var，使用 const/let
2. 异步操作使用 async/await
3. 错误处理使用 try-catch
4. 避免全局变量污染
5. DOM 操作尽量批量处理
6. 每次对话完一定要更新todo.md，保持任务列表的最新状态
7. 更新代码前，一定要把实现方式更新到docs/spec/*.md中对应的位置

### 和用户对话时的注意事项
- 可以从docs/spec/*.md中查看项目实现文档
- 更新代码前，把实现方式更新到docs/spec/*.md中对应的位置
- 可以从todo.md中和已完成任务以及和已完成任务以及和需求相关的内容，比如配置路径、数据库连接等
- 把用户的问题更新到todo.md合适的位置，如果没有合适的位置，就新增一行，分析需求并记录
- 已完成todo.md中的任务，在最前面添加✅已完成标记，在下放记录和需求相关的内容，比如配置路径、数据库连接等
- todo.md 格式：
```
# 大模块
## 小模块
 - (✅已完成)任务描述
   - 任务实现代码
 - Bug 修复描述
```
