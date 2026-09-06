# LLM 配置 Agent 模式实现规范

## 配置兼容

```text
normalizeProfile(profile):
    返回 profile 的副本
    如果 mode 缺失 → mode = 'llm'
    如果 mode = 'agent' 且 backend 缺失 → backend = 'pi'
    如果 mode 不是 'llm' 或 'agent' → 抛出配置错误
    如果 mode = 'agent' 且 backend 不在 ['pi', 'codex'] → 抛出后端配置错误

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

## PiRuntimeManager（SDK 内嵌实现）

```text
PiRuntimeManager(options):
    sessions = Map<(profileName, templateId, permissionProfile, conversationKey), PiSession>
    sdkLoader = options.sdkLoader 或动态加载 @earendil-works/pi-coding-agent
    readonlyToolsLoader = options.readonlyToolsLoader 或动态加载项目内置工具模块
    projectRoot = 固定项目根目录
    responsesBaseUrl = options.responsesBaseUrl 或空字符串
    requestTimeoutMs = options.requestTimeoutMs || 600000
    requestQueueTimeoutMs = options.requestQueueTimeoutMs || 30000
    logger = options.logger 或空函数

createSdkSession(profile, template, conversationId):
    sdk = await sdkLoader()
    toolsModule = await readonlyToolsLoader()
    policy = resolvePermissionPolicy(template.permissionProfile)
    provider = toolsModule.createAascChat2ApiProvider({
        baseUrl: responsesBaseUrl 或 normalizeOpenAiBaseUrl(profile.apiUrl),
        modelId: profile.model,
        apiKey: profile.apiKey,
        conversationId
    })
    modelRuntime = await sdk.ModelRuntime.create({ refreshOnCreate: false })
    modelRuntime.registerNativeProvider(provider)
    model = modelRuntime.getModel('aasc-openai', profile.model)
    resourceLoader = sdk.DefaultResourceLoader({
        cwd: projectRoot,
        agentDir: 临时运行目录,
        settingsManager: sdk.SettingsManager.inMemory(),
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true
    })
    result = await sdk.createAgentSession({
        cwd: projectRoot,
        model,
        modelRuntime,
        resourceLoader,
        sessionManager: sdk.SessionManager.inMemory(projectRoot),
        settingsManager: sdk.SettingsManager.inMemory(),
        customTools: toolsModule.createAascReadonlyTools(),
        tools: policy.tools
    })
    返回 result.session

getOrCreate(profile, template):
    校验 profile.mode == 'agent' 且 profile.backend == 'pi'
    校验 template.permissionProfile 是服务器支持的策略
    根据 permissionProfile 映射固定工具白名单；文件查找使用 aasc_find，不启用依赖 fd 的 Pi 原生 find
    生成配置指纹；相同配置复用现有 AgentSession
    配置变化时先 dispose 旧 AgentSession
    为新会话生成 conversationId，并异步创建 SDK AgentSession
    订阅 session.subscribe()，只处理 message_update、agent_end 和错误事件
    返回 session

会话生命周期:
    群聊固定使用 mode=group、target=null、sessionId=default 的 conversationKey
    私聊按 mode=private、target、sessionId 隔离
    模式、私聊目标或私聊 sessionId 切换时回收旧 conversationKey 的 PiSession
    应用层聊天历史不删除；下一次请求按新 key 创建内存 AgentSession

