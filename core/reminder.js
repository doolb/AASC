const fs = require('fs');
const path = require('path');
const tts = require('./tts');
const timeListener = require('./timeListener');

const REMINDERS_FILE = path.join(__dirname, '../config/reminders.json');

let reminders = [];
let displayClients = null;
let sendToDisplay = null;

function init() {
    loadReminders();
    console.log(`[提醒] 已加载 ${reminders.length} 个提醒`);
}

function loadReminders() {
    try {
        if (fs.existsSync(REMINDERS_FILE)) {
            const data = fs.readFileSync(REMINDERS_FILE, 'utf8');
            reminders = JSON.parse(data);
        } else {
            reminders = [];
            saveReminders();
        }
    } catch (err) {
        console.error('[提醒] 加载失败:', err.message);
        reminders = [];
    }
}

function saveReminders() {
    try {
        const dir = path.dirname(REMINDERS_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(REMINDERS_FILE, JSON.stringify(reminders, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error('[提醒] 保存失败:', err.message);
        return false;
    }
}

function generateId() {
    return 'r_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now();
}

function addReminder(data) {
    const reminder = {
        id: generateId(),
        content: data.content,
        time: data.time,
        type: data.type || 'once',
        methods: data.methods || ['voice', 'popup'],
        repeat: {
            enabled: data.repeat?.enabled || false,
            interval: data.repeat?.interval || 5,
            count: data.repeat?.count || 10
        },
        repeatCount: data.repeatCount || 1,
        enabled: true,
        createdAt: Date.now(),
        lastTriggered: null,
        nextTrigger: calculateNextTrigger(data.time, data.type)
    };
    
    reminders.push(reminder);
    saveReminders();
    console.log(`[提醒] 已添加: ${reminder.time} - ${reminder.content}`);
    return reminder;
}

function updateReminder(id, data) {
    const index = reminders.findIndex(r => r.id === id);
    if (index === -1) return null;
    
    const reminder = reminders[index];
    
    if (data.content !== undefined) reminder.content = data.content;
    if (data.time !== undefined) {
        reminder.time = data.time;
        reminder.nextTrigger = calculateNextTrigger(data.time, reminder.type);
    }
    if (data.type !== undefined) {
        reminder.type = data.type;
        reminder.nextTrigger = calculateNextTrigger(reminder.time, data.type);
    }
    if (data.methods !== undefined) reminder.methods = data.methods;
    if (data.repeat !== undefined) {
        reminder.repeat = { ...reminder.repeat, ...data.repeat };
    }
    if (data.repeatCount !== undefined) reminder.repeatCount = data.repeatCount;
    
    saveReminders();
    console.log(`[提醒] 已更新: ${reminder.id}`);
    return reminder;
}

function deleteReminder(id) {
    const index = reminders.findIndex(r => r.id === id);
    if (index === -1) return false;
    
    reminders.splice(index, 1);
    saveReminders();
    console.log(`[提醒] 已删除: ${id}`);
    return true;
}

function getReminder(id) {
    return reminders.find(r => r.id === id) || null;
}

function getAllReminders() {
    return [...reminders];
}

function toggleReminder(id, enabled) {
    const reminder = getReminder(id);
    if (!reminder) return null;
    
    reminder.enabled = enabled;
    if (enabled) {
        reminder.nextTrigger = calculateNextTrigger(reminder.time, reminder.type);
    }
    saveReminders();
    return reminder;
}

function calculateNextTrigger(time, type) {
    if (!time) return null;
    
    const [hours, minutes] = time.split(':').map(Number);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
    
    if (type === 'once') {
        if (today > now) {
            return today.getTime();
        }
        return null;
    } else if (type === 'daily') {
        if (today > now) {
            return today.getTime();
        } else {
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            return tomorrow.getTime();
        }
    }
    
    return null;
}

function shouldTrigger(reminder) {
    if (!reminder.enabled) return false;
    if (!reminder.nextTrigger) return false;
    
    const now = Date.now();
    const triggerTime = reminder.nextTrigger;
    
    const diff = Math.abs(now - triggerTime);
    if (diff < 60000) {
        const nowDate = new Date(now);
        const triggerDate = new Date(triggerTime);
        
        if (nowDate.getHours() === triggerDate.getHours() &&
            nowDate.getMinutes() === triggerDate.getMinutes()) {
            return true;
        }
    }
    
    return false;
}

async function triggerReminder(reminder, repeatIndex = 0) {
    console.log(`[提醒] 触发: ${reminder.time} - ${reminder.content}`);
    
    const now = new Date();
    const timeText = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const fullContent = `${timeText} ${reminder.content}`;
    
    reminder.lastTriggered = Date.now();
    
    if (reminder.type === 'once') {
        reminder.enabled = false;
        reminder.nextTrigger = null;
    } else if (reminder.type === 'daily') {
        reminder.nextTrigger = calculateNextTrigger(reminder.time, 'daily');
    }
    
    saveReminders();
    
    const repeatCount = reminder.repeatCount || 1;
    
    for (let i = 0; i < repeatCount; i++) {
        const currentRepeatIndex = repeatIndex * repeatCount + i;
        
        if (displayClients && sendToDisplay) {
            if (reminder.methods.includes('popup')) {
                displayClients.forEach((displayData, displayId) => {
                    sendToDisplay(displayId, {
                        type: 'reminder',
                        action: 'popup',
                        title: '提醒',
                        time: timeText,
                        content: reminder.content,
                        repeatIndex: i + 1,
                        totalRepeat: repeatCount
                    });
                });
            }
            
            if (reminder.methods.includes('voice')) {
                try {
                    const audioPath = await tts.generateTTS(fullContent);
                    const fileName = path.basename(audioPath);
                    
                    displayClients.forEach((displayData, displayId) => {
                        sendToDisplay(displayId, {
                            type: 'reminder',
                            action: 'voice',
                            audioUrl: `/uploads/tts/${fileName}`,
                            text: fullContent,
                            repeatIndex: i + 1,
                            totalRepeat: repeatCount
                        });
                    });
                    
                    if (i < repeatCount - 1) {
                        await new Promise(resolve => setTimeout(resolve, 1500));
                    }
                } catch (err) {
                    console.error('[提醒] 语音生成失败:', err.message);
                }
            }
        }
    }
    
    return true;
}

async function checkReminders() {
    const now = new Date();
    const currentMinute = now.getHours() * 60 + now.getMinutes();
    
    for (const reminder of reminders) {
        if (shouldTrigger(reminder)) {
            await triggerReminder(reminder);
            
            if (reminder.repeat.enabled && reminder.repeat.count !== 0) {
                const repeatCount = reminder.repeat.count || 10;
                const repeatInterval = reminder.repeat.interval || 5;
                
                for (let i = 1; i < repeatCount; i++) {
                    setTimeout(async () => {
                        const reminderData = getReminder(reminder.id);
                        if (reminderData && reminderData.enabled) {
                            await triggerReminder(reminderData, i);
                        }
                    }, i * repeatInterval * 60 * 1000);
                }
            }
        }
    }
}

function onMinuteChange(eventData) {
    checkReminders();
}

function start(clients, sendFunc) {
    displayClients = clients;
    sendToDisplay = sendFunc;
    
    timeListener.on('minute', onMinuteChange);
    
    console.log('[提醒] 已注册时间监听');
}

function stop() {
    timeListener.off('minute', onMinuteChange);
    console.log('[提醒] 已取消时间监听');
}

async function testReminder(reminderData, targetDisplayId = null, sendFunc = null) {
    const now = new Date();
    const timeText = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const fullContent = `${timeText} ${reminderData.content || '测试提醒'}`;
    const repeatCount = reminderData.repeatCount || 1;
    
    const sendTo = sendFunc || sendToDisplay;
    const clients = targetDisplayId ? null : displayClients;
    
    for (let i = 0; i < repeatCount; i++) {
        let audioFileName = null;
        
        if (reminderData.methods && reminderData.methods.includes('voice')) {
            try {
                const audioPath = await tts.generateTTS(fullContent);
                audioFileName = path.basename(audioPath);
            } catch (err) {
                console.error('[提醒] 测试语音生成失败:', err.message);
                throw err;
            }
        }
        
        const sendReminder = (displayId) => {
            if (reminderData.methods && reminderData.methods.includes('popup')) {
                sendTo(displayId, {
                    type: 'reminder',
                    action: 'popup',
                    title: '测试提醒',
                    time: timeText,
                    content: reminderData.content || '这是一条测试提醒',
                    repeatIndex: i + 1,
                    totalRepeat: repeatCount
                });
            }
            
            if (audioFileName) {
                sendTo(displayId, {
                    type: 'reminder',
                    action: 'voice',
                    audioUrl: `/uploads/tts/${audioFileName}`,
                    text: fullContent,
                    repeatIndex: i + 1,
                    totalRepeat: repeatCount
                });
            }
        };
        
        if (targetDisplayId && sendTo) {
            sendReminder(targetDisplayId);
        } else if (clients && sendTo) {
            clients.forEach((displayData, displayId) => {
                sendReminder(displayId);
            });
        }
        
        if (i < repeatCount - 1) {
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
    }
    
    return true;
}

module.exports = {
    init,
    addReminder,
    updateReminder,
    deleteReminder,
    getReminder,
    getAllReminders,
    toggleReminder,
    start,
    stop,
    checkReminders,
    testReminder
};
