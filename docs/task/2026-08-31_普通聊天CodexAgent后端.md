# 任务：普通聊天支持 Codex Agent 后端

## 任务描述

为普通聊天的 `mode=agent` profile 增加 `backend=codex`，支持通过 Codex app-server 进行连续对话；保留现有 Pi 后端，并将当前 `qwen3.5` 普通聊天 profile 切换为 Codex 以便测试。

## Design 需求

- `agent` 后端可选 Pi/Codex，旧配置缺省仍使用 Pi。
- Codex 普通聊天使用独立 app-server 和 threadId，不复用工作 Agent 会话。
- 同一 profile、模板、群聊/私聊会话复用 threadId；切换或删除对话后回收。
- 首轮将应用历史以 `User:`/`Assistant:` 文本重放，后续只发送当前消息，避免历史递归。
- 普通聊天 Codex 使用只读沙箱；失败不回退到普通 LLM HTTP。
- 普通聊天 Codex 通过 `http://127.0.0.1:7899` 代理访问网络。

## Spec 设计

- 扩展 Agent profile 规范化允许 `backend=codex`。
- 新增 `CodexRuntimeManager`，按聊天会话串行调用 `CodexBridge`。
- `CodexBridge` 支持注入 spawn、系统提示词和沙箱策略，工作 Agent 默认行为保持不变。
- `llm-service` 根据 profile backend 分流 Pi/Codex，并在服务退出时清理两类运行时。

## 受影响的功能模块和代码

- `src/apps/server/modules/chat/pi-runtime-policy.js`
- `src/apps/server/modules/chat/codex-runtime-manager.js`
- `src/apps/server/modules/chat/codex-runtime-manager.test.js`
- `src/apps/server/modules/ai-roles/codex-bridge.js`
- `src/external/llm/llm-service.js`
- `src/apps/server/boot/server-app.js`
- `config/config.json`
- `docs/design/llm-agent-mode.md`
- `docs/spec/llm-agent-mode.md`

## 自测用例

- Codex profile 可以通过规范化校验，非法 backend 仍被拒绝。
- Codex 首轮发送历史重放内容，第二轮复用同一个 bridge/thread，只发送当前消息。
- 群聊和私聊会话隔离；重置后新建 session。
- Codex 流式 delta、完成事件、错误和 stopAll 正常工作。
- Pi profile 既有测试保持通过。
- `http://127.0.0.1:3001/api/tts` 不受本次聊天 Agent 改动影响。

## 兼容性测试

- 普通 `mode=llm` 仍使用原 HTTP/Responses 路径。
- 工作 AI 角色的 Codex/Claude 后端和全权限策略不改变。
- 旧 Agent profile 缺少 backend 时仍为 Pi。

## 性能测试

- 同一聊天会话不重复启动 Codex app-server。
- 后续消息不重复发送应用历史。
- session 回收后不留下 app-server 子进程。

## 风险评估

- Codex CLI 未登录、网络不可用或 app-server 协议版本不匹配时，普通聊天会返回错误，不回退到旧 URL。
- Codex profile 的模型实际由本机 Codex 配置决定，profile 中的 `model` 主要用于配置兼容和会话隔离。
- 只读沙箱能力依赖当前 Codex app-server 协议支持；若不支持，启动/turn 会明确失败。

## 预计工时

- 约 1.5 小时。

## 完成情况

- ✅已完成 [2026-08-31]
  - 普通聊天 Agent 支持 Pi/Codex 双后端；Codex 使用独立 app-server、threadId 和只读沙箱，首轮重放历史、后续复用会话。
  - `qwen3.5` 已切换为 `backend=codex`，代理配置为 `http://127.0.0.1:7899`；搜索独立请求会自动回收 Codex session。
  - 测试：相关回归 49/49 通过；真实 Codex Runtime 和服务器 `/control` WebSocket 普通聊天链路均返回成功；语法检查和 `git diff --check` 通过。