chatStream(profile, template, prompt, callbacks, options):
    session = await getOrCreate(profile, template, options.conversationKey)
    生成 requestId
    记录请求入队和实际开始，日志包含 requestId、会话键和队列等待信息
    将请求加入 session 串行队列，并为“从入队到开始执行”单独设置 requestQueueTimeoutMs
    如果排队超时:
        标记该排队任务已过期，不调用 session.prompt()
        callbacks.onError('Pi 请求排队超时')
        让 session.queue 继续处理其他任务
    session.prompt(initialPrompt 或 'User:' + continuationPrompt)
    订阅的 message_update.text_delta 转换为 callbacks.onChunk
    订阅的 agent_end:
        如果 willRetry=true → 记录重试事件，继续等待后续事件
        如果最后 assistant 消息 stopReason='error' 或存在 errorMessage:
            dispose 当前 session，交给上层判断是否自动重试
        否则提取最终文本
        如果最终文本为空 → dispose 当前 session，交给上层判断是否自动重试
        否则记录完成，callbacks.onComplete(fullMessage)
    prompt() 的异常转换为 PI_SDK_ERROR
    等待当前请求响应时使用 requestTimeoutMs 计时
    超时 → abort() 后 dispose(session)，callbacks.onError('Pi SDK 请求超时')
    dispose() 不启动子进程，不读取 stdin/stdout，不留下 Pi CLI 进程

resetSession(profile, template, conversationKey):
    计算同 chatStream 的会话键
    dispose 并删除对应 PiSession
    下次请求重新使用剩余应用历史初始化
```

Pi SDK 内嵌边界：

```text
createAascChat2ApiProvider(options):
    返回 pi-ai Provider，固定 id='aasc-openai'
    auth.resolve() 只读取当前 profile apiKey；空 Key 使用本地占位 Key
    stream/streamSimple 复用现有 Responses continuation 和 Chat2API 工具转换
    provider 通过 ModelRuntime.registerNativeProvider() 注册，不使用环境变量传递请求凭据

createAascReadonlyTools():
    返回固定的 aasc_find、aasc_web_search、aasc_web_fetch ToolDefinition
    内置工具白名单只允许 read、grep、ls 与上述只读工具
    DefaultResourceLoader 禁用 extensions、skills、prompt templates、themes 和 context files
    AgentSession 使用 SessionManager.inMemory()、SettingsManager.inMemory()
    session.dispose() 是唯一会话回收入口；服务器停止时遍历所有 session 执行 dispose()
```

主动压缩仍暂不实现：继续使用 Pi AgentSession 自带的接近上下文上限自动压缩机制；后续如增加手动压缩，必须复用当前 session 串行队列。

## CodexRuntimeManager

```text
CodexRuntimeManager(options):
    sessions = Map<(profileName, templateId, permissionProfile, conversationKey), CodexSession>
    bridgeFactory = 注入的 CodexBridge 工厂，生产环境使用 Codex app-server stdio
    projectRoot = 固定项目根目录
    runtimeRoot = 独立于工作 Agent 的临时目录
    proxy = options.proxy 或 'http://127.0.0.1:7899'

getOrCreate(profile, template, developerInstructions):
    校验 profile.mode == 'agent' 且 profile.backend == 'codex'
    生成配置指纹；系统提示词或 profile 配置改变时停止旧 session
    创建 CodexBridge({ cwd: projectRoot, dir: 独立 session 目录,
        approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly' },
        developerInstructions })
    返回 session

chatStream(profile, template, initialPrompt, callbacks, options):
    session = getOrCreate(profile, template, options.developerInstructions)
    将请求加入 session 串行队列
    如果 session 尚未初始化:
        Codex thread/start 使用 developerInstructions
        turn/start 输入 initialPrompt（含必要的 User/Assistant 历史）
    否则:
        turn/start 只输入 options.continuationPrompt 或 initialPrompt
    将 item/agentMessage/delta 转换为 onChunk，turn/completed 转换为 onComplete
    失败时停止 session；下次请求重新创建 thread

resetSession(profile, template, conversationKey):
    计算同 chatStream 的会话键，停止并删除对应 CodexSession
```

```text
chatConfig.codexProxy:
    普通聊天 Runtime 和工作 Agent bridge 创建时都读取该代理地址
    默认值为 'http://127.0.0.1:7899'
    已运行的 bridge 不动态切换；下次创建或重启 bridge 时生效
