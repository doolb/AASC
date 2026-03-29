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
  displayId: string     // 关联的显示端ID
}
```

### 会话状态

```javascript
{
  mode: string,             // 当前模式: 'group' | 'private'
  privateTarget: string,    // 当前私聊对象
  playOnControl: boolean,   // 是否在控制端播放语音
  controlName: string,      // 控制端名字
  displayNames: {}          // 显示端名字映射 { displayId: name }
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

## 核心模块实现

### core/chat.js

```
常量:
    HISTORY_FILE: '../config/chat-history.json'
    SESSION_FILE: '../config/chat-session.json'
    COMMANDS_FILE: '../config/chat-commands.json'
    MAX_HISTORY_SIZE: 100

变量:
    chatConfig: 聊天配置
    chatHistory: 聊天历史
    chatSession: 会话状态
    chatCommands: 自定义指令
    chatTemplates: 聊天模板

init(config):
    加载聊天配置
    加载聊天历史
    加载会话状态
    加载自定义指令
    加载聊天模板

loadHistory():
    读取 HISTORY_FILE
    解析 JSON
    如果文件不存在或解析失败:
        返回空数组
    兼容旧格式:
        如果 item.user 存在:
            转换为新格式 {
                role: 'control',
                name: '控制端',
                content: item.user
            }
            添加助手消息 {
                role: 'assistant',
                name: defaultName,
                content: item.assistant
            }

saveHistory():
    序列化 chatHistory
    写入 HISTORY_FILE

loadSession():
    读取 SESSION_FILE
    返回默认值如果文件不存在

saveSession():
    序列化 chatSession
    写入 SESSION_FILE

loadCommands():
    读取 COMMANDS_FILE
    返回默认值如果文件不存在

saveCommands():
    序列化 chatCommands
    写入 COMMANDS_FILE

addMessage(data):
    创建消息记录:
        id: Date.now().toString()
        timestamp: Date.now()
        role: data.role
        name: data.name
        ip: data.ip
        content: data.content
        mode: chatSession.mode
        target: chatSession.privateTarget
        displayId: data.displayId
    添加到 chatHistory
    如果超过 MAX_HISTORY_SIZE:
        截断历史
    调用 saveHistory()
    返回消息记录

getHistory(options):
    options.role: 按角色过滤
    options.mode: 按模式过滤
    options.limit: 限制数量
    返回过滤后的历史

clearHistory(options):
    如果 options.mode === 'private' 且有 target:
        只删除该助手的私聊消息
    如果 options.mode === 'group':
        只删除群聊消息，保留私聊消息
    否则:
        清空所有消息
    调用 saveHistory()
    返回更新后的历史

setMode(mode, target):
    设置 chatSession.mode = mode
    如果 mode === 'private':
        设置 chatSession.privateTarget = target
    否则:
        清空 chatSession.privateTarget
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

buildMessages(userMessage, options):
    构建发送给AI的消息数组
    包含系统提示词
    如果 includeHistory 为 true:
        包含最近的历史消息
    如果是私聊模式:
        使用对应助手的模板
    添加当前用户消息

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
        调用 callbacks.onChunk()
    每完成一个句子:
        调用 callbacks.onSentence()
    完成后:
        调用 addMessage()
        调用 callbacks.onComplete()
```

### core/voiceCommand.js 更新

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
        创建待确认记录 (5秒过期)
        生成 TTS 语音播放确认
        发送确认弹窗到显示端
        5秒后自动确认
    
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
    
    processVoiceCommand(text, displayId):
        处理语音命令入口:
            1. 检查取消命令
            2. 检查提醒命令
            3. 检查报时命令
            4. 检查搜索命令
            5. 检查助手名字
            6. 默认返回聊天

新增函数:
    handleSystemCommand(text, displayId):
        处理系统指令:
        
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
    
    loadSession():
        请求 GET /api/chat/session
        更新 this.session
    
    saveSession():
        请求 POST /api/chat/session
        发送 this.session
    
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
            群聊页签
            各助手私聊页签 (从模板列表生成)
        渲染聊天主区域:
            头部: 标题 + 模式指示 + 操作按钮
            消息区域: 聊天记录列表
            输入区域: 语音按钮 + 输入框 + 发送按钮
            底部: 播放位置选项
        调用 renderHistory()
        调用 renderModeIndicator()
        注: 已移除模板下拉框，改用左侧页签切换
    
    renderModeIndicator():
        如果 mode === 'group':
            显示 "当前模式: 群聊"
        否则:
            显示 "当前模式: 私聊({target})"
            添加 "退出私聊" 按钮
    
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
        初始化 displayMessage = message, sendMessage = message
        如果是群聊模式:
            遍历模板列表
            如果消息以模板名字开头:
                设置 templateTarget = 模板名字
                sendMessage = 去掉助手名字前缀后的内容
                如果 sendMessage 为空:
                    toast 提示进入私聊模式
                    返回
                break
            如果没有匹配到助手名字且有模板:
                设置 templateTarget = 第一个模板的助手名字
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
            包含 '搜索' -> handleSearchCommand(text), 返回 true
        
        返回 false (不是系统指令，交给聊天处理)
    
    processVoiceCommand(text):
        处理显示端语音输入:
        
        如果 text === '系统':
            调用 showHelp()
            返回
        
        如果 text 以 '私聊' 开头:
            提取助手名字，进入私聊模式
            返回
        
        如果 text === '退出私聊':
            退出私聊模式
            返回
        
        检查自定义指令:
            遍历 commands.commands
            如果 text 匹配关键词:
                调用 executeCommands(actions)
                返回
        
        检查内置指令:
            包含 '提醒' -> handleReminderCommand(text)
            包含 '报时' 或 '现在几点' -> handleTimeAnnounceCommand(text)
            包含 '天气' -> handleWeatherCommand(text)
            包含 '搜索' -> handleSearchCommand(text)
            以 '聊天' 开头 -> 发送聊天消息
        
        其他:
            检查是否包含助手名字
            如果包含 -> 发送聊天消息
            否则 -> 发送 voiceCommand 到服务端处理
    
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
        
        如果 playOnControl === true:
            调用 playOnControlDevice(text)
        否则如果 displayId 存在:
            发送到显示端播放:
                type: 'tts'
                action: 'play'
                displayId: displayId
                text: text
        否则:
            调用 playOnControlDevice(text)
    
    playOnControlDevice(text):
        在控制端播放语音:
        
        如果支持 speechSynthesis:
            创建 SpeechSynthesisUtterance
            设置 lang = 'zh-CN'
            调用 speechSynthesis.speak()
        否则:
            请求 TTS API 生成音频
            创建 Audio 元素播放
    
    showConfig():
        显示设置面板:
            系统提示词
            自定义指令列表
            AI助手列表
            添加指令表单
            添加助手表单
    
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
    获取系统提示词:
        templateTarget = data.templateTarget || data.target
        如果 templateTarget 存在:
            获取模板作为系统提示词
            私聊时 includeHistory = true
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
```

## 消息类型汇总

### WebSocket 消息类型

| 类型 | 方向 | 说明 |
|------|------|------|
| chatMessage | 双向 | 聊天消息 |
| chatMode | 双向 | 模式切换 |
| chatSession | 服务端->控制端 | 会话状态 |
| chatCommands | 服务端->控制端 | 自定义指令 |
| systemMessage | 服务端->控制端 | 系统消息 |
| playOnControl | 服务端->控制端 | 控制端播放语音 |

## 文件列表

| 文件 | 说明 |
|------|------|
| core/chat.js | 聊天核心模块 |
| core/voiceCommand.js | 语音命令处理 |
| public/js/chat.js | 前端聊天模块 |
| public/js/websocket.js | WebSocket客户端 |
| public/css/chat.css | 聊天样式 |
| public/upload.html | 控制端页面 |
| public/display.html | 显示端页面 |
| server.js | 服务端 |
| config/chat-history.json | 聊天历史 |
| config/chat-session.json | 会话状态 |
| config/chat-commands.json | 自定义指令 |
