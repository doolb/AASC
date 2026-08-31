# 聊天系统实现文档

## 概述

聊天系统支持群聊和私聊模式，统一管理所有角色（系统、AI助手、显示端、控制端）的聊天记录。

## 数据结构

### 聊天记录

```javascript
{
  id: string,           // 唯一标识，时间戳
  timestamp: number,    // 消息时间戳
  role: string,         // 角色: 'system' | 'assistant' | 'display' | 'control'
  name: string,         // 名字: 系统名/助手名/显示端名/控制端名
  ip: string,           // IP地址（显示端/控制端）
  content: string,      // 消息内容
  mode: string,         // 模式: 'group' | 'private'
  target: string,       // 私聊对象（私聊模式）
  sessionId: string,    // 会话ID（私聊多会话支持）
  displayId: string     // 关联的显示端ID
}
```

### 会话状态

```javascript
{
  mode: string,             // 当前模式: 'group' | 'private'
  privateTarget: string,    // 当前私聊对象
  privateSessionId: string, // 当前私聊会话ID（默认 'default'）
  playOnControl: boolean,   // 是否在控制端播放语音
  controlName: string,      // 控制端名字
  displayNames: {}          // 显示端名字映射 { displayId: name }
  commandMode: boolean      // 是否开启指令模式（新增，持久化到 config.json）
  sessions: {}              // 会话元数据 { "小爱": [{ id, name, createdAt }] }
}
```

### 自定义指令

```javascript
{
  commands: {
    "关键词": ["指令1", "指令2", "指令3"]
  }
}
```

### AI助手配置

```javascript
{
  defaultName: string,
  assistants: [{
    id: string,
    name: string,
    template: string,
    enabled: boolean
  }]
}
```

### LLM 配置管理 (多配置切换)

```javascript
{
  activeProfile: string,        // 当前激活的配置名
  llmProfiles: [{               // LLM 配置列表
    name: string,               // 配置名称（唯一标识）
    apiUrl: string,             // API 地址
    model: string,              // 模型名称
    maxTokens: number,          // 最大 token 数
    temperature: number,        // 温度参数
    apiKey: string,             // API 密钥（可选）
    promptFormat: string       // 消息格式: 'openai'（标准数组）| 'raw'（纯文本 System:/User:/AI:）
  }]
}
```

配置存储在 config.json 的 chat 段。切换配置时更新 chatConfig 的 apiUrl/model/maxTokens/temperature，systemPrompt 独立于配置。

## 核心模块实现

### 语音修复模式

```text
显示端语音“进入修复模式” -> 服务端等待密码
密码正确 -> 校验 config.repairMode.role 在 aiRoles.list() 中 -> 标记修复会话活动
修复会话文本 -> 暂存原文 -> 要求确认
确认 -> aiRoles.chat(config.repairMode.role, 原文, callbacks)
取消/退出/断开/超时 -> 清理修复状态
修复活动期间 -> 普通 TTS 下发被统一出口抑制，修复响应带 allowRepairModeTts 放行
```

### src/external/llm/llm-service.js

