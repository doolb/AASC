# 树状结构设备列表设计文档

## 功能概述

将控制端的显示端列表从平铺列表改为树状结构，支持设备分组、设置展开/收起、设备连线/掉线自定义指令配置。

## 需求分析

### 核心需求

1. **树状结构设备列表**：以服务器为根节点，设备为子节点，设备设置为叶节点
2. **设置查看和修改**：可以在控制端查看和修改每个设备的设置
3. **展开/收起功能**：设置列表可以展开和收起，显示或隐藏子项
4. **连线/掉线自定义指令**：可以设置设备连线和掉线时服务器执行的自定义指令，保存到配置文件

### 树状结构设计

```
📡 服务器 (192.168.1.39:8081)
  ├── 🖥️ 192.168.1.12 (1920x1080) ●在线
  │   ├── ⚙️ 画面设置
  │   │   ├── 旋转: 0°
  │   │   ├── 填充: contain
  │   │   ├── 音量: 100%
  │   │   └── 裁剪: 0,0 100x100
  │   ├── 🔔 事件指令
  │   │   ├── 连线指令: "早上好"
  │   │   └── 掉线指令: "晚安"
  │   └── ℹ️ 浏览器信息
  │       ├── Chrome 120 | Windows 10
  │       └── 1920x1080 @ 1x
  ├── 🖥️ 192.168.1.101 (1080x1920) ●在线
  └── 🎤 192.168.1.50 ●在线 (子显示端)
```

## 数据结构

### 设备事件配置

```json
{
  "deviceEvents": {
    "192.168.1.12": {
      "onConnect": "早上好",
      "onDisconnect": "晚安"
    },
    "192.168.1.101": {
      "onConnect": "",
      "onDisconnect": ""
    },
    "default": {
      "onConnect": "",
      "onDisconnect": ""
    }
  }
}
```

### 树节点数据结构

```javascript
{
  id: 'server',
  label: '服务器',
  icon: '📡',
  expanded: true,
  children: [
    {
      id: 'display-xxx',
      label: '192.168.1.12',
      icon: '🖥️',
      status: 'online',
      expanded: false,
      children: [
        {
          id: 'display-xxx-settings',
          label: '画面设置',
          icon: '⚙️',
          expanded: false,
          type: 'settings',
          children: [...]
        },
        {
          id: 'display-xxx-events',
          label: '事件指令',
          icon: '🔔',
          expanded: false,
          type: 'events',
          children: [...]
        },
        {
          id: 'display-xxx-info',
          label: '浏览器信息',
          icon: 'ℹ️',
          expanded: false,
          type: 'info',
          children: [...]
        }
      ]
    }
  ]
}
```

## API 设计

### 设备事件配置 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/device-events | 获取所有设备事件配置 |
| PUT | /api/device-events/:ip | 更新指定设备的事件配置 |
| DELETE | /api/device-events/:ip | 删除指定设备的事件配置 |

### 设备设置 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/device-settings/:displayId | 获取指定设备设置 |
| PUT | /api/device-settings/:displayId | 更新指定设备设置 |

## WebSocket 消息扩展

### 新增消息类型

| 类型 | 方向 | 说明 |
|------|------|------|
| deviceEvents | 服务器→控制端 | 设备事件配置更新通知 |
| deviceEventExecuted | 服务器→控制端 | 设备事件指令执行通知 |

## 连线/掉线指令执行流程

### 设备连线

```
显示端连接
  → 获取设备IP
  → 查找 deviceEvents[ip].onConnect
  → 如果存在且非空:
    → 通过 voiceCommand.processVoiceCommand 执行指令
    → 通知控制端 deviceEventExecuted
```

### 设备掉线

```
显示端断开
  → 获取设备IP
  → 查找 deviceEvents[ip].onDisconnect
  → 如果存在且非空:
    → 通过 voiceCommand.processVoiceCommand 执行指令
    → 通知控制端 deviceEventExecuted
```

## 前端组件设计

### DeviceTree 模块

- 位置：`public/js/device-tree.js`
- 功能：
  - 将 displayList 数据转换为树状结构
  - 渲染树状节点（展开/收起图标、状态指示器、设备图标）
  - 处理节点点击事件（展开/收起、选中设备）
  - 设备设置编辑面板
  - 事件指令编辑面板

### 样式设计

- 树节点缩进层级用 padding-left 表示
- 展开/收起使用 ▶/▼ 箭头图标
- 在线状态用绿色圆点表示
- 离线设备（已保存配置但未连接）用灰色圆点表示
- 子显示端用特殊图标 🎤 标识

## 配置持久化

设备事件配置保存在 `config/config.json` 的 `deviceEvents` 字段中，通过 DataSnapshot 自动持久化。

## 相关文件

| 文件 | 说明 |
|------|------|
| public/js/device-tree.js | 树状设备列表前端组件 |
| public/css/upload.css | 树状列表样式 |
| src/apps/server/modules/config/config-app-service.js | 配置管理（添加 deviceEvents 支持） |
| server.js | API 端点和连线/掉线指令执行 |
| config/config.json | 设备事件配置存储 |
