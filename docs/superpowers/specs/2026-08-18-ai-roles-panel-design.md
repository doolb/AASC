# AI 角色面板（workgroup 集成 · 独立对话）设计

日期：2026-08-18

## 1. 需求背景

控制端用户希望直接与多个"工作 AI"对话，每个 AI 是一个独立的 claude 后台进程，拥有独立的对话上下文。早期探索过两个方向：

- **网页版 workgroup main**（mailcli）：复用现有聊天 UI，把 mailcli 做成聊天面板特殊角色，后端用持久 claude 进程做 main 协调。因与 workgroup 耦合深、TUI 并存复杂而放弃。
- **独立 detached claude 进程**：自己管理进程生命周期，复杂度高。放弃。

最终方向：**控制端添加"工作AI角色"（只填名字）→ 每角色一个持久 claude 独立对话 → 复用聊天面板 tab → 与 workgroup 集成（复用 roles/*.md 提示词、有 workgroup 身份）→ 不接任务池、不用 main 中转 → 角色+历史持久化，进程懒启动+detached+可回收。**

## 2. 目标

1. 控制端聊天面板可添加/删除多个工作 AI 角色（只填角色名）
2. 每角色对应一个持久 claude 进程，独立对话上下文，实时流式输出
3. 复用现有聊天 UI（tab、输入框、气泡、流式、语音）
4. 与 workgroup 集成：角色提示词复用 `workgroup/roles/<名>.md`（缺省默认）
5. 不接任务池认领、不用 main 中转——角色是能聊天的持久 claude，干不干活由对话决定
6. 角色列表与对话历史持久化（服务器重启保留）
7. claude 进程在服务器重启时**不中断**（detached），删角色可彻底回收

## 3. 非目标（YAGNI）

- 不接 workgroup 任务池认领 / 状态同步
- 不做 main 中转 / mailcli 协调
- 不做多会话、模型/系统提示词自定义、TTS 播报
- 不做权限审批交互（claude 用 bypassPermissions 全自动）

## 4. 架构与组件

```
浏览器（upload.html 聊天面板）
  │  chatMessage {mode:'role', role:名, content}    发消息
  │  roleList / roleAdd / roleDelete                 角色管理
  ▼
server-app.js（WS 消息路由）
  │  mode==='role' 分支
  ▼
ai-roles-service.js（聚合）
  ├── role-store.js      角色 + 对话历史持久化（JSON 文件）
  └── claude-bridge.js   单角色 claude 进程管理（每角色一个实例）
                          └─ spawn detached claude（stream-json + FIFO）
```

新模块位于 `src/apps/server/modules/ai-roles/`，与 task-engine 平级。

## 5. 前端设计

### 5.1 角色 tab 注入

聊天面板 tab 栏（现有 `chat-tabs`，含群聊 + 各模板）动态增加角色 tab：

- 后端 WS 消息 `roleList {roles:[{name, createdAt}]}` 推送角色列表 → 前端渲染 tab
- 新增 **「+ 添加角色」**按钮 → 弹窗输入名字（校验：非空、不重名、不与现有模板/角色冲突）
- 角色 tab 附删除按钮 → 确认弹窗（"删除角色将关闭其 claude 进程并清除对话历史"）
- 角色 tab 与模板 tab 并列，点选进入该角色的独立对话

### 5.2 模式与渲染

- `session.mode` 新增 `'role'`，`session.roleTarget` 记录当前角色名
- 点角色 tab → 模式指示显示「角色: <名>」，assistantName=角色名
- 发消息 `chatMessage {mode:'role', role:名, content}`；后端回 `chatChunk`/`chatResponse` 复用现有流式渲染
- 角色对话历史与群聊/私聊隔离渲染（按 `mode==='role' && roleTarget===角色名` 过滤）

## 6. 后端设计

### 6.1 role-store.js（持久化）

- 存储目录：`ai-roles/`（服务器工作目录下，gitignore）
- 每角色一个子目录：`ai-roles/<名>/`
  - `role.json`：`{name, createdAt}`
  - `history.json`：对话历史数组（`{role, content, timestamp}`），每轮完成追加
  - `pid`：claude 进程 PID（文本）
  - `in.fifo` / `out.fifo`：命名管道（进程通信）
- 接口：`list()`, `add(name)`, `remove(name)`, `appendHistory(name, msg)`, `loadHistory(name)`, `writePid(name, pid)`, `readPid(name)`

### 6.2 claude-bridge.js（单角色进程管理）

每角色一个 `ClaudeBridge` 实例，负责该角色的 claude 进程全生命周期：

- **懒启动**：首次发消息才 spawn。命令：
  `claude --input-format stream-json --output-format stream-json --permission-mode bypassPermissions --append-system-prompt <角色提示词>`
  cwd=项目根；`detached: true`（不受 server 退出影响）；stdin→in.fifo、stdout→out.fifo

- **FIFO 通信机制（关键：保证服务器重启不中断）**：
  - claude 通过 shell 重定向打开 FIFO 路径：`claude ... > out.fifo < in.fifo`。shell 打开 FIFO 后 exec claude，claude 自己持有这两个 fd（不继承服务器 fd）。
  - **管道守卫（pipe-keeper）**：每角色另 spawn 一个 detached 微型进程，持有 in.fifo 的**写端**。作用：服务器死亡时服务器侧的写端关闭，若无人持有写端，claude 的 stdin 读到 EOF 会退出；守卫持有写端 → claude stdin 永不 EOF → 进程不中断。
  - **stdout 阻塞自愈**：服务器死亡时 out.fifo 的读端关闭，claude 写 out.fifo 会阻塞（内核缓冲满后）；服务器重启后重新打开 out.fifo 读端，claude 的阻塞写自动恢复继续。因此服务器重启期间 claude 最多暂停输出，不会死。
  - **读超时保护**：异步读 out.fifo，60s 无输出判定超时（可能 claude 静默）→ 广播状态提示，不 kill。

- **提示词来源**：`workgroup/roles/<名>.md` 存在则用其内容；否则默认「你是<名>，一个专注<名>相关工作的助手」
- **消息格式**：发消息写 `{"type":"user","message":{"role":"user","content":<content>}}\n` 到 in.fifo；接收解析 out.fifo 的 stream-json event：
  - `content_block_delta` → `onChunk(delta.text)` 转发
  - `assistant` / 一轮结束 → `onComplete(fullMessage)`
  - `error` → `onError`
- **存活检测**：读 pid + `process.kill(pid, 0)`，EPERM=存活、ESRCH=已死
- **崩溃自愈**：server 轮询（30s）检测；发现退出 → 清理残留 FIFO/pid，标记"已停止"，下次发消息重建
- **回收**：`stop()` → 写关闭信号（或直接 kill）→ SIGTERM → 2s 未退 → SIGKILL → 删 pid/FIFO/history/role.json

### 6.3 ai-roles-service.js（聚合）

- `list()` → 读 role-store，附加存活状态（`running: bool`）
- `add(name)` → 校验重名 → role-store.add
- `remove(name)` → 桥 stop() + role-store.remove
- `chat(name, content, callbacks)` → 懒启动 → bridge.chat → 流式转发 → 完成写 history
- 启动时 `restoreAll()` → 遍历角色读 pid 存活检测：活→重连 FIFO；死→清残留
- 广播：server-app.js 对所有 control 客户端转发 `chatChunk`/`chatResponse`/`roleList`/`roleAdded`/`roleRemoved`

### 6.4 server-app.js 改动

- `chatMessage` 分支：检测 `mode==='role' && data.role` → 走 `aiRoles.chat(...)`，回调返回标准 `chatChunk`/`chatResponse`
- 新增 WS action：`roleList`（请求列表）、`roleAdd`、`roleDelete`
- 启动时 `aiRoles.restoreAll()`

## 7. 数据流

1. 控制端添加角色（名字）→ `roleAdd` → role-store 持久化 → 广播 `roleList` → tab 出现
2. 首次发消息 → 懒启动 claude（读 role.md / 默认提示词，detached）
3. 写 in.fifo → claude 流式输出 → 读 out.fifo → `chatChunk` 广播控制端
4. 一轮完成 → `chatResponse` + 写 history.json
5. 服务器重启 → `restoreAll()`：角色/历史都在；进程存活则重连 FIFO 继续对话
6. 删除角色 → 确认 → 桥回收进程 + 清历史文件

## 8. 错误处理

| 场景 | 处理 |
|------|------|
| claude 进程崩溃 | server 轮询检测 → 清理残留 + 标记停止；下次发消息重建 |
| 服务器重启（进程不中断） | pipe-keeper 持有 in.fifo 写端防 stdin EOF；claude 写 out.fifo 阻塞在重启重连后自愈 |
| FIFO 阻塞/无进程写 | 异步读取 + 60s 读超时保护 → 广播状态提示 |
| 重名/空名角色 | 前端 + 后端双重校验，返回错误提示 |
| 多控制端 | 广播所有 control 客户端 |
| 删除角色 | 桥 stop()：SIGTERM → 2s 未退 → SIGKILL → 清 pid/FIFO/history/role.json + 守卫进程 |

## 9. 测试

### 9.1 单元测试

- `role-store.test.js`：add/list/remove/history 持久化、重启恢复
- `claude-bridge.test.js`（注入假命令，仿 wg 测试）：
  - 懒启动 spawn + FIFO 读写 + stream-json 解析
  - PID 存活检测（活/死）
  - 崩溃后清理与重建
  - 删除时进程回收（SIGTERM→SIGKILL）
- `ai-roles-service.test.js`：聚合层 add/remove/chat 路由

### 9.2 集成/手动

- 浏览器：添加角色、对话流式、切角色独立历史、删角色确认
- 服务器重启（控制端 `/api/restart`）后：角色仍在、claude 进程不中断、对话可继续

## 10. 风险

| 风险 | 缓解 |
|------|------|
| detached 进程成为野进程 | pid 文件 + kill(pid,0) 存活检测 + 删除时双信号回收 + 守卫进程一并回收 |
| 服务器重启 claude stdin EOF / stdout 阻塞 | pipe-keeper 持有 in.fifo 写端；out.fifo 阻塞写在重连后自愈 |
| FIFO 阻塞导致 server 卡死 | 异步读取 + 60s 读超时保护 |
| 并发发消息乱序 | 每角色消息队列串行（进行中拒绝新消息，前端提示"正在处理"） |
| 与 workgroup 同名角色提示词冲突 | 角色名唯一校验（前端+后端） |
