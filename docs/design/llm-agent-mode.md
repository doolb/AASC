# LLM 配置 Agent 模式设计文档

## 需求概述

普通聊天的每个 LLM profile 增加独立调用模式。`llm` 模式继续直接调用 profile 配置的 OpenAI 兼容接口；`agent` 模式支持 Pi 或 Codex，由服务器进程分别管理 Pi RPC 子进程或 Codex app-server 子进程。

Agent 用于扩展普通 LLM 的能力，例如文件搜索和网络查询。Agent 只允许只读工具，不能修改文件、执行 shell 命令或加载项目中的外部 Agent 配置。

## 范围与边界

### 本次实现

- LLM profile 增加 `mode: 'llm' | 'agent'`，默认 `llm`。
- `agent` 模式接受 `backend: 'pi' | 'codex'`；缺少 backend 的旧 Agent profile 仍默认为 Pi。
- 普通聊天和工作 Agent 的 Codex 统一使用 `chat.codexProxy`，当前配置为 `http://127.0.0.1:7899`；配置变更后由新建或重启的 Codex 进程生效。
- 每个 profile 按聊天会话管理对应 Agent 进程和内存会话：群聊共用一个，私聊按助手角色独立；模式或角色切换时回收旧会话，下一次请求重新创建进程。
- Pi 请求使用当前 profile 的 `apiUrl`、`model`、`apiKey`、`maxTokens`、`temperature`；Codex 请求使用本机 Codex CLI 的登录和模型配置，profile 的显示配置仍参与 profile/session 隔离。
- 当前聊天会话的系统提示词、最近 `contextCount` 条聊天记录和当前用户消息传入 Agent。
- profile 之间的聊天历史和 Agent 会话隔离；工作 AI 角色的历史和进程不参与普通 LLM Agent。
- 权限策略绑定到聊天模板/角色，由控制端直接设置；Pi 按模板策略启用工具。
- 当前先提供 `readonly` 只读策略，包含 `read`、`grep`、稳定的 `aasc_find` 文件查找、`ls` 和服务器提供的受限网络查询工具；Chat2API 的 `find` 标签在 Provider 边界映射为 `aasc_find`。
- Pi 使用 profile 的 API 地址和模型；本地 OpenAI 兼容服务未配置 API Key 时，使用固定本地占位 Key 通过 Pi provider 校验，真实 Key 仍按 profile 配置传递。
- 服务器负责 Pi 进程的启动、RPC 通信、异常回收、配置变更重启和服务器退出清理。
- 服务器负责 Codex app-server 的启动、JSON-RPC 通信、threadId 会话复用、异常回收和服务器退出清理；普通聊天 Codex 使用只读沙箱，不复用工作 Agent 的 Codex 进程。两类 Codex 进程共享代理配置，但不共享进程、threadId 或权限策略。
- Chat2API 返回的标签式工具调用在 Pi Provider 边界转换为 Pi 原生 `ToolCall`，避免工具标签进入聊天文本和 TTS；只转换当前只读白名单中的工具。
- Pi Agent 请求记录 requestId 生命周期日志，覆盖排队、启动、收到关键 RPC 事件、完成、失败和超时；错误型空 `agent_end` 必须作为失败回传，不能伪装成空成功回复。
- 控制端聊天输入和 `chatResponse` 记录同一 requestId，便于区分 Pi 未返回、服务器处理失败和前端丢弃迟到回包。
- Pi 请求增加独立排队超时，避免前一个请求异常时后续请求无限等待；空回复、RPC 错误或协议错误会销毁当前会话，空回复/可恢复 RPC 错误最多自动用新会话重试一次。

### 不在本次实现

- 不修改已有工作 AI 角色的 Codex/Claude 后端选择。
- 当前不开放 `bash`、`edit`、`write`、任意外部扩展、项目 `.pi` 配置和上下文文件；后续命令策略只增加显式注册的服务器工具。
- 不提供文件写入、代码修改、命令执行、进程管理或任意 URL 代理能力。
- 不修改已有工作 AI 角色的 Codex/Claude 后端选择，也不让普通聊天 Codex 复用工作 Agent 的 threadId。

## 配置模型

```text
chat.llmProfiles[] = {
    name,
    apiUrl,
    model,
    maxTokens,
    temperature,
    apiKey,
    contextCount,
    promptFormat,
    mode: 'llm' | 'agent',
    backend: 'pi' | 'codex'    // mode='agent' 时可选，缺省为 pi
}

chatTemplates[] = {
    id,
    name,
    content,
    permissionProfile: 'readonly'  // 当前控制端可设置的 Agent 权限策略
}
```

旧 profile 缺少 `mode` 时按 `llm` 兼容。旧的全局 `chat.agentBackend` 只继续服务工作 AI 角色，不参与普通 profile 的 Agent 模式。

## 架构方案

