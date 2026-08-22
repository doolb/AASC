# 工作 AI 角色面板设计

## 功能需求

控制端聊天面板支持工作 AI 角色的动态管理。用户可以添加或删除角色，并在同一个聊天界面中通过角色 tab 切换对话。每个角色拥有独立的 Agent 进程、提示词和聊天历史，角色之间互不共享上下文。

角色数据与历史持久化到 `~/.config/aasc-user/ai-roles/<角色名>/`，服务器重启后角色列表和历史仍可恢复。Claude 进程采用 detached 方式运行，服务器重启时不主动终止存活进程；服务启动后重新连接其输出管道。删除角色时回收对应 Claude 进程、管道守卫和历史目录。

- 角色 tab 必须使用 DOM 节点、`textContent`、`dataset` 和事件监听器渲染，角色名不得进入 HTML 或 inline handler。
- 角色消息带唯一 `requestId`；流式响应按请求上下文归属，切换 tab 后迟到响应不得污染当前角色。
- 聊天设置提供全局 Agent 后端选择（`codex`/`claude`），默认使用 `codex`；该设置只影响新建或已退出后重建的角色。
- 普通 LLM 与工作 Agent 使用显式 `assistantType` 区分；保留 `mode='role'` 作为旧控制端兼容字段。
- 系统设置提供“关闭所有 Agent”操作，只停止 Claude/Codex 进程，不删除角色、历史或角色定义文件。
- Agent 首次启动成功后立即广播在线状态；启动失败或停止后广播离线状态，控制端不等待回复完成才刷新。
- 关闭 Agent 接口和控制端按钮必须区分 HTTP 错误与 JSON 业务错误，向用户显示服务端返回的实际原因。
- Claude/Codex 当前均配置为自动通过权限审批；该行为必须明确提示为高权限执行，不宣称为安全沙箱。
- 聊天消息由控制端共享 Markdown 渲染器显示；输入框仍保持纯文本输入。该能力覆盖普通 LLM、私聊和工作 AI 角色消息。


### role-store

- 校验用户输入的角色名，拒绝空名、路径分隔符和点号穿越名。
- 创建、列出、判断存在和删除角色目录。
- 读写 `role.json` 与 `history.json`。
- 对损坏的 JSON 文件保留带时间戳的 `.corrupt-*` 备份，避免静默覆盖数据。

### pipe-keeper

以 `O_RDWR` 持有角色输入 FIFO 的写端，防止服务器退出时 Claude 因 stdin 收到 EOF 而退出。守卫进程记录自身 PID，并响应终止信号。

### claude-bridge

- 按需创建输入/输出 FIFO、管道守卫和 detached Claude 进程。
- 默认以 Claude Code 非交互 stream-json 模式启动（`--print`、`--input-format stream-json`、`--output-format stream-json`），保证角色消息可以从 FIFO 输入并收到流式输出。
- 通过 `--append-system-prompt-file` 注入角色提示词。
- 读取 Claude 的 stream-json 输出，转发文本增量和完成/错误事件。
- 对读端打开、响应输出和进程退出设置超时或失败处理，失败后清理整组资源，下一轮可重建。
- 支持 `reconnect()` 在服务器重启后重新打开输出 FIFO，不杀存活的 Claude 进程；`stop()` 回收进程并删除 FIFO。

### codex-bridge

- 通过 `codex app-server --stdio` 启动每角色一个长期 JSON-RPC 子进程，不按消息启动一次性 `codex exec`。
- 首次连接执行 `initialize`、`thread/start`，随后每条消息使用同一个 `threadId` 执行 `turn/start`，保留 Agent 上下文。
- 读取 `item/agentMessage/delta` 转发流式文本，在 `turn/completed` 完成当前请求；协议错误、进程退出和超时均结束当前请求并允许下一次重建。
- Codex 子进程只增加 `HTTPS_PROXY=http://127.0.0.1:7899`，其余环境变量继承服务器环境；不改变服务器自身代理或进程控制规则。
- 角色目录保存实际后端标记。后端设置变更不杀正在运行的桥；角色进程死亡后，下一次消息使用最新全局后端。Codex 当前使用 stdio 传输，服务器重启后由历史和提示词恢复角色，但不会接管旧 stdio 句柄。

### ai-roles-service

聚合角色存储与进程桥：为每个角色懒创建 `ClaudeBridge` 或 `CodexBridge`，从 `workgroup/roles/<name>.md` 读取提示词（不存在时使用默认提示词），保存用户和助手历史，并在服务启动时调用 `restoreAll()` 恢复角色连接。控制端 Agent 角色直接处理当前对话，不进入 `poll.js` 任务队列；`poll.js` 只继续服务 workgroup 成员。`stopAll()` 统一停止当前已连接的 Agent bridge，并保留角色数据。

