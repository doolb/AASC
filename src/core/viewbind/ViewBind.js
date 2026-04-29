class ViewBind {
    constructor(initialData) {
        this._data = initialData;
        this._oldData = null;
        this._bindings = new Map();
        this._isNotifying = false;
        this._pendingNotifyAll = false;
        this._pendingUnbinds = [];
        this._pendingBinds = [];
        this._transport = null;           // connect 设置的传输实例
        this._transportSend = null;        // 缓存 transport.send
        this._transportUnsubscribe = null; // onReceive 取消函数
        this._syncEnabled = true;          // 同步开关
    }

    get data() {
        return this._data;
    }

    set data(value) {
        if (this._data === value) {
            return;
        }
        if (this._data === null && value === null) {
            return;
        }
        if (this._data !== null && value !== null && this._deepEqual(this._data, value)) {
            return;
        }
        this._oldData = this._data;
        this._data = value;
        this._notifyAll();
        // 数据变化后自动同步到远端 // ViewBind.connect 机制
        if (this._transportSend && this._syncEnabled) {
            this._transportSend(this._data);
        }
    }

    get oldData() {
        return this._oldData;
    }

    get bindCount() {
        return this._bindings.size;
    }

    _deepEqual(a, b) {
        if (a === b) return true;
        if (a === null || b === null) return false;
        if (typeof a !== 'object' || typeof b !== 'object') return false;
        if (Array.isArray(a) !== Array.isArray(b)) return false;

        const keysA = Object.keys(a);
        const keysB = Object.keys(b);

        if (keysA.length !== keysB.length) return false;

        for (const key of keysA) {
            if (!keysB.includes(key)) return false;
            if (!this._deepEqual(a[key], b[key])) return false;
        }

        return true;
    }

    bind(key, callback) {
        if (typeof key === 'function') {
            callback = key;
            key = '*';
        }

        if (this._isNotifying) {
            this._pendingBinds.push({ key, callback });
            return () => this.unbind(key, callback);
        }

        if (!this._bindings.has(key)) {
            this._bindings.set(key, new Set());
        }

        this._bindings.get(key).add(callback);

        callback(this._data, this._oldData);

        return () => this.unbind(key, callback);
    }

    unbind(key, callback) {
        if (typeof key === 'function') {
            callback = key;
            key = '*';
        }

        const callbacks = this._bindings.get(key);
        if (!callbacks) return;

        callbacks.delete(callback);
        if (callbacks.size === 0) {
            if (this._isNotifying) {
                this._pendingUnbinds.push({ key });
            } else {
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

    setData(data) {
        this.data = data;
    }

    getData() {
        return this._data;
    }

    notify(key) {
        if (key === undefined) {
            this._notifyAll();
        } else {
            this._notifyKey(key);
        }
    }

    _notifyAll() {
        if (this._isNotifying) {
            this._pendingNotifyAll = true;
            return;
        }

        this._isNotifying = true;

        const snapshot = [];
        for (const [key, callbacks] of this._bindings) {
            snapshot.push({ key, callbacks: new Set(callbacks) });
        }

        for (const { key, callbacks } of snapshot) {
            const currentSet = this._bindings.get(key);
            if (!currentSet) continue;
            for (const callback of callbacks) {
                if (currentSet.has(callback)) {
                    this._safeCall(callback);
                }
            }
        }

        this._isNotifying = false;

        for (const { key, callback } of this._pendingBinds) {
            if (!this._bindings.has(key)) {
                this._bindings.set(key, new Set());
            }
            this._bindings.get(key).add(callback);
            this._safeCall(callback);
        }
        this._pendingBinds = [];

        for (const { key } of this._pendingUnbinds) {
            if (this._bindings.has(key) && this._bindings.get(key).size === 0) {
                this._bindings.delete(key);
            }
        }
        this._pendingUnbinds = [];

        if (this._pendingNotifyAll) {
            this._pendingNotifyAll = false;
            this._notifyAll();
        }
    }

    _notifyKey(key) {
        const callbacks = this._bindings.get(key);
        if (callbacks) {
            for (const callback of callbacks) {
                this._safeCall(callback);
            }
        }
    }

    _safeCall(callback) {
        try {
            callback(this._data, this._oldData);
        } catch (err) {
            console.error('[ViewBind] 回调执行错误:', err.message);
        }
    }

    get(key) {
        if (this._data === null || this._data === undefined) {
            return undefined;
        }
        return this._data[key];
    }

    set(key, value) {
        if (this._data === null || this._data === undefined) {
            this._data = {};
        }
        this._oldData = this._data;
        this._data[key] = value;
        this._notifyAll();
    }

    update(updater) {
        if (typeof updater !== 'function') {
            return;
        }
        this._oldData = this._data;
        updater(this._data);
        this._notifyAll();
    }

    // connect 字段：设置外部传输实现，数据变化自动同步到远端 // 注入 TransportConnector
    set connect(transport) {
        if (this._transport) {
            this.disconnect();
        }
        if (!transport) return;
        this._transport = transport;
        this._transportSend = typeof transport.send === 'function' ? transport.send.bind(transport) : null;
        if (typeof transport.onReceive === 'function') {
            this._transportUnsubscribe = transport.onReceive((data) => {
                if (data !== undefined && data !== null) {
                    this.data = data;
                }
            });
        }
    }

    get connect() {
        return this._transport;
    }

    // 断开连接，清理传输资源 // 关闭 WS 连接并释放引用
    disconnect() {
        if (this._transportUnsubscribe) {
            this._transportUnsubscribe();
            this._transportUnsubscribe = null;
        }
        if (this._transport && typeof this._transport.close === 'function') {
            this._transport.close();
        }
        this._transport = null;
        this._transportSend = null;
        this._syncEnabled = true;
    }

    // 暂停数据同步到远端 // 用于批量操作避免频繁发送
    pauseSync() {
        this._syncEnabled = false;
    }

    // 恢复数据同步，立即发送当前数据 // 恢复后同步最新状态
    resumeSync() {
        this._syncEnabled = true;
        if (this._transportSend) {
            this._transportSend(this._data);
        }
    }

    toJSON() {
        return this._data;
    }

    toString() {
        return JSON.stringify(this._data, null, 2);
    }
}

module.exports = ViewBind;
