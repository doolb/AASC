# 侧边栏注册系统实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 SidebarRegistry，让内置任务能注册侧边栏入口，形成组→子页签→任务的动态面板体系

**Architecture:** 后端 `registry.js` 导出 sidebarManifest，`web-socket-handler.js` 在 `task:list` 响应中带上 groups/tabs；前端新建 `sidebar-registry.js` 管理注册和面板渲染，与现有 `main.js`/`task-panel.js`/WebSocket 集成

**Tech Stack:** Node.js / 原生 JS / WebSocket

---

### Task 1: 后端 — registry.js 新增 sidebarManifest

**Files:**
- Modify: `src/apps/server/modules/task-engine/builtin-tasks/registry.js`

- [ ] 修改 registry.js，在现有导出中增加 `sidebarManifest` 字段

```js
const tasks = {
  'image.resize': require('./image-resize'),
  'model.inference': require('./model-inference'),
  'time.announce': require('./time-announce')
};

module.exports = {
  sidebarManifest: {
    groups: [
      { id: 'voiceService', label: '语音服务', icon: '🔊', priority: 50 }
    ],
    tabs: [
      { id: 'announce', group: 'voiceService', label: '播报类', icon: '📢', priority: 10 }
    ]
  },
  getTask(id) { ... },
  listTasks() { ... },
  async run(id, context) { ... }
};
```

- [ ] 验证：`node -e "console.log(require('./registry').sidebarManifest)"` 能正确输出 groups/tabs

---

### Task 2: 后端 — web-socket-handler.js 扩展 task:list 响应

**Files:**
- Modify: `src/apps/server/modules/task-engine/web-socket-handler.js`

- [ ] 在 `getBuiltinTasks()` 同级或内部，提取 `sidebarManifest`

```js
function getSidebarManifest() {
  try {
    const registry = require('./builtin-tasks/registry');
    if (registry.sidebarManifest) return registry.sidebarManifest;
  } catch (e) { /* 忽略 */ }
  return { groups: [], tabs: [] };
}
```

- [ ] 在 `task:list` 响应中增加 `sidebarGroups` 和 `sidebarTabs`

找到 `task:list` case（约第 178-191 行），修改响应 payload：

```js
case 'task:list': {
  console.log('[WS] >> task:list: filter=' + payload.filter);
  try {
    const filter = payload.filter || 'all';
    if (filter === 'builtin') {
      ctx.ws.send(JSON.stringify({ type: 'task:list:result', payload: { tasks: getBuiltinTasks() } }));
    } else {
      const tasks = await taskManager.listTasks();
      const manifest = getSidebarManifest();
      ctx.ws.send(JSON.stringify({
        type: 'task:list:result',
        payload: {
          tasks: [...getBuiltinTasks(), ...tasks],
          sidebarGroups: manifest.groups,
          sidebarTabs: manifest.tabs
        }
      }));
    }
  } catch (err) {
    ctx.ws.send(JSON.stringify({ type: 'task:error', payload: { error: err.message } }));
  }
  break;
}
```

注意：`filter === 'builtin'` 的分支不需要带 sidebar 数据（新建任务表单页签不需要），只在完整列表时返回。

---

### Task 3: 前端 — 创建 sidebar-registry.js

**Files:**
- Create: `src/apps/web-mediacenter/ui/public/js/sidebar-registry.js`

完整文件内容：

