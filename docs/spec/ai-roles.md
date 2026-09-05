# 工作 AI 角色面板实现规范

## 持久化结构

```text
USER_CONFIG_DIR/ai-roles/<name>/
  role.json       // { name, createdAt, backend? }；backend 为实际运行后端
  history.json    // 角色独立聊天历史数组
  prompt.txt      // 角色提示词
  in.fifo         // Claude 输入管道
  out.fifo        // Claude 输出管道
  claude.pid
  keeper.pid
  err.log
  codex.pid        // Codex app-server 进程（使用 Codex 时）
```

```text
USER_CONFIG_DIR/ai-roles/
  backend.sock     // Agent 后端宿主 Unix Socket（全局共享）
  backend.pid      // Agent 后端宿主 PID（全局共享）
  backend.err.log  // Agent 后端宿主 stderr（全局共享）
```

```text
RoleStore
  list() -> 遍历角色目录；目录名必须安全且 role.json.name 必须与目录名完全一致，否则 console.warn 并跳过
  add(name) -> 校验安全名称；若已存在则报错；创建目录和 role.json
  remove(name) -> 校验安全名称；递归删除角色目录
  loadHistory(name) -> 读取 history.json；缺失、损坏或内容非数组时返回空数组并保留损坏文件
  appendHistory(name, message) -> 读取、追加 timestamp、写回 history.json
```

## WebSocket 消息协议

```text
控制端 -> 服务端:
  { type: 'roleList' }
  { type: 'roleCatalog' }
  { type: 'roleAdd', name }
  { type: 'roleDelete', role }
  { type: 'roleHistory', role }
  { type: 'chatMessage', assistantType: 'agent', mode: 'role', role, content, requestId }

服务端 -> 控制端:
  { type: 'roleList', roles: [{ name, createdAt, backend, running }] }
  { type: 'roleCatalog', members: [{ name, primary, secondary, hasRoleFile, hasHistoryFile }] }
  { type: 'roleHistory', role, history }
  { type: 'roleError', message }
  { type: 'chatChunk', requestId, chunk, message }
  { type: 'chatResponse', requestId, success, message, history }
  { type: 'chatResponse', requestId, success: false, error }
  { type: 'playOnControl', audioUrl, text }       // Agent 回复的控制端播报
```

所有角色管理请求先由服务端使用 `aiRoles.list()` 验证角色存在；非法名称、重名、删除或历史读取异常通过 `roleError` 返回，不让 WebSocket 处理流程抛出未处理异常。

`roleCatalog` 只返回 `workgroup/members` 直接子目录的候选元数据。`primary` 和 `secondary` 从成员目录下 `role.md` 的同名字段解析为字符串/字符串数组；只返回文件是否存在，不返回 `role.md`、`history.md` 的正文和服务器绝对路径。控制端弹窗只渲染列表选择项，不提供角色名输入框；成员目录名作为选择后的 `ai-role` 名称，仍由 `RoleStore` 执行空名、路径穿越和重名校验。

消息类型判断：

```text
assistantType='agent' 或（assistantType 缺失且 mode='role'）:
  校验 role -> aiRoles.chat() -> 返回 chatChunk/chatResponse
  Agent chatChunk -> 累积并按句生成 TTS -> 按 playOnControl/displayId/displayIds 路由语音
  Agent 完成回复 -> 冲刷最后尾句
assistantType='llm' 或 assistantType 缺失且不是 mode='role':
  进入原有普通 LLM handler
assistantType='agent' 但缺少 role:
  返回 roleError，不进入普通 LLM
```

聊天配置：

```text
GET /api/chat/config -> 返回 chat.agentBackend，旧配置缺失时返回 'codex'
POST /api/chat/config({ agentBackend })
  只接受 'codex' 或 'claude'
  持久化全局默认后端
  不停止已有 AiRolesService bridge

POST /api/ai-roles/stop-all:
  await AiRolesService.stopAll()
  广播 { type:'roleList', roles: aiRoles.list() }
  返回 { status:'success', stopped:数量 }
  aiRoles.list() 只读取已有 bridge 或持久化 PID 状态，不创建新的 bridge
  只停止进程，不删除角色目录、role.json、history.json、role.md 或 history.md
```

