# 时间监听实现文档

## 模块概述

时间监听模块 (`src/apps/web-mediacenter/modules/time/time-listener-app-service.js`) 提供统一的时间变化事件监听能力，用于监听系统时间变化并触发相应事件。

## 核心功能

### 1. 事件类型

| 事件 | 说明 | 触发时机 |
|------|------|----------|
| minute | 分钟变化事件 | 每分钟触发一次 |
| hour | 小时变化事件 | 每小时触发一次 |
| day | 日期变化事件 | 每天0点触发 |

### 2. 事件数据

**minute 事件**:
```javascript
{
    minute: number,  // 当前分钟 (0-59)
    hour: number,    // 当前小时 (0-23)
    date: Date       // 当前日期对象
}
```

**hour 事件**:
```javascript
{
    hour: number,  // 当前小时 (0-23)
    date: Date     // 当前日期对象
}
```

**day 事件**:
```javascript
{
    day: number,  // 当前日期 (1-31)
    date: Date    // 当前日期对象
}
```

### 3. API 接口

**订阅事件**:
```
on(event, callback):
    注册事件监听器
    参数:
        event: 事件名称 ('minute' | 'hour' | 'day')
        callback: 回调函数
    返回:
        取消订阅函数

off(event, callback):
    取消事件监听器
    参数:
        event: 事件名称
        callback: 回调函数

once(event, callback):
    订阅一次性事件
    触发后自动取消订阅
    参数:
        event: 事件名称
        callback: 回调函数
```

**生命周期**:
```
start():
    启动时间监听
    初始化当前时间状态
    启动定时器 (每秒检查一次)

stop():
    停止时间监听
    清除定时器

getStatus():
    获取监听状态
    返回:
        isRunning: 是否运行中
        lastMinute: 上次分钟值
        lastHour: 上次小时值
        lastDay: 上次日期值
        listenerCount: 各事件监听器数量
```

## 实现细节

### 类结构

```
class TimeListener:
    属性:
        listeners: Map          // 事件监听器映射
        lastMinute: number      // 上次分钟值
        lastHour: number        // 上次小时值
        lastDay: number         // 上次日期值
        timer: interval         // 定时器引用
        isRunning: boolean      // 运行状态

    方法:
        on(event, callback)     // 订阅事件
        off(event, callback)    // 取消订阅
        once(event, callback)   // 一次性订阅
        emit(event, ...args)    // 触发事件
        start()                 // 启动监听
        stop()                  // 停止监听
        checkTimeChange()       // 检查时间变化
        getStatus()             // 获取状态
```

### 时间检查逻辑

```
checkTimeChange():
    获取当前时间
    currentMinute = now.getMinutes()
    currentHour = now.getHours()
    currentDay = now.getDate()
    
    如果 currentMinute !== lastMinute:
        更新 lastMinute
        触发 'minute' 事件
    
    如果 currentHour !== lastHour:
        更新 lastHour
        触发 'hour' 事件
    
    如果 currentDay !== lastDay:
        更新 lastDay
        触发 'day' 事件
```

## 使用示例

### 基本使用

```javascript
const timeListener = require('./core/timeListener');

// 启动监听
timeListener.start();

// 订阅分钟变化
timeListener.on('minute', (data) => {
    console.log(`当前时间: ${data.hour}:${data.minute}`);
});

// 订阅小时变化
timeListener.on('hour', (data) => {
    console.log(`整点: ${data.hour}点`);
});

// 订阅日期变化
timeListener.on('day', (data) => {
    console.log(`新的一天: ${data.date.toLocaleDateString()}`);
});

// 取消订阅
const unsubscribe = timeListener.on('minute', callback);
unsubscribe(); // 或 timeListener.off('minute', callback);
```

### 与其他模块集成

**报时模块集成**:
```javascript
// src/apps/web-mediacenter/modules/time/time-announce-app-service.js
const timeListener = require('./timeListener');

function start(displayClients, sendToDisplay) {
    timeListener.on('minute', onMinuteChange);
}

function onMinuteChange(eventData) {
    if (shouldAnnounce(eventData.minute)) {
        checkAndAnnounce();
    }
}
```

**提醒模块集成**:
```javascript
// src/apps/web-mediacenter/modules/reminder/reminder-app-service.js
const timeListener = require('./timeListener');

function start(clients, sendFunc) {
    timeListener.on('minute', onMinuteChange);
}

function onMinuteChange(eventData) {
    checkReminders();
}
```

## 相关文件

| 文件 | 说明 |
|------|------|
| src/apps/web-mediacenter/modules/time/time-listener-app-service.js | 时间监听模块 |
| src/apps/web-mediacenter/modules/time/time-announce-app-service.js | 报时模块（使用时间监听） |
| src/apps/web-mediacenter/modules/reminder/reminder-app-service.js | 提醒模块（使用时间监听） |
| server.js | 服务器启动时间监听 |

## 设计优势

1. **统一时间管理**: 所有时间相关功能使用统一的时间监听器
2. **减少定时器数量**: 从多个独立定时器减少到一个定时器
3. **事件驱动架构**: 模块间解耦，通过事件通信
4. **易于扩展**: 新增时间相关功能只需订阅相应事件
5. **资源高效**: 每秒检查一次，只在变化时触发事件