```
常量:
    HISTORY_DIR: ~/.config/aasc-user  (USER_CONFIG_DIR)
    HISTORY_FILE_BASE: 'chat-history'
    SESSION_FILE: ~/.config/aasc-user/chat-session.json
    COMMANDS_FILE: ~/.config/aasc-user/chat-commands.json
    MAX_HISTORY_PER_SESSION: 100

变量:
    chatConfig: 聊天配置
    chatHistories: 按会话分组的消息历史 { 'group': [], 'private:妲己': [], ... }
    chatSession: 会话状态
    chatCommands: 自定义指令
    chatTemplates: 聊天模板
    llmProfiles: LLM 配置列表
    activeProfile: 当前激活的配置名

辅助函数:
    sessionKey(mode, target, sessionId):
        私聊且有 target → 'private:{target}:{sessionId || "default"}'
        否则 → 'group'

init(config):
    加载聊天配置
    如果 config.llmProfiles 存在:
        设置 llmProfiles = config.llmProfiles
    否则:
        从现有 chatConfig 创建默认 profile
    如果 config.activeProfile 有效:
        调用 applyProfile(config.activeProfile)
    否则:
        使用第一个 profile 或 'default'
    加载聊天历史
    加载会话状态
    加载自定义指令
    加载聊天模板

applyProfile(name):
    查找 llmProfiles 中名为 name 的 profile
    如果找到:
        更新 chatConfig 的 apiUrl/model/maxTokens/temperature
        设置 activeProfile = profile.name

getConfig():
    返回 chatConfig 副本

setConfig(newConfig):
    更新 chatConfig 字段
    如果 newConfig.llmProfiles 存在:
        更新 llmProfiles
    如果 newConfig.activeProfile 存在:
        调用 applyProfile(newConfig.activeProfile)
    返回 chatConfig

getProfiles():
    返回 llmProfiles 副本

setProfiles(profiles):
    设置 llmProfiles = profiles
    如果 activeProfile 不在列表中:
        使用第一个 profile
    调用 applyProfile(activeProfile)
    返回 llmProfiles

switchProfile(name):
    查找名为 name 的 profile
    如果找到:
        调用 applyProfile(name)
        返回 true
    返回 false

getActiveProfile():
    返回 activeProfile

getProfileByName(name):
    返回指定 profile 的副本或 null

chat(userMessage, options, callbacks):
    使用 chatConfig（由 activeProfile 决定）调用 API
    其余逻辑不变

chatStream(userMessage, options, callbacks):
    使用 chatConfig 进行流式调用
    其余逻辑不变
    加载聊天配置
    加载聊天历史
    加载会话状态
    加载自定义指令
    加载聊天模板

loadHistory():
    扫描 HISTORY_DIR 下所有 chat-history*.json 文件
    逐个读取、解析 JSON、合并到 chatHistory
    按 timestamp 排序
    如果无任何文件: 返回空数组

saveHistory():
    按会话分组 chatHistory:
        group 消息 → chat-history.json
        私聊角色 X 的消息 → chat-history-X.json
    逐个写入对应文件
    清理已不存在的会话对应的历史文件

loadSession():
    读取 SESSION_FILE
    返回默认值如果文件不存在

saveSession():
    序列化 chatSession
    写入 SESSION_FILE

mergeSessionEntries(existing, incoming):
    按 id 合并两个会话列表
    incoming 只有已有 id 的字段更新，不删除 existing 中未出现的条目
    返回去重后的会话列表

recoverSessionsFromHistory(target, sessions):
    保留 sessions 中已有条目
    扫描 chatHistories 中 mode='private' 且 target 匹配的消息
    对历史出现但元数据缺失的 sessionId 添加恢复条目
    恢复条目名称优先使用已知名称，否则使用 sessionId
    确保 default 会话存在
    返回恢复后的列表

loadCommands():
    读取 COMMANDS_FILE
    返回默认值如果文件不存在

saveCommands():
    序列化 chatCommands
    写入 COMMANDS_FILE

addMessage(data):
    创建消息记录，包含 sessionId:
        sessionId: data.sessionId || chatSession.privateSessionId || 'default'
    按 sessionKey(msg.mode, msg.target, msg.sessionId) 推入 chatHistories
    调用 trimHistory()
    调用 saveHistory()
    返回消息记录

getHistory():
    合并 chatHistories 所有会话的消息
    按 timestamp 排序后返回

clearHistory(options):
    如果 options.mode === 'private' 且有 target:
        如果 options.sessionId 存在:
            delete chatHistories['private:{target}:{sessionId}']
        否则（兼容旧行为）:
            删除所有 private:{target}:* 的历史
    如果 options.mode === 'group':
        delete chatHistories.group
    否则:
        chatHistories = {}
    调用 saveHistory()
    返回 getHistory()

deleteConversationRound(messageId, options):
    在 activeProfile 和 options.mode/target/sessionId 对应历史中查找 messageId
    仅接受用户消息或旧式同时包含 user/assistant 的记录
    如果是用户消息:
        删除该消息
        如果下一条仍属于同一会话且 role == 'assistant'，同时删除下一条
    如果是旧式 user/assistant 记录:
        删除该条记录
    调用 saveHistory()
    通知 Pi Runtime 重置相同 profile/template/conversation 的内存会话
    返回 { success, history: getHistory() }

trimHistory():
    对 chatHistories 中每个会话:
        如果超过 MAX_HISTORY_PER_SESSION:
            截断至最近 MAX_HISTORY_PER_SESSION 条

setMode(mode, target):
    设置 chatSession.mode = mode
    如果 mode === 'private':
        设置 chatSession.privateTarget = target
    否则:
        清空 chatSession.privateTarget
    调用 saveSession()

setSession(session):
    更新模式、目标、当前会话和播放设置
    如果 session.sessions 存在:
        按 target 调用 mergeSessionEntries()
        不用不完整客户端快照删除服务端已有会话
    调用 saveSession()

getMode():
    返回 chatSession.mode 和 chatSession.privateTarget

setPlayOnControl(enabled):
    设置 chatSession.playOnControl = enabled
    调用 saveSession()

getPlayOnControl():
    返回 chatSession.playOnControl

loadTemplates():
    读取 TEMPLATES_FILE
    解析 JSON
    如果文件不存在:
        使用 DEFAULT_TEMPLATES 作为默认模板
        调用 saveTemplates() 保存
    如果解析失败:
        使用 DEFAULT_TEMPLATES

saveTemplates():
    将 chatTemplates 写入 TEMPLATES_FILE

getTemplates():
    返回 chatTemplates 副本

setTemplates(templates):
    设置 chatTemplates = templates
    调用 saveTemplates()
    返回模板列表

addTemplate(template):
    查找是否存在同名模板
    如果存在:
        更新 content 和 updatedAt
    否则:
        创建模板对象 { id: name, name, content, createdAt }
        添加到 chatTemplates
    调用 saveTemplates()
    返回模板列表

removeTemplate(name):
    从 chatTemplates 删除指定名字的模板
    调用 saveTemplates()
    返回模板列表

getTemplateByName(name):
    查找并返回指定名字的模板
    用于私聊时匹配系统提示词

setCommands(commands):
    如果 commands 包含 commands 字段:
        设置 chatCommands.commands = commands.commands
    否则:
        设置 chatCommands.commands = commands
    调用 saveCommands()

getCommands():
    返回 chatCommands.commands

addCommand(keyword, actions):
    设置 chatCommands.commands[keyword] = actions
    调用 saveCommands()

removeCommand(keyword):
    删除 chatCommands.commands[keyword]
    调用 saveCommands()

辅助函数:
    estimateTokens(text):
        粗略估算 token 数: Math.ceil(text.length / 2)

    trimHistoryToBudget(recentHistory, budget):
        计算所有历史条目的 token 数
        如果总 token 超出 budget:
            从最旧的条目开始逐条删除，直到 ≤ budget
        返回修剪后的数组

buildMessages(userMessage, options):
    inputBudget = maxTokens（作为上下文上限）
    计算固定部分（system + template + 当前消息）的 token 数
    历史可用 token = inputBudget - 固定部分
    获取历史消息后调用 trimHistoryToBudget() 按 token 预算修剪
    根据 chatConfig.promptFormat 选择输出格式:
        'openai'（默认）:
            构建标准 messages 数组 [{role, content}, ...]
        'raw':
            构建纯文本 prompt: System:...\nUser:...\nAI:...

chat(userMessage, options, callbacks):
    调用 buildMessages()
    发送请求到AI API
    处理响应
    调用 addMessage() 添加用户消息
    调用 addMessage() 添加助手消息
    返回结果

chatStream(userMessage, options, callbacks):
    流式调用AI API
    每收到一个chunk:
        追加到 pendingText
        调用 callbacks.onChunk()
        用 splitIntoSentences() 拆分 pendingText:
            分句规则: 句末标点(。！？.!?～~…)、或逗号(，,)累积≥4个
            如果有 ≥2 个句子:
                发出前 n-1 个完整句子（调用 onSentence）
                仅保留最后一个（可能不完整）片段
    完成后:
        若 pendingText 还有剩余内容，发出（调用 onSentence）
        调用 addMessage()
    调用 callbacks.onComplete()

### 普通 LLM WebSocket 流式回包

```text
控制端 sendMessage():
    requestId = 生成本次请求唯一标识
    发送 chatMessage(requestId, content, mode, target)
    创建 streamingContent 临时节点

服务端 handleChatMessage(options):
    读取 requestId = options.requestId
    调用 chat.chatStream(content, ...):
        onChunk(chunk, fullMessage):
            sendToControl({ type: 'chatChunk', requestId, chunk, message: fullMessage })
        onComplete(fullMessage, history):
            保存助手历史
            sendToControl({ type: 'chatResponse', requestId, success: true, message: fullMessage, history })
        onError(error):
            sendToControl({ type: 'chatResponse', requestId, success: false, error })

控制端 WebSocket:
    收到 chatChunk/chatResponse
    仅当 data.requestId === Chat.activeRequestId 时更新当前流式节点
    请求号匹配时立即更新文本和滚动位置，不依赖刷新页面重新加载历史
```

### 控制端 Markdown 渲染

```text
ChatMarkdown.render(markdown):
    将输入转换为字符串并统一换行符
    按空行和块级标记解析:
        标题 -> h1-h6
        无序/有序列表 -> ul/ol/li
        引用 -> blockquote
        表格 -> table/thead/tbody
        三个反引号代码块 -> pre/code
        分隔线 -> hr
        其他连续文本 -> p
    行内解析:
        代码行 -> code
        粗体/斜体/删除线 -> strong/em/del
        链接 -> 先校验协议，再生成带 noopener noreferrer 的 a
        其他文本 -> HTML 转义
    返回只包含渲染器白名单标签的 HTML 字符串