## 角色 WebSocket handler 注册

```text
server 启动:
  registerAiRoleHandlers(wsServer, { aiRoles, broadcastToControls })
    注册 roleList:
      try -> ws.send({ type: 'roleList', roles: aiRoles.list() })
      catch -> ws.send({ type: 'roleError', message })
    注册 roleCatalog:
      try -> ws.send({ type: 'roleCatalog', members: aiRoles.memberCatalog() })
      catch -> ws.send({ type: 'roleError', message })
    注册 roleAdd:
      try -> aiRoles.add(data.name)
             broadcastToControls({ type: 'roleList', roles: aiRoles.list() })
      catch -> ws.send({ type: 'roleError', message })
    注册 roleDelete:
      try -> 校验角色存在 -> await aiRoles.remove(data.role)
             broadcastToControls({ type: 'roleList', roles: aiRoles.list() })
      catch -> ws.send({ type: 'roleError', message })
    注册 roleHistory:
      try -> 校验角色存在 -> ws.send({ type: 'roleHistory', role, history })
      catch -> ws.send({ type: 'roleError', message })

控制端消息处理:
  已注册的 role* 消息直接调用对应 handler
  未注册的普通控制消息继续走通用回退处理
```

角色 handler 注册不得只依赖回退函数中的 `else if` 分支；测试必须验证四种 `role*` 消息均能被 `WSViewBindServer` 分发，并验证添加成功会广播最新列表、失败会返回 `roleError`。

## `aiRoles.chat` 流程

```text
chat(name, content, callbacks):
  bridge = _bridge(name)
  bridge.promptFile = _ensurePromptFile(name)
  store.appendHistory(name, { role: 'control', name: '用户', content,
                              mode: 'role', target: name })
  result = await bridge.chat(content, {
    onChunk(chunk, fullMessage) -> callbacks.onChunk(chunk, fullMessage)
    onComplete(message) ->
      store.appendHistory(name, { role: 'assistant', name,
                                  content: message, mode: 'role', target: name })
      callbacks.onComplete(message, store.loadHistory(name))
    onError(error) -> callbacks.onError(error)
  })
  return result
```

`_promptFor(name)` 优先读取 `projectRoot/workgroup/roles/<name>.md`，没有有效内容时使用默认提示词；`_ensurePromptFile` 创建角色目录并写入 `prompt.txt`。

## Agent 回复自动播报

```text
server-app 收到 chatMessage 且 assistantType === 'agent':
  读取 data.playOnControl、data.displayId、data.displayIds
  调用 aiRoles.chat(name, content, callbacks)

callbacks.onComplete(message, history):
  先发送 chatResponse，保持 Agent 文字流和历史协议不变
  Agent 流式增量到达时:
    pendingText += chunk
    sentences = chat.splitIntoSentences(pendingText)
    保留最后一个可能未结束的片段到 pendingText
    其余完整句子进入 TTS 串行队列
  Agent 回复完成时:
    将 pendingText 或完整 message 的尾句进入 TTS 串行队列
    先发送 chatResponse，不阻塞文字回复
  TTS 串行队列处理每个句子:
    cleanText = stripMarkdown(sentence)
    audioPath = tts.generateTTS(cleanText)
    audioUrl = /uploads/tts/{basename(audioPath)}
    如果 playOnControl === true:
      sendToControl({ type: 'playOnControl', audioUrl, text: sentence })
    否则如果 displayIds 非空:
      对每个 displayId 发送 { type: 'tts', action: 'playAudio', audioUrl, text: sentence }
    否则如果 displayId 存在:
      发送 { type: 'tts', action: 'playAudio', audioUrl, text: sentence }
    TTS 失败只记录日志，并继续处理后续句子
```

控制端收到 `playOnControl` 后复用既有音频队列播放；关闭控制端播放且未选择显示端时不额外播报，行为与普通 LLM 一致。

## 控制端角色上下文与自管理

