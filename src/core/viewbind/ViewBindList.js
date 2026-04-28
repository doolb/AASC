const ViewBind = require('./ViewBind');

class ViewBindList {
    constructor(initialList = []) {
        this._list = [];
        this._binds = [];
        this._callbacks = new Set();
        this._isNotifying = false;
        this._pendingNotifyAll = false;
        this._pendingUnbinds = [];
        this._oldCount = 0;

        this.setList(initialList);
    }

    get list() {
        return this._list;
    }

    get count() {
        return this._list.length;
    }

    get bindCount() {
        return this._callbacks.size;
    }

    get(index) {
        if (index < 0 || index >= this._binds.length) {
            return null;
        }
        return this._binds[index];
    }

    setList(newList) {
        const oldList = this._list;
        this._oldCount = oldList.length;
        this._list = newList || [];

        const dataQueues = new Map();
        for (const bind of this._binds) {
            const key = bind.data;
            if (!dataQueues.has(key)) {
                dataQueues.set(key, []);
            }
            dataQueues.get(key).push(bind);
        }

        this._binds = this._list.map((item) => {
            const queue = dataQueues.get(item);
            if (queue && queue.length > 0) {
                return queue.shift();
            }
            return new ViewBind(item);
        });

        this._notifyAll(this._list, oldList);
    }

    push(item) {
        const oldList = [...this._list];
        this._oldCount = oldList.length;
        this._list.push(item);
        this._binds.push(new ViewBind(item));
        this._notifyAll(this._list, oldList);
        return this._list.length;
    }

    pop() {
        if (this._list.length === 0) {
            return undefined;
        }
        const oldList = [...this._list];
        this._oldCount = oldList.length;
        const item = this._list.pop();
        this._binds.pop();
        this._notifyAll(this._list, oldList);
        return item;
    }

    remove(index) {
        if (index < 0 || index >= this._list.length) {
            return false;
        }
        const oldList = [...this._list];
        this._oldCount = oldList.length;
        this._list.splice(index, 1);
        this._binds.splice(index, 1);
        this._notifyAll(this._list, oldList);
        return true;
    }

    insert(index, item) {
        if (index < 0 || index > this._list.length) {
            return false;
        }
        const oldList = [...this._list];
        this._oldCount = oldList.length;
        this._list.splice(index, 0, item);
        this._binds.splice(index, 0, new ViewBind(item));
        this._notifyAll(this._list, oldList);
        return true;
    }

    update(index, item) {
        if (index < 0 || index >= this._list.length) {
            return false;
        }
        this._list[index] = item;
        if (this._binds[index]) {
            this._binds[index].data = item;
        }
        return true;
    }

    clear() {
        if (this._list.length === 0) {
            return;
        }
        const oldList = [...this._list];
        this._oldCount = oldList.length;
        this._list = [];
        this._binds = [];
        this._notifyAll(this._list, oldList);
    }

    bind(callback) {
        this._callbacks.add(callback);
        callback(this._list, null, this._list.length, 0);

        return () => this.unbind(callback);
    }

    unbind(callback) {
        if (this._isNotifying) {
            this._pendingUnbinds.push(callback);
            return;
        }
        this._callbacks.delete(callback);
    }

    unbindAll() {
        this._callbacks.clear();
    }

    _notifyAll(newList, oldList) {
        if (this._isNotifying) {
            this._pendingNotifyAll = true;
            return;
        }

        this._isNotifying = true;

        const newCount = newList.length;
        const oldCount = this._oldCount;

        const snapshot = new Set(this._callbacks);
        for (const callback of snapshot) {
            if (this._callbacks.has(callback)) {
                this._safeCall(callback, newList, oldList, newCount, oldCount);
            }
        }

        this._isNotifying = false;

        for (const callback of this._pendingUnbinds) {
            this._callbacks.delete(callback);
        }
        this._pendingUnbinds = [];

        if (this._pendingNotifyAll) {
            this._pendingNotifyAll = false;
            this._notifyAll(newList, oldList);
        }
    }

    _safeCall(callback, newList, oldList, newCount, oldCount) {
        try {
            callback(newList, oldList, newCount, oldCount);
        } catch (err) {
            console.error('[ViewBindList] 回调执行错误:', err.message);
        }
    }

    forEach(fn) {
        for (let i = 0; i < this._list.length; i++) {
            fn(this._list[i], i, this._binds[i]);
        }
    }

    map(fn) {
        return this._list.map((item, index) => fn(item, index, this._binds[index]));
    }

    filter(fn) {
        return this._list.filter((item, index) => fn(item, index, this._binds[index]));
    }

    find(fn) {
        return this._list.find((item, index) => fn(item, index, this._binds[index]));
    }

    findIndex(fn) {
        return this._list.findIndex((item, index) => fn(item, index, this._binds[index]));
    }

    toJSON() {
        return this._list;
    }

    toString() {
        return JSON.stringify(this._list, null, 2);
    }
}

module.exports = ViewBindList;
