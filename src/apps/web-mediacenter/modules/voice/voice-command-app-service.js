const path = require('path');
const tts = require('../../../../external/tts/tts-service');
const reminder = require('../reminder/reminder-app-service');
const timeAnnounce = require('../time/time-announce-app-service');
const chat = require('../../../../external/llm/llm-service');
const timeParser = require('../../../../core/utils/time-parser');

const SEARCH_HISTORY_FILE = path.join(__dirname, '../../../../../config/search-history.json');

let searchHistory = [];
let pendingConfirmations = new Map();
let displayClients = null;
let sendToDisplay = null;
let broadcastToControls = null;
let mediaLibraryManager = null;
let muteAllDisplays = null;
let unmuteAllDisplays = null;
let voiceInputQueues = new Map();

// 指令分级路由
const COMMAND_LEVEL = {
    weather: 'high',
    search: 'high'
};
const COMMAND_LEVEL_DEFAULT = 'low';

let highLevelRouting = {
    weather: 'llm',
    search: 'llm'
};

const DEFAULT_WEATHER_CITIES = [
    '北京', '上海', '广州', '深圳', '杭州', '南京', '苏州', '成都', '重庆', '天津',
    '武汉', '西安', '长沙', '郑州', '青岛', '厦门', '福州', '宁波', '无锡', '合肥'
];

// wttr.in 对中文 URL 路径支持不可靠，需要中文→拼音映射
const CITY_PINYIN_MAP = {
    '北京': 'Beijing',
    '上海': 'Shanghai',
    '广州': 'Guangzhou',
    '深圳': 'Shenzhen',
    '杭州': 'Hangzhou',
    '南京': 'Nanjing',
    '苏州': 'Suzhou',
    '成都': 'Chengdu',
    '重庆': 'Chongqing',
    '天津': 'Tianjin',
    '武汉': 'Wuhan',
    '西安': "Xi'an",
    '长沙': 'Changsha',
    '郑州': 'Zhengzhou',
    '青岛': 'Qingdao',
    '厦门': 'Xiamen',
    '福州': 'Fuzhou',
    '宁波': 'Ningbo',
    '无锡': 'Wuxi',
    '合肥': 'Hefei'
};

let assistantConfig = {
    defaultName: '小爱',
    assistants: [
        { name: '小爱', template: '你是小爱，一个友好、活泼的智能助手。请用简洁、亲切的语言回答问题。' }
    ],
    defaultWeatherCity: '',
    weatherCities: DEFAULT_WEATHER_CITIES,
    reminderTemplate: '{content}',
    reminderTemplatePrefix: '',
    reminderTemplateSuffix: ''
};

function init(config = {}) {
    assistantConfig = {
        ...assistantConfig,
        ...config
    };

    if (config.assistantName) {
        assistantConfig.defaultName = config.assistantName;
    }
    if (config.assistants) {
        assistantConfig.assistants = config.assistants;
    }
    loadSearchHistory();
    console.log(`[语音命令] 默认助手: ${assistantConfig.defaultName}`);
}

function loadSearchHistory() {
    const fs = require('fs');
    try {
        if (fs.existsSync(SEARCH_HISTORY_FILE)) {
            const data = fs.readFileSync(SEARCH_HISTORY_FILE, 'utf8');
            searchHistory = JSON.parse(data);
            console.log(`[搜索] 已加载 ${searchHistory.length} 条搜索记录`);
        }
    } catch (err) {
        console.error('[搜索] 加载历史记录失败:', err.message);
        searchHistory = [];
    }
}

function saveSearchHistory() {
    const fs = require('fs');
    try {
        const dir = path.dirname(SEARCH_HISTORY_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(SEARCH_HISTORY_FILE, JSON.stringify(searchHistory, null, 2), 'utf8');
    } catch (err) {
        console.error('[搜索] 保存历史记录失败:', err.message);
    }
}

function setClients(clients, sendFunc, broadcastFunc) {
    displayClients = clients;
    sendToDisplay = sendFunc;
    broadcastToControls = broadcastFunc;
    
    setInterval(() => {
        const now = Date.now();
        for (const [id, confirmation] of pendingConfirmations) {
            if (confirmation.expiresAt && confirmation.expiresAt <= now) {
                pendingConfirmations.delete(id);
                console.log(`[语音命令] 清理过期确认: ${id}`);
            }
        }
    }, 60000);
}

function setMuteFunctions(muteFunc, unmuteFunc) {
    muteAllDisplays = muteFunc;
    unmuteAllDisplays = unmuteFunc;
}

function setMediaLibrary(manager) {
    mediaLibraryManager = manager;
}

// 指令分级路由：检查高级指令是否需要转 LLM 处理
function checkCommandRouting(text, commandType) {
    const level = COMMAND_LEVEL[commandType] || COMMAND_LEVEL_DEFAULT;
    if (level !== 'high') return null;

    const route = highLevelRouting[commandType];
    if (route !== 'llm') return null;

    let llmQuery;
    switch (commandType) {
        case 'weather':
            const cityText = text.replace(/今天|明天|后天|天气/g, '').replace(/[。，！？、；：,.!?;:]+$/, '').trim();
            llmQuery = cityText ? `查询${cityText}的天气` : '查询今天的天气';
            break;
        case 'search':
            const keyword = text.replace(/搜索/g, '').trim();
            llmQuery = keyword ? `搜索：${keyword}` : '帮我搜索一些信息';
            break;
        default:
            llmQuery = text;
    }

    const defaultAssistant = findAssistant(assistantConfig.defaultName);
    return { type: 'chat', message: llmQuery, systemPrompt: defaultAssistant.template };
}

function setCommandRouting(routing) {
    if (!routing || typeof routing !== 'object') return false;
    let changed = false;
    for (const [key, value] of Object.entries(routing)) {
        if (COMMAND_LEVEL[key] === 'high' && (value === 'system' || value === 'llm')) {
            highLevelRouting[key] = value;
            changed = true;
        }
    }
    return changed;
}

function getCommandRouting() {
    return { ...highLevelRouting };
}

function buildDisplayAudioUrl(audioPath) {
    const fileName = path.basename(audioPath);
    return `/uploads/tts/${fileName}`;
}

async function speakToDisplay(displayId, text, action = 'response', extra = {}) {
    if (!displayId || !sendToDisplay) {
        return false;
    }

    const audioPath = await tts.generateTTS(text);
    sendToDisplay(displayId, {
        type: 'voiceCommand',
        action,
        text,
        audioUrl: buildDisplayAudioUrl(audioPath),
        ...extra
    });

    return true;
}

function formatReminderContent(content) {
    const template = assistantConfig.reminderTemplate || '{content}';
    const prefix = assistantConfig.reminderTemplatePrefix || '';
    const suffix = assistantConfig.reminderTemplateSuffix || '';
    return `${prefix}${template.replace(/\{content\}/g, content)}${suffix}`.trim();
}

function formatDateTimeLabel(date) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const diffDays = Math.round((targetStart - todayStart) / (24 * 60 * 60 * 1000));
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');

    if (diffDays === 0) {
        return `今天${hours}:${minutes}`;
    }
    if (diffDays === 1) {
        return `明天${hours}:${minutes}`;
    }

    return `${date.getMonth() + 1}月${date.getDate()}日 ${hours}:${minutes}`;
}

