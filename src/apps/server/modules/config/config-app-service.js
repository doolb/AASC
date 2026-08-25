const path = require('path');
const fs = require('fs');
const DataSnapshot = require('../../../../core/data-snapshot');
const { USER_CONFIG_DIR } = require('./user-config-paths');

const CONFIG_FILE = path.join(__dirname, '../../../../../config/config.json');
const USER_CONFIG_FILE = path.join(USER_CONFIG_DIR, 'userconfig.json');

const defaultDisplayState = {
    currentMedia: null,
    currentMediaProgress: null,
    rotation: 0,
    fit: 'contain',
    crop: { x: 0, y: 0, width: 100, height: 100 },
    volume: 100,
    playlist: [],
    sleep: { enabled: true, startHour: 23, endHour: 8, deepStartHour: 1, deepEndHour: 6 }
};

class Config extends DataSnapshot {
    static defaults = {
        server: {
            port: 8081
        },
       tts: {
           serviceUrl: 'http://192.168.1.16:3000/api/tts',
           defaultVoice: 'Microsoft Xiaoxiao',
           defaultSpeed: 0,
           requestTimeoutMs: 20000,
           extraTimeoutPerPending: 10000,
            maxErrorBytes: 65536,
            device: 'server'
       },
        asr: {
            mode: 'isolated',
            maxQueueLength: 8,
            mallocTrimEnabled: true,
            requireChinese: false,
            isolateProcess: {
                enabled: false,
                requestTimeoutMs: 60000,
                autoRestart: true
            }
        },
        voiceprint: { enabled: true, extraction: 'server', threshold: 0.5, multiSpeaker: true },
        voiceCommand: {
            defaultWeatherCity: '',
            weatherCities: [
                '北京', '上海', '广州', '深圳', '杭州', '南京', '苏州', '成都', '重庆', '天津',
                '武汉', '西安', '长沙', '郑州', '青岛', '厦门', '福州', '宁波', '无锡', '合肥'
            ],
            reminderTemplate: '{content}',
            reminderTemplatePrefix: '',
            reminderTemplateSuffix: '',
            routing: {
                weather: 'system',
                search: 'system'
            }
        },
        logBrain: {
            errorThreshold: 1,
            warnThreshold: 20,
            memoryWarningThreshold: 85,
            defaultTimeRange: '10m'
        },
        logReportDisplay: { enabled: false, level: 'error' },
        logReportControl: { enabled: false, level: 'error' },
        logBlocklist: [],
        chat: {
            agentBackend: 'codex',
            apiUrl: 'http://192.168.1.12:8080/v1/chat/completions',
            model: 'gpt-3.5-turbo',
            maxTokens: 1000,
            temperature: 0.7,
            apiKey: '',
            contextCount: 0,
            systemPrompt: '你是一个友好的助手，请用简洁的语言回答问题。',
            activeProfile: 'default',
            llmProfiles: [
                {
                    name: 'default',
                    mode: 'llm',
                    apiUrl: 'http://192.168.1.12:8080/v1/chat/completions',
                    model: 'gpt-3.5-turbo',
                    maxTokens: 1000,
                    temperature: 0.7,
                    apiKey: '',
                    contextCount: 0,
                    promptFormat: 'openai'
                }
            ]
        }
    };

    get(key, defaultValue) {
        const keys = key.split('.');
        let value = this._data;
        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else {
                return defaultValue;
            }
        }
        return value;
    }

    set(key, value) {
        const keys = key.split('.');
        let obj = this._data;
        for (let i = 0; i < keys.length - 1; i++) {
            if (!(keys[i] in obj)) {
                obj[keys[i]] = {};
            }
            obj = obj[keys[i]];
        }
        obj[keys[keys.length - 1]] = value;
        this._save();
    }

    setTtsConfig(ttsConfig) {
        this.batch((data) => {
            if (ttsConfig.serviceUrl !== undefined) {
                data.tts.serviceUrl = ttsConfig.serviceUrl;
            }
            if (ttsConfig.defaultVoice !== undefined) {
                data.tts.defaultVoice = ttsConfig.defaultVoice;
            }
            if (ttsConfig.defaultSpeed !== undefined) {
                data.tts.defaultSpeed = ttsConfig.defaultSpeed;
            }
            if (ttsConfig.requestTimeoutMs !== undefined) {
                data.tts.requestTimeoutMs = ttsConfig.requestTimeoutMs;
            }
            if (ttsConfig.extraTimeoutPerPending !== undefined) {
                data.tts.extraTimeoutPerPending = ttsConfig.extraTimeoutPerPending;
            }
            if (ttsConfig.maxErrorBytes !== undefined) {
                data.tts.maxErrorBytes = ttsConfig.maxErrorBytes;
            }
        });
    }

    getTtsConfig() {
        return {
            serviceUrl: this.get('tts.serviceUrl'),
            defaultVoice: this.get('tts.defaultVoice'),
            defaultSpeed: this.get('tts.defaultSpeed'),
            requestTimeoutMs: this.get('tts.requestTimeoutMs', 20000),
            extraTimeoutPerPending: this.get('tts.extraTimeoutPerPending', 10000),
            maxErrorBytes: this.get('tts.maxErrorBytes', 65536)
        };
    }
}