控制端 Chat.renderHistory():
    读取历史消息 content/user/assistant 字段
    调用 ChatMarkdown.render(content)
    将结果写入聊天气泡

控制端 Chat.showStreamingMessage(userMessage):
    调用 ChatMarkdown.render(userMessage) 渲染用户临时消息

控制端 Chat.handleChunk(data):
    校验 requestId 匹配当前请求
    调用 ChatMarkdown.render(data.message) 更新助手流式消息
    追加流式光标

控制端 Chat.handleResponse(data):
    校验 requestId 匹配当前请求
    调用 ChatMarkdown.render(data.message) 固化助手最终消息
    保留原有历史写入、语音播放和失败提示逻辑
```

`src/apps/web-mediacenter/ui/public/js/chat-markdown.js` 使用原生 JavaScript 实现，避免控制端依赖 CDN 或前端构建流程；`upload.html` 必须在 `chat.js` 之前加载该渲染器。

onSentence 外部使用注意事项:
    onSentence 内部调用 tts.generateTTS() 是异步的
    必须用 ttsQueue 链式调用保证 TTS 生成与音频发送顺序
    即: ttsQueue = ttsQueue.then(() => generateTTS(sentence))
    防止句子2 的 TTS 先于句子1 完成导致播放顺序错乱
```

### src/apps/web-mediacenter/modules/voice/voice-command-app-service.js 更新

```
变量:
    searchHistory: 搜索历史数组
    pendingConfirmations: 待确认操作 Map
    assistantConfig: AI助手配置
    displayClients: 显示端客户端引用
    sendToDisplay: 发送消息到显示端函数
    broadcastToControls: 广播到控制端函数

现有函数:
    init(config):
        初始化助手配置
        加载搜索历史
    
    setClients(clients, sendFunc, broadcastFunc):
        设置客户端引用和通信函数
    
    parseTimeExpression(text):
        解析时间表达式:
            - "X分钟后" -> 相对时间
            - "X秒后" -> 相对时间
            - "X小时后" -> 相对时间
            - "X点X分" -> 绝对时间
        返回 { targetTime, timeDescription }
    
    parseRepeatRule(text):
        解析重复规则:
            - "每天" -> daily
            - "每周" -> weekly
            - "每月" -> monthly
            - "每年" -> yearly
            - 默认 -> once
    
    extractReminderContent(text):
        提取提醒内容，移除时间表达式和重复规则
    
    handleReminderCommand(text, displayId):
        解析时间和重复规则
        生成确认文本
    创建待确认记录 (30秒过期)
        生成 TTS 语音播放确认
        发送确认弹窗到显示端
    超时不自动确认，直接清理待确认记录
    
    executeReminderConfirmation(confirmationId, confirmed):
        如果确认: 调用 reminder.addReminder()
        删除待确认记录
    
    handleCancelCommand(text, displayId):
        取消待确认操作
        返回是否成功取消
    
    handleTimeAnnounceCommand(text, displayId):
        如果包含 "关闭报时": 关闭报时功能
        如果包含 "开启报时": 开启报时功能
        否则: 立即报时
    
    handleSearchCommand(text, displayId):
        提取搜索关键词
        语音播放 "正在搜索..."
        调用 performSearch(query) 执行搜索
        保存搜索历史
        广播搜索历史到控制端
        语音播放搜索结果
    
    performSearch(query):
        使用 axios 请求 Bing 搜索
        使用 cheerio 解析 HTML
        尝试获取 AI 回答 (#b_pole)
        否则获取第一个搜索结果
        返回搜索结果
    
    findAssistant(name):
        在 assistants 中查找匹配的助手
        如果没找到: 返回默认助手
    
    processVoiceCommand(text, displayId, callbacks):
        处理语音命令入口:
            // 指令模式检查（新增）
            if chatSession.commandMode == true:
                if chatSession.mode == "private":
                    if text in ["退出私聊", "退出"]:
                        调用 setMode('group', null)
                        添加系统消息 '已退出私聊模式'
                        追加广播 privateMode/groupMode 到控制端
                        返回空（命令已被处理）
                    else:
                        assistant = findAssistant(session.privateTarget)
                        return { type: 'chat', message: text, systemPrompt: assistant.template }
                
                if text 包含 assistantConfig.defaultName:
                    message = text.replace(defaultName, '').trim()
                    if message:
                        return { type: 'chat', message, systemPrompt: defaultAssistant.template }
                    else:
                        return
                
                // 非内置命令且无助手名字 → 忽略
                if 不是任何内置命令关键词:
                    return
            
            1. 检查系统指令
            2. 检查取消命令
            3. 检查静音/取消静音命令
            4. 检查今日/明日提醒命令
            5. 检查提醒命令
            6. 检查报时命令
            7. 检查天气命令 (传递 callbacks)
            8. 检查搜索命令
            9. 检查播放命令 (传递 callbacks)
            10. 检查播放选择 (第几个)
            11. 检查助手名字
            12. 默认返回聊天
        
        callbacks 参数说明:
            onResult(text): 成功时调用，用于发送结果到控制端
            onError(text): 失败时调用，用于发送错误消息到控制端

新增函数:
    handleSystemCommand(text, displayId):
        处理系统指令:
        
        私聊模式检查:
            如果 session.mode === 'private':
                如果 text === '退出私聊':
                    调用 setMode('group', null)
                    添加系统消息 '已退出私聊模式'
                    返回 true
                
                如果 text === '系统' 或 text 以 '系统' 开头:
                    提取实际命令 (去掉 '系统' 前缀)
                    递归调用 handleSystemCommand(实际命令)
                
                返回 false (私聊模式不响应其他系统命令)
        
        如果 text === '系统':
            调用 showHelp() 显示 HTML 弹窗
            返回 true
        
        如果 text 以 '私聊' 开头:
            提取助手名字
            检查助手是否存在
            返回 { type: 'privateMode', target: name }
        
        如果 text === '退出私聊':
            返回 { type: 'groupMode' }
        
        检查自定义指令:
            遍历 chatCommands.commands
            如果 text 匹配关键词:
                返回 { type: 'commands', keyword, actions: [...] }
        
        返回 null (不是系统指令)

    handleWeatherCommand(text, displayId, callbacks):
        处理天气查询:
        
        提取城市名称:
            移除 "天气"、"今天"、"明天"、"后天" 等关键词
        
        调用 wttr.in API 获取天气:
            URL: https://wttr.in/{city}?format=j1&lang=zh
            超时: 10秒
        
        解析天气数据:
            cityName = data.nearest_area[0].areaName[0].value
            temp = data.current_condition[0].temp_C
            weather = data.current_condition[0].lang_zh[0].value
            humidity = data.current_condition[0].humidity
        
        生成天气文本:
            "{cityName}当前天气：{weather}，温度{temp}度，湿度{humidity}%"
        
        发送结果:
            如果 callbacks.onResult 存在:
                调用 callbacks.onResult(weatherText)
            否则如果 displayId 存在:
                生成 TTS 音频
                发送到显示端:
                    type: 'voiceCommand'
                    action: 'weatherResult'
                    text: weatherText
                    audioUrl: '/uploads/tts/{fileName}'
        
        错误处理:
            如果请求失败:
                如果 callbacks.onError 存在:
                    调用 callbacks.onError('获取天气失败，请稍后再试')
                否则如果 displayId 存在:
                    生成错误语音发送到显示端:
                        type: 'voiceCommand'
                        action: 'response'
                        text: errorText
                        audioUrl: '/uploads/tts/{fileName}'
    
    handlePlayCommand(text, displayId, callbacks):
        处理播放媒体命令:
        
        提取文件名:
            移除 "播放" 关键词
        
        如果文件名为空:
            生成提示 "请问您要播放什么文件？"
            如果 callbacks.onResult 存在:
                调用 callbacks.onResult(responseText)
            否则发送到显示端
            返回
        
        搜索媒体文件:
            调用 searchMediaFiles(fileName)
        
        如果没有匹配:
            生成提示 "没有找到名为'{fileName}'的文件"
            如果 callbacks.onResult 存在:
                调用 callbacks.onResult(responseText)
            否则发送到显示端
            返回
        
        如果只有一个匹配:
            生成提示 "正在播放{file.name}"
            如果 callbacks.onResult 存在:
                调用 callbacks.onResult(responseText)
            否则发送语音到显示端
            发送媒体到显示端:
                type: 'media'
                url: file.url
                mediaType: file.mediaType
                name: file.name
        
        如果有多个匹配:
            生成选择提示 "找到N个匹配的文件：1.xxx，2.xxx。请说第几个来选择"
            保存待确认信息到 pendingConfirmations
            如果 callbacks.onResult 存在:
                调用 callbacks.onResult(responseText)
            发送选择列表到显示端
    
    handlePlaySelection(confirmationId, selection, displayId):
        处理播放选择:
        
        获取待确认信息:
            从 pendingConfirmations 获取
        
        验证选择序号:
            index = selection - 1
            如果 index 超出范围: 返回 false
        
        获取选中的文件:
            file = confirmation.data.matches[index]
        
        生成播放提示:
            responseText = "正在播放{file.name}"
        
        处理语音提示:
            如果 confirmation.callbacks.onResult 存在:
                调用 callbacks.onResult(responseText)
            否则发送语音到显示端
        
        发送媒体到显示端:
            type: 'media'
            url: file.url
            mediaType: file.mediaType
            name: file.name
        
        返回 true

    executeCommands(actions, displayId, callbacks):
        执行指令组合:
        
        遍历 actions:
            如果 action === '今天天气':
                调用 handleSearchCommand('搜索今天天气', displayId)
            
            如果 action === '今日提醒':
                获取今日提醒列表
                生成提醒文本
                TTS播放
            
            如果 action 以 '搜索' 开头:
                调用 handleSearchCommand(action, displayId)
            
            如果 action 包含 '提醒':
                调用 handleReminderCommand(action, displayId)
            
            如果 action 包含 '报时':
                调用 handleTimeAnnounceCommand(action, displayId)
            
            其他:
                作为聊天消息处理
                调用 callbacks.onChat(action)

修改:
    processVoiceCommand(text, displayId):
        先检查系统指令:
            result = handleSystemCommand(text, displayId)
            如果 result:
                返回 result
        继续现有逻辑
```