function sanitizeCityName(text) {
    if (!text) {
        return '';
    }

    return text
        .replace(/天气|今天|明天|后天|明日|后日|现在|当前|查询|播报|一下|怎么样|如何|情况/g, '')
        .replace(/[，。！？、,.!?；;:“”"'‘’]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function resolveWeatherCity(text) {
    const requestedCity = sanitizeCityName(text);
    const cityList = Array.isArray(assistantConfig.weatherCities) && assistantConfig.weatherCities.length > 0
        ? assistantConfig.weatherCities
        : DEFAULT_WEATHER_CITIES;
    const defaultCity = assistantConfig.defaultWeatherCity;

    if (!requestedCity) {
        return {
            city: defaultCity,
            requestedCity: '',
            usedDefault: true
        };
    }

    const matchedCity = cityList.find(item => item === requestedCity || item.includes(requestedCity) || requestedCity.includes(item));
    if (matchedCity) {
        return {
            city: matchedCity,
            requestedCity,
            usedDefault: false
        };
    }

    return {
        city: defaultCity,
        requestedCity,
        usedDefault: true
    };
}

function getPendingConfirmationByDisplay(displayId, type) {
    for (const [id, confirmation] of pendingConfirmations) {
        if (confirmation.displayId === displayId && (!type || confirmation.type === type)) {
            return [id, confirmation];
        }
    }

    return null;
}

function parseTimeExpression(text) {
    const now = new Date();
    let targetTime = null;
    let timeDescription = '';
    
    const relativeMinuteMatch = text.match(/(\d+)\s*分钟/);
    const relativeSecondMatch = text.match(/(\d+)\s*秒/);
    const relativeHourMatch = text.match(/(\d+)\s*小时/);
    const absoluteTimeMatch = text.match(/(\d{1,2})[点时](\d{1,2})?分?/);
    const absoluteHourMatch = text.match(/(\d{1,2})[点时]$/);
    
    if (relativeMinuteMatch) {
        const minutes = parseInt(relativeMinuteMatch[1]);
        targetTime = new Date(now.getTime() + minutes * 60 * 1000);
        timeDescription = `${minutes}分钟后`;
    } else if (relativeSecondMatch) {
        const seconds = parseInt(relativeSecondMatch[1]);
        targetTime = new Date(now.getTime() + seconds * 1000);
        timeDescription = `${seconds}秒后`;
    } else if (relativeHourMatch) {
        const hours = parseInt(relativeHourMatch[1]);
        targetTime = new Date(now.getTime() + hours * 60 * 60 * 1000);
        timeDescription = `${hours}小时后`;
    } else if (absoluteTimeMatch) {
        const hours = parseInt(absoluteTimeMatch[1]);
        const minutes = absoluteTimeMatch[2] ? parseInt(absoluteTimeMatch[2]) : 0;
        targetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
        if (targetTime <= now) {
            targetTime.setDate(targetTime.getDate() + 1);
        }
        timeDescription = `${hours}点${minutes > 0 ? minutes + '分' : '整'}`;
    } else if (absoluteHourMatch) {
        const hours = parseInt(absoluteHourMatch[1]);
        targetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, 0, 0, 0);
        if (targetTime <= now) {
            targetTime.setDate(targetTime.getDate() + 1);
        }
        timeDescription = `${hours}点整`;
    } else {
        targetTime = new Date(now.getTime() + 5 * 60 * 1000);
        timeDescription = '5分钟后';
    }
    
    return { targetTime, timeDescription };
}

function parseRepeatRule(text) {
    if (text.includes('每天')) {
        return { type: 'daily', description: '每天' };
    } else if (text.includes('每周')) {
        return { type: 'weekly', description: '每周' };
    } else if (text.includes('每月')) {
        return { type: 'monthly', description: '每月' };
    } else if (text.includes('每年')) {
        return { type: 'yearly', description: '每年' };
    }
    return { type: 'once', description: '一次性' };
}

function extractReminderContent(text) {
    let content = text;
    
    content = content.replace(/提醒我?/, '');
    content = content.replace(/每天|每周|每月|每年/, '');
    content = content.replace(/\d+\s*(分钟|秒|小时)后/, '');
    content = content.replace(/\d{1,2}[点时](\d{1,2})?分?/, '');
    content = content.replace(/\d{1,2}[点时]$/, '');
    
    content = content.trim();
    
    if (!content) {
        content = '该做事了';
    }

    return formatReminderContent(content);
}

async function handleReminderCommand(text, displayId) {
    const { targetTime, timeDescription } = parseTimeExpression(text);
    const { type: repeatType, description: repeatDescription } = parseRepeatRule(text);
    const content = extractReminderContent(text);
    const absoluteTimeLabel = formatDateTimeLabel(targetTime);
    
    const hours = targetTime.getHours().toString().padStart(2, '0');
    const minutes = targetTime.getMinutes().toString().padStart(2, '0');
    const timeStr = `${hours}:${minutes}`;
    
    const confirmText = `好的，我将${repeatDescription === '一次性' ? '' : repeatDescription}在${timeDescription}，也就是${absoluteTimeLabel}提醒你：${content}。是否确认？`;
    
    const confirmationId = `reminder_${Date.now()}`;
    pendingConfirmations.set(confirmationId, {
        type: 'reminder',
        displayId: displayId,
        confirmedAt: null,
        data: {
            content: content,
            time: timeStr,
            type: repeatType,
            methods: ['voice', 'popup'],
            repeat: {
                enabled: true,
                interval: 3,
                count: 3
            },
            repeatCount: 3
        },
        createdAt: Date.now(),
        expiresAt: Date.now() + 30000
    });
    
    try {
        sendToDisplay(displayId, {
            type: 'voiceCommand',
            action: 'confirm',
            confirmationId: confirmationId,
            text: confirmText,
            audioUrl: buildDisplayAudioUrl(await tts.generateTTS(confirmText))
        });
    } catch (err) {
        console.error('[语音命令] 提醒确认语音生成失败:', err.message);
    }
}

async function executeReminderConfirmation(confirmationId, confirmed) {
    const confirmation = pendingConfirmations.get(confirmationId);
    if (!confirmation) return false;

    if (confirmation.confirmedAt) {
        console.log(`[语音命令] 忽略重复确认: ${confirmationId}`);
        return false;
    }

    confirmation.confirmedAt = Date.now();
    
    pendingConfirmations.delete(confirmationId);
    
    if (confirmed) {
        const newReminder = reminder.addReminder(confirmation.data);
        console.log(`[语音命令] 提醒已添加: ${newReminder.time} - ${newReminder.content}`);
        if (confirmation.displayId) {
            try {
                const nextTrigger = newReminder.nextTrigger ? new Date(newReminder.nextTrigger) : new Date();
                const successText = `提醒添加成功，时间是${formatDateTimeLabel(nextTrigger)}，内容是${newReminder.content}`;
                await speakToDisplay(confirmation.displayId, successText, 'response');
            } catch (err) {
                console.error('[语音命令] 提醒成功语音生成失败:', err.message);
            }
        }
        return true;
    }

    if (confirmation.displayId) {
        try {
            await speakToDisplay(confirmation.displayId, '好的，已取消这次提醒', 'response');
        } catch (err) {
            console.error('[语音命令] 提醒取消语音生成失败:', err.message);
        }
    }
    
    return false;
}

function handleCancelCommand(text, displayId) {
    for (const [id, confirmation] of pendingConfirmations) {
        if (confirmation.displayId === displayId) {
            pendingConfirmations.delete(id);
            return true;
        }
    }
    return false;
}

async function handleTimeAnnounceCommand(text, displayId) {
    if (text.includes('关闭报时')) {
        timeAnnounce.setConfig({ enabled: false });
        const responseText = '已关闭报时功能';
        
        try {
            const audioPath = await tts.generateTTS(responseText);
            const fileName = path.basename(audioPath);
            
            sendToDisplay(displayId, {
                type: 'voiceCommand',
                action: 'response',
                text: responseText,
                audioUrl: `/uploads/tts/${fileName}`
            });
        } catch (err) {
            console.error('[语音命令] 报时语音生成失败:', err.message);
        }
    } else if (text.includes('开启报时')) {
        timeAnnounce.setConfig({ enabled: true });
        const responseText = '已开启报时功能';
        
        try {
            const audioPath = await tts.generateTTS(responseText);
            const fileName = path.basename(audioPath);
            
            sendToDisplay(displayId, {
                type: 'voiceCommand',
                action: 'response',
                text: responseText,
                audioUrl: `/uploads/tts/${fileName}`
            });
        } catch (err) {
            console.error('[语音命令] 报时语音生成失败:', err.message);
        }
    } else {
        try {
            const timeText = timeAnnounce.generateTimeText();
            const audioPath = await tts.generateTTS(timeText);
            const fileName = path.basename(audioPath);
            
            sendToDisplay(displayId, {
                type: 'tts',
                action: 'playAudio',
                audioUrl: `/uploads/tts/${fileName}`,
                text: timeText
            });
        } catch (err) {
            console.error('[语音命令] 报时语音生成失败:', err.message);
        }
    }
}

async function handleRecordingCommand(text, displayId) {
    if (!displayId || !sendToDisplay) {
        return false;
    }

    const shouldEnable = text.includes('开启录音') || text.includes('开始录音');
    const shouldDisable = text.includes('关闭录音') || text.includes('停止录音');

    if (!shouldEnable && !shouldDisable) {
        return false;
    }

    sendToDisplay(displayId, {
        type: 'control',
        action: 'setRecording',
        enabled: shouldEnable
    });

    try {
        await speakToDisplay(displayId, shouldEnable ? '已开启录音' : '已关闭录音', 'response');
    } catch (err) {
        console.error('[语音命令] 录音指令语音生成失败:', err.message);
    }

    return true;
}

async function handleAffirmCommand(displayId) {
    const pending = getPendingConfirmationByDisplay(displayId, 'reminder');
    if (!pending) {
        return false;
    }

    const [confirmationId] = pending;
    return executeReminderConfirmation(confirmationId, true);
}

async function handleTodayReminders(displayId) {
    const allReminders = reminder.getAllReminders();
    const today = new Date();
    const todayStr = today.toDateString();
    
    const todayReminders = allReminders.filter(r => {
        if (!r.enabled) return false;
        if (r.type === 'daily') return false;
        if (r.type === 'once' && r.nextTrigger) {
            const triggerDate = new Date(r.nextTrigger);
            return triggerDate.toDateString() === todayStr;
        }
        return false;
    });
    
    let responseText;
    if (todayReminders.length > 0) {
        const sortedReminders = todayReminders.sort((a, b) => a.time.localeCompare(b.time));
        const reminderTexts = sortedReminders.map(r => `${r.time} ${r.content}`);
        responseText = `今天有${todayReminders.length}个提醒：${reminderTexts.join('，')}`;
    } else {
        responseText = '今天没有提醒';
    }
    
    try {
        const audioPath = await tts.generateTTS(responseText);
        const fileName = path.basename(audioPath);
        sendToDisplay(displayId, {
            type: 'tts',
            action: 'playAudio',
            audioUrl: `/uploads/tts/${fileName}`,
            text: responseText
        });
    } catch (err) {
        console.error('[语音命令] 今日提醒语音生成失败:', err.message);
    }
}

async function handleTomorrowReminders(displayId) {
    const allReminders = reminder.getAllReminders();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toDateString();
    
    const tomorrowReminders = allReminders.filter(r => {
        if (!r.enabled) return false;
        if (r.type === 'daily') return false;
        if (r.type === 'once' && r.nextTrigger) {
            const triggerDate = new Date(r.nextTrigger);
            return triggerDate.toDateString() === tomorrowStr;
        }
        return false;
    });
    
    let responseText;
    if (tomorrowReminders.length > 0) {
        const sortedReminders = tomorrowReminders.sort((a, b) => a.time.localeCompare(b.time));
        const reminderTexts = sortedReminders.map(r => `${r.time} ${r.content}`);
        responseText = `明天有${tomorrowReminders.length}个提醒：${reminderTexts.join('，')}`;
    } else {
        responseText = '明天没有提醒';
    }
    
    try {
        const audioPath = await tts.generateTTS(responseText);
        const fileName = path.basename(audioPath);
        sendToDisplay(displayId, {
            type: 'tts',
            action: 'playAudio',
            audioUrl: `/uploads/tts/${fileName}`,
            text: responseText
        });
    } catch (err) {
        console.error('[语音命令] 明日提醒语音生成失败:', err.message);
    }
}

async function handleMuteCommand(displayId) {
    if (!muteAllDisplays) {
        const responseText = '静音功能不可用';
        try {
            const audioPath = await tts.generateTTS(responseText);
            const fileName = path.basename(audioPath);
            sendToDisplay(displayId, {
                type: 'voiceCommand',
                action: 'response',
                text: responseText,
                audioUrl: `/uploads/tts/${fileName}`
            });
        } catch (err) {
            console.error('[语音命令] 静音语音生成失败:', err.message);
        }
        return;
    }
    
    const result = muteAllDisplays();
    const responseText = result ? '已静音所有显示端' : '已经是静音状态';
    
    try {
        const audioPath = await tts.generateTTS(responseText);
        const fileName = path.basename(audioPath);
        sendToDisplay(displayId, {
            type: 'voiceCommand',
            action: 'response',
            text: responseText,
            audioUrl: `/uploads/tts/${fileName}`
        });
    } catch (err) {
        console.error('[语音命令] 静音语音生成失败:', err.message);
    }
}

async function handleUnmuteCommand(displayId) {
    if (!unmuteAllDisplays) {
        const responseText = '取消静音功能不可用';
        try {
            const audioPath = await tts.generateTTS(responseText);
            const fileName = path.basename(audioPath);
            sendToDisplay(displayId, {
                type: 'voiceCommand',
                action: 'response',
                text: responseText,
                audioUrl: `/uploads/tts/${fileName}`
            });
        } catch (err) {
            console.error('[语音命令] 取消静音语音生成失败:', err.message);
        }
        return;
    }
    
    const result = unmuteAllDisplays();
    const responseText = result ? '已取消静音' : '当前不是静音状态';
    
    try {
        const audioPath = await tts.generateTTS(responseText);
        const fileName = path.basename(audioPath);
        sendToDisplay(displayId, {
            type: 'voiceCommand',
            action: 'response',
            text: responseText,
            audioUrl: `/uploads/tts/${fileName}`
        });
    } catch (err) {
        console.error('[语音命令] 取消静音语音生成失败:', err.message);
    }
}

async function handlePlayCommand(text, displayId, callbacks) {
    let fileName = text.replace(/播放/, '').trim();
    
    if (!fileName) {
        const responseText = '请问您要播放什么文件？';
        if (callbacks && callbacks.onResult) {
            callbacks.onResult(responseText);
        } else if (displayId && sendToDisplay) {
            try {
                const audioPath = await tts.generateTTS(responseText);
                const audioFileName = path.basename(audioPath);
                sendToDisplay(displayId, {
                    type: 'voiceCommand',
                    action: 'response',
                    text: responseText,
                    audioUrl: `/uploads/tts/${audioFileName}`
                });
            } catch (err) {
                console.error('[语音命令] 播放语音生成失败:', err.message);
            }
        }
        return;
    }
    
    console.log(`[播放命令] 搜索文件: ${fileName}`);
    
    const matches = await searchMediaFiles(fileName);
    
    if (matches.length === 0) {
        const responseText = `没有找到名为"${fileName}"的文件`;
        if (callbacks && callbacks.onResult) {
            callbacks.onResult(responseText);
        } else if (displayId && sendToDisplay) {
            try {
                const audioPath = await tts.generateTTS(responseText);
                const audioFileName = path.basename(audioPath);
                sendToDisplay(displayId, {
                    type: 'voiceCommand',
                    action: 'response',
                    text: responseText,
                    audioUrl: `/uploads/tts/${audioFileName}`
                });
            } catch (err) {
                console.error('[语音命令] 播放语音生成失败:', err.message);
            }
        }
        return;
    }
    
    if (matches.length === 1) {
        const file = matches[0];
        const responseText = `正在播放${file.name}`;
        
        if (callbacks && callbacks.onResult) {
            callbacks.onResult(responseText);
        }
        
        if (displayId && sendToDisplay) {
            try {
                if (!callbacks) {
                    const audioPath = await tts.generateTTS(responseText);
                    const audioFileName = path.basename(audioPath);
                    sendToDisplay(displayId, {
                        type: 'voiceCommand',
                        action: 'response',
                        text: responseText,
                        audioUrl: `/uploads/tts/${audioFileName}`
                    });
                }
                
                sendToDisplay(displayId, {
                    type: 'media',
                    url: file.url,
                    mediaType: file.mediaType,
                    name: file.name
                });
            } catch (err) {
                console.error('[语音命令] 播放语音生成失败:', err.message);
            }
        }
        return;
    }
    
    const fileList = matches.slice(0, 5).map((f, i) => `${i + 1}. ${f.name}`).join('，');
    const responseText = `找到${matches.length}个匹配的文件：${fileList}。请说第几个来选择`;
    
    const confirmationId = `play_${Date.now()}`;
    pendingConfirmations.set(confirmationId, {
        type: 'play',
        displayId: displayId,
        callbacks: callbacks,
        data: { matches: matches },
        expiresAt: Date.now() + 30000
    });
    
    setTimeout(() => {
        const confirmation = pendingConfirmations.get(confirmationId);
        if (confirmation && confirmation.expiresAt <= Date.now()) {
            pendingConfirmations.delete(confirmationId);
            console.log(`[语音命令] 播放选择已过期: ${confirmationId}`);
        }
    }, 35000);
    
    if (callbacks && callbacks.onResult) {
        callbacks.onResult(responseText);
    }
    
    if (displayId && sendToDisplay) {
        try {
            if (!callbacks) {
                const audioPath = await tts.generateTTS(responseText);
                const audioFileName = path.basename(audioPath);
                sendToDisplay(displayId, {
                    type: 'voiceCommand',
                    action: 'playChoices',
                    confirmationId: confirmationId,
                    matches: matches.slice(0, 5),
                    text: responseText,
                    audioUrl: `/uploads/tts/${audioFileName}`
                });
            } else {
                sendToDisplay(displayId, {
                    type: 'voiceCommand',
                    action: 'playChoices',
                    confirmationId: confirmationId,
                    matches: matches.slice(0, 5),
                    text: responseText
                });
            }
        } catch (err) {
            console.error('[语音命令] 播放语音生成失败:', err.message);
        }
    }
}

async function searchMediaFiles(keyword) {
    const matches = [];
    const keywordLower = keyword.toLowerCase();
    
    if (!mediaLibraryManager) {
        console.warn('[播放命令] 媒体库管理器未初始化');
        return matches;
    }
    
    const libraries = mediaLibraryManager.listLibraries();
    
    for (const lib of libraries) {
        try {
            const items = await searchInLibrary(lib.id, keywordLower);
            matches.push(...items);
        } catch (err) {
            console.error(`[播放命令] 搜索媒体库 ${lib.id} 失败:`, err.message);
        }
    }
    
    return matches;
}

async function searchInLibrary(libraryId, keyword) {
    const matches = [];
    
    async function searchDir(dirPath) {
        try {
            const items = await mediaLibraryManager.list(libraryId, dirPath);
            
            for (const item of items) {
                if (item.type === 'folder') {
                    await searchDir(item.path);
                } else if (item.type === 'file') {
                    const nameLower = item.name.toLowerCase();
                    if (nameLower.includes(keyword)) {
                        matches.push({
                            name: item.name,
                            path: item.path,
                            url: item.url,
                            mediaType: item.mediaType,
                            libraryId: libraryId
                        });
                    }
                }
            }
        } catch (err) {
            console.error(`[播放命令] 搜索目录 ${dirPath} 失败:`, err.message);
        }
    }
    
    await searchDir('/');
    return matches;
}

async function handlePlaySelection(confirmationId, selection, displayId) {
    const confirmation = pendingConfirmations.get(confirmationId);
    if (!confirmation || confirmation.type !== 'play') {
        return false;
    }
    
    pendingConfirmations.delete(confirmationId);
    
    const index = parseInt(selection) - 1;
    if (index < 0 || index >= confirmation.data.matches.length) {
        return false;
    }
    
    const file = confirmation.data.matches[index];
    const responseText = `正在播放${file.name}`;
    
    const callbacks = confirmation.callbacks;
    
    if (callbacks && callbacks.onResult) {
        callbacks.onResult(responseText);
    }
    
    if (displayId && sendToDisplay) {
        if (!callbacks) {
            try {
                const audioPath = await tts.generateTTS(responseText);
                const audioFileName = path.basename(audioPath);
                sendToDisplay(displayId, {
                    type: 'voiceCommand',
                    action: 'response',
                    text: responseText,
                    audioUrl: `/uploads/tts/${audioFileName}`
                });
            } catch (err) {
                console.error('[语音命令] 播放语音生成失败:', err.message);
            }
        }
        
        sendToDisplay(displayId, {
            type: 'media',
            url: file.url,
            mediaType: file.mediaType,
            name: file.name
        });
    }
    
    return true;
}

async function handleWeatherCommand(text, displayId, callbacks) {
    const axios = require('axios');
    const weatherRequest = resolveWeatherCity(text);
    const city = weatherRequest.city;
    console.log(`[语音命令] 天气查询城市: ${city}`);
    const tryFetchWeather = async (retryCount = 0) => {
        const weatherCity = CITY_PINYIN_MAP[city] || encodeURIComponent(city);
        const url = city.length > 0
            ? `https://wttr.in/${weatherCity}?format=j1&lang=zh`
            : `https://wttr.in/?format=j1&lang=zh`;

        console.log(`[语音命令] 天气API地址: ${url} ${text}`);
        
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'curl'
            },
            timeout: 15000
        });
        
        return response.data;
    };
    
    try {
        let data;
        let lastError;
        
        for (let i = 0; i < 3; i++) {
            try {
                data = await tryFetchWeather(i);
                break;
            } catch (err) {
                lastError = err;
                console.log(`[语音命令] 天气API第${i + 1}次请求失败:`, err.message);
                if (i < 2) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }
        
        if (!data) {
            throw lastError;
        }
        
        const current = data.current_condition?.[0];
        const cityName = data.nearest_area?.[0]?.areaName?.[0]?.value || city;
        if (!current) {
            throw new Error('天气数据为空');
        }
        const temp = current.temp_C;
        const weather = current.lang_zh ? current.lang_zh[0].value : current.weatherDesc[0].value;
        const humidity = current.humidity;

        const fallbackText = weatherRequest.usedDefault && weatherRequest.requestedCity
            ? `没有找到${weatherRequest.requestedCity}，为你播报默认城市${cityName}的天气。`
            : '';
        const weatherText = `${fallbackText}${cityName}当前天气：${weather}，温度${temp}度，湿度${humidity}%`;
        
        if (callbacks && callbacks.onResult) {
            callbacks.onResult(weatherText);
        } else if (displayId && sendToDisplay) {
            try {
                const audioPath = await tts.generateTTS(weatherText);
                const fileName = path.basename(audioPath);
                sendToDisplay(displayId, {
                    type: 'voiceCommand',
                    action: 'weatherResult',
                    text: weatherText,
                    audioUrl: `/uploads/tts/${fileName}`
                });
            } catch (err) {
                console.error('[语音命令] 天气语音生成失败:', err.message);
            }
        }
    } catch (err) {
        console.error('[语音命令] 获取天气失败:', err.message);
        const errorText = '获取天气失败，天气服务暂时不可用，请稍后再试';
        if (callbacks && callbacks.onError) {
            callbacks.onError(errorText);
        } else if (displayId && sendToDisplay) {
            try {
                const audioPath = await tts.generateTTS(errorText);
                const fileName = path.basename(audioPath);
                sendToDisplay(displayId, {
                    type: 'voiceCommand',
                    action: 'response',
                    text: errorText,
                    audioUrl: `/uploads/tts/${fileName}`
                });
            } catch (ttsErr) {
                console.error('[语音命令] 错误语音生成失败:', ttsErr.message);
            }
        }
    }
}