```text
控制端 profile 选择
    ↓ chatMessage
server-app -> llm-service 当前 profile
    ├─ mode=llm   -> OpenAI 兼容 HTTP/SSE 接口
    ├─ mode=agent/backend=pi    -> PiRuntimeManager
    │                              └─ pi --mode rpc（服务器子进程，固定只读工具）
    └─ mode=agent/backend=codex -> CodexRuntimeManager
                                   └─ codex app-server --stdio（服务器子进程，独立 threadId + 只读沙箱）
```

通用 `PiRuntimeManager` 在服务器进程内维护 `(profileName, templateId, permissionProfile, conversation) -> PiSession` 映射，聊天只是第一个调用方。后续服务器内置命令可以复用 Runtime，但必须使用自己的上下文和工具策略。Pi 不使用 detached 进程；服务器退出时逐个发送 abort/关闭 stdin 并回收子进程。单个 session 的并发请求串行化，避免上下文和响应互相污染。单次 Pi RPC 请求默认使用 600 秒超时；测试或特殊调用可以注入更短的超时，超时后终止当前子进程并在下一次请求时重建。排队等待默认最多 30 秒，排队超时不启动该请求。空回复或可恢复 RPC 错误会先终止当前 session，再自动重试一次；重试仍失败才通知上层。

## Pi 权限边界

Pi 启动时固定使用以下约束：

- `--mode rpc`：仅通过 JSONL stdin/stdout 通信。
- `--no-session`：不让 Pi 持久化独立会话文件；会话只存在于服务器运行期间。
- `--no-context-files`：不读取项目 `AGENTS.md`/`CLAUDE.md` 等上下文文件。
- `--no-extensions` 加载项目内置只读扩展：不接受用户 profile 自定义扩展。
- `--tools read,grep,aasc_find,ls,aasc_web_search,aasc_web_fetch`：白名单之外的工具不可用；不启用 Pi 原生依赖 `fd` 的 `find`，避免工具首次运行时下载失败。
- 工作目录固定为项目根目录；Pi 内置文件工具不开放写入工具，服务器不加载项目外部 Agent 扩展或上下文文件。
- API Key 通过 Pi 子进程环境传入，不拼接在命令行参数中。

网络工具只允许 GET 请求，限制 `http/https` 协议、响应体大小、重定向次数和请求超时；网络工具不会写入文件，也不会执行响应内容。文件搜索由项目内置的 `aasc_find` 只读工具完成，使用 Node 文件系统遍历和 glob 匹配，不依赖外部 `fd` 下载。Chat2API 的 `find` 调用转换为 `aasc_find`，服务器根据模板的 `permissionProfile` 选择固定工具集合，不接受前端任意工具名。

## 上下文与历史

### 发送给 Agent 的内容

首次 Agent 会话初始化时包含当前 profile 的系统提示词、角色模板和当前聊天会话的必要历史；重建文本统一使用 `User:`/`Assistant:` 标记。Pi 初始请求包含完整重放文本，后续只发送带 `User:` 前缀的当前用户消息；Codex 初始 thread 使用 developer instructions 接收系统提示词，首轮 turn 接收历史和当前消息，后续 turn 只接收当前消息。两种进程都继续保留自己的上下文，工具调用结果不写入普通聊天历史。

Pi RPC 原生提供 `compact` 命令，可将较早对话压缩为摘要并保留最近上下文；当前 `PiRuntimeManager` 暂不主动调用该命令，也不增加控制端入口，仍由 Pi 在接近上下文上限时按自身策略自动处理。后续若启用主动压缩，需要保证压缩请求与当前聊天 session 串行，并向控制端回报压缩状态。

Pi 会话键包含 profile、模板、权限策略和聊天会话（群聊或私聊的 target/sessionId），避免不同私聊会话共享上下文。服务器重启、配置变化或删除任意一轮对话后，旧 Pi 会话被回收；下一次请求按剩余应用历史重新初始化一次。

### profile 和模板隔离

聊天历史键包含 profile 名称和模板/角色名称。切换 profile 或模板后，只读取对应上下文；切换回原 profile/模板后恢复原上下文。权限策略变化不会复用旧 session，避免旧 session 保留超出新策略的工具。旧历史记录没有 profile/template 字段时，在首次加载时归属启动时的 active profile 和默认模板，保证旧版本用户仍能看到已有聊天。

## 错误处理

