# Pi Agent 跳过 LLM 路由下的旧命令识别

## 任务描述

当天气/搜索高级指令设置为 `llm` 且当前 profile 使用 Pi Agent 时，跳过控制端旧的天气/搜索多处理器，避免旧命令链与 Pi Agent 对同一条消息重复处理。高级指令设置为 `system` 时保持原有行为。

## Design 需求

- `system` 路由不做任何改变，继续执行服务器/控制端原有内置命令。
- `llm` 路由下，普通 LLM profile 保持现有行为。
- `llm` 路由下，只有 `mode=agent` 且 `backend=pi` 的 profile 跳过旧天气/搜索处理器。
- 只影响当前消息处理，不修改控制端保存的路由设置。

对应设计文档：`docs/design/llm-agent-mode.md`、`docs/design/chat-system.md`。

## Spec 设计

- `Chat.shouldLetPiAgentHandle(commandType)` 判断当前路由是否为 `llm`，以及当前 profile 是否为 Pi Agent。
- `Chat.checkMultiHandlerKeywords(message)` 仅在判断为 false 时加入 `weather`/`search` 旧处理器。
- 原有 `chatMessage` 仍发送给当前 profile，因此 Pi Agent 继续在当前对话中处理请求。

对应实现文档：`docs/spec/llm-agent-mode.md`、`docs/spec/chat-system.md`。

## 受影响的功能模块和代码

- `src/apps/web-mediacenter/ui/public/js/chat.js`
- `tests/llm-agent-mode-ui.test.js`
- `docs/design/llm-agent-mode.md`
- `docs/design/chat-system.md`
- `docs/spec/llm-agent-mode.md`
- `docs/spec/chat-system.md`

## 自测用例

- `llm + Pi Agent`：天气/搜索不加入旧多处理器列表。
- `system + Pi Agent`：天气/搜索仍加入旧多处理器列表。
- `llm + 普通 LLM`：保持原有旧多处理器列表行为。
- profile 编辑器和模板权限既有 UI 测试继续通过。

## 兼容性测试

- 私聊、系统控制、自定义显式指令按钮不改变。
- 普通 LLM profile 不改变。
- 高级指令的持久化 `system/llm` 配置不改变。

## 性能测试

- 只增加一次本地 profile/路由判断，不增加网络请求和 Pi 进程数量。

## 风险评估

- 控制端尚未加载路由配置时不跳过旧处理器，避免误把 `system` 当成 `llm`。
- Pi Agent 的模型若不支持工具调用，仍可能只返回文本；本次改动只消除重复旧命令，不替模型强制调用工具。

## 完成结果

- UI 路由回归测试：5/5 通过。
