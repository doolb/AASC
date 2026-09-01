# Chat2API 简洁日志记录 sessionId

## 任务描述

在 Chat2API 原始流量日志的简洁模式中显示当前 Provider 会话 ID，便于确认普通聊天、群聊和私聊实际复用的上游会话。日志只允许输出会话标识，不扩大敏感信息记录范围。

## design 需求

- 简洁模式从请求体和响应体中的已知会话字段提取统一的 `sessionId`。
- 兼容 `session_id`、`sessionId`、`chat_session_id`、`chatSessionId`、`conversation_id`、`conversationId`、`dialog_id` 和 `dialogId`，并支持约定的嵌套会话对象。
- 普通响应和 SSE/压缩 SSE 都应在存在会话 ID 时记录；没有会话 ID 时不输出空字段。
- 完整模式的原始日志格式保持不变。

## spec 设计

```text
compact request:
    data = { model, text }
    sessionId = extractSessionId(request.data) 或 context.sessionId
    如果 sessionId 非空:
        data.sessionId = sessionId
    emit request data

compact response:
    data = { output }
    sessionId = extractSessionId(response.data 或 SSE 事件)
    如果 sessionId 非空:
        data.sessionId = sessionId
    emit response data
```

## 受影响的功能模块和代码

- `src/apps/server/modules/chat2api/chat2api-raw-traffic-logger.js`
- `src/apps/server/modules/chat2api/chat2api-raw-traffic-logger.test.js`
- `src/apps/server/modules/chat2api/chat2api-provider-adapters.test.js`
- `docs/design/chat2api-raw-traffic-log-modes.md`
- `docs/spec/chat2api-raw-traffic-log-modes.md`

## 自测用例

- 简洁模式请求和普通响应均含 `session_id` 时，request/response 都记录统一的 `sessionId`。
- 简洁模式 SSE 含会话字段时，结束记录带 `sessionId` 且仍只产生一条 response。
- 没有会话字段时不输出 `sessionId: ""`。
- 完整模式不改变原有记录结构。

## 兼容性测试

- 标准 choices 响应、Qwen `data.messages` 响应、gzip SSE。
- 不同 Provider 使用不同命名的会话字段。

## 性能测试

- 只遍历预定义会话字段和有限嵌套对象，不记录或复制完整请求/响应。
- SSE 继续复用现有的受 `maxBytes` 限制的内存聚合。

## 风险评估

- Provider 返回的会话字段名称未覆盖时不会记录 ID，但不影响请求和回复。
- 会话 ID 属于调试关联信息，仍不记录 URL、Cookie、Token 或请求头。

## 预计工时

- 约 30 分钟。

## 执行结果

- ✅已完成 [2026-08-31][2026-08-31] 增加简洁模式 `sessionId` 提取和记录。
  - 请求和普通响应支持统一记录 `sessionId`；请求存在会话 ID 而响应未重复返回时，响应记录复用请求会话 ID。
  - SSE、gzip SSE 从事件内容提取会话 ID，仍只输出一条聚合响应记录。
  - 无会话 ID 时不输出空字段，完整模式保持原有记录结构。
  - 改动文件：`src/apps/server/modules/chat2api/chat2api-raw-traffic-logger.js`、`src/apps/server/modules/chat2api/chat2api-raw-traffic-logger.test.js`、`src/apps/server/modules/chat2api/chat2api-provider-adapters.test.js` 及对应 design/spec 文档。
  - 验证：日志模块测试 9/9 通过；Chat2API 全量检查 62/62 通过。
