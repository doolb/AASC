# 修复 Claude 超时配置与 Pi 空 Key 聊天无回复

## 任务描述

将 Claude 默认无输出响应超时调整为 600 秒，并修复本地 OpenAI 兼容服务没有 API Key 时 Pi Agent 在 provider 校验阶段直接失败的问题。

## 根因

- `ClaudeBridge` 默认常量为 60000ms，仅 60 秒。
- Pi 自定义 provider 使用空字符串 API Key 时被 Pi 拒绝，错误为 `No API key for provider: aasc-openai`，请求没有到达本地 LLM 服务。

## 实现方案

- Claude 默认 `READ_TIMEOUT_MS=600000`。
- 新增 `normalizePiApiKey()`：空 Key 使用 `aasc-local-key` 占位值，真实 Key 原样传递。

## 受影响的功能模块和代码

- `src/apps/server/modules/ai-roles/claude-bridge.js`
- `src/apps/server/modules/ai-roles/claude-bridge.test.js`
- `src/apps/server/modules/chat/pi-runtime-policy.js`
- `src/apps/server/modules/chat/pi-runtime-policy.test.js`
- `src/apps/server/modules/chat/pi-readonly-tools.mjs`

## 自测结果

- Claude 默认超时和 ClaudeBridge：14/14 通过。
- AI 角色模块：51/51 通过。
- Pi 策略测试：7/7 通过。
- 真实 Pi RPC 使用空 Key 连接本地模拟 OpenAI 流式接口并成功返回文本。
