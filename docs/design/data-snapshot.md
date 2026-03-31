# DataSnapshot 数据快照

## 功能概述

DataSnapshot 是一个数据快照模块，将内存中实例的数据以文件的形式存储，方便调试和数据持久化。

## 功能描述

- 将内存中实例的数据，以文件的形式存储
- 可以方便地从文件中查看数据，方便调试
- 下次运行可以从文件中读取数据，方便调试
- **提供基类，应用层可以像普通类一样写入和获取数据**

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                      应用层类定义                            │
│         class MyConfig extends DataSnapshot { }             │
│                    const config = new MyConfig()            │
│                    config.name = 'test'  // 自动保存        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   DataSnapshot (基类)                        │
│              Proxy 代理属性访问                              │
│              自动加载/保存数据                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   JsonFile (文件操作)                        │
│              JSON 文件读写实现                               │
└─────────────────────────────────────────────────────────────┘
```

## 设计目标

1. **数据持久化**：将内存数据保存到文件
2. **调试友好**：文件格式可读，方便调试
3. **透明访问**：像普通类属性一样访问数据，自动处理读写
4. **类型安全**：支持默认值定义
5. **可扩展性**：易于添加新的文件类型

## 核心类设计

### DataSnapshot 基类

应用层继承此基类，实现透明的数据持久化：

```javascript
class DataSnapshot {
    constructor(filePath) {
        this._filePath = filePath;
        this._data = { ...this.constructor.defaults };
        this._loaded = false;
        this._load();
        return new Proxy(this, this._createHandler());
    }
    
    static defaults = {};
    
    _createHandler() {
        return {
            get: (target, prop) => {
                if (prop.startsWith('_') || prop in DataSnapshot.prototype) {
                    return target[prop];
                }
                return target._data[prop];
            },
            set: (target, prop, value) => {
                if (prop.startsWith('_')) {
                    target[prop] = value;
                } else {
                    target._data[prop] = value;
                    target._save();
                }
                return true;
            }
        };
    }
    
    _load() { /* 从文件加载 */ }
    _save() { /* 保存到文件 */ }
}
```

### 属性说明

| 属性 | 类型 | 说明 |
|------|------|------|
| _filePath | string | 数据文件路径 |
| _data | object | 实际数据存储 |
| _loaded | boolean | 是否已加载 |
| defaults | object | 子类定义的默认值 |

### 方法说明

| 方法 | 说明 |
|------|------|
| _load() | 从文件加载数据，合并默认值 |
| _save() | 保存数据到文件 |
| _createHandler() | 创建 Proxy 处理器 |

## 使用示例

### 定义数据类

```javascript
const DataSnapshot = require('./core/data-snapshot');

// 定义配置类
class AppConfig extends DataSnapshot {
    static defaults = {
        server: {
            port: 8081,
            host: 'localhost'
        },
        tts: {
            enabled: true,
            voice: 'default'
        },
        displayStates: {}
    };
}

// 定义聊天历史类
class ChatHistory extends DataSnapshot {
    static defaults = {
        messages: [],
        lastUpdate: null
    };
}
```

### 使用数据类

```javascript
// 创建实例，自动从文件加载
const config = new AppConfig('./config/app-config.json');

// 像普通属性一样访问
console.log(config.server.port);  // 8081

// 像普通属性一样修改，自动保存
config.server.port = 9090;  // 自动保存到文件
config.tts.voice = 'xiaoxiao';  // 自动保存到文件

// 添加新属性
config.newFeature = { enabled: true };  // 自动保存

// 删除属性
delete config.oldFeature;  // 自动保存
```

### 调试友好

文件内容（格式化的 JSON）：

```json
{
  "server": {
    "port": 9090,
    "host": "localhost"
  },
  "tts": {
    "enabled": true,
    "voice": "xiaoxiao"
  },
  "displayStates": {},
  "newFeature": {
    "enabled": true
  }
}
```

## 与现有模块的集成

| 模块 | 用途 | 改造方式 |
|------|------|----------|
| config.js | 配置管理 | 继承 DataSnapshot 定义配置类 |
| chat.js | 聊天历史 | 继承 DataSnapshot 定义历史类 |
| reminder.js | 提醒数据 | 继承 DataSnapshot 定义提醒类 |

### 改造示例

```javascript
// 改造前 (core/config.js)
let config = null;
function loadConfig() { /* 手动加载 */ }
function saveConfig() { /* 手动保存 */ }
function get(key) { /* 手动获取 */ }
function set(key, value) { /* 手动设置 */ }

// 改造后 (core/config.js)
class Config extends DataSnapshot {
    static defaults = {
        server: { port: 8081 },
        tts: { enabled: true },
        displayStates: {}
    };
}

const config = new Config('./config/config.json');
module.exports = config;

// 使用
const config = require('./config');
config.server.port = 9090;  // 自动保存
```

## 文件结构

```
core/
├── data-snapshot/
│   ├── index.js           # 模块入口
│   ├── DataSnapshot.js    # 基类实现
│   └── JsonFile.js        # JSON 文件操作
```

## 扩展计划

1. 添加批量操作支持（批量设置多个属性后一次性保存）
2. 添加数据变更事件监听
3. 添加数据版本控制
4. 添加文件监听（外部修改自动重载）