async function handleSearchCommand(text, displayId) {
    let query = text.replace(/搜索/, '').trim();
    
    if (!query) {
        if (displayId && sendToDisplay) {
            const responseText = '请问您要搜索什么？';
            try {
                const audioPath = await tts.generateTTS(responseText);
                const fileName = path.basename(audioPath);
                sendToDisplay(displayId, {
                    type: 'voiceCommand',
                    action: 'response',
                    text: responseText,
                    audioUrl: `/uploads/tts/${fileName}`
                });
            } catch (err) {
                console.error('[语音命令] 搜索语音生成失败:', err.message);
            }
        }
        return;
    }
    
    if (displayId && sendToDisplay) {
        const searchingText = `正在搜索${query}`;
        try {
            const searchAudioPath = await tts.generateTTS(searchingText);
            const searchFileName = path.basename(searchAudioPath);
            sendToDisplay(displayId, {
                type: 'voiceCommand',
                action: 'response',
                text: searchingText,
                audioUrl: `/uploads/tts/${searchFileName}`
            });
        } catch (err) {
            console.error('[语音命令] 搜索语音生成失败:', err.message);
        }
    }
    
    try {
        const results = await performSearch(query);
        
        const historyItem = {
            id: Date.now().toString(),
            query: query,
            results: results,
            timestamp: Date.now()
        };
        
        searchHistory.unshift(historyItem);
        if (searchHistory.length > 50) {
            searchHistory = searchHistory.slice(0, 50);
        }
        saveSearchHistory();
        
        if (broadcastToControls) {
            broadcastToControls({
                type: 'searchHistory',
                history: searchHistory
            });
        }
        
        let responseText = '';
        if (results.type === 'ai_answer') {
            responseText = `搜索结果：${results.content}`;
        } else if (results.type === 'first_result') {
            responseText = `搜索结果：${results.title}。${results.snippet}`;
        } else {
            responseText = `没有找到关于${query}的结果`;
        }
        
        if (displayId && sendToDisplay) {
            const audioPath = await tts.generateTTS(responseText);
            const fileName = path.basename(audioPath);
            
            sendToDisplay(displayId, {
                type: 'voiceCommand',
                action: 'searchResult',
                query: query,
                results: results,
                text: responseText,
                audioUrl: `/uploads/tts/${fileName}`
            });
        }
    } catch (err) {
        console.error('[语音命令] 搜索失败:', err.message);
        if (displayId && sendToDisplay) {
            const errorText = '搜索失败，请稍后再试';
            try {
                const audioPath = await tts.generateTTS(errorText);
                const fileName = path.basename(audioPath);
                sendToDisplay(displayId, {
                    type: 'voiceCommand',
                    action: 'response',
                    text: errorText,
                    audioUrl: `/uploads/tts/${fileName}`
                });
            } catch (ttsErr) {
                console.error('[语音命令] 错误语音生成失败:', ttsErr.message);
            }
        }
    }
}

