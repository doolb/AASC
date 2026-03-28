const tts = require('./tts');

let timeAnnounceConfig = {
    enabled: true,
    interval: 15,
    repeatCount: 3,
    repeatDelay: 3000
};

let lastAnnounceMinute = -1;
let announceTimer = null;

function init(config) {
    if (config) {
        if (config.enabled !== undefined) timeAnnounceConfig.enabled = config.enabled;
        if (config.interval !== undefined) timeAnnounceConfig.interval = config.interval;
        if (config.repeatCount !== undefined) timeAnnounceConfig.repeatCount = config.repeatCount;
        if (config.repeatDelay !== undefined) timeAnnounceConfig.repeatDelay = config.repeatDelay;
    }
    console.log(`[整点报时] 状态: ${timeAnnounceConfig.enabled ? '启用' : '禁用'}`);
    console.log(`[整点报时] 间隔: ${timeAnnounceConfig.interval}分钟`);
    console.log(`[整点报时] 重复次数: ${timeAnnounceConfig.repeatCount}次`);
}

function getConfig() {
    return { ...timeAnnounceConfig };
}

function setConfig(config) {
    if (config.enabled !== undefined) timeAnnounceConfig.enabled = config.enabled;
    if (config.interval !== undefined) timeAnnounceConfig.interval = config.interval;
    if (config.repeatCount !== undefined) timeAnnounceConfig.repeatCount = config.repeatCount;
    if (config.repeatDelay !== undefined) timeAnnounceConfig.repeatDelay = config.repeatDelay;
}

function shouldAnnounce() {
    if (!timeAnnounceConfig.enabled) return false;
    
    const now = new Date();
    const minute = now.getMinutes();
    
    if (minute === lastAnnounceMinute) return false;
    
    if (timeAnnounceConfig.interval === 60) {
        return minute === 0;
    } else if (timeAnnounceConfig.interval === 30) {
        return minute === 0 || minute === 30;
    } else if (timeAnnounceConfig.interval === 15) {
        return minute === 0 || minute === 15 || minute === 30 || minute === 45;
    }
    
    return false;
}

function generateTimeText() {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    
    let period = '';
    if (hour >= 0 && hour < 6) {
        period = '凌晨';
    } else if (hour >= 6 && hour < 9) {
        period = '早上';
    } else if (hour >= 9 && hour < 12) {
        period = '上午';
    } else if (hour >= 12 && hour < 14) {
        period = '中午';
    } else if (hour >= 14 && hour < 18) {
        period = '下午';
    } else if (hour >= 18 && hour < 22) {
        period = '晚上';
    } else {
        period = '深夜';
    }
    
    let displayHour = hour;
    if (hour > 12) {
        displayHour = hour - 12;
    } else if (hour === 0) {
        displayHour = 12;
    }
    
    let timeText = '';
    if (minute === 0) {
        timeText = `${period}${displayHour}点整`;
    } else {
        timeText = `${period}${displayHour}点${minute}分`;
    }
    
    return `现在时间是${timeText}`;
}

async function checkAndAnnounce(displayClients, sendToDisplay, force = false) {
    if (!force && !shouldAnnounce()) return;
    
    const now = new Date();
    const minute = now.getMinutes();
    lastAnnounceMinute = minute;
    
    const timeText = generateTimeText();
    console.log(`[整点报时] ${timeText}`);
    
    try {
        await tts.generateTTS(timeText);
        
        const announceData = {
            type: 'tts',
            action: 'playAudio',
            audioUrl: '/uploads/temp_tts.wav?t=' + Date.now(),
            text: timeText
        };
        
        if (displayClients && sendToDisplay) {
            const repeatCount = timeAnnounceConfig.repeatCount || 1;
            const repeatDelay = timeAnnounceConfig.repeatDelay || 3000;
            
            for (let i = 0; i < repeatCount; i++) {
                displayClients.forEach((displayData, displayId) => {
                    sendToDisplay(displayId, {
                        ...announceData,
                        audioUrl: '/uploads/temp_tts.wav?t=' + Date.now() + '&r=' + i
                    });
                });
                
                if (i < repeatCount - 1) {
                    await new Promise(resolve => setTimeout(resolve, repeatDelay));
                }
            }
        }
        
        return true;
    } catch (err) {
        console.error('[整点报时] 生成语音失败:', err.message);
        return false;
    }
}

function start(displayClients, sendToDisplay) {
    if (announceTimer) {
        clearInterval(announceTimer);
    }
    
    announceTimer = setInterval(() => {
        checkAndAnnounce(displayClients, sendToDisplay);
    }, 60000);
    
    checkAndAnnounce(displayClients, sendToDisplay);
    
    console.log('[整点报时] 定时器已启动');
}

function stop() {
    if (announceTimer) {
        clearInterval(announceTimer);
        announceTimer = null;
        console.log('[整点报时] 定时器已停止');
    }
}

module.exports = {
    init,
    getConfig,
    setConfig,
    start,
    stop,
    checkAndAnnounce,
    generateTimeText,
    shouldAnnounce
};