class UserConfig extends DataSnapshot {
    static defaults = {
        displayStates: {},
        deviceEvents: {}
    };

    get(key, defaultValue) {
        const keys = key.split('.');
        let value = this._data;
        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else {
                return defaultValue;
            }
        }
        return value;
    }

    set(key, value) {
        const keys = key.split('.');
        let obj = this._data;
        for (let i = 0; i < keys.length - 1; i++) {
            if (!(keys[i] in obj)) {
                obj[keys[i]] = {};
            }
            obj = obj[keys[i]];
        }
        obj[keys[keys.length - 1]] = value;
        this._save();
    }

    getDisplayState(ip) {
        const states = this.get('displayStates', {});
        const key = ip || 'default';
        return states[key] || { ...defaultDisplayState };
    }

    // 按稳定 displayId 读取显示端状态；legacyIp 仅用于兼容一次旧版 IP 键。
    getDisplayStateById(displayId, legacyIp) {
        const states = this.get('displayStates', {});
        const key = displayId || legacyIp || 'default';
        const currentState = states[key];
        if (currentState) {
            if (displayId && currentState.displayId !== displayId) {
                const boundState = { ...currentState, displayId };
                states[displayId] = boundState;
                this.set('displayStates', states);
                return boundState;
            }
            return currentState;
        }

        const legacyState = legacyIp ? states[legacyIp] : null;
        if (displayId && legacyState && (!legacyState.displayId || legacyState.displayId === displayId)) {
            const migratedState = { ...legacyState, displayId };
            states[displayId] = migratedState;
            if (legacyIp !== displayId) {
                delete states[legacyIp];
            }
            this.set('displayStates', states);
            return migratedState;
        }

        return { ...defaultDisplayState, ...(displayId ? { displayId } : {}) };
    }

    setDisplayState(ip, state) {
        const states = this.get('displayStates', {});
        const key = ip || 'default';
        states[key] = state;
        this.set('displayStates', states);
    }

    updateDisplayState(ip, partialState) {
        const currentState = this.getDisplayState(ip);
        const newState = { ...currentState, ...partialState };
        this.setDisplayState(ip, newState);
        return newState;
    }

    // 按 displayId 更新显示端状态，保证同一 IP 上的多个显示端互不覆盖。
    updateDisplayStateById(displayId, legacyIp, partialState) {
        const currentState = this.getDisplayStateById(displayId, legacyIp);
        const newState = {
            ...currentState,
            ...partialState,
            ...(displayId ? { displayId } : {})
        };
        const states = this.get('displayStates', {});
        states[displayId || legacyIp || 'default'] = newState;
        this.set('displayStates', states);
        return newState;
    }

    addToPlaylist(ip, media) {
        const state = this.getDisplayState(ip);
        if (!state.playlist) {
            state.playlist = [];
        }
        state.playlist.push(media);
        this.setDisplayState(ip, state);
    }

    removeFromPlaylist(ip, index) {
        const state = this.getDisplayState(ip);
        if (state.playlist && index >= 0 && index < state.playlist.length) {
            state.playlist.splice(index, 1);
            this.setDisplayState(ip, state);
        }
    }

    clearPlaylist(ip) {
        const state = this.getDisplayState(ip);
        state.playlist = [];
        this.setDisplayState(ip, state);
    }

    getPlaylist(ip) {
        const state = this.getDisplayState(ip);
        return state.playlist || [];
    }

    getAllDisplayStates() {
        return this.get('displayStates', {});
    }

    getDeviceEvents() {
        return this.get('deviceEvents', {});
    }

    getDeviceEvent(ip) {
        const events = this.getDeviceEvents();
        return events[ip] || events['default'] || { onConnect: '', onDisconnect: '' };
    }

    setDeviceEvent(ip, eventConfig) {
        const events = this.getDeviceEvents();
        events[ip] = {
            onConnect: eventConfig.onConnect !== undefined ? eventConfig.onConnect : '',
            onDisconnect: eventConfig.onDisconnect !== undefined ? eventConfig.onDisconnect : ''
        };
        this.set('deviceEvents', events);
        return events[ip];
    }

    removeDeviceEvent(ip) {
        const events = this.getDeviceEvents();
        delete events[ip];
        this.set('deviceEvents', events);
        return true;
    }
}

