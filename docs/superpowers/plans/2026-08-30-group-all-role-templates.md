# 群聊使用全部角色模板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让控制端群聊和子显示端语音群聊将全部已配置角色模板作为统一系统提示词发送给 AI，并保留用户原始输入。

**Architecture:** 聊天服务从 `chatTemplates` 构造带角色名称的群聊系统提示词；服务端普通群聊和语音群聊统一调用该提示词。控制端不再根据角色名前缀选择/裁剪模板，语音命令只用角色名完成唤醒识别，实际发送文本保持原样；私聊和工作 AI 角色路径继续使用单一模板或 Agent。

**Tech Stack:** Node.js、浏览器端原生 JavaScript、Node test runner、现有 LLM 流式接口。

**Spec:** `docs/spec/chat-system.md`、`docs/spec/display-voice-conversation.md`

## Global Constraints

- 使用 `const/let`，异步操作使用 `async/await`，错误处理使用 `try-catch`。
- 所有实现注释使用中文，避免新增全局变量和大段 if-else 链。
- 群聊原始消息不删除任何角色名前缀；私聊和工作 AI 角色行为保持兼容。
- 不在每个请求中修改或持久化角色模板；仅按当前模板列表构造提示词。

---

### Task 1: 更新群聊模板设计与实现伪代码

**Files:**
- Modify: `docs/design/chat-system.md`
- Modify: `docs/design/display-voice-conversation.md`
- Modify: `docs/spec/chat-system.md`
- Modify: `docs/spec/display-voice-conversation.md`
- Create: `docs/task/2026-08-30_群聊使用全部角色模板.md`

- [x] 在设计文档明确群聊拼接全部角色模板、原始消息保留、私聊单模板隔离。
- [x] 在 spec 中写出 `getGroupSystemPrompt()`、群聊路由和语音原始输入伪代码。
- [x] 在 task 文档记录受影响模块、自测、兼容性、性能和风险。

### Task 2: 编写失败测试

**Files:**
- Create: `tests/group-chat-templates.test.js`
- Modify: `tests/display-voice-conversation.test.js`
- Modify: `tests/chat-stream-request-id.test.js`

- [x] 测试群聊提示词包含全部模板、角色名称和基础系统提示词。
- [x] 测试群聊提示词为空模板时仍返回基础系统提示词。
- [x] 测试控制端群聊不会设置 `templateTarget`、不会裁剪角色名前缀。
- [x] 测试等待唤醒状态接受“角色名 + 内容”，并产生群聊输入事件。
- [x] 运行测试确认它们因功能尚未实现而失败。

### Task 3: 实现统一群聊模板和原始消息路由

**Files:**
- Modify: `src/external/llm/llm-service.js`
- Modify: `src/apps/server/boot/server-app.js`
- Modify: `src/apps/web-mediacenter/modules/voice/voice-command-app-service.js`
- Modify: `src/apps/server/modules/voice/display-voice-conversation.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/chat.js`

- [x] 新增 `getGroupSystemPrompt()`，按当前 `chatTemplates` 顺序拼接所有有效角色模板。
- [x] 普通群聊使用统一群聊提示词；私聊继续使用 `templateTarget` 对应模板。
- [x] 控制端群聊原样发送 `content`，不再按角色名前缀选择或裁剪模板。
- [x] 语音群聊识别角色名只用于接受输入，向 AI 发送完整原始文本。
- [x] 子显示端和主显示端复用同一群聊路由；工作 AI Agent 路径不改变。

### Task 4: 运行回归并更新项目记录

**Files:**
- Modify: `docs/todo.md`
- Modify: `changelog.md`
- Modify: `docs/task/2026-08-30_群聊使用全部角色模板.md`

- [x] 运行群聊模板、语音会话、语音路由、聊天请求和相关前端契约测试。
- [x] 编译页面内联脚本并运行 `git diff --check`。
- [x] 记录测试结果、兼容性结果和性能结论。
- [x] 将 todo 任务标记完成并写入 changelog。
