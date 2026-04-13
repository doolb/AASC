# 语音命令实现文档

## 模块概述

语音命令模块 (`core/voiceCommand.js`) 处理显示端语音识别后的命令解析和执行。

## 核心功能

### 1. 语音状态显示

**显示端实现** (`public/display.html`):
```
变量:
    voiceSupported: 是否支持语音识别
    isListening: 是否正在识别
    voiceParts: 语音识别分段
    recognition: SpeechRecognition 实例

initVoiceRecognition():
    检查浏览器是否支持 SpeechRecognition
    如果不支持:
        设置 voiceSupported = false
        调用 updateVoiceStatusDisplay()
        返回
    设置 voiceSupported = true
    创建 SpeechRecognition 实例
    设置 continuous = true, interimResults = true
    设置 lang = 'zh-CN'
    绑定事件:
        onstart: 设置 isListening = true, 调用 sendVoiceStatus()
        onend: 设置 isListening = false, 调用 sendVoiceStatus(), 1秒后重启
        onerror: 如果不是 no-speech/aborted, 设置 isListening = false
        onresult: 调用 handleVoiceResult(event)
    启动识别

updateVoiceStatusDisplay():
    如果不支持: 显示灰色 "语音"（font-size: 24px, padding: 10px 20px, border-radius: 12px）
    如果正在识别: 显示绿色闪烁 "语音"（scale动画 + box-shadow发光效果）
    否则: 显示半透明 "语音"

updateVoiceTextDisplay(text, isFinal):
    如果有文字: 显示语音识别文字（font-size: 24px, padding: 12px 20px, border-radius: 12px，临时结果带…）
    否则: 隐藏

handleVoiceResult(event):
    获取识别结果
    更新 voiceTextDisplay 显示
    发送 { type: 'voiceInput', text, isFinal, fullText } 到服务器
    如果是最终结果: 3秒后隐藏文字显示
```

### 2. 提醒功能

**服务端实现** (`core/voiceCommand.js`):
```
parseTimeExpression(text):
    解析时间表达式:
        - "X分钟后" -> 相对时间
        - "X秒后" -> 相对时间
        - "X小时后" -> 相对时间
        - "X点X分" -> 绝对时间
        - 默认 -> 5分钟后

parseRepeatRule(text):
    解析重复规则:
        - "每天" -> daily
        - "每周" -> weekly
        - "每月" -> monthly
        - "每年" -> yearly
        - 默认 -> once

extractReminderContent(text):
    提取提醒内容:
        - 移除 "提醒我"
        - 移除时间表达式
        - 移除重复规则
        - 返回剩余内容

handleReminderCommand(text, displayId):
    解析时间和重复规则
    生成确认文本
    创建待确认记录 (5秒过期)
    生成 TTS 语音播放确认
    发送确认弹窗到显示端
    5秒后自动确认

executeReminderConfirmation(confirmationId, confirmed):
    如果确认:
        调用 reminder.addReminder() 添加提醒
    删除待确认记录

handleTodayReminders(displayId):
    获取所有提醒
    筛选今日提醒:
        - 每日提醒 (type === 'daily')
        - 今日一次性提醒 (type === 'once' 且 nextTrigger 是今天)
    按时间排序
    生成语音播报: "今天有X个提醒：时间1 内容1，时间2 内容2..."
    如果没有提醒: "今天没有提醒"

handleTomorrowReminders(displayId):
    获取所有提醒
    筛选明日提醒:
        - 每日提醒 (type === 'daily')
        - 明日一次性提醒 (type === 'once' 且 nextTrigger 是明天)
    按时间排序
    生成语音播报: "明天有X个提醒：时间1 内容1，时间2 内容2..."
    如果没有提醒: "明天没有提醒"
```

### 3. 静音功能

