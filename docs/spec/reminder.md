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
    repeatCount: 3,
    enabled: true,
    createdAt: 1712016000000,
    lastTriggered: null,
    nextTrigger: 1712017800000
}
```

## API

| 接口 | 方法 | 说明 |
|------|------|------|
| /api/reminders | GET | 获取所有提醒 |
| /api/reminders | POST | 创建提醒 |
| /api/reminders/:id | PUT | 更新提醒 |
| /api/reminders/:id | DELETE | 删除提醒 |
| /api/reminders/:id/toggle | POST | 启用/禁用 |
| /api/reminders/test | POST | 测试提醒 |
| /api/reminders/:id/test | POST | 测试指定提醒 |

## WebSocket 消息

### 弹窗提示
```javascript
{ type: 'reminder', action: 'popup', title: '提醒', time: '14:30', content: '开会时间到了' }
```

### 语音播报
```javascript
{ type: 'reminder', action: 'voice', audioUrl: '/uploads/temp_tts.wav', text: '14:30 开会时间到了' }
```

## 核心函数 (core/reminder.js)

| 函数 | 说明 |
|------|------|
| init() | 初始化，加载提醒数据 |
| addReminder(data) | 添加提醒 |
| updateReminder(id, data) | 更新提醒 |
| deleteReminder(id) | 删除提醒 |
| toggleReminder(id, enabled) | 启用/禁用 |
| checkReminders() | 检查并触发提醒 |
| triggerReminder(reminder) | 执行提醒动作 |
| testReminder(reminderData, targetDisplayId) | 测试提醒 |

## 定时检查逻辑

- 每分钟检查一次所有启用的提醒
- 比较当前时间与提醒时间
- 触发后更新下次触发时间
- 临时提醒触发后自动禁用

## 相关文件

| 文件 | 说明 |
|------|------|
| core/reminder.js | 服务端提醒逻辑 |
| public/js/reminder.js | 控制端提醒界面 |
| config/reminders.json | 提醒数据存储 |
