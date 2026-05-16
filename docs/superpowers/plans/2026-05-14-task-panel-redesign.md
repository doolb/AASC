# 控制端任务面板重新设计 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 upload.html 的远程任务面板从简单表单重构为三标签导航面板（任务列表/新建任务/运行监控），内置编辑和结果查看功能。

**Architecture:** 纯前端 UI 改造 + 服务端新增 3 个 WebSocket API。前端拆分 TaskPanel 为多个视图模块，通过 IIFE 封装在单个文件中。服务端在现有 TaskManager + TaskIO 基础上新增 list/update/delete 方法。

**Tech Stack:** 原生 JS (IIFE) + CSS3 + WebSocket，与现有架构一致。

---

### 任务 1: 服务端 — TaskIO 新增 listTasks / deleteTask / updateTaskFiles

**Files:**
- Modify: `src/apps/server/modules/task-engine/task-io.js`

task-io.js 新增三个方法：

- [ ] **步骤 1: 实现 `listTasks()`**

在 class TaskIO 的 cleanupOldInstances 之后添加：

```javascript
async listTasks() {
  let tasks = [];
  try {
    const entries = await fs.promises.readdir(this.tasksDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const taskName = entry.name;
      const taskDir = this._taskPath(taskName);
      const files = [];
      try {
        const dirEntries = await fs.promises.readdir(taskDir, { withFileTypes: true });
        for (const de of dirEntries) {
          if (de.isFile() && de.name !== 'results') {
            const stat = await fs.promises.stat(path.join(taskDir, de.name));
            files.push({ name: de.name, size: stat.size });
          }
        }
      } catch (e) { /* 跳过 */ }
      const idx = await this.getIndex(taskName).catch(() => []);
      tasks.push({ taskName, files, instances: idx });
    }
  } catch (e) { /* tasksDir 可能不存在 */ }
  return tasks;
}
```

- [ ] **步骤 2: 实现 `deleteTask(taskName)`**

```javascript
async deleteTask(taskName) {
  const taskDir = this._taskPath(taskName);
  try {
    await fs.promises.rm(taskDir, { recursive: true, force: true });
    return { success: true };
  } catch (e) {
    throw new Error('删除任务失败: ' + e.message);
  }
}
```

- [ ] **步骤 3: 运行现有测试确保没破坏已有功能**

Run: `node src/apps/server/modules/task-engine/task-manager.test.js`
Expected: All pass

---

### 任务 2: 服务端 — TaskManager 新增 listTasks / updateTask / deleteTask

**Files:**
- Modify: `src/apps/server/modules/task-engine/task-manager.js`

在 `destroy()` 方法之前添加：

- [ ] **步骤 1: 添加 `listTasks()`**

```javascript
async listTasks() {
  const taskList = await this.taskIO.listTasks();
  // 合并内存中实例的最新状态
  for (const task of taskList) {
    for (const inst of task.instances) {
      const memInst = this.instances.get(inst.instanceId);
      if (memInst) {
        inst.status = memInst.status;
        inst.stage = memInst.stage;
        inst.progress = memInst.progress;
        inst.target = memInst.target;
      }
    }
    // 按时间降序排列实例
    task.instances.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }
  return taskList;
}
```

- [ ] **步骤 2: 添加 `deleteTask(taskName)`**

```javascript
async deleteTask(taskName) {
  // 清除此任务在内存中的所有实例
  for (const [id, inst] of this.instances) {
    if (inst.taskName === taskName) {
      if (this.nodeRunner.kill) this.nodeRunner.kill(id);
      this.instances.delete(id);
    }
  }
  return this.taskIO.deleteTask(taskName);
}
```

- [ ] **步骤 3: 添加 `updateTask(taskName, updates)`**

```javascript
async updateTask(taskName, updates) {
  // 更新任务文件: 替换/新增/删除
  const toReplace = (updates.files || []).filter(f => f.action === 'replace' || !f.action);
  const toDelete = (updates.files || []).filter(f => f.action === 'delete');
  const taskDir = this.taskIO._taskPath(taskName);

  // 删除标记的文件
  for (const f of toDelete) {
    const filePath = path.join(taskDir, f.name);
    try { await fs.promises.rm(filePath, { force: true }); } catch (e) {}
  }
  // 替换/新增文件
  if (toReplace.length > 0) {
    await this.taskIO.saveTaskFiles(taskName, toReplace);
  }
  return { success: true };
}
```

- [ ] **步骤 4: 运行测试确认未破坏**

Run: `node src/apps/server/modules/task-engine/task-manager.test.js`
Expected: All pass

---

### 任务 3: 服务端 — WebSocket Handler 新增 task:list / task:update / task:delete

**Files:**
- Modify: `src/apps/server/modules/task-engine/web-socket-handler.js`

- [ ] **步骤 1: 在 `controlTypes` 数组末尾追加新消息类型**

```javascript
const controlTypes = ['task:submit', 'task:stop', 'task:status', 'task:result',
                      'task:list', 'task:update', 'task:delete'];
```

- [ ] **步骤 2: 在 switch 的 `task:result` case 后面添加三个新 case**

```javascript
// ---- 任务列表 ----
case 'task:list': {
  try {
    const tasks = await taskManager.listTasks();
    // 如果是 builtin 过滤器，只返回内置任务
    const filter = payload.filter || 'all';
    let filtered = tasks;
    if (filter === 'builtin') {
      // 内置任务不由 disk listing 返回，构造内置任务列表
      const builtinTasks = [];
      try {
        const registry = require('./builtin-tasks/registry');
        const defs = registry.getDefinitions ? registry.getDefinitions() : [];
        for (const def of defs) {
          builtinTasks.push({
            taskName: def.id,
            taskType: 'builtin',
            builtinId: def.id,
            name: def.name,
            params: def.params || [],
            instances: []
          });
        }
      } catch (e) { /* 内置任务不可用 */ }
      ctx.ws.send(JSON.stringify({ type: 'task:list:result', payload: { tasks: builtinTasks } }));
    } else {
      // 合并内置任务到列表开头（只读标记）
      const builtinTasks = [];
      try {
        const registry = require('./builtin-tasks/registry');
        const defs = registry.getDefinitions ? registry.getDefinitions() : [];
        for (const def of defs) {
          builtinTasks.push({
            taskName: def.id,
            taskType: 'builtin',
            builtinId: def.id,
            name: def.name,
            params: def.params || [],
            instances: []
          });
        }
      } catch (e) {}
      ctx.ws.send(JSON.stringify({ type: 'task:list:result', payload: { tasks: [...builtinTasks, ...filtered] } }));
    }
  } catch (err) {
    ctx.ws.send(JSON.stringify({ type: 'task:error', payload: { error: err.message } }));
  }
  break;
}

// ---- 更新任务 ----
case 'task:update': {
  try {
    const result = await taskManager.updateTask(payload.taskName, payload);
    ctx.ws.send(JSON.stringify({ type: 'task:updated', payload: { taskName: payload.taskName, success: true } }));
  } catch (err) {
    ctx.ws.send(JSON.stringify({ type: 'task:error', payload: { taskName: payload.taskName, error: err.message } }));
  }
  break;
}

// ---- 删除任务 ----
case 'task:delete': {
  try {
    await taskManager.deleteTask(payload.taskName);
    ctx.ws.send(JSON.stringify({ type: 'task:deleted', payload: { taskName: payload.taskName, success: true } }));
  } catch (err) {
    ctx.ws.send(JSON.stringify({ type: 'task:error', payload: { taskName: payload.taskName, error: err.message } }));
  }
  break;
}
```

还需在文件顶部添加 `const path = require('path');` 和 `const fs = require('fs');`（如果尚未引入）。

- [ ] **步骤 3: 检查内置任务 registry 是否有 `getDefinitions` 方法**

Read: `src/apps/server/modules/task-engine/builtin-tasks/registry.js`

如果不存在 `getDefinitions`，在 registry.js 中添加：

```javascript
function getDefinitions() {
  return Array.from(tasks.values()).map(t => ({
    id: t.id,
    name: t.name,
    params: t.params || []
  }));
}

module.exports = { getTask, run, getDefinitions };
```

---

### 任务 4: 前端 CSS — 完全重写任务面板样式

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/css/upload.css`

- [ ] **步骤 1: 删除旧的 task 样式（约 2731-3125 行）**

删除从 `/* ============================== 远程任务面板 ============================== */` 到文件末尾的全部内容。

- [ ] **步骤 2: 在文件末尾写入全新 task 样式**

写入以下 CSS（放在 upload.css 末尾）：

```css
/* ==============================
   远程任务面板 - 重新设计
   ============================== */

/* ---- 二级标签栏 ---- */
.task-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 20px;
  background: rgba(255,255,255,0.04);
  border-radius: 12px;
  padding: 4px;
  position: sticky;
  top: 0;
  z-index: 10;
  backdrop-filter: blur(8px);
}

.task-tab {
  flex: 1;
  padding: 10px 16px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(255,255,255,0.5);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  text-align: center;
}

