const fs = require('fs');
const path = require('path');

class DataSnapshot {
    constructor(filePath) {
        this._filePath = path.resolve(filePath);
        this._data = this._deepClone(this.constructor.defaults);
        this._loaded = false;
        this._saving = false;
        this._pendingSave = false;
        this._bindings = new Map();
        this._isNotifying = false;
        this._pendingUnbinds = [];
        this._load();
        return new Proxy(this, this._createHandler());
    }

    static defaults = {};

    _deepClone(obj) {
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }
        if (Array.isArray(obj)) {
            return obj.map(item => this._deepClone(item));
        }
        const cloned = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                cloned[key] = this._deepClone(obj[key]);
            }
        }
        return cloned;
    }

    _deepMerge(target, source) {
        const result = this._deepClone(target);
        for (const key in source) {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
                if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    result[key] = this._deepMerge(result[key] || {}, source[key]);
                } else {
                    result[key] = source[key];
                }
            }
        }
        return result;
    }

    _createHandler() {
        const self = this;

        const createNestedProxy = (obj, path = []) => {
            if (obj === null || typeof obj !== 'object') {
                return obj;
            }

            const handler = {
                get(target, prop) {
                    if (typeof prop === 'symbol') {
                        return target[prop];
                    }
                    const value = target[prop];
                    if (value && typeof value === 'object') {
                        return createNestedProxy(value, [...path, prop]);
                    }
                    return value;
                },

                set(target, prop, value) {
                    if (typeof prop === 'symbol') {
                        target[prop] = value;
                        return true;
                    }
                    target[prop] = value;
                    self._save();
                    return true;
                },

                deleteProperty(target, prop) {
                    if (prop in target) {
                        delete target[prop];
                        self._save();
                        return true;
                    }
                    return false;
                }
            };

            return new Proxy(obj, handler);
        };

        return {
            get(target, prop) {
                if (typeof prop === 'symbol') {
                    return target[prop];
                }
                if (prop.startsWith('_') || prop in target) {
                    return target[prop];
                }
                const value = target._data[prop];
                if (value && typeof value === 'object') {
                    return createNestedProxy(value, [prop]);
                }
                return value;
            },

            set(target, prop, value) {
                if (typeof prop === 'symbol') {
                    target[prop] = value;
                    return true;
                }
                if (prop.startsWith('_')) {
                    target[prop] = value;
                    return true;
                }
                target._data[prop] = value;
                target._save();
                return true;
            },

            deleteProperty(target, prop) {
                if (prop in target._data) {
                    delete target._data[prop];
                    target._save();
                    return true;
                }
                return false;
            },

            ownKeys(target) {
                return Reflect.ownKeys(target._data);
            },

            getOwnPropertyDescriptor(target, prop) {
                if (prop in target._data) {
                    return {
                        enumerable: true,
                        configurable: true,
                        value: target._data[prop]
                    };
                }
                return undefined;
            }
        };
    }

    _load() {
        try {
            const dir = path.dirname(this._filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            if (fs.existsSync(this._filePath)) {
                const data = fs.readFileSync(this._filePath, 'utf8');
                const loaded = JSON.parse(data);
                this._data = this._deepMerge(this.constructor.defaults, loaded);
            }
            this._loaded = true;
        } catch (err) {
            console.error(`[DataSnapshot] 加载失败: ${this._filePath}`, err.message);
            this._data = this._deepClone(this.constructor.defaults);
        }
    }

    _save() {
        if (this._saving) {
            this._pendingSave = true;
            return;
        }
        this._saving = true;
        try {
            const dir = path.dirname(this._filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const json = JSON.stringify(this._data, null, 2);
            fs.writeFileSync(this._filePath, json, 'utf8');
            this._notifyChange();
        } catch (err) {
            console.error(`[DataSnapshot] 保存失败: ${this._filePath}`, err.message);
        } finally {
            this._saving = false;
            if (this._pendingSave) {
                this._pendingSave = false;
                this._save();
            }
        }
    }

    bind(key, callback) {
        if (typeof key === 'function') {
            callback = key;
            key = '*';
        }

        if (!this._bindings.has(key)) {
            this._bindings.set(key, new Set());
        }

        this._bindings.get(key).add(callback);

        callback(this._data, null);

        return () => this.unbind(key, callback);
    }

    unbind(key, callback) {
        if (typeof key === 'function') {
            callback = key;
            key = '*';
        }

        if (this._isNotifying) {
            this._pendingUnbinds.push({ key, callback });
            return;
        }

        const callbacks = this._bindings.get(key);
        if (callbacks) {
            callbacks.delete(callback);
            if (callbacks.size === 0) {
                this._bindings.delete(key);
            }
        }
    }

    unbindAll(key) {
        if (key === undefined) {
            this._bindings.clear();
        } else {
            this._bindings.delete(key);
        }
    }

    _notifyChange() {
        if (this._isNotifying) {
            return;
        }

        this._isNotifying = true;

        const allCallbacks = this._bindings.get('*');
        if (allCallbacks) {
            for (const callback of allCallbacks) {
                this._safeCall(callback);
            }
        }

        for (const [key, callbacks] of this._bindings) {
            if (key === '*') continue;
            for (const callback of callbacks) {
                this._safeCall(callback);
            }
        }

        this._isNotifying = false;

        for (const { key, callback } of this._pendingUnbinds) {
            this.unbind(key, callback);
        }
        this._pendingUnbinds = [];
    }

    _safeCall(callback) {
        try {
            callback(this._data, null);
        } catch (err) {
            console.error('[DataSnapshot] 回调执行错误:', err.message);
        }
    }

    get bindCount() {
        return this._bindings.size;
    }

    batch(fn) {
        this._saving = true;
        try {
            fn(this._data);
        } finally {
            this._saving = false;
            this._save();
        }
    }

    toJSON() {
        return this._data;
    }

    toString() {
        return JSON.stringify(this._data, null, 2);
    }

    get filePath() {
        return this._filePath;
    }

    get loaded() {
        return this._loaded;
    }
}

module.exports = DataSnapshot;
