# 日志筛选与系统监控设计文档

## 功能需求

### 日志筛选
- 控制端日志面板支持多维度筛选
- 搜索框：输入搜索内容，筛选包含搜索内容的日志行
- 级别筛选：按日志级别筛选（错误、警告、信息、调试）
- 时间筛选：按时间范围筛选（最近10秒、1分钟、5分钟等）
- 设备筛选：按设备来源筛选（服务端、显示端、控制端）
- 标签筛选：按日志标签筛选（语音、TTS、连接等）

### 系统监控
- 控制端查看系统 CPU 使用率
- 控制端查看系统内存使用率
- 控制端查看进程内存占用
- 控制端查看堆内存使用情况
- 控制端查看系统和进程运行时间

## 架构设计

### 服务端
1. **LogBuffer** - 结构化日志缓冲区
   - 存储最近 N 条日志条目（默认1000条）
   - 每条日志包含：时间戳、类别、级别、设备来源、消息内容
   - 支持多维度筛选查询
   - 新日志通过监听器实时通知

2. **SystemMonitor** - 系统监控
   - 定时采集 CPU 和内存数据（默认5秒间隔）
   - CPU 使用率通过两次采样差值计算
   - 内存数据包含系统级和进程级
   - 新数据通过监听器实时通知

3. **API 端点**
   - `GET /api/logs` - 获取日志（支持筛选参数）
   - `GET /api/system-stats` - 获取系统监控数据

4. **WebSocket 推送**
   - `serverLog` - 实时推送新日志条目
   - `logHistory` - 控制端连接时推送日志历史
   - `systemStats` - 定时推送系统监控数据

### 客户端
1. **LogViewer** - 日志查看器组件
   - 系统状态面板（6个指标卡片）
   - 筛选工具栏（搜索框、级别/设备/标签筛选按钮、时间范围选择）
   - 日志条目列表（自动滚动、高亮搜索词、级别颜色编码）
   - 操作按钮（自动滚动、清除筛选、清空日志）

### 日志上报控制（新增）
控制端可分别控制**显示端**和**控制端自身**是否向服务器上报日志，以及上报级别阈值。

**级别阈值规则**：级别从高到低为 error > warn > info > debug，选择某级别即表示上报该级别及更高（更严重）级别的日志。
- 选 error → 仅上报 error
- 选 warn → 上报 error + warn
- 选 info → 上报 error + warn + info
- 选 debug → 全部上报

**消息类型**：
- `setLogReport` — 控制端 → 服务器，设置某类设备的日志上报策略
- `logReportConfig` — 服务器 → 显示端/控制端，转发日志上报配置
- `clientLog` — 显示端/控制端 → 服务器，按配置上报的日志条目
- `logReportConfigApplied` — 服务器 → 控制端，确认配置已应用

**控制端 console 拦截**：直接覆盖 `console.log`/`console.error` 等方法，拦截日志并发送到服务端。

### 消息链路追踪（新增）
通过 `correlationId` 将控制端→服务器→显示端→ACK 的完整消息链关联起来。

**correlationId 生成与传递**：
- 控制端发送 displayId 指定目标的消息时，服务器生成 `correlationId`（`type-timestamp-random`）
- 下行 `sendToDisplay()` 自动为消息注入 `correlationId`（如 `media-1712345678-a1b2`）
- 显示端收到消息后存储 `correlationId`，在 `commandAck` 中回传
- 服务器收到 `commandAck` 时以同一 `correlationId` 记录日志

**日志链示例**：
```
控制端 ⇒ display-1: media play "music"              ← 控制端发出（indent 0）
  服务端 ⇒ display-1: media action=play               ← 服务器转发（indent 1）
    display-1 ⇒ 服务端: ACK media ✓ success           ← 显示端确认（indent 2）
```

**LogViewer 渲染**：
- `_getArrowHtml`：显示 `source ⇒ target` 格式
- `_getIndentClass`：同 `correlationId` 的条目按到达顺序依次递增缩进深度

## 数据流

```
服务端 log() → LogBuffer.add() → 监听器 → broadcastToControls(serverLog)
                                          → TUI 显示

控制端连接 → 发送 logHistory → LogViewer.addHistory()

SystemMonitor 定时采集 → 监听器 → broadcastToControls(systemStats)
                                  → LogViewer.updateSystemStats()
```