.task-tab:hover { color: #fff; background: rgba(255,255,255,0.06); }

.task-tab.active {
  color: #fff;
  background: rgba(0,210,255,0.15);
}

.task-tab .badge {
  position: absolute;
  top: 6px;
  right: 8px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ef4444;
  display: none;
}

.task-tab .badge.show { display: block; }

/* ---- 标签内容容器 ---- */
.task-tab-content { display: none; }
.task-tab-content.active { display: block; }

/* ---- 任务列表视图 ---- */
.task-search {
  width: 100%;
  padding: 10px 14px;
  border: none;
  border-radius: 10px;
  background: rgba(255,255,255,0.06);
  color: #fff;
  font-size: 13px;
  outline: none;
  margin-bottom: 16px;
  box-sizing: border-box;
  transition: all 0.2s;
}

.task-search:focus { background: rgba(255,255,255,0.1); box-shadow: 0 0 0 2px rgba(0,210,255,0.3); }
.task-search::placeholder { color: #555; }

.task-group-title {
  font-size: 11px;
  font-weight: 600;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin: 16px 0 8px;
  padding: 0 4px;
}

/* ---- 任务卡片 ---- */
.task-card {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 12px;
  padding: 14px 16px;
  margin-bottom: 8px;
  transition: all 0.2s;
  cursor: default;
}

.task-card:hover { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.1); }

.task-card.builtin { border-left: 3px solid rgba(255,165,0,0.4); }
.task-card.running { border-color: rgba(0,210,255,0.3); animation: taskCardPulse 2s ease-in-out infinite; }
.task-card.completed { border-color: rgba(34,197,94,0.2); }
.task-card.failed { border-color: rgba(239,68,68,0.2); }

@keyframes taskCardPulse {
  0%, 100% { border-color: rgba(0,210,255,0.2); }
  50% { border-color: rgba(0,210,255,0.5); }
}

.task-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.task-card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #fff;
}

.task-card-icon { font-size: 16px; flex-shrink: 0; }