async function performSearch(query) {
    const axios = require('axios');
    const cheerio = require('cheerio');
    
    const searchUrl = `https://cn.bing.com/search?q=${encodeURIComponent(query)}&form=QBLH&sp=-1&lq=0&qs=n&sk=&sc=8-1`;
    console.log(`[搜索] 正在搜索: ${query}`);
    
    try {
        const response = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
                'Accept-Encoding': 'gzip, deflate, br',
                'Cache-Control': 'max-age=0',
                'Referer': 'https://cn.bing.com/',
                'sec-ch-ua': '"Microsoft Edge";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'document',
                'sec-fetch-mode': 'navigate',
                'sec-fetch-site': 'same-origin',
                'sec-fetch-user': '?1',
                'upgrade-insecure-requests': '1'
            },
            timeout: 15000
        });
        
        const $ = cheerio.load(response.data);
        
        const poleContent = $('#b_pole').text().trim();
        if (poleContent) {
            console.log('[搜索] 结果类型: ai_answer');
            return {
                type: 'ai_answer',
                content: poleContent.substring(0, 500)
            };
        }
        
        const firstLi = $('#b_results li').first();
        if (firstLi.length > 0) {
            const title = firstLi.find('h2 a').text().trim();
            const link = firstLi.find('h2 a').attr('href') || '';
            const snippet = firstLi.find('.b_caption p').text().trim();
            
            console.log('[搜索] 结果类型: first_result');
            return {
                type: 'first_result',
                title: title || '未获取到标题',
                link: link,
                snippet: snippet || '未获取到摘要'
            };
        }
        
        console.log('[搜索] 未找到结果');
        return {
            type: 'error',
            message: '未找到搜索结果'
        };
        
    } catch (err) {
        console.error('[搜索] 失败:', err.message);
        return {
            type: 'error',
            message: err.message
        };
    }
}

