#skill: ai-code-translation

# 聊天式日志系统自测

## 模块
core

## 目标文件清单
- `src/framework/observability/log-buffer.js` // LogEntry 扩展
- `src/apps/server/boot/server-app.js` // logViewBind + handler

## 测试场景

### LogEntry 字段扩展

- logBuffer.add 传入 extra.correlationId → entry 中包含该字段
- logBuffer.add 传入 extra.scope → entry 中包含 scope
- 不传新字段 → entry 不变，向后兼容

### logViewBind 绑定

- 创建 logViewBind 后 logBuffer.onLogEntry 回调触发 viewbind.data 更新
- viewbind.data 变化触发 broadcastToControls

### 日志订阅 handler

- subscribeLog handler 更新 logViewBind.data.sessions
- setLogLevel handler 更新 logViewBind.data.filter.levels
- 过滤器生效后仅推送匹配级别的日志
