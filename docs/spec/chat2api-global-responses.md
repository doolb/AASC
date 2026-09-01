# Chat2API 全局 Responses 协议实现规范

## 配置伪代码

```text
chatConfig:
    protocol = "openai-responses"
    responsesBaseUrl = "http://127.0.0.1:8083/v1"
    responsesApiKey = ""
    apiUrl = 旧 Chat Completions 地址
    apiKey = 旧 profile 凭据
```

```text
normalizeChatTransport(config):
    如果 config.protocol == "openai-responses":
        返回 Responses transport 和 responsesBaseUrl
    否则:
        返回旧 Chat Completions transport 和 apiUrl
```

## 统一 Responses 客户端伪代码

```text
createAascResponsesClient(options):
    request(requestBody, requestOptions):
        生成 POST /v1/responses 请求
        附加 Content-Type 和可选 Authorization
        读取 JSON response
        response.error 存在 -> 抛出可识别错误
        返回 response

    stream(requestBody, onEvent, requestOptions):
        生成 POST /v1/responses 请求且 stream=true
        按 SSE 行读取 data JSON
        对每个 Responses 事件调用 onEvent
        [DONE] -> 正常结束
        HTTP 错误或 response.failed -> 抛出错误
```

## 普通聊天 Responses 状态伪代码

```text
loadChatResponseState(sessionKey):
    读取 chat-responses-sessions 集合
    返回 sessionKey 对应状态或空

buildResponsesRequest(messages, state, options):
    fingerprint = profile + template + systemPrompt + model
    如果 state 缺失或 state.fingerprint != fingerprint:
        input = messages
        不携带旧 response id
    否则:
        input = 当前新增消息
        携带 state.conversationId 或 state.latestResponseId
    返回 model、input、temperature、max_output_tokens、stream

saveChatResponseState(sessionKey, response, fingerprint):
    保存 conversation.id、response.id、model、fingerprint、updatedAt
```

```text
selectProviderMessages(session, inputMessages):
    如果 session.providerId 对应的 nativeState 包含可续接标识:
        返回 inputMessages
    否则:
        返回 session.history + inputMessages
```

```text
chat(userMessage, options):
    如果 active profile 是 Pi Agent:
        转入 chatStream 的 Pi 分支
    messages = buildMessages(userMessage, options)
    transport = normalizeChatTransport(chatConfig)
    如果 transport 是 Responses:
        state = loadChatResponseState(sessionKey)
        body = buildResponsesRequest(messages, state, options)
        response = client.request(body)
        text = response.output_text
        saveChatResponseState(sessionKey, response, fingerprint)
    否则:
        执行旧 Chat Completions 请求
    写入本地聊天历史并返回 text
```

```text
chatStream(userMessage, options, callbacks):
    messages = buildMessages(userMessage, options)
    如果 transport 是 Responses:
        state = loadChatResponseState(sessionKey)
        streamBody = buildResponsesRequest(messages, state, options)
        client.stream(streamBody, event):
            response.output_item.added(message/function_call) -> 建立 output item
            response.output_text.delta -> onChunk(delta)
            response.function_call_arguments.delta/done -> 传递工具参数增量
            response.output_item.done -> 结束文本或工具 output item
            response.output_text.done -> 更新完整文本
            response.completed -> 保存 response/conversation 状态
            response.failed -> onError(error)
    否则:
        执行旧 Chat Completions SSE 流程
    按现有句子切分、历史保存和完成回调返回
```

## Pi Provider 伪代码

