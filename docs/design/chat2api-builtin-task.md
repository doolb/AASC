# Chat2API 核心内置任务设计

## 需求概述

将 Chat2API 的 Provider、OAuth、账号、API Key、负载均衡和 OpenAI 兼容代理能力移植到 AASC，封装为 AASC 的常驻内置任务 `chat2api.proxy`。运行时不读取 `/mnt/Chat2API`，不启动 Electron，也不依赖独立 Chat2API 进程。

## 范围与边界

### 本次范围

- 内置常驻任务：启动、停止、重启和状态展示。
- OpenAI 兼容接口：`/v1/chat/completions`、`/v1/models`、`/v1/completions`。
- OpenAI Responses 兼容接口：`/v1/responses`，面向 Pi Agent 支持输入转换、非流式/流式输出和会话续接。
- Chat2API 当前 Provider：DeepSeek、GLM、Kimi、Mimo、MiniMax、Perplexity、Qwen、Qwen AI、Z.ai。
- Provider 配置、账号凭据、账号状态和多账号负载均衡。
- OAuth 登录流程及登录状态回调。
- API Key 创建、启用、禁用、删除和请求鉴权。
- 流式 SSE、非流式响应、模型映射、失败切换和请求统计。
- AASC 控制端任务面板配置，不移植 Chat2API Electron/React 界面。

### 不在范围

- 不保留 Electron 主进程、窗口、托盘、IPC 和独立 React 应用。
- 不依赖 `/mnt/Chat2API` 的源码路径、`node_modules` 或运行进程。
- 不把 Chat2API 的日志文件、构建产物和桌面更新器带入 AASC。
- 原始请求/响应调试日志默认关闭；开启后只写入 AASC 服务日志，并对凭据字段脱敏、按请求限长。
- 不改变 AASC 现有 LLM profile、Pi Agent 和统一 TTS 的默认行为。

## 上游同步策略

```text
3rd/chat2api-core/       上游核心源码快照，仅保留 GPL 相关文件和核心模块
src/apps/server/modules/chat2api/  AASC 适配层、配置桥接、生命周期和管理接口
src/apps/server/modules/task-engine/builtin-tasks/chat2api-proxy.js  内置任务入口
src/apps/web-mediacenter/ui/public/js/chat2api.js  控制端面板逻辑
```

- `3rd/chat2api-core` 保存上游版本号、上游 commit 和许可证说明。
- 上游来源文件原则上不直接改动；AASC 差异放在适配层或独立补丁中。
- 同步上游后先运行核心协议、Provider、OAuth、流式响应和任务生命周期测试，再更新适配层。
- Chat2API GPL-3.0 许可证和版权声明随移植代码保留；发布包提供对应源代码和修改说明。

## 系统架构

```text
控制端任务面板
    ↓ task:start / widget action
AASC TaskManager
    ↓ builtin task mode=service
Chat2APIProxyService
    ├─ OpenAI compatible routes
    ├─ API key middleware
    ├─ Provider registry + account store
    ├─ OAuth manager + callback session
    ├─ Load balancer + model mapper
    └─ stream/response adapters
         ↓
    DeepSeek / GLM / Kimi / Mimo / MiniMax / Perplexity / Qwen / Z.ai
```

控制端请求链路：

```text
控制端 HTTPS 页面
    ↓ /api/chat2api-gateway/{instanceId}
AASC 主服务 HTTPS
    ↓ 仅允许运行中的 chat2api.proxy + 回环端口
Chat2API 代理 HTTP 127.0.0.1:{port}
```

内置任务启动独立的代理 HTTP Server，默认监听 `127.0.0.1:8080`，端口和监听地址可配置，避免占用 AASC 主服务端口。任务停止时关闭代理、OAuth 临时回调和活动连接，并清理内存中的敏感状态。

## 配置与数据