## 前端模块实现

### public/js/chat.js 重构

```
const Chat = {
    history: [],
    session: {
        mode: 'group',
        privateTarget: null,
        playOnControl: false
    },
    commands: {},
    assistants: [],
    isLoading: false,
    isListening: false,
    recognition: null,
    voiceParts: [],
    
    init():
        调用 loadHistory()
        调用 loadSession()
        调用 loadCommands()
        调用 loadAssistants()
        调用 initVoiceRecognition()
        调用 render()
    
    onWebSocketOpen():
        WebSocket 连接成功后调用
        重新调用 loadHistory()
        重新调用 loadSession()
        重新调用 loadCommands()
        确保数据在连接成功后正确加载
    
    loadSession():
        请求 GET /api/chat/session
        更新 this.session
    
    saveSession():
        请求 POST /api/chat/session
        只发送模式、目标、当前会话和播放设置
        不发送 sessions 元数据，避免尚未加载完成的空快照覆盖服务端列表
    
    loadCommands():
        请求 GET /api/chat/commands
        更新 this.commands
    
    saveCommands():
        请求 POST /api/chat/commands
        发送 this.commands
    
    loadAssistants():
        请求 GET /api/chat/assistants
        更新 this.assistants
    
    setMode(mode, target):
        this.session.mode = mode
        this.session.privateTarget = target
        调用 saveSession()
        调用 render() 刷新整个界面和消息列表
    
    togglePlayOnControl():
        this.session.playOnControl = !this.session.playOnControl
        调用 saveSession()
        更新UI
    
    render():
        渲染左侧页签:
            群聊页签，并绑定 click -> setMode('group', null)
            各助手私聊页签 (从模板列表生成)
            各工作 AI 角色页签 (从角色列表生成)
        渲染聊天主区域:
            头部: 标题 + 模式指示 + 操作按钮
            消息区域: 聊天记录列表
            输入区域: 语音按钮 + 输入框 + 发送按钮
            底部: 播放位置选项
        调用 renderHistory()
        调用 renderModeIndicator()
        注: 已移除模板下拉框，改用左侧页签切换
    
    renderModeIndicator():
        modeText = ''
        如果 session.commandMode == true:
            modeText += '[指令模式] '
        如果 session.mode === 'group':
            modeText += '群聊'
        如果 session.mode === 'private':
            modeText += '私聊({session.privateTarget})'
        如果 session.mode === 'role':
            modeText += '工作组({session.roleTarget})'
        显示 "当前模式: {modeText}"
        如果 session.mode === 'private':
            添加 "退出私聊" 按钮
        如果 session.mode === 'role':
            添加 "退出工作组" 按钮

    群聊页签点击:
        调用 setMode('group', null)
        清空 privateTarget、roleTarget 和 privateSessionId
        刷新群聊历史和模式指示
    
    addSystemMessage(content):
        使用 toast 提示显示系统消息
        不再添加到聊天历史
    
    renderHistory():
        创建 indexedHistory = history.map((item, index) => ({ item, originalIndex: index }))
        如果是私聊模式且有目标:
            过滤 indexedHistory: 只显示 mode='private' 且 target 匹配的消息
        否则:
            过滤 indexedHistory: 只显示 mode !== 'private' 的消息
        遍历过滤后的 indexedHistory
        使用 originalIndex 作为播放按钮的索引参数
        根据角色生成不同样式:
            system: 系统消息样式
            assistant: 
                如果是私聊消息 (mode='private' 且有 target):
                    显示 target 作为名字
                否则:
                    显示 name 或 '助手'
            display: 显示端消息样式，显示名字和IP
            control: 控制端消息样式，显示名字和IP
        每条消息添加时间戳
        助手消息添加播放按钮
    
    formatMessage(item):
        根据角色格式化:
            system: "系统: {content}"
            assistant: "{name}: {content}"
            display: "{name}({ip}): {content}"
            control: "{name}({ip}): {content}"
    
    sendMessage():
        获取消息内容
        初始化 displayMessage = message, sendMessage = message, multiHandlerKeywords = []
        
        如果是私聊模式:
            调用 handleSystemCommand(message)
            如果返回 true:
                清空输入框
                返回
        
        如果是群聊模式:
            调用 handleSystemCommand(message)
            如果返回 true:
                清空输入框
                返回
            
            检查多处理器关键词:
                调用 checkMultiHandlerKeywords(message)
                返回匹配的关键词列表
            
            遍历模板列表:
                如果消息以模板名字开头:
                    设置 templateTarget = 模板名字
                    sendMessage = 去掉助手名字前缀后的内容
                    如果 sendMessage 为空:
                        toast 提示进入私聊模式
                        返回
                    break
            如果没有匹配到助手名字且有模板:
                设置 templateTarget = 第一个模板的助手名字
        
        设置 isLoading = true
        更新发送按钮状态
        
        如果是群聊模式且有匹配的多处理器关键词:
            调用 executeMultiHandlers(message, multiHandlerKeywords)
            同时执行系统命令和发送给AI助手
        
        计算助手名字:
            如果是私聊模式且有 target:
                assistantName = target
            否则如果 templateTarget 存在:
                assistantName = templateTarget
            否则:
                assistantName = '助手'
        调用 showStreamingMessage(displayMessage, assistantName)
        发送 WebSocket 消息:
            type: 'chatMessage'
            content: sendMessage (发送给AI的内容，不含助手名字前缀)
            displayContent: displayMessage (显示和保存的内容，含助手名字前缀)
            mode: mode (私聊时为 'private'，群聊时为 'group')
            target: target (私聊时为助手名字，群聊时为 null)
            templateTarget: templateTarget (群聊时用于系统提示词)
            displayId: currentDisplayId
            playOnControl: this.session.playOnControl
    
    checkMultiHandlerKeywords(message):
        检查消息是否包含多处理器关键词:
        
        如果 message 包含 '天气' 且不是 (routing.weather == 'llm' 且 activeProfile.mode == 'agent' 且 activeProfile.backend == 'pi'):
            添加 'weather' 到关键词列表
        如果 message 包含 '提醒':
            添加 'reminder' 到关键词列表
        如果 message 包含 '报时' 或 '现在几点':
            添加 'time' 到关键词列表
        如果 message 包含 '搜索' 且不是 (routing.search == 'llm' 且 activeProfile.mode == 'agent' 且 activeProfile.backend == 'pi'):
            添加 'search' 到关键词列表
        遍历自定义指令关键词:
            如果 message 包含关键词:
                添加 'command:{keyword}' 到关键词列表
        
        返回关键词列表
    
    executeMultiHandlers(message, keywords):
        执行多个处理器:
        
        遍历关键词列表:
            如果是 'weather':
                调用 handleWeatherCommand(message)
            如果是 'reminder':
                调用 handleReminderCommand(message)
            如果是 'time':
                调用 handleTimeAnnounceCommand(message)
            如果是 'search':
                调用 handleSearchCommand(message)
            如果以 'command:' 开头:
                提取关键词
                获取对应的指令列表
                调用 executeCommands(actions)
    
    showStreamingMessage(userMessage, assistantName):
        显示用户消息
        显示助手消息占位符，助手名字使用 assistantName 参数
    
    handleSystemCommand(text):
        处理聊天框输入的系统指令:
        
        如果 text === '系统':
            调用 showHelp() 显示 HTML 弹窗
            返回 true
        
        如果 text 以 '私聊' 开头:
            提取助手名字
            如果名字存在:
                在模板列表中查找
                找到则进入私聊模式
            否则如果模板列表不为空:
                使用第一个模板作为默认助手
                进入私聊模式
            返回 true
        
        如果 text === '退出私聊':
            调用 setMode('group', null)
            添加系统消息
            返回 true
        
        检查自定义指令:
            遍历 commands.commands
            如果 text 匹配关键词:
                调用 executeCommands(actions)
                返回 true
        
        检查内置指令:
            包含 '提醒' -> handleReminderCommand(text), 返回 true
            包含 '报时' 或 '现在几点' -> handleTimeAnnounceCommand(text), 返回 true
            包含 '天气' -> handleWeatherCommand(text), 返回 true
            包含 '搜索' -> handleSearchCommand(text), 返回 true
            等于 '静音' 或 包含 '全部静音' -> handleMuteCommand(), 返回 true
            包含 '取消静音' 或 等于 '恢复音量' -> handleUnmuteCommand(), 返回 true
            包含 '今日提醒' 或 '今天提醒' -> handleTodayReminders(), 返回 true
            包含 '明日提醒' 或 '明天提醒' -> handleTomorrowReminders(), 返回 true
            包含 '播放' -> handlePlayCommand(text), 返回 true
        
        返回 false (不是系统指令，交给聊天处理)
    
    handlePlayCommand(text):
        处理播放媒体命令:
        
        检查显示端:
            如果 window.currentDisplayId 不存在:
                显示错误 "请先选择显示端"
                返回
        
        提取文件名:
            移除 "播放" 关键词
        
        如果文件名为空:
            显示提示 "请输入要播放的文件名"
            返回
        
        显示 "正在搜索: {fileName}"
        
        发送 voiceCommand 到服务端:
            type: 'voiceCommand'
            displayId: window.currentDisplayId
            text: text
            playOnControl: false
    
    handleMuteCommand():
        发送 { type: 'mute' } 到服务端
        显示 "正在静音所有显示端..."
    
    handleUnmuteCommand():
        发送 { type: 'unmute' } 到服务端
        显示 "正在取消静音..."
    
    handleTodayReminders():
        发送 { type: 'todayReminders', displayId: currentDisplayId } 到服务端
    
    handleTomorrowReminders():
        发送 { type: 'tomorrowReminders', displayId: currentDisplayId } 到服务端
    
    // 前端不再独立处理语音命令
    // 功能由服务器端统一处理，控制端仅展示识别文本

    setMode(mode, target):
        设置 this.session.mode = mode
        设置 this.session.privateTarget = target
        调用 render() 刷新界面
    
    executeCommands(actions):
        执行指令组合:
        
        遍历 actions:
            如果 action === '今天天气':
                调用 handleWeatherCommand('')
            如果 action === '今日提醒':
                调用 handleTodayReminders()
            如果 action 以 '搜索' 开头:
                调用 handleSearchCommand(action)
            如果 action 包含 '提醒':
                调用 handleReminderCommand(action)
            如果 action 包含 '报时':
                调用 handleTimeAnnounceCommand(action)
            其他:
                调用 sendVoiceMessage(action)
    
    handleTodayReminders():
        显示 "正在查询今日提醒..."
        发送 { type: 'getReminders' } 到服务端
        服务端查询今日提醒并播报
    
    handleWeatherCommand(text):
        处理天气查询:
        
        提取城市名称:
            移除 "天气"、"今天"、"明天"、"后天" 等关键词
            默认 "Beijing"
        
        显示 "正在查询{城市}天气..."
        发送 voiceCommand 到服务端
        服务端调用 wttr.in API 获取天气
        返回天气结果并播报
    
    handleChunk(data):
        更新流式消息内容
    
    handleResponse(data):
        完成流式消息
        更新历史记录
        调用 playMessage() 播报消息
    
    handleNewMessage(data):
        接收新消息
        添加到历史
        判断是否需要渲染:
            私聊模式: 消息的 target 匹配当前私聊对象且 mode='private'
            群聊模式: 消息的 mode !== 'private'
        如果需要渲染:
            更新UI
            调用 playMessage() 播报消息
    
    playMessage(indexOrData):
        获取消息内容
        如果是对象:
            content = data.content
            displayId = data.displayId
            playOnControl = data.playOnControl
        否则:
            从历史记录获取消息
            displayId = currentDisplayId
            playOnControl = this.session.playOnControl
        
        调用 playText(content, displayId, playOnControl)
    
    playText(text, displayId, playOnControl):
        播放文本到指定设备:
        
        如果 noInterruptMode 为 true 且 isListening 为 true:
            wasListeningBeforePlayback = isAlwaysListening
            调用 stopListening()
        
        发送 TTS 请求到服务器:
            type: 'tts'
            displayId: displayId
            action: 'play'
            text: text
            playOnControl: playOnControl
    
    playOnControlDevice(audioUrl, text):
        在控制端播放语音:
        
        添加到 audioQueue
        调用 processAudioQueue()
    
    processAudioQueue():
        如果 isPlayingAudio 或 audioQueue 为空:
            如果 audioQueue 为空:
                如果 noInterruptMode 且 wasListeningBeforePlayback 且非加载中且非播放中:
                    wasListeningBeforePlayback = false
                    延迟 500ms 后 startListening()
                否则如果 isAlwaysListening 且非 noInterruptMode:
                    延迟 500ms 后 startListening()
            返回
        
        isPlayingAudio = true
        从 audioQueue 取出音频
        创建 Audio 元素播放
        播放完成/失败后:
            isPlayingAudio = false
            递归调用 processAudioQueue()
    
    handlePlayOnControl(data):
        接收服务器发来的控制端播放音频:
        
        如果 noInterruptMode 为 true 且 isListening 为 true:
            wasListeningBeforePlayback = isAlwaysListening
            调用 stopListening()
        
        调用 playOnControlDevice(data.audioUrl, data.text)
    
    handleResponse(data):
        LLM 响应完成:
        
        isLoading = false
        
        如果 noInterruptMode 且 wasListeningBeforePlayback 且非 isPlayingAudio:
            wasListeningBeforePlayback = false
            延迟 3000ms 后（等待显示端 TTS 播放完成）:
                如果非 isPlayingAudio 且非 isListening:
                    startListening()
    
    showConfig():
        显示聊天设置弹窗:
            系统提示词 (textarea)
            LLM 服务器配置:
                配置列表 (profileSelector):
                    每个配置项显示: 名称、模型名
                    点击配置名切换 (switchProfile)
                    ✓ 当前 标识活跃配置
                    ✎ 编辑按钮 (editProfile)
                    ✕ 删除按钮 (deleteProfile)
                + 添加配置 按钮 (showAddProfile)
                配置编辑表单 (profileEditor):
                    配置名称 (input)
                    API URL (input)
                    模型 (input)
                    最大 Tokens (number input)
                    温度 (number input, 0-2, step 0.1)
                    API Key (password input, 可选)
                    保存配置 按钮 (saveProfile)
                    取消 按钮 (cancelEditProfile)
        保存设置 按钮 (saveConfig) 仅保存 systemPrompt

    showAddProfile():
        清空编辑表单（含 apiKey）
        显示配置编辑表单

    editProfile(name):
        根据 name 查找 profile
        填充编辑表单字段（含 apiKey）
        显示配置编辑表单

    cancelEditProfile():
        隐藏配置编辑表单

    saveProfile():
        验证必填字段 (name, apiUrl, model)
        如果 name 已存在 → 更新
        否则 → 新增
        请求 POST /api/chat/profiles { profiles }
        更新成功后刷新列表

    deleteProfile(name):
        confirm 确认
        从 profiles 列表中移除
        请求 POST /api/chat/profiles { profiles }
        更新成功后刷新列表

    loadProfiles():
        请求 GET /api/chat/profiles
        更新 this.profiles 和 this.activeProfile
        调用 renderProfileSelector()
    
    addCommand():
        获取关键词和指令列表
        调用 saveCommands()
        更新UI
    
    removeCommand(keyword):
        删除指令
        调用 saveCommands()
        更新UI
    
    clearHistory():
        获取当前模式 mode 和 target
        显示确认对话框 (区分群聊/私聊)
        请求 POST /api/chat/clear
        发送 { mode, target }
        更新 this.history
        调用 renderHistory()
}
```

