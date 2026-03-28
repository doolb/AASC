const fs = require('fs');
const path = require('path');
const tts = require('./tts');

const REMINDERS_FILE = path.join(__dirname, '../config/reminders.json');

let reminders = [];
let checkTimer = null;
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
    
    if (displayClients && sendToDisplay) {
        if (reminder.methods.includes('popup')) {
            displayClients.forEach((displayData, displayId) => {
                sendToDisplay(displayId, {
                    type: 'reminder',
                    action: 'popup',
                    title: '提醒',
                    time: timeText,
                    content: reminder.content
                });
            });
        }
        
        if (reminder.methods.includes('voice')) {
            try {
                await tts.generateTTS(fullContent);
                
                displayClients.forEach((displayData, displayId) => {
                    sendToDisplay(displayId, {
                        type: 'reminder',
                        action: 'voice',
                        audioUrl: '/uploads/temp_tts.wav?t=' + Date.now() + '&r=' + repeatIndex,
                        text: fullContent
                    });
                });
            } catch (err) {
                console.error('[提醒] 语音生成失败:', err.message);
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
                        if (displayClients && sendToDisplay) {
                            const timeText = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
                            const fullContent = `${timeText} ${reminder.content}`;
                            
                            if (reminder.methods.includes('popup')) {
                                displayClients.forEach((displayData, displayId) => {
                                    sendToDisplay(displayId, {
                                        type: 'reminder',
                                        action: 'popup',
                                        title: '提醒',
                                        time: timeText,
                                        content: reminder.content
                                    });
                                });
                            }
                            
                            if (reminder.methods.includes('voice')) {
                                try {
                                    await tts.generateTTS(fullContent);
                                    displayClients.forEach((displayData, displayId) => {
                                        sendToDisplay(displayId, {
                                            type: 'reminder',
                                            action: 'voice',
                                            audioUrl: '/uploads/temp_tts.wav?t=' + Date.now() + '&r=' + i,
                                            text: fullContent
                                        });
                                    });
                                } catch (err) {
                                    console.error('[提醒] 重复语音生成失败:', err.message);
                                }
                            }
                        }
                    }, i * repeatInterval * 60 * 1000);
                }
            }
        }
    }
}

function start(clients, sendFunc) {
    displayClients = clients;
    sendToDisplay = sendFunc;
    
    if (checkTimer) {
        clearInterval(checkTimer);
    }
    
    checkTimer = setInterval(checkReminders, 60000);
    console.log('[提醒] 定时器已启动');
}

function stop() {
    if (checkTimer) {
        clearInterval(checkTimer);
        checkTimer = null;
        console.log('[提醒] 定时器已停止');
    }
}

async function testReminder(reminderData) {
    const now = new Date();
    const timeText = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const fullContent = `${timeText} ${reminderData.content || '测试提醒'}`;
    
    if (displayClients && sendToDisplay) {
        if (reminderData.methods && reminderData.methods.includes('popup')) {
            displayClients.forEach((displayData, displayId) => {
                sendToDisplay(displayId, {
                    type: 'reminder',
                    action: 'popup',
                    title: '测试提醒',
                    time: timeText,
                    content: reminderData.content || '这是一条测试提醒'
                });
            });
        }
        
        if (!reminderData.methods || reminderData.methods.includes('voice')) {
            try {
                await tts.generateTTS(fullContent);
                displayClients.forEach((displayData, displayId) => {
                    sendToDisplay(displayId, {
                        type: 'reminder',
                        action: 'voice',
                        audioUrl: '/uploads/temp_tts.wav?t=' + Date.now(),
                        text: fullContent
                    });
                });
            } catch (err) {
                console.error('[提醒] 测试语音生成失败:', err.message);
                throw err;
            }
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
