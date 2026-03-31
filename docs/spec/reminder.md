# 提醒功能实现文档

## 数据结构

```javascript
{
    id: "r_abc123_1712016000000",
    content: "开会时间到了",
    time: "14:30",
    type: "once" | "daily",
    methods: ["voice", "popup"],
    repeat: {
        enabled: true,
        interval: 5,
        count: 3
    },
    repeatCount: 1,
    enabled: true,
    createdAt: 1712016000000,
    lastTriggered: null,
    nextTrigger: 1712017800000
}
```

## 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识，格式: r_{随机}_{时间戳} |
| content | string | 提醒内容 |
| time | string | 提醒时间，格式: HH:MM |
| type | string | 类型: once(临时) / daily(每天) |
| methods | array | 提醒方式: voice(语音) / popup(弹窗) |
| repeat | object | 重复提醒设置 |
| repeat.enabled | boolean | 是否启用重复提醒 |
| repeat.interval | number | 重复间隔(分钟) |
| repeat.count | number | 重复次数(0=无限) |
| repeatCount | number | 每次提醒重复次数 |
| enabled | boolean | 是否启用 |
| createdAt | number | 创建时间戳 |
| lastTriggered | number | 上次触发时间戳 |
| nextTrigger | number | 下次触发时间戳 |

## 核心 API

### init()
初始化提醒模块。

```
调用 loadReminders()
输出已加载提醒数量
```

### loadReminders()
加载提醒数据。

```
如果配置文件存在:
    读取文件内容
    解析 JSON
否则:
    初始化为空数组
    保存到文件
```

### saveReminders()
保存提醒数据。

```
创建配置目录(如果不存在)
写入 JSON 文件(缩进2空格)
```

### generateId()
生成唯一ID。

```
返回 'r_' + 随机字符串 + '_' + 时间戳
```

### addReminder(data)
添加提醒。

```
构建提醒对象:
    id = generateId()
    content = data.content
    time = data.time
    type = data.type || 'once'
    methods = data.methods || ['voice', 'popup']
    repeat = 合并默认值和 data.repeat
    repeatCount = data.repeatCount || 1
    enabled = true
    createdAt = Date.now()
    lastTriggered = null
    nextTrigger = calculateNextTrigger(time, type)

添加到 reminders 数组
保存到文件
返回提醒对象
```

### updateReminder(id, data)
更新提醒。

```
查找提醒索引
如果不存在返回 null

更新字段:
    content -> reminder.content
    time -> reminder.time + 重新计算 nextTrigger
    type -> reminder.type + 重新计算 nextTrigger
    methods -> reminder.methods
    repeat -> 合并到 reminder.repeat
    repeatCount -> reminder.repeatCount

保存到文件
返回提醒对象
```

### deleteReminder(id)
删除提醒。

```
查找提醒索引
如果不存在返回 false

从数组删除
保存到文件
返回 true
```

### getReminder(id)
获取单个提醒。

```
返回 reminders.find(r => r.id === id) 或 null
```

### getAllReminders()
获取所有提醒。

```
返回 reminders 的副本
```

### toggleReminder(id, enabled)
启用/禁用提醒。

```
查找提醒
如果不存在返回 null

设置 reminder.enabled = enabled
如果启用:
    重新计算 nextTrigger

保存到文件
返回提醒对象
```

## 触发逻辑

### calculateNextTrigger(time, type)
计算下次触发时间。

```
解析 time 为 hours 和 minutes
获取当前日期时间
构建今天的触发时间

如果 type === 'once':
    如果今天时间已过:
        返回 null (不再触发)
    否则:
        返回今天的时间戳

如果 type === 'daily':
    如果今天时间已过:
        返回明天的时间戳
    否则:
        返回今天的时间戳
```

### shouldTrigger(reminder)
判断是否应该触发。

```
如果未启用返回 false
如果没有 nextTrigger 返回 false

计算当前时间与触发时间的差值
如果差值小于60秒:
    检查小时和分钟是否匹配
    如果匹配返回 true

返回 false
```

### triggerReminder(reminder, repeatIndex)
触发提醒。

```
记录日志
构建时间文本: HH:MM
构建完整内容: 时间 + 提醒内容

更新 reminder.lastTriggered

如果 type === 'once':
    禁用提醒
    设置 nextTrigger = null

如果 type === 'daily':
    重新计算 nextTrigger

保存到文件

对于每次 repeatCount:
    如果 methods 包含 'popup':
        发送弹窗消息到所有显示端
    
    如果 methods 包含 'voice':
        调用 tts.generateTTS(fullContent)
        发送语音消息到所有显示端
        等待 1.5 秒

返回 true
```

### checkReminders()
检查并触发提醒。

```
获取当前时间

遍历所有提醒:
    如果 shouldTrigger(reminder):
        调用 triggerReminder(reminder)
        
        如果 repeat.enabled 且 repeat.count !== 0:
            设置延迟触发:
                对于 i = 1 到 repeat.count:
                    延迟 i * interval * 60 * 1000 毫秒
                    再次触发提醒
```

### start(clients, sendFunc)
启动定时检查。

```
保存 displayClients 和 sendToDisplay 引用
注册时间监听器的 minute 事件
```

### onMinuteChange(eventData)
分钟变化回调。

```
调用 checkReminders() 检查提醒
```

### stop()
停止定时检查。

```
取消时间监听器的 minute 事件订阅
```

### testReminder(reminderData, targetDisplayId, sendFunc)
测试提醒。

```
构建时间文本
构建完整内容
获取 repeatCount

对于每次 repeatCount:
    如果指定 targetDisplayId:
        如果需要语音:
            调用 tts.generateTTS()
        发送提醒到指定显示端
    否则:
        如果需要语音:
            调用 tts.generateTTS()
        发送提醒到所有显示端
    
    等待 1.5 秒

返回 true
```

## WebSocket 消息

### 弹窗提示
```javascript
{
    type: 'reminder',
    action: 'popup',
    title: '提醒',
    time: '14:30',
    content: '开会时间到了',
    repeatIndex: 1,
    totalRepeat: 3
}
```

### 语音播报
```javascript
{
    type: 'reminder',
    action: 'voice',
    audioUrl: '/uploads/tts/tts_1234567890_abc123.wav',
    text: '14:30 开会时间到了',
    repeatIndex: 1,
    totalRepeat: 3
}
```

## HTTP API

| 接口 | 方法 | 说明 |
|------|------|------|
| /api/reminders | GET | 获取所有提醒 |
| /api/reminders | POST | 创建提醒 |
| /api/reminders/:id | PUT | 更新提醒 |
| /api/reminders/:id | DELETE | 删除提醒 |
| /api/reminders/:id/toggle | POST | 启用/禁用 |
| /api/reminders/test | POST | 测试提醒 |
| /api/reminders/:id/test | POST | 测试指定提醒 |

## 相关文件

| 文件 | 说明 |
|------|------|
| core/reminder.js | 服务端提醒逻辑 |
| core/tts.js | 语音合成服务 |
| public/js/reminder.js | 控制端提醒界面 |
| config/reminders.json | 提醒数据存储 |