```js
(function() {
  'use strict';

  window.SidebarRegistry = {
    _groups: new Map(),
    _tabs: new Map(),
    _items: new Map(),
    _widgetData: {},
    _activeInstances: new Map(),  // taskName → { instanceId, status, ... }
    _lastGroupId: null,

    // ─── 注册 ───

    registerManifest: function(data) {
      (data.sidebarGroups || []).forEach(function(g) { this.registerGroup(g); }.bind(this));
      (data.sidebarTabs || []).forEach(function(t) { this.registerTab(t); }.bind(this));
      (data.tasks || []).forEach(function(task) {
        if (task.sidebar) this.registerTask(task);
      }.bind(this));
      this._syncActiveInstances(data.tasks || []);
      this.build();
    },

    registerGroup: function(def) {
      if (!this._groups.has(def.id)) {
        this._groups.set(def.id, {
          id: def.id,
          label: def.label,
          icon: def.icon,
          priority: def.priority || 99
        });
      }
    },

    registerTab: function(def) {
      this._tabs.set(def.id, {
        id: def.id,
        group: def.group,
        label: def.label,
        icon: def.icon,
        priority: def.priority || 99
      });
    },

    registerTask: function(task) {
      this._items.set(task.taskName, {
        type: 'task',
        group: task.sidebar.group,
        tab: task.sidebar.tab,
        label: task.sidebar.label || task.name,
        icon: task.sidebar.icon || '',
        priority: task.sidebar.priority || 99,
        widget: task.widget || null,
        taskName: task.taskName
      });
    },

    _syncActiveInstances: function(tasks) {
      for (var t = 0; t < tasks.length; t++) {
        var task = tasks[t];
        var instances = task.instances || [];
        for (var i = 0; i < instances.length; i++) {
          var inst = instances[i];
          if (inst.status === 'running') {
            this._activeInstances.set(task.taskName, inst);
          }
        }
      }
    },

    // ─── 侧边栏注入 ───

    build: function() {
      var sidebar = document.querySelector('.sidebar-nav');
      if (!sidebar) return;

      // 清除之前注入的（支持热更新）
      var existing = sidebar.querySelector('.sidebar-registry-divider');
      while (existing && existing.nextElementSibling && existing.nextElementSibling.classList.contains('sidebar-registry-group')) {
        sidebar.removeChild(existing.nextElementSibling);
      }
      if (existing) sidebar.removeChild(existing);

      var sorted = Array.from(this._groups.values()).sort(function(a, b) { return a.priority - b.priority; });
      if (sorted.length === 0) return;

      var taskBtn = sidebar.querySelector('[data-target="task"]');
      if (!taskBtn) return;
      var anchor = taskBtn.parentNode;

      // 分割线
      var divider = document.createElement('div');
      divider.className = 'sidebar-registry-divider';
      anchor.insertBefore(divider, taskBtn.nextSibling);

      // 组按钮
      for (var i = 0; i < sorted.length; i++) {
        (function(group) {
          var btn = document.createElement('button');
          btn.className = 'nav-item sidebar-registry-group';
          btn.dataset.target = 'dynamic-' + group.id;
          btn.title = group.label;
          btn.innerHTML = '<span class="nav-icon">' + group.icon + '</span><span class="nav-text">' + group.label + '</span>';
          btn.addEventListener('click', function() {
            document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
            btn.classList.add('active');
            this.navigate(group.id);
          }.bind(this));
          anchor.insertBefore(btn, divider.nextSibling);
        }.bind(this))(sorted[i]);
      }
    },

    // ─── 面板切换 ───

    navigate: function(groupId) {
      this._lastGroupId = groupId;
      // 隐藏所有面板
      document.querySelectorAll('.panel').forEach(function(p) { p.style.display = 'none'; });
      // 隐藏动态面板
      var allDynamic = document.querySelectorAll('.panel[id^="panel-dynamic-"]');
      allDynamic.forEach(function(p) { p.style.display = 'none'; });

      var panelId = 'panel-dynamic-' + groupId;
      var panel = document.getElementById(panelId);
      if (panel) {
        panel.style.display = 'block';
      } else {
        this.createPanel(groupId);
      }

      try { localStorage.setItem('lastPanel', 'dynamic-' + groupId); } catch (e) {}
    },

    createPanel: function(groupId) {
      var group = this._groups.get(groupId);
      if (!group) return;

      var panel = document.createElement('section');
      panel.className = 'panel';
      panel.id = 'panel-dynamic-' + groupId;
      panel.style.display = 'block';

      // 标题
      var title = document.createElement('h1');
      title.className = 'page-title';
      title.textContent = group.label;
      panel.appendChild(title);

      // 页签栏
      var allTabs = Array.from(this._tabs.values());
      var tabs = allTabs.filter(function(t) { return t.group === groupId; });
      tabs.sort(function(a, b) { return a.priority - b.priority; });

      var activeTab = null;
      if (tabs.length > 1) {
        var tabBar = document.createElement('div');
        tabBar.className = 'sidebar-registry-tab-bar';
        for (var i = 0; i < tabs.length; i++) {
          (function(tab, idx) {
            var btn = document.createElement('button');
            btn.className = 'sidebar-registry-tab' + (idx === 0 ? ' active' : '');
            btn.dataset.tab = tab.id;
            btn.innerHTML = tab.icon + ' ' + tab.label;
            btn.addEventListener('click', function() {
              tabBar.querySelectorAll('.sidebar-registry-tab').forEach(function(b) { b.classList.remove('active'); });
              btn.classList.add('active');
              this._renderTab(groupId, tab.id, panel);
            }.bind(this));
            tabBar.appendChild(btn);
          }.bind(this))(tabs[i], i);
        }
        panel.appendChild(tabBar);
        activeTab = tabs.length > 0 ? tabs[0].id : null;
      } else if (tabs.length === 1) {
        activeTab = tabs[0].id;
      }

      // 内容容器
      var content = document.createElement('div');
      content.className = 'sidebar-registry-content';
      panel.appendChild(content);

      document.querySelector('.content').appendChild(panel);

      this._renderTab(groupId, activeTab, panel);
    },

    _renderTab: function(groupId, tabId, panel) {
      var content = panel.querySelector('.sidebar-registry-content');
      if (!content) return;

      var allItems = Array.from(this._items.values());
      var items = allItems.filter(function(item) {
        if (item.group !== groupId) return false;
        if (tabId && item.tab !== tabId) return false;
        return true;
      });
      items.sort(function(a, b) { return a.priority - b.priority; });

      content.innerHTML = '';

      if (items.length === 0) {
        content.innerHTML = '<div class="empty-list">暂无内容</div>';
        return;
      }

      for (var i = 0; i < items.length; i++) {
        (function(item) {
          var section = document.createElement('div');
          section.className = 'sidebar-registry-item';

          var header = document.createElement('div');
          header.className = 'sidebar-registry-item-header';
          header.textContent = (item.icon || '') + (item.icon ? ' ' : '') + item.label;
          section.appendChild(header);

          if (item.type === 'task' && item.widget) {
            var wc = document.createElement('div');
            wc.className = 'sidebar-registry-widget';
            wc.id = 'sidebar-widget-' + item.taskName;

            var activeInst = this._activeInstances.get(item.taskName);
            var instanceId = activeInst ? activeInst.instanceId : item.taskName;
            var data = this._widgetData[item.taskName] || {};

            if (item.widget.html) {
              wc.innerHTML = this._renderWidgetHTML(item.widget.html, instanceId, data);
            }
            section.appendChild(wc);
          }

          content.appendChild(section);
        }.bind(this))(items[i]);
      }
    },

    // ─── Widget 渲染 ───

    _renderWidgetHTML: function(html, instanceId, data) {
      var result = html;
      result = result.replace(/\{\{instanceId\}\}/g, instanceId);
      result = result.replace(/\{\{(\w+)\}\}/g, function(match, key) {
        var val = data[key] !== undefined ? data[key] : '--';
        return typeof val === 'string' ? val : JSON.stringify(val);
      });
      return result;
    },

    // ─── WebSocket widget 更新 ───

    onWidgetUpdate: function(payload) {
      var taskName = payload.taskName;
      if (!taskName) return;
      this._widgetData[taskName] = payload.data;

      var widgetEl = document.getElementById('sidebar-widget-' + taskName);
      if (!widgetEl) return;

      var item = this._items.get(taskName);
      if (!item || !item.widget || !item.widget.html) return;

      var activeInst = this._activeInstances.get(taskName);
      var instanceId = activeInst ? activeInst.instanceId : taskName;

      widgetEl.innerHTML = this._renderWidgetHTML(item.widget.html, instanceId, payload.data);
    }
  };
})();
```

