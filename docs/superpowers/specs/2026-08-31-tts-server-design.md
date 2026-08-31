# tts.server 内置 TTS 服务设计

## 目标

创建一个名为 `tts.server` 的 server service 内置任务。任务实例在本机启动一个与现有 TTS 客户端兼容的 HTTP 服务，实例参数选择 `wine` 或 `linux` 并配置监听端口；主服务器继续通过通用 `serviceUrl` 调用，不直接耦合 Wine/Linux 合成实现。

## 约束

- 默认引擎为 `wine`，不依赖 Win7 虚拟机或 `192.168.1.16`。
- 默认监听 `127.0.0.1:3001`，端口保存于实例参数，可修改。
- 自动启动只依赖任务系统恢复一个状态为 `running` 的 `tts.server` 实例，不再新增第二个引擎任务。
- 本阶段不打开 `tts.serverEnabled`；显示端 TTS 失败时不自动回退到本机 TTS 服务。

## 数据流

```text
任务系统恢复 tts.server 实例
    -> tts.server 读取 params.engine/params.port
    -> 启动 tts-wine.js 或 tts-linux.js 子进程
    -> 健康检查 http://127.0.0.1:<port>/api/tts/status
    -> 更新主服务器通用 TTS serviceUrl
主服务器 TTS 客户端
    -> POST http://127.0.0.1:<port>/api/tts
```

## 生命周期

- `run(context)` 校验引擎和端口，构造仓库内运行时路径，启动 HTTP 子进程并等待服务监听。
- Wine 使用 `3rd/tts-server/tts-wine.js`，复用 `wine/runtime/prefix`、`wine/bin/worker_tts_windows.exe` 和 `models/extracted`。
- Linux 使用 `3rd/tts-server/tts-linux.js`，显式传入 `models/extracted`；Linux 是否支持 AVX 由底层合成请求结果决定，本阶段不把 Linux 设为默认。
- 服务就绪后通过任务上下文回调更新主服务器的通用 `serviceUrl`，不修改 `tts.serverEnabled`。
- `stop()` 发送 SIGTERM，必要时 SIGKILL，清理健康检查计时器并恢复启动前的通用 URL。
- 子进程异常退出只记录服务错误并更新 widget，不触发无限重启。

## 单实例与自动恢复

任务目标为 `server` 且模式为 `service`，任务系统已有的同名 server service scope 会停止旧实例，因此只保留一个运行中的 `tts.server` 实例。持久化实例写入 `res/tasks/tts.server/results/index.json`，状态为 `running` 时由 `restoreAutoStartServices()` 自动恢复。