```text
AiRolesService._ensurePromptFile(name):
  roleFile = projectRoot/workgroup/roles/<name>.md
  historyFile = projectRoot/workgroup/members/control-<name>/history.md
  roleText = 读取 roleFile；不存在时使用默认角色提示词
  historyText = 读取 historyFile；不存在时使用空历史
  prompt = 角色定义
         + 角色经验摘要/最近记录
         + 当前角色自管理规则
         + roleFile 和 historyFile 的绝对路径
  写入 ~/.config/aasc-user/ai-roles/<name>/prompt.txt
  返回 promptFile
```

角色自管理规则：

```text
当前 Claude 角色可以直接更新自己的 roleFile 和 historyFile
只允许更新当前角色对应的两个文件
稳定的职责/能力/边界变化写入 roleFile
重要任务经验和最近记录写入 historyFile
普通消息不强制写入 historyFile
禁止修改其他角色、CLAUDE.md、服务器控制规则和安全规则
```

提示词加载时机：

```text
角色添加或 Agent 进程首次启动：生成 prompt.txt
Agent 进程存活期间：后续消息复用同一 prompt.txt，不重新读取 roleFile/historyFile
Agent 进程重新创建：重新生成 prompt.txt，加载最新 roleFile/historyFile
```

## `ClaudeBridge.ensureStarted`

```text
ensureStarted():
  如果 claude.pid 对应进程存活:
    如果没有 reader -> _startReader()
    等待 out.fifo 读端 open（有超时）
    失败 -> cleanup() 并抛错
    返回

  cleanup()                         // 清理死亡进程和旧 FIFO
  mkdir roleDir
  mkfifo in.fifo, out.fifo           // 已存在可继续
  detached spawn node pipe-keeper.js in.fifo keeper.pid
  等待 keeper.pid 出现，超时则失败
  detached spawn:
    exec <command>
      --print --verbose
      --input-format stream-json
      --output-format stream-json
      --include-partial-messages
      --permission-mode bypassPermissions
      --append-system-prompt-file <prompt>
      < in.fifo > out.fifo 2> err.log
  保存 child.pid 到 claude.pid
  _startReader()
  等待 reader open（有超时）
  失败 -> cleanup() 并抛错
```

守卫使用 `fs.openSync(inFifo, 'r+')` 持有 FIFO；Claude 标准输入输出由 shell 重定向到 FIFO，因此服务器重启不影响 detached Claude 的进程和输入端。

默认命令参数必须保持非空；若调用方传入 `commandArgs`，则使用调用方参数以支持测试替身和自定义 Claude 命令。默认参数缺失会使 Claude 进入交互模式，无法消费 `stream-json` 输入，因此必须由回归测试锁定。

## `_startReader` 与 `_onLine`

```text
_startReader():
  createReadStream(out.fifo)
  保存 reader-ready Promise
  data -> 按换行拆分 -> 非空行调用 _onLine
  end -> reader=null；当前 turn 失败
  error -> 忽略管道无读者期间的预期错误

_onLine(line):
  JSON.parse；非法 JSON 忽略
  若 stream_event/content_block_delta/text_delta:
    累加 delta.text
    重置响应超时
    callbacks.onChunk(delta.text, fullMessage)
  若 type=result:
    清理当前 turn 和超时
    subtype=success -> onComplete(result 或 fullMessage)，resolve success
    其他 -> onError(result 或默认错误)，resolve failure
    destroy reader，下一轮重新打开读端
  其他 system/assistant 事件忽略
```

响应无输出达到 `readTimeoutMs` 时先 `cleanup()` 再失败当前 turn，防止迟到输出污染下一轮。Claude 生产默认 `readTimeoutMs=600000`（600 秒），测试可注入更短值。

回归测试在超时轮次使用短 `readTimeoutMs`，确认旧进程被杀掉；确认进程退出后，下一轮恢复正常响应超时窗口再启动新进程，验证重建后的消息能够正常返回。冷启动耗时不作为 Claude 响应无活动超时的断言对象。

## `stop` 与 `reconnect`

