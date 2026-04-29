#skill: ai-code-translation

# 聊天式日志系统应用集成

## 模块
app

## 目标文件清单

- `src/apps/server/boot/server-app.js` // 创建 logViewBind + 注册日志 handler + 关联 logBuffer
- `src/framework/observability/log-buffer.js` // LogEntry 新增字段支持

## 范围约束

- 不改 LogBuffer 核心逻辑（add/getEntries/notify）
- 不改控制端现有 logHistory 推送
- logViewBind 增量推送作为补充通道，不替换全量推送

## 已有声明（真实路径与行号）

- `logBuffer` 实例位于 `server-app.js:30`
- `logBuffer.onLogEntry(callback)` // 注册日志监听
- `wsServer` 位于 `server-app.js` // WSViewBindServer 实例
- `wsServer.registerHandler` // 注册日志订阅 handler
- `wsServer.handleControlConnect(ws)` // 控制端连接时调用
- `broadcastToControls` 位于 `server-app.js:1698`
- `ViewBind` 来自 `src/core/viewbind/ViewBind.js`

## 操作流程

### 初始化日志系统（在 wsServer 创建后）

- 创建 logViewBind = new ViewBind({ entries: logBuffer.buffer, filter: { levels: [], devices: [] }, sessions: [] })
- logViewBind 绑定回调：data 变化时 → 提取 entries 增量 → broadcastToControls({ type: 'logUpdate', entries: 新增条目 })
- 注册 logBuffer.onLogEntry：新日志到达 → 检查 filter → 若匹配则更新 logViewBind.data

### 注册日志 handler

- 'subscribeLog' handler：创建 LogSession，加入 logViewBind.data.sessions
  - 单聊时 targetId 为指定显示端 ID
- 'unsubscribeLog' handler：从 sessions 中移除
- 'setLogLevel' handler：更新 logViewBind.data.filter.levels → 触发重推

### 控制端连接

- 现有：发送 logBuffer.getEntries({ limit: 200 }) 全量 + categories
- 保持不动 // 兼容旧控制端

### 调用方改造：需传入 correlationId 的场景

- 控制端→服务端→显示端的操作（如 media, control 命令）
- 在控制端 WS 消息处理中，若消息不含 correlationId 则自动生成
- 调用 log() 时传入 extra.correlationId 和 extra.scope

### LogEntry 扩充（最小改动）

- LogBuffer.add 中 extra 的 device 和 displayId 已支持
- 新增 extra 字段支持：correlationId, scope, source, targetId
- 若 extra 中有这些字段，entry 中保留 // 无则跳过，不影响现有调用