function getSearchHistory() {
    return [...searchHistory];
}

function clearSearchHistory() {
    searchHistory = [];
    saveSearchHistory();
}

function deleteSearchHistoryItem(id) {
    searchHistory = searchHistory.filter(item => item.id !== id);
    saveSearchHistory();
}

function findAssistant(name) {
    const found = assistantConfig.assistants.find(a => a.name === name);
    if (found) return found;
    
    return {
        name: assistantConfig.defaultName,
        template: '你是小爱，一个友好、活泼的智能助手。请用简洁、亲切的语言回答问题。'
    };
}

function getAssistantConfig() {
    return { ...assistantConfig };
}

function setAssistantConfig(config) {
    if (config.defaultName) assistantConfig.defaultName = config.defaultName;
    if (config.assistants) assistantConfig.assistants = config.assistants;
    if (config.defaultWeatherCity) assistantConfig.defaultWeatherCity = config.defaultWeatherCity;
    if (config.weatherCities) assistantConfig.weatherCities = config.weatherCities;
    if (config.reminderTemplate !== undefined) assistantConfig.reminderTemplate = config.reminderTemplate;
    if (config.reminderTemplatePrefix !== undefined) assistantConfig.reminderTemplatePrefix = config.reminderTemplatePrefix;
    if (config.reminderTemplateSuffix !== undefined) assistantConfig.reminderTemplateSuffix = config.reminderTemplateSuffix;
}

