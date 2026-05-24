(function() {
  'use strict';

  window.SidebarRegistry = {
    _groups: new Map(),
    _tabs: new Map(),
    _items: new Map(),
    _widgetData: {},
    _activeInstances: new Map(),
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

      // 清除之前注入的（支持热刷新）
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

      // 隐藏所有硬编码面板
      document.querySelectorAll('.panel').forEach(function(p) { p.style.display = 'none'; });
      // 隐藏所有动态面板
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
    },

    // ─── WebSocket 流式输出 ───

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
    }
  };
})();