- Pi/Codex 不存在、启动失败、provider/app-server 配置失败、RPC JSONL 解析失败、超时或异常退出：当前请求返回失败消息，并清理该 profile 的进程。
- Agent 模式失败不回退为直接 LLM 请求，避免绕过只读权限和用户选择的执行模式。
- 一个 profile 的 Agent 失败不影响其他 profile 或普通 LLM 请求。
- 服务器关闭时清理全部 Pi/Codex 进程；清理失败记录日志，但不阻塞服务器退出。
- Chat2API 工具标签格式错误、参数无法解析或工具名不在只读白名单时，禁止执行并返回明确的 Agent 错误，不把原始协议标签作为助手文本输出。
- Pi 返回 `agent_end` 时，如果最后助手消息为错误停止原因、携带错误消息或最终文本为空，当前请求返回失败；`willRetry` 事件不提前结束仍可重试的请求。
- 请求失败时当前 Pi session 立即回收，避免异常上下文被后续请求复用；排队超时直接失败并释放排队任务，不占用 Pi 并发队列。空回复和可恢复 RPC 错误自动新建 session 重试一次，超时、协议错误和配置错误不盲目重试。
- Pi 诊断日志只记录 requestId、事件类型、长度和错误摘要，不记录完整 prompt、API Key 或完整敏感响应内容。

## 单轮对话删除

控制端可以删除当前显示的任意一轮对话。单轮以一条用户消息为起点，删除该用户消息及其紧随其后的助手回复；助手尚未回复时只删除用户消息。删除中间轮次不影响前后消息。服务器按消息 ID 和会话范围执行删除，并重置对应 Pi 内存会话，防止被删除内容继续参与后续回答。

## Chat2API 工具协议转换

部分 Chat2API/OpenAI 兼容网关不会返回标准 `message.tool_calls`，而是把工具调用编码在助手文本中；网关可能使用旧式参数标签，也可能使用带名字和 CDATA 的参数标签：

```text
<|CHAT2API|tool_calls><|CHAT2API|invoke name="read"><|parameter=path>
/mnt/AASC/package.json
</parameter>
</function>
```

命名参数格式示例：

```text
<|CHAT2API|tool_calls><|CHAT2API|invoke name="find"><|CHAT2API|parameter name="pattern"><![CDATA[package.json]]></|CHAT2API|parameter></|CHAT2API|invoke></|CHAT2API|tool_calls>
```

Pi 的工具执行依赖 Provider 输出的原生 `ToolCall` 内容块。因此在 Pi 扩展注册的 `aasc-openai` Provider 内包装 OpenAI Completions 流：先让标准适配器完整读取模型响应，再解析 Chat2API 标签，将参数映射为 JSON 对象并生成 Pi 工具调用事件；普通文本保持原样，协议标签不向上层暴露。

转换只允许服务器根据权限策略下发的只读工具集合；工具调用 ID 在一次响应内稳定生成，支持同一响应中的多个调用。转换器本身保持纯函数，服务器侧单元测试覆盖两种参数格式、完整响应、分片后合并、普通文本、多个调用、非法工具和非法参数。

## UI 设计

LLM profile 编辑器增加“调用模式”：

- `直接 LLM`：保持现有 HTTP API 行为。
- `Agent`：使用 profile 的服务器配置启动所选 Agent 后端；具体工具权限从当前聊天模板/角色读取。
- Agent 模式下增加“Agent 后端”选择：`Pi` 或 `Codex`，分别使用 `PiRuntimeManager` 或 `CodexRuntimeManager`；旧 profile 缺少该字段时默认 Pi。
- 直接 LLM 模式隐藏 Agent 后端选择，避免保存无效的后端字段。
- profile 列表显示实际模式和后端，避免当前配置为 Codex 时仍显示成 Pi。

聊天模板/角色编辑器增加“Agent 权限”选择。当前只显示“只读”，并说明可进行文件读取/搜索和受限网络查询，不能修改文件或执行命令；后续内置命令策略也从这里设置。当前不实现管理员权限和用户身份鉴权，控制端设置即作为配置来源。profile 列表显示当前 profile 的调用模式。

## 高级指令路由与 Pi Agent

天气、搜索等高级指令继续使用控制端保存的 `system/llm` 路由设置。`system` 设置保持原有服务器内置命令处理，不因当前 profile 是 Pi Agent 而改变；设置为 `llm` 时，普通 LLM 继续按原流程执行，Pi Agent profile 则跳过控制端旧的天气/搜索处理器，由当前 Pi 对话处理，避免同一条消息被旧命令链和 Pi 重复处理。该判断只影响当前消息，不修改持久化路由配置。

## 验收标准

- 旧 profile 无 `mode` 时仍能直接调用 LLM。
- `mode=llm` 不启动 Pi，不改变现有请求体和流式回包。
- `mode=agent` 不调用 `apiUrl` 的普通聊天路径，而是启动对应 profile 的 Pi RPC 子进程。
- 两个 Agent profile 的 API 地址、模型、Key、会话和历史互不混用。
- 模板设置的 Agent 可以调用对应策略允许的工具；当前只读策略没有 bash、edit、write 工具。
- Agent 尝试修改文件或执行命令时无法获得对应工具。
- Pi 失败后前端收到失败回包，服务器可在下一次请求重新启动该 profile。
- 服务器退出后不存在由本功能遗留的 Pi 子进程。
