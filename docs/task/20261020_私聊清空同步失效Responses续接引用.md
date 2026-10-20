# 私聊清空同步失效 Responses 续接引用

日期：2026-10-20

## 任务描述

用户清空妲己私聊后，下一轮模型仍带旧历史。控制端清空请求正确携带 `mode=private`、`target` 和 `sessionId`，服务端也删除了本地消息；但同一会话在 `chat-responses-sessions.json` 的续接引用没有删除，下一轮仍可能发送旧 `previous_response_id`。

## Design 需求与 Spec 设计

见 `docs/design/chat-system.md` 和 `docs/spec/chat-system.md`。清空指定私聊时，按完整模式、角色和会话 ID 匹配所有 profile/模板的 Responses 引用，删除后持久化；其他会话保留。下一轮请求从已清空的本地历史建立新上游会话。

## 受影响模块与代码

- `src/external/llm/llm-service.js`：在 `clearHistory()` 中同步失效对应 Responses 续接引用。
- `src/external/llm/llm-service-clear-history.test.js`：隔离配置目录和本地 HTTP 模型，验证多个 profile/模板的引用清除、其他会话继续续接，以及新请求不含旧引用和旧历史。
- 同步 chat-system design/spec、usage、todo、changelog 与 Offline 服务包状态。

## 自测用例、兼容性测试与性能测试

定向运行 Responses 与清空历史测试；核对同角色其他私聊会话、其他角色、群聊的引用不被误删。清空仅遍历本地会话引用并写入一次状态文件，不新增网络请求。

## 风险评估与预计工时

清空后会开启新的上游会话，但不影响其他本地会话。历史删除和引用文件写入分属两个本地文件，若磁盘写入失败需沿用现有日志排查。预计约一小时。

## 执行结果

Responses 与清空历史测试 12/12、`npm run test:game-chat` 44/44 通过；服务包待构建，真实私聊仍待更新服务后验收。
