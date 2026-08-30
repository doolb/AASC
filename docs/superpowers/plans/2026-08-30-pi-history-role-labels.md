# Pi History Role Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一 Pi Agent 续聊消息和重建历史中的用户/助手文本标记。

**Architecture:** Pi 内部继续使用原生 `user`/`assistant` 角色。运行时只在发送续聊文本时补充 `User:`，历史重建文本使用 `User:`/`Assistant:`，不把角色标记改写成助手消息内容之外的内部角色。

**Tech Stack:** Node.js、Pi RPC JSONL、Node test runner、Markdown 伪代码文档。

**Spec:** `docs/design/llm-agent-mode.md`、`docs/spec/llm-agent-mode.md`

## Global Constraints

- 使用 `const/let`，异步操作使用 `async/await`，错误处理使用 `try-catch`。
- 先更新 spec 伪代码，再修改目标代码。
- 保留 Pi 内部 `assistant` 角色，`AI：` 只属于展示层约定。

---

### Task 1: 统一 Pi 续聊和历史重建标记

**Files:**
- Modify: `src/apps/server/modules/chat/pi-runtime-manager.js`
- Modify: `src/external/llm/llm-service.js`
- Test: `src/apps/server/modules/chat/pi-runtime-manager.test.js`
- Test: `src/external/llm/llm-service.test.js`

**Interfaces:**
- `PiRuntimeManager.chatStream()` 继续接收初始化 prompt 和 continuationPrompt。
- 续聊写入 RPC 的文本必须为 `User:` 加原始消息。
- 历史重建文本中的助手标记必须为 `Assistant:`。

- [x] **Step 1: Write the failing test**
  - 断言 Pi 第二次 RPC prompt 为 `User:第二轮消息`。
  - 断言旧式成对历史重建使用 `Assistant:`，不再使用 `AI:`。
- [x] **Step 2: Run test to verify it fails**
  - Run: `node --test src/apps/server/modules/chat/pi-runtime-manager.test.js src/external/llm/llm-service.test.js`
  - Expected: 现有续聊仍为裸文本，或历史序列化仍包含 `AI:`。
- [x] **Step 3: Write minimal implementation**
  - 在 Pi Runtime 的续聊分支统一增加 `User:` 前缀，已带此前缀时不重复添加。
  - 将历史序列化的助手标记从 `AI:` 改为 `Assistant:`。
- [x] **Step 4: Run test to verify it passes**
  - Run: `node --test src/apps/server/modules/chat/pi-runtime-manager.test.js src/external/llm/llm-service.test.js tests/llm-agent-mode.test.js`
  - Expected: 新增断言和既有 Agent/LLM 测试通过。
- [x] **Step 5: Run full verification**
  - Run相关 Pi、LLM、聊天回归测试、脚本语法检查和 `git diff --check`。