---

### Task 4: 前端 — main.js 集成 SidebarRegistry

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/main.js`

- [ ] `App.init()` 中在 WebSocketManager 连接后初始化 SidebarRegistry

现有 `App.init()` 的 WebSocket 连接后没有回调。需要在 WebSocket 收到 `task:list:result` 后触发注册。但实际上 SidebarRegistry 的注册入口在 TaskPanel._handleTaskList 中（见 Task 5），main.js 只需要：

```js
const App = {
  // ...

  init() {
    Sidebar.init();

    // ... 其他初始化 ...

    // SidebarRegistry 由 task:list:result 触发的 TaskPanel._handleTaskList 初始化
    // 这里只做 build 安全重入
  }
};
```

- [ ] 扩展 `Sidebar.switchPanel()` 支持动态组

```js
const Sidebar = {
  switchPanel: function(targetId) {
    // 动态组面板：委托给 SidebarRegistry
    if (targetId && targetId.indexOf('dynamic-') === 0) {
      var groupId = targetId.replace('dynamic-', '');
      window.SidebarRegistry.navigate(groupId);
      return;
    }

    var panels = document.querySelectorAll('.panel');
    panels.forEach(function(panel) {
      // 只控制硬编码面板，不碰动态面板
      if (panel.id.indexOf('panel-dynamic-') === 0) return;
      panel.style.display = panel.id === 'panel-' + targetId ? 'block' : 'none';
    });

    // ... 其余逻辑不变 ...
  },

  loadLastPanel: function() {
    var lastPanel = 'media';
    try { lastPanel = localStorage.getItem('lastPanel') || 'media'; } catch (e) {}

    // 动态组面板
    if (lastPanel && lastPanel.indexOf('dynamic-') === 0) {
      var groupId = lastPanel.replace('dynamic-', '');
      var btn = document.querySelector('[data-target="dynamic-' + groupId + '"]');
      if (btn) {
        document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
        btn.classList.add('active');
      }
      if (window.SidebarRegistry && window.SidebarRegistry._groups.has(groupId)) {
        window.SidebarRegistry.navigate(groupId);
      } else {
        // 组尚未注册，存为待恢复状态
        this._pendingDynamicPanel = groupId;
      }
      return;
    }

    // 原有逻辑不变
    this.switchPanel(lastPanel);
    var activeItem = document.querySelector('[data-target="' + lastPanel + '"]');
    if (activeItem) {
      document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
      activeItem.classList.add('active');
    }
  }
};
```

---

### Task 5: 前端 — task-panel.js 注册 sidebar 任务

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/task-panel.js`

