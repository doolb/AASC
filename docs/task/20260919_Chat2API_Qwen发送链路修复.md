# Chat2API Qwen 发送链路修复

## 任务描述

修复本地 Chat2API 调用 `Qwen3.6-Flash`（映射到 `Qwen3.7`）时偶发返回“你好，我无法回答这个问题，我们换一个话题聊聊吧。”或空流，而官网网页和直接请求 Qwen 上游可以正常回复的问题。

## design 需求

- 保持 Qwen 网页 Provider 的 `/api/v2/chat`、Cookie 鉴权和 SSE 协议。
- 网页聊天请求不强制注入所有账号共享的固定 `X-Platform`/`X-DeviceId`，保持与官网聊天请求一致。
- 上游返回验证码/风控 JSON 时返回明确错误，不将其解析为空成功回复。
- 首轮请求使用 `scene_param=first_turn`、`parent_req_id=0`；续接请求只复用当前 `responseSession.nativeState` 中的 Qwen 原生状态。
- 不改变其他 Provider、日志方式、模型映射和账号凭据存储格式。

## spec 设计

```text
createQwenRequest(request, actualModel, provider, headers, responseSession):
    读取 responseSession.nativeState
    有 sessionId -> scene_param=continue，复用 session_id 和 parent_req_id
    无 sessionId -> 生成首轮 session_id，scene_param=first_turn，parent_req_id=0
    删除旧适配器强制注入的 X-Platform/X-DeviceId
    使用 Cookie 发送网页登录凭据，不发送 ticket Bearer Authorization
    将消息转换为 Qwen 原生 messages 文本结构

normalizeQwenResponse(response):
    如果 content-type 为 application/json:
        解析 ret/errorCode/errorMsg
        如果是风控或验证码响应 -> 返回可识别的上游错误
    按 content-encoding 解压响应流
    按 SSE 事件读取 data.messages
    提取 multi_load/iframe 或 text/plain 的累计内容
    更新 responseSession.nativeState 的 sessionId/parentReqId
    输出 OpenAI chat.completion 或 chat.completion.chunk
```

## 受影响功能模块和代码

- `src/apps/server/modules/chat2api/chat2api-provider-adapters.js`
- `src/apps/server/modules/chat2api/chat2api-provider-adapters.test.js`
- `docs/design/chat2api-builtin-task.md`
- `docs/spec/chat2api-builtin-task.md`
- `docs/task/20260919_Chat2API_Qwen发送链路修复.md`

## 自测用例

1. Qwen 网页聊天请求不再注入固定设备头。
2. 首轮 Qwen 请求使用 `first_turn` 和 `parent_req_id=0`。
3. 续接 Qwen 请求复用 `session_id` 和 `parent_req_id`，并使用 `continue`。
4. Qwen gzip SSE 能正确解压并提取完整回复。
5. Qwen 风控 JSON 返回明确错误，不产生空成功回复。
6. 其他 Provider 适配器和 Cookie 脱敏行为不受影响。

## 兼容性测试

- `npm run check:chat2api`
- Qwen `/v1/chat/completions` 非流式请求。
- Qwen `/v1/chat/completions` 流式请求。
- Qwen `/v1/responses` 新会话和续接会话。

## 实际验证结果

- `npm run check:chat2api`：94/94 通过。
- `node --check src/apps/server/modules/chat2api/chat2api-provider-adapters.js`：通过。
- `git diff --check`：通过。
- 重启 `192.168.1.39` 工程服务后，真实 Qwen 请求已从“空成功回复”变为明确的 `FAIL_SYS_USER_VALIDATE` 上游错误；当前上游仍要求验证码，正常答案需在有效网页登录风控状态下复测。

## 性能测试

- 移除设备头不会增加上游请求。
- SSE 仍保持流式透传；仅对 `application/json` 风控响应读取有限的错误体，不缓存正常回答。

## 风险评估

- 风险：Qwen 上游可能要求浏览器动态风控令牌；本任务不伪造验证码或未确认的动态字段，遇到风控时返回明确错误。
- 风险：上游仍可能临时限制仅凭 SSO Ticket 的服务端请求；此时需要重新登录/补充完整网页登录 Cookie。
- 回滚：仅回滚 Provider 适配器和对应测试，不触碰账号文件、日志、模型和历史会话。

## 预计工时

- 适配器与测试：1 小时
- 定向验证与文档同步：0.5 小时
