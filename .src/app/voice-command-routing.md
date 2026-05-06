#skill: ai-code-translation

# 语音指令分级路由

## 模块
app

## 目标文件清单

- `src/apps/web-mediacenter/modules/voice/voice-command-app-service.js` // processVoiceCommand 增加指令分级检查，定义 highLevelRouting 表
- `src/apps/server/boot/server-app.js` // 注册 updateCommandRouting WS handler，配置持久化

## 范围约束

- 只改动 processVoiceCommand 中的指令匹配和路由逻辑
- 不动现有指令处理函数本身（handleWeatherCommand / handleSearchCommand / handleTimeAnnounceCommand 等）
- 不动控制端/显示端前端代码
- 配置存储在 config.json 中 voiceCommand 段下
- 初始默认：天气/搜索 为高级指令且走 LLM，其余均为低级指令

## 已有声明（真实路径与行号）

### voice-command-app-service.js

- `processVoiceCommand(text, displayId, callbacks)` // line 1199，三层路由入口
- `handleSystemCommand(text, displayId)` // line 1389，系统指令优先处理
- `handleWeatherCommand(text, displayId)` // line 877，天气查询
- `handleSearchCommand(text, displayId)` // line 973，搜索查询
- `handleTimeAnnounceCommand(text, displayId)` // line 401，报时功能
- `handleReminderCommand(text, displayId)` // line 1127 附近，提醒创建
- `handlePlayCommand(text, displayId)` // line 1052 附近，媒体播放
- `handleRecordingCommand(text, displayId)` // 录音开关
- `handleMuteCommand(displayId)` // 静音
- `handleUnmuteCommand(displayId)` // 取消静音
- `handleCancelCommand(text, displayId)` // 取消待确认
- `handleAffirmCommand(text, displayId)` // 确认操作
- `handleTodayReminders(displayId)` // 今日提醒查询
- `handleTomorrowReminders(displayId)` // 明日提醒查询
- `handleTimeAnnounceCommand` 中包含 "开启报时"/"关闭报时" 子命令 // 间接影响状态
- `isBuiltin` // line 1237-1251，内置指令关键词硬编码列表

### server-app.js

- `config.set(key, value)` // 配置持久化
- `handleChatMessage(options)` // LLM 聊天入口，voiceCommand 的 chat 路由最终调此函数
- `WS handler 注册段` // wsServer.registerHandler 区域

### 配置文件

- `config/config.json` // voiceCommand 段下新增 routing 配置

## 新增定义

- `CommandLevel` = `{ LOW: 'low', HIGH: 'high' }` // 指令级别枚举
- `highLevelRouting` = `Map<commandType, 'system' | 'llm'>` // 高级指令的路由表，仅高级指令查此表
- `commandLevelMap` = `Map<commandType, CommandLevel>` // 每条指令的类型→级别映射，硬编码

### defaultCommandLevelMap（默认指令级别表）

| 指令类型 | 级别 | 说明 |
|---------|:----:|------|
| 系统指令（系统/私聊/退出私聊/自定义） | LOW | 影响系统状态路由 |
| 模式切换（打开/关闭指令模式） | LOW | 影响系统状态 |
| 拒绝/取消 | LOW | 影响待确认状态 |
| 确认/确认添加/是/好的 | LOW | 影响待确认状态 |
| 录音开关（开启/关闭/开始/停止录音） | LOW | 影响录音硬件状态 |
| 静音/取消静音 | LOW | 影响音频输出状态 |
| 停止播报/中止播报 | LOW | 影响 TTS 播放状态 |
| 提醒创建（提醒 + 内容） | LOW | 新增数据 |
| 今日提醒/明天提醒 | LOW | 查询本地数据，非外部API |
| 播放/第N个 | LOW | 影响媒体播放状态 |
| 报时（含开启/关闭报时） | LOW | 时间查询+状态变更 |
| **天气** | **HIGH** | 可开放给 LLM |
| **搜索** | **HIGH** | 可开放给 LLM |

### defaultHighLevelRouting（默认高级指令路由）

| 指令 | 默认路由 | 说明 |
|------|:--------:|------|
| 天气 | `llm` | 天气信息由 LLM 查询并回答 |
| 搜索 | `llm` | 搜索结果由 LLM 总结回答 |

## 操作流程

### 1) processVoiceCommand 新增指令分级检查（在指令匹配命中后、执行前插入）

```
processVoiceCommand(text, displayId, callbacks):

    // 第零步：系统指令始终优先执行（不变）
    systemResult = handleSystemCommand(text, displayId)
    if systemResult:
        return systemResult

    // 第一步：模式切换始终走程序处理（不变）
    if text 为 "打开指令模式" / "关闭指令模式":
        原有处理，return

    // 第二步：指令模式检查（不变）
    if session.commandMode == true:
        (保持原有私聊/群聊逻辑不变)

    // 第三步：指令匹配 + 分级路由（新增）
    匹配到命令类型 commandType:
        // 查该指令的级别
        level = commandLevelMap.get(commandType)

        if level == LOW:
            // 低级指令 → 始终走程序处理（原有流程）
            goto 原有指令处理

        if level == HIGH:
            // 高级指令 → 查路由配置
            route = highLevelRouting.get(commandType)  // 默认 'llm'

            if route == 'system':
                // 配置为系统处理 → 走原有程序处理
                goto 原有指令处理

            if route == 'llm':
                // 配置为 LLM 处理 → 转发到 LLM 聊天
                构造自然语言查询文本:
                    case time:     "现在几点钟了"
                    case weather:  "今天{提取到的城市}天气怎么样"
                    case search:   "搜索{提取的搜索关键词}"

                // 特殊处理：报时中的"开启报时"/"关闭报时"子命令
                if commandType == time && isTimeSubCommand(text):
                    仍走原有程序处理（开关报时影响系统状态）
                    goto 原有指令处理

                return { type: 'chat', message: 构造的查询文本, systemPrompt: defaultAssistant.template }

    // 第四步：无匹配 → 走 LLM 聊天（原有流程）
    return { type: 'chat', message: text, systemPrompt: defaultAssistant.template }
```

### 2) WebSocket 消息处理（server-app.js）

```
接收 updateCommandRouting 消息:
    // 数据格式: { type: 'updateCommandRouting', routing: { time: 'system'|'llm', weather: 'system'|'llm', search: 'system'|'llm' } }
    验证 routing 字段合法性:
        只允许 time / weather / search 三个键
        值只能是 'system' 或 'llm'
    更新 highLevelRouting 内存值
    持久化到 config.json:
        config.set('voiceCommand.routing', routing)
    广播更新确认:
        broadcastToControls({ type: 'commandRouting', routing: currentRouting })
```

### 3) 配置加载（服务端启动时）

```
启动时从 config.json 加载 voiceCommand.routing:
    routing = config.get('voiceCommand.routing', defaultHighLevelRouting)
    highLevelRouting = merge(defaultHighLevelRouting, routing)  // 保证所有键存在
```

### 4) 控制端 WebSocket 新增消息类型

| 类型 | 方向 | 说明 |
|------|------|------|
| updateCommandRouting | 控制端→服务端 | 更新高级指令路由配置 |
| commandRouting | 服务端→控制端 | 路由配置变更通知 |
