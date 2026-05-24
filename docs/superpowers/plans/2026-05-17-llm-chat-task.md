# LLM Chat 任务实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 创建 llm.chat 内置任务，支持两层配置、流式输出、侧边栏面板

**Architecture:** 后端 `taskIO` 新增全局配置读写，`llm.chat.js` 作为 service 任务常驻，API 流式通过 `task:stream` 推送；前端 SidebarRegistry 接收流式输出

---

### Task 1: taskIO — 全局配置读写

**Files:**
- Modify: `src/apps/server/modules/task-engine/task-io.js`

在 `updateLatestLink` 方法后新增两个方法：

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
  await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
  await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
}
```

---

### Task 2: TaskManager + WebSocket — task:stream 事件

**Files:**
- Modify: `src/apps/server/modules/task-engine/task-manager.js`
- Modify: `src/apps/server/modules/task-engine/web-socket-handler.js`

**task-manager.js:** 新增 stream 事件发射方法（或直接 emit）

在 `_runServiceTask` 的 context 中增加 `postStream`：

```js
postStream: (data) => this.emit('stream', instanceId, data),
```

服务任务通过 `context.postStream({ chunk, index, done })` 发送流式数据。

**web-socket-handler.js:** 注册 stream 事件转发

```js
taskManager.on('stream', (instanceId, { chunk, index, done }) => {
  const inst = taskManager.getInstance(instanceId);
  sendToControl({
    type: 'task:stream',
    payload: { instanceId, taskName: inst ? inst.taskName : null, chunk, index: index || 0, done: done || false }
  });
});
```

---

### Task 3: 创建 llm.chat 内置任务

**Files:**
- Create: `src/apps/server/modules/task-engine/builtin-tasks/llm-chat.js`

完整任务模块。要点：
- `mode: 'service'`，常驻
- 启动时从 `taskIO.getTaskConfig()` 读全局配置，从 `params` 读实例覆盖，合并为运行时 config
- 注册 `chat` action：接收 `{ messages }`，调 LLM API，流式响应用 `postStream` 推送
- 注册 `updateConfig` action：`_scope === 'global'` 写 config.json，否则写 index params
- widget HTML：模型选择、温度滑块、API URL 输入、状态显示

具体代码实现时用 `https`/`http` 模块调 LLM API，支持流式（`res.on('data')`）。

---

### Task 4: registry.js — 注册 llm.chat

**Files:**
- Modify: `src/apps/server/modules/task-engine/builtin-tasks/registry.js`

```js
const tasks = {
  'image.resize': require('./image-resize'),
  'model.inference': require('./model-inference'),
  'time.announce': require('./time-announce'),
  'llm.chat': require('./llm-chat')
};
```

并在 `sidebarManifest.groups` 和 `tabs` 中确认 llm.chat 能归入已有组，或新增组。

---

### Task 5: 前端 — SidebarRegistry.onStream

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/sidebar-registry.js`

在 `onWidgetUpdate` 后新增：

```js
onStream: function(payload) {
  var taskName = payload.taskName;
  if (!taskName) return;
  var streamEl = document.getElementById('sidebar-stream-' + taskName);
  if (!streamEl) return;
  if (payload.done) {
    streamEl.classList.add('done');
    return;
  }
  streamEl.textContent += payload.chunk;
},
```

同时 `task:stream` WebSocket 消息需要路由到 SidebarRegistry，在 `task-panel.js` 的 WS handler 中增加：

```js
if (data.type === 'task:stream') {
  if (window.SidebarRegistry) {
    window.SidebarRegistry.onStream(data.payload);
  }
}
```

---

### 完整文件清单

| 文件 | 操作 |
|------|------|
| `src/apps/server/modules/task-engine/task-io.js` | 修改 — 新增 getTaskConfig/setTaskConfig |
| `src/apps/server/modules/task-engine/task-manager.js` | 修改 — context 增加 postStream |
| `src/apps/server/modules/task-engine/web-socket-handler.js` | 修改 — 注册 stream 事件转发、WS 流式接收 |
| `src/apps/server/modules/task-engine/builtin-tasks/llm-chat.js` | **新建** |
| `src/apps/server/modules/task-engine/builtin-tasks/registry.js` | 修改 — 注册 llm.chat |
| `src/apps/web-mediacenter/ui/public/js/sidebar-registry.js` | 修改 — 新增 onStream |
| `src/apps/web-mediacenter/ui/public/js/task-panel.js` | 修改 — WS handler 路由 task:stream |