### public/js/websocket.js 更新

```
handleMessage(data):
    ...
    如果 data.type === 'chatMessage':
        调用 Chat.handleNewMessage(data)
    
    如果 data.type === 'chatMode':
        调用 Chat.setMode(data.mode, data.target)
    
    如果 data.type === 'systemMessage':
        调用 Chat.handleSystemMessage(data)
    
    如果 data.type === 'playOnControl':
        调用 Chat.playOnControl(data.text)
    
    如果 data.type === 'muteResult':
        调用 Chat.addSystemMessage(data.message)
    
    如果 data.type === 'muteState':
        显示静音状态消息
    
    // 新增: 指令模式/私聊模式同步
    如果 data.type === 'commandMode':
        设置 Chat.session.commandMode = data.enabled
        调用 Chat.renderModeIndicator() 更新 UI 显示
    
    如果 data.type === 'privateMode':
        调用 Chat.setMode('private', data.target)
    
    如果 data.type === 'groupMode':
        调用 Chat.setMode('group', null)

sendChatMessage(content, options):
    发送 {
        type: 'chatMessage',
        content: content,
        mode: options.mode,
        target: options.target,
        displayId: currentDisplayId,
        playOnControl: options.playOnControl
    }
```

## 服务端实现

### server.js 更新

```
WebSocket 消息处理:

如果 data.type === 'chatMessage':
    获取会话状态
    计算消息模式:
        messageMode = data.mode || session.mode
        messageTarget = messageMode === 'private' ? data.target : null
    添加用户消息到历史:
        content: data.displayContent || data.content (优先使用完整显示内容)
        mode: messageMode
        target: messageTarget (群聊时为 null)
    获取系统提示词和历史配置:
        templateTarget = data.templateTarget || data.target
        如果 templateTarget 存在:
            获取模板作为系统提示词
            如果 mode === 'private':
                includeHistory = true
                contextCount = 100  // 私聊时包含全部历史
            否则:
                contextCount = config.contextCount || 0  // 群聊时读取配置
                if contextCount > 0: includeHistory = true
        否则（无模板）:
            contextCount = config.contextCount || 0
            if contextCount > 0: includeHistory = true
    调用 chat.chatStream() 发送消息
    添加助手消息到历史:
        mode: messageMode
        target: messageTarget
        name: templateTarget || '助手'
    广播消息到控制端
    
    所有消息都进行语音播报:
        如果 playOnControl === true:
            发送 { type: 'playOnControl', text: messageContent } 到控制端
        否则如果 displayId 存在:
            生成 TTS 音频
            发送 { type: 'tts', action: 'play', text: messageContent, audioUrl: url } 到显示端
        否则:
            发送 { type: 'playOnControl', text: messageContent } 到控制端

如果 data.type === 'chatMode':
    调用 chat.setMode(data.mode, data.target)
    广播模式变更

如果 data.type === 'getChatSession':
    发送 { type: 'chatSession', session: chat.getSession() }

如果 data.type === 'setChatSession':
    调用 chat.setSession(data.session)
    广播会话更新

如果 data.type === 'getChatCommands':
    发送 { type: 'chatCommands', commands: chat.getCommands() }

如果 data.type === 'setChatCommands':
    调用 chat.setCommands(data.commands)
    广播指令更新

如果 data.type === 'mute':
    调用 muteAllDisplays()
    发送 { type: 'muteResult', success, message, isMuted }

如果 data.type === 'unmute':
    调用 unmuteAllDisplays()
    发送 { type: 'muteResult', success, message, isMuted }

如果 data.type === 'voiceCommand':
    获取 playOnControl 和 targetDisplayId
    
    构建 callbacks:
        如果 playOnControl:
            onResult: 生成 TTS 音频，发送 { type: 'playOnControl' } 到控制端
            onError: 生成 TTS 音频，发送 { type: 'playOnControl' } 到控制端
        否则:
            callbacks = null
    
    调用 voiceCommand.processVoiceCommand(text, targetDisplayId, callbacks)
    
    处理返回结果:
        如果 result.type === 'showHelp':
            发送 { type: 'showHelp' }
        如果 result.type === 'commands':
            执行指令组合
        如果 result.type === 'chat':
            发送聊天消息
        如果 result.type === 'privateMode':
            广播到所有控制端: { type: 'privateMode', target }
        如果 result.type === 'groupMode':
            广播到所有控制端: { type: 'groupMode' }

如果 data.type === 'todayReminders':
    调用 voiceCommand.handleTodayReminders(displayId)

如果 data.type === 'tomorrowReminders':
    调用 voiceCommand.handleTomorrowReminders(displayId)

HTTP API 新增:

GET /api/chat/session:
    返回 { status: 'success', session: chat.getSession() }

POST /api/chat/session:
    调用 chat.setSession(body)
    返回 { status: 'success' }

GET /api/chat/commands:
    返回 { status: 'success', commands: chat.getCommands() }

POST /api/chat/commands:
    调用 chat.setCommands(body)
    返回 { status: 'success' }

GET /api/chat/assistants:
    返回 { status: 'success', assistants: chat.getAssistants() }

POST /api/chat/assistants:
    调用 chat.setAssistants(body)
    返回 { status: 'success' }

新增 LLM 配置管理 API:

GET /api/chat/profiles:
    返回 { status: 'success', profiles: chat.getProfiles(), activeProfile: chat.getActiveProfile() }

POST /api/chat/profiles:
    调用 chat.setProfiles(body.profiles)
    保存 llmProfiles 和 activeProfile 到 config.json
    返回 { status: 'success', profiles, activeProfile }

POST /api/chat/profiles/switch:
    调用 chat.switchProfile(body.name)
    保存 activeProfile 到 config.json
    广播 profileSwitched 到所有控制端
    返回 { status: 'success', activeProfile, config: { apiUrl, model } }
```

