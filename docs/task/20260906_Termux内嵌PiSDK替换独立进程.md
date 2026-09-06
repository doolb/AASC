# Termux 内嵌 Pi SDK 替换独立进程

## 任务描述

将 Termux Node.js 服务中的 Pi Agent 从 `pi --mode rpc` 独立进程调用替换为当前 Pi Coding Agent SDK 的同进程 `AgentSession`。APK 端本次不改，后续统一规划移动端服务器运行时。

## Design 需求

- Pi Runtime 在服务器 Node.js 进程内创建和复用 SDK AgentSession。
- 保留 profile、模板、权限策略和 conversationKey 隔离。
- 保留请求串行队列、排队超时、请求超时、空回复重试和生命周期日志。
- 只允许固定只读工具：read、grep、aasc_find、ls、aasc_web_search、aasc_web_fetch。
- 禁用扩展、skills、prompt templates、themes、项目上下文文件和磁盘会话。
- Provider 使用当前 profile 的 API 地址、模型和 API Key，不通过子进程环境传递凭据。

## Spec 设计

- 使用 `ModelRuntime.registerNativeProvider()` 注册 AASC Responses Provider。
- 使用 `DefaultResourceLoader` 的禁用选项隔离外部资源。
- 使用 `SessionManager.inMemory()` 和 `SettingsManager.inMemory()`。
- 使用 `AgentSession.subscribe()` 转换 text_delta/agent_end 事件。
- 使用 `AgentSession.abort()` 和 `dispose()` 完成超时、失败和服务器退出回收。

## 受影响功能模块和代码

- `src/apps/server/modules/chat/pi-runtime-manager.js`
- `src/apps/server/modules/chat/pi-readonly-tools.mjs`
- `src/apps/server/modules/chat/pi-runtime-manager.test.js`
- `tests/pi-runtime-manager-sdk.test.js`
- `package.json`
- `package-lock.json`
- `docs/design/llm-agent-mode.md`
- `docs/spec/llm-agent-mode.md`
- `docs/task/20260906_Termux内嵌PiSDK替换独立进程.md`
- `changelog.md`

## 自测用例

1. 默认超时和 SDK Runtime 实例化。
2. SDK `message_update` 增量转发与 `agent_end` 完成。
3. 同 conversationKey 复用 AgentSession，续聊只发送当前消息。
4. 空回复销毁旧会话并自动重建一次。
5. 排队超时不调用后续 `session.prompt()`。
6. 服务器停止调用 `abort()`/`dispose()`。
7. 真实 SDK 创建只读工具白名单 AgentSession。
8. 只读工具模块不开放 bash/edit/write。

## 兼容性测试

- Node.js 22.19+；Termux 当前 Node.js 25.x 满足 SDK 要求。
- CommonJS 服务通过动态 `import()` 加载 ESM Pi SDK 和工具模块。
- 旧 profile 的 `mode`/`backend` 默认行为不变。
- APK、Codex Runtime、普通 LLM HTTP 路径不改。

## 性能测试

- 对比独立进程方式，单轮请求不再产生 Pi CLI 进程和 JSONL stdin/stdout 转换。
- 通过 SDK 烟测确认 AgentSession 创建和工具注册耗时可接受。
- 暂不执行真实模型压测，避免测试请求写入生产会话或消耗模型额度。

## 风险评估

- SDK 版本升级可能改变 `AgentSession` 事件或资源加载接口；依赖版本锁定为 0.84.2，并保留注入式测试。
- AgentSession dispose 失败只记录日志，不阻塞服务器关闭。
- Provider 或 SDK 初始化失败不会回退到直接 LLM，避免绕过权限策略。
- APK 尚未接入 SDK；移动端服务器需求在后续任务单独设计。

## 预计工时

约 4 小时，包含 SDK API 核对、运行时替换、测试和文档同步。

## 完成情况

- ✅ 已完成 SDK 依赖接入、Pi Runtime 替换、只读工具工厂导出和测试。
- ✅ 已完成 design/spec/task/changelog 同步。
- ✅ 已验证定向测试和真实 SDK 初始化烟测。
