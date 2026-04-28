class StateManager {
    constructor(options = {}) {
        this.states = new Map();
        this.stateHistory = new Map();
        this.maxHistorySize = options.maxHistorySize || 100;
        this.persistCallback = options.persistCallback || null;
        this.loadCallback = options.loadCallback || null;
        
        this._initDefaultStates();
    }

    _initDefaultStates() {
        this.registerState('displayClients', {
            defaultValue: new Map(),
            persist: true
        });

        this.registerState('controlClients', {
            defaultValue: new Set(),
            persist: false
        });

        this.registerState('muteState', {
            defaultValue: {
                isMuted: false,
                previousVolumes: new Map()
            },
            persist: true
        });

        this.registerState('serverStartTime', {
            defaultValue: Date.now(),
            persist: false
        });
    }

    registerState(name, config = {}) {
        this.states.set(name, {
            value: config.defaultValue !== undefined ? config.defaultValue : null,
            config: {
                persist: config.persist || false,
                validate: config.validate || null,
                transform: config.transform || null,
                ...config
            }
        });
        return this;
    }

    get(name, defaultValue = null) {
        const state = this.states.get(name);
        if (!state) {
            return defaultValue;
        }
        return state.value;
    }

    set(name, value, options = {}) {
        const state = this.states.get(name);
        
        if (!state) {
            this.registerState(name, { defaultValue: value });
            return value;
        }

        if (state.config.validate) {
            const validationResult = state.config.validate(value);
            if (!validationResult.valid) {
                throw new Error(`状态验证失败: ${validationResult.error}`);
            }
        }

        let finalValue = value;
        if (state.config.transform) {
            finalValue = state.config.transform(value, state.value);
        }

        if (options.trackHistory !== false) {
            this._trackHistory(name, state.value);
        }

        state.value = finalValue;

        if (state.config.persist && this.persistCallback) {
            this.persistCallback(name, finalValue);
        }

        return finalValue;
    }

    update(name, updater, options = {}) {
        const currentValue = this.get(name);
        const newValue = typeof updater === 'function' ? updater(currentValue) : updater;
        return this.set(name, newValue, options);
    }

    delete(name) {
        const state = this.states.get(name);
        if (state) {
            this._trackHistory(name, state.value);
            this.states.delete(name);
            return true;
        }
        return false;
    }

    has(name) {
        return this.states.has(name);
    }

    clear(name) {
        if (name) {
            const state = this.states.get(name);
            if (state) {
                this._trackHistory(name, state.value);
                state.value = state.config.defaultValue !== undefined ? state.config.defaultValue : null;
            }
        } else {
            for (const [key, state] of this.states) {
                this._trackHistory(key, state.value);
                state.value = state.config.defaultValue !== undefined ? state.config.defaultValue : null;
            }
        }
        return this;
    }

    _trackHistory(name, value) {
        if (!this.stateHistory.has(name)) {
            this.stateHistory.set(name, []);
        }

        const history = this.stateHistory.get(name);
        history.push({
            value: this._cloneValue(value),
            timestamp: Date.now()
        });

        while (history.length > this.maxHistorySize) {
            const old = history.shift();
            if (old && old.value) {
                if (old.value instanceof Map) old.value.clear();
                if (old.value instanceof Set) old.value.clear();
            }
        }
    }

    _cloneValue(value) {
        if (value === null || value === undefined) {
            return value;
        }

        if (value instanceof Map) {
            return { __type: 'MapSnapshot', size: value.size, keys: Array.from(value.keys()) };
        }

        if (value instanceof Set) {
            return { __type: 'SetSnapshot', size: value.size };
        }

        if (Array.isArray(value)) {
            return [...value];
        }

        if (typeof value === 'object') {
            return { ...value };
        }

        return value;
    }

    getHistory(name) {
        return this.stateHistory.get(name) || [];
    }

    undo(name) {
        const history = this.stateHistory.get(name);
        if (!history || history.length === 0) {
            return null;
        }

        const previous = history.pop();
        const state = this.states.get(name);
        if (state) {
            state.value = previous.value;
        }

        return previous.value;
    }

    exportState() {
        const exported = {};
        for (const [name, state] of this.states) {
            if (state.config.persist) {
                exported[name] = this._serializeValue(state.value);
            }
        }
        return exported;
    }

    importState(data) {
        for (const [name, value] of Object.entries(data)) {
            if (this.states.has(name)) {
                const state = this.states.get(name);
                state.value = this._deserializeValue(value);
            }
        }
        return this;
    }

    _serializeValue(value) {
        if (value instanceof Map) {
            return {
                __type: 'Map',
                data: Array.from(value.entries())
            };
        }

        if (value instanceof Set) {
            return {
                __type: 'Set',
                data: Array.from(value.values())
            };
        }

        return value;
    }

    _deserializeValue(serialized) {
        if (serialized && typeof serialized === 'object') {
            if (serialized.__type === 'Map') {
                return new Map(serialized.data);
            }

            if (serialized.__type === 'Set') {
                return new Set(serialized.data);
            }
        }

        return serialized;
    }

    getDisplayClient(displayId) {
        const displayClients = this.get('displayClients');
        return displayClients?.get(displayId);
    }

    setDisplayClient(displayId, data) {
        return this.update('displayClients', (clients) => {
            if (!clients) clients = new Map();
            clients.set(displayId, data);
            return clients;
        });
    }

    removeDisplayClient(displayId) {
        return this.update('displayClients', (clients) => {
            if (clients) clients.delete(displayId);
            return clients;
        });
    }

    getDisplayList() {
        const displayClients = this.get('displayClients');
        if (!displayClients) return [];

        const list = [];
        displayClients.forEach((data, id) => {
            list.push({
                id: id,
                ip: data.ip,
                isSubDisplay: data.isSubDisplay || data.state?.isSubDisplay || false,
                canvasSize: data.state?.canvasSize,
                rotation: data.state?.rotation || 0,
                browserInfo: data.state?.browserInfo,
                voiceSupported: data.state?.voiceSupported,
                voiceListening: data.state?.voiceListening,
                capabilities: data.state?.capabilities || null
            });
        });
        return list;
    }

    static create(options = {}) {
        return new StateManager(options);
    }
}

module.exports = { StateManager };
