(function() {
  'use strict';

  var TaskPanel = {
    instances: new Map(),
    displayList: [],
    taskList: [],
    currentTab: 'list',
    viewStack: [],
    timers: {},
    _timerInterval: null,
    _initDone: false,

    init: function() {
      if (this._initDone) return;
      this._initDone = true;
      this._render();
      this._setupWS();
      this._bindTabs();
      this._requestTaskList();
    },

    _send: function(msg) {
      var ws = window.WebSocketManager;
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        ws.ws.send(JSON.stringify(msg));
      }
    },

    _render: function() {
      var panel = document.getElementById('panel-task');
      if (!panel) return;
      panel.innerHTML =
        '<div class="task-tabs" id="taskTabs">' +
          '<button class="task-tab active" data-tab="list">任务列表</button>' +
          '<button class="task-tab" data-tab="new">新建任务</button>' +
          '<button class="task-tab" data-tab="monitor">运行中<span class="badge" id="taskMonitorBadge"></span></button>' +
        '</div>' +
        '<div id="taskTabList" class="task-tab-content active"></div>' +
        '<div id="taskTabNew" class="task-tab-content"></div>' +
        '<div id="taskTabMonitor" class="task-tab-content"></div>';
    },

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

      if (builtin.length > 0) {
        html += '<div class="task-group-title">内置任务（只读）</div>';
        html += builtin.map(function(t) { return this._taskCardHTML(t); }, this).join('');
      }

      html += '<div class="task-group-title">用户任务</div>';
      if (user.length === 0) {
        html += '<div class="task-empty-state">' +
          '<div class="task-empty-state-icon">⚡</div>' +
          '<div class="task-empty-state-text">还没有用户任务，切换到新建任务标签创建一个</div>' +
        '</div>';
      } else {
        html += user.map(function(t) { return this._taskCardHTML(t); }, this).join('');
      }

      container.innerHTML = html;
    },

    _taskCardHTML: function(task) {
      var icon = '📄';
      var statusClass = '';
      var statusText = '就绪';
      var progressHtml = '';
      var hasLatest = false;
      var latestTime = '';
      var latestProgress = null;

      if (task.instances && task.instances.length > 0) {
        var latest = task.instances[0];
        hasLatest = true;
        if (latest.status === 'running') { icon = '🔄'; statusClass = 'running'; statusText = '运行中'; }
        else if (latest.status === 'completed') { icon = '✅'; statusClass = 'completed'; statusText = '已完成'; }
        else if (latest.status === 'failed') { icon = '❌'; statusClass = 'failed'; statusText = '失败'; }
        else if (latest.status === 'stopped') { icon = '⏹'; statusClass = 'stopped'; statusText = '已停止'; }
        else if (latest.status === 'pending' || latest.status === 'pending_forward') { icon = '⏳'; statusClass = 'pending'; statusText = '排队中'; }
        latestProgress = (latest.progress != null && latest.status === 'running') ? latest.progress : null;
        if (latest.timestamp) latestTime = this._formatTime(latest.timestamp);
      }

      var isBuiltin = task.taskType === 'builtin';
      var cardClass = 'task-card' + (isBuiltin ? ' builtin' : '') + (statusClass ? ' ' + statusClass : '');

      if (latestProgress != null) {
        progressHtml = '<div class="task-card-progress"><div class="task-card-progress-fill" style="width:' + latestProgress + '%"></div></div>';
      }

      var metaHtml = '';
      if (task.files && task.files.length > 0) {
        metaHtml += '<span>' + task.files.length + ' 个文件</span>';
      }
      if (!isBuiltin && latestTime) {
        metaHtml += '<span>' + latestTime + '</span>';
      }

      var safeTaskName = this._escapeAttr(task.taskName);
      var actionsHtml = '';
      if (isBuiltin) {
        actionsHtml += '<button class="task-card-btn primary" onclick="TaskPanel._runBuiltin(\'' + safeTaskName + '\')">运行</button>';
        actionsHtml += '<button class="task-card-btn" onclick="TaskPanel._viewBuiltinParams(\'' + safeTaskName + '\')">参数</button>';
      } else {
        actionsHtml += '<button class="task-card-btn" onclick="TaskPanel._viewEdit(\'' + safeTaskName + '\')">编辑</button>';
        if (task.instances && task.instances.length > 0) {
          actionsHtml += '<button class="task-card-btn" onclick="TaskPanel._viewResults(\'' + safeTaskName + '\')">结果</button>';
        }
        actionsHtml += '<button class="task-card-btn danger" onclick="TaskPanel._confirmDelete(\'' + safeTaskName + '\')">删除</button>';
      }

      return '<div class="' + cardClass + '">' +
        '<div class="task-card-header">' +
          '<div class="task-card-title"><span class="task-card-icon">' + icon + '</span>' + this._escapeHtml(task.name || task.taskName) + '</div>' +
          '<span class="task-card-status ' + statusClass + '">' + statusText + '</span>' +
        '</div>' +
        '<div class="task-card-meta">' + metaHtml + '</div>' +
        progressHtml +
        '<div class="task-card-actions">' + actionsHtml + '</div>' +
      '</div>';
    },

    _filterTasks: function() {
      var q = document.getElementById('taskSearch');
      if (!q) return;
      var query = q.value.toLowerCase();
      var cards = document.querySelectorAll('#taskTabList .task-card');
      cards.forEach(function(c) {
        var nameEl = c.querySelector('.task-card-title');
        if (!nameEl) return;
        var name = nameEl.textContent.toLowerCase();
        c.style.display = name.indexOf(query) >= 0 ? '' : 'none';
      });
    },

    _formatTime: function(ts) {
      var d = new Date(ts);
      return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    },

    // ---- New Task Form ----

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
          '<div class="task-device-list" id="deviceSelectorList"></div>' +
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

        '<button class="task-submit-btn" id="taskSubmitBtn">提交任务</button>';

      this._bindFormEvents();
      this._renderDeviceSelector();
    },

    _bindFormEvents: function() {
      var self = this;

      var typeSelect = document.getElementById('taskTypeSelect');
      if (typeSelect) {
        typeSelect.addEventListener('change', function(e) {
          var isBuiltin = e.target.value === 'builtin';
          var ef = document.getElementById('entryFileField');
          var uf = document.getElementById('userFilesSection');
          var bs = document.getElementById('builtinSection');
          if (ef) ef.style.display = isBuiltin ? 'none' : 'block';
          if (uf) uf.style.display = isBuiltin ? 'none' : 'block';
          if (bs) bs.style.display = isBuiltin ? 'block' : 'none';
          if (isBuiltin) self._loadBuiltinTasks();
        });
      }

      document.querySelectorAll('.task-btn-group').forEach(function(group) {
        group.addEventListener('click', function(e) {
          var btn = e.target.closest('.task-btn-option');
          if (!btn) return;
          group.querySelectorAll('.task-btn-option').forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
          if (group.id === 'targetGroup') {
            var showDevice = btn.dataset.value === 'display' || btn.dataset.value === 'subdisplay';
            var ds = document.getElementById('deviceSelectorSection');
            if (ds) ds.style.display = showDevice ? 'block' : 'none';
          }
        });
      });

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

      var submitBtn = document.getElementById('taskSubmitBtn');
      if (submitBtn) submitBtn.addEventListener('click', function() { self._submit(); });
    },

    _updateFileList: function() {
      var fileInput = document.getElementById('taskFiles');
      var list = document.getElementById('taskFileList');
      if (!fileInput || !list) return;
      list.innerHTML = '';
      for (var i = 0; i < fileInput.files.length; i++) {
        var f = fileInput.files[i];
        var chip = document.createElement('span');
        chip.className = 'task-file-chip';
        chip.innerHTML = '📄 ' + f.name + ' <span style="color:#666">(' + (f.size / 1024).toFixed(1) + 'KB)</span>';
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
        var isOnline = true;
        var caps = d.capabilities || {};
        var capText = [];
        if (caps.webgpu) capText.push('WebGPU');
        else if (caps.webgl) capText.push('WebGL');
        if (caps.cpu || capText.length === 0) capText.push('CPU');
        var safeId = this._escapeAttr(d.id);
        html += '<div class="task-device-item" data-id="' + safeId + '">' +
          '<div class="task-device-radio"></div>' +
          '<div class="task-device-info">' +
            '<div class="task-device-name">' + this._escapeHtml(d.id) + '</div>' +
            '<div class="task-device-cap">' + this._escapeHtml(capText.join(', ')) + '</div>' +
          '</div>' +
          '<span class="task-device-state ' + (isOnline ? 'online' : 'offline') + '">' + (isOnline ? '在线' : '离线') + '</span>' +
        '</div>';
      }
      list.innerHTML = html;

      list.addEventListener('click', function(e) {
        var item = e.target.closest('.task-device-item');
        if (!item) return;
        list.querySelectorAll('.task-device-item').forEach(function(el) { el.classList.remove('selected'); });
        item.classList.add('selected');
      });
    },

    _loadBuiltinTasks: function() {
      var sel = document.getElementById('builtinId');
      if (!sel) return;
      var builtin = this.taskList.filter(function(t) { return t.taskType === 'builtin'; });
      sel.innerHTML = builtin.map(function(t) {
        return '<option value="' + this._escapeAttr(t.taskName) + '">' + this._escapeHtml(t.name || t.taskName) + '</option>';
      }, this).join('');
      if (builtin.length === 0) {
        sel.innerHTML = '<option value="">暂无内置任务</option>';
      }
    },

    // ---- Submit ----

    _submit: function() {
      var self = this;
      var taskName = document.getElementById('taskName');
      if (!taskName || !taskName.value.trim()) { alert('请输入任务名称'); return; }
      var name = taskName.value.trim();

      var fileInput = document.getElementById('taskFiles');
      var pending = fileInput ? fileInput.files.length : 0;
      var files = [];

      if (pending === 0) {
        this._doSubmit(name, files);
        return;
      }

      for (var i = 0; i < fileInput.files.length; i++) {
        (function(file) {
          var reader = new FileReader();
          reader.onload = function() {
            files.push({ name: file.name, data: reader.result.split(',')[1] });
            pending--;
            if (pending === 0) self._doSubmit(name, files);
          };
          reader.readAsDataURL(file);
        })(fileInput.files[i]);
      }
    },

    _doSubmit: function(taskName, files) {
      var params = {};
      try {
        var t = document.getElementById('taskParams');
        if (t && t.value) params = JSON.parse(t.value);
      } catch(e) { alert('参数 JSON 格式错误'); return; }

      var targetEl = document.querySelector('#targetGroup .task-btn-option.active');
      var envEl = document.querySelector('#envGroup .task-btn-option.active');
      var modeEl = document.querySelector('#modeGroup .task-btn-option.active');
      var typeEl = document.getElementById('taskTypeSelect');
      var deviceEl = document.querySelector('#deviceSelectorList .task-device-item.selected');
      var displayId = deviceEl && deviceEl.dataset.id ? deviceEl.dataset.id : null;
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
      var monitorTab = document.querySelector('[data-tab="monitor"]');
      if (monitorTab) monitorTab.click();
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
      var monitorTab = document.querySelector('[data-tab="monitor"]');
      if (monitorTab) monitorTab.click();
    },

    _viewBuiltinParams: function(taskName) {
      var tab = document.querySelector('[data-tab="new"]');
      if (tab) tab.click();
      var typeSel = document.getElementById('taskTypeSelect');
      if (typeSel) { typeSel.value = 'builtin'; typeSel.dispatchEvent(new Event('change')); }
      var builtinSel = document.getElementById('builtinId');
      if (builtinSel) { builtinSel.value = taskName; builtinSel.dispatchEvent(new Event('change')); }
    },

    // ---- WebSocket ----

    _setupWS: function() {
      var self = this;
      var ws = window.WebSocketManager;
      if (!ws) { setTimeout(function() { self._setupWS(); }, 500); return; }
      if (ws._taskPanelHooked) return;
      ws._taskPanelHooked = true;
      var orig = ws.handleMessage;
      ws.handleMessage = function(data) {
        if (data.type === 'displayList') {
          self.displayList = data.list || [];
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
      self._send({ type: 'displayList' });
      // 延迟重试任务列表请求，确保连接已建立
      setTimeout(function() { self._requestTaskList(); }, 500);
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
        inst.stage = payload.stage || inst.stage;
        inst.progress = payload.progress != null ? payload.progress : inst.progress;
        if (payload.target) inst.target = payload.target;
        if (this.currentTab === 'monitor') this._renderMonitor();
      }
    },

    _onLog: function(payload) {
      var inst = this.instances.get(payload.instanceId);
      if (!inst) {
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

    // ---- Monitor ----

    _renderMonitor: function() {
      var container = document.getElementById('taskTabMonitor');
      if (!container) return;

      var active = [];
      var done = [];

      this.instances.forEach(function(inst) {
        if (inst.status === 'running' || inst.status === 'pending' || inst.status === 'pending_forward') {
          active.push(inst);
        } else {
          done.push(inst);
        }
      });

      active.sort(function(a, b) { return b.timestamp - a.timestamp; });
      done.sort(function(a, b) { return (b.completedAt || b.timestamp) - (a.completedAt || a.timestamp); });

      var html = '';

      if (active.length > 0) {
        html += '<div class="task-monitor-section"><div class="task-monitor-section-title">活跃任务</div>';
        html += active.map(function(inst) { return this._monitorActiveCard(inst); }, this).join('');
        html += '</div>';
      }

      if (done.length > 0) {
        html += '<div class="task-monitor-section" style="margin-top:16px"><div class="task-monitor-section-title">最近完成</div>';
        html += done.slice(0, 10).map(function(inst) { return this._monitorDoneCard(inst); }, this).join('');
        html += '</div>';
      }

      if (active.length === 0 && done.length === 0) {
        html += '<div class="task-empty-state">' +
          '<div class="task-empty-state-icon">⚡</div>' +
          '<div class="task-empty-state-text">暂无任务实例</div>' +
        '</div>';
      }

      container.innerHTML = html;
      this._startTimers();
    },

    _monitorActiveCard: function(inst) {
      var logs = inst.logs || [];
      var recentLogs = logs.slice(-20);
      var logHtml = recentLogs.map(function(l) {
        var time = l.time ? new Date(l.time) : new Date();
        var ts = ('0' + time.getHours()).slice(-2) + ':' + ('0' + time.getMinutes()).slice(-2) + ':' + ('0' + time.getSeconds()).slice(-2);
        var cls = l.stream === 'stderr' ? 'task-monitor-log-stderr' : l.stream === 'system' ? 'task-monitor-log-system' : 'task-monitor-log-stdout';
        return '<div class="task-monitor-log-line ' + cls + '"><span class="task-monitor-log-time">' + ts + '</span> ' + this._escapeHtml(l.message) + '</div>';
      }, this).join('');

      var duration = '';
      if (inst.timestamp) {
        var elapsed = Math.floor((Date.now() - inst.timestamp) / 1000);
        var m = Math.floor(elapsed / 60);
        var s = elapsed % 60;
        duration = ('0' + m).slice(-2) + ':' + ('0' + s).slice(-2);
      }

      var progressBar = (inst.progress != null && inst.status === 'running')
        ? '<div class="task-monitor-progress"><div class="task-monitor-progress-fill" style="width:' + inst.progress + '%"></div></div>'
        : '';

      var safeId = this._escapeAttr(inst.instanceId);
      return '<div class="task-monitor-card" data-instance="' + safeId + '">' +
        '<div class="task-monitor-header">' +
          '<span class="task-monitor-name">' + this._escapeHtml(inst.taskName || '-') + '</span>' +
          '<span class="task-monitor-timer">' + (inst.status === 'pending' ? '排队中' : duration) + '</span>' +
        '</div>' +
        '<div class="task-monitor-stage">阶段: ' + this._escapeHtml(inst.stage || inst.status) + '</div>' +
        '<div class="task-monitor-target">执行于: ' + this._escapeHtml(inst.target || '服务端') + ' | ' + this._escapeHtml(inst.instanceId ? inst.instanceId.substring(0, 8) : '-') + '</div>' +
        progressBar +
        '<div class="task-monitor-log">' +
          '<div class="task-monitor-log-header" onclick="this.nextElementSibling.classList.toggle(\'collapsed\')">实时日志 (' + logs.length + ' 行)</div>' +
          '<div class="task-monitor-log-content">' + (logHtml || '<div style="color:#555">等待日志...</div>') + '</div>' +
        '</div>' +
        '<div class="task-monitor-actions">' +
          (inst.status === 'running' ? '<button class="task-card-btn danger" onclick="TaskPanel._stopInstance(\'' + safeId + '\')">停止</button>' : '') +
          (inst.status === 'running' ? '<button class="task-card-btn" onclick="TaskPanel._migrateInstance(\'' + safeId + '\')">迁移到...</button>' : '') +
        '</div>' +
      '</div>';
    },

    _monitorDoneCard: function(inst) {
      var icon = inst.status === 'completed' ? '✅' : inst.status === 'failed' ? '❌' : '⏹';
      var label = inst.status === 'completed' ? '已完成' : inst.status === 'failed' ? '失败' : '已停止';
      var safeName = this._escapeHtml(inst.taskName || '-');
      var safeId = this._escapeAttr(inst.instanceId);
      return '<div class="task-done-card">' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<span>' + icon + '</span>' +
          '<span style="font-size:13px;color:#aaa">' + safeName + '</span>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<span style="font-size:11px;color:#666">' + label + '</span>' +
          '<button class="task-card-btn" onclick="TaskPanel._viewInstanceResults(\'' + safeId + '\')">查看结果</button>' +
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
      var self = this;
      this._showDevicePicker(function(deviceId) {
        self._send({ type: 'task:stop', payload: { taskName: inst.taskName, instanceId: instanceId } });
        self._send({ type: 'task:submit', payload: {
          taskName: inst.taskName,
          taskType: 'user',
          target: deviceId ? 'display' : 'server',
          displayId: deviceId || null,
          mode: inst.mode || 'one-shot',
          env: inst.env || 'auto',
          params: {},
          files: []
        }});
      });
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
        var safeId = this._escapeAttr(d.id);
        listHtml += '<div class="task-device-item" data-id="' + safeId + '">' +
          '<div class="task-device-radio"></div>' +
          '<div class="task-device-info"><div class="task-device-name">' + this._escapeHtml(d.id) + '</div></div>' +
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

      document.getElementById('pickerCancel').onclick = function() { document.body.removeChild(overlay); };
      document.getElementById('pickerConfirm').onclick = function() {
        var selected = overlay.querySelector('.task-device-item.selected');
        var id = selected ? selected.dataset.id : '';
        document.body.removeChild(overlay);
        callback(id);
      };
    },

    // ---- Edit ----

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

      var safeTaskName = this._escapeAttr(task.taskName);
      var filesHtml = (task.files || []).map(function(f) {
        var safeName = this._escapeAttr(f.name);
        return '<div class="task-edit-file-row">' +
          '<div class="task-edit-file-info">📄 ' + this._escapeHtml(f.name) + ' <span style="color:#666;font-size:11px">(' + (f.size / 1024).toFixed(1) + 'KB)</span></div>' +
          '<div class="task-edit-file-actions">' +
            '<button class="task-card-btn" onclick="TaskPanel._replaceFile(\'' + safeTaskName + '\',\'' + safeName + '\')">替换</button>' +
            '<button class="task-card-btn danger" onclick="TaskPanel._deleteFile(\'' + safeTaskName + '\',\'' + safeName + '\')">删除</button>' +
          '</div>' +
        '</div>';
      }, this).join('');

      container.innerHTML =
        '<div class="task-breadcrumb">' +
          '<a onclick="TaskPanel._showView(\'list\')">任务列表</a>' +
          '<span>></span>' +
          '<span class="current">编辑 ' + this._escapeHtml(task.taskName) + '</span>' +
        '</div>' +

        '<div class="task-form-section">' +
          '<div class="task-form-section-title">基本信息</div>' +
          '<div class="task-form-row">' +
            '<div class="task-form-field">' +
              '<label>任务名称</label>' +
              '<input type="text" id="editTaskName" value="' + safeTaskName + '">' +
            '</div>' +
            '<div class="task-form-field">' +
              '<label>入口文件</label>' +
              '<input type="text" id="editEntryFile" value="' + this._escapeAttr(task.entryFile || 'task.js') + '">' +
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

        '<button class="task-submit-btn" onclick="TaskPanel._saveEdit(\'' + safeTaskName + '\')" style="background:linear-gradient(135deg,#22c55e,#16a34a)">保存修改</button>';

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
      var input = document.getElementById('editFiles');
      var list = document.getElementById('editFileList');
      if (!input || !list) return;
      list.innerHTML = '';
      for (var i = 0; i < input.files.length; i++) {
        var f = input.files[i];
        var chip = document.createElement('span');
        chip.className = 'task-file-chip';
        chip.innerHTML = '📄 ' + f.name + ' <span style="color:#666">(' + (f.size / 1024).toFixed(1) + 'KB)</span> <span class="remove" onclick="this.parentElement.remove()">✕</span>';
        list.appendChild(chip);
      }
    },

    _saveEdit: function(taskName) {
      var fileInput = document.getElementById('editFiles');
      var pending = fileInput ? fileInput.files.length : 0;
      var files = [];
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
        var t = document.getElementById('editParams');
        if (t && t.value) params = JSON.parse(t.value);
      } catch(e) { /* ignore */ }
      this._send({ type: 'task:update', payload: { taskName: taskName, files: files, params: params } });
    },

    _confirmDelete: function(taskName) {
      var overlay = document.createElement('div');
      overlay.className = 'task-confirm-overlay';
      overlay.innerHTML =
        '<div class="task-confirm-box">' +
          '<div class="task-confirm-title">确认删除</div>' +
          '<div class="task-confirm-msg">确定要删除任务 "' + this._escapeHtml(taskName) + '" 吗？<br>所有文件和执行记录将被永久删除。</div>' +
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
          '<div class="task-confirm-msg">确定要删除文件 "' + this._escapeHtml(fileName) + '" 吗？</div>' +
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

    // ---- Results ----

    _viewResults: function(taskName) {
      this.viewStack = ['list'];
      this._showResultsView(taskName, null);
    },

    _viewInstanceResults: function(instanceId) {
      var inst = this.instances.get(instanceId);
      if (!inst) return;
      this.viewStack = ['monitor'];
      var listTab = document.querySelector('[data-tab="list"]');
      if (listTab) listTab.click();
      this._showResultsView(inst.taskName, instanceId);
    },

    _showResultsView: function(taskName, selectedInstanceId) {
      var task = null;
      for (var i = 0; i < this.taskList.length; i++) {
        if (this.taskList[i].taskName === taskName) { task = this.taskList[i]; break; }
      }
      if (!task) return;

      var instances = task.instances || [];
      instances.forEach(function(inst) {
        var memInst = this.instances.get(inst.instanceId);
        if (memInst) {
          inst.status = memInst.status;
          inst.stage = memInst.stage;
          inst.result = memInst.result;
          inst.logs = memInst.logs;
          inst.completedAt = memInst.completedAt;
        }
      }, this);

      var selected = selectedInstanceId
        ? instances.filter(function(i) { return i.instanceId === selectedInstanceId; })[0]
        : instances[0];

      var container = document.getElementById('taskTabList');
      if (!container) return;

      var safeTaskName = this._escapeAttr(taskName);
      var historyHtml = instances.map(function(inst) {
        var icon = inst.status === 'completed' ? '✅' : inst.status === 'failed' ? '❌' : inst.status === 'stopped' ? '⏹' : '⏳';
        var sel = selected && inst.instanceId === selected.instanceId ? ' selected' : '';
        var time = inst.timestamp ? this._formatTime(inst.timestamp) : '';
        return '<div class="task-result-history-item' + sel + '" onclick="TaskPanel._selectResult(\'' + safeTaskName + '\',\'' + this._escapeAttr(inst.instanceId) + '\')">' +
          '<span class="result-icon">' + icon + '</span> ' + time +
        '</div>';
      }, this).join('');

      var detailHtml = selected ? this._resultDetailHTML(selected) : '<div class="task-empty-state"><div class="task-empty-state-text">暂无执行记录</div></div>';

      container.innerHTML =
        '<div class="task-breadcrumb">' +
          '<a onclick="TaskPanel._showView(\'list\')">任务列表</a>' +
          '<span>></span>' +
          '<span class="current">' + this._escapeHtml(taskName) + ' 执行结果</span>' +
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
      var statusText = inst.status === 'completed' ? '完成' : inst.status === 'failed' ? '失败' : inst.status === 'stopped' ? '已停止' : '进行中';

      var result = inst.result || {};
      var outputFiles = result.outputFiles || (result.data ? result.data.outputFiles : []) || [];
      var filesHtml = '';
      if (outputFiles.length > 0) {
        filesHtml = outputFiles.map(function(f) {
          var url = f.url || '';
          var safeUrl = this._escapeAttr(url);
          var isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(f.name || '');
          return '<div class="task-result-file">' +
            '<div class="task-result-file-name">📄 ' + this._escapeHtml(f.name || '') + '</div>' +
            '<div class="task-result-file-actions">' +
              (isImage && url ? '<button class="task-card-btn" onclick="TaskPanel._previewImage(\'' + safeUrl + '\')">预览</button>' : '') +
              (url ? '<button class="task-card-btn" onclick="TaskPanel._downloadFile(\'' + safeUrl + '\')">下载</button>' : '') +
            '</div>' +
          '</div>';
        }, this).join('');
      }

      var logs = inst.logs || [];
      var logHtml = logs.slice(-40).map(function(l) {
        var time = l.time ? new Date(l.time) : new Date();
        var ts = ('0' + time.getHours()).slice(-2) + ':' + ('0' + time.getMinutes()).slice(-2) + ':' + ('0' + time.getSeconds()).slice(-2);
        var cls = l.stream === 'stderr' ? 'task-monitor-log-stderr' : l.stream === 'system' ? 'task-monitor-log-system' : 'task-monitor-log-stdout';
        return '<div class="task-monitor-log-line ' + cls + '"><span class="task-monitor-log-time">' + ts + '</span> ' + this._escapeHtml(l.message) + '</div>';
      }, this).join('');

      var duration = (inst.completedAt && inst.timestamp)
        ? Math.round((inst.completedAt - inst.timestamp) / 1000) + 's'
        : '-';

      return '<div class="task-result-meta">' +
        '<div class="task-result-meta-item">状态: <strong>' + statusText + '</strong></div>' +
        '<div class="task-result-meta-item">耗时: <strong>' + duration + '</strong></div>' +
        '<div class="task-result-meta-item">实例: <strong style="font-family:monospace">#' + this._escapeHtml(inst.instanceId ? inst.instanceId.substring(0, 8) : '-') + '</strong></div>' +
        '<div class="task-result-meta-item">环境: <strong>' + this._escapeHtml(inst.env || '-') + '</strong></div>' +
      '</div>' +
      (result.error ? '<div style="color:#ef4444;font-size:13px;margin-bottom:12px">错误: ' + this._escapeHtml(result.error) + '</div>' : '') +
      (filesHtml ? '<div class="task-result-files"><div style="font-size:11px;color:#666;margin-bottom:4px">输出文件</div>' + filesHtml + '</div>' : '') +
      '<div class="task-result-log">' +
        '<div class="task-result-log-header" onclick="this.nextElementSibling.classList.toggle(\'collapsed\')">完整日志 (' + logs.length + ' 行)</div>' +
        '<div class="task-result-log-content">' + (logHtml || '<span style="color:#555">无日志</span>') + '</div>' +
      '</div>';
    },

    _previewImage: function(url) {
      var overlay = document.createElement('div');
      overlay.className = 'task-confirm-overlay';
      overlay.style.cursor = 'pointer';
      overlay.innerHTML = '<img src="' + this._escapeAttr(url) + '" style="max-width:90%;max-height:90%;border-radius:12px">';
      overlay.onclick = function() { document.body.removeChild(overlay); };
      document.body.appendChild(overlay);
    },

    _downloadFile: function(url) {
      var a = document.createElement('a');
      a.href = url;
      a.download = url.split('/').pop();
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    },

    // ---- Navigation ----

    _showView: function(view) {
      if (view === 'list') this._renderTaskList();
    },

    _escapeHtml: function(text) {
      var div = document.createElement('div');
      div.appendChild(document.createTextNode(text));
      return div.innerHTML;
    },

    _escapeAttr: function(text) {
      return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  };

  window.TaskPanel = TaskPanel;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(function() { TaskPanel.init(); }, 800); });
  } else {
    setTimeout(function() { TaskPanel.init(); }, 800);
  }
})();
