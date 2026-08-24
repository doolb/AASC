# LLM 配置 Agent 模式设计文档

## 需求概述

普通聊天的每个 LLM profile 增加独立调用模式。`llm` 模式继续直接调用 profile 配置的 OpenAI 兼容接口；`agent` 模式暂只支持 Pi，由服务器进程直接管理 Pi RPC 子进程，使用同一个 profile 的服务器地址、模型、API Key、Token 和温度配置。

Agent 用于扩展普通 LLM 的能力，例如文件搜索和网络查询。Agent 只允许只读工具，不能修改文件、执行 shell 命令或加载项目中的外部 Agent 配置。

## 范围与边界

### 本次实现

- LLM profile 增加 `mode: 'llm' | 'agent'`，默认 `llm`。
- `agent` 模式暂只接受 `backend: 'pi'`。
- 每个 profile 独立管理一个 Pi RPC 进程和内存会话。
- Agent 请求使用当前 profile 的 `apiUrl`、`model`、`apiKey`、`maxTokens`、`temperature`。
- 当前聊天会话的系统提示词、最近 `contextCount` 条聊天记录和当前用户消息传入 Agent。
- profile 之间的聊天历史和 Agent 会话隔离；工作 AI 角色的历史和进程不参与普通 LLM Agent。
- 权限策略绑定到聊天模板/角色，由控制端直接设置；Pi 按模板策略启用工具。
- 当前先提供 `readonly` 只读策略，包含 `read`、`grep`、`find`、`ls` 和服务器提供的受限网络查询工具。
- Pi 使用 profile 的 API 地址和模型；本地 OpenAI 兼容服务未配置 API Key 时，使用固定本地占位 Key 通过 Pi provider 校验，真实 Key 仍按 profile 配置传递。
- 服务器负责 Pi 进程的启动、RPC 通信、异常回收、配置变更重启和服务器退出清理。

### 不在本次实现

- 不修改已有工作 AI 角色的 Codex/Claude 后端选择。
- 当前不开放 `bash`、`edit`、`write`、任意外部扩展、项目 `.pi` 配置和上下文文件；后续命令策略只增加显式注册的服务器工具。
- 不提供文件写入、代码修改、命令执行、进程管理或任意 URL 代理能力。
- 不实现 Pi 以外的 Agent 后端。

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
    backend: 'pi'              // mode='agent' 时固定为 pi
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
    └─ mode=agent -> PiRuntimeManager
                       └─ pi --mode rpc（服务器子进程）
                            ├─ profile provider 配置
                            ├─ read/grep/find/ls
                            └─ aasc_web_search/aasc_web_fetch
```

通用 `PiRuntimeManager` 在服务器进程内维护 `(profileName, templateId, permissionProfile) -> PiSession` 映射，聊天只是第一个调用方。后续服务器内置命令可以复用 Runtime，但必须使用自己的上下文和工具策略。Pi 不使用 detached 进程；服务器退出时逐个发送 abort/关闭 stdin 并回收子进程。单个 session 的并发请求串行化，避免上下文和响应互相污染。单次 Pi RPC 请求默认使用 600 秒超时；测试或特殊调用可以注入更短的超时，超时后终止当前子进程并在下一次请求时重建。

## Pi 权限边界

Pi 启动时固定使用以下约束：

- `--mode rpc`：仅通过 JSONL stdin/stdout 通信。
- `--no-session`：不让 Pi 持久化独立会话文件；会话只存在于服务器运行期间。
- `--no-context-files`：不读取项目 `AGENTS.md`/`CLAUDE.md` 等上下文文件。
- `--no-extensions` 加载项目内置只读扩展：不接受用户 profile 自定义扩展。
- `--tools read,grep,find,ls,aasc_web_search,aasc_web_fetch`：白名单之外的工具不可用。
- 工作目录固定为项目根目录；Pi 内置文件工具不开放写入工具，服务器不加载项目外部 Agent 扩展或上下文文件。
- API Key 通过 Pi 子进程环境传入，不拼接在命令行参数中。

网络工具只允许 GET 请求，限制 `http/https` 协议、响应体大小、重定向次数和请求超时；网络工具不会写入文件，也不会执行响应内容。文件搜索由 Pi 内置只读工具完成。服务器根据模板的 `permissionProfile` 选择固定工具集合，不接受前端任意工具名。

## 上下文与历史

### 发送给 Agent 的内容

每次 Agent 请求包含：

1. 当前 profile 的系统提示词；
2. 当前聊天模式（群聊/私聊）对应的、属于当前 profile 的最近 `contextCount` 条记录；
3. 当前用户消息。

Pi 进程继续保留该 profile 的 Agent 会话上下文，工具调用结果只保留在该 Pi 会话中。最终助手文本通过普通聊天历史接口保存并显示；工具调用过程不伪装成普通用户/助手消息。

### profile 和模板隔离

聊天历史键包含 profile 名称和模板/角色名称。切换 profile 或模板后，只读取对应上下文；切换回原 profile/模板后恢复原上下文。权限策略变化不会复用旧 session，避免旧 session 保留超出新策略的工具。旧历史记录没有 profile/template 字段时，在首次加载时归属启动时的 active profile 和默认模板，保证旧版本用户仍能看到已有聊天。

## 错误处理

- Pi 不存在、启动失败、provider 配置失败、RPC JSONL 解析失败、超时或异常退出：当前请求返回失败消息，并清理该 profile 的进程。
- Agent 模式失败不回退为直接 LLM 请求，避免绕过只读权限和用户选择的执行模式。
- 一个 profile 的 Pi 失败不影响其他 profile 或普通 LLM 请求。
- 服务器关闭时清理全部 Pi 进程；清理失败记录日志，但不阻塞服务器退出。

## UI 设计

LLM profile 编辑器增加“调用模式”：

- `直接 LLM`：保持现有 HTTP API 行为。
- `Agent（Pi）`：使用 profile 的服务器配置启动 Pi；具体工具权限从当前聊天模板/角色读取。

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
