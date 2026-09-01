# Chat2API 工具标签解析修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Pi Provider 解析 canonical Chat2API XML 工具调用时残留结束标签的问题，保持旧式 `</function>` 格式兼容。

**Architecture:** 保留 AASC 现有纯函数转换器和只读工具白名单。解析每个 invoke 时同时记录实际匹配到的结束标签，游标按该标签长度前进；外层 `tool_calls` 结束标签和所有未识别协议残留继续执行完整校验。该实现对齐 `/mnt/Chat2API` 的 `managedXmlProtocol`：按完整区块匹配并从普通文本中移除整个协议区块。

**Tech Stack:** Node.js CommonJS、Node 内置 `node:test`、正则协议解析、Markdown 设计/spec/task 文档。

**Spec:** `docs/spec/llm-agent-mode.md` 的 Chat2API 工具协议转换章节。

## Global Constraints

- 仅允许当前只读工具白名单，不能通过模型文本新增工具。
- 保持旧式 `<|parameter=...>` 与 canonical 命名参数 CDATA 格式兼容。
- 协议标签不得进入 Pi 普通文本、控制端聊天或 TTS。
- 不修改 `/mnt/Chat2API` 上游仓库，只把它作为实现参考。
- 保留工作区现有用户改动，不重置、不清理无关文件。

---

### Task 1: 更新协议设计与伪代码

**Files:**
- Modify: `docs/design/llm-agent-mode.md:121-140`
- Modify: `docs/spec/llm-agent-mode.md:197-224`
- Create: `docs/task/2026-09-01_修复Chat2API工具标签残留.md`

- [ ] 明确 canonical invoke 结束标签必须按实际匹配文本消费。
- [ ] 明确外层 tool_calls 区块整体移除，残留协议标签视为 malformedProtocol。
- [ ] 记录影响代码、回归用例、兼容性、性能和风险。

### Task 2: 添加失败回归测试

**Files:**
- Modify: `src/apps/server/modules/chat/pi-chat2api-tool-converter.test.js`

- [ ] 增加 canonical 命名参数格式的 `remainingText === ''` 断言。
- [ ] 运行该单测，确认旧实现因固定使用 `</function>` 长度而失败，并保留失败证据。

### Task 3: 按实际结束标签修复解析器

**Files:**
- Modify: `src/apps/server/modules/chat/pi-chat2api-tool-converter.js:133-150`

- [ ] 将结束标签候选从单独索引改为 `{ index, tag }`。
- [ ] 选择最早结束标签后使用 `end.tag.length` 更新游标。
- [ ] 加强残留协议标签检查，避免带 `/` 的结束标签绕过校验。

### Task 4: 验证并归档

**Files:**
- Modify: `docs/todo.md`
- Modify: `changelog.md`

- [ ] 运行转换器测试和 `npm run check:chat2api`。
- [ ] 运行语法检查、`git diff --check`，确认 canonical 与旧式格式均通过。
- [ ] 从 todo 移除已解决条目，在 changelog 记录改动文件和验证结果。
