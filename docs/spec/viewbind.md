# ViewBind 视图绑定 - 项目实现文档

## 项目概述

ViewBind 是一个视图绑定模块，实现数据与视图的自动同步。当数据发生变化时，自动调用绑定的视图更新函数。

## 项目结构

```
src/core/
├── viewbind/
│   ├── index.js           # 模块入口
│   ├── ViewBind.js        # 核心绑定类
│   ├── ViewBindList.js    # 列表绑定类
│   └── ViewBind.test.js   # 单元测试
```

## 核心实现

### ViewBind 类

```javascript
class ViewBind {
    constructor(initialData) {
        this._data = initialData;
        this._oldData = null;
        this._bindings = new Map();
        this._isNotifying = false;
        this._pendingUnbinds = [];
        this._pendingBinds = [];
    }

    get data() { return this._data; }
    set data(value) {
        // 深度比较，避免相同数据触发通知
        if (this._deepEqual(this._data, value)) return;
        this._oldData = this._data;
        this._data = value;
        this._notifyAll();
    }

    bind(key, callback) {
        // 支持 bind(callback) 和 bind(key, callback) 两种形式
        if (typeof key === 'function') {
            callback = key;
            key = '*';
        }
        // 添加绑定并立即执行一次
        this._bindings.get(key).add(callback);
        callback(this._data, this._oldData);
        return () => this.unbind(key, callback);
    }

    unbind(key, callback) {
        // 支持在通知过程中延迟解绑
        if (this._isNotifying) {
            this._pendingUnbinds.push({ key, callback });
            return;
        }
        // 删除绑定
        this._bindings.get(key).delete(callback);
    }

    _notifyAll() {
        // 防止递归通知
        if (this._isNotifying) return;
        this._isNotifying = true;
        
        // 先执行通配符绑定
        for (const callback of this._bindings.get('*')) {
            this._safeCall(callback);
        }
        
        // 再执行指定 key 的绑定
        for (const [key, callbacks] of this._bindings) {
            if (key === '*') continue;
            for (const callback of callbacks) {
                this._safeCall(callback);
            }
        }
        
        this._isNotifying = false;
        this._processPending();
    }

    _safeCall(callback) {
        try {
            callback(this._data, this._oldData);
        } catch (err) {
            console.error('[ViewBind] 回调执行错误:', err.message);
        }
    }
}
```

### ViewBindList 类

```javascript
class ViewBindList {
    constructor(initialList = []) {
        this._list = [];
        this._binds = [];          // 每个元素的 ViewBind
        this._callbacks = new Set();
        this._isNotifying = false;
        this._pendingUnbinds = [];
        this._oldCount = 0;
        
        this.setList(initialList);
    }

    get(index) {
        // 返回指定索引的 ViewBind
        return this._binds[index];
    }

    push(item) {
        const oldList = [...this._list];
        this._oldCount = oldList.length;
        this._list.push(item);
        this._binds.push(new ViewBind(item));
        this._notifyAll(this._list, oldList);
        return this._list.length;
    }

    remove(index) {
        const oldList = [...this._list];
        this._oldCount = oldList.length;
        this._list.splice(index, 1);
        this._binds.splice(index, 1);
        this._notifyAll(this._list, oldList);
        return true;
    }

    setList(newList) {
        const oldList = this._list;
        this._oldCount = oldList.length;
        this._list = newList || [];
        
        // 为每个元素创建 ViewBind
        this._binds = this._list.map((item, index) => {
            if (this._binds[index] && this._binds[index].data === item) {
                return this._binds[index];
            }
            return new ViewBind(item);
        });
        
        this._notifyAll(this._list, oldList);
    }

    bind(callback) {
        this._callbacks.add(callback);
        // 立即执行一次
        callback(this._list, null, this._list.length, 0);
        return () => this.unbind(callback);
    }
}
```

### DataSnapshot 扩展

在 DataSnapshot 基类中添加绑定支持：

