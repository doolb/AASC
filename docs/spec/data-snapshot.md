# DataSnapshot 数据快照 - 项目实现文档

## 项目概述

DataSnapshot 是一个数据快照模块，实现内存数据到文件的持久化存储。提供基类，应用层可以像普通类一样写入和获取数据。

## 项目结构

```
core/
├── data-snapshot/
│   ├── index.js           # 模块入口
│   ├── DataSnapshot.js    # 基类实现
│   └── JsonFile.js        # JSON 文件操作
```

## 核心实现

### DataSnapshot 基类

```javascript
const fs = require('fs');
const path = require('path');

class DataSnapshot {
    constructor(filePath) {
        this._filePath = path.resolve(filePath);
        this._data = { ...this.constructor.defaults };
        this._loaded = false;
        this._saving = false;
        this._pendingSave = false;
        this._load();
        return new Proxy(this, this._createHandler());
    }

    static defaults = {};

    _createHandler() {
        return {
            get: (target, prop) => {
                if (typeof prop === 'symbol') {
                    return target[prop];
                }
                if (prop.startsWith('_') || prop in DataSnapshot.prototype) {
                    return target[prop];
                }
                return target._data[prop];
            },

            set: (target, prop, value) => {
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

            deleteProperty: (target, prop) => {
                if (prop in target._data) {
                    delete target._data[prop];
                    target._save();
                    return true;
                }
                return false;
            },

            ownKeys: (target) => {
                return Reflect.ownKeys(target._data);
            },

            getOwnPropertyDescriptor: (target, prop) => {
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
                this._data = { ...this.constructor.defaults, ...loaded };
            }
            this._loaded = true;
        } catch (err) {
            console.error(`[DataSnapshot] 加载失败: ${this._filePath}`, err.message);
            this._data = { ...this.constructor.defaults };
        }
    }

    _save() {
        if (this._saving) {
            this._pendingSave = true;
            return;
        }
        this._saving = true;
        try {
            const json = JSON.stringify(this._data, null, 2);
            fs.writeFileSync(this._filePath, json, 'utf8');
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

    toJSON() {
        return this._data;
    }

    toString() {
        return JSON.stringify(this._data, null, 2);
    }
}

module.exports = DataSnapshot;
```

### JsonFile 工具类

```javascript
const fs = require('fs');
const path = require('path');

class JsonFile {
    static read(filePath) {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    }

    static write(filePath, data) {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const json = JSON.stringify(data, null, 2);
        fs.writeFileSync(filePath, json, 'utf8');
    }

    static exists(filePath) {
        return fs.existsSync(filePath);
    }

    static delete(filePath) {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }
}

module.exports = JsonFile;
```

### 模块入口

```javascript
const DataSnapshot = require('./DataSnapshot');
const JsonFile = require('./JsonFile');

module.exports = DataSnapshot;
module.exports.DataSnapshot = DataSnapshot;
module.exports.JsonFile = JsonFile;
```

## 待完成任务

| 任务 | 状态 | 说明 |
|------|------|------|
| DataSnapshot 基类 | 待实现 | Proxy 代理、自动加载/保存 |
| JsonFile 工具类 | 待实现 | JSON 文件读写工具 |
| 批量操作支持 | 待设计 | batch() 方法支持批量设置 |
| 数据变更事件 | 待设计 | onChange 事件监听 |

## 技术栈

- Node.js
- 原生 fs 模块
- Proxy API

## 使用示例

### 定义数据类

```javascript
const DataSnapshot = require('./core/data-snapshot');

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

module.exports = AppConfig;
```

### 使用数据类

```javascript
const AppConfig = require('./AppConfig');

const config = new AppConfig('./config/app-config.json');

console.log(config.server.port);  // 8081

config.server.port = 9090;  // 自动保存

config.newFeature = { enabled: true };  // 自动保存

delete config.oldFeature;  // 自动保存
```

### 与现有模块集成

```javascript
const DataSnapshot = require('./core/data-snapshot');

class Config extends DataSnapshot {
    static defaults = {
        server: { port: 8081 },
        tts: {
            serviceUrl: 'http://192.168.1.16:3000/api/tts',
            defaultVoice: 'Microsoft Xiaoxiao',
            defaultSpeed: 0
        },
        displayStates: {}
    };
}

const config = new Config('./config/config.json');
module.exports = config;
```
