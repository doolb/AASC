# LLM 配置 Agent 模式实现规范

## 配置兼容

```text
normalizeProfile(profile):
    返回 profile 的副本
    如果 mode 缺失 → mode = 'llm'
    如果 mode = 'agent' 且 backend 缺失 → backend = 'pi'
    如果 mode 不是 'llm' 或 'agent' → 抛出配置错误
    如果 mode = 'agent' 且 backend != 'pi' → 抛出暂不支持错误

normalizeTemplate(template):
    返回 template 的副本
    如果 permissionProfile 缺失 → permissionProfile = 'readonly'
    如果 permissionProfile 不在服务器支持的策略集合 → 抛出权限策略错误
    不接受请求体直接传入的工具数组
```

## Profile 历史键

```text
sessionKey(profileName, templateId, mode, target, sessionId):
    profileKey = profileName 或 'default'
    templateKey = templateId 或 'default'
    如果 mode = 'private' 且 target 存在:
        返回 'profile:' + profileKey + ':template:' + templateKey + ':private:' + target + ':' + (sessionId 或 'default')
    返回 'profile:' + profileKey + ':template:' + templateKey + ':group'
```

```text
loadHistory():
    读取 chat-history*.json
    对每条记录:
        如果记录缺少 profile → profile = 启动时 activeProfile
        如果记录缺少 sessionId → sessionId = 'default'
        如果记录缺少 templateId → templateId = 'default'
        使用 sessionKey(record.profile, record.templateId, record.mode, record.target, record.sessionId) 分组
```

保存历史时按 profile 和会话生成安全文件名，禁止 profile 名称或私聊目标穿越目录。

## PiRuntimeManager

```text
PiRuntimeManager(options):
    sessions = Map<(profileName, templateId, permissionProfile, conversationKey), PiSession>
    spawn = 注入的子进程创建函数，生产环境使用 child_process.spawn
    projectRoot = 固定项目根目录
    extensionPath = 项目内置只读扩展路径
    requestTimeoutMs = options.requestTimeoutMs || 600000
    requestQueueTimeoutMs = options.requestQueueTimeoutMs || 30000
    logger = options.logger 或空函数

logPi(event, details):
    调用 logger(event, details)
    logger 失败时忽略日志异常，不影响 Pi 请求

getOrCreate(profile, template):
    校验 profile.mode == 'agent' 且 profile.backend == 'pi'
    校验 template.permissionProfile 是服务器支持的策略
    根据 permissionProfile 映射固定工具白名单；文件查找使用 aasc_find，不启用依赖 fd 的 Pi 原生 find
    如果 sessions 中存在同一 profile/template/permission 且配置指纹未变化:
        返回已有 session
    如果存在但配置指纹或权限策略变化:
        stop(sessionKey)
    创建 PiSession(profile, template, toolAllowlist)
    返回 session

chatStream(profile, template, prompt, callbacks, options):
    session = getOrCreate(profile, template, options.conversationKey)
    生成 requestId
    记录请求入队和实际开始，日志包含 requestId、会话键和队列等待信息
    将请求加入 session 串行队列，并为“从入队到开始执行”单独设置 requestQueueTimeoutMs
    如果排队超时:
        标记该排队任务已过期，不再调用 Pi
        callbacks.onError('Pi 请求排队超时')
        让 session.queue 继续处理其他任务
    如果请求失败且错误属于空回复或可恢复 RPC 错误:
        终止并删除当前 session
        记录“Pi 会话重建”
        使用新 session 自动重试一次
    重试仍失败、请求超时、协议错误或配置错误:
        callbacks.onError(error)
    session.ensureStarted()
    如果 session 尚未初始化:
        通过 stdin 写入 { id, type: 'prompt', message: prompt }\n
    否则:
        continuation = options.continuationPrompt 或 prompt
        如果 continuation 不以 'User:' 开头:
            continuation = 'User:' + continuation
        通过 stdin 写入 { id, type: 'prompt', message: continuation }\n
    读取 stdout JSONL:
        记录 requestId 关联的关键事件类型；工具事件只记录工具名/长度，不记录完整内容
        type='response' 且 id 匹配且 success=false → 当前请求失败
        type='message_update' 且 assistantMessageEvent.type='text_delta':
            callbacks.onChunk(delta, fullMessage)
            按句切分，完整句调用 callbacks.onSentence
        type='agent_end':
            如果 willRetry=true → 记录重试事件，继续等待后续事件
            如果最后 assistant 消息 stopReason='error' 或存在 errorMessage:
                终止当前 session，记录失败，交给上层判断是否自动重试
            否则提取最终文本
            如果最终文本为空 → 终止当前 session，记录空回复失败，交给上层判断是否自动重试
            否则记录完成，callbacks.onComplete(fullMessage)
    stderr 仅写服务器 Agent 日志，不作为助手消息
    等待当前请求响应时使用 requestTimeoutMs 计时
    超时 → stop(session)，callbacks.onError('Pi 请求超时')
    退出/非法协议 → stop(session)，callbacks.onError(error)

resetSession(profile, template, conversationKey):
    计算同 chatStream 的会话键
    停止并删除对应 PiSession
    下次请求重新使用剩余应用历史初始化
```

