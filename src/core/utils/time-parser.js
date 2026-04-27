const chineseNumbers = {
    '零': 0, '〇': 0, '一': 1, '二': 2, '三': 3, '四': 4,
    '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
    '百': 100, '千': 1000, '万': 10000
};

function chineseToNumber(str) {
    if (!str) return 0;
    
    str = str.trim();
    
    if (/^\d+$/.test(str)) {
        return parseInt(str, 10);
    }
    
    let result = 0;
    let temp = 0;
    let lastUnit = 1;
    
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        const value = chineseNumbers[char];
        
        if (value === undefined) {
            continue;
        }
        
        if (value >= 10) {
            if (temp === 0) {
                temp = 1;
            }
            if (value > lastUnit) {
                result = (result + temp) * value;
            } else {
                result += temp * value;
            }
            lastUnit = value;
            temp = 0;
        } else {
            temp = temp * 10 + value;
        }
    }
    
    result += temp;
    
    return result || 0;
}

function extractNumber(text) {
    const arabicMatch = text.match(/(\d+)/);
    if (arabicMatch) {
        return parseInt(arabicMatch[1], 10);
    }
    
    const chineseMatch = text.match(/([零〇一二三四五六七八九十百千万]+)/);
    if (chineseMatch) {
        return chineseToNumber(chineseMatch[1]);
    }
    
    return null;
}

function parseRelativeDays(text) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    if (text.includes('今天') || text.includes('今日')) {
        return { date: today, description: '今天' };
    }
    
    if (text.includes('明天') || text.includes('明日')) {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return { date: tomorrow, description: '明天' };
    }
    
    if (text.includes('后天')) {
        const dayAfter = new Date(today);
        dayAfter.setDate(dayAfter.getDate() + 2);
        return { date: dayAfter, description: '后天' };
    }
    
    if (text.includes('大后天')) {
        const dayAfter = new Date(today);
        dayAfter.setDate(dayAfter.getDate() + 3);
        return { date: dayAfter, description: '大后天' };
    }
    
    if (text.includes('昨天') || text.includes('昨日')) {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        return { date: yesterday, description: '昨天' };
    }
    
    if (text.includes('前天')) {
        const dayBefore = new Date(today);
        dayBefore.setDate(dayBefore.getDate() - 2);
        return { date: dayBefore, description: '前天' };
    }
    
    return null;
}

function parseRelativeTime(text) {
    const now = new Date();
    let milliseconds = 0;
    let description = '';
    
    const patterns = [
        { regex: /(\d+|零|〇|一|二|三|四|五|六|七|八|九|十|百|千|万)+\s*秒\s*(前|后)/, unit: 1000, name: '秒' },
        { regex: /(\d+|零|〇|一|二|三|四|五|六|七|八|九|十|百|千|万)+\s*分钟\s*(前|后)/, unit: 60 * 1000, name: '分钟' },
        { regex: /(\d+|零|〇|一|二|三|四|五|六|七|八|九|十|百|千|万)+\s*小时\s*(前|后)/, unit: 60 * 60 * 1000, name: '小时' },
        { regex: /(\d+|零|〇|一|二|三|四|五|六|七|八|九|十|百|千|万)+\s*天\s*(前|后)/, unit: 24 * 60 * 60 * 1000, name: '天' },
        { regex: /(\d+|零|〇|一|二|三|四|五|六|七|八|九|十|百|千|万)+\s*周\s*(前|后)/, unit: 7 * 24 * 60 * 60 * 1000, name: '周' },
        { regex: /(\d+|零|〇|一|二|三|四|五|六|七|八|九|十|百|千|万)+\s*个月\s*(前|后)/, unit: 30 * 24 * 60 * 60 * 1000, name: '个月' },
        { regex: /(\d+|零|〇|一|二|三|四|五|六|七|八|九|十|百|千|万)+\s*年\s*(前|后)/, unit: 365 * 24 * 60 * 60 * 1000, name: '年' }
    ];
    
    for (const pattern of patterns) {
        const match = text.match(pattern.regex);
        if (match) {
            const num = extractNumber(match[0]);
            if (num !== null) {
                const isAfter = match[0].includes('后');
                milliseconds = num * pattern.unit * (isAfter ? 1 : -1);
                description = `${num}${pattern.name}${isAfter ? '后' : '前'}`;
                
                const result = new Date(now.getTime() + milliseconds);
                return { date: result, description, isRelative: true };
            }
        }
    }
    
    return null;
}

function parseAbsoluteDate(text) {
    const now = new Date();
    let year = now.getFullYear();
    let month = null;
    let day = null;
    
    const yearMatch = text.match(/(\d{4}|[一二三四五六七八九十零〇]+)\s*年/);
    if (yearMatch) {
        year = extractNumber(yearMatch[1]) || year;
    }
    
    const monthMatch = text.match(/(\d{1,2}|[一二三四五六七八九十零〇]+)\s*月/);
    if (monthMatch) {
        month = extractNumber(monthMatch[1]);
    }
    
    const dayMatch = text.match(/(\d{1,2}|[一二三四五六七八九十零〇]+)\s*[日号]/);
    if (dayMatch) {
        day = extractNumber(dayMatch[1]);
    }
    
    if (month !== null && day !== null) {
        const date = new Date(year, month - 1, day);
        const description = year !== now.getFullYear() 
            ? `${year}年${month}月${day}日`
            : `${month}月${day}日`;
        return { date, description, isAbsolute: true };
    }
    
    return null;
}

