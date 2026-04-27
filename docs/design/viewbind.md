# ViewBind 视图绑定

## 功能概述

ViewBind 是一个视图绑定模块，实现数据与视图的自动同步。当数据发生变化时，自动调用绑定的视图更新函数，实现数据驱动的 UI 更新。

## 功能描述

- 将数据与视图更新函数绑定
- 数据变化时自动调用绑定的视图更新函数
- 支持绑定多个视图更新函数
- 支持绑定/解绑操作
- 与 DataSnapshot 模块集成，实现数据持久化与视图同步

## 背景

项目中已有 Unity C# 版本的 viewbind 实现（历史路径为根目录 `viewbind/`，现已迁移清理），核心功能包括：

- `UIViewBind<T>` - 核心绑定类，管理数据与视图的绑定关系
- `UIViewBindList<T>` - 列表绑定类
- `UIViewBindDic<TKey, TData>` - 字典绑定类
- `UIBindComponent<T>` - UI组件绑定基类

本设计文档旨在将 viewbind 功能移植到 Node.js/JavaScript 环境，并与现有的 DataSnapshot 模块集成。

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                      应用层使用                              │
│         const bind = new ViewBind(data)                     │
│         bind.bind('key', callback)                          │
│         bind.data = newData  // 自动触发 callback           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   ViewBind (绑定管理)                        │
│              数据存储、绑定管理、变更通知                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              DataSnapshot (数据持久化)                       │
│              数据持久化、Proxy 代理                          │
└─────────────────────────────────────────────────────────────┘
```

## 设计目标

1. **数据驱动**：数据变化自动触发视图更新
2. **解耦设计**：数据层与视图层分离
3. **易于使用**：简单的 API 设计
4. **高性能**：避免不必要的更新，支持批量操作
5. **可扩展**：支持嵌套对象监听、列表绑定

## 核心类设计

### ViewBind 类

核心绑定类，管理数据与视图的绑定关系：

```javascript
class ViewBind {
    constructor(initialData)
    
    data                    // 当前数据
    oldData                 // 上一次数据
    
    bind(key, callback)     // 绑定视图更新函数
    unbind(key, callback)   // 解绑视图更新函数
    unbindAll(key)          // 解绑指定 key 的所有回调
    
    setData(data)           // 设置数据并触发更新
    getData()               // 获取当前数据
    notify(key)             // 手动触发更新通知
    
    bindCount               // 当前绑定数量
}
```

### ViewBindList 类

列表绑定类，用于管理数组数据的绑定：

```javascript
class ViewBindList {
    constructor(initialList)
    
    list                    // 当前列表
    count                   // 列表长度
    
    bind(callback)          // 绑定列表变化回调
    unbind(callback)        // 解绑列表变化回调
    
    get(index)              // 获取指定索引的 ViewBind
    push(item)              // 添加元素并触发更新
    remove(index)           // 移除元素并触发更新
    setList(newList)        // 设置新列表并触发更新
}
```

### DataSnapshot 扩展

在 DataSnapshot 基类中添加变更事件支持：

```javascript
class DataSnapshot {
    // 新增属性
    _bindings = new Map()   // 绑定映射表
    
    // 新增方法
    bind(key, callback)     // 绑定数据变更回调
    unbind(key, callback)   // 解绑数据变更回调
    
    // 修改 _save 方法
    _save() {
        // 保存文件
        // 触发变更通知
        this._notifyChange()
    }
    
    _notifyChange() {
        // 触发所有绑定的回调
    }
}
```

## 属性说明

### ViewBind

| 属性 | 类型 | 说明 |
|------|------|------|
| _data | any | 当前数据 |
| _oldData | any | 上一次数据 |
| _bindings | Map | 绑定映射表 (key -> callbacks[]) |
| _isNotifying | boolean | 是否正在触发通知 |

### ViewBindList

| 属性 | 类型 | 说明 |
|------|------|------|
| _list | Array | 内部列表数据 |
| _binds | Array<ViewBind> | 元素绑定列表 |
| _callbacks | Set | 列表变化回调集合 |

## 方法说明

### ViewBind

| 方法 | 参数 | 说明 |
|------|------|------|
| constructor | initialData | 初始化绑定数据 |
| bind | key, callback | 绑定视图更新函数，返回解绑函数 |
| unbind | key, callback | 解绑指定的视图更新函数 |
| unbindAll | key | 解绑指定 key 的所有回调 |
| setData | data | 设置新数据并触发更新 |
| notify | key | 手动触发指定 key 的更新通知 |

### ViewBindList

| 方法 | 参数 | 说明 |
|------|------|------|
| constructor | initialList | 初始化列表数据 |
| bind | callback | 绑定列表变化回调 |
| unbind | callback | 解绑列表变化回调 |
| get | index | 获取指定索引的 ViewBind |
| push | item | 添加元素并触发更新 |
| remove | index | 移除元素并触发更新 |
| setList | newList | 设置新列表并触发更新 |

## 使用示例

### 基础使用

```javascript
const { ViewBind } = require('./src/core/viewbind');

