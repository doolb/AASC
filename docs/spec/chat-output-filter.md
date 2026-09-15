# 聊天输出过滤与私聊清空实现规范

## 思考输出过滤伪代码

```text
stripThinkBlocks(value):
    text = String(value 或 '')
    扫描大小写不敏感的 <think>/<thinking> 开始和结束标签
    遇到开始标签:
        丢弃标签前后处于思考块内的文本
        insideThink = true
    遇到结束标签:
        如果 insideThink:
            insideThink = false
        否则:
            将结束标签之前的内容视为隐式思考前缀并丢弃
    如果响应结束时仍 insideThink:
        丢弃未闭合思考块
    返回剩余正文并清理首尾空白

ThinkOutputFilter.push(delta):
    将 delta 追加到 rawText
    如果仍处于未判定状态，且开头可能是 XML/角色配置前缀:
        暂存内容，等待 think 结束标签或响应结束
    计算 stripThinkBlocks(rawText)
    只把累计正文相对上次新增的部分作为 visibleDelta
    返回 { delta: visibleDelta, message: visibleMessage }

ThinkOutputFilter.finish():
    以完整 rawText 执行 stripThinkBlocks
    补发未发送的正文尾部
    清空内部状态
```

## 聊天服务接入伪代码

```text
chat(...):
    读取 Responses 或 Chat Completions 的原始文本
    assistantMessage = stripThinkBlocks(rawText)
    将 assistantMessage 写入历史并返回

chatStream(...):
    为本次请求创建 ThinkOutputFilter
    每个模型 delta:
        filter.push(delta)
        用 visibleDelta 触发 onChunk/onSentence
        用 visibleMessage 作为当前累计消息
    流结束:
        filter.finish()
        用清洗后的完整消息触发 onComplete
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

- `<think>内部</think>正文` 的结果只能包含“正文”。
- 角色配置前缀 + 孤立 `</think>` + 正文的结果只能包含正文。
- 思考标签跨流式 chunk 时，任何 `chatChunk` 和最终 `chatResponse` 都不包含内部内容。
- 私聊清空请求包含 `mode=private`、当前 `target` 和 `sessionId`。
- 私聊清空 HTTP 400/业务失败时控制端显示失败原因。