## 显示端实现

### public/display.html 更新

```
新增:
    handleChatMessage(data):
        如果 data.type === 'chatMessage':
            显示消息文本
            如果有音频:
                播放音频
    
    showMessageText(text):
        创建或更新消息显示元素
        设置文本内容
        5秒后淡出

修改:
    handleTTS(data):
        如果 data.text 存在:
            调用 showMessageText(data.text)
        继续现有播放逻辑
    
    handleVoiceCommand(data):
        处理语音命令结果:
        
        如果 data.action === 'confirm':
            显示确认弹窗
            播放音频
        
        如果 data.action === 'response':
            播放音频
            显示响应弹窗
        
        如果 data.action === 'searchResult':
            播放音频
            显示搜索结果弹窗
        
        如果 data.action === 'weatherResult':
            播放音频
            显示响应弹窗 (天气文本)
        
        如果 data.action === 'playChoices':
            播放音频
            显示播放选择弹窗
            列出匹配的文件列表
    
    showPlayChoicesPopup(confirmationId, matches, text):
        显示播放选择弹窗:
        
        创建弹窗元素:
            类名: 'play-choices-popup'
            内容: 提示文本 + 文件列表
        
        文件列表:
            遍历 matches:
                显示 "序号. 文件名"
        
        30秒后自动关闭
```

