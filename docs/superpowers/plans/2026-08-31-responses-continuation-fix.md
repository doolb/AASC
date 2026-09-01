# Responses 续接历史重放修复计划

## 目标

修复 `POST /v1/responses` 续接时重复发送已保存历史，以及 Pi Agent 每轮都重新创建 AASC Responses 链的问题，确保原生 Provider 的会话只接收新增输入。

## 实施步骤

1. 更新设计、实现规范、任务文档和待办记录，明确首轮完整上下文、续接仅发送增量、上下文变化时安全重建的规则。
2. 为 Responses 服务增加回归测试：原生 Provider 续接只接收当前输入；无原生会话 Provider 仍重放本地历史。
3. 为 Pi Responses 续接状态增加纯逻辑测试：记录响应 ID 和已发送消息快照，正常追加时发送消息后缀，压缩或分支变化时清空旧响应 ID 并发送完整上下文。
4. 修改 Responses 服务和 Pi 自定义 Provider，接入上述续接规则，并保持工具调用、流式输出和错误处理不变。
5. 运行定向测试、语法检查、`npm run check:chat2api` 和差异检查。

## 验收标准

- 原生 Provider 的第二轮请求不再携带服务端已经保存的 assistant/user 历史。
- 没有可用原生会话状态的 Provider 仍能通过本地历史获得上下文。
- Pi 同一运行会话的后续请求携带 `previous_response_id` 和新增消息；上下文前缀不匹配时自动回到完整上下文首轮请求。
- 现有 Responses 流式、工具调用和会话持久化测试通过。