```text
~/.config/aasc-user/chat2api/
    config.json       代理地址、端口、超时、负载均衡、API Key 开关和原始流量调试配置
    providers.json    Provider 定义和启用状态
    accounts.json     账号凭据、启用状态和健康状态
    api-keys.json     AASC 代理访问密钥
    model-mappings.json 代理模型到 Provider/上游模型的映射
    responses-sessions.json Responses conversation、response 链和 Provider 原生会话状态
    oauth-sessions/   临时 OAuth 状态，完成或超时后删除
```

- 凭据文件创建目录后设置用户私有权限，日志和控制端响应不得输出完整 Token、Cookie 或 API Key。
- 支持导入 Chat2API 导出的 Provider/账号数据；导入采用预览、确认、写入三步，失败不覆盖原数据。
- 支持从原 Chat2API Electron Store 的 `data.json` 自动读取并预览迁移；不迁移原 API Key、日志、会话和 Electron 状态。
- 迁移 `userModelOverrides.*.addedModels` 中的用户模型别名，例如 `Qwen3.6-Flash → Qwen3.7`，并保留 Provider 归属。
- 用户模型映射指定 Provider 后，路由按该 Provider 的活动账号选择，不要求别名出现在内置模型清单中。
- 负载均衡候选生成时先复用统一模型映射器解析 `actualModel`，保持原版“Provider 内置映射 → 全局映射 → 原始模型”的优先级；候选选择和最终 Provider 请求使用同一个实际模型。
- 所有内置 Provider 均按原版选择专用请求/响应适配；DeepSeek、GLM、Kimi、MiMo、MiniMax、Perplexity、Qwen AI 和 Z.ai 分别保留其会话、签名、Cookie、gRPC/HTTP2、SSE 或轮询协议边界，统一转换为 OpenAI 输出。
- 所有网页 Provider 的工具调用均由核心适配层统一转换为 Chat2API `managed_xml` 标签提示；Provider 请求移除原生 `tools`/`tool_choice`，不再由单个 Qwen adapter 独立注入。
- Qwen Provider 按 `/api/v2/chat` 原生协议生成请求参数，解压 gzip/deflate/br 后兼容 `data.messages`、`multi_load/iframe`、SSE 累计内容和思考标记，避免通用 OpenAI 解析得到空回复。
- 旧 AASC LLM 配置继续有效；Chat2API 代理作为独立服务，不自动替换当前 profile。

### Responses 会话兼容设计

Responses 层的 `conversation` 和 `previous_response_id` 是 AASC 代理自己的逻辑标识，不直接假定各 Provider 存在统一的 `session_id`。代理为每个 Responses 会话保存 Provider、账号、实际模型、历史消息、最近响应 ID 和 Provider 原生状态。

```text
Responses conversation / previous_response_id
    ↓
AASC responses-sessions.json
    ├─ providerId + accountId + actualModel
    ├─ history（用于无原生会话 Provider 的上下文重放）
    ├─ latestResponseId
    └─ nativeState（Provider 专用 session/chat/conversation/parent 标识）
         ↓
Provider adapter
```

- Qwen 使用 `session_id`、`parent_req_id` 和响应中的 `communication.reqid/sessionid`。
- DeepSeek 使用 `chat_session_id`、`parent_message_id`；Mimo 使用 `conversationId`；MiniMax 使用 `chat_id`。
- Qwen AI、Z.ai、Kimi 使用各自的 `chat_id` 及消息父子标识；GLM、Perplexity 如果原生状态无法可靠续接，则重放 AASC 保存的历史消息。
- 会话优先固定到首次选择的 Provider 账号；账号不可用时允许切换账号并重放历史，同时清空失效的原生状态。
- `store=false` 不阻止 AASC 为完成 Provider 续接而保存最小会话状态；Responses 的返回对象仍标记调用方请求的 `store` 值。
- Responses 服务区分 Provider 原生续接和历史重放：`nativeState` 有效时只把本轮新增 input 交给 Provider，原生状态缺失时才把保存的历史与新增 input 合并，避免 Qwen 等 Provider 的原生 session 再次收到重复 assistant/user 历史。
- Responses 会话的工具提示由核心适配层统一注入，并在 `nativeState` 保存工具集合指纹；原生会话的后续增量请求不重复注入，兼容旧会话时避免再次追加重复 `System`。
- 当前只实现 Pi Agent 所需的 Responses 兼容子集，不实现后台响应、内置工具、Conversations CRUD 和响应查询/删除管理 API。
- 2026-08-31 已通过 `npm run restart:server` 重启实际主服务，并确认运行中的 Chat2API 代理根路径已加载 `/v1/responses`。
- 2026-08-31 使用已配置的 Qwen3.6-Flash 完成真实非流式首轮、`previous_response_id` 续聊和流式 SSE 验证。
- 2026-08-31 修复 Responses 续接的历史重复：原生 Provider 只接收新增 input，Pi 按 sessionId 复用 `previous_response_id`，上下文变化时安全重建 Responses 链。