**服务端实现**:
```
handleMuteCommand(displayId):
    检查静音功能是否可用
    调用 muteAllDisplays() 执行静音
    生成语音播报:
        - 成功: "已静音所有显示端"
        - 已静音: "已经是静音状态"

handleUnmuteCommand(displayId):
    检查取消静音功能是否可用
    调用 unmuteAllDisplays() 取消静音
    生成语音播报:
        - 成功: "已取消静音"
        - 未静音: "当前不是静音状态"
```

**静音指令格式**:

| 指令 | 说明 |
|------|------|
| 静音 | 静音所有显示端 |
| 全部静音 | 静音所有显示端 |
| 取消静音 | 取消静音，恢复之前音量 |
| 恢复音量 | 取消静音，恢复之前音量 |

### 4. 报时功能

**服务端实现**:
```
handleTimeAnnounceCommand(text, displayId):
    如果 text 包含 "关闭报时":
        设置 timeAnnounce.enabled = false
        语音播放 "已关闭报时功能"
    否则如果 text 包含 "开启报时":
        设置 timeAnnounce.enabled = true
        语音播放 "已开启报时功能"
    否则:
        调用 timeAnnounce.generateTimeText() 生成时间文本
        生成 TTS 并播放
```

### 4. 天气查询功能

**服务端实现**:
```
handleWeatherCommand(text, displayId):
    提取城市名称:
        移除 "天气"、"今天"、"明天"、"后天" 等关键词
        如果没有城市名称: 默认 "Beijing"
    
    构建天气API URL:
        URL: https://wttr.in/{city}?format=j1&lang=zh
    
    打印日志:
        console.log("[语音命令] 天气API地址: {URL}")
    
    调用 wttr.in API:
        Headers: User-Agent: curl
        timeout: 15000ms
        重试: 最多3次，每次间隔1秒
    
    解析返回数据:
        cityName: 城市名称
        temp: 当前温度（摄氏度）
        weather: 天气描述
        humidity: 湿度
    
    生成天气文本:
        "{cityName}当前天气：{weather}，温度{temp}度，湿度{humidity}%"
    
    如果 displayId 存在:
        生成 TTS 并播放
        发送天气结果到显示端
    
    如果请求失败:
        语音播放 "获取天气失败，请稍后再试"
```

### 5. 搜索功能

**服务端实现**:
```
handleSearchCommand(text, displayId):
    提取搜索关键词
    如果 displayId 存在:
        语音播放 "正在搜索..."
    调用 performSearch(query) 执行搜索
    保存搜索历史
    广播搜索历史到控制端
    如果 displayId 存在:
        语音播放搜索结果
        发送搜索结果弹窗到显示端

performSearch(query):
    使用 axios 发送 HTTP 请求到 Bing 搜索
    使用 cheerio 解析 HTML
    尝试获取 AI 回答区域 #b_pole
    如果存在 AI 回答:
        返回 { type: 'ai_answer', content }
    否则:
        获取第一个搜索结果 li
        返回 { type: 'first_result', title, link, snippet }
    如果没有结果:
        返回 { type: 'error', message }
```

### 5. AI 助手响应

**服务端实现**:
```
assistantConfig:
    defaultName: '小爱'
    assistants: [{ name, template }]

findAssistant(name):
    在 assistants 中查找匹配的助手
    如果没找到: 返回默认助手

processVoiceCommand(text, displayId, callbacks):
    如果包含 "拒绝"/"取消":
        取消待确认操作
    否则如果包含 "提醒":
        调用 handleReminderCommand()
    否则如果包含 "报时"/"现在几点":
        调用 handleTimeAnnounceCommand()
    否则:
        返回 { type: 'chat', message, systemPrompt }
```

## server.js 处理逻辑

### handleChatMessage(options)