```text
主动压缩（当前暂不实现）:
    Pi RPC 支持 { type: 'compact', customInstructions? }
    当前 PiRuntimeManager 不发送 compact，不提供控制端按钮，也不按阈值主动触发
    继续使用 Pi 自带的接近上下文上限自动压缩机制
```

Pi 启动参数伪代码：

```text
spawn('pi', [
    '--mode', 'rpc',
    '--no-session',
    '--no-context-files',
    '--no-extensions',
    '--extension', readonlyExtensionPath,
        '--provider', 'aasc-openai',
        '--model', 'aasc-openai/' + profile.model,
    '--tools', toolAllowlist.join(',')
], {
    cwd: projectRoot,
    env: {
        ...process.env,
        PI_CODING_AGENT_DIR: profileRuntimeDir,
        AASC_PI_BASE_URL: normalizeOpenAiBaseUrl(profile.apiUrl),
        AASC_PI_MODEL: profile.model,
        AASC_PI_API_KEY: normalizePiApiKey(profile.apiKey)
    },
    stdio: ['pipe', 'pipe', 'pipe']
})
```

只读策略扩展在启动时用环境变量注册 `aasc-openai` provider，并注册 `aasc_find`、`aasc_web_search` 和 `aasc_web_fetch`。`aasc_find` 使用 Node 文件系统递归遍历和 glob 匹配，不依赖 `fd` 或网络下载。扩展不导入写文件 API，不注册 bash/edit/write 工具。后续命令策略通过另一个固定扩展或固定工具集合接入，不允许模板内容动态生成工具。

Chat2API 工具转换伪代码：

```text
parseChat2ApiToolCalls(text, allowedTools):
    查找 `<|CHAT2API|tool_calls>` 后的所有工具调用块
    对每个块读取旧式 `<|parameter=参数名>值</parameter>` 或命名参数 CDATA 格式
        `<|CHAT2API|parameter name="参数名"><![CDATA[值]]></|CHAT2API|parameter>` 参数
    接受 `</function>` 或 `</|CHAT2API|invoke>` 调用结束标签
    如果工具名不在 allowedTools → 返回 unsupportedTool 错误，不执行
    如果参数名重复、标签未闭合或工具调用为空 → 返回 malformedProtocol 错误
    将外部工具名 find 映射为内部工具名 aasc_find
    返回 calls = [{ id: 'chat2api-' + 序号, name: 内部工具名, arguments }]
    删除可选的 `</|CHAT2API|tool_calls>` 结束标记
    返回 remainingText = 删除协议块和标记后的普通文本
```

```text
createChat2ApiCompatibleProvider(baseProvider):
    stream(model, context, options):
        source = baseProvider.stream(model, context, options)
        等待 source 完成并取得最终 AssistantMessage
        如果 source 失败 → 原样生成 error 事件
        result = parseChat2ApiToolCalls(最终消息中的文本, 当前 context.tools)
        如果没有 Chat2API 标签 → 原样回放文本/思考/完成事件
        如果 result 有错误 → 生成明确 provider error，不回放原始标签
        否则 → 生成普通文本块和 Pi toolCall 块
        stopReason = 存在 calls 时为 toolUse，否则沿用原结果
        发送 done(message)
```

```text
toolCallArguments:
    参数值默认作为字符串保留
    对唯一 JSON 对象/数组/数字/布尔/null 参数尝试 JSON 解析
    JSON 解析失败时保留原始字符串，避免破坏 read/grep 等文本参数
    不允许通过协议文本新增工具，工具集合仍由 readonly permissionProfile 决定
```

`normalizePiApiKey(apiKey)`：真实 Key 原样返回；空 Key 返回 `aasc-local-key` 占位值，使本地无鉴权 OpenAI 兼容服务通过 Pi provider 的非空 Key 校验。

