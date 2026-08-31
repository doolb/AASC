# Chat2API 全局 Responses 协议设计

## 需求概述

将 AASC 普通聊天、语音聊天、搜索/系统 LLM 任务和 Pi Agent 的请求统一切换到内置 Chat2API 的 `POST /v1/responses`。AI 角色的 Codex/Claude 后端不纳入本次切换，既有外部 profile 配置保留为回退数据。切换完成并通过真实验证后，停止 `/mnt/Chat2API` 的 Electron 实例，但不删除其配置和数据。

## 范围与边界

### 本次范围

- `src/external/llm/llm-service.js` 的普通非流式和流式请求统一使用 Responses 客户端。
- `llm.chat` 单次内置任务使用同一个 Responses 客户端。
- 搜索和语音因复用 `llm-service` 自动进入 Responses 链路。
- Pi Agent 的自定义只读 Provider 改用 `openai-responses`，继续保留只读工具白名单。
- 全局保存 Responses 协议、内置代理地址和回退配置；默认切换到 `http://127.0.0.1:8083/v1`。
- 每个 AASC 聊天 session 保存 `conversation`、最近 `response_id` 和请求指纹，服务重启后继续使用已有 Responses 会话。
- 停止外部 `/mnt/Chat2API` Electron 进程，保留 `/home/as/.config/chat2api` 数据。

### 不在范围

- AI 角色的 Codex/Claude 后端不改为 Chat2API。
- 不删除既有 LLM profile 的 API 地址、API Key 或模型配置。
- 不导入或列出 Provider 网页端的全部历史会话。
- 不实现完整 OpenAI Responses 管理 API。

## 方案决策

采用统一 Responses 客户端层，而不是在代理层伪装转换旧协议。这样普通聊天、任务和 Pi Agent 的网络请求都真正使用 Responses 协议，并由一个位置处理响应体、SSE、会话状态和错误格式。

```text
控制端普通聊天 / 语音
    └─ llm-service
        └─ AASC Responses Client
            └─ 127.0.0.1:8083/v1/responses

搜索 / llm.chat 任务
    └─ AASC Responses Client
        └─ 127.0.0.1:8083/v1/responses

Pi Agent
    └─ Pi openai-responses Provider
        └─ 127.0.0.1:8083/v1/responses

AI 角色 Codex/Claude
    └─ 保持现状
```

## 配置与会话状态

聊天配置增加以下字段：

```text
protocol = "openai-responses"
responsesBaseUrl = "http://127.0.0.1:8083/v1"
responsesApiKey = ""
```

旧的 `apiUrl`、`apiKey` 和 profile 字段继续保存，作为回退模式 `openai-completions` 的配置。全局 Responses 模式下，profile 的 `model`、`temperature`、`maxTokens`、模板和会话隔离规则继续有效；profile 的旧 API 地址只用于回退。

聊天侧另存一个按现有 `buildChatSessionKey` 索引的状态集合：

```text
chat-responses-sessions.json
    sessionKey -> {
        conversationId,
        latestResponseId,
        model,
        fingerprint,
        updatedAt
    }
```

首轮或指纹变化时发送完整的本地上下文，成功后保存 Responses 会话标识。正常续聊只发送当前输入并携带 `conversation` 或 `previous_response_id`，避免重复提交完整历史。状态缺失、远端会话不存在或续接失败时，清除旧标识并用本地历史重新创建会话。

## 请求与响应流程

```text
chat(userMessage, options)
    → buildMessages()
    → resolve profile/template/session fingerprint
    → read chat-responses-sessions.json
    → first request: input = complete messages
      continuation: input = current user message + previous_response_id
    → POST /v1/responses
    → non-stream: read output_text
      stream: read response.output_text.delta
    → save conversation/response identifiers
    → write existing local chat history
```

`llm.chat` 是单次任务，不加入普通聊天 session；它仍使用 Responses 请求和 `output_text`，任务自己的 `messages` 作为完整输入。搜索和语音复用普通 `llm-service` 的 session/流式处理。

## Pi Agent 与工具

Pi 自定义 Provider 改为 `openai-responses`。Pi 的只读工具白名单保持不变；Responses 输出中的 function call 转换为 Pi 可识别的工具调用，Pi 执行后把 `function_call_output` 作为下一轮 input 发送。流式文本和工具事件均不得混入普通文本、聊天历史或 TTS。

如果 Responses 服务无法识别某个 Provider 的工具调用增量，先将其归一化为完整 function call；无法安全识别的增量不伪造成工具参数，并返回可识别错误。

## 外部实例停用

切换顺序固定为：

1. 检查内置代理健康状态和 Responses 路由。
2. 修改全局配置并重启 AASC 主服务。
3. 验证普通聊天、流式、Pi Agent 工具调用和重启后续聊。
4. 精确停止 `/mnt/Chat2API` 的 Electron/npm 进程树。
5. 确认内置 `8083` 代理仍运行，且工作区没有删除外部 Chat2API 数据。

失败时保留旧 profile 配置和全局回退开关，不删除任何账号、会话或外部数据。

## 验收标准

- 普通控制端聊天和语音实际请求 URL 为 `/v1/responses`。
- `llm.chat` 与搜索成功读取 Responses `output_text`。
- Pi Agent 使用 `openai-responses`，只读工具调用可完成一次闭环。
- 同一聊天 session 第二轮使用之前的 Responses 会话，服务重启后仍可续聊。
- 旧 Chat Completions 兼容接口仍可供外部客户端使用，但 AASC 内部不再调用它。
- `/mnt/Chat2API` Electron 进程停止，内置代理保持健康。

## 实施结果（2026-08-31）

- 已完成普通聊天、语音复用链路、搜索/`llm.chat` 任务和 Pi Agent 的全局 Responses 切换。
- 已补齐 Responses 流式 `output_item`、文本增量、function_call 参数事件，以及 Qwen 文本工具标签到 Pi 工具调用的兼容层。
- 已验证服务重启后内置 8083 和真实 Qwen 请求正常；外部 `/mnt/Chat2API` 进程已停止，外部配置和数据目录保留。
