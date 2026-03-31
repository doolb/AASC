class TimeListener {
    constructor() {
        this.listeners = new Map();
        this.lastMinute = -1;
        this.lastHour = -1;
        this.lastDay = -1;
        this.timer = null;
        this.isRunning = false;
    }
    
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);
        return () => this.off(event, callback);
    }
    
    off(event, callback) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).delete(callback);
        }
    }
    
    once(event, callback) {
        const wrapper = (...args) => {
            this.off(event, wrapper);
            callback(...args);
        };
        this.on(event, wrapper);
    }
    
    emit(event, ...args) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).forEach(callback => {
                try {
                    callback(...args);
                } catch (err) {
                    console.error(`[TimeListener] 事件 ${event} 回调错误:`, err.message);
                }
            });
        }
    }
    
    start() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        const now = new Date();
        this.lastMinute = now.getMinutes();
        this.lastHour = now.getHours();
        this.lastDay = now.getDate();
        
        this.timer = setInterval(() => {
            this.checkTimeChange();
        }, 1000);
        
        console.log('[时间监听] 已启动');
    }
    
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.isRunning = false;
        console.log('[时间监听] 已停止');
    }
    
    checkTimeChange() {
        const now = new Date();
        const currentMinute = now.getMinutes();
        const currentHour = now.getHours();
        const currentDay = now.getDate();
        
        if (currentMinute !== this.lastMinute) {
            this.lastMinute = currentMinute;
            this.emit('minute', {
                minute: currentMinute,
                hour: currentHour,
                date: now
            });
        }
        
        if (currentHour !== this.lastHour) {
            this.lastHour = currentHour;
            this.emit('hour', {
                hour: currentHour,
                date: now
            });
        }
        
        if (currentDay !== this.lastDay) {
            this.lastDay = currentDay;
            this.emit('day', {
                day: currentDay,
                date: now
            });
        }
    }
    
    getStatus() {
        return {
            isRunning: this.isRunning,
            lastMinute: this.lastMinute,
            lastHour: this.lastHour,
            lastDay: this.lastDay,
            listenerCount: {
                minute: this.listeners.has('minute') ? this.listeners.get('minute').size : 0,
                hour: this.listeners.has('hour') ? this.listeners.get('hour').size : 0,
                day: this.listeners.has('day') ? this.listeners.get('day').size : 0
            }
        };
    }
}

const timeListener = new TimeListener();

module.exports = timeListener;
