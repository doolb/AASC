const path = require('path');
const reminder = require('../reminder/reminder-app-service');
const timeAnnounce = require('../time/time-announce-app-service');
const chat = require('../../../../external/llm/llm-service');
const timeParser = require('../../../../core/utils/time-parser');

const { USER_CONFIG_DIR } = require('../../../server/modules/config/user-config-paths');

const SEARCH_HISTORY_FILE = path.join(USER_CONFIG_DIR, 'search-history.json');

let searchHistory = [];
let pendingConfirmations = new Map();
let displayClients = null;
let sendToDisplay = null;
let broadcastToControls = null;
let mediaLibraryManager = null;
let muteAllDisplays = null;
let unmuteAllDisplays = null;
let timeAnnounceToggle = null;
let voiceInputQueues = new Map();
let ttsRouter = null;

// 内置功能命令定义同时供语音门控和控制端列表使用，避免两处维护不同的命令范围。
const BUILTIN_VOICE_COMMAND_DEFINITIONS = [
    {
        id: 'systemHelp',
        examples: ['系统'],
        description: '播报所有可用的语音指令并显示帮助',
        matcher: text => text === '系统'
    },
    {
        id: 'commandMode',
        examples: ['打开指令模式', '关闭指令模式'],
        description: '开启或关闭指令模式',
        matcher: text => text === '打开指令模式' || text === '关闭指令模式'
    },
    {
        id: 'recording',
        examples: ['开启录音', '关闭录音', '开始录音', '停止录音'],
        description: '开启或关闭显示端语音录音',
        matcher: text => text.includes('开启录音') || text.includes('开始录音')
            || text.includes('关闭录音') || text.includes('停止录音')
    },
    {
        id: 'time',
        examples: ['报时', '现在几点', '开启报时', '关闭报时'],
        description: '播报当前时间',
        matcher: text => text.includes('报时') || text.includes('现在几点')
    },
    {
        id: 'reminder',
        examples: ['提醒{时间} {内容}', '今日提醒', '明日提醒'],
        description: '设置或查看提醒',
        matcher: text => text.includes('今日提醒') || text.includes('今天提醒')
            || text.includes('明日提醒') || text.includes('明天提醒')
            || text.includes('提醒')
    },
    {
        id: 'mute',
        examples: ['静音', '全部静音', '取消静音', '恢复音量'],
        description: '静音或恢复所有显示端音量',
        matcher: text => text === '静音' || text.includes('全部静音')
            || text.includes('取消静音') || text === '恢复音量'
    },
    {
        id: 'weather',
        examples: ['天气', '天气{城市}'],
        description: '查询天气；天气和搜索可按配置交给系统或 LLM 处理',
        matcher: text => text.includes('天气')
    },
    {
        id: 'search',
        examples: ['搜索{关键词}'],
        description: '搜索信息；可按配置交给系统或 LLM 处理',
        matcher: text => text.includes('搜索')
    },
    {
        id: 'play',
        examples: ['播放{文件名}'],
        description: '搜索并播放媒体',
        matcher: text => text.includes('播放')
    },
    {
        id: 'stopTts',
        examples: ['停止播报', '中止播报'],
        description: '停止当前语音播报',
        matcher: text => text.includes('停止播报') || text.includes('中止播报')
    },
    {
        id: 'confirmation',
        examples: ['确认', '确认添加', '是', '好的', '拒绝', '取消'],
        description: '处理待确认或待选择操作',
        matcher: text => text.includes('拒绝') || text.includes('取消')
            || ['确认', '确认添加', '是', '好的'].includes(text)
    }
];

// 指令分级路由
const COMMAND_LEVEL = {
    weather: 'high',
    search: 'high'
};
const COMMAND_LEVEL_DEFAULT = 'low';