## 消息类型汇总

### WebSocket 消息类型

| 类型 | 方向 | 说明 |
|------|------|------|
| chatMessage | 双向 | 聊天消息 |
| chatInput | 服务端->控制端 | 显示端语音普通聊天的即时输入展示，不触发再次发送 |
| chatMode | 双向 | 模式切换 |
| chatSession | 服务端->控制端 | 会话状态 |
| chatCommands | 服务端->控制端 | 自定义指令 |
| systemMessage | 服务端->控制端 | 系统消息 |
| playOnControl | 服务端->控制端 | 控制端播放语音 |
| mute | 控制端->服务端 | 静音所有显示端 |
| unmute | 控制端->服务端 | 取消静音 |
| muteResult | 服务端->控制端 | 静音操作结果 |
| muteState | 服务端->控制端 | 静音状态变化 |
| todayReminders | 控制端->服务端 | 查询今日提醒 |
| tomorrowReminders | 控制端->服务端 | 查询明日提醒 |
| commandMode | 服务端->控制端 | 指令模式状态变更（新增） |
| privateMode | 服务端->控制端 | 进入私聊模式（新增） |
| groupMode | 服务端->控制端 | 退出私聊模式（新增） |
| switchProfile | 控制端->服务端 | 切换 LLM 配置（新增） |
| profileSwitched | 服务端->控制端 | LLM 配置已切换（新增） |
| listPrivateSessions | 控制端->服务端 | 列出私聊会话（新增） |
| createPrivateSession | 控制端->服务端 | 创建私聊会话（新增） |
| deletePrivateSession | 控制端->服务端 | 删除私聊会话（新增） |
| switchPrivateSession | 控制端->服务端 | 切换私聊会话（新增） |
| privateSessions | 服务端->控制端 | 私聊会话列表（新增） |
| privateSessionCreated | 服务端->控制端 | 私聊会话已创建（新增） |
| privateSessionDeleted | 服务端->控制端 | 私聊会话已删除（新增） |
| privateSessionSwitched | 服务端->控制端 | 私聊会话已切换（新增） |