```text
reconnect():
  如果 claude.pid 不存活:
    cleanup()
    返回 false
  如果没有 reader -> _startReader()
  返回 true

stop():
  向 claude.pid 和 keeper.pid 发送 SIGTERM
  2 秒后仍存活则 SIGKILL
  删除 in.fifo/out.fifo
  destroy reader，置空 reader
```

`AiRolesService.restoreAll()` 异步遍历 `RoleStore.list()`，为每个角色准备提示词文件并通过 IPC 调用 `reconnect()`；重连失败只记录警告，角色仍保留，下一次聊天重新懒启动。服务器开始监听前等待该恢复过程完成，确保首个 `roleList` 已使用后端实际状态。

## `AiRolesService.stopAll`

```text
async stopAll():
  stopped = 0
  遍历内存 bridges:
    如果 bridge.isAlive(): stopped += 1
    await bridge.stop()
  清空 bridges
  返回 stopped
```

停止后 `aiRoles.list()` 仍返回全部角色，但 `running=false`；角色定义、控制端 history.md 和聊天历史不受影响。

## agent-backend-host

```text
启动:
  创建 USER_CONFIG_DIR/ai-roles 目录
  若 backend.sock 存在但无法连接 -> 删除失效 socket
  在 backend.sock 上监听 JSON Lines
  写入 backend.pid，并把 socket 权限限制为当前用户可读写

收到请求 { id, op, role, options }:
  status:
    读取内存中的 role bridge；不存在时按 options 创建但不主动冷启动
    如果 bridge 支持 reconnect，查询已有 Agent 是否存活
    返回 { id, ok:true, result:{ running, backend } }
  ensureStarted:
    按 role/backend 获取 bridge
    设置 prompt 快照
    await bridge.ensureStarted()
    返回 running 和 backend
  chat:
    通过 bridge.chat 发起一轮请求
    onChunk/onComplete/onError -> 向请求连接发送 { id, event, payload }
    返回本轮结果
  stopRole:
    bridge.stop()；删除内存 bridge；返回停止状态
  stopAll:
    停止所有角色 bridge；保留后端宿主和 Unix Socket
```

后端宿主的子进程与 IPC 客户端完全解耦：IPC 客户端断开不触发 bridge.stop；Agent 继续运行，下一次服务器启动可通过 `status` 重新获取在线状态。后端宿主进程退出时，服务器下一次请求负责重新拉起宿主。

## agent-backend-client

```text
ensureReady():
  尝试连接已有 backend.sock
  连接失败 -> 确认 socket 无监听 -> detached spawn agent-backend-host
  等待 socket 出现并重新连接

request(message, onEvent):
  确保 Socket 已连接
  写入 JSON 行并等待相同 id 的响应
  事件消息按 id 调用 onEvent，不缓存完整回复

AgentBackendClientBridge:
  isAlive() -> 最近一次 IPC 状态
  ensureStarted() -> request({ op:'ensureStarted', ... })
  reconnect() -> request({ op:'status', ... })
  chat() -> request({ op:'chat', ... }) 并映射 chunk/complete/error 回调
  stop() -> request({ op:'stopRole', ... })
```

## Agent 后端与持久上下文

```text
AiRolesService._bridge(name):
  如果内存中已有 bridge:
    返回原 bridge（全局设置变化不替换运行中进程）
  backend = role.json.backend
  如果 backend 缺失且 legacy claude.pid 存活:
    backend = 'claude'
  如果 backend 缺失或对应进程已退出:
    backend = getGlobalAgentBackend() 或 'codex'
  生产环境创建 AgentBackendClientBridge；测试可注入直接 bridgeFactory
  保存 role.json.backend=backend
  返回 bridge

CodexBridge.ensureStarted():
  如果 codex app-server 已存活:
    返回
  spawn('codex', ['app-server', '--stdio'], env={...
        process.env, HTTPS_PROXY:'http://127.0.0.1:7899'})
  发送 initialize(clientInfo)
  发送 initialized 通知
  发送 thread/start({ cwd, approvalPolicy:'never' })
  保存返回的 threadId

CodexBridge.chat(content, callbacks):
  确保 app-server 与 threadId 存活
  发送 turn/start({ threadId, input:[{ type:'text', text:content }],
                    approvalPolicy:'never', sandboxPolicy:工作区策略 })
  item/agentMessage/delta -> 重置无活动超时计时器 -> callbacks.onChunk(delta)
  turn/completed -> callbacks.onComplete(累积文本)
  连续 10 分钟没有任何 Agent 活动 -> 返回超时错误并停止 Codex bridge
  JSON-RPC error/进程退出/超时 -> callbacks.onError(error)，清理后允许重建
```

