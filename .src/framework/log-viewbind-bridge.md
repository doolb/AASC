#skill: ai-code-translation

# 日志系统 ViewBind 桥接

## 模块
framework

## 目标文件清单

- `src/framework/observability/log-buffer.js` // LogEntry 添加新字段
- `src/core/viewbind/ViewBind.js` // 创建 logViewBind 实例
- `src/apps/server/boot/server-app.js` // 集成日志初始化

## 范围约束

- LogBuffer.add 接口不变，extra 参数扩展
- LogBuffer.notify 机制不变
- ViewBind 绑定不替换现有 logBuffer.onLogEntry 监听
- 控制端 logHistory 全量推送保留（兼容旧控制端）

## 已有声明（真实路径与行号）

- `class LogBuffer` 位于 `src/framework/observability/log-buffer.js:43`
  - `add(category, message, extra)` // line 50，extra 当前已支持 device, displayId
  - `_notify(entry)` // line 67，通知 listeners
  - `listeners` // Set<Function>
- `logBuffer` 实例位于 `server-app.js:30`
- `broadcastToControls` 位于 `server-app.js:1698`
- `wsServer.handleControlConnect` // 控制端连接时发送 logHistory
- `wsServer.registerHandler` // 注册日志相关 handler
- `ViewBind` 来自 `src/core/viewbind/ViewBind.js`

## 新增定义

无  // 不新增独立类，在 server-app.js 中内联创建 logViewBind 实例并绑定

## 操作流程

### LogEntry 新增字段

- LogBuffer.add 的 extra 参数新增支持传入：correlationId, scope, source, targetId
- entry 对象中若有这些字段则保留，无则跳过 // 向后兼容
- 现有 CATEGORY_LEVEL_MAP 和 CATEGORY_DEVICE_MAP 不动

### logViewBind 初始化

- 在 wsServer 创建后，创建 ViewBind 实例
- viewbind.data = { entries: logBuffer.buffer, filter: { levels: [], devices: [] }, sessions: [] }
- 注册 logBuffer listener：新日志到达时，viewbind.data = { ...viewbind.data, entries: [...viewbind.data.entries, newEntry] }
  - 若 filter.levels 非空，只推送匹配 level 的条目
  - viewbind.data 变化通过 data setter 自动触发广播

### 控制端日志订阅

- 'subscribeLog' handler：接收 { targetId, scope } → 创建 LogSession → 加入 viewbind.data.sessions
- 'unsubscribeLog' handler：接收 { targetId } → 从 sessions 中移除
- 'setLogLevel' handler：接收 { levels } → 更新 filter.levels → 触发重推

### 控制端连接

- 现有：连接时发送 logBuffer.getEntries({ limit: 200 }) 全量
- 保留此逻辑，增量推送作为补充

### 日志链路追踪

- 控制端→服务端→显示端的操作在入口生成 correlationId
- 示例：控制端播放媒体时生成 correlationId → sendToDisplay 携带 → 显示端日志携带同一 ID
- 控制端按 correlationId 聚合展示群聊链路
