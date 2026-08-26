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

const CPU_AFFINITY_ENGINES = ['asr', 'tts'];
const CPU_AFFINITY_FIELDS = ['bigCoreCount', 'littleCoreCount'];
const DEFAULT_CPU_AFFINITY = {
    asr: { bigCoreCount: 1, littleCoreCount: 1 },
    tts: { bigCoreCount: 1, littleCoreCount: 1 }
};

function isNonNegativeInteger(value) {
    return Number.isInteger(value) && value >= 0;
}

function cloneCpuAffinityConfig(cpuAffinity = DEFAULT_CPU_AFFINITY) {
    return {
        asr: { ...cpuAffinity.asr },
        tts: { ...cpuAffinity.tts }
    };
}

function getCpuAffinityEngineSlotCount(engineConfig) {
    return (engineConfig?.bigCoreCount || 0) + (engineConfig?.littleCoreCount || 0);
}

function normalizeCpuAffinityEngine(engine, rawConfig, fallbackConfig) {
    const normalizedEngine = { ...fallbackConfig[engine] };

    CPU_AFFINITY_FIELDS.forEach((field) => {
        const value = rawConfig?.[engine]?.[field];
        if (isNonNegativeInteger(value)) {
            normalizedEngine[field] = value;
        }
    });

    // 持久化配置或缺省输入如果把单个引擎变成 0/0，则回退该引擎默认值，避免向下游发出不可运行配置。
    if (getCpuAffinityEngineSlotCount(normalizedEngine) <= 0) {
        return { ...fallbackConfig[engine] };
    }

    return normalizedEngine;
}

// 对存量配置做宽容读取：缺失或旧值损坏时回退默认值，避免旧配置把新协议读坏。
function normalizeCpuAffinityConfig(rawConfig, fallbackConfig = DEFAULT_CPU_AFFINITY) {
    const normalizedFallback = cloneCpuAffinityConfig(fallbackConfig);
    const normalized = {};

    CPU_AFFINITY_ENGINES.forEach((engine) => {
        normalized[engine] = normalizeCpuAffinityEngine(engine, rawConfig, normalizedFallback);
    });

    return normalized;
}

function validateCpuAffinityPayload(payload, fallbackConfig = DEFAULT_CPU_AFFINITY) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { ok: false, message: 'cpuAffinity 配置必须是对象' };
    }

    const normalized = cloneCpuAffinityConfig(fallbackConfig);

    for (const engine of CPU_AFFINITY_ENGINES) {
        const engineConfig = payload[engine];
        if (engineConfig === undefined) {
            continue;
        }
        if (!engineConfig || typeof engineConfig !== 'object' || Array.isArray(engineConfig)) {
            return { ok: false, message: `${engine} 配置必须是对象` };
        }

        for (const field of CPU_AFFINITY_FIELDS) {
            const value = engineConfig[field];
            if (value === undefined) {
                continue;
            }
            if (!isNonNegativeInteger(value)) {
                return { ok: false, message: `${engine}.${field} 必须是非负整数` };
            }
            normalized[engine][field] = value;
        }

        if (getCpuAffinityEngineSlotCount(normalized[engine]) <= 0) {
            return { ok: false, message: `${engine} 至少保留一个 CPU 槽位` };
        }
    }

    return { ok: true, value: normalized };
}

function createCpuAffinityChangedMessage(cpuAffinity) {
    return {
        type: 'cpuAffinityChanged',
        cpuAffinity: normalizeCpuAffinityConfig(cpuAffinity)
    };
}

function createCpuConfigMessage(cpuAffinity) {
    const normalized = normalizeCpuAffinityConfig(cpuAffinity);
    return {
        type: 'cpuConfig',
        asr: normalized.asr,
        tts: normalized.tts
    };
}

function applyCpuAffinityConfigUpdate({
    body,
    setConfig = (key, value) => config.set(key, value),
    broadcastToControls = () => {},
    broadcastCpuConfig = () => {},
    fallbackConfig = DEFAULT_CPU_AFFINITY
}) {
    const result = validateCpuAffinityPayload(body, fallbackConfig);
    if (!result.ok) {
        return {
            statusCode: 400,
            body: { status: 'error', message: result.message }
        };
    }

    setConfig('cpuAffinity', result.value);
    broadcastToControls(createCpuAffinityChangedMessage(result.value));
    broadcastCpuConfig(createCpuConfigMessage(result.value));

    return {
        statusCode: 200,
        body: {
            status: 'success',
            cpuAffinity: result.value
        }
    };
}

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
        cpuAffinity: cloneCpuAffinityConfig(),
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
module.exports.normalizeCpuAffinityConfig = (rawConfig, fallbackConfig) => normalizeCpuAffinityConfig(rawConfig, fallbackConfig);
module.exports.validateCpuAffinityPayload = (payload, fallbackConfig) => validateCpuAffinityPayload(payload, fallbackConfig);
module.exports.getCpuAffinityConfig = () => normalizeCpuAffinityConfig(config.get('cpuAffinity'));
module.exports.createCpuAffinityChangedMessage = (cpuAffinity) => createCpuAffinityChangedMessage(cpuAffinity);
module.exports.createCpuConfigMessage = (cpuAffinity) => createCpuConfigMessage(cpuAffinity);
module.exports.applyCpuAffinityConfigUpdate = (options) => applyCpuAffinityConfigUpdate(options);
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
