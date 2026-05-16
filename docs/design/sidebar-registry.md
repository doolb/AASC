# 侧边栏注册系统 — 设计文档

## 概述

将侧边栏从硬编码改为注册驱动，允许内置任务注册自己的侧边栏入口，实现"任务驱动面板"的架构。现有硬编码面板保持不变，新增动态分组注入到侧边栏底部。

## 核心概念

### 三级结构

| 层级 | 名称 | 位置 | 说明 |
|------|------|------|------|
| 一级 | 组 (Group) | 侧边栏 | 聚合多个相关任务，一个组一个侧边栏入口 |
| 二级 | 子页签 (Tab) | 面板顶部 | 组内分类，切换显示不同类别的任务 |
| 三级 | 项 (Item) | 面板内容 | 具体的任务或面板，垂直排列，复用 widget 系统 |

### 渲染示意

```
侧边栏（硬编码不动，动态注入底部）
├── 📁 媒体
├── 🖥️ 显示
├── ⏰ 提醒
├── 💬 助手
├── 🗺️ 地图
├── 🎮 3D
├── 📋 日志
├── 🧠 大脑
├── ⚙️ 设置
├── ⚡ 任务
├────────────────── 分割线
│   🔊 语音服务        ← 动态组
│   🖼️ 媒体处理        ← 动态组

点击"语音服务" → 动态面板
┌─ 语音服务 ────────────────────────────┐
│ [📢 播报类] [🎤 识别类]              │ ← 子页签
│ ──────────────────────────────────── │
│ ── 🔔 整点报时 ──────────────────    │
│ (widget 内容...)                       │
│                                       │
│ ── 🗣️ TTS 播报 ──────────────────    │
│ (widget 内容...)                       │
└───────────────────────────────────────┘
```

## 注册 API

### 组注册

```js
registerGroup({
  id: 'voiceService',       // 组 ID，唯一
  label: '语音服务',        // 侧边栏显示文本
  icon: '🔊',               // 侧边栏图标
  priority: 50              // 侧边栏排序（同组内无意义，用于组间排序）
})
```

### 子页签注册

```js
registerTab({
  id: 'announce',           // 页签 ID，组内唯一
  group: 'voiceService',    // 所属组
  label: '播报类',          // 页签显示文本
  icon: '📢',               // 页签图标
  priority: 10              // 组内页签排序
})
```

### 任务声明（内置任务定义中）

```js
module.exports = {
  id: 'time.announce',
  name: '整点报时',
  sidebar: {
    group: 'voiceService',  // 所属组
    tab: 'announce',        // 所属子页签
    label: '整点报时',       // 组内显示标题
    icon: '🔔',             // 组内标题图标
    priority: 10            // 组内/页签内排序
  },
  widget: { ... },
  mode: 'service'
}
```

### 现成模块注册（预留，暂不使用）

```js
registerPanel({
  id: 'reminder',
  group: 'taskService',
  tab: 'timeRemind',
  label: '提醒设置',
  icon: '⏰',
  sectionId: 'panel-reminder',
  priority: 10
})
```

## 数据流

### 服务端

`builtin-tasks/registry.js` 新增 `sidebarManifest` 导出：

```js
module.exports = {
  sidebarManifest: {
    groups: [
      { id: 'voiceService', label: '语音服务', icon: '🔊', priority: 50 }
    ],
    tabs: [
      { id: 'announce', group: 'voiceService', label: '播报类', icon: '📢', priority: 10 }
    ]
  },
  listTasks() { ... }
}
```

`web-socket-handler.js` 的 `task:list` 响应扩展：

```js
{ type: 'task:list:result', payload: {
  tasks: [...],
  sidebarGroups: [...],
  sidebarTabs: [...]
}}
```

### 前端注册流程

```
task:list:result
  ↓
SidebarRegistry.registerManifest({ sidebarGroups, sidebarTabs, tasks })
  ↓
SidebarRegistry.registerGroup()  →  _groups Map
SidebarRegistry.registerTab()    →  _tabs Map
SidebarRegistry.registerTask()   →  _items Map
  ↓
SidebarRegistry.build()
  ↓
注入 nav-item 到侧边栏末尾
```

### 面板切换流程