let highLevelRouting = {
    weather: 'system',
    search: 'system'
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

// wttr.in 使用 WorldWeatherOnline 的天气编码。接口的 lang_zh 字段偶尔仍返回英文，
// 因此服务端必须保留编码映射，不能把接口语言字段当作可靠的中文来源。
const WEATHER_CODE_LABELS = {
    113: '晴',
    116: '局部多云',
    119: '阴',
    122: '阴',
    143: '雾',
    149: '霾',
    176: '小雨',
    179: '雨夹雪',
    182: '雨夹雪',
    185: '雨夹雪',
    200: '雷雨',
    227: '吹雪',
    230: '暴雪',
    248: '雾',
    260: '冻雾',
    263: '零星小雨',
    266: '小雨',
    281: '冻雨',
    284: '冻雨',
    293: '局部小雨',
    296: '小雨',
    299: '中雨',
    302: '中雨',
    305: '大雨',
    308: '大雨',
    311: '冻雨',
    314: '冻雨',
    317: '雨夹雪',
    320: '雨夹雪',
    323: '小雪',
    326: '小雪',
    329: '中雪',
    332: '中雪',
    335: '大雪',
    338: '大雪',
    350: '冰粒',
    353: '阵雨',
    356: '中雨',
    359: '暴雨',
    362: '雨夹雪',
    365: '雨夹雪',
    368: '小雪',
    371: '中雪',
    374: '雨夹冰粒',
    377: '雨夹冰粒',
    386: '雷阵雨',
    389: '雷暴',
    392: '雷阵雪',
    395: '暴雪'
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

function setTimeAnnounceToggle(fn) {
    timeAnnounceToggle = fn;
}

// TTS 由服务端统一注入，语音命令服务只负责描述播报内容和界面动作。
// 这样显示端语音输入不会把生成结果默认发回触发输入的显示端。
function setTtsRouter(router) {
    ttsRouter = router && typeof router.speak === 'function' ? router : null;
}

function setMediaLibrary(manager) {
    mediaLibraryManager = manager;
}

function isBuiltinVoiceCommand(text) {
    const cmdText = String(text || '')
        .trim()
        .replace(/[。，！？、；：,.!?;:]+$/gu, '');
    if (!cmdText) return false;
    return BUILTIN_VOICE_COMMAND_DEFINITIONS.some(command => command.matcher(cmdText));
}

function getBuiltinVoiceCommands() {
    return BUILTIN_VOICE_COMMAND_DEFINITIONS.map(({ matcher, ...command }) => ({
        ...command,
        wakeRequired: false
    }));
}

// 统一生成“系统”语音帮助，始终从当前内置和自定义指令配置读取，避免帮助内容过期。
function getVoiceCommandHelpText(commandConfig = chat.getCommands()) {
    const builtinHelp = getBuiltinVoiceCommands().map(command =>
        `说${command.examples.join('、')}，${command.description}`
    );
    const customHelp = Object.entries(commandConfig?.commands || {})
        .filter(([keyword]) => keyword !== '系统')
        .map(([keyword, actions]) => {
            const actionList = Array.isArray(actions)
                ? actions.map(action => String(action || '').trim()).filter(Boolean)
                : [];
            return actionList.length > 0
                ? `说${keyword}，执行${actionList.join('、')}`
                : `说${keyword}`;
        });

    const sections = [
        '系统指令帮助',
        ...builtinHelp,
        '说你好加助手名字或助手名字你好，唤醒进入群聊',
        '说私聊加助手名字，进入私聊模式',
        '说退出私聊，退出私聊模式',
        '说结束对话，结束当前语音对话',
        '说系统记录加内容，保存重要记录'
    ];
    if (customHelp.length > 0) {
        sections.push(`自定义指令：${customHelp.join('；')}`);
    }
    return `${sections.join('。')}。`;
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
            let cityText = text.replace(/天气/g, '').replace(/[。，！？、；：,.!?;:]+$/, '').trim();
            if (cityText) {
                const cityList = Array.isArray(assistantConfig.weatherCities) && assistantConfig.weatherCities.length > 0
                    ? assistantConfig.weatherCities
                    : DEFAULT_WEATHER_CITIES;
                const hasCity = cityList.some(city => cityText.includes(city));
                if (!hasCity && assistantConfig.defaultWeatherCity) {
                    cityText = assistantConfig.defaultWeatherCity + cityText;
                }
                llmQuery = `查询${cityText}的天气`;
            } else {
                llmQuery = assistantConfig.defaultWeatherCity
                    ? `查询${assistantConfig.defaultWeatherCity}今天的天气`
                    : '查询今天的天气';
            }
            break;
        case 'search':
            const keyword = text.replace(/搜索/g, '').trim();
            llmQuery = keyword ? `搜索：${keyword}` : '帮我搜索一些信息';
            break;
        default:
            llmQuery = text;
    }

    const defaultAssistant = findAssistant(assistantConfig.defaultName);
    return { type: 'chat', message: llmQuery, systemPrompt: defaultAssistant.template, skipHistory: true };
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

async function speakVoiceResponse(displayId, text, action = 'response', extra = {}, callbacks = null) {
    if (!text) return false;

    // 控制端播放仍由原有 onResult 回调处理，避免改变控制端播放协议。
    if (callbacks && callbacks.onResult) {
        await callbacks.onResult(text);
        return true;
    }

    // 显示端语音输入通过 onTts 进入服务端通用 TTS 生成和目标选择流程。
    if (callbacks && callbacks.onTts) {
        await callbacks.onTts(text);
        if (displayId && sendToDisplay) {
            sendToDisplay(displayId, {
                type: 'voiceCommand',
                action,
                text,
                ...extra
            });
        }
        return true;
    }

    // 兼容非 processVoiceCommand 调用方，由服务端注入的定向路由负责旧行为。
    if (ttsRouter) {
        return ttsRouter.speak({ displayId, text, action, extra });
    }

    return false;
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

async function handleReminderCommand(text, displayId, callbacks) {
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
        callbacks: callbacks,
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
        await speakVoiceResponse(displayId, confirmText, 'confirm', {
            confirmationId
        }, callbacks);
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
                await speakVoiceResponse(
                    confirmation.displayId,
                    successText,
                    'response',
                    {},
                    confirmation.callbacks
                );
            } catch (err) {
                console.error('[语音命令] 提醒成功语音生成失败:', err.message);
            }
        }
        return true;
    }

    if (confirmation.displayId) {
        try {
            await speakVoiceResponse(
                confirmation.displayId,
                '好的，已取消这次提醒',
                'response',
                {},
                confirmation.callbacks
            );
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

async function handleTimeAnnounceCommand(text, displayId, callbacks) {
    if (text.includes('关闭报时')) {
        if (timeAnnounceToggle) await timeAnnounceToggle(false);
        const responseText = '已关闭报时功能';

        try {
            await speakVoiceResponse(displayId, responseText, 'response', {}, callbacks);
        } catch (err) {
            console.error('[语音命令] 报时语音生成失败:', err.message);
        }
    } else if (text.includes('开启报时')) {
        if (timeAnnounceToggle) await timeAnnounceToggle(true);
        const responseText = '已开启报时功能';

        try {
            await speakVoiceResponse(displayId, responseText, 'response', {}, callbacks);
        } catch (err) {
            console.error('[语音命令] 报时语音生成失败:', err.message);
        }
    } else {
        try {
            const timeText = timeAnnounce.generateTimeText();
            await speakVoiceResponse(displayId, timeText, 'response', {}, callbacks);
        } catch (err) {
            console.error('[语音命令] 报时语音生成失败:', err.message);
        }
    }
}

async function handleRecordingCommand(text, displayId, callbacks) {
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
        await speakVoiceResponse(
            displayId,
            shouldEnable ? '已开启录音' : '已关闭录音',
            'response',
            {},
            callbacks
        );
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

async function handleTodayReminders(displayId, callbacks) {
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
        await speakVoiceResponse(displayId, responseText, 'response', {}, callbacks);
    } catch (err) {
        console.error('[语音命令] 今日提醒语音生成失败:', err.message);
    }
}

async function handleTomorrowReminders(displayId, callbacks) {
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
        await speakVoiceResponse(displayId, responseText, 'response', {}, callbacks);
    } catch (err) {
        console.error('[语音命令] 明日提醒语音生成失败:', err.message);
    }
}

async function handleMuteCommand(displayId, callbacks) {
    if (!muteAllDisplays) {
        const responseText = '静音功能不可用';
        try {
            await speakVoiceResponse(displayId, responseText, 'response', {}, callbacks);
        } catch (err) {
            console.error('[语音命令] 静音语音生成失败:', err.message);
        }
        return;
    }
    
    const result = muteAllDisplays();
    const responseText = result ? '已静音所有显示端' : '已经是静音状态';
    
    try {
        await speakVoiceResponse(displayId, responseText, 'response', {}, callbacks);
    } catch (err) {
        console.error('[语音命令] 静音语音生成失败:', err.message);
    }
}

async function handleUnmuteCommand(displayId, callbacks) {
    if (!unmuteAllDisplays) {
        const responseText = '取消静音功能不可用';
        try {
            await speakVoiceResponse(displayId, responseText, 'response', {}, callbacks);
        } catch (err) {
            console.error('[语音命令] 取消静音语音生成失败:', err.message);
        }
        return;
    }
    
    const result = unmuteAllDisplays();
    const responseText = result ? '已取消静音' : '当前不是静音状态';
    
    try {
        await speakVoiceResponse(displayId, responseText, 'response', {}, callbacks);
    } catch (err) {
        console.error('[语音命令] 取消静音语音生成失败:', err.message);
    }
}

async function handlePlayCommand(text, displayId, callbacks) {
    let fileName = text.replace(/播放/, '').trim();
    
    if (!fileName) {
        const responseText = '请问您要播放什么文件？';
        if (callbacks && callbacks.onResult) {
            await callbacks.onResult(responseText);
        } else if (callbacks && callbacks.onTts) {
            await speakVoiceResponse(displayId, responseText, 'response', {}, callbacks);
        } else if (displayId && sendToDisplay) {
            await speakVoiceResponse(displayId, responseText, 'response', {}, callbacks);
        }
        return;
    }
    
    console.log(`[播放命令] 搜索文件: ${fileName}`);
    
    const matches = await searchMediaFiles(fileName);
    
    if (matches.length === 0) {
        const responseText = `没有找到名为"${fileName}"的文件`;
        if (callbacks && callbacks.onResult) {
            await callbacks.onResult(responseText);
        } else if (callbacks && callbacks.onTts) {
            await speakVoiceResponse(displayId, responseText, 'response', {}, callbacks);
        } else if (displayId && sendToDisplay) {
            await speakVoiceResponse(displayId, responseText, 'response', {}, callbacks);
        }
        return;
    }
    
    if (matches.length === 1) {
        const file = matches[0];
        const responseText = `正在播放${file.name}`;
        
        if (callbacks && callbacks.onResult) {
            await callbacks.onResult(responseText);
        } else if (callbacks && callbacks.onTts) {
            await speakVoiceResponse(displayId, responseText, 'response', {}, callbacks);
        }
        
        if (displayId && sendToDisplay) {
            sendToDisplay(displayId, {
                type: 'media',
                url: file.url,
                mediaType: file.mediaType,
                name: file.name
            });
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
        await callbacks.onResult(responseText);
    } else if (callbacks && callbacks.onTts) {
        await speakVoiceResponse(displayId, responseText, 'playChoices', {
            confirmationId,
            matches: matches.slice(0, 5)
        }, callbacks);
    }

    if (displayId && sendToDisplay && !callbacks?.onTts) {
        await speakVoiceResponse(displayId, responseText, 'playChoices', {
            confirmationId,
            matches: matches.slice(0, 5)
        }, callbacks);
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
        await callbacks.onResult(responseText);
    } else if (callbacks && callbacks.onTts) {
        await speakVoiceResponse(displayId, responseText, 'response', {}, callbacks);
    }
    
    if (displayId && sendToDisplay) {
        sendToDisplay(displayId, {
            type: 'media',
            url: file.url,
            mediaType: file.mediaType,
            name: file.name
        });
    }
    
    return true;
}

// 读取 wttr.in 的数组包装值，统一处理字段缺失、空字符串和 { value } 结构。
function getWeatherValue(value) {
    if (Array.isArray(value)) {
        return getWeatherValue(value[0]);
    }
    if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')) {
        return getWeatherValue(value.value);
    }
    if (value === undefined || value === null || value === '') {
        return null;
    }
    return value;
}

function getWeatherText(value) {
    const text = getWeatherValue(value);
    if (text === null) return null;
    const normalized = String(text).trim();
    return normalized || null;
}

function getWeatherNumber(value) {
    const rawValue = getWeatherValue(value);
    if (rawValue === null) return null;
    const number = Number(rawValue);
    return Number.isFinite(number) ? number : null;
}

function isEnglishWeatherText(text) {
    return Boolean(text) && /^[A-Za-z][A-Za-z\s-]*$/u.test(text);
}

function getWeatherCondition(source) {
    const weatherCode = getWeatherNumber(source?.weatherCode);
    const translatedText = getWeatherText(source?.lang_zh);
    const originalText = getWeatherText(source?.weatherDesc);
    const mappedText = WEATHER_CODE_LABELS[weatherCode];

    if (mappedText && (!translatedText || isEnglishWeatherText(translatedText))) {
        return mappedText;
    }
    return translatedText || mappedText || originalText || '未知天气';
}

function normalizeWeatherWind(source) {
    const direction = getWeatherText(source?.winddir16Point);
    const degree = getWeatherNumber(source?.winddirDegree);
    const speedKmph = getWeatherNumber(source?.windspeedKmph);
    const gustKmph = getWeatherNumber(source?.WindGustKmph);

    if (direction === null && degree === null && speedKmph === null && gustKmph === null) {
        return null;
    }

    return { direction, degree, speedKmph, gustKmph };
}

function normalizeWeatherAstronomy(source) {
    if (!source) return null;

    return {
        sunrise: getWeatherText(source.sunrise),
        sunset: getWeatherText(source.sunset),
        moonrise: getWeatherText(source.moonrise),
        moonset: getWeatherText(source.moonset),
        moonPhase: getWeatherText(source.moon_phase),
        moonIlluminationPercent: getWeatherNumber(source.moon_illumination)
    };
}

function normalizeWeatherHourly(source) {
    const weatherCode = getWeatherNumber(source?.weatherCode);
    return {
        time: getWeatherText(source?.time),
        temperatureC: getWeatherNumber(source?.tempC),
        feelsLikeC: getWeatherNumber(source?.FeelsLikeC),
        humidityPercent: getWeatherNumber(source?.humidity),
        condition: getWeatherCondition(source || {}),
        weatherCode,
        chanceOfRainPercent: getWeatherNumber(source?.chanceofrain),
        chanceOfFogPercent: getWeatherNumber(source?.chanceoffog),
        chanceOfSnowPercent: getWeatherNumber(source?.chanceofsnow),
        chanceOfSunshinePercent: getWeatherNumber(source?.chanceofsunshine),
        precipitationMm: getWeatherNumber(source?.precipMM),
        uvIndex: getWeatherNumber(source?.uvIndex),
        visibilityKm: getWeatherNumber(source?.visibility),
        cloudCoverPercent: getWeatherNumber(source?.cloudcover),
        wind: normalizeWeatherWind(source || {})
    };
}

function getMaximumWeatherNumber(items, field) {
    const numbers = items
        .map(item => item[field])
        .filter(value => value !== null);
    return numbers.length > 0 ? Math.max(...numbers) : null;
}

function getTotalWeatherNumber(items, field) {
    const numbers = items
        .map(item => item[field])
        .filter(value => value !== null);
    return numbers.length > 0 ? numbers.reduce((total, value) => total + value, 0) : null;
}

function normalizeWeatherDay(source) {
    const hourly = Array.isArray(source?.hourly)
        ? source.hourly.map(normalizeWeatherHourly)
        : [];

    return {
        date: getWeatherText(source?.date),
        maxTemperatureC: getWeatherNumber(source?.maxtempC),
        minTemperatureC: getWeatherNumber(source?.mintempC),
        averageTemperatureC: getWeatherNumber(source?.avgtempC),
        sunHour: getWeatherNumber(source?.sunHour),
        totalSnowCm: getWeatherNumber(source?.totalSnow_cm),
        uvIndex: getWeatherNumber(source?.uvIndex),
        condition: hourly.find(item => item.condition && item.condition !== '未知天气')?.condition || '未知天气',
        maxChanceOfRainPercent: getMaximumWeatherNumber(hourly, 'chanceOfRainPercent'),
        totalPrecipitationMm: getTotalWeatherNumber(hourly, 'precipitationMm'),
        astronomy: normalizeWeatherAstronomy(getWeatherValue(source?.astronomy)),
        hourly
    };
}

function normalizeWeatherCurrent(source) {
    return {
        observationTime: getWeatherText(source?.observation_time),
        temperatureC: getWeatherNumber(source?.temp_C),
        feelsLikeC: getWeatherNumber(source?.FeelsLikeC),
        humidityPercent: getWeatherNumber(source?.humidity),
        pressureHpa: getWeatherNumber(source?.pressure),
        visibilityKm: getWeatherNumber(source?.visibility),
        condition: getWeatherCondition(source || {}),
        weatherCode: getWeatherNumber(source?.weatherCode),
        cloudCoverPercent: getWeatherNumber(source?.cloudcover),
        precipitationMm: getWeatherNumber(source?.precipMM),
        uvIndex: getWeatherNumber(source?.uvIndex),
        iconUrl: getWeatherText(source?.weatherIconUrl),
        wind: normalizeWeatherWind(source || {})
    };
}

function normalizeWeatherData(data, fallbackCity = '') {
    const nearestArea = getWeatherValue(data?.nearest_area) || {};
    const currentSource = getWeatherValue(data?.current_condition) || {};
    const weatherDays = Array.isArray(data?.weather) ? data.weather.slice(0, 3) : [];

    return {
        location: {
            name: getWeatherText(nearestArea.areaName) || fallbackCity || '本地',
            country: getWeatherText(nearestArea.country),
            region: getWeatherText(nearestArea.region),
            latitude: getWeatherNumber(nearestArea.latitude),
            longitude: getWeatherNumber(nearestArea.longitude)
        },
        current: normalizeWeatherCurrent(currentSource),
        forecast: weatherDays.map(normalizeWeatherDay),
        request: getWeatherValue(data?.request)
    };
}

function formatWeatherMetric(value, unit = '') {
    return value === null ? '未知' : `${value}${unit}`;
}

// wttr.in 的 hourly.time 通常是 0、300、600 这种 HHMM 数字字符串，
// 转成标准时刻后再拼接，避免把 300 播报成“300时”。
function formatWeatherHourLabel(value) {
    if (value === null) return '未知时间';
    const text = String(value).trim();
    if (!/^\d{1,4}$/u.test(text)) return text;
    const padded = text.padStart(4, '0');
    return `${padded.slice(0, 2)}:${padded.slice(2)}`;
}

function formatWeatherWind(wind) {
    if (!wind) return '风向未知，风速未知';
    const direction = wind.direction || (wind.degree === null ? '未知' : `${wind.degree}度`);
    const speed = formatWeatherMetric(wind.speedKmph, '公里每小时');
    const gust = wind.gustKmph === null ? '' : `，阵风${wind.gustKmph}公里每小时`;
    return `风向${direction}，风速${speed}${gust}`;
}

function formatWeatherAstronomy(astronomy) {
    if (!astronomy) return '天文信息未知';
    return [
        `日出${astronomy.sunrise || '未知'}`,
        `日落${astronomy.sunset || '未知'}`,
        `月出${astronomy.moonrise || '未知'}`,
        `月落${astronomy.moonset || '未知'}`,
        `月相${astronomy.moonPhase || '未知'}`,
        `月亮照明${formatWeatherMetric(astronomy.moonIlluminationPercent, '%')}`
    ].join('，');
}

function formatWeatherHourly(hourly) {
    const time = formatWeatherHourLabel(hourly.time);
    return `${time}时${hourly.condition}，温度${formatWeatherMetric(hourly.temperatureC, '℃')}，体感${formatWeatherMetric(hourly.feelsLikeC, '℃')}，湿度${formatWeatherMetric(hourly.humidityPercent, '%')}，降雨概率${formatWeatherMetric(hourly.chanceOfRainPercent, '%')}，降雾概率${formatWeatherMetric(hourly.chanceOfFogPercent, '%')}，降雪概率${formatWeatherMetric(hourly.chanceOfSnowPercent, '%')}，日照概率${formatWeatherMetric(hourly.chanceOfSunshinePercent, '%')}，降水${formatWeatherMetric(hourly.precipitationMm, '毫米')}，紫外线${formatWeatherMetric(hourly.uvIndex)}，能见度${formatWeatherMetric(hourly.visibilityKm, '公里')}，${formatWeatherWind(hourly.wind)}`;
}

function formatWeatherDayDetail(day, includeHourly) {
    const dailyText = `${day.date || '未知日期'}：${day.condition}，最高${formatWeatherMetric(day.maxTemperatureC, '℃')}，最低${formatWeatherMetric(day.minTemperatureC, '℃')}，平均${formatWeatherMetric(day.averageTemperatureC, '℃')}，日照${formatWeatherMetric(day.sunHour, '小时')}，降雪${formatWeatherMetric(day.totalSnowCm, '厘米')}，紫外线${formatWeatherMetric(day.uvIndex)}，最高降雨概率${formatWeatherMetric(day.maxChanceOfRainPercent, '%')}，预计降水${formatWeatherMetric(day.totalPrecipitationMm, '毫米')}；${formatWeatherAstronomy(day.astronomy)}`;
    if (!includeHourly) return dailyText;

    const hourlyText = day.hourly.length > 0
        ? day.hourly.map(formatWeatherHourly).join('；')
        : '无逐时数据';
    return `${dailyText}；逐时预报：${hourlyText}`;
}

function formatWeatherDetail(weather) {
    const current = weather.current;
    const location = weather.location.name;
    const currentText = [
        `${location}当前天气：${current.condition}`,
        `温度${formatWeatherMetric(current.temperatureC, '℃')}`,
        `体感${formatWeatherMetric(current.feelsLikeC, '℃')}`,
        `湿度${formatWeatherMetric(current.humidityPercent, '%')}`,
        `气压${formatWeatherMetric(current.pressureHpa, '百帕')}`,
        `能见度${formatWeatherMetric(current.visibilityKm, '公里')}`,
        formatWeatherWind(current.wind),
        `天气编码${formatWeatherMetric(current.weatherCode)}`,
        `云量${formatWeatherMetric(current.cloudCoverPercent, '%')}`,
        `降水${formatWeatherMetric(current.precipitationMm, '毫米')}`,
        `紫外线${formatWeatherMetric(current.uvIndex)}`,
        `观测时间${current.observationTime || '未知'}`
    ].join('，');
    const forecastText = weather.forecast.length > 0
        // wttr.in 按日期顺序返回预报，第一天就是今日；未来日期只保留逐日和天文信息。
        ? weather.forecast.map((day, index) => formatWeatherDayDetail(day, index === 0)).join('\n')
        : '暂无未来预报数据';

    return `${currentText}\n未来${weather.forecast.length}天预报：\n${forecastText}`;
}

function formatWeatherSpeech(weather) {
    const current = weather.current;
    const dailyText = weather.forecast.length > 0
        ? weather.forecast.map(day => `${day.date || '未来日期'}${day.condition}，${formatWeatherMetric(day.minTemperatureC, '℃')}到${formatWeatherMetric(day.maxTemperatureC, '℃')}，降雨概率最高${formatWeatherMetric(day.maxChanceOfRainPercent, '%')}`).join('；')
        : '暂无未来预报';

    return `${weather.location.name}当前天气：${current.condition}，温度${formatWeatherMetric(current.temperatureC, '℃')}，体感${formatWeatherMetric(current.feelsLikeC, '℃')}，湿度${formatWeatherMetric(current.humidityPercent, '%')}。未来${weather.forecast.length}天：${dailyText}。`;
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
        const normalizedWeather = normalizeWeatherData(data, cityName);
        const fallbackText = weatherRequest.usedDefault && weatherRequest.requestedCity
            ? `没有找到${weatherRequest.requestedCity}，为你播报默认城市${cityName}的天气。`
            : '';
        const detailText = `${fallbackText}${formatWeatherDetail(normalizedWeather)}`;
        const speechText = `${fallbackText}${formatWeatherSpeech(normalizedWeather)}`;
        
        if (callbacks && callbacks.onResult) {
            await callbacks.onResult(detailText);
        } else if (callbacks && callbacks.onTts) {
            await speakVoiceResponse(displayId, speechText, 'weatherResult', {
                detailText,
                weather: normalizedWeather
            }, callbacks);
        } else if (displayId && sendToDisplay) {
            await speakVoiceResponse(displayId, speechText, 'weatherResult', {
                detailText,
                weather: normalizedWeather
            }, callbacks);
        }
    } catch (err) {
        console.error('[语音命令] 获取天气失败:', err.message);
        const errorText = '获取天气失败，天气服务暂时不可用，请稍后再试';
        if (callbacks && callbacks.onError) {
            await callbacks.onError(errorText);
        } else if (callbacks && callbacks.onTts) {
            await speakVoiceResponse(displayId, errorText, 'response', {}, callbacks);
        } else if (displayId && sendToDisplay) {
            await speakVoiceResponse(displayId, errorText, 'response', {}, callbacks);
        }
    }
}

async function handleSearchCommand(text, displayId, callbacks) {
    let query = text.replace(/搜索/, '').trim();
    
    if (!query) {
        if (displayId && sendToDisplay) {
            const responseText = '请问您要搜索什么？';
            try {
                await speakVoiceResponse(displayId, responseText, 'response', {}, callbacks);
            } catch (err) {
                console.error('[语音命令] 搜索语音生成失败:', err.message);
            }
        }
        return;
    }
    
    if (displayId && sendToDisplay) {
        const searchingText = `正在搜索${query}`;
        try {
            await speakVoiceResponse(displayId, searchingText, 'response', {}, callbacks);
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
            await speakVoiceResponse(displayId, responseText, 'searchResult', {
                query,
                results
            }, callbacks);
        }
    } catch (err) {
        console.error('[语音命令] 搜索失败:', err.message);
        if (displayId && sendToDisplay) {
            const errorText = '搜索失败，请稍后再试';
            try {
                await speakVoiceResponse(displayId, errorText, 'response', {}, callbacks);
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

function findAddressedGroupAssistant(text, assistantNames = []) {
    const normalizedText = String(text || '').trim();
    const configuredNames = Array.isArray(assistantConfig.assistants)
        ? assistantConfig.assistants.map(assistant => assistant.name)
        : [];
    const names = [...new Set([...configuredNames, ...assistantNames].filter(Boolean))];
    return names.find(name => normalizedText.includes(name)
        && normalizedText.replace(name, '').trim()) || null;
}

async function processVoiceCommand(text, displayId, callbacks, internal = false, options = {}) {
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

    const session = chat.getSession();
    const addressedAssistant = !internal && session.mode !== 'private'
        ? findAddressedGroupAssistant(trimmedText, options.groupAssistantNames)
        : null;
    if (addressedAssistant) {
        return { type: 'chat', message: trimmedText, mode: 'group' };
    }

    // 第一步：系统指令始终优先执行
    const systemResult = handleSystemCommand(cmdText, displayId);
    if (systemResult) {
        return systemResult;
    }

    // 第二步：指令模式过滤（组合指令的子动作跳过此检查）
    if (!internal && session.commandMode === true && options.conversationActive !== true) {
        if (session.mode === 'private') {
            const assistant = findAssistant(session.privateTarget);
            return { type: 'chat', message: trimmedText, systemPrompt: assistant.template };
        }

        if (!isBuiltinVoiceCommand(cmdText)) {
            return;
        }
    }
    
    if (trimmedText.includes('拒绝') || trimmedText.includes('取消')) {
        const cancelled = handleCancelCommand(trimmedText, displayId);
        if (cancelled) {
            const responseText = '好的，已取消';
            try {
                await speakVoiceResponse(displayId, responseText, 'response', {}, callbacks);
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
        const handledRecording = await handleRecordingCommand(trimmedText, displayId, callbacks);
        if (handledRecording) {
            return;
        }
    }
    
    if (cmdText === '静音' || trimmedText.includes('全部静音')) {
        await handleMuteCommand(displayId, callbacks);
        return;
    }
    
    if (trimmedText.includes('取消静音') || cmdText === '恢复音量') {
        await handleUnmuteCommand(displayId, callbacks);
        return;
    }

    // 停止播报
    if (trimmedText.includes('停止播报') || trimmedText.includes('中止播报')) {
        if (callbacks && callbacks.onStop) {
            await callbacks.onStop();
        } else if (sendToDisplay && displayId) {
            sendToDisplay(displayId, { type: 'tts', action: 'stop' });
        }
        const stopText = '已停止播报';
        try {
            await speakVoiceResponse(displayId, stopText, 'response', {}, callbacks);
        } catch (err) {
            console.error('[语音命令] 停止播报TTS失败:', err.message);
        }
        return;
    }

    if (trimmedText.includes('今日提醒') || trimmedText.includes('今天提醒')) {
        await handleTodayReminders(displayId, callbacks);
        return;
    }
    
    if (trimmedText.includes('明日提醒') || trimmedText.includes('明天提醒')) {
        await handleTomorrowReminders(displayId, callbacks);
        return;
    }
    
    if (trimmedText.includes('提醒')) {
        await handleReminderCommand(trimmedText, displayId, callbacks);
        return;
    }
    
    if (trimmedText.includes('报时') || trimmedText.includes('现在几点')) {
        await handleTimeAnnounceCommand(trimmedText, displayId, callbacks);
        return;
    }
    
    if (trimmedText.includes('搜索')) {
        const routing = checkCommandRouting(trimmedText, 'search');
        if (routing) return routing;
        await handleSearchCommand(trimmedText, displayId, callbacks);
        return;
    }

    if (trimmedText.includes('天气')) {
        const routing = checkCommandRouting(trimmedText, 'weather');
        if (routing) return routing;
        await handleWeatherCommand(trimmedText, displayId, callbacks);
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
    
    // 私聊仍支持用助手名前缀切换到对应模板；群聊已在前面保留原始消息处理。
    if (session.mode === 'private') {
        for (const a of assistantConfig.assistants) {
            if (trimmedText.includes(a.name)) {
                const message = trimmedText.replace(a.name, '').trim();
                if (message) {
                    return { type: 'chat', message, systemPrompt: a.template, mode: 'private' };
                }
                return;
            }
        }
    }

    const defaultAssistant = findAssistant(assistantConfig.defaultName);
    return {
        type: 'chat',
        message: trimmedText,
        mode: session.mode === 'private' ? 'private' : 'group',
        systemPrompt: session.mode === 'private' ? defaultAssistant.template : undefined
    };
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
        const result = await processVoiceCommand(action, displayId, callbacks, true);
        
        if (!result) continue;
        
        if (result.type === 'commands') {
            await executeCommands(result.actions, displayId, callbacks, depth + 1);
        } else if (result.type === 'chat') {
            if (callbacks && callbacks.onChat) {
                callbacks.onChat(result.message, result.systemPrompt, result.skipHistory);
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
    setTimeAnnounceToggle,
    setTtsRouter,
    setMediaLibrary,
    isBuiltinVoiceCommand,
    getBuiltinVoiceCommands,
    getVoiceCommandHelpText,
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
    normalizeWeatherData,
    formatWeatherDetail,
    formatWeatherSpeech,
    parseTimeExpression,
    parseRepeatRule,
    extractReminderContent,
    handleSystemCommand,
    executeCommands,
    setCommandRouting,
    getCommandRouting
};