function enqueueVoiceInput(text, displayId, callbacks) {
    const queueKey = displayId || 'default';
    const previousTask = voiceInputQueues.get(queueKey) || Promise.resolve();
    const currentTask = previousTask
        .catch(() => undefined)
        .then(() => processVoiceCommand(text, displayId, callbacks));

    voiceInputQueues.set(queueKey, currentTask.finally(() => {
        if (voiceInputQueues.get(queueKey) === currentTask) {
            voiceInputQueues.delete(queueKey);
        }
    }));

    return currentTask;
}

async function processVoiceCommand(text, displayId, callbacks) {
    if (!text) return;
    
    const trimmedText = text.trim();
    // 去尾标点，ASR 常附带句号问号
    const cmdText = trimmedText.replace(/[。，！？、；：,.!?;:]+$/, '');
    
    // 第零步：指令模式开关（始终可用，不受指令模式状态影响）
    if (cmdText === '打开指令模式') {
        return { type: 'commandMode', enabled: true };
    }
    if (cmdText === '关闭指令模式') {
        return { type: 'commandMode', enabled: false };
    }

    // 第一步：系统指令始终优先执行
    const systemResult = handleSystemCommand(cmdText, displayId);
    if (systemResult) {
        return systemResult;
    }

    // 第二步：指令模式过滤
    const session = chat.getSession();
    if (session.commandMode === true) {
        if (session.mode === 'private') {
            const assistant = findAssistant(session.privateTarget);
            return { type: 'chat', message: trimmedText, systemPrompt: assistant.template };
        }

        const defaultAssistant = findAssistant(assistantConfig.defaultName);
        if (trimmedText.includes(defaultAssistant.name)) {
            const message = trimmedText.replace(defaultAssistant.name, '').trim();
            if (message) {
                return { type: 'chat', message, systemPrompt: defaultAssistant.template };
            }
            return;
        }

        const isBuiltin = (
            cmdText.includes('拒绝') || cmdText.includes('取消') ||
            cmdText === '确认' || cmdText === '确认添加' || cmdText === '是' || cmdText === '好的' ||
            cmdText.includes('开启录音') || cmdText.includes('开始录音') || cmdText.includes('关闭录音') || cmdText.includes('停止录音') ||
            cmdText === '静音' || cmdText.includes('全部静音') ||
            cmdText.includes('取消静音') || cmdText === '恢复音量' ||
            cmdText.includes('今日提醒') || cmdText.includes('今天提醒') ||
            cmdText.includes('明日提醒') || cmdText.includes('明天提醒') ||
            cmdText.includes('提醒') ||
            cmdText.includes('报时') || cmdText.includes('现在几点') ||
            cmdText.includes('天气') ||
            cmdText.includes('搜索') ||
            cmdText.includes('播放') ||
            cmdText.includes('停止播报') || cmdText.includes('中止播报')
        );
        if (!isBuiltin) {
            return;
        }
    }
    
    if (trimmedText.includes('拒绝') || trimmedText.includes('取消')) {
        const cancelled = handleCancelCommand(trimmedText, displayId);
        if (cancelled) {
            const responseText = '好的，已取消';
            try {
                const audioPath = await tts.generateTTS(responseText);
                const fileName = path.basename(audioPath);
                if (callbacks && callbacks.onResult) {
                    callbacks.onResult(responseText);
                } else if (displayId && sendToDisplay) {
                    sendToDisplay(displayId, {
                        type: 'voiceCommand',
                        action: 'response',
                        text: responseText,
                        audioUrl: `/uploads/tts/${fileName}`
                    });
                }
            } catch (err) {
                console.error('[语音命令] 取消语音生成失败:', err.message);
            }
            return;
        }
    }

    if (cmdText === '确认' || cmdText === '确认添加' || cmdText === '是' || cmdText === '好的') {
        const confirmed = await handleAffirmCommand(displayId);
        if (confirmed) {
            return;
        }
    }

    if (trimmedText.includes('开启录音') || trimmedText.includes('开始录音') || trimmedText.includes('关闭录音') || trimmedText.includes('停止录音')) {
        const handledRecording = await handleRecordingCommand(trimmedText, displayId);
        if (handledRecording) {
            return;
        }
    }
    
    if (cmdText === '静音' || trimmedText.includes('全部静音')) {
        await handleMuteCommand(displayId);
        return;
    }
    
    if (trimmedText.includes('取消静音') || cmdText === '恢复音量') {
        await handleUnmuteCommand(displayId);
        return;
    }

    // 停止播报
    if (trimmedText.includes('停止播报') || trimmedText.includes('中止播报')) {
        if (sendToDisplay && displayId) {
            sendToDisplay(displayId, { type: 'tts', action: 'stop' });
        }
        const stopText = '已停止播报';
        try {
            const audioPath = await tts.generateTTS(stopText);
            const fileName = path.basename(audioPath);
            if (callbacks && callbacks.onResult) {
                callbacks.onResult(stopText);
            } else if (displayId && sendToDisplay) {
                sendToDisplay(displayId, {
                    type: 'voiceCommand',
                    action: 'response',
                    text: stopText,
                    audioUrl: `/uploads/tts/${fileName}`
                });
            }
        } catch (err) {
            console.error('[语音命令] 停止播报TTS失败:', err.message);
        }
        return;
    }

    if (trimmedText.includes('今日提醒') || trimmedText.includes('今天提醒')) {
        await handleTodayReminders(displayId);
        return;
    }
    
    if (trimmedText.includes('明日提醒') || trimmedText.includes('明天提醒')) {
        await handleTomorrowReminders(displayId);
        return;
    }
    
    if (trimmedText.includes('提醒')) {
        await handleReminderCommand(trimmedText, displayId);
        return;
    }
    
    if (trimmedText.includes('报时') || trimmedText.includes('现在几点')) {
        await handleTimeAnnounceCommand(trimmedText, displayId);
        return;
    }
    
    if (trimmedText.includes('天气')) {
        const routing = checkCommandRouting(trimmedText, 'weather');
        if (routing) return routing;
        await handleWeatherCommand(trimmedText, displayId, callbacks);
        return;
    }

    if (trimmedText.includes('搜索')) {
        const routing = checkCommandRouting(trimmedText, 'search');
        if (routing) return routing;
        await handleSearchCommand(trimmedText, displayId);
        return;
    }
    
    if (trimmedText.includes('播放')) {
        await handlePlayCommand(trimmedText, displayId, callbacks);
        return;
    }
    
    const selectionMatch = trimmedText.match(/^第?([一二三四五六七八九十\d]+)[个条]?$/);
    if (selectionMatch) {
        const selection = timeParser.chineseToNumber(selectionMatch[1]) || parseInt(selectionMatch[1]);
        for (const [id, confirmation] of pendingConfirmations) {
            if (confirmation.type === 'play' && confirmation.displayId === displayId) {
                const handled = await handlePlaySelection(id, selection, displayId);
                if (handled) {
                    return;
                }
            }
        }
    }
    
    const assistant = findAssistant(assistantConfig.defaultName);
    if (trimmedText.includes(assistant.name)) {
        const message = trimmedText.replace(assistant.name, '').trim();
        if (message) {
            return { type: 'chat', message, systemPrompt: assistant.template };
        }
    }
    
    return { type: 'chat', message: trimmedText, systemPrompt: assistant.template };
}