```

```text
主动压缩（当前暂不实现）:
    Pi AgentSession 自带上下文压缩能力
    当前 PiRuntimeManager 不提供控制端主动压缩入口，也不按阈值主动触发
    继续使用 Pi SDK 在接近上下文上限时的自动压缩机制
```

Chat2API 工具转换伪代码：

```text
parseChat2ApiToolCalls(text, allowedTools):
    查找 `<|CHAT2API|tool_calls>`，按完整区块定位对应的 `</|CHAT2API|tool_calls>`
    在每个完整区块内查找 invoke
    对每个 invoke 读取旧式 `<|parameter=参数名>值</parameter>` 或命名参数 CDATA 格式
        `<|CHAT2API|parameter name="参数名"><![CDATA[值]]></|CHAT2API|parameter>` 参数
    允许旧式 `</function>` 或 canonical `</|CHAT2API|invoke>`，并消费实际匹配到的结束标签全文
    如果工具名不在 allowedTools → 返回 unsupportedTool 错误，不执行
    如果区块未闭合、参数名重复、参数标签未闭合、调用之间有未识别文本或工具调用为空
        → 返回 malformedProtocol 错误
    将外部工具名 find 映射为内部工具名 aasc_find
    返回 calls = [{ id: 'chat2api-' + 序号, name: 内部工具名, arguments }]
    从普通文本中删除完整 tool_calls 区块
    如果删除后仍有未识别 Chat2API 协议标签 → 返回 malformedProtocol 错误
    返回 remainingText = 删除完整协议区块后的普通文本
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
        如果 profile.backend == 'pi':
            PiRuntimeManager.chatStream(profile, template, prompt, callbacks, {
                continuationPrompt: userMessage, conversationKey
            })
        如果 profile.backend == 'codex':
            CodexRuntimeManager.chatStream(profile, template,
                buildCodexConversationPrompt(messages), callbacks, {
                    developerInstructions: buildCodexDeveloperInstructions(messages),
                    continuationPrompt: userMessage, conversationKey
                })
        成功后沿用普通聊天 onComplete/history 保存流程
        失败后只调用 onError，不调用普通 LLM HTTP 请求
        返回
    否则:
        使用现有 OpenAI 兼容 SSE 流程

## 控制端 profile 编辑

```text
打开普通聊天设置:
    调用模式选择 = 'llm' 或 'agent'
    如果 mode == 'agent':
        显示 Agent 后端 = 'pi' 或 'codex'
        编辑已有 profile 时 backend 缺失 → 选择并保存 'pi'
    否则:
        隐藏 Agent 后端
        保存 profile 时不写入 backend

保存 profile:
    payload.mode = 调用模式
    如果 payload.mode == 'agent': payload.backend = Agent 后端选择值
    服务端按 normalizeAgentProfile 校验并持久化

profile 列表:
    mode == 'agent' → 显示 'Agent · Pi' 或 'Agent · Codex'
    mode == 'llm' → 显示 '直接 LLM'
```

deleteConversationRound(messageId, scope):
    在 active profile 和 scope 对应历史中定位 messageId
    如果目标是用户消息:
        删除目标消息
        如果下一条是同 scope 的 assistant 消息，一并删除
    保存历史
    PiRuntimeManager.resetSession(profile, template, conversationKey)
    返回最新全局历史
```

语音 chat 路由必须显式传递 mode、target、sessionId 和私聊模板目标，服务端不得使用默认群聊值覆盖这些字段。

## 服务器生命周期

```text
server 初始化:
    创建 PiRuntimeManager(projectRoot)
    创建 CodexRuntimeManager(projectRoot)
    chat.init(config.chat, { piRuntimeManager, codexRuntimeManager })

服务器退出信号/HTTP 重启前:
    await piRuntimeManager.stopAll()
    await codexRuntimeManager.stopAll()
    关闭每个 Agent stdin
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
