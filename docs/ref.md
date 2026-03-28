# Web MediaCenter - 项目参考文档

## 技术栈

### 后端
- [Node.js](https://nodejs.org/) - JavaScript 运行时
- [Express](https://expressjs.com/) - Web 框架
- [ws](https://github.com/websockets/ws) - WebSocket 实现

### 前端
- 原生 HTML/CSS/JavaScript (无框架)

## 外部资源

### WebSocket
- [WebSocket API - MDN](https://developer.mozilla.org/zh-CN/docs/Web/API/WebSocket)
- [ws 库文档](https://github.com/websockets/ws/blob/master/doc/ws.md)

### Express
- [Express 中文文档](https://www.expressjs.com.cn/)
- [Express API 参考](https://expressjs.com/en/4x/api.html)

### 文件上传
- [multer](https://github.com/expressjs/multer) - Express 文件上传中间件

### TTS 语音服务
- 项目使用自定义 TTS 服务生成语音
- 配置项：语音服务地址、端口

## 设计模式

### 客户端-服务器架构
```
Control UI (控制端) <--WebSocket--> Server <--WebSocket--> Display (显示端)
```

### 消息模式
- **请求-响应**: 控制端发送指令，服务器转发到显示端
- **推送**: 服务器主动推送状态更新到控制端
- **广播**: 服务器向所有显示端广播消息

### 状态管理
- 服务器维护所有显示端状态
- 控制端通过 WebSocket 同步状态
- 状态持久化到 JSON 文件

## 项目文件结构

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
│   ├── showinfo.html
│   └── upload.html
├── uploads/            # 上传文件存储
└── docs/               # 文档
    ├── design.md       # 设计文档
    ├── spec.md         # 实现文档
    ├── todo.md         # 任务列表
    ├── usage.md        # 使用说明
    ├── rules.md        # 代码规范
    ├── ref.md          # 参考文档
    ├── design/         # 模块设计文档
    ├── spec/           # 模块实现文档
    └── ref/            # 参考代码
```

## 相关参考代码

| 文件 | 说明 |
|------|------|
| docs/ref/search.js | 搜索功能参考代码 |
| docs/ref/smb2.js | SMB2 文件共享参考代码 |

## 常见问题

### WebSocket 连接问题
- 检查防火墙是否允许 WebSocket 连接
- 确认服务器端口正确
- 查看浏览器控制台错误信息

### 媒体播放问题
- 确认媒体格式受浏览器支持
- 检查文件路径是否正确
- 查看网络请求是否成功

### TTS 语音问题
- 确认 TTS 服务地址配置正确
- 检查 TTS 服务是否运行
- 查看服务器日志错误信息
