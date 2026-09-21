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
