# 提醒功能规格文档

## 1. 功能概述

提醒功能允许用户在控制端设置定时提醒，服务端在指定时间通过语音播报和/或弹窗提示的方式在所有显示端提醒用户。

## 2. 数据结构

### 2.1 提醒对象

```javascript
{
    id: "r_abc123_1712016000000",  // 唯一ID
    content: "开会时间到了",        // 提醒内容
    time: "14:30",                // 提醒时间 (HH:mm 格式)
    type: "daily",               // 类型: "once"(临时) | "daily"(每天)
    methods: ["voice", "popup"], // 提醒方式数组
    repeat: {
        enabled: true,           // 是否重复
        interval: 5,             // 间隔(分钟)
        count: 3                 // 次数, 0=无限
    },
    enabled: true,              // 是否启用
    createdAt: 1712016000000,   // 创建时间戳
    lastTriggered: null,        // 上次触发时间
    nextTrigger: 1712017800000  // 下次触发时间戳
}
```

### 2.2 数据存储

提醒数据存储在 `config/reminders.json` 文件中。

## 3. API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/reminders` | GET | 获取所有提醒 |
| `/api/reminders` | POST | 创建新提醒 |
| `/api/reminders/:id` | PUT | 更新提醒 |
| `/api/reminders/:id` | DELETE | 删除提醒 |
| `/api/reminders/:id/toggle` | POST | 启用/禁用提醒 |
| `/api/reminders/test` | POST | 测试提醒 |

### 3.1 创建提醒

```http
POST /api/reminders
Content-Type: application/json

{
    "content": "开会时间到了",
    "time": "14:30",
    "type": "daily",
    "methods": ["voice", "popup"],
    "repeat": {
        "enabled": true,
        "interval": 5,
        "count": 3
    }
}
```

### 3.2 测试提醒

```http
POST /api/reminders/test
Content-Type: application/json

{
    "content": "测试提醒内容",
    "methods": ["voice", "popup"]
}
```

## 4. WebSocket 消息

### 4.1 服务端 → 显示端

#### 弹窗提示
```javascript
{
    type: 'reminder',
    action: 'popup',
    title: '提醒',
    time: '14:30',
    content: '开会时间到了'
}
```

#### 语音播报
```javascript
{
    type: 'reminder',
    action: 'voice',
    audioUrl: '/uploads/temp_tts.wav?t=1712017800000',
    text: '14:30 开会时间到了'
}
```

## 5. 核心模块

### 5.1 core/reminder.js

| 函数 | 说明 |
|------|------|
| `init()` | 初始化，加载提醒数据 |
| `addReminder(data)` | 添加提醒 |
| `updateReminder(id, data)` | 更新提醒 |
| `deleteReminder(id)` | 删除提醒 |
| `getReminder(id)` | 获取单个提醒 |
| `getAllReminders()` | 获取所有提醒 |
| `toggleReminder(id, enabled)` | 启用/禁用提醒 |
| `start(displayClients, sendToDisplay)` | 启动定时检查 |
| `stop()` | 停止定时器 |
| `checkReminders()` | 检查并触发提醒 |
| `triggerReminder(reminder)` | 执行提醒动作 |
| `testReminder(reminderData)` | 测试提醒 |

### 5.2 定时检查逻辑

- 每分钟检查一次所有启用的提醒
- 比较当前时间与提醒时间
- 触发后更新下次触发时间
- 临时提醒触发后自动禁用

## 6. 前端模块

### 6.1 public/js/reminder.js

| 函数 | 说明 |
|------|------|
| `loadReminders()` | 加载提醒列表 |
| `renderReminderList()` | 渲染提醒列表 |
| `addReminder()` | 添加提醒 |
| `toggleReminder(id, enabled)` | 切换提醒状态 |
| `deleteReminder(id)` | 删除提醒 |
| `testReminder()` | 测试提醒 |

### 6.2 display.html 弹窗

弹窗样式特点：
- 居中显示，半透明黑色背景
- 绿色边框和发光效果
- 显示时间和提醒内容
- 10秒后自动消失
- 可手动关闭

## 7. 提醒类型

| 类型 | 说明 |
|------|------|
| `once` | 临时提醒，只触发一次，触发后自动禁用 |
| `daily` | 每天提醒，每天在指定时间触发 |

## 8. 提醒方式

| 方式 | 说明 |
|------|------|
| `voice` | 语音播报，使用 TTS 生成语音并在显示端播放 |
| `popup` | 弹窗提示，在显示端显示弹窗 |

## 9. 重复提醒

重复提醒功能允许在首次触发后按设定间隔重复提醒：

- **间隔时间**: 1-60 分钟
- **重复次数**: 0 表示无限重复，否则为指定次数

## 10. 语音播报优先级

```
1. 自定义播报
2. 提醒播报  ← 新增
3. 整点报时
4. 测试整点报时
5. 聊天播报
6. 文件名播放
```

## 11. 文件清单

| 文件 | 说明 |
|------|------|
| `core/reminder.js` | 提醒核心模块 |
| `config/reminders.json` | 提醒数据存储 |
| `public/js/reminder.js` | 控制端提醒管理 |
| `public/upload.html` | 控制端界面（含提醒设置） |
| `public/display.html` | 显示端界面（含弹窗功能） |
| `server.js` | 服务端（含提醒 API） |
