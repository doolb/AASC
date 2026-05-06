const path = require('path');
const DataSnapshot = require('../../../../core/data-snapshot');

const CONFIG_FILE = path.join(__dirname, '../../../../../config/config.json');

const defaultDisplayState = {
    currentMedia: null,
    rotation: 0,
    fit: 'contain',
    crop: { x: 0, y: 0, width: 100, height: 100 },
    volume: 100,
    playlist: []
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
            maxErrorBytes: 65536
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
        voiceCommand: {
            defaultWeatherCity: '',
            weatherCities: [
                '北京', '上海', '广州', '深圳', '杭州', '南京', '苏州', '成都', '重庆', '天津',
                '武汉', '西安', '长沙', '郑州', '青岛', '厦门', '福州', '宁波', '无锡', '合肥'
            ],
            reminderTemplate: '{content}',
            reminderTemplatePrefix: '',
            reminderTemplateSuffix: ''
        },
        logBrain: {
            errorThreshold: 1,
            warnThreshold: 20,
            memoryWarningThreshold: 85,
            defaultTimeRange: '10m'
        },
        displayStates: {},
        deviceEvents: {},
        chat: {
            apiUrl: 'http://192.168.1.12:8080/v1/chat/completions',
            model: 'gpt-3.5-turbo',
            maxTokens: 1000,
            temperature: 0.7,
            systemPrompt: '你是一个友好的助手，请用简洁的语言回答问题。',
            activeProfile: 'default',
            llmProfiles: [
                {
                    name: 'default',
                    apiUrl: 'http://192.168.1.12:8080/v1/chat/completions',
                    model: 'gpt-3.5-turbo',
                    maxTokens: 1000,
                    temperature: 0.7
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
            maxErrorBytes: this.get('tts.maxErrorBytes', 65536)
        };
    }

    getDisplayState(ip) {
        const states = this.get('displayStates', {});
        const key = ip || 'default';
        return states[key] || { ...defaultDisplayState };
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

module.exports = config;
module.exports.defaultDisplayState = defaultDisplayState;
module.exports.loadConfig = () => config;
module.exports.saveConfig = () => { config._save(); return true; };
module.exports.getConfig = () => config;
module.exports.get = (key, defaultValue) => config.get(key, defaultValue);
module.exports.set = (key, value) => config.set(key, value);
module.exports.setTtsConfig = (ttsConfig) => config.setTtsConfig(ttsConfig);
module.exports.getTtsConfig = () => config.getTtsConfig();
module.exports.getDisplayState = (ip) => config.getDisplayState(ip);
module.exports.setDisplayState = (ip, state) => config.setDisplayState(ip, state);
module.exports.updateDisplayState = (ip, partialState) => config.updateDisplayState(ip, partialState);
module.exports.addToPlaylist = (ip, media) => config.addToPlaylist(ip, media);
module.exports.removeFromPlaylist = (ip, index) => config.removeFromPlaylist(ip, index);
module.exports.clearPlaylist = (ip) => config.clearPlaylist(ip);
module.exports.getPlaylist = (ip) => config.getPlaylist(ip);
module.exports.getAllDisplayStates = () => config.getAllDisplayStates();
module.exports.getDeviceEvents = () => config.getDeviceEvents();
module.exports.getDeviceEvent = (ip) => config.getDeviceEvent(ip);
module.exports.setDeviceEvent = (ip, eventConfig) => config.setDeviceEvent(ip, eventConfig);
module.exports.removeDeviceEvent = (ip) => config.removeDeviceEvent(ip);
