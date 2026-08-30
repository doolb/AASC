const path = require('path');
const tts = require('../../../../external/tts/tts-service');
const timeListener = require('./time-listener-app-service');

let timeAnnounceConfig = {
    enabled: true,
    interval: 15,
    repeatCount: 3,
    repeatDelay: 3000
};

let lastAnnounceMinute = -1;
let displayClientsRef = null;
let sendToDisplayRef = null;

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

function shouldAnnounce(minute) {
    if (!timeAnnounceConfig.enabled) return false;
    
    if (minute === lastAnnounceMinute) return false;
    
    switch (timeAnnounceConfig.interval) {
        case 60:
            return minute === 0;
        case 30:
            return minute === 0 || minute === 30;
        case 15:
            return minute === 0 || minute === 15 || minute === 30 || minute === 45;
        default:
            return false;
    }
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
    const now = new Date();
    const minute = now.getMinutes();
    
    if (!force && !shouldAnnounce(minute)) return;
    
    lastAnnounceMinute = minute;
    
    const timeText = generateTimeText();
    console.log(`[整点报时] ${timeText}`);
    
    const clients = displayClients || displayClientsRef;
    const send = sendToDisplay || sendToDisplayRef;
    
    if (!clients || clients.size === 0) {
        console.warn('[整点报时] 没有连接的显示端，无法播放');
        return false;
    }
    
    console.log(`[整点报时] 将发送到 ${clients.size} 个显示端`);
    
    try {
        const audioPath = await tts.generateTTS(timeText);
        const fileName = path.basename(audioPath);
        const repeatCount = timeAnnounceConfig.repeatCount || 1;
        const repeatDelay = timeAnnounceConfig.repeatDelay || 3000;
        
        const announceData = {
            type: 'tts',
            action: 'playAudio',
            audioUrl: `/uploads/tts/${fileName}`,
            text: timeText,
            // 兼容旧的 Agent/服务调用：重复报时作为一个 TTS 播放组协调录音暂停。
            voiceTtsPlaybackRepeatCount: repeatCount
        };
        
        for (let i = 0; i < repeatCount; i++) {
            clients.forEach((displayData, displayId) => {
                console.log(`[整点报时] 发送到显示端: ${displayId}`);
                send(displayId, announceData, { checkSleep: true });
            });
            
            if (i < repeatCount - 1) {
                await new Promise(resolve => setTimeout(resolve, repeatDelay));
            }
        }
        
        return true;
    } catch (err) {
        console.error('[整点报时] 生成语音失败:', err.message);
        return false;
    }
}

function onMinuteChange(eventData) {
    if (shouldAnnounce(eventData.minute)) {
        checkAndAnnounce();
    }
}

function start(displayClients, sendToDisplay) {
    displayClientsRef = displayClients;
    sendToDisplayRef = sendToDisplay;
    
    timeListener.on('minute', onMinuteChange);
    
    console.log('[整点报时] 已注册时间监听');
}

function stop() {
    timeListener.off('minute', onMinuteChange);
    console.log('[整点报时] 已取消时间监听');
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
