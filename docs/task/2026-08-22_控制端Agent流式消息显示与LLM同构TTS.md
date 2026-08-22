# 控制端 Agent 流式消息显示与 LLM 同构 TTS

## 任务描述

修复控制端工作 AI 角色发送消息后，用户消息和流式 Agent 回复被在线状态刷新清除、直到回复完成才重新出现的问题。Agent 回复必须持续按 `chatChunk` 显示，并沿用普通 LLM 的句子级串行 TTS 播报链路。

## design 需求

- 用户发送后立即显示用户消息。
- Agent `chatChunk` 到达时立即更新回复内容，不等待 `chatResponse`。
- `roleList` 在线状态广播只更新角色状态，不重建正在显示的聊天 DOM。
- Agent TTS 与普通 LLM 采用相同播放目标优先级、句子切分、串行队列和尾句冲刷规则。

## spec 设计

- `websocket.js` 收到 `roleList` 时，如果 `Chat.isLoading` 为真，调用轻量状态更新方法。
- `chat.js` 新增 `updateRoleStatuses()`，只更新已有角色 tab 的状态、标题和模式指示器。
- 无流式请求时仍使用完整 `render()`，保证角色添加/删除和角色 tab 结构正常刷新。
- 保留现有 `chatChunk`、`chatResponse` 和 `createAgentTtsStream` 协议。

## 受影响的功能模块和代码

- `src/apps/web-mediacenter/ui/public/js/chat.js`
- `src/apps/web-mediacenter/ui/public/js/websocket.js`
- `tests/ai-agent-backend-ui.test.js`
- `docs/design/ai-roles.md`
- `docs/spec/ai-roles.md`
- `docs/todo.md`
- `changelog.md`

## 自测用例

1. Agent 请求进行中收到 `roleList`，用户消息 DOM 不被清除。
2. Agent `chatChunk` 到达时，回复 DOM 持续更新。
3. Agent 完成后 `chatResponse` 正常替换为历史消息并保留播放按钮。
4. Agent TTS 继续按普通 LLM 句子级串行队列播报，完成时冲刷尾句。
5. 非请求状态下角色添加、删除和在线状态仍能完整刷新角色面板。

## 兼容性测试

- 普通 LLM、私聊、群聊和工作 Agent 的流式文本协议不变。
- 控制端播放和显示端 TTS 路由不变。
- Markdown 流式渲染和请求号过滤继续有效。

## 风险评估

- 流式期间不完整刷新角色 tab 结构，新增/删除角色可能延迟到本轮完成后显示；当前在线状态仍即时更新。
- 角色切换期间迟到的 `chatChunk` 继续由 `activeRequestId` 过滤。

## 预计工时

约 1 小时：前端状态刷新、回归测试和文档同步。
