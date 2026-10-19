# 聊天 think 分流与私聊清空实现规范

## Chat2API Responses 独立思考字段传递（2026-10-19）

```text
已有声明 := Chat2API 上游 Chat Completions 的 delta.reasoning_content、message.reasoning_content
已有声明 := Responses 的 output_text 仅代表最终回答；控制端历史的 reasoning 决定 Think 按钮是否显示
新增定义 := response.reasoning_text.delta 表示本轮新增思考文字；response.reasoning_text 表示非流式或完成态思考文字

非流式转换:
    从上游消息读取 reasoning_content，非空时写入 Responses.reasoning_text
    output_text 与 output message 仍只包含回答正文

流式转换:
    收到 delta.reasoning_content 时累加并发出 response.reasoning_text.delta
    收到 delta.content 时仍发 response.output_text.delta
    完成态 response.reasoning_text 使用累加的思考文字
    持久化的上游续接历史仅使用 assistant 回答正文

AASC 聊天消费:
    收到 response.reasoning_text.delta 时累加独立思考，通知控制端刷新 Think 按钮
    依当前播报顺序将思考文字归入 think 分段，正文归入 answer 分段
    非流式调用将 response.reasoning_text 与回答解析结果合并，写入本地历史 reasoning
    流式完成时 server-app 将 reasoning 交给 chat.addMessage，历史快照保留该字段
    chat.addMessage 将 reasoning 限制为前 51200 字符；每会话历史限制最近 100 条
    saveHistory 合并约 2 秒后写入本地历史文件；控制端重载历史时继续显示 Think
    临时会话显式清空时按会话 ID 删除相应历史
    若上游没有思考字段，保留旧 answer/think 标签解析和无 Think 按钮行为

验证 := 提供 reasoning_content 的 Provider 在流式、非流式和历史中保留思考；
        回答正文不混入思考，控制端 Think 可展开，旧 Provider 不受影响
```

## 思考输出分流伪代码

```text
parseThinkOutput(value):
    text = String(value 或 '')
    answer = ''
    reasoning = ''
    speech = ''
    扫描大小写不敏感的 <think>/<thinking> 开始和结束标签
    标签内普通文本追加到 reasoning 和 speech
    标签外普通文本追加到 answer 和 speech
    标签本身不追加到任何输出
    遇到没有匹配开始标签的孤立结束标签:
        清除结束标签前的 answer/reasoning/speech 前缀，避免角色配置泄漏
    响应结束仍处于 think 标签内:
        将标签内文本保留到 reasoning 和 speech，不加入 answer
    返回 { answer, reasoning, speech }

stripThinkBlocks(value):
    return parseThinkOutput(value).answer

ThinkOutputFilter.push(delta):
    将 delta 追加到 rawText
    如果仍处于未判定状态，且开头可能是 XML/角色配置前缀:
        暂存内容，等待 think 结束标签或响应结束
    解析稳定的完整标签边界
    分别计算 answer、reasoning、speech 相对上次新增的 delta
    返回 { delta, message, reasoningDelta, reasoning, speechDelta, speech }

ThinkOutputFilter.finish():
    以完整 rawText 再次解析 answer、reasoning、speech
    补发未发送的三类文本尾部
    清空内部状态
```

## 聊天服务接入伪代码

```text
chat(...):
    读取 Responses 或 Chat Completions 的原始文本
    output = parseThinkOutput(rawText)
    将 output.answer、output.reasoning、output.speech 分别写入历史并返回

chatStream(...):
    为本次请求创建 ThinkOutputFilter 和 speech 分句缓存
    每个模型 delta:
        filter.push(delta)
        用 answerDelta/answer/reasoning 触发 onChunk
        用 speechDelta 更新播报分句缓存并触发 onSentence
    流结束:
        filter.finish()
        冲刷 answer、reasoning 和 speech 尾部
        用 answer、history、reasoning、speech 触发 onComplete
```

## 控制端与显示端展示伪代码

```text
chatChunk:
    message = 当前 answer
    reasoning = 当前 think 正文

chatResponse:
    message = 最终 answer
    reasoning = 最终 think 正文
    speech = 按模型输出顺序拼接并去除 think 标签的文本

Chat.renderHistory():
    assistant.content 只渲染 answer
    assistant.reasoning 非空时渲染 Think 按钮
    点击 Think 按钮:
        使用安全 Markdown 渲染器在弹窗中显示 reasoning

Chat.playMessage():
    优先播报 assistant.speech
    旧历史无 speech 时回退到 assistant.content

显示端语音回复气泡:
    将 speech 作为 detailText
    使用安全 Markdown 渲染器显示 think 正文和 answer
```

## 私聊清空伪代码

```text
Chat.clearHistory():
    读取当前 mode、privateTarget、privateSessionId
    如果 mode=private 且 target 为空:
        显示“当前私聊助手未就绪”并返回
    sessionId = privateSessionId 或 'default'
    请求 POST /api/chat/clear { mode, target, sessionId }
    解析 JSON 响应
    如果 HTTP 非 2xx 或 status != success:
        显示服务端返回的 message/error
        不更新页面历史
    否则:
        使用返回 history 更新本地历史
        重渲染当前私聊会话
        显示清空成功提示
```

## 回归契约

- `<think>内部</think>正文` 的 answer 为“正文”，reasoning 为“内部”，speech 为“内部正文”。
- 角色配置前缀 + 孤立 `</think>` + 正文的结果只能包含正文。
- 思考标签跨流式 chunk 时，`chatChunk.message` 不含 think；`reasoning` 只包含标签内正文；TTS 文本不含标签。
- 控制端历史气泡不内联 reasoning，但 Think 按钮可打开弹窗；显示端回复气泡显示 reasoning 和 answer。
- Think TTS 按模型输出顺序分句，且播报文本不包含 think 标签。
- 旧聊天历史无 reasoning/speech 字段时仍显示和播报原有正文。
- 私聊清空请求包含 `mode=private`、当前 `target` 和 `sessionId`。
- 私聊清空 HTTP 400/业务失败时控制端显示失败原因。