高级指令路由伪代码：

```text
checkMultiHandlerKeywords(message, routing, activeProfile):
    piAgentLlmRoute(commandType):
        routing[commandType] == 'llm'
        且 activeProfile.mode == 'agent'
        且 activeProfile.backend == 'pi'

    如果 message 包含“天气”且不是 piAgentLlmRoute('weather'):
        添加 weather 旧处理器
    如果 message 包含“搜索”且不是 piAgentLlmRoute('search'):
        添加 search 旧处理器
    返回旧处理器列表

    routing[commandType] == 'system' 时不跳过旧处理器
    routing[commandType] == 'llm' 且当前 profile 为 Pi Agent 时只保留当前聊天请求
    不修改持久化 routing
```

## 上下文构建

```text
buildAgentPrompt(userMessage, options):
    messages = buildMessages(userMessage, {
        systemPrompt: options.systemPrompt,
        includeHistory: options.includeHistory,
        contextCount: options.contextCount,
        mode: options.mode,
        target: options.target,
        profile: activeProfile,
        templateId: options.templateTarget
    })
    返回结构化纯文本：
        System: messages 中的 system 内容
        User/Assistant: 最近历史，其中助手历史统一使用 Assistant:
        User: 当前消息
```

Pi 初始进程的系统提示词包含 profile 的系统提示词和只读工具规则；每次请求只发送当前消息和必要的历史上下文，避免把其他 profile 的记录发送给 Agent。

## 聊天分流

```text
chatStream(userMessage, options, callbacks):
    profile = 当前 active profile
    profile = normalizeProfile(profile)
    如果 profile.mode == 'agent':
        prompt = buildAgentPrompt(userMessage, options)
        template = loadTemplate(options.templateTarget)
        conversationKey = encode(mode, target, sessionId)
        PiRuntimeManager.chatStream(profile, template, prompt, callbacks, {
            continuationPrompt: userMessage,
            conversationKey
        })
        成功后沿用普通聊天 onComplete/history 保存流程
        失败后只调用 onError，不调用普通 LLM HTTP 请求
        返回
    否则:
        使用现有 OpenAI 兼容 SSE 流程

deleteConversationRound(messageId, scope):
    在 active profile 和 scope 对应历史中定位 messageId
    如果目标是用户消息:
        删除目标消息
        如果下一条是同 scope 的 assistant 消息，一并删除
    保存历史
    PiRuntimeManager.resetSession(profile, template, conversationKey)
    返回最新全局历史
```

## 服务器生命周期

```text
server 初始化:
    创建 PiRuntimeManager(projectRoot)
    chat.init(config.chat, { piRuntimeManager })

服务器退出信号/HTTP 重启前:
    await piAgentManager.stopAll()
    关闭每个 stdin
    等待子进程退出，超时后发送 SIGTERM/SIGKILL
```

## 只读网络工具

```text
aasc_web_fetch(url):
    只接受 http/https
    拒绝 file/data/javascript 等协议
    限制重定向次数、响应大小和超时时间
    仅 GET
    返回文本摘要，不保存响应文件

aasc_web_search(query):
    校验 query 非空且长度受限
    使用固定搜索服务 GET 接口
    解析标题、链接、摘要
    限制结果数、响应大小和超时时间
    不执行返回内容
```

## 错误与回收

```text
onPiError(profileName, error):
    清理 stdout/stderr 监听器和 pending request
    结束当前请求并返回 error
    从 sessions 删除 profile
    下次 Agent 请求重新 spawn

控制端聊天日志:
    收到 chatMessage 时记录 requestId、displayId、mode 和 content 摘要
    发送 chatChunk/chatResponse 时记录 requestId、成功状态和文本长度
    前端只接受 activeRequestId 对应的 chatResponse；日志用于区分服务端未回包和前端主动丢弃迟到回包

## 控制端权限设置

```text
控制端保存聊天模板:
    读取 templateId、name、content、permissionProfile
    permissionProfile 缺失时使用 readonly
    POST /api/chat/templates
    服务端 normalizeTemplate()
    保存模板配置

普通聊天请求:
    只传 templateId
    服务端按 templateId 读取已保存模板和 permissionProfile
    不信任请求中的任意 tools 字段
```

当前不实现管理员接口和用户身份鉴权；控制端模板设置直接作为权限策略来源。服务器仍执行策略枚举校验和固定工具白名单。
```
