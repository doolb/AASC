const CATEGORY_LEVEL_MAP = {
    '错误': 'error',
    '断开': 'warn',
    '静音': 'warn',
    '连接': 'info',
    '语音': 'info',
    'TTS': 'info',
    '提醒': 'info',
    '设备': 'info',
    '能力': 'info',
    '系统': 'info',
    '子显示端': 'info',
    'AASC': 'info',
    '媒体库': 'info',
    '整点报时': 'info',
    'Chat': 'info',
    'Commands': 'info',
    'WS': 'info',
    '配置': 'debug',
    '内存': 'debug'
};

const CATEGORY_DEVICE_MAP = {
    '连接': 'server',
    '断开': 'server',
    '系统': 'server',
    '配置': 'server',
    '内存': 'server',
    'AASC': 'server',
    '媒体库': 'server',
    '静音': 'server',
    'WS': 'server',
    '语音': 'display',
    'TTS': 'display',
    '提醒': 'display',
    '设备': 'display',
    '能力': 'display',
    '子显示端': 'display',
    '整点报时': 'display',
    'Chat': 'control',
    'Commands': 'control',
    '错误': 'server'
};

class LogBuffer {
    constructor(options = {}) {
        this.maxSize = options.maxSize || 1000;
        this.buffer = [];
        this.listeners = new Set();
    }

    add(category, message, extra = {}) {
        const entry = {
            id: Date.now() + '-' + Math.random().toString(36).substring(2, 8),
            timestamp: Date.now(),
            time: new Date().toTimeString().split(' ')[0],
            category,
            level: extra.level || CATEGORY_LEVEL_MAP[category] || 'info',
            device: extra.device || CATEGORY_DEVICE_MAP[category] || 'server',
            message,
            displayId: extra.displayId || null,
            correlationId: extra.correlationId || null,
            scope: extra.scope || null,
            source: extra.source || null,
            targetId: extra.targetId || null
        };

        this.buffer.push(entry);
        if (this.buffer.length > this.maxSize) {
            this.buffer.shift();
        }

        this._notify(entry);
        return entry;
    }

    getEntries(filters = {}) {
        let result = [...this.buffer];

        if (filters.search) {
            const searchLower = filters.search.toLowerCase();
            result = result.filter(e =>
                e.message.toLowerCase().includes(searchLower) ||
                e.category.toLowerCase().includes(searchLower)
            );
        }

        if (filters.levels && filters.levels.length > 0) {
            result = result.filter(e => filters.levels.includes(e.level));
        }

        if (filters.devices && filters.devices.length > 0) {
            result = result.filter(e => filters.devices.includes(e.device));
        }

        if (filters.categories && filters.categories.length > 0) {
            result = result.filter(e => filters.categories.includes(e.category));
        }

        if (filters.timeRange) {
            const now = Date.now();
            const rangeMs = this._parseTimeRange(filters.timeRange);
            if (rangeMs > 0) {
                const cutoff = now - rangeMs;
                result = result.filter(e => e.timestamp >= cutoff);
            }
        }

        if (filters.limit && filters.limit > 0) {
            result = result.slice(-filters.limit);
        }

        return result;
    }

    _parseTimeRange(range) {
        const map = {
            '10s': 10 * 1000,
            '30s': 30 * 1000,
            '1m': 60 * 1000,
            '5m': 5 * 60 * 1000,
            '10m': 10 * 60 * 1000,
            '30m': 30 * 60 * 1000,
            '1h': 60 * 60 * 1000,
            'all': 0
        };
        return map[range] || 0;
    }

    getCategories() {
        const cats = new Set();
        this.buffer.forEach(e => cats.add(e.category));
        return [...cats].sort();
    }

    onLogEntry(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    _notify(entry) {
        this.listeners.forEach(listener => {
            try {
                listener(entry);
            } catch (e) {
                // 忽略监听器错误
            }
        });
    }

    clear() {
        this.buffer = [];
    }

    get size() {
        return this.buffer.length;
    }
}

module.exports = LogBuffer;
module.exports.CATEGORY_DEVICE_MAP = CATEGORY_DEVICE_MAP;