## 文件列表

| 文件 | 说明 |
|------|------|
| src/external/llm/llm-service.js | 聊天核心模块 |
| src/apps/web-mediacenter/modules/voice/voice-command-app-service.js | 语音命令处理 |
| public/js/chat.js | 前端聊天模块 |
| public/js/websocket.js | WebSocket客户端 |
| public/css/chat.css | 聊天样式 |
| public/upload.html | 控制端页面 |
| public/display.html | 显示端页面 |
| server.js | 服务端 |
| ~/.config/aasc-user/chat-history.json | 聊天历史 |
| ~/.config/aasc-user/chat-session.json | 会话状态 |
| ~/.config/aasc-user/chat-commands.json | 自定义指令 |

## LLM Agent 实现伪代码

```text
handleChatMessage(message):
    先执行控制端/服务端已有的确定性内置命令识别
    如果命令已识别:
        执行已注册服务器命令并返回
    否则:
        调用 chat.chatStream(message, templateTarget, sessionId)

chat.chatStream(message, options, callbacks):
    profile = normalizeProfile(activeProfile)
    如果 profile.mode == 'agent':
        template = 从服务端模板表读取 templateTarget
        policy = resolvePermissionPolicy(template.permissionProfile)
        prompt = 当前 profile/template 历史 + 当前系统提示词 + 当前消息
        continuationPrompt = 当前消息
        conversationKey = encode(mode, target, sessionId)
        PiRuntimeManager.chatStream(profile, template, prompt, callbacks, { continuationPrompt, conversationKey })
        Pi 失败时返回失败，不回退到普通 LLM HTTP
    否则:
        沿用现有 OpenAI 兼容 SSE 请求
```

`PiRuntimeManager` 为 `(profileName, templateId, permissionProfile, conversationKey)` 维护服务器拥有的 RPC 子进程，并在服务器重启、SIGTERM/SIGINT、删除单轮历史或单次异常时清理对应进程。首次请求初始化必要历史，后续请求只发送当前消息。模板请求中的任意 `tools` 字段不参与策略计算；高权限策略暂由控制端配置，服务器仍执行固定策略校验。

语音会话路由补充：群聊固定使用 `mode=group,target=null,sessionId=default`，私聊按助手角色使用独立的 `mode=private,target,sessionId=default`。`setMode()` 在模式或私聊目标变化时回收旧 Pi 会话，`switchSession()` 在私聊 sessionId 变化时回收旧会话，均保留应用层历史；下一次输入创建新进程。语音 `chat` 结果必须显式携带模式、目标、会话 ID 和模板目标，服务端据此构造 Pi 会话键。

## 模板持久化隔离伪代码

```text
setTemplates(templates, options):
    chatTemplates = normalize(templates)
    如果 options.persist 不是 false:
        saveTemplates()  // 生产控制端默认持久化
    返回 chatTemplates

Agent 测试:
    setTemplates(testTemplates, { persist: false })
    测试结束恢复内存模板
    不写入 ~/.config/aasc-user/chat-templates.json

服务器启动:
    加载 chat-templates.json
    加载 chat-history-*.json
    控制端根据模板生成私聊入口
    模板入口缺失时，历史文件仍保留，不删除历史消息

getGroupSystemPrompt():
    basePrompt = chatConfig.systemPrompt
    templates = chatTemplates 中 name 和 content 均非空的模板
    如果 templates 为空:
        返回 basePrompt
    rolePrompts = 按模板顺序拼接 "角色名 + template 内容"
    返回 basePrompt + 群聊角色说明 + rolePrompts

群聊请求:
    如果 mode == 'group':
        systemPrompt = getGroupSystemPrompt()
        templateTarget = null
        content 保持用户原始消息，不删除角色名前缀
        historyKey 使用统一 group/default 会话

私聊请求:
    如果 mode == 'private':
        继续使用 templateTarget 对应的单一模板和私聊历史

群聊历史异常（暂不处理）:
    统一 group/default 历史可能包含旧工具调用流程留下的未闭合 Chat2API 文本
    上游流式接口返回 [Error: write after end] 时，当前实现可能将其作为普通 assistant 内容
    记录问题来源和影响，但暂不清理历史或修改流式错误处理
```
### 显示端语音普通聊天回包

```text
服务端接受已通过语音门控的普通显示端语音:
    effectiveRequestId = options.requestId 或生成唯一请求号
    sendToControl({
        type: 'chatInput',
        requestId: effectiveRequestId,
        content: displayContent 或 content,
        displayId: voiceOriginDisplayId,
        mode: messageMode
    })
    只调用一次 handleChatMessage/chat.chatStream()

控制端收到 chatInput:
    设置 Chat.activeRequestId = data.requestId
    复用 showStreamingMessage(data.content, 助手名)
    不发送 chatMessage，避免同一语音请求重复进入服务端

服务端流式完成且 voiceOriginDisplayId 存在:
    向来源显示端发送:
        { type: 'voiceCommand', action: 'response', text: fullMessage, detailText: fullMessage }
    TTS 仍按原有通用 voicePlayback 目标列表发送
    voiceOriginDisplayId 只用于来源显示端的弹窗回传，不触发源端专属 TTS

显示端收到 voiceCommand(response):
    detailText = data.detailText 或 data.text
    用 detailText 打开语音回复详情弹窗
    音频仍由现有 TTS 播放队列处理
```