.task-card-status {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(255,255,255,0.06);
  color: #888;
  flex-shrink: 0;
}
.task-card-status.running { background: rgba(0,210,255,0.15); color: #00d2ff; }
.task-card-status.completed { background: rgba(34,197,94,0.15); color: #22c55e; }
.task-card-status.failed { background: rgba(239,68,68,0.15); color: #ef4444; }
.task-card-status.stopped { background: rgba(255,165,0,0.15); color: #ffa500; }
.task-card-status.pending { background: rgba(255,255,0,0.1); color: #eab308; }

.task-card-meta {
  font-size: 12px;
  color: #666;
  display: flex;
  gap: 16px;
  margin-bottom: 8px;
}

.task-card-progress {
  width: 100%;
  height: 3px;
  background: rgba(255,255,255,0.08);
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 10px;
}

.task-card-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #00d2ff, #3a7bd5);
  border-radius: 2px;
  transition: width 0.5s ease;
}

.task-card-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.task-card-btn {
  padding: 5px 12px;
  border: none;
  border-radius: 6px;
  background: rgba(255,255,255,0.06);
  color: #aaa;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
}
.task-card-btn:hover { background: rgba(255,255,255,0.12); color: #fff; }
.task-card-btn.primary { background: rgba(0,210,255,0.15); color: #8cf; }
.task-card-btn.primary:hover { background: rgba(0,210,255,0.25); }
.task-card-btn.danger { color: #ef4444; }
.task-card-btn.danger:hover { background: rgba(239,68,68,0.15); }

/* ---- 面包屑导航 ---- */
.task-breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #888;
  margin-bottom: 16px;
}

.task-breadcrumb a {
  color: #8cf;
  text-decoration: none;
  cursor: pointer;
}

.task-breadcrumb a:hover { text-decoration: underline; }

.task-breadcrumb .current { color: #fff; }

/* ---- 新建任务表单 ---- */
.task-form-section {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
}

.task-form-section-title {
  font-size: 12px;
  font-weight: 600;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 12px;
}

.task-form-row {
  display: flex;
  gap: 12px;
  margin-bottom: 10px;
}

.task-form-field {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.task-form-field label {
  font-size: 11px;
  color: #888;
  font-weight: 500;
}

.task-form-field input[type="text"],
.task-form-field textarea,
.task-form-field select {
  padding: 9px 12px;
  border: none;
  border-radius: 8px;
  background: rgba(255,255,255,0.06);
  color: #fff;
  font-size: 13px;
  outline: none;
  transition: all 0.2s;
  font-family: inherit;
}

.task-form-field input:focus,
.task-form-field textarea:focus,
.task-form-field select:focus {
  background: rgba(255,255,255,0.1);
  box-shadow: 0 0 0 2px rgba(0,210,255,0.3);
}

.task-form-field textarea {
  resize: vertical;
  min-height: 50px;
  font-family: monospace;
}

.task-form-field select {
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 28px;
}

.task-form-field select option { background: #1a1a2e; color: #fff; }

/* ---- 按钮式选择 ---- */
.task-btn-group {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.task-btn-option {
  padding: 6px 14px;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  background: transparent;
  color: rgba(255,255,255,0.5);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.task-btn-option:hover { border-color: rgba(0,210,255,0.3); color: #fff; }
.task-btn-option.active { background: rgba(0,210,255,0.15); border-color: rgba(0,210,255,0.3); color: #8cf; }

/* ---- 文件上传区 ---- */
.task-file-zone {
  border: 2px dashed rgba(255,255,255,0.12);
  border-radius: 10px;
  padding: 24px 16px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 8px;
}

.task-file-zone:hover { border-color: rgba(0,210,255,0.3); background: rgba(0,210,255,0.03); }
.task-file-zone.dragover { border-color: #00d2ff; background: rgba(0,210,255,0.08); }

.task-file-zone-icon { font-size: 24px; opacity: 0.4; margin-bottom: 6px; }
.task-file-zone-text { font-size: 13px; color: #888; }
.task-file-zone-hint { font-size: 11px; color: #555; margin-top: 2px; }

.task-file-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 6px;
}

.task-file-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  background: rgba(0,210,255,0.1);
  border: 1px solid rgba(0,210,255,0.15);
  border-radius: 6px;
  font-size: 11px;
  color: #8cf;
}

.task-file-chip .remove {
  cursor: pointer;
  opacity: 0.4;
  font-size: 14px;
  line-height: 1;
}
.task-file-chip .remove:hover { opacity: 1; }

/* ---- 设备选择器 ---- */
.task-device-list {
  margin-top: 8px;
}

.task-device-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid transparent;
}

.task-device-item:hover { background: rgba(255,255,255,0.05); }

.task-device-item.selected { border-color: rgba(0,210,255,0.3); background: rgba(0,210,255,0.05); }

.task-device-radio {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.2s;
}

.task-device-item.selected .task-device-radio { border-color: #00d2ff; }
.task-device-item.selected .task-device-radio::after {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #00d2ff;
}

.task-device-info { flex: 1; min-width: 0; }
.task-device-name { font-size: 13px; color: #ddd; }
.task-device-cap { font-size: 10px; color: #666; }

.task-device-state {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 6px;
  flex-shrink: 0;
}
.task-device-state.online { background: rgba(34,197,94,0.15); color: #22c55e; }
.task-device-state.offline { background: rgba(239,68,68,0.1); color: #ef4444; }

/* ---- 提交按钮 ---- */
.task-submit-btn {
  width: 100%;
  padding: 13px;
  border: none;
  border-radius: 10px;
  background: linear-gradient(135deg, #00d2ff, #3a7bd5);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
  letter-spacing: 0.5px;
  margin-top: 4px;
}

.task-submit-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(0,210,255,0.25); }
.task-submit-btn:active { transform: translateY(0); }
.task-submit-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }

/* ---- 运行监控 ---- */
.task-monitor-section { margin-bottom: 8px; }

.task-monitor-section-title {
  font-size: 11px;
  font-weight: 600;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
  padding: 0 4px;
}

/* ---- 运行中任务卡片（监控视图） ---- */
.task-monitor-card {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(0,210,255,0.2);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 10px;
}

.task-monitor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.task-monitor-name { font-size: 14px; font-weight: 500; color: #fff; }
.task-monitor-timer { font-size: 12px; color: #888; font-family: monospace; }

.task-monitor-stage {
  font-size: 12px;
  color: #888;
  margin-bottom: 6px;
}
.task-monitor-target { font-size: 11px; color: #555; margin-bottom: 8px; }

.task-monitor-progress {
  height: 4px;
  background: rgba(255,255,255,0.08);
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 10px;
}

.task-monitor-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #00d2ff, #3a7bd5);
  border-radius: 2px;
  transition: width 0.5s ease;
}

.task-monitor-log {
  background: rgba(0,0,0,0.4);
  border-radius: 8px;
  margin-bottom: 10px;
  overflow: hidden;
}

.task-monitor-log-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background: rgba(0,0,0,0.2);
  cursor: pointer;
  font-size: 11px;
  color: #888;
}

.task-monitor-log-header:hover { color: #aaa; }

.task-monitor-log-content {
  height: 120px;
  overflow-y: auto;
  padding: 8px 12px;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 11px;
  line-height: 1.5;
}

.task-monitor-log-content.collapsed { display: none; }

.task-monitor-log-line { white-space: pre-wrap; word-break: break-all; }
.task-monitor-log-time { color: #555; user-select: none; }
.task-monitor-log-stdout { color: #c0c0c0; }
.task-monitor-log-stderr { color: #ff6b6b; }
.task-monitor-log-system { color: #69db7c; }

.task-monitor-actions {
  display: flex;
  gap: 6px;
}

/* ---- 排队中卡片 ---- */
.task-queued-card {
  background: rgba(255,255,255,0.02);
  border: 1px dashed rgba(255,255,255,0.1);
  border-radius: 10px;
  padding: 12px 16px;
  margin-bottom: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.task-queued-info { display: flex; align-items: center; gap: 8px; }
.task-queued-name { font-size: 13px; color: #aaa; }
.task-queued-status { font-size: 11px; color: #888; }

/* ---- 已完成/失败迷你卡片（监控视图） ---- */
.task-done-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: rgba(255,255,255,0.02);
  border-radius: 8px;
  margin-bottom: 4px;
  transition: all 0.2s;
}

.task-done-card:hover { background: rgba(255,255,255,0.05); }

/* ---- 编辑视图 ---- */
.task-edit-file-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: rgba(255,255,255,0.02);
  border-radius: 8px;
  margin-bottom: 4px;
}

.task-edit-file-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #ccc;
}

.task-edit-file-actions { display: flex; gap: 4px; }

/* ---- 结果视图 ---- */
.task-result-layout {
  display: flex;
  gap: 12px;
}

.task-result-history {
  width: 160px;
  flex-shrink: 0;
}

.task-result-history-item {
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 2px;
  color: #888;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-result-history-item:hover { background: rgba(255,255,255,0.05); color: #ccc; }
.task-result-history-item.selected { background: rgba(0,210,255,0.1); color: #8cf; }

.task-result-history-item .result-icon { margin-right: 4px; }

.task-result-detail {
  flex: 1;
  min-width: 0;
}

.task-result-meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-bottom: 12px;
}

.task-result-meta-item {
  font-size: 12px;
  color: #888;
}

.task-result-meta-item strong { color: #ccc; }

.task-result-files {
  margin-bottom: 12px;
}

.task-result-file {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: rgba(255,255,255,0.02);
  border-radius: 6px;
  margin-bottom: 2px;
  font-size: 12px;
}

.task-result-file-name { color: #ccc; display: flex; align-items: center; gap: 4px; }
.task-result-file-actions { display: flex; gap: 4px; }

.task-result-log {
  background: rgba(0,0,0,0.4);
  border-radius: 8px;
  overflow: hidden;
}

.task-result-log-header {
  padding: 6px 12px;
  background: rgba(0,0,0,0.2);
  font-size: 11px;
  color: #888;
  cursor: pointer;
}

.task-result-log-content {
  height: 150px;
  overflow-y: auto;
  padding: 8px 12px;
  font-family: monospace;
  font-size: 11px;
  line-height: 1.5;
}

/* ---- 空状态 ---- */
.task-empty-state {
  text-align: center;
  padding: 40px 20px;
  color: #555;
}

.task-empty-state-icon { font-size: 40px; margin-bottom: 10px; opacity: 0.3; }
.task-empty-state-text { font-size: 13px; }

/* ---- 图片预览 ---- */
.task-img-preview {
  max-width: 100%;
  max-height: 200px;
  border-radius: 8px;
  margin-top: 8px;
}

/* ---- JSON 预览 ---- */
.task-json-preview {
  background: rgba(0,0,0,0.3);
  border-radius: 6px;
  padding: 10px;
  font-family: monospace;
  font-size: 11px;
  color: #8cf;
  margin-top: 8px;
  white-space: pre-wrap;
  max-height: 200px;
  overflow-y: auto;
}

/* ---- 确认对话框 ---- */
.task-confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.task-confirm-box {
  background: #1a1a2e;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 14px;
  padding: 24px;
  min-width: 280px;
  max-width: 360px;
}

.task-confirm-title { font-size: 16px; font-weight: 600; color: #fff; margin-bottom: 8px; }
.task-confirm-msg { font-size: 13px; color: #888; margin-bottom: 20px; line-height: 1.5; }

.task-confirm-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.task-confirm-btn {
  padding: 8px 20px;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.task-confirm-btn.cancel { background: rgba(255,255,255,0.08); color: #aaa; }
.task-confirm-btn.cancel:hover { background: rgba(255,255,255,0.15); color: #fff; }

.task-confirm-btn.confirm { background: rgba(239,68,68,0.15); color: #ef4444; }
.task-confirm-btn.confirm:hover { background: rgba(239,68,68,0.25); }
```

---

### 任务 5: 前端 JS — TaskPanel 框架与标签导航

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/task-panel.js`

- [ ] **步骤 1: 重写 task-panel.js — 框架代码、标签切换、状态管理**

完整重写 task-panel.js。核心结构：

```javascript
(function() {
  'use strict';

  var TaskPanel = {
    instances: new Map(),           // 所有实例状态
    displayList: [],                // 设备列表
    taskList: [],                   // 任务列表缓存
    currentTab: 'list',             // 当前标签
    viewStack: [],                  // 导航栈 (list/edit/result)
    timers: {},                     // 运行中任务计时器

    init: function() {
      if (this._initDone) return;
      this._initDone = true;
      this._render();
      this._setupWS();
      this._bindTabs();
      // 首次加载任务列表
      this._requestTaskList();
    },

    _send: function(msg) {
      var ws = window.WebSocketManager;
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        ws.ws.send(JSON.stringify(msg));
      }
    },

    // ---- 渲染面板框架 ----
    _render: function() {
      var panel = document.getElementById('panel-task');
      if (!panel) return;
      panel.innerHTML =
        '<div class="task-tabs" id="taskTabs">' +
          '<button class="task-tab active" data-tab="list">📋 任务列表</button>' +
          '<button class="task-tab" data-tab="new">➕ 新建任务</button>' +
          '<button class="task-tab" data-tab="monitor">🔄 运行中<span class="badge" id="taskMonitorBadge"></span></button>' +
        '</div>' +
        '<div id="taskTabList" class="task-tab-content active"></div>' +
        '<div id="taskTabNew" class="task-tab-content"></div>' +
        '<div id="taskTabMonitor" class="task-tab-content"></div>';
    },

    // ---- 标签绑定 ----
    _bindTabs: function() {
      var self = this;
      document.getElementById('taskTabs').addEventListener('click', function(e) {
        var btn = e.target.closest('.task-tab');
        if (!btn) return;
        var tab = btn.dataset.tab;
        // 清除所有标签激活状态
        document.querySelectorAll('.task-tab').forEach(function(t) { t.classList.remove('active'); });
        btn.classList.add('active');
        // 切换内容
        document.querySelectorAll('.task-tab-content').forEach(function(c) { c.classList.remove('active'); });
        var content = document.getElementById('taskTab' + tab.charAt(0).toUpperCase() + tab.slice(1));
        if (content) content.classList.add('active');
        self.currentTab = tab;
        self.viewStack = [];
        // 进入标签时刷新数据
        if (tab === 'list') self._requestTaskList();
        if (tab === 'monitor') self._renderMonitor();
      });
    }
  };
```

后续步骤添加各视图渲染方法。

---

### 任务 6: 前端 JS — 任务列表视图

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/task-panel.js`

在 `_bindTabs` 之后添加：

- [ ] **步骤 1: 实现 `_requestTaskList()` 和 `_renderTaskList()`**

```javascript
    _requestTaskList: function() {
      this._send({ type: 'task:list', payload: { filter: 'all' } });
    },

    _handleTaskList: function(tasks) {
      this.taskList = tasks;
      if (this.currentTab === 'list') this._renderTaskList();
    },

    _renderTaskList: function() {
      var container = document.getElementById('taskTabList');
      if (!container) return;

      var builtin = this.taskList.filter(function(t) { return t.taskType === 'builtin'; });
      var user = this.taskList.filter(function(t) { return t.taskType !== 'builtin'; });

      var html = '<input class="task-search" id="taskSearch" placeholder="搜索任务名称..." oninput="TaskPanel._filterTasks()">';

      // 内置任务
      if (builtin.length > 0) {
        html += '<div class="task-group-title">🛠️ 内置任务（只读）</div>';
        html += builtin.map(function(t) { return this._taskCardHTML(t); }, this).join('');
      }

      // 用户任务
      html += '<div class="task-group-title">📦 用户任务</div>';
      if (user.length === 0) {
        html += '<div class="task-empty-state">' +
          '<div class="task-empty-state-icon">⚡</div>' +
          '<div class="task-empty-state-text">还没有用户任务，切换到「新建任务」标签创建一个</div>' +
        '</div>';
      } else {
        html += user.map(function(t) { return this._taskCardHTML(t); }, this).join('');
      }

      container.innerHTML = html;
    },

    _taskCardHTML: function(task) {
      var self = this;
      var icon = '📄';
      var statusClass = '';
      var statusText = '就绪';
      var progressHtml = '';
      var isRunning = false;

      // 从 instances 推断状态
      if (task.instances && task.instances.length > 0) {
        var latest = task.instances[0];
        if (latest.status === 'running') { icon = '🔄'; statusClass = 'running'; statusText = '运行中'; isRunning = true; }
        else if (latest.status === 'completed') { icon = '✅'; statusClass = 'completed'; statusText = '已完成'; }
        else if (latest.status === 'failed') { icon = '❌'; statusClass = 'failed'; statusText = '失败'; }
        else if (latest.status === 'stopped') { icon = '⏹'; statusClass = 'stopped'; statusText = '已停止'; }
        else if (latest.status === 'pending' || latest.status === 'pending_forward') { icon = '⏳'; statusClass = 'pending'; statusText = '排队中'; }

        if (latest.progress != null && latest.status === 'running') {
          progressHtml = '<div class="task-card-progress"><div class="task-card-progress-fill" style="width:' + latest.progress + '%"></div></div>';
        }
      }

      var isBuiltin = task.taskType === 'builtin';
      var cardClass = 'task-card' + (isBuiltin ? ' builtin' : '') + (statusClass ? ' ' + statusClass : '');

      var metaHtml = '';
      if (task.files && task.files.length > 0) {
        metaHtml += '<span>📄 ' + task.files.length + ' 个文件</span>';
      }
      if (!isBuiltin && latest && latest.timestamp) {
        metaHtml += '<span>⏱ ' + this._formatTime(latest.timestamp) + '</span>';
      }

      var actionsHtml = '';
      if (isBuiltin) {
        actionsHtml += '<button class="task-card-btn primary" onclick="TaskPanel._runBuiltin(\'' + task.taskName + '\')">运行</button>';
        actionsHtml += '<button class="task-card-btn" onclick="TaskPanel._viewBuiltinParams(\'' + task.taskName + '\')">参数</button>';
      } else {
        actionsHtml += '<button class="task-card-btn" onclick="TaskPanel._viewEdit(\'' + task.taskName + '\')">编辑</button>';
        if (task.instances && task.instances.length > 0) {
          actionsHtml += '<button class="task-card-btn" onclick="TaskPanel._viewResults(\'' + task.taskName + '\')">结果</button>';
        }
        actionsHtml += '<button class="task-card-btn danger" onclick="TaskPanel._confirmDelete(\'' + task.taskName + '\')">删除</button>';
      }

      return '<div class="' + cardClass + '">' +
        '<div class="task-card-header">' +
          '<div class="task-card-title"><span class="task-card-icon">' + icon + '</span>' + (task.name || task.taskName) + '</div>' +
          '<span class="task-card-status ' + statusClass + '">' + statusText + '</span>' +
        '</div>' +
        '<div class="task-card-meta">' + metaHtml + '</div>' +
        progressHtml +
        '<div class="task-card-actions">' + actionsHtml + '</div>' +
      '</div>';
    },

    _filterTasks: function() {
      var q = document.getElementById('taskSearch').value.toLowerCase();
      var cards = document.querySelectorAll('#taskTabList .task-card');
      cards.forEach(function(c) {
        var name = c.querySelector('.task-card-title')?.textContent?.toLowerCase() || '';
        c.style.display = name.indexOf(q) >= 0 ? '' : 'none';
      });
    },

    _formatTime: function(ts) {
      var d = new Date(ts);
      return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    }
```

---

### 任务 7: 前端 JS — 新建任务表单 + 设备选择器

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/task-panel.js`

在 `_formatTime` 之后添加：

- [ ] **步骤 1: 实现 `_renderNewTask()` 和表单交互**

```javascript
    _renderNewTask: function() {
      var container = document.getElementById('taskTabNew');
      if (!container) return;
      container.innerHTML =
        '<div class="task-form-section">' +
          '<div class="task-form-section-title">基本信息</div>' +
          '<div class="task-form-row">' +
            '<div class="task-form-field">' +
              '<label>任务名称</label>' +
              '<input type="text" id="taskName" placeholder="my-task">' +
            '</div>' +
          '</div>' +
          '<div class="task-form-row">' +
            '<div class="task-form-field">' +
              '<label>任务类型</label>' +
              '<select id="taskTypeSelect">' +
                '<option value="user">用户代码</option>' +
                '<option value="builtin">内置功能</option>' +
              '</select>' +
            '</div>' +
            '<div class="task-form-field" id="entryFileField">' +
              '<label>入口文件</label>' +
              '<input type="text" id="entryFile" value="task.js" placeholder="task.js">' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="task-form-section">' +
          '<div class="task-form-section-title">执行配置</div>' +
          '<div class="task-form-row">' +
            '<div class="task-form-field">' +
              '<label>执行目标</label>' +
              '<div class="task-btn-group" id="targetGroup">' +
                '<button class="task-btn-option active" data-value="server">服务端</button>' +
                '<button class="task-btn-option" data-value="display">显示端</button>' +
                '<button class="task-btn-option" data-value="subdisplay">子显示端</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="task-form-row">' +
            '<div class="task-form-field">' +
              '<label>执行环境</label>' +
              '<div class="task-btn-group" id="envGroup">' +
                '<button class="task-btn-option active" data-value="auto">自适应</button>' +
                '<button class="task-btn-option" data-value="cpu">CPU</button>' +
                '<button class="task-btn-option" data-value="webgl">WebGL</button>' +
                '<button class="task-btn-option" data-value="webgpu">WebGPU</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="task-form-row">' +
            '<div class="task-form-field">' +
              '<label>模式</label>' +
              '<div class="task-btn-group" id="modeGroup">' +
                '<button class="task-btn-option active" data-value="one-shot">一次性</button>' +
                '<button class="task-btn-option" data-value="resident">常驻</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="task-form-section" id="deviceSelectorSection" style="display:none">' +
          '<div class="task-form-section-title">目标设备</div>' +
          '<div class="task-device-list" id="deviceSelectorList">' +
            '<div class="task-empty-state" style="padding:16px"><div class="task-empty-state-text">加载设备列表中...</div></div>' +
          '</div>' +
        '</div>' +

        '<div class="task-form-section">' +
          '<div class="task-form-section-title">文件上传</div>' +
          '<div id="userFilesSection">' +
            '<div class="task-file-zone" id="taskFileZone">' +
              '<div class="task-file-zone-icon">📂</div>' +
              '<div class="task-file-zone-text">点击选择或拖拽文件到此处</div>' +
              '<div class="task-file-zone-hint">执行文件 + 输入文件</div>' +
            '</div>' +
            '<input type="file" id="taskFiles" multiple style="display:none">' +
            '<div class="task-file-list" id="taskFileList"></div>' +
          '</div>' +
          '<div id="builtinSection" style="display:none">' +
            '<div class="task-form-field">' +
              '<label>内置功能</label>' +
              '<select id="builtinId"></select>' +
            '</div>' +
            '<div id="builtinParams" style="margin-top:8px"></div>' +
          '</div>' +
        '</div>' +

        '<div class="task-form-section">' +
          '<div class="task-form-section-title">参数 (JSON)</div>' +
          '<textarea id="taskParams" rows="2" placeholder=\'{"width": 800}\'></textarea>' +
        '</div>' +

        '<button class="task-submit-btn" id="taskSubmitBtn">⚡ 提交任务</button>';

      this._bindFormEvents();
      this._renderDeviceSelector();
    },

    _bindFormEvents: function() {
      var self = this;

      // 任务类型切换
      document.getElementById('taskTypeSelect').addEventListener('change', function(e) {
        var isBuiltin = e.target.value === 'builtin';
        document.getElementById('entryFileField').style.display = isBuiltin ? 'none' : 'block';
        document.getElementById('userFilesSection').style.display = isBuiltin ? 'none' : 'block';
        document.getElementById('builtinSection').style.display = isBuiltin ? 'block' : 'none';
        if (isBuiltin) self._loadBuiltinTasks();
      });

      // 按钮式选择组
      document.querySelectorAll('.task-btn-group').forEach(function(group) {
        group.addEventListener('click', function(e) {
          var btn = e.target.closest('.task-btn-option');
          if (!btn) return;
          group.querySelectorAll('.task-btn-option').forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');

          // 目标切换时显示/隐藏设备选择器
          if (group.id === 'targetGroup') {
            var showDevice = btn.dataset.value === 'display' || btn.dataset.value === 'subdisplay';
            document.getElementById('deviceSelectorSection').style.display = showDevice ? 'block' : 'none';
          }
        });
      });

      // 文件拖拽
      var fileZone = document.getElementById('taskFileZone');
      var fileInput = document.getElementById('taskFiles');
      if (fileZone && fileInput) {
        fileZone.addEventListener('click', function() { fileInput.click(); });
        fileZone.addEventListener('dragover', function(e) { e.preventDefault(); fileZone.classList.add('dragover'); });
        fileZone.addEventListener('dragleave', function() { fileZone.classList.remove('dragover'); });
        fileZone.addEventListener('drop', function(e) {
          e.preventDefault();
          fileZone.classList.remove('dragover');
          if (e.dataTransfer.files.length > 0) {
            fileInput.files = e.dataTransfer.files;
            self._updateFileList();
          }
        });
        fileInput.addEventListener('change', function() { self._updateFileList(); });
      }

      // 提交
      document.getElementById('taskSubmitBtn').addEventListener('click', function() { self._submit(); });
    },

    _updateFileList: function() {
      var files = document.getElementById('taskFiles').files;
      var list = document.getElementById('taskFileList');
      if (!list) return;
      list.innerHTML = '';
      for (var i = 0; i < files.length; i++) {
        var chip = document.createElement('span');
        chip.className = 'task-file-chip';
        chip.innerHTML = '📄 ' + files[i].name + ' <span style="color:#666">(' + (files[i].size / 1024).toFixed(1) + 'KB)</span>';
        list.appendChild(chip);
      }
    },

    _renderDeviceSelector: function() {
      var list = document.getElementById('deviceSelectorList');
      if (!list) return;
      var html = '<div class="task-device-item selected" data-id="">' +
        '<div class="task-device-radio"></div>' +
        '<div class="task-device-info"><div class="task-device-name">自动选择</div></div>' +
        '<span class="task-device-state online">推荐</span>' +
      '</div>';
      for (var i = 0; i < this.displayList.length; i++) {
        var d = this.displayList[i];
        var isOnline = d.capabilities && Object.keys(d.capabilities).length > 0;
        var caps = d.capabilities || {};
        var capText = [];
        if (caps.webgpu) capText.push('WebGPU');
        else if (caps.webgl) capText.push('WebGL');
        if (caps.cpu) capText.push('CPU');
        html += '<div class="task-device-item" data-id="' + d.id + '">' +
          '<div class="task-device-radio"></div>' +
          '<div class="task-device-info">' +
            '<div class="task-device-name">' + (d.isSubDisplay ? "📺 " : "🖥️ ") + d.id + '</div>' +
            '<div class="task-device-cap">' + capText.join(', ') + '</div>' +
          '</div>' +
          '<span class="task-device-state ' + (isOnline ? 'online' : 'offline') + '">' + (isOnline ? '在线' : '离线') + '</span>' +
        '</div>';
      }
      list.innerHTML = html;

      // 绑定选择事件
      list.addEventListener('click', function(e) {
        var item = e.target.closest('.task-device-item');
        if (!item) return;
        list.querySelectorAll('.task-device-item').forEach(function(el) { el.classList.remove('selected'); });
        item.classList.add('selected');
      });
    },

    _loadBuiltinTasks: function() {
      // 从 taskList 中过滤 builtin 任务填充下拉
      var sel = document.getElementById('builtinId');
      if (!sel) return;
      var builtin = this.taskList.filter(function(t) { return t.taskType === 'builtin'; });
      sel.innerHTML = builtin.map(function(t) {
        return '<option value="' + t.taskName + '">' + (t.name || t.taskName) + '</option>';
      }).join('');
      if (builtin.length === 0) {
        sel.innerHTML = '<option value="">暂无内置任务</option>';
      }
    },
```

---

### 任务 8: 前端 JS — 提交任务 + WebSocket 消息处理

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/task-panel.js`

在 `_loadBuiltinTasks` 之后添加：

- [ ] **步骤 1: 实现 `_submit()` 方法**

```javascript
    _submit: function() {
      var self = this;
      var taskName = document.getElementById('taskName').value.trim();
      if (!taskName) { alert('请输入任务名称'); return; }

      var files = [];
      var fileInput = document.getElementById('taskFiles');
      var pending = fileInput ? fileInput.files.length : 0;

      if (pending === 0) {
        this._doSubmit(taskName, files);
        return;
      }

      for (var i = 0; i < fileInput.files.length; i++) {
        (function(file) {
          var reader = new FileReader();
          reader.onload = function() {
            files.push({ name: file.name, data: reader.result.split(',')[1] });
            pending--;
            if (pending === 0) self._doSubmit(taskName, files);
          };
          reader.readAsDataURL(file);
        })(fileInput.files[i]);
      }
    },

    _doSubmit: function(taskName, files) {
      var params = {};
      try {
        var t = document.getElementById('taskParams').value;
        if (t) params = JSON.parse(t);
      } catch(e) { alert('参数 JSON 格式错误'); return; }

      var targetEl = document.querySelector('#targetGroup .task-btn-option.active');
      var envEl = document.querySelector('#envGroup .task-btn-option.active');
      var modeEl = document.querySelector('#modeGroup .task-btn-option.active');
      var typeEl = document.getElementById('taskTypeSelect');
      var deviceEl = document.querySelector('#deviceSelectorList .task-device-item.selected');
      var displayId = deviceEl && deviceEl.dataset.id ? deviceEl.dataset.id : null;
      // 如果目标是 server，忽略 displayId
      var target = targetEl ? targetEl.dataset.value : 'server';
      if (target === 'server') displayId = null;

      var msg = {
        type: 'task:submit',
        payload: {
          taskName: taskName,
          taskType: typeEl ? typeEl.value : 'user',
          entryFile: document.getElementById('entryFile') ? document.getElementById('entryFile').value.trim() : 'task.js',
          target: target,
          displayId: displayId,
          mode: modeEl ? modeEl.dataset.value : 'one-shot',
          env: envEl ? envEl.dataset.value : 'auto',
          files: files,
          params: params
        }
      };

      this._send(msg);
      // 切换到运行监控
      document.querySelector('[data-tab="monitor"]').click();
    },

    _runBuiltin: function(taskName) {
      this._send({
        type: 'task:submit',
        payload: {
          taskName: taskName,
          taskType: 'builtin',
          builtinId: taskName,
          target: 'server',
          mode: 'one-shot',
          env: 'auto',
          params: {},
          files: []
        }
      });
      // 切换到监控标签
      document.querySelector('[data-tab="monitor"]').click();
    },

    _viewBuiltinParams: function(taskName) {
      // 切换到新建任务标签并选中内置任务类型
      var tab = document.querySelector('[data-tab="new"]');
      if (tab) tab.click();
      var typeSel = document.getElementById('taskTypeSelect');
      if (typeSel) { typeSel.value = 'builtin'; typeSel.dispatchEvent(new Event('change')); }
      var builtinSel = document.getElementById('builtinId');
      if (builtinSel) { builtinSel.value = taskName; builtinSel.dispatchEvent(new Event('change')); }
    },
```

- [ ] **步骤 2: 配置 WebSocket 消息处理**

在初始化方法中添加 WebSocket 消息钩子。替换 `_setupWS` 方法：

```javascript
    _setupWS: function() {
      var self = this;
      var ws = window.WebSocketManager;
      if (!ws) { setTimeout(function() { self._setupWS(); }, 500); return; }
      var orig = ws.handleMessage;
      ws.handleMessage = function(data) {
        if (data.type === 'displayList') {
          self.displayList = data.list || [];
          // 如果设备选择器已渲染，刷新
          if (document.getElementById('deviceSelectorList')) {
            self._renderDeviceSelector();
          }
        }
        if (data.type === 'task:list:result') {
          self._handleTaskList(data.payload.tasks || []);
        }
        if (data.type === 'task:submitted') {
          self._onSubmitted(data.payload);
        }
        if (data.type === 'task:progress') {
          self._updateProgress(data.payload);
        }
        if (data.type === 'task:log') {
          self._onLog(data.payload);
        }
        if (data.type === 'task:result') {
          self._onResult(data.payload);
        }
        if (data.type === 'task:error') {
          self._onTaskError(data.payload);
        }
        if (data.type === 'task:stopped') {
          self._onStopped(data.payload);
        }
        if (data.type === 'task:deleted') {
          self._onDeleted(data.payload);
        }
        if (data.type === 'task:updated') {
          self._onUpdated(data.payload);
        }
        if (orig) orig.call(ws, data);
      };
      // 请求设备列表
      self._send({ type: 'displayList' });
    },

    _onSubmitted: function(payload) {
      this.instances.set(payload.instanceId, {
        instanceId: payload.instanceId,
        taskName: payload.taskName,
        status: payload.status || 'pending',
        stage: 'submitted',
        progress: 0,
        timestamp: Date.now(),
        logs: []
      });
      this._updateMonitorBadge();
      if (this.currentTab === 'monitor') this._renderMonitor();
    },

    _updateProgress: function(payload) {
      var inst = this.instances.get(payload.instanceId);
      if (inst) {
        inst.stage = payload.stage;
        inst.progress = payload.progress;
        if (payload.target) inst.target = payload.target;
        this._updateMonitorBadge();
        if (this.currentTab === 'monitor') this._renderMonitor();
      }
    },

    _onLog: function(payload) {
      var inst = this.instances.get(payload.instanceId);
      if (!inst) {
        // 可能来自旧实例，创建占位
        this.instances.set(payload.instanceId, {
          instanceId: payload.instanceId,
          taskName: payload.taskName,
          status: 'running',
          stage: 'running',
          progress: 0,
          timestamp: Date.now(),
          logs: []
        });
        inst = this.instances.get(payload.instanceId);
      }
      if (inst) {
        if (!inst.logs) inst.logs = [];
        inst.logs.push({
          stream: payload.stream || 'stdout',
          level: payload.level || 'info',
          message: payload.message,
          time: payload.timestamp || Date.now()
        });
        if (this.currentTab === 'monitor') this._renderMonitor();
      }
    },

    _onResult: function(payload) {
      var inst = this.instances.get(payload.instanceId);
      if (inst) {
        inst.status = payload.success ? 'completed' : 'failed';
        inst.result = payload;
        inst.completedAt = Date.now();
        this._updateMonitorBadge();
        if (this.currentTab === 'monitor') this._renderMonitor();
        // 刷新任务列表
        this._requestTaskList();
      }
    },

    _onTaskError: function(payload) {
      console.error('Task error:', payload.error);
    },

    _onStopped: function(payload) {
      var inst = this.instances.get(payload.instanceId);
      if (inst) {
        inst.status = 'stopped';
        this._updateMonitorBadge();
        if (this.currentTab === 'monitor') this._renderMonitor();
      }
    },

    _onDeleted: function(payload) {
      if (payload.success) {
        this._requestTaskList();
      }
    },

    _onUpdated: function(payload) {
      if (payload.success) {
        this._renderTaskList();
        this._showView('list');
      }
    },

    _updateMonitorBadge: function() {
      var badge = document.getElementById('taskMonitorBadge');
      if (!badge) return;
      var count = 0;
      this.instances.forEach(function(inst) {
        if (inst.status === 'running' || inst.status === 'pending' || inst.status === 'pending_forward') count++;
      });
      badge.classList.toggle('show', count > 0);
    },
```

---

### 任务 9: 前端 JS — 运行监控标签

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/task-panel.js`

在 `_updateMonitorBadge` 之后添加：

- [ ] **步骤 1: 实现 `_renderMonitor()` 方法**

```javascript
    _renderMonitor: function() {
      var container = document.getElementById('taskTabMonitor');
      if (!container) return;

      var active = [];  // running/pending/pending_forward
      var done = [];    // completed/failed/stopped

      this.instances.forEach(function(inst) {
        if (inst.status === 'running' || inst.status === 'pending' || inst.status === 'pending_forward') {
          active.push(inst);
        } else {
          done.push(inst);
        }
      });

      // 按时间降序
      active.sort(function(a, b) { return b.timestamp - a.timestamp; });
      done.sort(function(a, b) { return (b.completedAt || b.timestamp) - (a.completedAt || a.timestamp); });

      var html = '';

      // 活跃任务
      if (active.length > 0) {
        html += '<div class="task-monitor-section"><div class="task-monitor-section-title">🔄 活跃任务</div>';
        html += active.map(function(inst) { return this._monitorActiveCard(inst); }, this).join('');
        html += '</div>';
      }

      // 最近完成
      if (done.length > 0) {
        html += '<div class="task-monitor-section" style="margin-top:16px"><div class="task-monitor-section-title">📋 最近完成</div>';
        html += done.slice(0, 10).map(function(inst) { return this._monitorDoneCard(inst); }, this).join('');
        html += '</div>';
      }

      if (active.length === 0 && done.length === 0) {
        html += '<div class="task-empty-state">' +
          '<div class="task-empty-state-icon">⚡</div>' +
          '<div class="task-empty-state-text">暂无任务实例，提交任务后将在此显示</div>' +
        '</div>';
      }

      container.innerHTML = html;

      // 启动计时器
      this._startTimers();
    },

    _monitorActiveCard: function(inst) {
      var logs = inst.logs || [];
      var recentLogs = logs.slice(-20);
      var logHtml = recentLogs.map(function(l) {
        var time = l.time ? new Date(l.time) : new Date();
        var ts = ('0' + time.getHours()).slice(-2) + ':' + ('0' + time.getMinutes()).slice(-2) + ':' + ('0' + time.getSeconds()).slice(-2);
        var cls = 'task-monitor-log-' + (l.stream === 'stderr' ? 'stderr' : l.stream === 'system' ? 'system' : 'stdout');
        return '<div class="task-monitor-log-line ' + cls + '"><span class="task-monitor-log-time">' + ts + '</span> ' + this._escapeHtml(l.message) + '</div>';
      }, this).join('');

      var duration = '';
      if (inst.timestamp) {
        var elapsed = Math.floor((Date.now() - inst.timestamp) / 1000);
        var m = Math.floor(elapsed / 60);
        var s = elapsed % 60;
        duration = ('0' + m).slice(-2) + ':' + ('0' + s).slice(-2);
      }

      var progressBar = inst.progress != null && inst.status === 'running'
        ? '<div class="task-monitor-progress"><div class="task-monitor-progress-fill" style="width:' + inst.progress + '%"></div></div>'
        : '';

      var canStop = inst.status === 'running';
      var canMigrate = inst.status === 'running';

      return '<div class="task-monitor-card" data-instance="' + inst.instanceId + '">' +
        '<div class="task-monitor-header">' +
          '<span class="task-monitor-name">' + (inst.taskName || '-') + '</span>' +
          '<span class="task-monitor-timer">' + (inst.status === 'pending' ? '排队中' : duration) + '</span>' +
        '</div>' +
        '<div class="task-monitor-stage">阶段: ' + (inst.stage || inst.status) + '</div>' +
        '<div class="task-monitor-target">执行于: ' + (inst.target || '服务端') + ' ｜ ' + inst.instanceId.substring(0, 8) + '</div>' +
        progressBar +
        '<div class="task-monitor-log">' +
          '<div class="task-monitor-log-header" onclick="this.nextElementSibling.classList.toggle(\'collapsed\')">' +
            '📋 实时日志 (' + logs.length + ' 行)' +
          '</div>' +
          '<div class="task-monitor-log-content">' + (logHtml || '<div style="color:#555">等待日志...</div>') + '</div>' +
        '</div>' +
        '<div class="task-monitor-actions">' +
          (canStop ? '<button class="task-card-btn danger" onclick="TaskPanel._stopInstance(\'' + inst.instanceId + '\')">⏹ 停止</button>' : '') +
          (canMigrate ? '<button class="task-card-btn" onclick="TaskPanel._migrateInstance(\'' + inst.instanceId + '\')">📤 迁移到...</button>' : '') +
        '</div>' +
      '</div>';
    },

    _monitorDoneCard: function(inst) {
      var icon = inst.status === 'completed' ? '✅' : inst.status === 'failed' ? '❌' : '⏹';
      var label = inst.status === 'completed' ? '已完成' : inst.status === 'failed' ? '失败' : '已停止';
      return '<div class="task-done-card">' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<span>' + icon + '</span>' +
          '<span style="font-size:13px;color:#aaa">' + (inst.taskName || '-') + '</span>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<span style="font-size:11px;color:#666">' + label + '</span>' +
          '<button class="task-card-btn" onclick="TaskPanel._viewInstanceResults(\'' + inst.instanceId + '\')">📂 查看结果</button>' +
        '</div>' +
      '</div>';
    },

    _startTimers: function() {
      var self = this;
      if (this._timerInterval) clearInterval(this._timerInterval);
      this._timerInterval = setInterval(function() {
        var hasActive = false;
        self.instances.forEach(function(inst) {
          if (inst.status === 'running') hasActive = true;
        });
        if (hasActive && self.currentTab === 'monitor') {
          self._renderMonitor();
        } else if (!hasActive) {
          clearInterval(self._timerInterval);
          self._timerInterval = null;
        }
      }, 1000);
    },

    _stopInstance: function(instanceId) {
      var inst = this.instances.get(instanceId);
      if (!inst) return;
      this._send({ type: 'task:stop', payload: { taskName: inst.taskName, instanceId: instanceId } });
    },

    _migrateInstance: function(instanceId) {
      var inst = this.instances.get(instanceId);
      if (!inst) return;
      // 弹出设备选择器
      this._showDevicePicker(function(deviceId) {
        // 先停止旧实例
        this._send({ type: 'task:stop', payload: { taskName: inst.taskName, instanceId: instanceId } });
        // 提交新实例到目标设备
        this._send({ type: 'task:submit', payload: {
          taskName: inst.taskName,
          taskType: 'user',
          target: deviceId ? 'display' : 'server',
          displayId: deviceId || null,
          mode: inst.mode || 'one-shot',
          env: inst.env || 'auto',
          params: {},
          files: []
        }});
      }.bind(this));
    },

    _showDevicePicker: function(callback) {
      var self = this;
      var overlay = document.createElement('div');
      overlay.className = 'task-confirm-overlay';
      var listHtml = '<div class="task-device-item selected" data-id="">' +
        '<div class="task-device-radio"></div><div class="task-device-info"><div class="task-device-name">服务端 (当前)</div></div>' +
      '</div>';
      for (var i = 0; i < this.displayList.length; i++) {
        var d = this.displayList[i];
        listHtml += '<div class="task-device-item" data-id="' + d.id + '">' +
          '<div class="task-device-radio"></div>' +
          '<div class="task-device-info"><div class="task-device-name">' + (d.id) + '</div></div>' +
          '<span class="task-device-state online">在线</span>' +
        '</div>';
      }
      overlay.innerHTML =
        '<div class="task-confirm-box">' +
          '<div class="task-confirm-title">选择迁移目标</div>' +
          '<div class="task-device-list">' + listHtml + '</div>' +
          '<div class="task-confirm-actions" style="margin-top:16px">' +
            '<button class="task-confirm-btn cancel" id="pickerCancel">取消</button>' +
            '<button class="task-confirm-btn confirm" id="pickerConfirm" style="background:rgba(0,210,255,0.15);color:#8cf">迁移</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);

      overlay.querySelector('.task-device-list').addEventListener('click', function(e) {
        var item = e.target.closest('.task-device-item');
        if (!item) return;
        overlay.querySelectorAll('.task-device-item').forEach(function(el) { el.classList.remove('selected'); });
        item.classList.add('selected');
      });

      overlay.querySelector('#pickerCancel').onclick = function() { document.body.removeChild(overlay); };
      overlay.querySelector('#pickerConfirm').onclick = function() {
        var selected = overlay.querySelector('.task-device-item.selected');
        var id = selected ? selected.dataset.id : '';
        document.body.removeChild(overlay);
        callback(id);
      };
    },
```

---

### 任务 10: 前端 JS — 编辑任务 + 删除确认

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/task-panel.js`

在 `_showDevicePicker` 之后添加：

- [ ] **步骤 1: 编辑和删除视图**

```javascript
    _viewEdit: function(taskName) {
      var task = null;
      for (var i = 0; i < this.taskList.length; i++) {
        if (this.taskList[i].taskName === taskName) { task = this.taskList[i]; break; }
      }
      if (!task) return;

      this.viewStack = ['list'];
      this._showEditView(task);
    },

    _showEditView: function(task) {
      var container = document.getElementById('taskTabList');
      if (!container) return;

      var filesHtml = (task.files || []).map(function(f) {
        return '<div class="task-edit-file-row">' +
          '<div class="task-edit-file-info">📄 ' + f.name + ' <span style="color:#666;font-size:11px">(' + (f.size / 1024).toFixed(1) + 'KB)</span></div>' +
          '<div class="task-edit-file-actions">' +
            '<button class="task-card-btn" onclick="TaskPanel._replaceFile(\'' + task.taskName + '\',\'' + f.name + '\')">替换</button>' +
            '<button class="task-card-btn danger" onclick="TaskPanel._deleteFile(\'' + task.taskName + '\',\'' + f.name + '\')">删除</button>' +
          '</div>' +
        '</div>';
      }, this).join('');

      container.innerHTML =
        '<div class="task-breadcrumb">' +
          '<a onclick="TaskPanel._showView(\'list\')">📋 任务列表</a>' +
          '<span>></span>' +
          '<span class="current">编辑 ' + task.taskName + '</span>' +
        '</div>' +

        '<div class="task-form-section">' +
          '<div class="task-form-section-title">基本信息</div>' +
          '<div class="task-form-row">' +
            '<div class="task-form-field">' +
              '<label>任务名称</label>' +
              '<input type="text" id="editTaskName" value="' + task.taskName + '">' +
            '</div>' +
            '<div class="task-form-field">' +
              '<label>入口文件</label>' +
              '<input type="text" id="editEntryFile" value="' + (task.entryFile || 'task.js') + '">' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="task-form-section">' +
          '<div class="task-form-section-title">任务文件</div>' +
          filesHtml +
          '<div class="task-file-zone" style="margin-top:8px" id="editFileZone">' +
            '<div class="task-file-zone-text">拖拽新文件添加到任务</div>' +
          '</div>' +
          '<input type="file" id="editFiles" multiple style="display:none">' +
          '<div class="task-file-list" id="editFileList"></div>' +
        '</div>' +

        '<div class="task-form-section">' +
          '<div class="task-form-section-title">执行配置</div>' +
          '<div class="task-form-field">' +
            '<label>参数 (JSON)</label>' +
            '<textarea id="editParams" rows="2"></textarea>' +
          '</div>' +
        '</div>' +

        '<button class="task-submit-btn" onclick="TaskPanel._saveEdit(\'' + task.taskName + '\')" style="background:linear-gradient(135deg,#22c55e,#16a34a)">💾 保存修改</button>';

      // 绑定文件拖拽
      var zone = document.getElementById('editFileZone');
      var input = document.getElementById('editFiles');
      if (zone && input) {
        zone.addEventListener('click', function() { input.click(); });
        zone.addEventListener('dragover', function(e) { e.preventDefault(); zone.classList.add('dragover'); });
        zone.addEventListener('dragleave', function() { zone.classList.remove('dragover'); });
        zone.addEventListener('drop', function(e) {
          e.preventDefault();
          zone.classList.remove('dragover');
          if (e.dataTransfer.files.length > 0) {
            input.files = e.dataTransfer.files;
            TaskPanel._updateEditFileList();
          }
        });
        input.addEventListener('change', function() { TaskPanel._updateEditFileList(); });
      }
    },

    _updateEditFileList: function() {
      var files = document.getElementById('editFiles').files;
      var list = document.getElementById('editFileList');
      if (!list) return;
      list.innerHTML = '';
      for (var i = 0; i < files.length; i++) {
        var chip = document.createElement('span');
        chip.className = 'task-file-chip';
        chip.innerHTML = '📄 ' + files[i].name + ' <span style="color:#666">(' + (files[i].size / 1024).toFixed(1) + 'KB)</span> <span class="remove" onclick="this.parentElement.remove()">✕</span>';
        list.appendChild(chip);
      }
    },

    _saveEdit: function(taskName) {
      var files = [];
      var fileInput = document.getElementById('editFiles');
      var pending = fileInput ? fileInput.files.length : 0;

      if (pending === 0) {
        this._doSaveEdit(taskName, files);
        return;
      }

      var self = this;
      for (var i = 0; i < fileInput.files.length; i++) {
        (function(file) {
          var reader = new FileReader();
          reader.onload = function() {
            files.push({ name: file.name, data: reader.result.split(',')[1], action: 'replace' });
            pending--;
            if (pending === 0) self._doSaveEdit(taskName, files);
          };
          reader.readAsDataURL(file);
        })(fileInput.files[i]);
      }
    },

    _doSaveEdit: function(taskName, files) {
      var params = {};
      try {
        var t = document.getElementById('editParams').value;
        if (t) params = JSON.parse(t);
      } catch(e) { /* ignore */ }

      this._send({
        type: 'task:update',
        payload: { taskName: taskName, files: files, params: params }
      });
    },

    _confirmDelete: function(taskName) {
      var overlay = document.createElement('div');
      overlay.className = 'task-confirm-overlay';
      overlay.innerHTML =
        '<div class="task-confirm-box">' +
          '<div class="task-confirm-title">确认删除</div>' +
          '<div class="task-confirm-msg">确定要删除任务「' + taskName + '」吗？<br>所有文件和执行记录将被永久删除。</div>' +
          '<div class="task-confirm-actions">' +
            '<button class="task-confirm-btn cancel" id="delCancel">取消</button>' +
            '<button class="task-confirm-btn confirm" id="delConfirm">删除</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      document.getElementById('delCancel').onclick = function() { document.body.removeChild(overlay); };
      document.getElementById('delConfirm').onclick = function() {
        document.body.removeChild(overlay);
        TaskPanel._send({ type: 'task:delete', payload: { taskName: taskName } });
      };
    },

    _replaceFile: function(taskName, fileName) {
      var input = document.createElement('input');
      input.type = 'file';
      input.onchange = function() {
        if (input.files.length > 0) {
          var reader = new FileReader();
          reader.onload = function() {
            var data = reader.result.split(',')[1];
            TaskPanel._send({ type: 'task:update', payload: {
              taskName: taskName,
              files: [{ name: fileName, data: data, action: 'replace' }]
            }});
          };
          reader.readAsDataURL(input.files[0]);
        }
      };
      input.click();
    },

    _deleteFile: function(taskName, fileName) {
      var overlay = document.createElement('div');
      overlay.className = 'task-confirm-overlay';
      overlay.innerHTML =
        '<div class="task-confirm-box">' +
          '<div class="task-confirm-msg">确定要删除文件「' + fileName + '」吗？</div>' +
          '<div class="task-confirm-actions">' +
            '<button class="task-confirm-btn cancel" id="dfCancel">取消</button>' +
            '<button class="task-confirm-btn confirm" id="dfConfirm">删除</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      document.getElementById('dfCancel').onclick = function() { document.body.removeChild(overlay); };
      document.getElementById('dfConfirm').onclick = function() {
        document.body.removeChild(overlay);
        TaskPanel._send({ type: 'task:update', payload: {
          taskName: taskName,
          files: [{ name: fileName, action: 'delete' }]
        }});
      };
    },
```

---

### 任务 11: 前端 JS — 查看结果视图

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/task-panel.js`

在 `_deleteFile` 之后添加：

- [ ] **步骤 1: 实现 `_viewResults` 和 `_viewInstanceResults`**

```javascript
    _viewResults: function(taskName) {
      this.viewStack = ['list'];
      this._showResultsView(taskName, null);
    },

    _viewInstanceResults: function(instanceId) {
      var inst = this.instances.get(instanceId);
      if (!inst) return;
      this.viewStack = ['monitor'];
      // 切换到任务列表标签以显示结果
      document.querySelector('[data-tab="list"]').click();
      this._showResultsView(inst.taskName, instanceId);
    },

    _showResultsView: function(taskName, selectedInstanceId) {
      // 找到任务 & 其实例
      var task = null;
      for (var i = 0; i < this.taskList.length; i++) {
        if (this.taskList[i].taskName === taskName) { task = this.taskList[i]; break; }
      }
      if (!task) return;

      var instances = task.instances || [];
      // 从内存中补充状态
      instances.forEach(function(inst) {
        var memInst = this.instances.get(inst.instanceId);
        if (memInst) {
          inst.status = memInst.status;
          inst.stage = memInst.stage;
          inst.result = memInst.result;
          inst.logs = memInst.logs;
        }
      }, this);

      var selected = selectedInstanceId
        ? instances.find(function(i) { return i.instanceId === selectedInstanceId; })
        : instances[0];

      var container = document.getElementById('taskTabList');
      if (!container) return;

      var historyHtml = instances.map(function(inst) {
        var icon = inst.status === 'completed' ? '✅' : inst.status === 'failed' ? '❌' : inst.status === 'stopped' ? '⏹' : '⏳';
        var sel = inst.instanceId === (selected ? selected.instanceId : '') ? ' selected' : '';
        var time = inst.timestamp ? this._formatTime(inst.timestamp) : '';
        return '<div class="task-result-history-item' + sel + '" onclick="TaskPanel._selectResult(\'' + taskName + '\',\'' + inst.instanceId + '\')">' +
          '<span class="result-icon">' + icon + '</span> ' + time +
        '</div>';
      }, this).join('');

      var detailHtml = selected ? this._resultDetailHTML(selected) : '<div class="task-empty-state"><div class="task-empty-state-text">暂无执行记录</div></div>';

      container.innerHTML =
        '<div class="task-breadcrumb">' +
          '<a onclick="TaskPanel._showView(\'list\')">📋 任务列表</a>' +
          '<span>></span>' +
          '<span class="current">' + taskName + ' 执行结果</span>' +
        '</div>' +
        '<div class="task-result-layout">' +
          '<div class="task-result-history">' + historyHtml + '</div>' +
          '<div class="task-result-detail" id="resultDetail">' + detailHtml + '</div>' +
        '</div>';
    },

    _selectResult: function(taskName, instanceId) {
      this._showResultsView(taskName, instanceId);
    },

    _resultDetailHTML: function(inst) {
      var statusText = inst.status === 'completed' ? '✅ 完成' : inst.status === 'failed' ? '❌ 失败' : inst.status === 'stopped' ? '⏹ 已停止' : '⏳ 进行中';

      // 输出文件
      var filesHtml = '';
      var result = inst.result || {};
      var outputFiles = result.outputFiles || result.data?.outputFiles || [];
      if (outputFiles.length > 0) {
        filesHtml = outputFiles.map(function(f) {
          var url = f.url || f.name;
          var isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(f.name);
          return '<div class="task-result-file">' +
            '<div class="task-result-file-name">📄 ' + f.name + '</div>' +
            '<div class="task-result-file-actions">' +
              (isImage ? '<button class="task-card-btn" onclick="TaskPanel._previewImage(\'' + url + '\')">预览</button>' : '') +
              '<button class="task-card-btn" onclick="TaskPanel._downloadFile(\'' + url + '\')">下载</button>' +
            '</div>' +
          '</div>';
        }).join('');
      }

      // 日志
      var logs = inst.logs || [];
      var logHtml = logs.slice(-40).map(function(l) {
        var time = l.time ? new Date(l.time) : new Date();
        var ts = ('0' + time.getHours()).slice(-2) + ':' + ('0' + time.getMinutes()).slice(-2) + ':' + ('0' + time.getSeconds()).slice(-2);
        var cls = 'task-monitor-log-' + (l.stream === 'stderr' ? 'stderr' : l.stream === 'system' ? 'system' : 'stdout');
        return '<div class="task-monitor-log-line ' + cls + '"><span class="task-monitor-log-time">' + ts + '</span> ' + this._escapeHtml(l.message) + '</div>';
      }, this).join('');

      var duration = inst.completedAt && inst.timestamp
        ? Math.round((inst.completedAt - inst.timestamp) / 1000) + 's'
        : '-';

      return '<div class="task-result-meta">' +
        '<div class="task-result-meta-item">状态: <strong>' + statusText + '</strong></div>' +
        '<div class="task-result-meta-item">耗时: <strong>' + duration + '</strong></div>' +
        '<div class="task-result-meta-item">实例: <strong style="font-family:monospace">#' + inst.instanceId.substring(0, 8) + '</strong></div>' +
        '<div class="task-result-meta-item">环境: <strong>' + (result.metrics?.env || inst.env || '-') + '</strong></div>' +
      '</div>' +
      (result.error ? '<div style="color:#ef4444;font-size:13px;margin-bottom:12px">错误: ' + this._escapeHtml(result.error) + '</div>' : '') +
      (filesHtml ? '<div class="task-result-files"><div style="font-size:11px;color:#666;margin-bottom:4px">📂 输出文件</div>' + filesHtml + '</div>' : '') +
      '<div class="task-result-log">' +
        '<div class="task-result-log-header" onclick="this.nextElementSibling.classList.toggle(\'collapsed\')">📋 完整日志 (' + logs.length + ' 行)</div>' +
        '<div class="task-result-log-content">' + (logHtml || '<span style="color:#555">无日志</span>') + '</div>' +
      '</div>';
    },

    _previewImage: function(url) {
      var overlay = document.createElement('div');
      overlay.className = 'task-confirm-overlay';
      overlay.style.cursor = 'pointer';
      overlay.innerHTML = '<img src="' + url + '" style="max-width:90%;max-height:90%;border-radius:12px" onclick="this.parentElement.remove()">';
      overlay.onclick = function() { document.body.removeChild(overlay); };
      document.body.appendChild(overlay);
    },

    _downloadFile: function(url) {
      var a = document.createElement('a');
      a.href = url;
      a.download = url.split('/').pop();
      a.click();
    },
```

---

### 任务 12: 前端 JS — 导航管理和工具方法

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/task-panel.js`

在 `_downloadFile` 之后添加：

- [ ] **步骤 1: 导航栈管理 + 工具方法**

```javascript
    _showView: function(view) {
      if (view === 'list') {
        this._renderTaskList();
      }
    },

    _escapeHtml: function(text) {
      var div = document.createElement('div');
      div.appendChild(document.createTextNode(text));
      return div.innerHTML;
    },
```

- [ ] **步骤 2: 替换 init 尾部，增加 tab 切换时渲染新建任务表单**

修改 `_bindTabs` 中的标签切换逻辑，切换到 new 标签时渲染表单：

在 `_bindTabs` 方法中找到 `if (tab === 'list') self._requestTaskList();` 和 `if (tab === 'monitor') self._renderMonitor();` 之后添加：
`if (tab === 'new') self._renderNewTask();`

完整的 `_bindTabs` 变为：

```javascript
    _bindTabs: function() {
      var self = this;
      document.getElementById('taskTabs').addEventListener('click', function(e) {
        var btn = e.target.closest('.task-tab');
        if (!btn) return;
        var tab = btn.dataset.tab;
        document.querySelectorAll('.task-tab').forEach(function(t) { t.classList.remove('active'); });
        btn.classList.add('active');
        document.querySelectorAll('.task-tab-content').forEach(function(c) { c.classList.remove('active'); });
        var content = document.getElementById('taskTab' + tab.charAt(0).toUpperCase() + tab.slice(1));
        if (content) content.classList.add('active');
        self.currentTab = tab;
        self.viewStack = [];
        if (tab === 'list') self._requestTaskList();
        if (tab === 'new') self._renderNewTask();
        if (tab === 'monitor') self._renderMonitor();
      });
    },
```

- [ ] **步骤 3: 尾部初始化入口保持不变**

```javascript
  window.TaskPanel = TaskPanel;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(function() { TaskPanel.init(); }, 800); });
  } else {
    setTimeout(function() { TaskPanel.init(); }, 800);
  }
})();
```

---

### 任务 13: 更新文档

**Files:**
- Modify: `docs/spec/remote-task-system.md`
- Modify: `docs/design/remote-task-system.md`
- Modify: `changelog.md`

- [ ] **步骤 1: 更新 spec 文档中的前端部分**

在 `docs/spec/remote-task-system.md` 中更新前端文件列表：

```markdown
| 文件 | 说明 |
|------|------|
| task-panel.js | 任务面板：三标签导航（列表/新建/监控）、编辑、结果查看、设备选择 |
```

- [ ] **步骤 2: 更新 changelog.md**

在 changelog.md 的 Unreleased 区域添加：

```markdown
- ✅ [2026-05-14] 控制端任务面板重新设计：三标签导航、任务列表、设备选择器、编辑、结果查看
  - 分层标签式布局：任务列表 / 新建任务 / 运行监控
  - 任务列表：内置任务/用户任务分组，卡片式展示，搜索筛选
  - 新建任务：按钮式配置选择，设备选择器实时展示在线设备
  - 运行监控：实时日志、进度条、计时器、任务迁移
  - 编辑任务：文件替换/新增/删除，配置修改
  - 查看结果：执行历史列表，输出文件预览/下载，日志查看
  - 改动文件：
    - 重构：src/apps/web-mediacenter/ui/public/js/task-panel.js
    - 重构：src/apps/web-mediacenter/ui/public/css/upload.css (task 部分)
    - 修改：src/apps/server/modules/task-engine/task-io.js
    - 修改：src/apps/server/modules/task-engine/task-manager.js
    - 修改：src/apps/server/modules/task-engine/web-socket-handler.js
    - 新增：docs/superpowers/specs/2026-05-14-task-panel-redesign.md
  - 设计文档：docs/superpowers/specs/2026-05-14-task-panel-redesign.md
  - 实现文档：docs/spec/remote-task-system.md
```

---

## 自审

**1. Spec 覆盖检查：**
- ✅ 任务列表（内置/用户分组、搜索、卡片操作）— 任务 6
- ✅ 新建任务表单（分区块、按钮式选择、文件上传）— 任务 7
- ✅ 设备选择器（在线设备、能力显示、自动选择）— 任务 7
- ✅ 运行监控（活跃/排队/已完成、实时日志、计时器、迁移）— 任务 9
- ✅ 编辑任务（面包屑、文件替换/删除、保存）— 任务 10
- ✅ 查看结果（历史列表、输出预览/下载、日志）— 任务 11
- ✅ 服务端 API（task:list / task:update / task:delete）— 任务 1-3
- ✅ 消息协议扩展 — 任务 3
- ✅ 导航栈管理 — 任务 12

**2. 占位符检查：** 无 TBD/TODO 占位符

**3. 类型一致性检查：**
- `_send()` 在所有消息发送处一致使用
- `instances Map` 的 key 始终为 instanceId
- `taskList` 格式与服务端返回一致
- `displayList` 格式与 `displayList` WS 消息一致
