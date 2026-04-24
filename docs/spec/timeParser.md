# 时间解析模块实现文档

## 模块概述

时间解析模块 (`src/core/utils/time-parser.js`) 提供通用的时间解析功能，支持中文自然语言时间表达式。

## 核心功能

### 1. 中文数字转换

```
chineseToNumber(str):
    支持的中文数字:
        零、〇 = 0
        一 = 1, 二 = 2, ..., 九 = 9
        十 = 10, 百 = 100, 千 = 1000, 万 = 10000
    
    转换规则:
        "十" -> 10
        "二十" -> 20
        "十五" -> 15
        "一百二十三" -> 123
        "二千零一" -> 2001

extractNumber(text):
    优先匹配阿拉伯数字
    其次匹配中文数字
    返回数字或 null
```

### 2. 相对日期解析

```
parseRelativeDays(text):
    支持的表达式:
        "今天" / "今日" -> 今天 0 点
        "明天" / "明日" -> 明天 0 点
        "后天" -> 后天 0 点
        "大后天" -> 大后天 0 点
        "昨天" / "昨日" -> 昨天 0 点
        "前天" -> 前天 0 点
    
    返回: { date: Date, description: string }
```

### 3. 相对时间解析

```
parseRelativeTime(text):
    支持的单位:
        秒、分钟、小时、天、周、个月、年
    
    支持的方向:
        前 (过去)、后 (未来)
    
    示例:
        "3秒后" -> 3 秒后的时间
        "十分钟后" -> 10 分钟后的时间
        "2小时前" -> 2 小时前的时间
        "3天后" -> 3 天后的时间
    
    返回: { date: Date, description: string, isRelative: true }
```

### 4. 绝对日期解析

```
parseAbsoluteDate(text):
    支持的格式:
        "3月15日" -> 今年 3 月 15 日
        "2024年3月15日" -> 2024 年 3 月 15 日
        "十二月二十五日" -> 12 月 25 日
    
    返回: { date: Date, description: string, isAbsolute: true }
```

### 5. 绝对时间解析

```
parseAbsoluteTime(text):
    支持的格式:
        "3点" -> 下一个 3:00
        "15点30分" -> 下一个 15:30
        "下午3点" -> 下一个 15:00
    
    如果时间已过，自动设为明天
    
    返回: { date: Date, description: string, isAbsolute: true }
```

### 6. 时段解析

```
parseTimeOfDay(text):
    支持的时段:
        凌晨 -> 0 点
        早上/早晨/上午 -> 8 点
        中午 -> 12 点
        下午 -> 14 点
        傍晚/黄昏 -> 17 点
        晚上/晚间 -> 19 点
        深夜/半夜 -> 23 点
    
    返回: { date: Date, description: string, hours: number }
```

### 7. 组合解析

```
parseTime(text):
    解析顺序:
        1. 相对日期 (今天/明天/后天)
        2. 相对时间 (X秒/分钟/小时后)
        3. 绝对日期 (X月X日)
        4. 绝对时间 (X点X分)
        5. 时段 (早上/下午/晚上)
    
    组合支持:
        "明天下午3点" -> 明天 15:00
        "后天上午10点" -> 后天 10:00
        "3月15日下午2点30分" -> 3 月 15 日 14:30
    
    返回:
        {
            timestamp: number,      // Unix 时间戳（毫秒）
            description: string,    // 时间描述
            type: 'absolute' | 'relative',
            confidence: number,     // 解析置信度 0-1
            original: string        // 原始输入
        }
```

### 8. 提醒专用解析

```
parseTimeForReminder(text):
    如果解析置信度 < 0.5:
        返回默认值: 5 分钟后
    否则:
        返回 parseTime 结果
```

### 9. 时间格式化

```
formatTime(timestamp):
    格式化规则:
        今天 -> "今天 HH:MM"
        明天 -> "明天 HH:MM"
        今年 -> "MM月DD日 HH:MM"
        其他 -> "YYYY年MM月DD日 HH:MM"
```

## 使用示例

```javascript
const timeParser = require('./timeParser');

// 相对日期
timeParser.parseTime('今天');
// { timestamp: ..., description: '今天', type: 'absolute', confidence: 0.9 }

timeParser.parseTime('明天下午3点');
// { timestamp: ..., description: '明天下午', type: 'absolute', confidence: 0.9 }

// 相对时间
timeParser.parseTime('十分钟后');
// { timestamp: ..., description: '10分钟后', type: 'relative', confidence: 0.95 }

timeParser.parseTime('3天后');
// { timestamp: ..., description: '3天后', type: 'relative', confidence: 0.95 }

// 绝对日期
timeParser.parseTime('3月15日');
// { timestamp: ..., description: '3月15日', type: 'absolute', confidence: 0.9 }

// 提醒专用
timeParser.parseTimeForReminder('明天提醒我');
// { timestamp: ..., description: '明天', type: 'absolute', confidence: 0.9 }

// 格式化
timeParser.formatTime(Date.now() + 3600000);
// "今天 15:30"
```

## 置信度说明

| 置信度 | 说明 |
|--------|------|
| 0.95 | 相对时间（X秒/分钟/小时后） |
| 0.9 | 相对日期、绝对日期 |
| 0.85 | 绝对时间 |
| 0.7 | 时段（早上/下午等） |
| 0.3 | 默认值（无法解析时） |

## 相关文件

| 文件 | 说明 |
|------|------|
| src/core/utils/time-parser.js | 时间解析模块 |
| src/apps/web-mediacenter/modules/voice/voice-command-app-service.js | 使用时间解析处理提醒 |
| src/apps/web-mediacenter/modules/reminder/reminder-app-service.js | 提醒功能 |
