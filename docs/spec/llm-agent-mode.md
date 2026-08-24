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
    sessions = Map<(profileName, templateId, permissionProfile), PiSession>
    spawn = 注入的子进程创建函数，生产环境使用 child_process.spawn
    projectRoot = 固定项目根目录
    extensionPath = 项目内置只读扩展路径
    requestTimeoutMs = options.requestTimeoutMs || 600000

getOrCreate(profile, template):
    校验 profile.mode == 'agent' 且 profile.backend == 'pi'
    校验 template.permissionProfile 是服务器支持的策略
    根据 permissionProfile 映射固定工具白名单
    如果 sessions 中存在同一 profile/template/permission 且配置指纹未变化:
        返回已有 session
    如果存在但配置指纹或权限策略变化:
        stop(sessionKey)
    创建 PiSession(profile, template, toolAllowlist)
    返回 session

chatStream(profile, template, prompt, callbacks):
    session = getOrCreate(profile, template)
    将请求加入 session 串行队列
    session.ensureStarted()
    通过 stdin 写入 { id, type: 'prompt', message: prompt }\n
    读取 stdout JSONL:
        type='response' 且 id 匹配且 success=false → 当前请求失败
        type='message_update' 且 assistantMessageEvent.type='text_delta':
            callbacks.onChunk(delta, fullMessage)
            按句切分，完整句调用 callbacks.onSentence
        type='turn_end' 或 type='agent_end':
            callbacks.onComplete(fullMessage)
    stderr 仅写服务器 Agent 日志，不作为助手消息
    等待当前请求响应时使用 requestTimeoutMs 计时
    超时 → stop(session)，callbacks.onError('Pi 请求超时')
    退出/非法协议 → stop(session)，callbacks.onError(error)
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

只读策略扩展在启动时用环境变量注册 `aasc-openai` provider，并注册 `aasc_web_search` 和 `aasc_web_fetch`。扩展不导入写文件 API，不注册 bash/edit/write 工具。后续命令策略通过另一个固定扩展或固定工具集合接入，不允许模板内容动态生成工具。

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
        User/Assistant: 最近历史
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
        PiRuntimeManager.chatStream(profile, template, prompt, callbacks)
        成功后沿用普通聊天 onComplete/history 保存流程
        失败后只调用 onError，不调用普通 LLM HTTP 请求
        返回
    否则:
        使用现有 OpenAI 兼容 SSE 流程
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