## 生命周期

1. **添加**：控制端发送 `roleAdd`，服务端校验并创建角色目录，同时写入提示词文件；不立即启动 Claude。
2. **懒启动**：首次发送角色消息时，服务根据角色实际后端创建 Claude FIFO 桥或 Codex JSON-RPC 桥；后续消息复用该角色桥。
3. **服务器重启**：服务启动遍历已持久化角色；存活的 Claude 重新连接 FIFO，Codex stdio 会话随服务器退出结束，角色保留并在下一次消息按最新全局后端重建。
4. **断开与自愈**：管道打开超时、输出异常或响应超时会清理资源；下一次聊天重新建立完整链路。
5. **删除**：控制端确认后发送 `roleDelete`，服务停止对应 Claude/守卫并删除角色目录，历史随角色一并清除。
6. **全部停止**：系统设置发送 `POST /api/ai-roles/stop-all`，服务停止所有已连接 Agent，广播最新 `roleList`；角色保持离线，下一次发消息时懒启动。

## 数据流

```text
控制端 Chat
  ├─ roleList ───────────────> server-app -> aiRoles.list() -> roleList
  ├─ roleAdd(name) ──────────> server-app -> aiRoles.add() -> 广播 roleList
  ├─ roleDelete(role) ───────> server-app -> aiRoles.remove() -> 广播 roleList
  ├─ roleHistory(role) ──────> server-app -> aiRoles.history() -> roleHistory
  └─ chatMessage(mode=role)
       -> server-app 校验角色
       -> aiRoles.chat()
       -> ClaudeBridge FIFO 或 CodexBridge JSON-RPC
       -> stream-json / app-server notifications
       -> chatChunk / chatResponse
       -> 控制端流式渲染并更新角色历史
```

角色消息使用独立 `mode='role'` 与 `role` 字段，不进入原有群聊/私聊历史；角色历史条目保持聊天 UI 可直接渲染的 `{ role, name, content, mode, target, timestamp }` 结构。

## 控制端角色消息路由

角色管理消息必须在 WebSocket 服务初始化阶段显式注册为独立 handler，不依赖通用控制消息回退函数中的分支。这样可以保证控制端刷新、添加、删除和读取历史时，角色消息一定被分发；服务端异常时仍通过 `roleError` 返回可见错误。

角色 handler 只负责协议适配和错误边界，角色持久化与进程生命周期继续由 `AiRolesService` 负责。添加或删除成功后广播最新 `roleList`，使多个控制端保持一致。

角色 tab 使用 `roleList.roles[].running` 显示 Agent 在线状态；首次消息确认 Agent 启动后立即广播新的 `roleList`，关闭所有 Agent 后也广播新的 `roleList`，所有角色立即显示离线，下一次发送消息再懒启动。

### 权限和回复格式

- Claude 使用 `--permission-mode bypassPermissions`，Codex 使用 `approvalPolicy: 'never'` 与 `dangerFullAccess`；权限请求不会等待用户点击确认。
- 该权限策略只适合用户明确授权的本机工作区 Agent，控制端需要把高权限行为作为运行前提展示给用户。
- 聊天消息由控制端 `ChatMarkdown` 渲染器转换为标题、列表、代码块、表格和安全链接等常用 Markdown；原始 HTML 与危险链接协议会被当作文本或拒绝渲染。

## 控制端角色自管理

控制端工作 AI 角色用于持续执行任务。每个角色在 Claude 进程启动时加载自己的角色定义和任务经验：

- 角色定义：`workgroup/roles/<角色名>.md`
- 角色经验：`workgroup/members/control-<角色名>/history.md`

角色 AI 可以直接维护自己的 `role.md`，用于沉淀稳定的职责、能力边界和工作规范；临时任务经验和重要任务记录写入自己的 `history.md`。普通聊天不要求更新历史。

角色自管理边界：

- 只能修改当前角色自己的 `workgroup/roles/<角色名>.md` 和对应 `history.md`。
- 不得修改其他角色定义、项目级 `CLAUDE.md`、服务器控制规则或安全规则。
- `role.md` 和 `history.md` 的内容在 Claude 进程启动时合并到 `prompt.txt`，通过 `--append-system-prompt-file` 注入系统提示词。
- 运行中的 Claude 不在每条消息前重新读取两个文件；文件变更在当前上下文中由角色自行承担，下一次新建 Claude 进程时重新注入。