```
点击侧边栏组按钮 → SidebarRegistry.navigate(groupId)
  ↓
Step 1: 隐藏所有面板（硬编码 + 之前打开的动态面板）
Step 2: 检查动态面板容器是否存在
  ├── 存在 → 显示
  └── 不存在 → createPanel(groupId)
        ↓
        createPanel(groupId):
          1. 在 main 内容区创建 <section class="panel" id="panel-dynamic-{groupId}">
          2. 渲染页签栏：从 _tabs 筛选 group==groupId
          3. 默认激活第一个 tab
          4. 渲染当前 tab 下的所有 items
             - type='task' → _renderWidget(widgetDef, ...) 复用现有 widget 渲染
             - 按 priority 升序排列
          5. 页签切换 → 重新渲染 items
Step 3: 激活侧边栏按钮
Step 4: 保存 lastPanel
```

## 前端模块结构

### SidebarRegistry

全局单例，附加到 `window.SidebarRegistry`。

**数据结构：**

| 集合 | 键 | 值 |
|------|-----|-----|
| `_groups` | groupId | `{ id, label, icon, priority }` |
| `_tabs` | tabId | `{ id, group, label, icon, priority }` |
| `_items` | itemId | `{ type, group, tab, label, icon, priority, widget?, taskName? }` |

**核心方法：**

| 方法 | 说明 |
|------|------|
| `registerManifest(data)` | 从 task:list:result 批量注册 |
| `registerGroup(def)` | 注册组 |
| `registerTab(def)` | 注册子页签 |
| `registerTask(task)` | 注册任务项 |
| `registerPanel(def)` | 注册现成面板项 |
| `build()` | 在侧边栏注入动态组入口 |
| `navigate(groupId)` | 切换到指定组面板 |
| `createPanel(groupId)` | 创建组面板容器 |

### Widget 渲染与更新复用

现有 widget 系统在 `TaskPanel._renderWidget()` 中渲染 HTML，`TaskPanel._onWidgetUpdate()` 负责接收 WebSocket 推送并更新 DOM。

动态面板需要同等的 widget 渲染和实时更新能力。做独立实现：

**渲染：**
- `SidebarRegistry` 自有 `_renderWidget(widgetDef, data)` 方法
- 逻辑与 `TaskPanel._renderWidget` 相同：模板替换 `{{key}}` → 值
- 不依赖 `TaskPanel._widgetData`，而是自己的 `_widgetData` 缓存

**实时更新：**
- WebSocket 消息 `task:widget_update` 同时分发到 `TaskPanel._onWidgetUpdate` 和 `SidebarRegistry._onWidgetUpdate`
- `SidebarRegistry._onWidgetUpdate` 在自己的 `_widgetData` 缓存数据并更新 DOM 元素 `sidebar-widget-{instanceId}`

数据流：

```
WebSocket task:widget_update
  ├──→ TaskPanel._onWidgetUpdate(payload)      // 任务面板内 widget
  └──→ SidebarRegistry._onWidgetUpdate(payload) // 动态组面板内 widget
```

| 模块 | 关系 |
|------|------|
| `main.js` | `App.init()` 中初始化 `SidebarRegistry`，调用 `build()` |
| `task-panel.js` | `_handleTaskList` 中同步将带 `sidebar` 的任务注册到 `SidebarRegistry` |
| `Sidebar` | 扩展 `switchPanel` 逻辑，支持动态组面板切换 |
| Widget 系统 | 复用 `_renderWidget` 渲染组内任务面板 |

## 涉及文件

| 文件 | 改动概要 |
|------|----------|
| `src/apps/server/modules/task-engine/builtin-tasks/registry.js` | 新增 `sidebarManifest` 导出 |
| `src/apps/server/modules/task-engine/web-socket-handler.js` | `task:list` 返回 `sidebarGroups`/`sidebarTabs` |
| `src/apps/web-mediacenter/ui/public/js/main.js` | 初始化 SidebarRegistry，扩展 switchPanel |
| `src/apps/web-mediacenter/ui/public/js/task-panel.js` | `_handleTaskList` 中注册任务 sidebar |
| `src/apps/web-mediacenter/ui/public/upload.html` | 动态面板容器 |
| `src/apps/web-mediacenter/ui/public/css/upload.css` | 动态面板样式 |

## 未涉及

- 现有硬编码面板（media, display, reminder 等）不修改
- 现有任务管理面板（task panel）不修改
- 现有 widget 渲染系统不重写，直接复用
- 现有模块不强制迁移到分组体系