```text
createChat2ApiCompatibleProvider():
    api = openAIResponsesApi()
    tracker = createResponsesContinuationTracker()
    model.api = "openai-responses"
    model.baseUrl = responsesBaseUrl
    api.stream / api.streamSimple:
        按 Pi sessionId 查找最近 responseId 和已发送消息快照
        只比较 role、content、工具调用名称/参数和调用 ID 等语义字段
        忽略 api、provider、model、usage、timestamp、stopReason 等运行时字段
        快照匹配当前上下文前缀 -> 只发送新增消息并附 previous_response_id
        快照不匹配 -> 清除旧 responseId，发送完整上下文并使用 piSessionId 对应 conversation
        previous_response_id 和 conversation 不能同时发送
        Responses SSE 完成后保存新的 responseId 和上下文快照
        请求 metadata 写入 aasc_context_owner=pi、aasc_pi_session_id、aasc_pi_context_mode

Chat2API Responses 服务收到 aasc_context_owner=pi:
    如果 mode == snapshot 且已有 Provider nativeState:
        只使用 Pi 传入的完整 input
        清空 responseSession.nativeState，创建新的 Provider 原生会话
    否则:
        有 Provider nativeState -> 只使用本次 input 增量
        无 Provider nativeState -> 按普通规则重放本地历史
    记录 conversationId、Provider sessionId 和 piSessionId，但不重复拼接 Pi 完整历史
    Responses message output -> Pi assistant event stream
    Responses function_call output -> Pi toolCall
    Responses output_item 事件必须先于 delta 事件建立对应内容块
    Provider 不支持原生 function tool 时:
        由核心适配层统一将已授权工具的名称、参数和 Chat2API 标签格式加入首个 system 消息
        保存工具提示指纹；同一原生会话的后续增量请求不再重复注入
        旧原生会话没有指纹时，按已有会话已注入过提示处理，避免重复 System
        从请求中移除 tools 和 tool_choice，Provider 只接收 managed_xml 文本协议
        仅解析白名单工具标签，其他标签报错
    未识别工具事件 -> 返回 error，不加入普通文本
```

## Chat2API 公共工具提示伪代码

```text
prepareManagedToolRequest(request, responseSession):
    tools = 过滤有效 function 工具
    tools 为空 -> 原样返回 request
    prompt = 使用统一 managed_xml 协议渲染工具定义
    promptHash = 对规范化工具定义计算稳定指纹
    promptExists = 扫描 system/user 消息中的协议标记和工具提示签名
    nativeState = responseSession.nativeState

    如果 promptExists:
        nativeState.managedToolPromptHash = promptHash
    否则如果 nativeState.managedToolPromptHash == promptHash:
        不注入 prompt
    否则如果存在旧 Provider 原生会话但没有 managedToolPromptHash:
        不注入 prompt，并记录 promptHash，兼容旧会话避免重复 System
    否则:
        将 prompt 追加到首个 system 消息，或新建 system 消息
        nativeState.managedToolPromptHash = promptHash

    返回复制后的 request.messages、删除 tools 和 tool_choice 的请求
```

## 单次 LLM 任务伪代码

```text
llm.chat.run(context):
    messages = 根据 promptFormat 生成 system/user 消息
    如果全局协议是 Responses:
        response = responsesClient.request({ model, input: messages, stream })
        非流式返回 response.output_text
        流式把 response.output_text.delta 转成 taskIO chunk
    否则:
        保持旧 Chat Completions 请求
```

## 外部实例停用伪代码

```text
switchToResponsesAndStopExternal():
    确认内置 8083 /health 为 running
    保存 chat.protocol = "openai-responses"
    重启 AASC 主服务
    执行真实普通、流式、Pi 工具和重启续聊测试
    精确查找命令路径为 /mnt/Chat2API 的进程树
    发送 TERM，等待退出，必要时只对同一进程树发送 KILL
    再次检查 8083 /health
```

## 错误和回退

```text
Responses 返回 404 conversation_not_found:
    删除本地 Responses 状态
    使用本地历史重新发送完整 input

Responses 返回 401/403/5xx:
    保留旧 profile 配置
    返回原有聊天错误，不回退到外部 /mnt/Chat2API

Pi 工具事件无法解析:
    不把 JSON/工具参数输出到文本
    返回 Pi 可识别错误并保留本地历史一致性
```

## 测试契约

```text
统一客户端:
    非流式读取 output_text
    流式读取 delta/done/completed
    发送 conversation/previous_response_id
    HTTP 错误转换

普通聊天:
    首轮完整 input
    第二轮同 session 只发当前输入
    Provider 已有原生会话时，核心适配器只接收当前新增消息
    Provider 无原生会话时，核心适配器重放保存的历史
    profile/template 改变后创建新 Responses 会话
    重启后加载本地状态继续

Pi:
    api == openai-responses
    文本回复正常
    同一 Pi session 后续请求携带 previous_response_id 和消息增量
    Pi 上下文压缩或分支变化后自动重新建立 Responses 链
    工具调用和 function_call_output 闭环
    控制端带 displayId 时通过 chatMessage 收到 chatChunk 和 chatResponse
    两轮真实控制端请求能从同一 Pi session 读取首轮上下文

停用:
    外部 Chat2API 进程不存在
    内置 8083 仍健康
    外部配置目录仍存在
```