- [ ] 在 `_handleTaskList` 末尾调用 `SidebarRegistry.registerManifest`

```js
_handleTaskList: function(tasks) {
  // ... 现有合并和实例同步逻辑不变 ...

  // 同步 sidebar 任务注册
  if (window.SidebarRegistry) {
    // data 对象包含 tasks 和可选的 sidebarGroups/sidebarTabs
    // 但 task:list:result 的 payload 目前只传 tasks
    // SidebarRegistry 的内部方法会从 tasks 中提取有 sidebar 字段的进行注册
    // 同时需要在 WS handler 中额外传递 sidebarGroups/sidebarTabs
    // 目前先通过 manifest 方式触发注册
    window.SidebarRegistry._syncActiveInstances(tasks);
    
    // 提取有 sidebar 的任务进行注册
    for (var t = 0; t < tasks.length; t++) {
      var task = tasks[t];
      if (task.sidebar) {
        window.SidebarRegistry.registerTask(task);
      }
    }
    window.SidebarRegistry.build();
  }

  if (this.currentTab === 'list') this._renderTaskList();
}
```

注意：这段代码放在 `_handleTaskList` 末尾。WS handler 返回的 payload 中包含 `sidebarGroups`、`sidebarTabs`（Task 2 加的）。`_handleTaskList` 当前只有一个参数 `tasks`（数组），需要改为接收完整 payload 对象。

- [ ] 修改 `_handleTaskList` 签名，接收完整 payload

在 WebSocket handler 调用处（约第 1033 行）：

```js
if (data.type === 'task:list:result') {
  self._handleTaskList(data.payload);
}
```

修改 `_handleTaskList`：

```js
_handleTaskList: function(payload) {
  var tasks = payload.tasks || payload || [];
  // ... 现有合并逻辑 ...

  // 同步 sidebar
  if (window.SidebarRegistry) {
    window.SidebarRegistry.registerManifest({
      sidebarGroups: payload.sidebarGroups || [],
      sidebarTabs: payload.sidebarTabs || [],
      tasks: tasks
    });
  }

  if (this.currentTab === 'list') this._renderTaskList();
}
```

