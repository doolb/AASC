# Responses 续接历史重放修复

## 任务描述

修复 `ai.txt` 记录的 Responses 续接异常：后续请求重复带入已完成对话，Qwen 等有原生 session 的 Provider 又把完整历史重新提交，导致网页侧出现重复用户问题或 `Assistant:` 文本。Pi Agent 同时需要在同一运行会话中真正复用 AASC 返回的 `response.id`。

## Design 需求

- 首轮请求发送完整上下文。
- AASC Responses 会话已拥有 Provider 原生续接状态时，只发送本轮新增 input。
- 没有原生续接状态时，使用 AASC 保存的历史重放上下文。
- Pi 以自身 sessionId 隔离续接状态，保存消息快照和 `previous_response_id`；上下文不再是快照前缀时安全回到首轮完整请求。

## Spec 设计

- `chat2api-responses-service` 按 Provider nativeState 选择当前增量或历史合并消息。
- `pi-responses-continuation` 维护消息快照、响应 ID 和前缀匹配逻辑。
- Pi Responses Provider 在 API 请求完成后更新 tracker，并在下一次请求通过 `onPayload` 注入 `previous_response_id`。

## 受影响的功能模块和代码

- `src/apps/server/modules/chat2api/chat2api-responses-service.js`
- `src/apps/server/modules/chat2api/chat2api-responses-service.test.js`
- `src/apps/server/modules/chat/pi-readonly-tools.mjs`
- `src/apps/server/modules/chat/pi-responses-continuation.js`
- `src/apps/server/modules/chat/pi-responses-continuation.test.js`
- 相关 Chat2API Responses design/spec 文档

## 自测用例

1. 首轮 Responses 请求发送完整 input，收到 nativeState 后第二轮只发送新增 user/tool input。
2. Provider 没有 nativeState 时，第二轮仍发送保存的历史和新增 input。
3. Pi 同一 session 的正常追加请求返回上次 responseId 和消息后缀。
4. Pi 上下文压缩、分支变化或无响应 ID 时不携带旧 previous_response_id。
5. Responses 流式文本和 function_call 事件行为不变。

## 兼容性测试

- Qwen、DeepSeek 原生会话续接单元测试。
- `npm run check:chat2api`。
- Node 语法检查和 `git diff --check`。

## 性能测试

- 续接请求不再重复序列化和发送完整历史，检查请求消息数量明显下降。
- tracker 仅保存每个 Pi 进程 session 的消息快照，不写入磁盘。

## 风险评估

- Provider 原生 session 失效时，上游可能拒绝续接；服务保留历史重建所需的本地记录，并在上下文不匹配时主动新建链。
- Pi 上下文被压缩或分支切换后会主动放弃旧 responseId，以保证不会把错误分支增量发送给旧 Responses 链。

## 实施结果

- 已完成 Responses 服务的 Provider 原生续接消息选择，以及 Pi Responses tracker 和 Provider 接入。
- 已新增原生会话增量、无原生会话历史重放、Pi session 隔离和上下文变化重建测试。
- 验证结果：Chat2API 全量检查 64/64；Responses、Provider、Pi 相关定向测试通过；语法检查和 `git diff --check` 通过。
- 真实流程验证：重启 AASC 服务后，独立 Pi RPC 请求成功；控制端带显示端 ID 的请求收到流式回复；同一控制端 session 两轮续接成功，第二轮正确返回首轮记住的 `PI-CONT-20260831`。
- 发现待处理边界：控制端 `chatMessage` 不带 `displayId` 时，服务端当前回退分支提前返回，不会启动 Pi；已登记到 `docs/todo.md`。
- 2026-09-01 补充真实群聊 Pi Agent 只读工具验收：
  - 通过控制端 WebSocket `/control` 发送 `type=chatMessage`、`mode=group`、`assistantType=llm`、当前 `displayId` 和独立 `sessionId`。
  - 测试消息要求 Pi 必须先调用只读 `read` 工具读取项目根目录 `package.json`，再返回 `name` 和 `scripts` 命令列表。
  - 服务端收到 `chatResponse success=true`；返回的 `name=web-mediacenter`，以及 `start`、`restart:server`、`check:chat2api`、`test:log-brain`、`stress:tts`、`build:apk`、`upload:apk`、`start:apk:display` 8 个脚本键，与本地 `package.json` 核对一致。
  - 测试注意：控制端请求必须带当前有效的 `displayId`；缺少该字段时当前回退分支会提前返回，不能据此判断 Pi 工具调用失败。
