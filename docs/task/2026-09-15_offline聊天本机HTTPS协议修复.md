# offline 聊天本机 HTTPS 协议修复

## 任务描述

修复 offline APK 发送聊天消息后没有回复的问题。现有配置可能指向 `http://设备地址:8081/v1/chat/completions`，但 APK 内置 Node 服务因加载证书而使用 HTTPS，导致聊天客户端 HTTP 连接被重置；直接使用 HTTPS 又不能通过自签名证书校验。

## design 需求

- offline server-app 启动聊天服务时注入内置 LLM 的本机协议、端口和当前设备地址。
- 仅将本机 `8081` 的历史 HTTP 配置归一化到 HTTPS 回环地址。
- 本机内置目标允许受限的自签名证书连接；外部 LLM 地址不关闭 TLS 校验。
- Chat Completions 与 Responses 使用同一传输策略。
- 失败通过现有 WebSocket `chatResponse(success=false)` 回传。

## spec 设计

```text
chat.init(config, runtimeOptions):
  保存 offlineNodeMode、localLlmBaseUrl、localLlmHostnames

normalizeChatTransport(profile):
  归一化 profile.apiUrl
  if offline 且目标主机是回环/当前设备地址且端口为内置端口:
    返回内置 HTTPS 回环 baseUrl、Chat Completions requestUrl
    返回 requestOptions.rejectUnauthorized=false
  else:
    返回原地址和空 requestOptions

Responses 与 Chat Completions:
  调用 Node HTTP/HTTPS 客户端时传入 requestOptions
  连接错误由上层 onError 发送 chatResponse 失败消息
```

## 受影响的功能模块和代码

- `src/apps/server/boot/server-app.js`
- `src/external/llm/llm-service.js`
- `src/external/llm/llm-responses-client.js`
- `src/apps/server/modules/task-engine/builtin-tasks/llm-chat.js`（如共享传输入口需要兼容）
- `src/external/llm/llm-service-responses.test.js`
- `src/external/llm/llm-responses-client.test.js`
- `tests/chat-config-transport.test.js`
- 对应 design/spec、`docs/todo.md`、`changelog.md`

## 自测用例

1. offline 设备地址 HTTP 配置归一化为 `https://127.0.0.1:8081/v1`。
2. 非 offline 或外部 LLM 地址保持原协议和 TLS 校验。
3. Responses 非流式请求可通过本机自签名 HTTPS 返回 `output_text`。
4. Responses 流式请求可接收 delta 和完成事件。
5. Chat Completions 流式聊天能触发 `chatResponse`。
6. 真机 Display 2 发送聊天消息后收到完整回复。

## 兼容性测试

- 普通桌面 HTTP/HTTPS LLM profile。
- offline APK 既有 `http://设备地址:8081` 配置和新建 `https://127.0.0.1:8081` 配置。
- Android 9/API 28、Display 2。

## 性能测试

- 本机聊天首个响应不增加额外网络跳转。
- 流式回复持续收到 chunk 时不触发固定总时长超时。
- 保持已有 MNN 推理和 ASR/TTS 资源占用不变。

## 风险评估

- `rejectUnauthorized=false` 只能由 offline 内置目标传输上下文注入，不能成为全局 Node TLS 默认值。
- 设备地址识别错误时应保留原 URL并返回连接错误，不能误改写外部服务。
- 旧 Responses 会话状态继续按 profile 和实际 baseUrl 隔离，协议修正后必要时自动重建会话。

## 预计工时

约 1 小时，含回归测试、offline APK 构建和 Display 2 真机验证。

## 执行结果

- 发现并修复两处连续阻断：offline 本机历史 HTTP/设备地址配置没有转换到内置 HTTPS 回环；WSViewBind 控制端 `chatMessage` 注册后没有进入回退处理函数。
- `llm-service` 和 Responses 客户端现在只对 offline 内置目标使用回环地址及受限自签名证书选项；控制端和旧显示端 WebSocket 入口统一调用 `handleChatMessageRequest`。
- 相关回归测试 72/72 通过；JavaScript 语法检查和 `git diff --check` 通过。
- 使用最新 server package 重新构建 offline APK，安装到 `192.168.1.6:5555` 的 Display 2 后，8081 HTTPS、`/v1/models`、流式 `chatChunk` 和最终 `chatResponse(success=true)` 均通过。
- 最终 APK：`src/apps/android-display/app/build/outputs/apk/offline/aasc-display-offline.apk`；SHA-256：`09bbef2d8df7454422a45d6add2ebbdf09ecf959f7db3e7e377a7764abea82f2`。