```
共享函数，处理聊天消息流，用于 chatMessage、voiceCommand、executeDeviceEvent
与 #chatInput 走完全相同的处理逻辑

参数:
  content: 消息内容
  displayId: 显示端ID
  displayIds: 多显示端ID列表
  playOnControl: 是否在控制端播放
  systemPrompt: 自定义系统提示词
  templateTarget: 模板目标名称
  mode: 会话模式
  target: 私聊目标
  sendToControl: 回调函数

处理逻辑:
  chat.addMessage({ role: 'control', content })
  chat.chatStream(content, { displayId, systemPrompt }, {
    onChunk: sendToControl({ type: 'chatChunk' })
    onSentence: sendToDisplay({ type: 'tts' }) 或 sendToControl({ type: 'playOnControl' })
    onComplete: chat.addMessage({ role: 'assistant' }), sendToControl({ type: 'chatResponse' })
    onError: sendToControl({ type: 'chatResponse', success: false })
  })
```

### voiceCommand 消息处理流程

```
接收 voiceCommand 消息
    ↓
调用 voiceCommand.processVoiceCommand(text, displayId, callbacks)
    ↓
根据 result.type 处理:
    ├─ 指令类(报时/天气/提醒等): processVoiceCommand 内部直接执行
    ├─ showHelp: sendToControl({ type: 'showHelp' })
    ├─ commands: executeCommands，非指令走 handleChatMessage
    ├─ chat: 调用 handleChatMessage（和 #chatInput 相同逻辑）
    ├─ privateMode/groupMode: sendToControl({ type: ... })
    └─ systemMessage: sendToControl({ type: 'systemMessage' })
```

## WebSocket 消息类型

### 显示端 -> 服务端

| 类型 | 说明 | 数据 |
|------|------|------|
| voiceInput | 语音输入 | `{ type, text, isFinal, fullText }` |
| voiceStatus | 语音状态 | `{ type, supported, listening }` |

### 服务端 -> 显示端

| 类型 | 说明 | 数据 |
|------|------|------|
| voiceCommand | 语音命令响应 | `{ type, action, text, audioUrl, ... }` |

### 控制端 -> 服务端

| 类型 | 说明 | 数据 |
|------|------|------|
| voiceCommand | 处理语音命令 | `{ type, displayId, text }` |
| confirmVoiceCommand | 确认语音命令 | `{ type, confirmationId, confirmed }` |
| getSearchHistory | 获取搜索历史 | `{ type }` |
| clearSearchHistory | 清空搜索历史 | `{ type }` |
| deleteSearchHistory | 删除搜索记录 | `{ type, id }` |
| getAssistantConfig | 获取助手配置 | `{ type }` |
| setAssistantConfig | 设置助手配置 | `{ type, config }` |

### 服务端 -> 控制端

| 类型 | 说明 | 数据 |
|------|------|------|
| searchHistory | 搜索历史 | `{ type, history }` |
| assistantConfig | 助手配置 | `{ type, config }` |

## 数据结构

### 搜索历史项

```javascript
{
    id: string,          // 唯一标识
    query: string,       // 搜索关键词
    results: {           // 搜索结果
        type: string,    // 'first_result' | 'ai_answer' | 'error'
        title: string,   // 标题
        snippet: string, // 摘要
        link: string     // 链接
    },
    timestamp: number    // 时间戳
}
```

### 助手配置

```javascript
{
    defaultName: string,     // 默认助手名字
    assistants: [{           // 助手列表
        name: string,        // 助手名字
        template: string     // 系统提示模板
    }]
}
```

### 待确认记录

```javascript
{
    type: string,           // 'reminder'
    displayId: string,      // 显示端ID
    data: {                 // 提醒数据
        content: string,
        time: string,
        type: string,
        methods: string[],
        repeat: object,
        repeatCount: number
    },
    expiresAt: number       // 过期时间
}
```

## 相关文件

| 文件 | 说明 |
|------|------|
| core/voiceCommand.js | 语音命令处理模块 |
| server.js | WebSocket 消息路由 |
| public/display.html | 显示端语音识别和UI |
| public/js/chat.js | 控制端语音命令处理 |
| public/js/websocket.js | WebSocket 消息处理 |
| public/css/display.css | 显示端样式 |

