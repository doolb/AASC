# DataSnapshot 数据快照 - 实现任务

## 任务概述

将内存中实例的数据，以文件的形式存储，方便调试和数据持久化。提供基类，应用层可以像普通类一样写入和获取数据。

## 功能描述

- 将内存中实例的数据，以文件的形式存储
- 可以方便地从文件中查看数据，方便调试
- 下次运行可以从文件中读取数据，方便调试
- **提供基类，应用层可以像普通类一样写入和获取数据**

## 需求分析

### 核心需求

1. **透明访问**：像普通类属性一样访问数据，自动处理读写
2. **自动持久化**：属性修改后自动保存到文件
3. **调试友好**：文件格式可读（格式化 JSON）
4. **类型安全**：支持默认值定义

### 使用场景

```javascript
// 定义配置类
class AppConfig extends DataSnapshot {
    static defaults = {
        server: { port: 8081 },
        tts: { enabled: true }
    };
}

// 使用
const config = new AppConfig('./config.json');
config.server.port = 9090;  // 自动保存
console.log(config.server.port);  // 9090
```

## 设计方案

### 文件结构

```
core/
├── data-snapshot/
│   ├── index.js           # 模块入口
│   ├── DataSnapshot.js    # 基类实现（Proxy 代理）
│   └── JsonFile.js        # JSON 文件操作工具
```

### 核心类设计

#### DataSnapshot 基类

使用 **Proxy** 代理属性访问，实现透明的数据持久化：

```javascript
class DataSnapshot {
    constructor(filePath) {
        this._filePath = filePath;
        this._data = { ...this.constructor.defaults };
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

### 与现有模块的关系

| 模块 | 改造方式 |
|------|----------|
| config.js | 继承 DataSnapshot 定义配置类 |
| chat.js | 继承 DataSnapshot 定义历史类 |
| reminder.js | 继承 DataSnapshot 定义提醒类 |

## 实现计划

### 第一阶段：基础框架

- [x] 创建 core/data-snapshot 目录
- [x] 实现 DataSnapshot 基类（Proxy 代理、自动加载/保存）
- [x] 实现 JsonFile 工具类

### 第二阶段：集成测试

- [x] 重构 config.js 使用 DataSnapshot
- [x] 添加单元测试
- [x] 更新文档

## 受影响的功能模块

| 模块 | 文件 | 影响 |
|------|------|------|
| 配置管理 | core/config.js | 使用 DataSnapshot 重构 |
| 聊天系统 | core/chat.js | 可使用 DataSnapshot 存储历史 |
| 提醒功能 | core/reminder.js | 可使用 DataSnapshot 存储提醒 |

## 自测用例

1. 创建数据类实例，验证默认值
2. 修改属性，验证自动保存
3. 重启程序，验证数据加载
4. 删除属性，验证自动保存
5. 嵌套属性修改，验证保存

## 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| Proxy 兼容性 | 低 | Node.js 原生支持 |
| 嵌套对象修改 | 中 | 添加 deepSave 方法 |
| 文件权限问题 | 中 | 添加权限检查 |

## 预计工时

- DataSnapshot 基类：1.5 小时
- JsonFile 工具类：0.5 小时
- 集成测试：1 小时
- 文档更新：0.5 小时

**总计：3.5 小时**
