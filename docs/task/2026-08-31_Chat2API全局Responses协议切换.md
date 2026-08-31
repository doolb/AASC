# Chat2API 全局 Responses 协议切换

## 任务描述

将普通聊天、语音聊天、搜索/系统 LLM 任务和 Pi Agent 统一切换到内置 Chat2API 的 `/v1/responses`，保留 AI 角色后端和旧 profile 配置，并在验证通过后停止外部 `/mnt/Chat2API` Electron 实例。

## design 需求

- 统一 Responses 客户端负责非流式、SSE、错误和会话状态。
- 普通聊天按现有 session key 保存 Responses conversation/response 标识。
- Pi Agent 使用 `openai-responses` 并保留只读工具循环。
- `llm.chat` 和搜索/语音不得继续直接调用旧 Chat Completions。
- 外部 Chat2API 只停止进程，不删除配置、账号或数据。

## spec 设计

```text
全局协议为 openai-responses:
    普通聊天、语音、搜索、llm.chat -> AASC Responses Client
    Pi Agent -> Pi openai-responses Provider
    保存 conversation/response 状态
    Responses 失败 -> 使用本地历史重建 AASC 会话
```

## 受影响功能模块和代码

- `src/external/llm/llm-service.js`：普通聊天/语音的全局 Responses transport 和 session 状态。
- `src/external/llm/llm-responses-client.js`：新增统一 Responses HTTP/SSE 客户端。
- `src/apps/server/modules/task-engine/builtin-tasks/llm-chat.js`：单次 LLM 任务切换 Responses。
- `src/apps/server/modules/chat/pi-readonly-tools.mjs`：Pi Provider 切换 `openai-responses` 和工具事件转换。
- `src/apps/server/modules/chat/pi-runtime-manager.js`：传递全局 Responses 地址和模型配置。
- `src/apps/server/modules/config/config-app-service.js`：增加全局协议默认配置。
- `src/apps/web-mediacenter/ui/public/js/chat.js`：显示当前全局协议和内置代理状态（如现有配置面板适配需要）。
- 对应单元、集成和真实链路测试。
- `docs/design/chat2api-global-responses.md`、`docs/spec/chat2api-global-responses.md`、`docs/todo.md`、`changelog.md`。

## 自测用例

1. 普通非流式聊天真实请求进入 `/v1/responses` 并读取 `output_text`。
2. 普通流式聊天读取 Responses 增量事件，显示/TTS 行为不变。
3. 同一私聊/群聊 session 第二轮复用 conversation，服务重启后仍能续聊。
4. 切换 profile、模板或系统提示词后不会错误复用旧 Responses 会话。
5. 搜索和 `llm.chat` 使用 Responses，而不是 `/v1/chat/completions`。
6. Pi Agent 使用 `openai-responses`，只读工具可完成读取文件或搜索工具闭环。
7. Responses 错误不泄露 API Key、Cookie 或 Provider 凭据。
8. 外部 `/mnt/Chat2API` Electron 进程停止，内置 `8083` 代理继续健康。
9. AI 角色 Codex/Claude 后端和旧 profile 配置未被删除。
10. 现有 Chat2API 旧接口和 Chat2API 模块回归测试通过。

## 兼容性测试

- 控制端普通聊天、语音聊天、系统搜索和 `llm.chat`。
- Pi Agent 文本、流式和只读工具调用。
- 服务器重启前后 Responses session 续接。
- 原有 `/v1/chat/completions` 客户端仍可访问内置代理。
- 不同 profile、私聊/群聊和模板切换。

## 性能测试

- 普通续聊不重复发送完整历史，首轮/重建才发送完整 input。
- 流式响应保持增量回调，不等待完整响应才显示。
- Responses session 状态写入不阻塞不同聊天 session。

## 风险评估

- Pi 0.84.2 的 Responses compat API 需要通过真实进程确认导出名称和工具事件行为。
- 旧 Chat Completions profile 与 Chat2API 模型映射可能存在模型名差异，切换前保留回退配置。
- 停止外部 Electron 后，旧的外部 API 地址不可用；必须先完成内置代理和真实链路验证。
- Responses 本地状态和已有 AASC 聊天历史可能短暂不一致，需要按 fingerprint 和远端 404 重建。

## 预计工时

约 8-12 小时，包含统一客户端、Pi 工具兼容、配置迁移、真实链路验证和外部实例停用。