## 系统指令处理流程

### processVoiceCommand 返回类型

| 类型 | 说明 | 处理方式 |
|------|------|----------|
| showHelp | 显示帮助 | server.js 发送 showHelp 消息到控制端 |
| commands | 自定义指令组合 | server.js 调用 executeCommands，非指令走 handleChatMessage |
| chat | 聊天消息 | server.js 调用 handleChatMessage（和 #chatInput 相同逻辑） |
| privateMode | 进入私聊模式 | server.js 发送 privateMode 消息到控制端 |
| groupMode | 退出私聊模式 | server.js 发送 groupMode 消息到控制端 |
| systemMessage | 系统消息 | server.js 发送 systemMessage 消息到控制端 |

### executeCommands 执行逻辑

```
遍历 actions 数组:
    对每个 action 调用 processVoiceCommand(action, displayId, null)
    ↓
    根据 result.type 处理:
    ├─ result 为空 (undefined): 命令已被 processVoiceCommand 内部处理（报时/天气/提醒等）
    ├─ result.type === 'commands': 递归调用 executeCommands(result.actions, depth+1)
    ├─ result.type === 'chat': callbacks.onChat(result.message, result.systemPrompt)
    ├─ result.type === 'showHelp': callbacks.onShowHelp()
    ├─ result.type === 'privateMode'/'groupMode': callbacks.onModeChange(type, target)
    └─ result.type === 'systemMessage': callbacks.onSystemMessage(content)

递归深度限制: 3层，防止自定义指令循环引用
```

## 播放命令功能

### handlePlayCommand(text, displayId)

```
处理 "播放{文件名}" 指令:
    提取文件名关键词
    ↓
调用 searchMediaFiles(keyword) 搜索所有媒体库
    ↓
匹配结果:
    ├─ 无匹配 -> 语音提示 "没有找到文件"
    ├─ 单个匹配 -> 直接播放
    └─ 多个匹配 -> 列出选项让用户选择
        └─ 创建待确认记录 (30秒过期)
```

### searchMediaFiles(keyword)

```
遍历所有媒体库:
    对于每个媒体库:
        递归搜索所有文件
        匹配文件名包含关键词的文件
    返回匹配列表
```

### handlePlaySelection(confirmationId, selection, displayId)

```
处理用户选择:
    获取待确认记录
    解析选择序号
    发送媒体到显示端播放
```

### 选择指令格式

```
"第一个" / "第1个" / "1" -> 选择第1个
"第二个" / "第2个" / "2" -> 选择第2个
...
"第十个" / "第10个" / "10" -> 选择第10个
```

## 时间解析功能

### parseTimeExpression(text)

使用 timeParser 模块解析时间表达式，支持：

| 类型 | 示例 | 说明 |
|------|------|------|
| 相对日期 | 今天、明天、后天 | 相对于当前日期 |
| 相对时间 | 3秒后、5分钟后、2小时后 | 相对于当前时间 |
| 绝对时间 | 3点、15点30分 | 指定时间 |

详见 [timeParser.md](timeParser.md)

## 报时功能

### handleTimeAnnounceCommand(text, displayId)

```
处理报时相关指令:
    ├─ 包含"关闭报时" -> 关闭报时功能，播报提示
    ├─ 包含"开启报时" -> 开启报时功能，播报提示
    └─ 其他（报时/现在几点） -> 播报当前时间
```

### 报时指令格式

| 指令 | 说明 |
|------|------|
| 报时 | 播报当前时间 |
| 现在几点 | 播报当前时间 |
| 开启报时 | 开启整点报时功能 |
| 关闭报时 | 关闭整点报时功能 |

### 报时文本生成

使用 timeAnnounce 模块生成报时文本：

```
timeAnnounce.generateTimeText():
    获取当前时间
    生成格式: "现在是{年}年{月}月{日}日{星期}，{上午/下午/晚上}{时}点{分}分"
```