因为 `_handleTaskList` 原来的调用处既有传数组也有传 payload 对象，需要向后兼容：

```js
_handleTaskList: function(payload) {
  // 向后兼容：如果是数组直接当 tasks
  var tasks = Array.isArray(payload) ? payload : (payload.tasks || []);
  // ... 现有逻辑 ...
  if (window.SidebarRegistry) {
    window.SidebarRegistry.registerManifest({
      sidebarGroups: payload.sidebarGroups || [],
      sidebarTabs: payload.sidebarTabs || [],
      tasks: tasks
    });
  }
  // ...
}
```

---

### Task 6: 前端 — upload.html 添加脚本引用和动态面板容器

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/upload.html`

- [ ] 在 `task-panel.js` 之后添加 `sidebar-registry.js` 引用

```html
<script src="js/task-panel.js"></script>
<script src="js/sidebar-registry.js"></script>
<script>
    const Settings = {
```

---

### Task 7: 前端 — WebSocket widget_update 分流到 SidebarRegistry

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/task-panel.js`

- [ ] 在 `_setupWS` 的 `task:widget_update` 处理中，同时通知 SidebarRegistry

```js
if (data.type === 'task:widget_update') {
  self._onWidgetUpdate(data.payload);
  if (window.SidebarRegistry) {
    window.SidebarRegistry.onWidgetUpdate(data.payload);
  }
}
```

---

### Task 8: 前端 — upload.css 动态面板样式

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/css/upload.css`

- [ ] 追加动态面板相关样式

```css
/* ─── SidebarRegistry 动态面板 ─── */

.sidebar-registry-divider {
  height: 1px;
  background: rgba(255,255,255,0.1);
  margin: 8px 12px;
}

.sidebar-registry-group {
  /* 复用 .nav-item 样式 */
}

.sidebar-registry-tab-bar {
  display: flex;
  gap: 4px;
  padding: 0 0 12px 0;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.sidebar-registry-tab {
  padding: 6px 14px;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 6px;
  background: rgba(255,255,255,0.04);
  color: rgba(255,255,255,0.6);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.sidebar-registry-tab:hover {
  background: rgba(255,255,255,0.08);
  color: #fff;
}

.sidebar-registry-tab.active {
  background: rgba(79, 156, 247, 0.15);
  border-color: #4f9cf7;
  color: #4f9cf7;
}

.sidebar-registry-item {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  padding: 14px;
  margin-bottom: 12px;
}

.sidebar-registry-item-header {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255,255,255,0.9);
  margin-bottom: 10px;
}

.sidebar-registry-widget {
  /* 复用现有 widget 内联样式 */
}
```

---

### Task 9: 验证 — 端到端检查

- [ ] 重启服务器
- [ ] 打开控制端页面，检查侧边栏底部是否有"🔊 语音服务"
- [ ] 点击"🔊 语音服务"，应显示动态面板
- [ ] 面板内应有"📢 播报类"页签，下方显示"🔔 整点报时" widget
- [ ] 检查 widget 实时更新（等 30 秒或修改配置触发推送）
- [ ] 刷新页面，检查 lastPanel 恢复是否正确（如果是动态面板应能回到同一面板）
- [ ] ⚡ 任务面板不受影响
- [ ] 其他硬编码面板不受影响

---

### 完整文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/apps/server/modules/task-engine/builtin-tasks/registry.js` | 修改 | 新增 sidebarManifest 导出 |
| `src/apps/server/modules/task-engine/web-socket-handler.js` | 修改 | task:list 响应增加 sidebarGroups/sidebarTabs |
| `src/apps/web-mediacenter/ui/public/js/sidebar-registry.js` | 新建 | SidebarRegistry 完整实现 |
| `src/apps/web-mediacenter/ui/public/js/main.js` | 修改 | switchPanel 支持动态组、lastPanel 恢复 |
| `src/apps/web-mediacenter/ui/public/js/task-panel.js` | 修改 | _handleTaskList 注册 sidebar、widget_update 分流 |
| `src/apps/web-mediacenter/ui/public/upload.html` | 修改 | 添加 sidebar-registry.js 引用 |
| `src/apps/web-mediacenter/ui/public/css/upload.css` | 修改 | 动态面板样式 |