```javascript
class DataSnapshot {
    constructor(filePath) {
        // ... 原有代码 ...
        this._bindings = new Map();
        this._isNotifying = false;
        this._pendingUnbinds = [];
    }

    _save() {
        // ... 保存文件 ...
        this._notifyChange();  // 保存后触发通知
    }

    bind(key, callback) {
        // 与 ViewBind 相同的绑定逻辑
        if (typeof key === 'function') {
            callback = key;
            key = '*';
        }
        this._bindings.get(key).add(callback);
        callback(this._data, null);
        return () => this.unbind(key, callback);
    }

    unbind(key, callback) {
        // 支持延迟解绑
        if (this._isNotifying) {
            this._pendingUnbinds.push({ key, callback });
            return;
        }
        this._bindings.get(key).delete(callback);
    }

    _notifyChange() {
        // 与 ViewBind 相同的通知逻辑
        if (this._isNotifying) return;
        this._isNotifying = true;
        
        for (const callback of this._bindings.get('*')) {
            this._safeCall(callback);
        }
        for (const [key, callbacks] of this._bindings) {
            if (key === '*') continue;
            for (const callback of callbacks) {
                this._safeCall(callback);
            }
        }
        
        this._isNotifying = false;
    }
}
```

## 使用示例

### ViewBind 基础使用

```javascript
const { ViewBind } = require('./src/core/viewbind');

const displayBind = new ViewBind({
    id: 'display-1',
    ip: '192.168.1.100',
    status: 'connected'
});

// 绑定回调
displayBind.bind('status', (newData, oldData) => {
    console.log(`状态从 ${oldData?.status} 变为 ${newData.status}`);
    updateStatusUI(newData.status);
});

// 修改数据，自动触发更新
displayBind.data = { ...displayBind.data, status: 'disconnected' };
```

### ViewBindList 使用

```javascript
const { ViewBindList } = require('./src/core/viewbind');

const displayListBind = new ViewBindList([
    { id: 'display-1', ip: '192.168.1.100' },
    { id: 'display-2', ip: '192.168.1.101' }
]);

// 绑定列表变化
displayListBind.bind((list, oldList, newCount, oldCount) => {
    console.log(`列表长度从 ${oldCount} 变为 ${newCount}`);
    renderDisplayList(list);
});

// 获取单个元素的绑定
const firstDisplay = displayListBind.get(0);
firstDisplay.bind('ip', (data) => {
    console.log(`IP 变为 ${data.ip}`);
});

// 添加元素
displayListBind.push({ id: 'display-3', ip: '192.168.1.102' });
```

### DataSnapshot 绑定使用

```javascript
const DataSnapshot = require('./src/core/data-snapshot');

class DisplayConfig extends DataSnapshot {
    static defaults = {
        displays: [],
        currentDisplay: null
    };
}

const displayConfig = new DisplayConfig('./config/displays.json');

// 绑定数据变更
displayConfig.bind('displays', (data) => {
    renderDisplayList(data.displays);
});

// 修改数据，自动保存并触发更新
displayConfig.displays.push({ id: 'display-2', ip: '192.168.1.101' });
```

## 单元测试

### ViewBind 测试（10 个用例）

1. 创建 ViewBind 实例，验证初始数据
2. 绑定回调，修改数据，验证回调触发
3. 绑定多个回调，验证全部触发
4. 解绑回调，验证不再触发
5. 使用 key 绑定，验证指定 key 触发
6. 使用 set 方法修改属性
7. 使用 update 方法批量更新
8. 相同数据不触发回调
9. 手动触发通知
10. unbindAll 清除所有绑定

### ViewBindList 测试（13 个用例）

1. 创建 ViewBindList 实例，验证初始列表
2. 绑定回调，添加元素，验证回调触发
3. 移除元素，验证回调触发
4. 获取元素 ViewBind，修改元素
5. 设置新列表，验证回调触发
6. insert 方法插入元素
7. pop 方法移除最后一个元素
8. clear 方法清空列表
9. 解绑回调，验证不再触发
10. forEach 遍历列表
11. map 映射列表
12. filter 过滤列表
13. find 查找元素

### DataSnapshot 绑定测试（6 个用例）

1. 绑定回调，修改属性触发通知
2. 解绑回调，不再触发通知
3. 使用 key 绑定特定属性
4. 绑定多个回调
5. unbindAll 清除所有绑定
6. 嵌套对象修改触发通知

## 技术栈

- Node.js
- 原生 JavaScript
- Map/Set 数据结构

## 相关文档

- 设计文档：[design/viewbind.md](../design/viewbind.md)
- DataSnapshot 实现文档：[data-snapshot.md](data-snapshot.md)
