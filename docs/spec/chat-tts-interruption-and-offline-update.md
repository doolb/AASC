# 聊天 TTS 打断与 Offline 定时更新实现规范

## 聊天 TTS 会话伪代码

```text
function chatTtsConversationId(mode, target, sessionId, role):
    return stableJoin(mode, target, sessionId, role)

function beginChatTts(conversationId):
    version[conversationId] += 1
    return version[conversationId]

function stopChatTts(conversationId, phase = null):
    version[conversationId] += 1
    send targeted stop message(conversationId, phase)

on chat request:
    conversationId = chatTtsConversationId(request)
    generation = beginChatTts(conversationId)
    on sentence(sentence, phase):
        if phase == answer and first answer sentence:
            send targeted stop(conversationId, think)
            clear client think queue
        enqueue TTS(sentence, conversationId, phase, generation)
    when TTS generation completes:
        if generation is not current: discard
        else send playAudio with conversationId and phase

on display/control stop button:
    stop local queue for conversationId
    send tts stop with conversationId and optional phase
```

## 流式思维链分段伪代码

```text
parse each output delta into ordered speech segments:
    { text: ..., phase: "think" }
    { text: ..., phase: "answer" }

accumulate sentence text per phase
emit complete sentences with phase
at phase transition flush unfinished think segment
on complete flush remaining segment
```

## Offline 更新检查伪代码

```text
on Activity resume:
    if Offline and full install exists:
        check service update once
        check min APK once
        schedule next check after 10 minutes

periodic check:
    if Activity is resumed and no download/install is running:
        reset per-cycle check guards
        check service update and min APK

on Activity pause/stop:
    cancel periodic callback

on Activity destroy:
    cancel periodic callback and existing delayed UI callbacks
```

## 兼容性

- 未携带聊天 TTS 字段的旧服务消息仍按原有全局队列播放。
- 未携带 `chatTtsConversationId` 的普通 `tts.stop` 保持原有全局停止行为。
- 旧 Offline 更新清单和既有手动下载流程不变。

## 实际代码映射

```text
server-app.js:
    chatMessage -> build conversation id -> begin generation -> stream sentence phase
    new request or tts.stop -> invalidate generation -> send targeted stop
    think -> answer -> stop only the think queue, then enqueue answer audio

display.html:
    play/playAudio -> retain chat metadata in local queue
    tts.stop(chatOnly, conversationId, phase) -> remove matching current/queued items

chat.js:
    sending a new message -> stop current session queue -> send targeted tts.stop
    stopChatTts -> stop only matching control audio item and notify server

MainActivity.kt:
    onResume -> run checks -> schedule 10-minute runnable
    runnable -> reset completed check guards -> run checks -> reschedule
    onPause/onDestroy -> remove runnable
```

## 实现验证

- `tests/chat-think-filter.test.js` 验证 `think`/`answer` 阶段随句子传递。
- `tests/chat-tts-interruption.test.js` 验证服务端协议、显示端/控制端队列入口和 Android 前台轮询契约。
- 旧版不带聊天字段的消息仍使用原有全局 TTS 队列；本次新增字段不改变普通媒体和报时消息。


## Offline 双页重启刷新隔离（2026-10-10，已实现）

```text
已有声明：WebSocketManager.handleMessage/serverStartTime分支、display页面重启消息分支
新增定义：各页面实例 observedServerStartTime = 空、serverReloadRequested = 否
接收serverStartTime：
    非数字/数字字符串，或非有限正数 → 忽略
    规范化时间为数字字符串
    首次消息 → 本页内存记录时间，不刷新
    时间相同，或本页已经请求刷新 → 返回
    时间改变 → 先更新本页时间、标记已请求刷新 → location.reload一次
页面重新加载 → 创建新的空基准；首次连接正常建立基准，不循环刷新
同源双页/多个控制页 → 内存互不共享；任意重连顺序均各自刷新
兼容旧共享键 → 不再读取或写入localStorage.serverStartTime，保留该键及其他用户数据
存储禁用/读写异常 → 本流程不依赖存储，不阻断重启消息
```

页面加载后第一条消息作为基准，因为此时页面已从服务端重新取得；不使用持久化旧时间触发首连刷新，避免存储写入失败后无限reload。页面仍在旧服务上但从未成功连接过的极端情况无法通过重启时间判断，需要实际重载页面；不扩展原生更新协议。已确认修复已连接两页的竞态，设备实际安装版本/IP仍待确认。

代码映射：websocket.js的WebSocketManager保存observedServerStartTime/serverReloadRequested，handleMessage委托handleServerStartTime；display.html具有同名页面变量与函数，正式socket.onmessage委托处理。tests/offline-page-reload.test.js执行正式函数与实际浏览器刷新，15文件119/119通过。旧聊天按钮契约检查HEAD同样失败，不影响本轮重启流程。
