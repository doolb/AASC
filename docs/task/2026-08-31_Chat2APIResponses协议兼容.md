# Chat2API Responses 协议兼容

## 任务描述

为内置 `chat2api.proxy` 增加面向 Pi Agent 的 `POST /v1/responses` 兼容接口，使 OpenAI Responses 的逻辑会话能够映射到各 Provider 的原生会话状态或历史重放机制。

## design 需求

- Responses 的 `conversation` 和 `previous_response_id` 由 AASC 管理，不依赖 Provider 统一字段。
- Qwen 优先复用 `session_id`、`parent_req_id`；其他 Provider 按原生 `chat_id`、`conversationId`、`chat_session_id` 等字段复用。
- Provider 没有稳定原生会话或续接失败时，使用持久化历史重放，保证模型上下文连续。
- 同一会话固定 Provider 账号；账号失效时允许切换并清空原生状态后重放历史。
- 目标是 Pi Agent 兼容子集，不实现完整 OpenAI Responses 管理 API。

## spec 设计

```text
POST /v1/responses(request):
    解析 input/instructions/tools
    解析 conversation/previous_response_id
    读取或创建 responses session
    按会话固定账号调用 Chat2API core adapter
    将 Provider chat.completion 转为 Responses response
    流式请求转为 Responses SSE 事件
    成功后持久化历史、responseId 和 Provider 原生状态
```

## 受影响功能模块和代码

- `src/apps/server/modules/chat2api/chat2api-data-store.js`：增加 Responses 会话集合读写。
- `src/apps/server/modules/chat2api/chat2api-response-session-store.js`：会话、响应链和并发更新。
- `src/apps/server/modules/chat2api/chat2api-responses-service.js`：Responses 输入/输出转换和状态协调。
- `src/apps/server/modules/chat2api/chat2api-core-adapter.js`：支持固定 Provider/账号和传递会话状态。
- `src/apps/server/modules/chat2api/chat2api-provider-adapters.js`：接收并返回 Provider 原生状态。
- `src/apps/server/modules/chat2api/chat2api-proxy-service.js`：注册 `/v1/responses` 和 Responses SSE。
- `src/apps/server/modules/chat2api/chat2api-runtime.js`：装配会话服务与代理路由。
- 对应 `*.test.js`：路由、转换、持久化、流式和 Provider 状态回归。
- `docs/design/chat2api-builtin-task.md`、`docs/spec/chat2api-builtin-task.md`、`docs/todo.md`、`changelog.md`。

## 自测用例

1. 无 `conversation` 的非流式请求创建 `conv_` 和 `resp_` 标识，并返回标准 Responses message/output_text。
2. 使用 `conversation` 发送第二轮时复用同一会话和固定账号。
3. 使用 `previous_response_id` 续接成功；未知 ID 返回 404/可识别 invalid_request_error。
4. `conversation` 与 `previous_response_id` 同时传入时返回 400。
5. `input` 支持字符串、user/assistant/system/developer、function_call 和 function_call_output。
6. `stream=true` 返回 `response.created`、文本 delta、`response.completed` 和 `[DONE]`。
7. Qwen 会话复用 `session_id`，第二轮请求使用上一轮 parent request ID。
8. 其他 Provider 保存可用 native state；无状态 Provider 使用历史重放。
9. 会话数据写入 `responses-sessions.json`，服务重启后仍可续接。
10. 同一会话并发请求不会覆盖最后的 parent/response 状态。
11. API Key、Cookie、Ticket 和 Provider 原始凭据不会出现在 Responses 返回或错误中。
12. 现有 `/v1/chat/completions`、`/v1/completions` 和 `/v1/models` 行为不变。

## 兼容性测试

- Pi Agent 配置 `api: "openai-responses"`、`baseUrl: http://127.0.0.1:{port}/v1`，完成一轮文本请求和一轮续聊。
- Chat Completions 客户端继续访问原路由。
- 9 个内置 Provider 至少通过请求转换和状态存储模拟测试；没有测试账号时不执行真实上游调用。
- 同源 HTTPS 网关继续透传 `/v1/responses`。

## 性能测试

- 会话读写只保存必要文本和状态，单次请求不重复加载无关会话。
- 同一会话状态写入串行化，不阻塞不同会话。
- 流式响应保持增量发送，不等待完整结果后才向 Pi Agent 输出。

## 风险评估

- 各 Provider 原生会话字段不是统一协议，原生续接失败必须回退历史重放。
- Provider 账号切换后网页端不一定仍显示同一云端会话；AASC 只保证上下文连续。
- 长期保存完整历史会增加磁盘和请求体大小，需要依赖 Responses 输入长度与会话清理策略控制。
- `store=false` 与 Provider 续接存在语义差异，本实现必须保存最小状态才能兼容 Qwen 等原生会话。
- 工具调用的 Provider 原生格式不一致，本阶段只做标准字段转换，不承诺所有 Provider 都能执行工具。

## 预计工时

约 6-8 小时，包含实现、测试、文档和本地 Pi Agent 兼容验证。

## 完成结果

- 已完成 `/v1/responses` 非流式和流式兼容路由，并保留原有 Chat Completions 路由行为。
- 已完成 `conversation`、`previous_response_id`、输入项、工具定义、响应链和会话持久化。
- 已完成 Provider/账号固定、原生会话状态传递，以及无稳定原生会话时的历史重放。
- 已完成会话并发串行、敏感数据不回传和路由 SSE 终止标记测试。
- Chat2API 全量回归：53/53 通过；变更 JavaScript 语法检查和 `git diff --check` 通过。
- 已执行 `npm run restart:server` 重启实际主服务；`127.0.0.1:8083/health` 正常，根路径包含 `/v1/responses`，空请求返回 `invalid_request_error`。
