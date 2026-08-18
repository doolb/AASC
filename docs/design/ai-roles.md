# 工作 AI 角色面板设计

## 功能需求

控制端聊天面板支持工作 AI 角色的动态管理。用户可以添加或删除角色，并在同一个聊天界面中通过角色 tab 切换对话。每个角色拥有独立的 Claude 进程、提示词和聊天历史，角色之间互不共享上下文。

角色数据与历史持久化到 `~/.config/aasc-user/ai-roles/<角色名>/`，服务器重启后角色列表和历史仍可恢复。Claude 进程采用 detached 方式运行，服务器重启时不主动终止存活进程；服务启动后重新连接其输出管道。删除角色时回收对应 Claude 进程、管道守卫和历史目录。

- 角色 tab 必须使用 DOM 节点、`textContent`、`dataset` 和事件监听器渲染，角色名不得进入 HTML 或 inline handler。
- 角色消息带唯一 `requestId`；流式响应按请求上下文归属，切换 tab 后迟到响应不得污染当前角色。


### role-store

- 校验用户输入的角色名，拒绝空名、路径分隔符和点号穿越名。
- 创建、列出、判断存在和删除角色目录。
- 读写 `role.json` 与 `history.json`。
- 对损坏的 JSON 文件保留带时间戳的 `.corrupt-*` 备份，避免静默覆盖数据。

### pipe-keeper

以 `O_RDWR` 持有角色输入 FIFO 的写端，防止服务器退出时 Claude 因 stdin 收到 EOF 而退出。守卫进程记录自身 PID，并响应终止信号。

### claude-bridge

- 按需创建输入/输出 FIFO、管道守卫和 detached Claude 进程。
- 通过 `--append-system-prompt-file` 注入角色提示词。
- 读取 Claude 的 stream-json 输出，转发文本增量和完成/错误事件。
- 对读端打开、响应输出和进程退出设置超时或失败处理，失败后清理整组资源，下一轮可重建。
- 支持 `reconnect()` 在服务器重启后重新打开输出 FIFO，不杀存活的 Claude 进程；`stop()` 回收进程并删除 FIFO。

### ai-roles-service

聚合角色存储与进程桥：为每个角色懒创建 `ClaudeBridge`，从 `workgroup/roles/<name>.md` 读取提示词（不存在时使用默认提示词），保存用户和助手历史，并在服务启动时调用 `restoreAll()` 恢复角色连接。

## 生命周期

1. **添加**：控制端发送 `roleAdd`，服务端校验并创建角色目录，同时写入提示词文件；不立即启动 Claude。
2. **懒启动**：首次发送角色消息时，服务创建 FIFO、守卫和 detached Claude，再写入消息；后续消息复用该角色桥。
3. **服务器重启**：服务启动遍历已持久化角色；存活的 Claude 只重新连接输出 FIFO，已退出的进程保留角色并等待下一次消息重建。
4. **断开与自愈**：管道打开超时、输出异常或响应超时会清理资源；下一次聊天重新建立完整链路。
5. **删除**：控制端确认后发送 `roleDelete`，服务停止对应 Claude/守卫并删除角色目录，历史随角色一并清除。

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
       -> ClaudeBridge FIFO
       -> stream-json
       -> chatChunk / chatResponse
       -> 控制端流式渲染并更新角色历史
```

角色消息使用独立 `mode='role'` 与 `role` 字段，不进入原有群聊/私聊历史；角色历史条目保持聊天 UI 可直接渲染的 `{ role, name, content, mode, target, timestamp }` 结构。