const config = new Config(CONFIG_FILE);
const userConfig = new UserConfig(USER_CONFIG_FILE);

// 迁移:将旧 config/config.json 中的 displayStates/deviceEvents 及 config/ 下的私人文件迁移到 ~/.config/aasc-user/
function migrateLegacyUserData() {
    const legacyDir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(USER_CONFIG_DIR)) {
        fs.mkdirSync(USER_CONFIG_DIR, { recursive: true });
    }

    // 1. config.json 内嵌的 displayStates / deviceEvents
    const configData = config._data;
    if (configData.displayStates && Object.keys(configData.displayStates).length > 0) {
        const states = userConfig.get('displayStates', {});
        Object.assign(states, configData.displayStates);
        userConfig.set('displayStates', states);
        delete configData.displayStates;
        config._save();
        console.log('[配置] 已迁移 displayStates 到 ~/.config/aasc-user/userconfig.json');
    }
    if (configData.deviceEvents && Object.keys(configData.deviceEvents).length > 0) {
        const events = userConfig.get('deviceEvents', {});
        Object.assign(events, configData.deviceEvents);
        userConfig.set('deviceEvents', events);
        delete configData.deviceEvents;
        config._save();
        console.log('[配置] 已迁移 deviceEvents 到 ~/.config/aasc-user/userconfig.json');
    }

    // 2. config/ 下按文件名平铺的私人数据文件
    const LEGACY_FILES = [
        'chat-session.json',
        'chat-commands.json',
        'chat-templates.json',
        'important-records.json',
        'reminders.json',
        'search-history.json',
        'map-positions.json',
        'media-libraries.json'
    ];
    let legacyFiles = LEGACY_FILES.slice();
    try {
        const chatHistoryFiles = fs.readdirSync(legacyDir)
            .filter(f => f.startsWith('chat-history') && f.endsWith('.json'));
        legacyFiles = [...legacyFiles, ...chatHistoryFiles];
    } catch (err) {
        // 目录不可读时跳过 chat-history 扫描,其余文件仍按名称尝试
    }
    for (const name of legacyFiles) {
        const oldPath = path.join(legacyDir, name);
        const newPath = path.join(USER_CONFIG_DIR, name);
        if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
            try {
                fs.copyFileSync(oldPath, newPath);
                const stat = fs.statSync(newPath);
                if (stat.size > 0) {
                    fs.unlinkSync(oldPath);
                    console.log(`[配置] 已迁移 ${name} 到 ~/.config/aasc-user/`);
                } else {
                    console.error(`[配置] 迁移 ${name} 失败:目标文件为空,保留原文件`);
                }
            } catch (err) {
                console.error(`[配置] 迁移 ${name} 失败:${err.message},保留原文件`);
            }
        }
    }
}

migrateLegacyUserData();

module.exports = config;
module.exports.defaultDisplayState = defaultDisplayState;
module.exports.loadConfig = () => config;
module.exports.saveConfig = () => { config._save(); return true; };
module.exports.getConfig = () => config;
module.exports.get = (key, defaultValue) => config.get(key, defaultValue);
module.exports.set = (key, value) => config.set(key, value);
module.exports.setTtsConfig = (ttsConfig) => config.setTtsConfig(ttsConfig);
module.exports.getTtsConfig = () => config.getTtsConfig();
module.exports.getDisplayState = (ip) => userConfig.getDisplayState(ip);
module.exports.getDisplayStateById = (displayId, legacyIp) => userConfig.getDisplayStateById(displayId, legacyIp);
module.exports.setDisplayState = (ip, state) => userConfig.setDisplayState(ip, state);
module.exports.updateDisplayState = (ip, partialState) => userConfig.updateDisplayState(ip, partialState);
module.exports.updateDisplayStateById = (displayId, legacyIp, partialState) => userConfig.updateDisplayStateById(displayId, legacyIp, partialState);
module.exports.addToPlaylist = (ip, media) => userConfig.addToPlaylist(ip, media);
module.exports.removeFromPlaylist = (ip, index) => userConfig.removeFromPlaylist(ip, index);
module.exports.clearPlaylist = (ip) => userConfig.clearPlaylist(ip);
module.exports.getPlaylist = (ip) => userConfig.getPlaylist(ip);
module.exports.getAllDisplayStates = () => userConfig.getAllDisplayStates();
module.exports.getDeviceEvents = () => userConfig.getDeviceEvents();
module.exports.getDeviceEvent = (ip) => userConfig.getDeviceEvent(ip);
module.exports.setDeviceEvent = (ip, eventConfig) => userConfig.setDeviceEvent(ip, eventConfig);
module.exports.removeDeviceEvent = (ip) => userConfig.removeDeviceEvent(ip);
module.exports.getUserConfigDir = () => USER_CONFIG_DIR;