function parseAbsoluteTime(text) {
    const now = new Date();
    let hours = null;
    let minutes = 0;
    
    const timeMatch = text.match(/(\d{1,2}|[一二三四五六七八九十零〇]+)\s*[点时](\d{1,2}|[一二三四五六七八九十零〇]+)?\s*分?/);
    if (timeMatch) {
        hours = extractNumber(timeMatch[1]);
        if (timeMatch[2]) {
            minutes = extractNumber(timeMatch[2]);
        }
    }
    
    if (hours !== null) {
        const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
        
        if (date <= now) {
            date.setDate(date.getDate() + 1);
        }
        
        const description = minutes > 0 
            ? `${hours}点${minutes}分`
            : `${hours}点`;
        return { date, description, isAbsolute: true };
    }
    
    return null;
}

function parseTimeOfDay(text) {
    const now = new Date();
    let hours = null;
    
    if (text.includes('凌晨')) {
        hours = 0;
    } else if (text.includes('早上') || text.includes('早晨') || text.includes('上午')) {
        hours = 8;
    } else if (text.includes('中午')) {
        hours = 12;
    } else if (text.includes('下午')) {
        hours = 14;
    } else if (text.includes('傍晚') || text.includes('黄昏')) {
        hours = 17;
    } else if (text.includes('晚上') || text.includes('晚间')) {
        hours = 19;
    } else if (text.includes('深夜') || text.includes('半夜')) {
        hours = 23;
    }
    
    if (hours !== null) {
        const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, 0, 0, 0);
        
        if (date <= now) {
            date.setDate(date.getDate() + 1);
        }
        
        const timeOfDayNames = {
            0: '凌晨', 8: '早上', 12: '中午',
            14: '下午', 17: '傍晚', 19: '晚上', 23: '深夜'
        };
        
        return { date, description: timeOfDayNames[hours], hours };
    }
    
    return null;
}

function parseTime(text) {
    if (!text) {
        return null;
    }
    
    text = text.trim();
    const now = new Date();
    let result = {
        timestamp: now.getTime(),
        description: '现在',
        type: 'relative',
        confidence: 0,
        original: text
    };
    
    const relativeDays = parseRelativeDays(text);
    if (relativeDays) {
        result.timestamp = relativeDays.date.getTime();
        result.description = relativeDays.description;
        result.type = 'absolute';
        result.confidence = 0.9;
        
        const timeOfDay = parseTimeOfDay(text);
        if (timeOfDay) {
            const date = new Date(relativeDays.date);
            date.setHours(timeOfDay.hours, 0, 0, 0);
            result.timestamp = date.getTime();
            result.description = `${relativeDays.description}${timeOfDay.description}`;
        }
        
        const absoluteTime = parseAbsoluteTime(text);
        if (absoluteTime) {
            const date = new Date(relativeDays.date);
            const timeParts = new Date(absoluteTime.date);
            date.setHours(timeParts.getHours(), timeParts.getMinutes(), 0, 0);
            result.timestamp = date.getTime();
            result.description = `${relativeDays.description}${absoluteTime.description}`;
        }
        
        return result;
    }
    
    const relativeTime = parseRelativeTime(text);
    if (relativeTime) {
        result.timestamp = relativeTime.date.getTime();
        result.description = relativeTime.description;
        result.type = 'relative';
        result.confidence = 0.95;
        return result;
    }
    
    const absoluteDate = parseAbsoluteDate(text);
    if (absoluteDate) {
        result.timestamp = absoluteDate.date.getTime();
        result.description = absoluteDate.description;
        result.type = 'absolute';
        result.confidence = 0.9;
        
        const absoluteTime = parseAbsoluteTime(text);
        if (absoluteTime) {
            const date = new Date(absoluteDate.date);
            const timeParts = new Date(absoluteTime.date);
            date.setHours(timeParts.getHours(), timeParts.getMinutes(), 0, 0);
            result.timestamp = date.getTime();
            result.description = `${absoluteDate.description}${absoluteTime.description}`;
        }
        
        return result;
    }
    
    const absoluteTime = parseAbsoluteTime(text);
    if (absoluteTime) {
        result.timestamp = absoluteTime.date.getTime();
        result.description = absoluteTime.description;
        result.type = 'absolute';
        result.confidence = 0.85;
        return result;
    }
    
    const timeOfDay = parseTimeOfDay(text);
    if (timeOfDay) {
        result.timestamp = timeOfDay.date.getTime();
        result.description = timeOfDay.description;
        result.type = 'absolute';
        result.confidence = 0.7;
        return result;
    }
    
    return result;
}

function parseTimeForReminder(text) {
    const result = parseTime(text);
    
    if (result.confidence < 0.5) {
        const now = new Date();
        const defaultTime = new Date(now.getTime() + 5 * 60 * 1000);
        return {
            timestamp: defaultTime.getTime(),
            description: '5分钟后',
            type: 'relative',
            confidence: 0.3,
            original: text
        };
    }
    
    return result;
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const targetDate = new Date(year, date.getMonth(), day);
    
    if (targetDate.getTime() === today.getTime()) {
        return `今天 ${hours}:${minutes}`;
    }
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (targetDate.getTime() === tomorrow.getTime()) {
        return `明天 ${hours}:${minutes}`;
    }
    
    if (year === now.getFullYear()) {
        return `${month}月${day}日 ${hours}:${minutes}`;
    }
    
    return `${year}年${month}月${day}日 ${hours}:${minutes}`;
}

module.exports = {
    parseTime,
    parseTimeForReminder,
    formatTime,
    chineseToNumber,
    extractNumber
};