function handleSystemCommand(text, displayId) {
    const trimmedText = text.trim();
    
    if (trimmedText === '系统') {
        return { type: 'showHelp' };
    }
    
    if (trimmedText.startsWith('私聊')) {
        const name = trimmedText.substring(2).trim();
        if (name) {
            const assistant = findAssistant(name);
            if (assistant) {
                return { type: 'privateMode', target: name };
            }
        }
        return { type: 'systemMessage', content: '请指定有效的助手名字' };
    }
    
    if (trimmedText === '退出私聊') {
        return { type: 'groupMode' };
    }
    
    const commands = chat.getCommands();
    for (const [keyword, actions] of Object.entries(commands.commands || {})) {
        if (trimmedText.includes(keyword)) {
            return { type: 'commands', keyword, actions };
        }
    }
    
    return null;
}

async function executeCommands(actions, displayId, callbacks, depth = 0) {
    if (depth > 3) {
        console.warn('[语音命令] 指令嵌套深度超过限制');
        return;
    }
    
    for (const action of actions) {
        const result = await processVoiceCommand(action, displayId, null);
        
        if (!result) continue;
        
        if (result.type === 'commands') {
            await executeCommands(result.actions, displayId, callbacks, depth + 1);
        } else if (result.type === 'chat') {
            if (callbacks && callbacks.onChat) {
                callbacks.onChat(result.message, result.systemPrompt);
            }
        } else if (result.type === 'showHelp') {
            if (callbacks && callbacks.onShowHelp) {
                callbacks.onShowHelp();
            }
        } else if (result.type === 'privateMode' || result.type === 'groupMode') {
            if (callbacks && callbacks.onModeChange) {
                callbacks.onModeChange(result.type, result.target);
            }
        } else if (result.type === 'systemMessage') {
            if (callbacks && callbacks.onSystemMessage) {
                callbacks.onSystemMessage(result.content);
            }
        }
    }
}

module.exports = {
    init,
    setClients,
    setMuteFunctions,
    setMediaLibrary,
    processVoiceCommand,
    enqueueVoiceInput,
    handleReminderCommand,
    handleTimeAnnounceCommand,
    handleTodayReminders,
    handleTomorrowReminders,
    handleMuteCommand,
    handleUnmuteCommand,
    handleWeatherCommand,
    handleSearchCommand,
    handlePlayCommand,
    handlePlaySelection,
    executeReminderConfirmation,
    handleCancelCommand,
    getSearchHistory,
    clearSearchHistory,
    deleteSearchHistoryItem,
    getAssistantConfig,
    setAssistantConfig,
    findAssistant,
    parseTimeExpression,
    parseRepeatRule,
    extractReminderContent,
    handleSystemCommand,
    executeCommands,
    setCommandRouting,
    getCommandRouting
};