Codex 的 `threadId` 和 stdio 句柄由独立 Agent 后端宿主持有；同一角色后续消息继续使用该 thread。服务器重启后只重建 Unix Socket 客户端，通过 `status` 重新获取同一角色的 running 状态和上下文。

## 控制端渲染

```text
收到 roleList:
  Chat.aiRoles=data.roles
  如果当前没有未完成聊天请求:
    render()                         // 角色增删时重建完整面板
  否则:
    updateRoleStatuses()              // 只更新角色 tab/模式指示器，保留用户消息和 streaming DOM
收到 roleCatalog:
  Chat.roleCatalog=data.members
  renderRoleCatalog()
收到 roleHistory -> Chat.roleHistories[role]=history；当前角色则 renderHistory()
收到 roleError -> showToast(message, error)

render():
  输出群聊 tab、既有模板 tab、每个工作角色 tab 和 '+' 添加按钮
  角色 tab 点击 -> mode='role', roleTarget=name, 请求 roleHistory
  角色 tab 状态 -> running=true 显示“在线”，running=false 显示“离线”
  '+' -> 打开角色选择窗口并发送 roleCatalog
  角色选择窗口 -> 只展示所有成员候选列表；已在 Chat.aiRoles 中的候选显示“已添加”并禁用，不显示手动输入控件
  角色选择窗口样式 -> 标题、成员名、状态文字、背景、边框和按钮使用 --text-primary、--text-secondary、--bg-surface、--bg-surface-strong、--border-color、--accent-color 等主题变量
  点击未添加成员 -> 发送 roleAdd({ name: member.name })，成功广播 roleList 后关闭窗口
  '×' -> confirm 后发送 roleDelete(role)

发送角色消息:
  chatMessage { mode:'role', role: roleTarget, content, requestId }
  // chatChunk/chatResponse 必须携带同一 requestId；控制端只接受等于 activeRequestId 的响应
  chatResponse -> 完成消息并使用返回 history 更新显示
  Agent 启动成功后先广播 roleList，running=true，再继续发送 chatChunk/chatResponse

系统设置关闭 Agent:
  点击“关闭所有 Agent” -> POST /api/ai-roles/stop-all
  成功 -> 服务端广播 roleList -> 所有角色状态更新为离线
  角色数据和文件不删除
```

## `aiRoles.chat` 状态回调

```text
chat(name, content, callbacks):
  bridge = _bridge(name)
  bridge.promptFile = _ensurePromptFile(name)
  如果 bridge 有 ensureStarted:
    await bridge.ensureStarted()
  成功后 callbacks.onStatus({ name, running: bridge.isAlive(), backend })
  store.appendHistory(user)
  bridge.chat(...)
  onError(error):
    如果 bridge 已不存活则 callbacks.onStatus({ name, running:false, backend })
    callbacks.onError(error)
```

## 权限和回复格式

```text
Claude 启动参数包含 --permission-mode bypassPermissions
Codex thread/start 与 turn/start 使用 approvalPolicy='never'
Codex turn 使用 sandboxPolicy={ type:'dangerFullAccess' }
权限请求不等待控制端审批，Agent 以高权限执行

控制端聊天回复:
  调用控制端 ChatMarkdown.render(content)
  用户消息和 Agent 回复均按 Markdown 显示
  输入框仍使用纯文本输入
  原始 HTML 转义为文本，危险链接协议不生成 a 标签
```