### 原始请求/响应调试日志

控制端在 Chat2API 配置中提供“记录原始请求/响应”开关和单次请求最大日志字节数。开关默认关闭，关闭时不序列化请求体、不读取响应流内容，也不增加原始流量日志。开启后，统一 HTTP 追踪层记录每个 Provider 预处理请求和最终聊天请求的脱敏 URL、方法、请求头、请求体，以及响应状态、响应头和原始响应流块；每条记录带有 AASC `requestId`、Provider ID 和内部请求序号。

日志只进入服务端普通日志，不返回给调用方。`Authorization`、`Cookie`、Token、Ticket、签名、API Key、密码等字段以及 URL 中同类查询参数统一替换为 `[REDACTED]`；单次请求的请求体和响应流共享最大字节预算，超过后停止记录并标记 `truncated`，避免聊天内容或二进制响应无限增长。日志追踪失败不得影响正常 Provider 请求。

## 控制端设计

任务卡片显示运行状态、监听地址、活动连接、请求统计和当前 Provider/账号使用情况，并提供：

- 代理启动/停止、端口和 API Key 开关。
- Provider 列表、模型映射和账号启用/禁用。
- OAuth 登录、回调状态和账号刷新。
- API Key 创建、复制、禁用和删除。
- 上游版本、数据导入和健康检查入口。
- 原 Chat2API 数据一键导入：读取同用户 `~/.chat2api/data.json`，迁移 Provider、账号、模型映射和代理基础配置。
- 控制端管理请求通过 AASC 主服务同源 HTTPS 网关转发，Chat2API 代理保持本机回环监听。
- 账户管理弹窗使用独立语义样式和控制端主题变量，随深色、浅色及扩展主题同步切换。
- 账户管理页面的响应式布局在窄屏下切换为单列，配置表单和列表操作保持可读、可操作。
- 模型映射区域支持手动新增、编辑和删除，并可指定优先 Provider 与账号。

敏感凭据只允许写入专用表单，列表只显示脱敏值；控制端不把完整凭据写入普通任务参数或任务日志。

## 错误处理与安全

- 端口占用、Provider 配置错误、OAuth 超时、上游鉴权失败和流式协议错误分别返回可定位错误。
- 单个账号失败进入冷却或故障转移，不影响同 Provider 其他账号和其他 Provider。
- 代理未启动时管理接口可读取配置，但聊天接口返回明确的服务未运行错误。
- OAuth 回调使用一次性 state、过期时间和 Provider 绑定，禁止跨 Provider 串用。
- API Key 比对使用恒定时间比较；管理接口使用独立管理鉴权，不复用代理访问密钥。
- 服务停止和 AASC 重启时关闭所有监听器、SSE 流和 OAuth 回调，避免残留端口和敏感数据。

## 验收标准

- AASC 不启动 `/mnt/Chat2API`，单独启动 `chat2api.proxy` 即可提供代理服务。
- 非流式和流式 `/v1/chat/completions` 均能返回标准 OpenAI 格式。
- Provider、账号、模型映射、API Key 和 OAuth 管理可从 AASC 控制端完成。
- 多账号轮询、故障转移和请求统计有效。
- 停止任务后端口释放，重新启动不会重复注册路由或 OAuth 回调。
- 上游同步后，适配层回归测试能发现协议、字段和 Provider 行为变化。
