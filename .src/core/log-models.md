#skill: ai-code-translation

# 聊天式日志系统 - 核心模型

## 模块
core

## 目标文件清单

- `src/framework/observability/log-buffer.js` // 扩展 LogEntry 字段 + 过滤条件
- `src/core/viewbind/ViewBind.js` // 绑定日志数据
- `src/core/viewbind/WSViewBindServer.js` // 注册日志订阅 handler
- `src/apps/server/boot/server-app.js` // 初始化 LogBufferViewBind

## 范围约束

- 不动 LogBuffer 现有 add/getEntries/notify 逻辑
- 只在 LogEntry 中新增 correlationId/scope/targetId 字段
- 不动现有 CATEGORY_LEVEL_MAP 和 CATEGORY_DEVICE_MAP
- 日志的 ViewBind 绑定作为增量推送通道，不替换现有 logHistory 全量推送

## 已有声明（真实路径与行号）

- `class LogBuffer` 位于 `src/framework/observability/log-buffer.js:43`
  - `buffer[]` // 环形缓冲区，默认 1000 条
  - `add(category, message, extra)` // line 50，返回 entry 含 { id, timestamp, time, category, level, device, message, displayId }
  - `getEntries(filters)` // line 71，支持 search/levels/devices/categories/timeRange 过滤
  - `listeners` 通知 // line 67 调用 _notify
  - `maxSize` 默认 1000 // line 45
- `class LogBrain` 位于 `src/framework/observability/log-brain.js`
- `logBuffer` 实例位于 `server-app.js:30`
- `logBrain` 实例位于 `server-app.js:32`
- `broadcastToControls` 位于 `server-app.js:1698`
- `wsServer` 位于 `server-app.js` // WSViewBindServer 实例
- `viewbind.connect`  // 复用 connect 机制

## 新增定义

`LogEntry` 新增字段：correlationId, scope, source, targetId  // 在现有 extra 参数中扩展
`LogScope { 'single', 'group' }`  // 单聊/群聊
`LogSession { sessionId, sourceId, targetId, scope }`  // 日志订阅会话
`LogBufferViewBind`  // 将 LogBuffer 与 ViewBind 绑定的适配概念

## 操作流程

### LogEntry 扩充

- LogBuffer.add 的 extra 参数新增支持：correlationId, scope, source, targetId
- 这些字段存入 LogEntry 对象 // 不影响现有 CATEGORY_LEVEL_MAP 映射
- LogEntry 现有字段不变：id, timestamp, time, category, level, device, message, displayId

### LogBufferViewBind 绑定

- 创建 logViewBind ViewBind 实例，data 初始为 { entries: logBuffer.buffer, filter: { levels: [], devices: [] }, activeSessions: [] }
- 注册 logBuffer listener：新日志到达时 logViewBind.data.entries.push(entry) → 自动触发广播
- logViewBind 绑定回调：data 变化时 broadcastToControls({ type: 'logUpdate', entries: 增量条目 })
- logViewBind.connect 可选：设置后日志变化自动同步到远端

### 单聊模式

- 控制端选择设备 → wsServer 注册 'subscribeLog' handler → 创建 LogSession { targetId, scope: 'single' }
- 控制端断开时 → wsServer.handleControlDisconnect 中清理关联的 LogSession

### 群聊模式

- 操作入口生成 correlationId（如 uuid）
- 调用 log 时传入 extra.correlationId 和 extra.scope
- 控制端按 correlationId 聚合展示，形成链路追踪

### 控制端日志推送

- 现有：控制端连接时发送 logBuffer.getEntries({ limit: 200 }) 全量推送
- 新增：LogBufferViewBind 增量推送，仅发送新增条目
- 控制端设过滤器 → 发送 { type: 'setLogLevel', levels: ['warn','error'] } → 服务端更新 logViewBind.data.filter → 日志按 filter 重推
