# Android Termux 服务器节点设计

## 功能状态

当前已完成一次 Termux 试运行验证，目标设备为 Android 9、arm64、Termux 0.118.3。AASC 服务以独立 Termux 服务运行，暂不包含 ASR 原生模块和 TTS Wine 服务。

## 目标

将现有 Node.js 服务器以 Termux 节点方式部署到 Android 设备，使每台 Android 设备都能独立提供 HTTP、HTTPS、WebSocket、媒体管理和显示端连接能力，并为后续主服务器统一管理多个 Android 节点保留入口。

## 架构

```text
Android 设备
└── Termux
    ├── Node.js Runtime
    ├── AASC Server
    ├── runit/aasc-server 服务监督
    ├── AASC HTTPS :8081（当前端口）
    └── Codex CLI（独立开发工具）
```

试运行阶段保留现有服务器代码，使用独立目录 `~/aasc-server-test`。初始试运行曾使用 18081 端口，因设备原有 code-server 占用 8081；本次已停止并禁用 code-server 自动启动，AASC 已切换到 8081，18081 已释放。正式部署时再把目录、端口和节点身份改为可配置项。

## 运行边界

### 已验证

- Express HTTPS 服务启动
- 静态控制端 `/upload` 返回 200
- 静态显示端 `/display` 返回 200
- `/api/status` 返回服务状态
- 局域网通过 `https://192.168.1.6:8081` 访问
- runit 服务监督可以在无 SSH 前台会话时保持进程运行
- code-server 已停止，runit `down` 标记已持久化，自动启动已禁用

### 暂不支持或待处理

- `sherpa-onnx-node` 未安装，服务端 ASR 不可用
- `tts-wine` 任务依赖 Linux/Wine，Android 节点启动时失败并记录日志
- Puppeteer 浏览器未下载，相关任务不可用
- Android 电池优化、Termux:Boot 和设备重启后的自动拉起尚未验收
- 主服务器节点注册、心跳、媒体同步和负载均衡尚未接入本次试运行

## 后续演进

1. 增加 `android-node` 运行配置，明确关闭 ASR、TTS Wine、Puppeteer 等不可用能力。
2. 增加节点 ID、主服务器地址、认证令牌和心跳协议。
3. 将现有 `SubServerManager` 从远程 URL 管理扩展为 Android 节点管理。
4. 增加媒体缓存/同步策略，避免每个节点依赖主服务器本地文件路径。
5. 使用 Termux:Boot 或定制 APK 完成设备重启后的自动恢复。
