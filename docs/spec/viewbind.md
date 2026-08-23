# ViewBind 视图绑定 - 项目实现文档

## 项目概述

ViewBind 是一个视图绑定模块，实现数据与视图的自动同步。当数据发生变化时，自动调用绑定的视图更新函数。

## 项目结构

```
src/core/
├── viewbind/
│   ├── index.js                        # 模块入口
│   ├── ViewBind.js                     # 核心绑定类
│   ├── ViewBindList.js                 # 列表绑定类
│   ├── ViewBind.test.js                # 单元测试（30 用例）
│   ├── ViewBind.self-test.js           # 通信机制自测（46 用例）
│   └── ViewBind.integration.test.js    # 真实环境集成自测（45 用例）
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
        // 重入检测：通知中绑定则加入 pendingBinds，通知结束后补发
        if (this._isNotifying) {
            this._pendingBinds.push({ key, callback });
            return () => this.unbind(key, callback);
        }
        // 添加绑定并立即执行一次
        this._bindings.get(key).add(callback);
        callback(this._data, this._oldData);
        return () => this.unbind(key, callback);
    }

    unbind(key, callback) {
        // 立即从 Set 中删除（"立即生效"语义）
        if (typeof key === 'function') {
            callback = key;
            key = '*';
        }
        const callbacks = this._bindings.get(key);
        if (!callbacks) return;
        callbacks.delete(callback);
        // 通配 key 的空 Set 清理延迟到通知结束后处理
        if (callbacks.size === 0) {
            if (this._isNotifying) {
                this._pendingUnbinds.push({ key });
            } else {
                this._bindings.delete(key);
            }
        }
    }

    _notifyAll() {
        // 重入检测：设置 pendingNotifyAll 标志，通知结束后补发一轮
        if (this._isNotifying) {
            this._pendingNotifyAll = true;
            return;
        }
        this._isNotifying = true;

        // 快照当前 callbacks，避免迭代中修改影响遍历
        const snapshot = [];
        for (const [key, callbacks] of this._bindings) {
            snapshot.push({ key, callbacks: new Set(callbacks) });
        }

        // 遍历快照，但仅执行仍处于当前绑定集合中的回调
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

        // 处理 pendingBinds：添加 & 补发
        for (const { key, callback } of this._pendingBinds) {
            if (!this._bindings.has(key)) {
                this._bindings.set(key, new Set());
            }
            this._bindings.get(key).add(callback);
            this._safeCall(callback);
        }
        this._pendingBinds = [];

        // 处理 pendingUnbinds：清除空 key
        for (const { key } of this._pendingUnbinds) {
            if (this._bindings.has(key) && this._bindings.get(key).size === 0) {
                this._bindings.delete(key);
            }
        }
        this._pendingUnbinds = [];

        // 补帧：本轮通知中有数据修改则再执行一轮
        if (this._pendingNotifyAll) {
            this._pendingNotifyAll = false;
            this._notifyAll();
        }
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

        // 按 data 引用重建索引：Map<dataRef, Queue<ViewBind>>
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
                return queue.shift();  // 复用匹配的 ViewBind
            }
            return new ViewBind(item); // 无匹配则新建
        });

        this._notifyAll(this._list, oldList);
    }

    _notifyAll(newList, oldList) {
        if (this._isNotifying) {
            this._pendingNotifyAll = true;
            return;
        }
        this._isNotifying = true;

        const snapshot = new Set(this._callbacks);
        for (const callback of snapshot) {
            if (this._callbacks.has(callback)) {
                this._safeCall(callback, newList, oldList, newList.length, this._oldCount);
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

### ViewBind 测试（14 个用例）

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
11. 回调中解绑立即生效
12. 回调中绑定会补发
13. 回调中改数据补帧刷新
14. 回调中替换回调函数

### ViewBindList 测试（16 个用例）

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
14. List 长度回调 old/new 正确
15. List 按 data 定位刷新正确
16. List 排序后索引重建正确

## 通信机制自测

`ViewBind.self-test.js` 是 ViewBind 作为数据驱动通信机制的专项自测，共 **46 个用例**，覆盖以下场景：

### 1. 基础通信模式（4 用例）
- 数据变更通知订阅者
- 多订阅者全部收到通知
- 取消订阅后不再收到通知
- 指定 key 订阅：全量 data 替换触发所有 key，notify(key) 精准触发

### 2. 生产-消费通信模式（3 用例）
- 生产者推送数据，消费者接收
- 一对多：一个数据源通知多个 key 订阅者
- 多对一：多个生产者写入同一 channel

### 3. 重入一致性（5 用例）
- 通知中解绑：已取消的回调不再触发
- 通知中绑定：新绑定立即补发一次
- 通知中改数据：补帧刷新
- 通知中替换回调：旧回调取消新回调注册
- 深层重入：嵌套 setData 补帧刷新

### 4. 列表通信模式（5 用例）
- 新增/删除元素通知
- setList 按 data 引用复用 ViewBind
- 插入和弹出
- 更新指定元素触发对应 ViewBind

### 5. 链式通信（3 用例）
- ViewBind 级联：一个变化触发链式更新
- ViewBind 管道：数据经过多个变换
- ViewBindList + ViewBind 联动

### 6. 边界情况（9 用例）
- null/相同数据去重、unbindAll(key)、deepEqual 数组比较
- notify/notify(key) 手动触发、set/get/update 方法

### 7. 错误隔离（2 用例）
- 一个回调出错不影响其他回调
- 错误回调后正常回调仍需触发

### 8. 通信可靠性（5 用例）
- 高频连续 setData 全部送达、大量订阅者全部收到
- ViewBindList 高频 push 全部通知
- 解绑后不泄漏、多次解绑不报错

### 9. 资源清理（4 用例）
- ViewBind/ViewBindList 全部解绑后 bindCount 归零
- clear 后 count 归零、空列表操作不报错

### 10. 列表迭代方法（5 用例）
- forEach/map/filter/find/findIndex

### 11. 异步综合场景（1 用例）
- 生产者延迟推送验证

### DataSnapshot 绑定测试（6 个用例）

1. 绑定回调，修改属性触发通知
2. 解绑回调，不再触发通知
3. 使用 key 绑定特定属性
4. 绑定多个回调
5. unbindAll 清除所有绑定
6. 嵌套对象修改触发通知

## 真实环境集成自测

`ViewBind.integration.test.js` 是 ViewBind 在 WebSocket 真实通信环境中的集成自测，共 **45 个用例**，覆盖以下场景：

### 1. 服务器生命周期（2 用例）
- 服务器启动后 WS 端口可用
- 服务器关闭后端口不可用

### 2. 单显示端连接（4 用例）
- 控制端收到 displayList
- 显示端收到 displayId 和 serverStartTime
- displayId 格式正确
- serverStartTime 带有效时间戳

### 3. 多显示端并发连接（5 用例）
- 3/5 个显示端并发全部追踪
- 每个显示端收到唯一 displayId
- 延迟连接也被追踪
- 后连接显示端的列表包含全部

### 4. 多控制端连接（3 用例）
- 多个控制端都收到 displayList
- 已存在控制端收到新显示端加入通知
- 后连接控制端看到已有全部显示端

### 5. 显示端断连（4 用例）
- 断开后控制端收到更新列表
- 全部断开后列表为空
- 断开后可接受新连接
- 重复断连不报错

### 6. 消息通信（5 用例）
- 心跳-确认往返
- commandAck 转发到控制端（成功/失败）
- commandAck 携带 displayId
- 多个控制端都收到 commandAck

### 7. 控制端到显示端转发（4 用例）
- 控制端发送 media 到指定显示端
- 控制端发送 control 命令到显示端
- 多个控制端可控制同一个显示端
- 控制端发送 getState 获取状态

### 8. 显示端状态上报（3 用例）
- canvasSize 广播到控制端
- browserInfo 广播到控制端
- 自定义 stateUpdate 广播

### 9. ViewBind 集成自动通知（3 用例）
- ViewBindList push 自动触发 displayList 广播
- ViewBindList remove 自动触发 displayList 广播
- sanitize 过滤不暴露 ws 对象

### 10. 边界情况（5 用例）
- 无效 JSON 不崩溃
- 未知消息类型不崩溃
- 空消息不崩溃
- 不存在的连接路径不崩溃
- 连接后立即发送消息

### 11. 压力场景（5 用例）
- 10 个显示端并发
- 10 个控制端并发
- 急速连接断开循环
- 大量消息快速发送不丢失（20条 commandAck）
- 30 个高频心跳不丢包

### 12. 服务器长时间运行（2 用例）
- 长时间运行无异常
- 服务器状态保持正确

## 技术栈

- Node.js
- 原生 JavaScript
- Map/Set 数据结构

## 相关文档

- 设计文档：[design/viewbind.md](../design/viewbind.md)
- DataSnapshot 实现文档：[data-snapshot.md](data-snapshot.md)

## 显示端同 ID 重连清理

```text
handleDisplayConnect(displayId, clientIP, ws, savedState):
    previous = _displayMap.get(displayId)
    如果 previous 存在:
        移除 previous 对应的 displayClients 记录
        previous.disconnect()
        删除 _displayMap[displayId]
    创建并登记新的 ViewBind(displayId, ws)

handleDisplayDisconnect(displayId, ws):
    current = _displayMap.get(displayId)
    如果 ws 存在且 (current 不存在 或 current.data.ws !== ws):
        返回 false
    移除 current 和列表记录
    执行 onDisplayDisconnect
    返回 true
```

该规则保证页面刷新、网络重连和 Agent 测试浏览器复用 `displayId` 时不会产生重复显示端或误删新连接。
