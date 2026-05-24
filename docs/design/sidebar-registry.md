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

---

## LLM Chat 任务设计

### 概述

把 LLM API 调用封装为一个 `mode: 'service'` 的内置任务。一个聊天会话对应一个服务实例，所有消息通过 `widget_action` 发送，流式通过 `task:stream` 返回。不产生多余实例。

### 任务定义

```js
module.exports = {
  id: 'llm.chat',
  name: 'AI 聊天',
  description: 'LLM API 调用服务',
  target: 'server',
  mode: 'service',
  sidebar: { group: 'voiceService', tab: null, label: 'AI 聊天', icon: '💬', priority: 20 },
  widget: {
    html: '<div style="display:flex;flex-direction:column;gap:10px">' +
      '<div style="display:flex;align-items:center;gap:8px;font-size:13px">' +
        '<span style="color:rgba(255,255,255,0.6)">状态</span>' +
        '<span style="font-weight:600;color:{{_statusColor}}">{{_statusText}}</span>' +
      '</div>' +
      '<div style="display:flex;gap:6px">' +
        '<select class="task-widget-field" data-field="modelId" style="flex:1">' +
          '{{_modelOptions}}' +
        '</select>' +
        '<button class="task-card-btn primary" onclick="TaskPanel._onWidgetAction(\'{{instanceId}}\',\'refreshModels\')">刷新</button>' +
      '</div>' +
      '<div style="display:flex;gap:6px">' +
        '<input class="task-widget-field" data-field="apiUrl" value="{{apiUrl}}" style="flex:1;padding:5px 6px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;font-size:12px">' +
      '</div>' +
      '<div style="display:flex;gap:6px;align-items:center">' +
        '<span style="font-size:11px;color:rgba(255,255,255,0.4)">温度</span>' +
        '<input type="range" class="task-widget-field" data-field="temperature" min="0" max="2" step="0.1" value="{{temperature}}" style="flex:1">' +
        '<span style="font-size:11px;color:rgba(255,255,255,0.6)" id="tempVal-{{instanceId}}">{{temperature}}</span>' +
      '</div>' +
      '<div style="display:flex;gap:6px">' +
        '<button class="task-card-btn" onclick="TaskPanel._onWidgetSaveConfig(\'{{instanceId}}\')">保存配置</button>' +
        '<button class="task-card-btn danger" onclick="TaskPanel._stopInstance(\'{{instanceId}}\')">停止服务</button>' +
      '</div>' +
    '</div>'
  }
};
```

### 数据流

```
用户发送消息（前端 chat 界面）
  ↓
WebSocket: widget_action → { instanceId, action: 'chat', params: { messages: [...] } }
  ↓
llm.chat 服务的 onWidgetAction('chat', handler)
  ↓
调用 LLM API（流式）
  ↓
每收到一个 chunk → emit('stream', instanceId, { chunk, index, done })
  ↓
WebSocket 广播 → task:stream { instanceId, chunk, index, done }
  ↓
前端 chat 界面按 instanceId 收到流式块 → 追加到对应消息气泡
```

### task:stream 协议

新增 WebSocket 消息类型：

