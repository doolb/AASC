# 普通聊天 Agent 后端

普通聊天 profile 的调用模式分为 `llm` 和 `agent`。`agent` profile 的后端可选 `pi` 或 `codex`。

## Codex 后端

将聊天配置中的目标 profile 设置为：

```json
{
  "mode": "agent",
  "backend": "codex"
}
```

服务器会启动独立的 `codex app-server --stdio`。同一个群聊或私聊会话会复用同一个 Codex `threadId`，切换 profile、模板、私聊对象或重启服务器后重新建立会话。

首条消息会带入当前聊天需要的系统提示、模板和历史；后续消息只发送新输入，因此不会反复叠加历史。普通聊天 Codex 使用只读沙箱，不复用工作 Agent 的 Codex 会话。

Codex 后端使用本机 Codex CLI 的登录和模型配置，并通过统一配置 `chat.codexProxy` 访问网络，当前配置为 `http://127.0.0.1:7899`。普通聊天和工作 Agent 使用同一代理配置，但进程、threadId、历史和权限仍然隔离。配置修改后，重启服务器或对应 Codex Agent 才会生效。

## 当前测试配置

当前 `config/config.json` 的 active profile `qwen3.5` 已设置为 `mode=agent/backend=codex`。恢复旧的 Pi 普通聊天时，将该 profile 的 `backend` 改回 `pi` 并重启服务器。

验证前请确认服务器可执行 `codex app-server --stdio`，并且 Codex CLI 已完成登录。
