const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '../config/config.json');

const defaultConfig = {
    server: {
        port: 8081
    },
    tts: {
        serviceUrl: 'http://192.168.1.16:3000/api/tts',
        defaultVoice: 'Microsoft Xiaoxiao',
        defaultSpeed: 0
    },
    displayStates: {}
};

const defaultDisplayState = {
    currentMedia: null,
    rotation: 0,
    fit: 'contain',
    crop: { x: 0, y: 0, width: 100, height: 100 },
    volume: 100,
    playlist: []
};

let config = null;

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf8');
            const loadedConfig = JSON.parse(data);
            config = deepMerge(defaultConfig, loadedConfig);
        } else {
            config = { ...defaultConfig };
            saveConfig();
        }
    } catch (err) {
        console.error('[Config] 加载配置失败:', err.message);
        config = { ...defaultConfig };
    }
    return config;
}

function deepMerge(target, source) {
    const result = { ...target };
    for (const key in source) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = deepMerge(target[key] || {}, source[key]);
        } else {
            result[key] = source[key];
        }
    }
    return result;
}

function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error('[Config] 保存配置失败:', err.message);
        return false;
    }
}

function getConfig() {
    if (!config) {
        loadConfig();
    }
    return config;
}

function get(key, defaultValue) {
    const cfg = getConfig();
    const keys = key.split('.');
    let value = cfg;
    for (const k of keys) {
        if (value && typeof value === 'object' && k in value) {
            value = value[k];
        } else {
            return defaultValue;
        }
    }
    return value;
}

function set(key, value) {
    const cfg = getConfig();
    const keys = key.split('.');
    let obj = cfg;
    for (let i = 0; i < keys.length - 1; i++) {
        if (!(keys[i] in obj)) {
            obj[keys[i]] = {};
        }
        obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    saveConfig();
}

function setTtsConfig(ttsConfig) {
    if (ttsConfig.serviceUrl !== undefined) {
        set('tts.serviceUrl', ttsConfig.serviceUrl);
    }
    if (ttsConfig.defaultVoice !== undefined) {
        set('tts.defaultVoice', ttsConfig.defaultVoice);
    }
    if (ttsConfig.defaultSpeed !== undefined) {
        set('tts.defaultSpeed', ttsConfig.defaultSpeed);
    }
}

function getTtsConfig() {
    return {
        serviceUrl: get('tts.serviceUrl'),
        defaultVoice: get('tts.defaultVoice'),
        defaultSpeed: get('tts.defaultSpeed')
    };
}

function getDisplayState(ip) {
    const states = get('displayStates', {});
    const key = ip || 'default';
    return states[key] || { ...defaultDisplayState };
}

function setDisplayState(ip, state) {
    const states = get('displayStates', {});
    const key = ip || 'default';
    states[key] = state;
    set('displayStates', states);
}

function updateDisplayState(ip, partialState) {
    const currentState = getDisplayState(ip);
    const newState = { ...currentState, ...partialState };
    setDisplayState(ip, newState);
    return newState;
}

function addToPlaylist(ip, media) {
    const state = getDisplayState(ip);
    if (!state.playlist) {
        state.playlist = [];
    }
    state.playlist.push(media);
    setDisplayState(ip, state);
}

function removeFromPlaylist(ip, index) {
    const state = getDisplayState(ip);
    if (state.playlist && index >= 0 && index < state.playlist.length) {
        state.playlist.splice(index, 1);
        setDisplayState(ip, state);
    }
}

function clearPlaylist(ip) {
    const state = getDisplayState(ip);
    state.playlist = [];
    setDisplayState(ip, state);
}

function getPlaylist(ip) {
    const state = getDisplayState(ip);
    return state.playlist || [];
}

function getAllDisplayStates() {
    return get('displayStates', {});
}

module.exports = {
    loadConfig,
    saveConfig,
    getConfig,
    get,
    set,
    setTtsConfig,
    getTtsConfig,
    getDisplayState,
    setDisplayState,
    updateDisplayState,
    addToPlaylist,
    removeFromPlaylist,
    clearPlaylist,
    getPlaylist,
    getAllDisplayStates,
    defaultDisplayState
};
