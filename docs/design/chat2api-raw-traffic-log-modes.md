# Chat2API 原始流量日志模式设计

## 需求概述

为 Chat2API 原始流量调试日志增加“完整”和“简洁”两种模式。完整模式保持现有排障能力；简洁模式只输出 Provider 请求的模型、文本、可用的会话 ID 和最终输出，不输出 URL、请求头、Cookie、Token、原始响应体或逐块流量。

## 范围

- Chat2API 配置增加 `rawTrafficMode`，可选 `full` 或 `compact`，默认 `full`。
- 控制端配置弹窗可以切换日志模式。
- 简洁模式对非流式请求输出一条请求记录和一条响应记录；流式请求聚合后只输出最终结果。
- 简洁模式从 Provider 请求或响应的已知会话字段提取 `sessionId`；Pi 请求额外记录上下文 metadata 提供的 `piSessionId`；没有对应 ID 时不输出空字段。
- 保留原有敏感信息脱敏、日志字节上限和日志异常隔离。

## 不在范围

- 不改变 Provider 请求内容和响应解析行为。
- 不删除完整模式的 URL、请求头和原始流量能力。
- 不记录新的 API Key、Cookie 或其他凭据。

## 数据流

```text
Chat2API 配置 rawTrafficMode
    └─ Provider adapter
            └─ Raw traffic logger
                ├─ full: 原始请求/响应/流块
                └─ compact: model + text + sessionId? + piSessionId? -> output + sessionId? + piSessionId?
```

## 验收标准

- 默认仍为完整模式，已有测试和日志格式不变。
- 简洁模式日志数据只包含请求 `model/text`、可选 `sessionId`/`piSessionId` 和响应 `output`、可选 `sessionId`/`piSessionId`。
- 简洁模式不出现 URL、请求头、Cookie、Token、原始响应块。
- 非流式、普通 SSE 和压缩 SSE 均可聚合最终输出；无法解析的流只记录安全的完成/错误文本。
- 控制端可以读取和保存模式，非法模式被拒绝。