// 创建绑定
const displayBind = new ViewBind({
    id: 'display-1',
    ip: '192.168.1.100',
    status: 'connected'
});

// 绑定视图更新函数
displayBind.bind('status', (newData, oldData) => {
    console.log(`状态从 ${oldData.status} 变为 ${newData.status}`);
    updateStatusUI(newData.status);
});

// 修改数据，自动触发更新
displayBind.data.status = 'disconnected';
```

### 与 DataSnapshot 集成

```javascript
const DataSnapshot = require('./src/core/data-snapshot');

// 定义带绑定的配置类
class DisplayConfig extends DataSnapshot {
    static defaults = {
        displays: [],
        currentDisplay: null
    };
    
    bindDisplay(callback) {
        this.bind('displays', callback);
    }
}

// 使用
const displayConfig = new DisplayConfig('./config/displays.json');

// 绑定视图更新
displayConfig.bindDisplay((data) => {
    renderDisplayList(data.displays);
});

// 修改数据，自动保存并触发更新
displayConfig.displays.push({ id: 'display-2', ip: '192.168.1.101' });
```

### 列表绑定

```javascript
const { ViewBindList } = require('./src/core/viewbind');

// 创建列表绑定
const displayListBind = new ViewBindList([
    { id: 'display-1', ip: '192.168.1.100' },
    { id: 'display-2', ip: '192.168.1.101' }
]);

// 绑定列表变化
displayListBind.bind((list, oldList) => {
    console.log(`列表长度从 ${oldList.length} 变为 ${list.length}`);
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

### 前端使用

```javascript
// src/apps/web-mediacenter/ui/public/js/viewbind.js

class ViewBind {
    constructor(initialData) {
        this._data = initialData;
        this._oldData = null;
        this._bindings = new Map();
    }
    
    bind(key, callback) {
        if (!this._bindings.has(key)) {
            this._bindings.set(key, new Set());
        }
        this._bindings.get(key).add(callback);
        
        // 返回解绑函数
        return () => this.unbind(key, callback);
    }
    
    set data(value) {
        this._oldData = this._data;
        this._data = value;
        this._notifyAll();
    }
    
    _notifyAll() {
        for (const [key, callbacks] of this._bindings) {
            for (const callback of callbacks) {
                callback(this._data, this._oldData);
            }
        }
    }
}

// 使用示例
const displayBind = new ViewBind({ list: [] });

displayBind.bind('list', (data) => {
    DisplayList.list = data.list;
    DisplayList.render();
});

// 接收 WebSocket 消息更新
WebSocketManager.on('displayList', (list) => {
    displayBind.data = { list };
});
```

## 与现有模块的集成

| 模块 | 用途 | 改造方式 |
|------|------|----------|
| display-list.js | 显示端列表 | 使用 ViewBindList 管理显示端列表 |
| controls.js | 播放控制 | 使用 ViewBind 管理播放状态 |
| reminder.js | 提醒列表 | 使用 ViewBindList 管理提醒数据 |
| chat.js | 聊天记录 | 使用 ViewBindList 管理聊天消息 |

## 文件结构

```
src/core/
├── viewbind/
│   ├── index.js           # 模块入口
│   ├── ViewBind.js        # 核心绑定类
│   ├── ViewBindList.js    # 列表绑定类
│   └── ViewBind.test.js   # 单元测试

src/apps/web-mediacenter/ui/public/
├── js/
│   └── viewbind.js        # 前端绑定模块
```

## 实现计划

### 第一阶段：核心功能

1. 实现 ViewBind 类
   - 数据存储
   - 绑定/解绑管理
   - 变更通知

2. 实现 ViewBindList 类
   - 列表数据管理
   - 列表变化通知
   - 元素绑定

3. 单元测试
   - ViewBind 测试
   - ViewBindList 测试

### 第二阶段：DataSnapshot 集成

1. 扩展 DataSnapshot 类
   - 添加 bind/unbind 方法
   - 修改 _save 方法触发通知

2. 集成测试
   - DataSnapshot 与 ViewBind 集成测试

### 第三阶段：前端集成

1. 实现前端 ViewBind 模块
2. 改造现有前端模块
   - display-list.js
   - controls.js
   - reminder.js

## 注意事项

1. **避免循环更新**：在回调中修改数据可能导致无限循环
2. **内存泄漏**：及时解绑不再使用的回调
3. **性能优化**：批量操作时避免重复触发
4. **错误处理**：回调中的错误不应影响其他回调

## 参考

- Unity C# 版本 viewbind 实现：历史路径为 `viewbind/UIViewBind/`（已迁移清理）
- DataSnapshot 设计文档：[data-snapshot.md](data-snapshot.md)