```js
// 服务端 → 控制端
{ type: 'task:stream', payload: { instanceId, chunk: "当前", index: 0, done: false } }
{ type: 'task:stream', payload: { instanceId, chunk: "是", index: 1, done: false } }
// ...
{ type: 'task:stream', payload: { instanceId, chunk: "", index: 42, done: true } }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `instanceId` | string | 实例 ID，前端用于路由到对应显示区 |
| `chunk` | string | 当前文本片段 |
| `index` | number | 序号（可选，TCP 保证顺序） |
| `done` | boolean | true 表示流结束 |
| `taskName` | string | 任务名称（可选，前端备用） |

### TaskManager 扩展

新增 `stream` 事件：

```js
// task-manager.js
emit('stream', instanceId, { chunk, index, done });
emit('result', instanceId, { success: true, data: { fullText } });
```

`web-socket-handler.js` 增加转发：

```js
taskManager.on('stream', (instanceId, { chunk, index, done }) => {
  const inst = taskManager.getInstance(instanceId);
  sendToControl({
    type: 'task:stream',
    payload: { instanceId, taskName: inst ? inst.taskName : null, chunk, index, done }
  });
});
```

### 前端接收

`task-panel.js` 的 `_setupWS` 中处理新消息类型：

```js
if (data.type === 'task:stream') {
  if (window.SidebarRegistry) {
    window.SidebarRegistry.onStream(data.payload);
  }
}
```

`SidebarRegistry` 新增 `onStream`：

```js
onStream: function(payload) {
  var taskName = payload.taskName;
  if (!taskName) return;
  // 更新 widget 中的流式输出区
  var streamEl = document.getElementById('sidebar-stream-' + taskName);
  if (!streamEl) return;
  streamEl.textContent += payload.chunk;
  if (payload.done) {
    // 流结束，标记完成
    streamEl.classList.add('done');
  }
}
```

### 两层配置体系

LLM 任务的配置分两层：**全局级**（任务共享）和 **实例级**（实例覆盖）。

#### 全局配置

`res/tasks/llm.chat/config.json`：

```json
{
  "apiUrl": "http://192.168.1.12:8080/v1/chat/completions",
  "defaultModel": "gpt-3.5-turbo",
  "defaultTemperature": 0.7,
  "defaultSystemPrompt": "你是一个友好的助手，请用简洁的语言回答问题。",
  "defaultMaxTokens": 1000
}
```

`taskIO` 增加读写方法：

```js
async getTaskConfig(taskName) {
  const configPath = path.join(this._taskPath(taskName), 'config.json');
  try {
    const content = await fs.promises.readFile(configPath, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    return {};
  }
}

async setTaskConfig(taskName, config) {
  const configPath = path.join(this._taskPath(taskName), 'config.json');
  await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
}
```

#### 实例参数

每个实例的 `index.json` 中 `params` 只存覆盖值：

```json
// 实例 A 的 index 条目
{
  "instanceId": "instA",
  "params": { "modelId": "gpt-4", "temperature": 0.7 }
}
```

#### 运行时合并规则

```
运行时有效配置 = 全局 + 实例覆盖

实例 A: { apiUrl, modelId: "gpt-4", temperature: 0.7, systemPrompt: defaultSystemPrompt }
实例 B: { apiUrl, modelId: "deepseek", temperature: 0.2, systemPrompt: defaultSystemPrompt }
```

服务启动时合并：

```js
async run(context) {
  const { params, taskIO, taskName } = context;
  const globalConfig = taskIO ? await taskIO.getTaskConfig(taskName) : {};
  const config = {
    apiUrl: globalConfig.apiUrl || DEFAULT_API_URL,
    modelId: params.modelId || globalConfig.defaultModel || 'gpt-3.5-turbo',
    temperature: params.temperature !== undefined ? params.temperature : (globalConfig.defaultTemperature || 0.7),
    systemPrompt: params.systemPrompt || globalConfig.defaultSystemPrompt || '',
    maxTokens: params.maxTokens || globalConfig.defaultMaxTokens || 1000
  };
}
```

#### widget 保存配置

区分实例级和全局级参数。widget_action 通过 `_scope` 字段指定级别：

```js
onWidgetAction('updateConfig', async (newConfig) => {
  if (!taskIO) { pushWidgetUpdate(); return { success: true }; }

  if (newConfig._scope === 'global') {
    // 全局级写入 config.json
    const globalConfig = await taskIO.getTaskConfig(taskName) || {};
    if (newConfig.apiUrl !== undefined) globalConfig.apiUrl = newConfig.apiUrl;
    if (newConfig.defaultModel !== undefined) globalConfig.defaultModel = newConfig.defaultModel;
    if (newConfig.defaultTemperature !== undefined) globalConfig.defaultTemperature = newConfig.defaultTemperature;
    if (newConfig.defaultSystemPrompt !== undefined) globalConfig.defaultSystemPrompt = newConfig.defaultSystemPrompt;
    await taskIO.setTaskConfig(taskName, globalConfig);
    // 更新内存
    if (newConfig.apiUrl !== undefined) config.apiUrl = newConfig.apiUrl;
  } else {
    // 实例级写入 index params
    const instParams = {};
    if (newConfig.modelId !== undefined) { config.modelId = newConfig.modelId; instParams.modelId = newConfig.modelId; }
    if (newConfig.temperature !== undefined) { config.temperature = newConfig.temperature; instParams.temperature = newConfig.temperature; }
    if (Object.keys(instParams).length > 0) {
      await taskIO.updateIndex(taskName, { instanceId, params: instParams });
    }
  }
  pushWidgetUpdate();
  return { success: true };
});
```

### 与现有聊天系统的关系

现有 `chat.js`（前端）和 `llm-service.js`（后端）保持不变，不修改。

llm.chat 任务是一个独立的新入口，提供：
- 侧边栏动态面板中的 AI 聊天 widget
- 基于 task:stream 的流式输出
- 配置在 widget 中直接可调

未来如果 chat 界面想迁移到任务体系，可以直接复用 llm.chat 的 `chat` action，前端改调 `widget_action` 而不是 WebSocket 消息。
