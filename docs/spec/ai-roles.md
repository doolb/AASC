# 工作 AI 角色面板实现规范

## 持久化结构

```text
USER_CONFIG_DIR/ai-roles/<name>/
  role.json       // { name, createdAt }
  history.json    // 角色独立聊天历史数组
  prompt.txt      // 角色提示词
  in.fifo         // Claude 输入管道
  out.fifo        // Claude 输出管道
  claude.pid
  keeper.pid
  err.log
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
  { type: 'roleAdd', name }
  { type: 'roleDelete', role }
  { type: 'roleHistory', role }
  { type: 'chatMessage', mode: 'role', role, content, requestId }

服务端 -> 控制端:
  { type: 'roleList', roles: [{ name, createdAt, running }] }
  { type: 'roleHistory', role, history }
  { type: 'roleError', message }
  { type: 'chatChunk', requestId, chunk, message }
  { type: 'chatResponse', requestId, success, message, history }
  { type: 'chatResponse', requestId, success: false, error }
```

所有角色管理请求先由服务端使用 `aiRoles.list()` 验证角色存在；非法名称、重名、删除或历史读取异常通过 `roleError` 返回，不让 WebSocket 处理流程抛出未处理异常。

## 角色 WebSocket handler 注册

```text
server 启动:
  registerAiRoleHandlers(wsServer, { aiRoles, broadcastToControls })
    注册 roleList:
      try -> ws.send({ type: 'roleList', roles: aiRoles.list() })
      catch -> ws.send({ type: 'roleError', message })
    注册 roleAdd:
      try -> aiRoles.add(data.name)
             broadcastToControls({ type: 'roleList', roles: aiRoles.list() })
      catch -> ws.send({ type: 'roleError', message })
    注册 roleDelete:
      try -> 校验角色存在 -> aiRoles.remove(data.role)
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
  detached spawn sh -c:
    exec <command> --append-system-prompt-file <prompt>
         < in.fifo > out.fifo 2> err.log
  保存 child.pid 到 claude.pid
  _startReader()
  等待 reader open（有超时）
  失败 -> cleanup() 并抛错
```

守卫使用 `fs.openSync(inFifo, 'r+')` 持有 FIFO；Claude 标准输入输出由 shell 重定向到 FIFO，因此服务器重启不影响 detached Claude 的进程和输入端。

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

响应无输出达到 `readTimeoutMs` 时先 `cleanup()` 再失败当前 turn，防止迟到输出污染下一轮。

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

`AiRolesService.restoreAll()` 遍历 `RoleStore.list()`，为每个角色准备提示词文件并调用 `reconnect()`；重连失败只记录警告，角色仍保留，下一次聊天重新懒启动。

## 控制端渲染

```text
收到 roleList -> Chat.aiRoles=data.roles -> render()
收到 roleHistory -> Chat.roleHistories[role]=history；当前角色则 renderHistory()
收到 roleError -> showToast(message, error)

render():
  输出群聊 tab、既有模板 tab、每个工作角色 tab 和 '+' 添加按钮
  角色 tab 点击 -> mode='role', roleTarget=name, 请求 roleHistory
  '+' -> 输入名称并发送 roleAdd
  '×' -> confirm 后发送 roleDelete(role)

发送角色消息:
  chatMessage { mode:'role', role: roleTarget, content, requestId }
  // chatChunk/chatResponse 必须携带同一 requestId；控制端只接受等于 activeRequestId 的响应
  chatResponse -> 完成消息并使用返回 history 更新显示
```
