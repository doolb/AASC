(function() {
  'use strict';

  var TaskPanel = {
    instances: new Map(),
    _widgetData: {},
    _widgetControllers: {},
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

    _handleTaskList: function(payload) {
      // 向后兼容：如果是数组直接当 tasks
      var tasks = Array.isArray(payload) ? payload : (payload.tasks || []);
      // 合并同名条目：内置任务带 widget，磁盘任务带实例
      var merged = {};
      for (var t = 0; t < tasks.length; t++) {
        var task = tasks[t];
        var key = task.taskName;
        if (merged[key]) {
          // 合并实例、补全 widget 等字段
          if (task.instances) merged[key].instances = (merged[key].instances || []).concat(task.instances);
          if (task.widget && !merged[key].widget) merged[key].widget = task.widget;
          if (task.mode && !merged[key].mode) merged[key].mode = task.mode;
        } else {
          merged[key] = Object.assign({}, task);
        }
      }
      this.taskList = Object.values(merged);
      // 从任务列表同步 running 实例到 this.instances（用于运行中页签）
      for (var t = 0; t < this.taskList.length; t++) {
        var instances = this.taskList[t].instances || [];
        for (var i = 0; i < instances.length; i++) {
          var inst = instances[i];
          if (inst.status === 'running' || inst.status === 'pending_forward' || inst.status === 'display_offline') {
            if (!this.instances.has(inst.instanceId)) {
              this.instances.set(inst.instanceId, inst);
            }
          }
        }
      }

      // 以服务端状态为准，纠正 this.instances 中的过期状态
      for (var t = 0; t < this.taskList.length; t++) {
        var instances = this.taskList[t].instances || [];
        for (var i = 0; i < instances.length; i++) {
          var inst = instances[i];
          var memInst = this.instances.get(inst.instanceId);
          if (memInst && inst.status !== 'running' && inst.status !== 'pending_forward') {
            memInst.status = inst.status;
          }
        }
      }

      // 请求运行中服务实例立即推送 widget 数据，避免等待定时更新
      for (var t = 0; t < this.taskList.length; t++) {
        var task = this.taskList[t];
        if (task.widget && task.instances) {
          for (var i = 0; i < task.instances.length; i++) {
            var inst = task.instances[i];
            if (inst.status === 'running') {
              this._send({
                type: 'task:widget_action',
                payload: { instanceId: inst.instanceId, action: 'widgetRefresh' }
              });
            }
          }
        }
      }
      // 注册 sidebar 任务到 SidebarRegistry
      if (window.SidebarRegistry) {
        window.SidebarRegistry.registerManifest({
          sidebarGroups: payload.sidebarGroups || [],
          sidebarTabs: payload.sidebarTabs || [],
          tasks: tasks
        });
      }
      if (this.currentTab === 'list') this._renderTaskList();
    },

    _renderTaskList: function() {
      var container = document.getElementById('taskTabList');
      if (!container) return;

      var builtin = this.taskList.filter(function(t) { return t.taskType === 'builtin'; });
      var user = this.taskList.filter(function(t) { return t.taskType !== 'builtin'; });

      // 左列：任务列表
      var leftHtml = '<div class="task-list-col-header">' +
        '<input class="task-search" id="taskSearch" placeholder="搜索任务..." oninput="TaskPanel._filterTasks()">' +
        '<button class="task-card-btn" onclick="TaskPanel._switchToNew()" style="flex-shrink:0;white-space:nowrap">+ 新建</button>' +
      '</div>';

      if (builtin.length > 0) {
        leftHtml += '<div class="task-group-title">内置任务（只读）</div>';
        leftHtml += builtin.map(function(t) { return this._taskCardHTML(t); }, this).join('');
      }

      leftHtml += '<div class="task-group-title">用户任务</div>';
      if (user.length === 0) {
        leftHtml += '<div class="task-empty-state">' +
          '<div class="task-empty-state-icon">⚡</div>' +
          '<div class="task-empty-state-text">还没有用户任务</div>' +
        '</div>';
      } else {
        leftHtml += user.map(function(t) { return this._taskCardHTML(t); }, this).join('');
      }

      var middleHtml = this._selectedTaskName
        ? this._renderInstancesCol(this._selectedTaskName)
        : '<div class="task-three-col-placeholder">选择一个任务查看执行记录</div>';

      var rightHtml = this._selectedTaskName && this._selectedInstanceId
        ? this._renderResultCol(this._selectedTaskName, this._selectedInstanceId)
        : '<div class="task-three-col-placeholder">选择一条执行记录查看详情</div>';

      container.innerHTML =
        '<div class="task-three-col">' +
          '<div class="task-list-col">' + leftHtml + '</div>' +
          '<div class="task-instances-col" id="taskInstancesCol">' + middleHtml + '</div>' +
          '<div class="task-result-col" id="taskResultCol">' + rightHtml + '</div>' +
        '</div>';
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
        else if (latest.status === 'draft' || latest.status === 'created') { icon = '📝'; statusClass = 'draft'; statusText = '草稿'; }
        else if (latest.status === 'pending' || latest.status === 'pending_forward') { icon = '⏳'; statusClass = 'pending'; statusText = '排队中'; }
        else if (latest.status === 'display_offline') { icon = '⚠️'; statusClass = 'display-offline'; statusText = '进行中(offline)'; }
        latestProgress = (latest.progress != null && (latest.status === 'running' || latest.status === 'display_offline')) ? latest.progress : null;
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
      var isSelected = this._selectedTaskName === task.taskName;
      var actionsHtml = '';
      if (isBuiltin) {
        actionsHtml += '<button class="task-card-btn primary" onclick="event.stopPropagation();TaskPanel._createBuiltinInstance(\'' + safeTaskName + '\')">创建实例</button>';
        actionsHtml += '<button class="task-card-btn" onclick="event.stopPropagation();TaskPanel._viewBuiltinParams(\'' + safeTaskName + '\')">配置</button>';
        if (task.params && task.params.length > 0) {
          actionsHtml += '<button class="task-card-btn" onclick="event.stopPropagation();TaskPanel._showGlobalConfig(\'' + safeTaskName + '\')">全局配置</button>';
        }
      } else {
        actionsHtml += '<button class="task-card-btn primary" onclick="event.stopPropagation();TaskPanel._createUserInstance(\'' + safeTaskName + '\')">创建实例</button>';
        actionsHtml += '<button class="task-card-btn" onclick="event.stopPropagation();TaskPanel._viewEdit(\'' + safeTaskName + '\')">编辑</button>';
        actionsHtml += '<button class="task-card-btn danger" onclick="event.stopPropagation();TaskPanel._confirmDelete(\'' + safeTaskName + '\')">删除</button>';
      }

      return '<div class="' + cardClass + (isSelected ? ' selected' : '') + '" onclick="TaskPanel._selectTask(\'' + safeTaskName + '\')">' +
        '<div class="task-card-header">' +
          '<div class="task-card-title"><span class="task-card-icon">' + icon + '</span>' + this._escapeHtml(task.name || task.taskName) + '</div>' +
          '<span class="task-card-status ' + statusClass + '">' + statusText + '</span>' +
        '</div>' +
        '<div class="task-card-meta">' + metaHtml + '</div>' +
        progressHtml +
        '<div class="task-card-actions">' + actionsHtml + '</div>' +
      '</div>';
    },



    _selectTask: function(taskName) {
      if (this._selectedTaskName === taskName) return;
      this._selectedTaskName = taskName;
      // 默认选中最近的一条执行记录
      var task = null;
      for (var i = 0; i < this.taskList.length; i++) {
        if (this.taskList[i].taskName === taskName) { task = this.taskList[i]; break; }
      }
      var instances = task ? (task.instances || []).slice() : [];
      instances.sort(function(a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
      this._selectedInstanceId = instances.length > 0 ? instances[0].instanceId : null;
      this._requestTaskList();
    },

    _switchToNew: function() {
      var tab = document.querySelector('[data-tab="new"]');
      if (tab) tab.click();
    },

    _renderInstancesCol: function(taskName) {
      var task = null;
      for (var i = 0; i < this.taskList.length; i++) {
        if (this.taskList[i].taskName === taskName) { task = this.taskList[i]; break; }
      }
      if (!task) return '<div class="task-three-col-placeholder">任务不存在</div>';

      var instances = task.instances || [];
      // 合并内存状态
      instances.forEach(function(inst) {
        var memInst = this.instances.get(inst.instanceId);
        if (memInst) {
          if (memInst.status != null) inst.status = memInst.status;
          inst.stage = memInst.stage;
          inst.result = memInst.result;
          inst.logs = memInst.logs;
          inst.completedAt = memInst.completedAt;
        }
      }, this);
      instances.sort(function(a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });

      var safeTaskName = this._escapeAttr(taskName);
      var html = '<div class="task-instances-header">' +
        '<span class="task-group-title" style="margin:0;padding:0 4px">执行记录</span>' +
        '<button class="task-card-btn primary" onclick="event.stopPropagation();TaskPanel._runUserTask(\'' + safeTaskName + '\')" style="font-size:11px">运行</button>' +
      '</div>';

      if (instances.length === 0) {
        html += '<div class="task-three-col-placeholder" style="padding:12px">暂无执行记录</div>';
      } else {
        for (var i = 0; i < instances.length; i++) {
          var inst = instances[i];
          var icon = inst.status === 'completed' ? '✅' : inst.status === 'failed' ? '❌' : inst.status === 'stopped' ? '⏹' : inst.status === 'running' ? '🔄' : inst.status === 'draft' ? '📝' : '⏳';
          var sel = inst.instanceId === this._selectedInstanceId ? ' selected' : '';
          var time = inst.timestamp ? this._formatTime(inst.timestamp) : '';
          var safeId = this._escapeAttr(inst.instanceId);
          var displayName = inst.instanceId ? inst.instanceId : '';
          html += '<div class="task-result-history-item' + sel + '" onclick="TaskPanel._selectInstance(\'' + safeTaskName + '\',\'' + safeId + '\')">' +
            '<span class="result-icon">' + icon + '</span>' +
            '<span style="flex:1;overflow:hidden;text-overflow:ellipsis" title="' + this._escapeAttr(displayName) + '">' + time + ' ' + this._escapeHtml(displayName) + '</span>' +
            '<button class="task-result-history-del" onclick="event.stopPropagation();TaskPanel._confirmDeleteInstance(\'' + safeTaskName + '\',\'' + safeId + '\')">✕</button>' +
          '</div>';
        }
      }

      return html;
    },

    _selectInstance: function(taskName, instanceId) {
      this._selectedInstanceId = instanceId;
      var col = document.getElementById('taskResultCol');
      if (!col) return;
      col.innerHTML = this._renderResultCol(taskName, instanceId);
      // 重新渲染实例列表更新选中样式
      var instancesCol = document.getElementById('taskInstancesCol');
      if (instancesCol) instancesCol.innerHTML = this._renderInstancesCol(taskName);
      this._requestTaskList();
    },

    _renderResultCol: function(taskName, instanceId) {
      var task = null;
      for (var i = 0; i < this.taskList.length; i++) {
        if (this.taskList[i].taskName === taskName) { task = this.taskList[i]; break; }
      }
      if (!task) return '<div class="task-three-col-placeholder">任务不存在</div>';

      var instances = task.instances || [];
      var inst = null;
      for (var i = 0; i < instances.length; i++) {
        if (instances[i].instanceId === instanceId) { inst = instances[i]; break; }
      }
      if (!inst) return '<div class="task-three-col-placeholder">执行记录不存在</div>';

      // 合并内存状态
      var memInst = this.instances.get(inst.instanceId);
      if (memInst) {
        if (memInst.status) inst.status = memInst.status;
        inst.logs = memInst.logs;
        inst.result = memInst.result;
        inst.completedAt = memInst.completedAt;
        if (memInst.params) inst.params = memInst.params;
      }

      // 如果实例没有日志，请求加载
      if ((!inst.logs || inst.logs.length === 0) && inst.status !== 'running') {
        var memLogs = this.instances.get(inst.instanceId);
        if (!memLogs || !memLogs._logsLoaded) {
          this._requestInstanceLogs(taskName, instanceId);
        }
      }

      return this._resultDetailHTML(inst, taskName);
    },

    _filterTasks: function() {
      var q = document.getElementById('taskSearch');
      if (!q) return;
      var query = q.value.toLowerCase();
      var listCol = document.querySelector('.task-list-col');
      if (!listCol) return;
      var cards = listCol.querySelectorAll('.task-card');
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
                '<button class="task-btn-option" data-value="service">服务</button>' +
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
          '<div class="task-form-section-title">实例配置</div>' +
          '<div class="task-form-row">' +
            '<div class="task-form-field">' +
              '<label>实例 ID（可选，留空自动生成）</label>' +
              '<input type="text" id="taskInstanceId" placeholder="llm.chat.default">' +
            '</div>' +
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
          // 内置任务时任务名称只读
          var nameInput = document.getElementById('taskName');
          if (nameInput) {
            nameInput.readOnly = isBuiltin;
            nameInput.style.opacity = isBuiltin ? '0.6' : '1';
          }
          if (isBuiltin) self._loadBuiltinTasks();
        });
      }

      var builtinSel = document.getElementById('builtinId');
      if (builtinSel) {
        builtinSel.addEventListener('change', function(e) {
          var builtinId = e.target.value;
          // 自动填写任务名称
          var nameInput = document.getElementById('taskName');
          if (nameInput && builtinId) {
            nameInput.value = builtinId;
          }
          // 自动选择执行模式（匹配内置任务定义）
          if (builtinId) {
            var task = this._getBuiltinTask(builtinId);
            if (task && task.mode) {
              var modeBtns = document.querySelectorAll('#modeGroup .task-btn-option');
              for (var m = 0; m < modeBtns.length; m++) {
                var matched = modeBtns[m].dataset.value === task.mode;
                modeBtns[m].classList.toggle('active', matched);
              }
            }
          }
          var container = document.getElementById('builtinParams');
          if (container && builtinId) {
            this._renderBuiltinParams(builtinId, container);
          }
        }.bind(this));
      }

      document.querySelectorAll('.task-btn-group').forEach(function(group) {
        group.addEventListener('click', function(e) {
          var btn = e.target.closest('.task-btn-option');
          if (!btn) return;
          e.preventDefault();
          e.stopPropagation();
          group.querySelectorAll('.task-btn-option').forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
          if (group.id === 'targetGroup') {
            var showDevice = btn.dataset.value === 'display' || btn.dataset.value === 'subdisplay';
            var ds = document.getElementById('deviceSelectorSection');
            if (ds) ds.style.display = showDevice ? 'block' : 'none';
          }
        });
      });
      // 模式按钮组显式绑定，防止事件冒泡冲突
      var modeGroup = document.getElementById('modeGroup');
      if (modeGroup) {
        modeGroup.addEventListener('click', function(e) {
          var btn = e.target.closest('.task-btn-option');
          if (!btn) return;
          e.stopPropagation();
          modeGroup.querySelectorAll('.task-btn-option').forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
        });
      }

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

    _hasWebgpu: function(d) {
      if (!d) return false;
      if (d.capabilities && d.capabilities.webgpu !== undefined) return d.capabilities.webgpu;
      if (d.webgpu) return true;
      var fs = d.browserInfo && d.browserInfo.featureSupport;
      if (fs && Array.isArray(fs)) {
        for (var i = 0; i < fs.length; i++) {
          if (fs[i].name === 'WebGPU' && fs[i].supported) return true;
        }
      }
      return false;
    },

    _renderDeviceSelector: function(listId) {
      listId = listId || 'deviceSelectorList';
      var list = document.getElementById(listId);
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
        if (this._hasWebgpu(d)) capText.push('WebGPU');
        else if (caps.webgl) capText.push('WebGL');
        if (caps.cpu || capText.length === 0) capText.push('CPU');
        var safeId = this._escapeAttr(d.id);
        var label = d.ip ? this._escapeHtml(d.id + ' (' + d.ip + ')') : this._escapeHtml(d.id);
        html += '<div class="task-device-item" data-id="' + safeId + '">' +
          '<div class="task-device-radio"></div>' +
          '<div class="task-device-info">' +
            '<div class="task-device-name">' + label + '</div>' +
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

    _renderEditDeviceSelector: function() {
      this._renderDeviceSelector('editDeviceSelectorList');
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

    _getBuiltinTask: function(builtinId) {
      for (var i = 0; i < this.taskList.length; i++) {
        if (this.taskList[i].taskName === builtinId) return this.taskList[i];
      }
      return null;
    },

    _renderGenericParam: function(param) {
      var fieldId = 'param-' + param.name;
      var label = this._escapeHtml(param.label || param.name);
      if (param.type === 'select') {
        var opts = (param.options || []).map(function(o) {
          var sel = o === param.default ? 'selected' : '';
          return '<option value="' + o + '" ' + sel + '>' + o + '</option>';
        }).join('');
        return '<div class="task-form-field"><label>' + label + '</label>' +
          '<select id="' + fieldId + '" style="width:100%;padding:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;font-size:13px">' + opts + '</select></div>';
      } else if (param.type === 'number') {
        return '<div class="task-form-field"><label>' + label + '</label>' +
          '<input type="number" id="' + fieldId + '" value="' + (param.default !== undefined ? param.default : '') + '"' +
          (param.min !== undefined ? ' min="' + param.min + '"' : '') +
          (param.max !== undefined ? ' max="' + param.max + '"' : '') +
          (param.step !== undefined ? ' step="' + param.step + '"' : '') +
          ' style="width:100%;padding:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;font-size:13px;box-sizing:border-box"></div>';
      } else {
        return '<div class="task-form-field"><label>' + label + '</label>' +
          '<input type="text" id="' + fieldId + '" value="' + this._escapeAttr(param.default || '') + '"' +
          ' placeholder="' + this._escapeAttr(param.placeholder || '') + '"' +
          ' style="width:100%;padding:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;font-size:13px;box-sizing:border-box"></div>';
      }
    },

    _renderBuiltinParams: function(builtinId, container) {
      // model.inference 使用自定义表单（图片选择、显示端列表等）
      if (builtinId === 'model.inference') {
        var modelTask = this._getBuiltinTask(builtinId);
        var params = modelTask ? modelTask.params || [] : [];

        var html = '';
        for (var p = 0; p < params.length; p++) {
          var param = params[p];
          if (param.name === 'image') {
            html += '<div class="task-form-field">' +
              '<label>' + this._escapeHtml(param.label || '图片') + '</label>' +
              '<div style="display:flex;gap:8px;margin-bottom:6px">' +
              '<button class="task-card-btn" id="miServerImgBtn" style="flex:1">服务器图片</button>' +
              '<button class="task-card-btn" id="miUploadImgBtn" style="flex:1">本地上传</button></div>' +
              '<div class="task-file-zone" id="miImageZone" style="padding:12px;display:none">' +
              '<div class="task-file-zone-text">点击选择或拖拽图片</div></div>' +
              '<input type="file" id="miImageFile" accept="image/*" style="display:none">' +
              '<div id="miImagePreview" style="margin-top:4px;max-width:120px;max-height:80px;display:none"></div>' +
              '<input type="hidden" id="miServerImage" value="">' +
              '<div id="miServerImageName" style="font-size:12px;color:#8cf;margin-top:4px;display:none"></div></div>';
          } else if (param.name === 'prompt') {
            html += '<div class="task-form-field">' +
              '<label>' + this._escapeHtml(param.label || '提示词') + '</label>' +
              '<textarea id="miPrompt" rows="2" style="width:100%;background:#1a1a2e;border:1px solid #333;border-radius:6px;color:#ccc;padding:8px;font-size:13px;font-family:inherit;resize:vertical;box-sizing:border-box">' +
              this._escapeHtml(param.default || '') + '</textarea></div>';
          } else if (param.name === 'modelId') {
            html += '<div class="task-form-field">' +
              '<label>' + this._escapeHtml(param.label || '模型') + '</label>' +
              '<select id="miModelId">' +
              (param.options || []).map(function(o) {
                return '<option value="' + o + '">' + o + '</option>';
              }).join('') + '</select></div>';
          } else if (param.name === 'targetDisplay') {
            html += '<div class="task-form-field">' +
              '<label>' + this._escapeHtml(param.label || '目标显示端') + '</label>' +
              '<div class="task-device-list" id="miDisplayList" style="max-height:150px;overflow-y:auto"></div></div>';
          }
        }
        html += '<button class="task-submit-btn" id="miSubmitBtn">提交推理任务</button>';
        container.innerHTML = html;
        this._bindMiEvents();
        return;
      }

      // 其他内置任务：从 params 数组通用渲染
      var task = this._getBuiltinTask(builtinId);
      var params = task ? task.params || [] : [];
      if (params.length === 0) {
        container.innerHTML = '<div style="color:#666;font-size:12px;padding:8px">无参数</div>';
        return;
      }
      var html = '<div style="display:flex;flex-direction:column;gap:8px">';
      for (var p = 0; p < params.length; p++) {
        html += this._renderGenericParam(params[p]);
      }
      html += '</div>';
      container.innerHTML = html;
    },

    _bindMiEvents: function() {
      var self = this;

      var imageZone = document.getElementById('miImageZone');
      var imageInput = document.getElementById('miImageFile');
      if (imageZone && imageInput) {
        imageZone.addEventListener('click', function() { imageInput.click(); });
        imageZone.addEventListener('dragover', function(e) { e.preventDefault(); imageZone.classList.add('dragover'); });
        imageZone.addEventListener('dragleave', function() { imageZone.classList.remove('dragover'); });
        imageZone.addEventListener('drop', function(e) {
          e.preventDefault();
          imageZone.classList.remove('dragover');
          if (e.dataTransfer.files.length > 0) {
            imageInput.files = e.dataTransfer.files;
            self._previewMiImage(e.dataTransfer.files[0]);
          }
        });
        imageInput.addEventListener('change', function() {
          if (imageInput.files.length > 0) self._previewMiImage(imageInput.files[0]);
        });
      }

      // Server image picker
      var serverBtn = document.getElementById('miServerImgBtn');
      if (serverBtn) {
        serverBtn.addEventListener('click', function() { self._showServerImagePicker(); });
      }

      // Upload button
      var uploadBtn = document.getElementById('miUploadImgBtn');
      if (uploadBtn) {
        uploadBtn.addEventListener('click', function() {
          var zone = document.getElementById('miImageZone');
          var input = document.getElementById('miImageFile');
          if (zone) { zone.style.display = 'block'; }
          if (input) { input.click(); }
        });
      }

      this._renderMiDisplayList();

      var submitBtn = document.getElementById('miSubmitBtn');
      if (submitBtn) {
        submitBtn.addEventListener('click', function() { self._submitMiTask(); });
      }
    },

    _showServerImagePicker: function() {
      var self = this;
      fetch('/media-list').then(function(r) { return r.json(); }).then(function(data) {
        if (data.status !== 'success') { alert('获取服务器图片列表失败'); return; }
        var images = (data.list || []).filter(function(f) {
          return f.mediaType === 'image' || /\.(jpg|jpeg|png|gif|webp)$/i.test(f.name);
        });
        if (images.length === 0) { alert('服务器上没有图片文件'); return; }

        var overlay = document.createElement('div');
        overlay.className = 'task-confirm-overlay';
        overlay.style.zIndex = '9999';
        var html = '<div class="task-confirm-box" style="max-width:600px;width:90%">' +
          '<div class="task-confirm-title">选择服务器图片</div>' +
          '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-height:400px;overflow-y:auto;padding:8px" id="miServerGrid">';
        for (var i = 0; i < images.length; i++) {
          var img = images[i];
          var safeUrl = self._escapeAttr(img.url);
          html += '<div class="task-server-img-item" data-url="' + safeUrl + '" data-name="' + self._escapeAttr(img.name) + '" style="cursor:pointer;border:2px solid transparent;border-radius:8px;overflow:hidden;text-align:center">' +
            '<img src="' + safeUrl + '" style="width:100%;height:80px;object-fit:cover;display:block">' +
            '<div style="font-size:10px;color:#aaa;padding:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + self._escapeHtml(img.name) + '</div></div>';
        }
        html += '</div>' +
          '<input type="hidden" id="miSelectedServerImg" value="">' +
          '<div id="miSelectedServerName" style="font-size:12px;color:#8cf;text-align:center;margin:4px 0"></div>' +
          '<div class="task-confirm-actions">' +
          '<button class="task-confirm-btn cancel" id="sipCancel">取消</button>' +
          '<button class="task-confirm-btn confirm" id="sipConfirm" style="background:rgba(0,210,255,0.15);color:#8cf">选择</button></div></div>';
        overlay.innerHTML = html;
        document.body.appendChild(overlay);

        // Image grid click delegation
        var grid = document.getElementById('miServerGrid');
        if (grid) {
          grid.addEventListener('click', function(e) {
            var item = e.target.closest('.task-server-img-item');
            if (!item) return;
            grid.querySelectorAll('.task-server-img-item').forEach(function(el) { el.style.borderColor = 'transparent'; });
            item.style.borderColor = '#00d2ff';
            document.getElementById('miSelectedServerImg').value = item.dataset.url;
            document.getElementById('miSelectedServerName').textContent = item.dataset.name;
          });
        }

        document.getElementById('sipCancel').onclick = function() { document.body.removeChild(overlay); };
        document.getElementById('sipConfirm').onclick = function() {
          var val = document.getElementById('miSelectedServerImg').value;
          var name = document.getElementById('miSelectedServerName').textContent;
          if (!val) { alert('请选择一张图片'); return; }
          document.body.removeChild(overlay);
          document.getElementById('miServerImage').value = val;
          var nameEl = document.getElementById('miServerImageName');
          if (nameEl) { nameEl.textContent = '已选择: ' + name; nameEl.style.display = 'block'; }
          var preview = document.getElementById('miImagePreview');
          if (preview) { preview.innerHTML = '<img src="' + val + '" style="max-width:120px;max-height:80px;border-radius:6px;object-fit:cover">'; preview.style.display = 'block'; }
          document.getElementById('miImageFile').value = '';
        };
      }).catch(function(e) { alert('获取图片列表失败: ' + e.message); });
    },

    _previewMiImage: function(file) {
      var reader = new FileReader();
      reader.onload = function(e) {
        var preview = document.getElementById('miImagePreview');
        if (preview) {
          preview.innerHTML = '<img src="' + e.target.result + '" style="max-width:120px;max-height:80px;border-radius:6px;object-fit:cover">';
          preview.style.display = 'block';
        }
      };
      reader.readAsDataURL(file);
    },

    _renderMiDisplayList: function() {
      var list = document.getElementById('miDisplayList');
      if (!list) return;
      var html = '';
      for (var i = 0; i < this.displayList.length; i++) {
        var d = this.displayList[i];
        var capTag = this._hasWebgpu(d) ? 'WebGPU' : 'GPU';
        var safeId = this._escapeAttr(d.id);
        var displayLabel = d.ip ? this._escapeHtml(d.id + ' (' + d.ip + ')') : this._escapeHtml(d.id);
        html += '<div class="task-device-item selected" data-id="' + safeId + '">' +
          '<div class="task-device-radio"></div>' +
          '<div class="task-device-info"><div class="task-device-name">' + displayLabel + '</div>' +
          '<div class="task-device-cap">' + capTag + '</div></div>' +
          '<span class="task-device-state online">在线</span></div>';
      }
      if (!html) {
        html = '<div style="color:#666;font-size:12px;padding:8px">没有在线显示端</div>';
      }
      list.innerHTML = html;
      list.addEventListener('click', function(e) {
        var item = e.target.closest('.task-device-item');
        if (!item) return;
        list.querySelectorAll('.task-device-item').forEach(function(el) { el.classList.remove('selected'); });
        item.classList.add('selected');
      });
    },

    _submitMiTask: function() {
      var modelId = document.getElementById('miModelId');
      var prompt = document.getElementById('miPrompt');
      var imageInput = document.getElementById('miImageFile');
      var serverImg = document.getElementById('miServerImage');
      var displayList = document.getElementById('miDisplayList');
      var selectedDisplay = displayList ? displayList.querySelector('.task-device-item.selected') : null;

      var isServerFile = serverImg && serverImg.value;
      if (!isServerFile && (!imageInput || !imageInput.files || imageInput.files.length === 0)) {
        alert('请选择图片（本地上传或从服务器选择）'); return;
      }
      if (!selectedDisplay || !selectedDisplay.dataset.id) {
        alert('请选择目标显示端'); return;
      }

      var self = this;
      var params = {};
      if (prompt && prompt.value) params.prompt = prompt.value;
      params.modelId = modelId ? modelId.value : 'lfm-vl';

      var payload = {
        taskName: 'model-inference-' + Date.now(),
        taskType: 'builtin',
        builtinId: 'model.inference',
        target: 'display',
        displayId: selectedDisplay.dataset.id,
        mode: 'one-shot',
        env: 'webgpu',
        params: params
      };

      function doSubmit() {
        self._send({ type: 'task:submit', payload: payload });
      }

      if (isServerFile) {
        // Server file: pass URL directly in params
        params._serverImage = serverImg.value;
        doSubmit();
      } else {
        // Local upload: read as base64
        var file = imageInput.files[0];
        var reader = new FileReader();
        reader.onload = function(e) {
          payload.files = [{ name: 'image', data: e.target.result.split(',')[1] }];
          doSubmit();
        };
        reader.readAsDataURL(file);
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
      var mode = modeEl ? modeEl.dataset.value : 'one-shot';
      var typeEl = document.getElementById('taskTypeSelect');
      var deviceEl = document.querySelector('#deviceSelectorList .task-device-item.selected');
      var displayId = deviceEl && deviceEl.dataset.id ? deviceEl.dataset.id : null;
      var target = targetEl ? targetEl.dataset.value : 'server';
      if (target === 'server') displayId = null;

      // 自定义实例 ID
      var instanceIdInput = document.getElementById('taskInstanceId');
      var customInstanceId = instanceIdInput ? instanceIdInput.value.trim() : '';

      // 读取通用参数表单字段（[id^="param-"]）
      var paramFields = document.querySelectorAll('[id^="param-"]');
      for (var pf = 0; pf < paramFields.length; pf++) {
        var el = paramFields[pf];
        var name = el.id.replace('param-', '');
        if (name) {
          if (el.type === 'number') params[name] = parseFloat(el.value) || 0;
          else params[name] = el.value;
        }
      }

      var msg = {
        type: 'task:submit',
        payload: {
          taskName: taskName,
          instanceId: customInstanceId || undefined,
          taskType: typeEl ? typeEl.value : 'user',
          builtinId: (typeEl && typeEl.value === 'builtin') ? taskName : undefined,
          entryFile: document.getElementById('entryFile') ? document.getElementById('entryFile').value.trim() : (mode === 'service' ? 'service.js' : 'task.js'),
          target: target,
          displayId: displayId,
          mode: mode,
          env: envEl ? envEl.dataset.value : 'auto',
          files: files,
          params: params
        }
      };

      this._send(msg);
    },

    _runUserTask: function(taskName) {
      var task = null;
      for (var i = 0; i < this.taskList.length; i++) {
        if (this.taskList[i].taskName === taskName) { task = this.taskList[i]; break; }
      }
      // 内置任务走内置执行路径
      if (task && task.taskType === 'builtin') {
        this._runBuiltin(taskName);
        return;
      }
      // 从 task 元数据读取 target/mode，而非硬编码
      var target = (task && task.target) || 'server';
      var mode = (task && task.mode) || 'one-shot';
      var entryFile = (task && task.entryFile) || (mode === 'service' ? 'service.js' : 'task.js');
      var displayId = (task && task.displayId) || null;
      this._send({
        type: 'task:submit',
        payload: {
          taskName: taskName,
          taskType: 'user',
          entryFile: entryFile,
          target: target,
          displayId: displayId,
          mode: mode,
          env: 'auto',
          params: {},
          files: []
        }
      });
    },

    _runEditTask: function(taskName) {
      var task = null;
      for (var i = 0; i < this.taskList.length; i++) {
        if (this.taskList[i].taskName === taskName) { task = this.taskList[i]; break; }
      }
      var params = {};
      try {
        var t = document.getElementById('editParams');
        if (t && t.value) params = JSON.parse(t.value);
      } catch(e) { /* ignore */ }

      var targetEl = document.querySelector('#editTargetGroup .task-btn-option.active');
      var envEl = document.querySelector('#editEnvGroup .task-btn-option.active');
      var modeEl = document.querySelector('#editModeGroup .task-btn-option.active');
      var mode = modeEl ? modeEl.dataset.value : 'one-shot';
      var deviceEl = document.querySelector('#editDeviceSelectorList .task-device-item.selected');
      var displayId = deviceEl && deviceEl.dataset.id ? deviceEl.dataset.id : null;
      var target = targetEl ? targetEl.dataset.value : 'server';
      if (target === 'server') displayId = null;

      var isBuiltin = task && task.taskType === 'builtin';
      this._send({
        type: 'task:submit',
        payload: {
          taskName: taskName,
          taskType: isBuiltin ? 'builtin' : 'user',
          builtinId: isBuiltin ? taskName : undefined,
          entryFile: isBuiltin ? undefined : ((task && task.entryFile) || (mode === 'service' ? 'service.js' : 'task.js')),
          target: target,
          displayId: displayId,
          mode: mode,
          env: envEl ? envEl.dataset.value : 'auto',
          params: params,
          files: []
        }
      });
    },

    _createBuiltinInstance: function(taskName) {
      // 有参数的任务打开配置页，无参数的直接创建实例
      var task = null;
      for (var i = 0; i < this.taskList.length; i++) {
        if (this.taskList[i].taskName === taskName) { task = this.taskList[i]; break; }
      }
      if (task && task.params && task.params.length > 0) {
        this._viewBuiltinParams(taskName);
      } else {
        this._send({ type: 'task:submit', payload: {
          taskName: taskName, taskType: 'builtin', builtinId: taskName,
          target: (task && task.target) || 'server',
          mode: (task && task.mode) || 'one-shot',
          params: {}, files: []
        }});
      }
    },

    _createUserInstance: function(taskName) {
      // 打开任务编辑/文件上传页
      this._viewEdit(taskName);
    },

    _runBuiltin: function(taskName) {
      var task = null;
      for (var i = 0; i < this.taskList.length; i++) {
        if (this.taskList[i].taskName === taskName) { task = this.taskList[i]; break; }
      }
      var mode = (task && task.mode) || 'one-shot';
      this._send({
        type: 'task:submit',
        payload: {
          taskName: taskName,
          taskType: 'builtin',
          builtinId: taskName,
          target: (task && task.target) || 'server',
          mode: mode,
          env: 'auto',
          params: {},
          files: []
        }
      });
    },

    _viewBuiltinParams: function(taskName) {
      var tab = document.querySelector('[data-tab="new"]');
      if (tab) tab.click();
      var typeSel = document.getElementById('taskTypeSelect');
      if (typeSel) { typeSel.value = 'builtin'; typeSel.dispatchEvent(new Event('change')); }
      var builtinSel = document.getElementById('builtinId');
      if (builtinSel) { builtinSel.value = taskName; builtinSel.dispatchEvent(new Event('change')); }
    },

    _showGlobalConfig: function(taskName) {
      var self = this;
      // 请求全局配置
      this._send({ type: 'task:get_config', payload: { taskName: taskName } });

      // 监听返回（一次性）
      var handler = function(data) {
        if (data.type === 'task:config_data' && data.payload.taskName === taskName) {
          // 移除监听
          var ws = window.WebSocketManager;
          if (ws && ws._taskPanelHooked) {
            ws.handleMessage = (function(orig) {
              return function(data) {
                if (orig) orig.call(ws, data);
              };
            })(ws.handleMessage);
          }

          var config = data.payload.config || {};

          // 查找任务定义中的 params 作为表单字段定义
          var task = null;
          for (var i = 0; i < self.taskList.length; i++) {
            if (self.taskList[i].taskName === taskName) { task = self.taskList[i]; break; }
          }
          var params = task ? task.params || [] : [];

          // 构建表单 HTML
          var fieldsHtml = '';
          for (var p = 0; p < params.length; p++) {
            var param = params[p];
            var val = config[param.name] !== undefined ? config[param.name] : param.default;
            var label = self._escapeHtml(param.label || param.name);

            if (param.type === 'number') {
              fieldsHtml += '<div style="margin-bottom:10px"><label style="font-size:12px;color:rgba(255,255,255,0.6);display:block;margin-bottom:4px">' + label + '</label>' +
                '<input type="number" id="gc-' + param.name + '" value="' + (val !== undefined ? val : '') + '"' +
                (param.min !== undefined ? ' min="' + param.min + '"' : '') +
                (param.max !== undefined ? ' max="' + param.max + '"' : '') +
                (param.step !== undefined ? ' step="' + param.step + '"' : '') +
                ' style="width:100%;padding:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;font-size:13px;box-sizing:border-box"></div>';
            } else {
              fieldsHtml += '<div style="margin-bottom:10px"><label style="font-size:12px;color:rgba(255,255,255,0.6);display:block;margin-bottom:4px">' + label + '</label>' +
                '<input type="text" id="gc-' + param.name + '" value="' + self._escapeAttr(String(val !== undefined ? val : '')) + '"' +
                ' style="width:100%;padding:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;font-size:13px;box-sizing:border-box"></div>';
            }
          }

          // 弹窗
          var overlay = document.createElement('div');
          overlay.className = 'task-confirm-overlay';
          overlay.innerHTML =
            '<div class="task-confirm-box" style="max-width:420px">' +
              '<div class="task-confirm-title">全局配置 - ' + self._escapeHtml(taskName) + '</div>' +
              '<div style="margin:12px 0;max-height:400px;overflow-y:auto">' + fieldsHtml + '</div>' +
              '<div class="task-confirm-actions">' +
                '<button class="task-confirm-btn cancel" id="gcCancel">取消</button>' +
                '<button class="task-confirm-btn confirm" id="gcSave" style="background:rgba(0,210,255,0.15);color:#8cf">保存</button>' +
              '</div>' +
            '</div>';
          document.body.appendChild(overlay);

          document.getElementById('gcCancel').onclick = function() { document.body.removeChild(overlay); };
          document.getElementById('gcSave').onclick = function() {
            var newConfig = {};
            for (var p = 0; p < params.length; p++) {
              var el = document.getElementById('gc-' + params[p].name);
              if (!el) continue;
              if (params[p].type === 'number') newConfig[params[p].name] = parseFloat(el.value) || 0;
              else newConfig[params[p].name] = el.value;
            }
            self._send({ type: 'task:set_config', payload: { taskName: taskName, config: newConfig } });
            document.body.removeChild(overlay);
          };
        }
      };

      // 临时挂载一次消息处理
      var ws = window.WebSocketManager;
      if (ws && ws.ws) {
        var origHandler = ws.handleMessage;
        ws.handleMessage = function(data) {
          handler(data);
          if (origHandler) origHandler.call(ws, data);
        };
      }
    },

    // ---- WebSocket ----

    _setupWS: function() {
      var self = this;
      var ws = window.WebSocketManager;
      if (!ws) { setTimeout(function() { self._setupWS(); }, 500); return; }
      if (ws._taskPanelHooked) return;
      ws._taskPanelHooked = true;
      // Pull existing display list from DeviceList (sent before we hooked)
      if (window.DeviceList && window.DeviceList.list && window.DeviceList.list.length > 0) {
        self.displayList = window.DeviceList.list;
        self._renderDeviceSelector();
      }
      var orig = ws.handleMessage;
      ws.handleMessage = function(data) {
        if (data.type === 'displayList') {
          self.displayList = data.list || [];
          if (document.getElementById('deviceSelectorList')) {
            self._renderDeviceSelector();
          }
          if (document.getElementById('miDisplayList')) {
            self._renderMiDisplayList();
          }
        }
        if (data.type === 'task:list:result') {
          self._handleTaskList(data.payload);
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
        if (data.type === 'task:instance_logs') {
          self._onInstanceLogs(data.payload);
        }
        if (data.type === 'task:instance_deleted') {
          self._onInstanceDeleted(data.payload);
        }
        if (data.type === 'task:widget_update') {
          self._onWidgetUpdate(data.payload);
          if (window.SidebarRegistry) {
            window.SidebarRegistry.onWidgetUpdate(data.payload);
          }
        }
        if (data.type === 'task:stream') {
          self._onStream(data.payload);
          if (window.SidebarRegistry) {
            window.SidebarRegistry.onStream(data.payload);
          }
        }
        if (data.type === 'task:instance_params_updated') {
          if (self._selectedInstanceId === data.payload.instanceId) {
            var col = document.getElementById('taskResultCol');
            if (col) col.innerHTML = self._renderResultCol(self._selectedTaskName, self._selectedInstanceId);
          }
        }
        if (data.type === 'task:run_result') {
          self._requestTaskList();
          self._updateInstanceStatus(data.payload);
        }
        if (data.type === 'task:rerun_result') {
          self._requestTaskList();
          self._updateInstanceStatus(data.payload);
        }
        if (data.type === 'task:instance_logs_cleared') {
          if (self._selectedInstanceId === data.payload.instanceId) {
            var inst = self.instances.get(data.payload.instanceId);
            if (inst) {
              inst.logs = [];
              inst._logsLoaded = true;
            }
            var col = document.getElementById('taskResultCol');
            if (col) col.innerHTML = self._renderResultCol(self._selectedTaskName, self._selectedInstanceId);
          }
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
      // 提交后切换到任务列表并选中任务
      if (this.currentTab === 'new') {
        this._selectedInstanceId = payload.instanceId;
        this._selectTask(payload.taskName);
        this._showView('list');
      }
    },

    _updateProgress: function(payload) {
      var inst = this.instances.get(payload.instanceId);
      if (inst) {
        if (payload.status) inst.status = payload.status;
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

    _onStream: function(payload) {
      var inst = this.instances.get(payload.instanceId);
      if (!inst) {
        this.instances.set(payload.instanceId, {
          instanceId: payload.instanceId,
          taskName: payload.taskName,
          status: 'running',
          stage: 'running',
          progress: 50,
          timestamp: Date.now(),
          logs: [],
          _streamText: ''
        });
        inst = this.instances.get(payload.instanceId);
      }
      if (inst) {
        if (!inst._streamText) inst._streamText = '';
        inst._streamText += payload.chunk || '';
        if (this.currentTab === 'monitor') this._renderMonitor();
      }
    },

    _onResult: function(payload) {
      var inst = this.instances.get(payload.instanceId);
      if (inst) {
        // 服务模式任务启动成功（data.serviceStarted），保持 running 状态
        if (payload.data && payload.data.serviceStarted) {
          inst.status = 'running';
        } else {
          inst.status = payload.success ? 'completed' : 'failed';
          inst.completedAt = Date.now();
        }
        inst.result = payload;
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
      }
      this._updateMonitorBadge();
      if (this.currentTab === 'monitor') this._renderMonitor();
      this._requestTaskList();
    },

    _onDeleted: function(payload) {
      if (payload.success) {
        this._requestTaskList();
      }
    },

    _onInstanceLogs: function(payload) {
      var inst = this.instances.get(payload.instanceId);
      if (!inst) {
        var actualStatus = 'draft';
        for (var t = 0; t < this.taskList.length; t++) {
          var instances = this.taskList[t].instances || [];
          for (var i = 0; i < instances.length; i++) {
            if (instances[i].instanceId === payload.instanceId && instances[i].status) {
              actualStatus = instances[i].status;
              break;
            }
          }
          if (actualStatus !== 'draft') break;
        }
        this.instances.set(payload.instanceId, {
          instanceId: payload.instanceId,
          taskName: payload.taskName,
          status: actualStatus,
          logs: []
        });
        inst = this.instances.get(payload.instanceId);
      }
      // 处理日志内容，空字符串也标记已加载，避免循环请求
      if (inst && payload.logContent !== undefined && payload.logContent !== null) {
        var lines = payload.logContent.split('\n');
        inst.logs = [];
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line) continue;
          // 解析格式: [ISO时间] [stream] [level] message
          var match = line.match(/^\[([^\]]*)\]\s*\[([^\]]*)\]\s*\[([^\]]*)\]\s*(.*)$/);
          if (match) {
            inst.logs.push({
              stream: match[2] || 'stdout',
              level: match[3] || 'info',
              message: match[4] || match[0],
              time: new Date(match[1]).getTime() || Date.now()
            });
          } else {
            inst.logs.push({ stream: 'stdout', level: 'info', message: line, time: Date.now() });
          }
        }
        inst._logsLoaded = true;
      }
      // 三列布局中更新右列
      if (this.currentTab === 'list' && this._selectedInstanceId === payload.instanceId) {
        var col = document.getElementById('taskResultCol');
        if (col) col.innerHTML = this._renderResultCol(payload.taskName, payload.instanceId);
      }
      // 旧版结果视图（监控标签进入）
      if (this._resultViewTaskName === payload.taskName) {
        this._showResultsView(payload.taskName, payload.instanceId);
      }
    },

    _requestInstanceLogs: function(taskName, instanceId) {
      var inst = this.instances.get(instanceId);
      if (inst && inst._logsLoaded) return;
      this._send({ type: 'task:get_instance_logs', payload: { taskName: taskName, instanceId: instanceId } });
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
        if (inst.status === 'running' || inst.status === 'pending' || inst.status === 'pending_forward' || inst.status === 'draft' || inst.status === 'created') count++;
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
        if (inst.status === 'running' || inst.status === 'pending' || inst.status === 'pending_forward' || inst.status === 'draft' || inst.status === 'created' || inst.status === 'display_offline') {
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

      var metricsHtml = '';
      if (inst.result && inst.result.metrics) {
        var m = inst.result.metrics;
        metricsHtml = '<div class="task-monitor-metrics">' +
          '<span title="首 Token 延迟">TTFT: ' + (m.ttft || '-') + 'ms</span>' +
          '<span title="生成速度">' + (m.tokensPerSecond || '-') + ' tok/s</span>' +
          '<span title="总 Token 数">' + (m.totalTokens || '-') + ' tokens</span>' +
          '<span title="总耗时">' + (m.totalDuration || '-') + 'ms</span>' +
          '</div>';
      }

      var streamOutput = '';
      if (inst._streamText) {
        streamOutput = '<div class="task-monitor-stream">' +
          '<div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:4px;padding:0 4px">输出</div>' +
          '<div style="background:rgba(0,0,0,0.3);border-radius:6px;padding:10px;font-size:13px;line-height:1.6;color:#e0e0e0;white-space:pre-wrap;word-break:break-word;margin-bottom:8px">' +
          this._escapeHtml(inst._streamText) + '</div></div>';
      }

      var safeId = this._escapeAttr(inst.instanceId);
      return '<div class="task-monitor-card" data-instance="' + safeId + '">' +
        '<div class="task-monitor-header">' +
          '<span class="task-monitor-name">' + this._escapeHtml(inst.taskName || '-') + '</span>' +
          '<span class="task-monitor-timer">' + (inst.status === 'pending' ? '排队中' : duration) + '</span>' +
        '</div>' +
        '<div class="task-monitor-stage">阶段: ' + this._escapeHtml(inst.stage || inst.status) + '</div>' +
        '<div class="task-monitor-target" title="' + this._escapeAttr(inst.instanceId || '-') + '">执行于: ' + this._escapeHtml(inst.target || '服务端') + (inst.displayId ? '(' + this._escapeHtml(inst.displayId) + ')' : '') + ' | ' + this._escapeHtml(inst.instanceId || '-') + '</div>' +
        progressBar +
        metricsHtml +
        streamOutput +
        '<div class="task-monitor-log">' +
          '<div class="task-monitor-log-header" onclick="this.nextElementSibling.classList.toggle(\'collapsed\')">实时日志 (' + logs.length + ' 行)</div>' +
          '<div class="task-monitor-log-content">' + (logHtml || '<div style="color:#555">等待日志...</div>') + '</div>' +
        '</div>' +
        '<div class="task-monitor-actions">' +
          (inst.status === 'running' || inst.status === 'display_offline' ? '<button class="task-card-btn danger" onclick="TaskPanel._stopInstance(\'' + safeId + '\')">停止</button>' : '') +
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
      this._showDevicePicker(function(deviceId, deviceType) {
        self._send({ type: 'task:stop', payload: { taskName: inst.taskName, instanceId: instanceId } });
        self._send({ type: 'task:submit', payload: {
          taskName: inst.taskName,
          taskType: 'user',
          target: deviceId ? (deviceType || 'display') : 'server',
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
      var listHtml = '<div class="task-device-item selected" data-id="" data-type="">' +
        '<div class="task-device-radio"></div><div class="task-device-info"><div class="task-device-name">服务端 (当前)</div></div>' +
      '</div>';
      for (var i = 0; i < this.displayList.length; i++) {
        var d = this.displayList[i];
        var safeId = this._escapeAttr(d.id);
        var deviceType = d.isSubDisplay ? 'subdisplay' : 'display';
        listHtml += '<div class="task-device-item" data-id="' + safeId + '" data-type="' + deviceType + '">' +
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
        var type = selected ? selected.dataset.type : '';
        document.body.removeChild(overlay);
        callback(id, type);
      };
    },

    // ---- Edit ----

    _viewEdit: function(taskName) {
      var task = null;
      for (var i = 0; i < this.taskList.length; i++) {
        if (this.taskList[i].taskName === taskName) { task = this.taskList[i]; break; }
      }
      if (!task) return;
      // 切换到新建任务页签显示编辑视图
      var newTab = document.querySelector('[data-tab="new"]');
      if (newTab) newTab.click();
      this._showEditView(task);
    },

    _showEditView: function(task) {
      var container = document.getElementById('taskTabNew');
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
          '<div class="task-form-row">' +
            '<div class="task-form-field">' +
              '<label>执行目标</label>' +
              '<div class="task-btn-group" id="editTargetGroup">' +
                '<button class="task-btn-option active" data-value="server">服务端</button>' +
                '<button class="task-btn-option" data-value="display">显示端</button>' +
                '<button class="task-btn-option" data-value="subdisplay">子显示端</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="task-form-row">' +
            '<div class="task-form-field">' +
              '<label>执行环境</label>' +
              '<div class="task-btn-group" id="editEnvGroup">' +
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
              '<div class="task-btn-group" id="editModeGroup">' +
                '<button class="task-btn-option active" data-value="one-shot">一次性</button>' +
                '<button class="task-btn-option" data-value="service">服务</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="task-form-field" style="margin-top:8px">' +
            '<label>参数 (JSON)</label>' +
            '<textarea id="editParams" rows="2"></textarea>' +
          '</div>' +
        '</div>' +

        '<div class="task-form-section" id="editDeviceSelectorSection" style="display:none">' +
          '<div class="task-form-section-title">目标设备</div>' +
          '<div class="task-device-list" id="editDeviceSelectorList"></div>' +
        '</div>' +

        '<div style="display:flex;gap:8px">' +
          '<button class="task-submit-btn" onclick="TaskPanel._runEditTask(\'' + safeTaskName + '\')" style="flex:1;background:linear-gradient(135deg,#00d2ff,#0088cc)">运行</button>' +
          '<button class="task-submit-btn" onclick="TaskPanel._saveEdit(\'' + safeTaskName + '\')" style="flex:1;background:linear-gradient(135deg,#22c55e,#16a34a)">保存修改</button>' +
        '</div>';

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

      // 编辑视图目标切换，显示/隐藏设备选择器
      var editTargetGroup = document.getElementById('editTargetGroup');
      if (editTargetGroup) {
        editTargetGroup.addEventListener('click', function(e) {
          var btn = e.target.closest('.task-btn-option');
          if (!btn) return;
          editTargetGroup.querySelectorAll('.task-btn-option').forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
          var showDevice = btn.dataset.value === 'display' || btn.dataset.value === 'subdisplay';
          var ds = document.getElementById('editDeviceSelectorSection');
          if (ds) ds.style.display = showDevice ? 'block' : 'none';
        });
      }

      // 编辑视图模式切换
      function bindEditBtnGroup(id) {
        var group = document.getElementById(id);
        if (!group) return;
        group.addEventListener('click', function(e) {
          var btn = e.target.closest('.task-btn-option');
          if (!btn) return;
          e.stopPropagation();
          group.querySelectorAll('.task-btn-option').forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
        });
      }
      bindEditBtnGroup('editModeGroup');
      bindEditBtnGroup('editEnvGroup');

      // 自动填充最后一次执行的参数
      if (task.instances && task.instances.length > 0) {
        var lastParams = task.instances[0].params;
        if (lastParams && typeof lastParams === 'object' && Object.keys(lastParams).length > 0) {
          var paramsEl = document.getElementById('editParams');
          if (paramsEl) paramsEl.value = JSON.stringify(lastParams, null, 2);
        }
      }

      // 根据 task 元数据预选 target/env/mode
      function setActive(containerId, value) {
        var group = document.getElementById(containerId);
        if (!group) return;
        group.querySelectorAll('.task-btn-option').forEach(function(b) {
          b.classList.toggle('active', b.dataset.value === value);
        });
      }
      setActive('editTargetGroup', task.target || 'server');
      setActive('editEnvGroup', task.env || 'auto');
      setActive('editModeGroup', task.mode || 'one-shot');

      // 根据 target 显示/隐藏设备选择器
      var targetVal = task.target || 'server';
      var showDevice = targetVal === 'display' || targetVal === 'subdisplay';
      var ds = document.getElementById('editDeviceSelectorSection');
      if (ds) ds.style.display = showDevice ? 'block' : 'none';

      this._renderEditDeviceSelector();
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

    _confirmDeleteInstance: function(taskName, instanceId) {
      var overlay = document.createElement('div');
      overlay.className = 'task-confirm-overlay';
      overlay.innerHTML =
        '<div class="task-confirm-box">' +
          '<div class="task-confirm-msg">确定要删除此执行记录吗？<br><span style="font-size:12px;color:#888">#' + this._escapeHtml(instanceId.substring(0, 8)) + '</span></div>' +
          '<div class="task-confirm-actions">' +
            '<button class="task-confirm-btn cancel" id="diCancel">取消</button>' +
            '<button class="task-confirm-btn confirm" id="diConfirm">删除</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      document.getElementById('diCancel').onclick = function() { document.body.removeChild(overlay); };
      document.getElementById('diConfirm').onclick = function() {
        document.body.removeChild(overlay);
        TaskPanel._send({ type: 'task:delete_instance', payload: { taskName: taskName, instanceId: instanceId } });
      };
    },

    _clearInstanceLogs: function(taskName, instanceId) {
      this._send({ type: 'task:clear_instance_logs', payload: { taskName: taskName, instanceId: instanceId } });
    },

    _updateInstanceStatus: function(payload) {
      if (!payload || !payload.instanceId) return;
      var inst = this.instances.get(payload.instanceId);
      if (inst && payload.status) inst.status = payload.status;
      // 同步更新 taskList 中对应实例的状态
      for (var t = 0; t < this.taskList.length; t++) {
        var instances = this.taskList[t].instances || [];
        for (var i = 0; i < instances.length; i++) {
          if (instances[i].instanceId === payload.instanceId) {
            if (payload.status) instances[i].status = payload.status;
            break;
          }
        }
      }
      // 立即刷新详情卡片
      if (this._selectedTaskName && this._selectedInstanceId === payload.instanceId) {
        var col = document.getElementById('taskResultCol');
        if (col) col.innerHTML = this._renderResultCol(this._selectedTaskName, this._selectedInstanceId);
      }
    },

    _runCreatedInstance: function(taskName, instanceId) {
      this._send({ type: 'task:run', payload: { taskName: taskName, instanceId: instanceId } });
    },

    _resumeService: function(taskName, instanceId) {
      this._pendingRunAfterRerun = { taskName: taskName, instanceId: instanceId };
      this._send({ type: 'task:rerun', payload: { taskName: taskName, instanceId: instanceId } });
    },

    _rerunInstance: function(taskName, instanceId) {
      this._send({ type: 'task:rerun', payload: { taskName: taskName, instanceId: instanceId } });
    },

    _linkInstance: function(sourceTaskName, sourceInstanceId) {
      var self = this;
      var overlay = document.createElement('div');
      overlay.className = 'task-confirm-overlay';

      // 收集所有其他任务的 running 实例作为候选目标
      var targetOptions = '';
      for (var i = 0; i < this.taskList.length; i++) {
        var t = this.taskList[i];
        var instances = t.instances || [];
        for (var j = 0; j < instances.length; j++) {
          var inst = instances[j];
          if (inst.status === 'running' && inst.instanceId !== sourceInstanceId) {
            targetOptions += '<div class="task-link-item" data-taskname="' + this._escapeAttr(t.taskName) +
              '" data-instanceid="' + this._escapeAttr(inst.instanceId) + '">' +
              '<span class="task-link-item-name">' + this._escapeHtml(t.name || t.taskName) + '</span>' +
              '<span class="task-link-item-id">#' + this._escapeHtml(inst.instanceId.substring(0, 8)) + '</span>' +
              '<button class="task-link-select-btn">选择</button></div>';
          }
        }
      }

      if (!targetOptions) {
        targetOptions = '<div style="padding:20px;text-align:center;color:#666">没有其他运行中的实例可供链接</div>';
      }

      overlay.innerHTML =
        '<div class="task-confirm-box" style="max-width:420px">' +
          '<div class="task-confirm-title">选择目标实例</div>' +
          '<div class="task-confirm-msg">将 <strong>' + this._escapeHtml(sourceInstanceId.substring(0, 12)) + '</strong> 的输出链接到：</div>' +
          '<div class="task-link-list">' + targetOptions + '</div>' +
          '<div class="task-confirm-actions" style="margin-top:12px">' +
            '<button class="task-confirm-btn cancel" id="tlCancel">取消</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);

      document.getElementById('tlCancel').onclick = function() { document.body.removeChild(overlay); };

      // 点击选择按钮时执行链接
      overlay.querySelectorAll('.task-link-select-btn').forEach(function(btn) {
        btn.onclick = function() {
          var item = this.closest('.task-link-item');
          var targetTaskName = item.dataset.taskname;
          var targetInstanceId = item.dataset.instanceid;
          self._send({
            type: 'task:link',
            payload: {
              sourceInstance: sourceInstanceId,
              targetTask: targetTaskName,
              targetInstance: targetInstanceId
            }
          });
          document.body.removeChild(overlay);
        };
      });
    },

    _editInstanceParams: function(taskName, instanceId) {
      var self = this;
      var task = null;
      for (var i = 0; i < this.taskList.length; i++) {
        if (this.taskList[i].taskName === taskName) { task = this.taskList[i]; break; }
      }
      var taskParams = task ? task.params || [] : [];
      if (taskParams.length === 0) return;

      // 获取实例当前 params
      var instances = task.instances || [];
      var inst = null;
      for (var i = 0; i < instances.length; i++) {
        if (instances[i].instanceId === instanceId) { inst = instances[i]; break; }
      }
      var currentParams = (inst && inst.params) || {};

      // 构建表单
      var fieldsHtml = '';
      for (var p = 0; p < taskParams.length; p++) {
        var param = taskParams[p];
        var val = currentParams[param.name] !== undefined ? currentParams[param.name] : param.default;
        var label = self._escapeHtml(param.label || param.name);

        if (param.type === 'number') {
          fieldsHtml += '<div style="margin-bottom:10px"><label style="font-size:12px;color:rgba(255,255,255,0.6);display:block;margin-bottom:4px">' + label + '</label>' +
            '<input type="number" id="eip-' + param.name + '" value="' + (val !== undefined ? val : '') + '"' +
            (param.min !== undefined ? ' min="' + param.min + '"' : '') +
            (param.max !== undefined ? ' max="' + param.max + '"' : '') +
            (param.step !== undefined ? ' step="' + param.step + '"' : '') +
            ' style="width:100%;padding:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;font-size:13px;box-sizing:border-box"></div>';
        } else {
          fieldsHtml += '<div style="margin-bottom:10px"><label style="font-size:12px;color:rgba(255,255,255,0.6);display:block;margin-bottom:4px">' + label + '</label>' +
            '<input type="text" id="eip-' + param.name + '" value="' + self._escapeAttr(String(val !== undefined ? val : '')) + '"' +
            ' style="width:100%;padding:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;font-size:13px;box-sizing:border-box"></div>';
        }
      }

      var overlay = document.createElement('div');
      overlay.className = 'task-confirm-overlay';
      overlay.innerHTML =
        '<div class="task-confirm-box" style="max-width:420px">' +
          '<div class="task-confirm-title">编辑实例参数 - ' + self._escapeHtml(instanceId.substring(0, 8)) + '</div>' +
          '<div style="margin:12px 0;max-height:400px;overflow-y:auto">' + fieldsHtml + '</div>' +
          '<div class="task-confirm-actions">' +
            '<button class="task-confirm-btn cancel" id="eipCancel">取消</button>' +
            '<button class="task-confirm-btn confirm" id="eipSave" style="background:rgba(0,210,255,0.15);color:#8cf">保存</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);

      document.getElementById('eipCancel').onclick = function() { document.body.removeChild(overlay); };
      document.getElementById('eipSave').onclick = function() {
        var newParams = {};
        for (var p = 0; p < taskParams.length; p++) {
          var el = document.getElementById('eip-' + taskParams[p].name);
          if (!el) continue;
          if (taskParams[p].type === 'number') newParams[taskParams[p].name] = parseFloat(el.value) || 0;
          else newParams[taskParams[p].name] = el.value;
        }
        self._send({
          type: 'task:update_instance_params',
          payload: { taskName: taskName, instanceId: instanceId, params: newParams }
        });
        document.body.removeChild(overlay);
      };
    },

    _onInstanceDeleted: function(payload) {
      if (payload.success) {
        // 从内存中清除
        this.instances.delete(payload.instanceId);
        this._requestTaskList();
      }
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
          if (memInst.status != null) inst.status = memInst.status;
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
        var safeId = this._escapeAttr(inst.instanceId);
        return '<div class="task-result-history-item' + sel + '">' +
          '<div onclick="TaskPanel._selectResult(\'' + safeTaskName + '\',\'' + safeId + '\')" style="flex:1">' +
            '<span class="result-icon">' + icon + '</span> ' + time +
          '</div>' +
          '<button class="task-result-history-del" onclick="event.stopPropagation();TaskPanel._confirmDeleteInstance(\'' + safeTaskName + '\',\'' + safeId + '\')">✕</button>' +
        '</div>';
      }, this).join('');

      var detailHtml = selected ? this._resultDetailHTML(selected, taskName) : '<div class="task-empty-state"><div class="task-empty-state-text">暂无执行记录</div></div>';

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

      this._resultViewTaskName = taskName;
      if (selected && (!selected.logs || selected.logs.length === 0)) {
        var memInst = this.instances.get(selected.instanceId);
        if (!memInst || !memInst.logs || memInst.logs.length === 0) {
          this._requestInstanceLogs(taskName, selected.instanceId);
        }
      }
    },

    _selectResult: function(taskName, instanceId) {
      this._showResultsView(taskName, instanceId);
    },

    _resultDetailHTML: function(inst, taskName) {
      var statusText = inst.status === 'completed' ? '完成' : inst.status === 'failed' ? '失败' : inst.status === 'stopped' ? '已停止' : inst.status === 'draft' || inst.status === 'created' ? '草稿' : inst.status === 'display_offline' ? '进行中(offline)' : '进行中';
      var taskParams = null;
      for (var i = 0; i < this.taskList.length; i++) {
        if (this.taskList[i].taskName === taskName) { taskParams = this.taskList[i].params || []; break; }
      }
      var instSafeTaskName = this._escapeAttr(taskName);
      var instSafeId = this._escapeAttr(inst.instanceId);

      var widgetDef = this._getWidgetDef(taskName);
      if (widgetDef) {
        var wd = this._widgetData[inst.instanceId] || {};
        if (inst.params) {
          for (var k in inst.params) wd[k] = inst.params[k];
        }
        if (taskParams) {
          for (var p = 0; p < taskParams.length; p++) {
            if (wd[taskParams[p].name] === undefined && taskParams[p].default !== undefined)
              wd[taskParams[p].name] = taskParams[p].default;
          }
        }
        // 为 select 字段生成 _sel<Val> 选中标记（如 promptFormat=openai → _selOpenai=selected）
        var selectFields = ['promptFormat'];
        for (var s = 0; s < selectFields.length; s++) {
          var v = wd[selectFields[s]];
          if (v && typeof v === 'string') {
            wd['_sel' + v.charAt(0).toUpperCase() + v.slice(1)] = 'selected';
          }
        }
        this._widgetData[inst.instanceId] = wd;
      }
      var widgetHtml = widgetDef ? this._renderWidget(widgetDef, inst.instanceId, taskName, inst.status) : '';

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

      var outputText = '';
      if (result.data && result.data.text) {
        outputText = '<div class="task-result-text">' +
          '<div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:4px">输出</div>' +
          '<div style="background:rgba(0,0,0,0.3);border-radius:6px;padding:12px;font-size:13px;line-height:1.6;color:#e0e0e0;white-space:pre-wrap;word-break:break-word;margin-bottom:8px">' +
          this._escapeHtml(result.data.text) + '</div></div>';
      }

      return (widgetHtml || '') +
      '<div class="task-result-meta">' +
        '<div class="task-result-meta-item">状态: <strong>' + statusText + '</strong></div>' +
        '<div class="task-result-meta-item">耗时: <strong>' + duration + '</strong></div>' +
        '<div class="task-result-meta-item">实例: <strong style="font-family:monospace" title="' + this._escapeAttr(inst.instanceId || '') + '">#' + this._escapeHtml(inst.instanceId || '-') + '</strong></div>' +
        '<div class="task-result-meta-item">目标: <strong>' + this._escapeHtml(inst.target === 'display' ? '显示端' : inst.target === 'subdisplay' ? '子显示端' : inst.target || '服务端') + (inst.displayId ? '(' + this._escapeHtml(inst.displayId) + ')' : '') + '</strong></div>' +
        '<div class="task-result-meta-item">模式: <strong>' + this._escapeHtml(inst.mode === 'service' ? '服务' : '一次性') + '</strong></div>' +
        '<div class="task-result-meta-item">环境: <strong>' + this._escapeHtml(inst.env || '-') + '</strong></div>' +
      (inst.result && inst.result.metrics ? '<div class="task-result-metrics">' +
        '<div class="task-result-metrics-title">推理性能</div>' +
        '<div class="task-result-metrics-row">' +
          '<span>首 Token: <strong>' + (inst.result.metrics.ttft || '-') + 'ms</strong></span>' +
          '<span>速度: <strong>' + (inst.result.metrics.tokensPerSecond || '-') + ' tok/s</strong></span>' +
          '<span>总 Token: <strong>' + (inst.result.metrics.totalTokens || '-') + '</strong></span>' +
          '<span>耗时: <strong>' + (inst.result.metrics.totalDuration || '-') + 'ms</strong></span>' +
        '</div></div>' : '') +
      '</div>' +
      (result.error ? '<div style="color:#ef4444;font-size:13px;margin-bottom:12px">错误: ' + this._escapeHtml(result.error) + '</div>' : '') +
      (filesHtml ? '<div class="task-result-files"><div style="font-size:11px;color:#666;margin-bottom:4px">输出文件</div>' + filesHtml + '</div>' : '') +
      outputText +
      '<div class="task-result-log">' +
        '<div class="task-result-log-header" onclick="this.nextElementSibling.classList.toggle(\'collapsed\')">完整日志 (' + logs.length + ' 行)' +
          '<span class="task-clear-log" onclick="event.stopPropagation();TaskPanel._clearInstanceLogs(\'' + taskName + '\',\'' + inst.instanceId + '\')" style="float:right;font-size:11px;color:#ef4444;cursor:pointer;margin-left:8px">清空</span>' +
        '</div>' +
        '<div class="task-result-log-content">' + (logHtml || '<span style="color:#555">无日志</span>') + '</div>' +
      '</div>' +
      '<div style="margin-top:12px;display:flex;gap:8px">' +
        (inst.status === 'draft'
          ? '<button class="task-card-btn primary" onclick="TaskPanel._runCreatedInstance(\'' + taskName + '\',\'' + inst.instanceId + '\')">运行</button>'
          : inst.status === 'completed' || inst.status === 'failed' || inst.status === 'stopped' || inst.status === 'display_offline'
            ? '<button class="task-card-btn primary" onclick="TaskPanel._rerunInstance(\'' + taskName + '\',\'' + inst.instanceId + '\')">重新运行</button>'
            : '') +
        (inst.status !== 'running' && taskParams && taskParams.length > 0
          ? '<button class="task-card-btn" onclick="TaskPanel._editInstanceParams(\'' + instSafeTaskName + '\',\'' + instSafeId + '\')">编辑参数</button>'
          : '') +
        (inst.status === 'running' || inst.status === 'pending_forward' || inst.status === 'display_offline'
          ? '<button class="task-card-btn danger" onclick="TaskPanel._stopInstance(\'' + instSafeId + '\')">停止</button>' +
            (inst.status === 'running'
              ? '<button class="task-card-btn" onclick="TaskPanel._linkInstance(\'' + taskName + '\',\'' + inst.instanceId + '\')">链接到...</button>'
              : '')
          : '') +
        '<button class="task-card-btn danger" onclick="TaskPanel._confirmDeleteInstance(\'' + taskName + '\',\'' + inst.instanceId + '\')">删除此执行记录</button>' +
      '</div>';
    },

    _getWidgetDef: function(taskName) {
      for (var i = 0; i < this.taskList.length; i++) {
        if (this.taskList[i].taskName === taskName) return this.taskList[i].widget || null;
      }
      return null;
    },

    _onWidgetUpdate: function(payload) {
      this._widgetData[payload.instanceId] = payload.data;
      var ctrl = this._widgetControllers[payload.instanceId];
      if (ctrl && ctrl.onUpdate) {
        ctrl.onUpdate(payload.data);
        return;
      }
      var widgetEl = document.getElementById('task-widget-' + payload.instanceId);
      if (widgetEl) {
        var taskName = payload.taskName;
        var task = null;
        for (var i = 0; i < this.taskList.length; i++) {
          if (this.taskList[i].taskName === taskName) { task = this.taskList[i]; break; }
        }
        var wd = task && task.widget;
        if (wd && wd.html) {
          var html = wd.html;
          html = html.replace(/\{\{instanceId\}\}/g, payload.instanceId);
          html = html.replace(/\{\{(\w+)\}\}/g, function(match, key) {
            var val = payload.data[key] !== undefined ? payload.data[key] : '--';
            return typeof val === 'string' ? val : JSON.stringify(val);
          });
          widgetEl.innerHTML = html;
        }
      }
    },

    _renderWidget: function(widgetDef, instanceId, taskName, status) {
      if (!widgetDef) return '';
      var data = this._widgetData[instanceId] || {};
      var self = this;

      if (widgetDef.html) {
        var html = widgetDef.html;
        html = html.replace(/\{\{instanceId\}\}/g, instanceId);
        html = html.replace(/\{\{taskName\}\}/g, taskName || '');
        html = html.replace(/\{\{(\w+)\}\}/g, function(match, key) {
          var val = data[key] !== undefined ? data[key] : '--';
          return typeof val === 'string' ? val : JSON.stringify(val);
        });
        var containerId = 'task-widget-' + instanceId;
        var saveBtn = (status === 'draft')
          ? '<button class="task-card-btn primary task-widget-save" onclick="TaskPanel._saveWidgetParams(\'' + instanceId + '\',\'' + (taskName || '') + '\')" style="margin-top:8px;width:100%">保存参数</button>'
          : '';
        var result = '<div id="' + containerId + '" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px;margin-bottom:12px">' + html + saveBtn + '</div>';

        if (widgetDef.script) {
          setTimeout(function() {
            self._initWidgetController(widgetDef.script, instanceId, containerId, taskName);
          }, 0);
        }

        return result;
      }

      if (widgetDef.fields) {
        fieldsHtml = widgetDef.fields.map(function(f) {
          var val = data[f.name] !== undefined ? data[f.name] : f.default;
          var label = '<div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:2px">' + this._escapeHtml(f.label || f.name) + '</div>';
          if (f.type === 'toggle') {
            var checked = val ? 'checked' : '';
            return '<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;padding:4px 0">' +
              '<input type="checkbox" ' + checked + ' disabled style="accent-color:#4f9cf7">' +
              this._escapeHtml(f.label || f.name) + '</label>';
          } else if (f.type === 'select') {
            var opts = (f.options || []).map(function(o) {
              var sel = val == o ? 'selected' : '';
              return '<option value="' + o + '" ' + sel + '>' + o + '</option>';
            }).join('');
            return '<div style="margin-bottom:8px">' + label +
              '<select class="task-widget-field" data-field="' + f.name + '" style="width:100%;padding:6px 8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;font-size:13px">' + opts + '</select></div>';
          } else if (f.type === 'number') {
            return '<div style="margin-bottom:8px">' + label +
              '<input type="number" class="task-widget-field" data-field="' + f.name +
              '" value="' + (val !== undefined ? val : '') + '"' +
              (f.min !== undefined ? ' min="' + f.min + '"' : '') +
              (f.max !== undefined ? ' max="' + f.max + '"' : '') +
              ' style="width:100%;padding:6px 8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;font-size:13px;box-sizing:border-box"></div>';
          }
          return '';
        }, this).join('');
      }

      var displaysHtml = '';
      if (widgetDef.displays) {
        displaysHtml = widgetDef.displays.map(function(d) {
          var val = data[d.id] !== undefined ? data[d.id] : '--';
          return '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;border-bottom:1px solid rgba(255,255,255,0.06)">' +
            '<span style="color:rgba(255,255,255,0.5)">' + this._escapeHtml(d.label || d.id) + '</span>' +
            '<span style="color:#4f9cf7;font-weight:500">' + this._escapeHtml(String(val)) + '</span></div>';
        }, this).join('');
      }

      var actionsHtml = '';
      if (widgetDef.actions) {
        actionsHtml = '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">' +
          widgetDef.actions.map(function(a) {
            return '<button class="task-card-btn" onclick="TaskPanel._onWidgetAction(\'' +
              instanceId + '\',\'' + a.id + '\')">' +
              this._escapeHtml(a.label || a.id) + '</button>';
          }, this).join('') +
          '<button class="task-card-btn primary" onclick="TaskPanel._onWidgetSaveConfig(\'' +
            instanceId + '\')">保存配置</button>' +
        '</div>';
      }

      return '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px;margin-bottom:12px">' +
        (fieldsHtml ? '<div style="margin-bottom:12px">' + fieldsHtml + '</div>' : '') +
        (displaysHtml ? '<div style="margin-bottom:12px">' + displaysHtml + '</div>' : '') +
        (actionsHtml || '') +
      '</div>';
    },

    _saveWidgetParams: function(instanceId, taskName) {
      var container = document.getElementById('task-widget-' + instanceId);
      if (!container) return;
      var fields = container.querySelectorAll('.task-widget-field');
      var params = {};
      for (var i = 0; i < fields.length; i++) {
        var el = fields[i];
        var name = el.getAttribute('data-field');
        if (!name) continue;
        if (el.type === 'number') params[name] = parseFloat(el.value) || 0;
        else if (el.type === 'checkbox') params[name] = el.checked;
        else params[name] = el.value;
      }
      this._send({ type: 'task:update_instance_params', payload: { taskName: taskName, instanceId: instanceId, params: params } });
      // 乐观更新本地数据，立即刷新 widget
      var memInst = this.instances.get(instanceId);
      if (memInst) memInst.params = params;
      for (var t = 0; t < this.taskList.length; t++) {
        if (this.taskList[t].taskName === taskName) {
          var insts = this.taskList[t].instances || [];
          for (var i = 0; i < insts.length; i++) {
            if (insts[i].instanceId === instanceId) { insts[i].params = params; break; }
          }
          break;
        }
      }
      var col = document.getElementById('taskResultCol');
      if (col) col.innerHTML = this._renderResultCol(this._selectedTaskName, this._selectedInstanceId);
    },

    _onWidgetAction: function(instanceId, action) {
      this._send({ type: 'task:widget_action', payload: { instanceId: instanceId, action: action } });
    },

    _onWidgetSaveConfig: function(instanceId, containerId) {
      // 优先使用调用方指定的容器（独立侧边栏面板），否则按 instanceId 查找任务面板容器，
      // 再回退到 sidebar-widget-{taskName}（无活跃实例时 instanceId 即 taskName）
      var container = containerId ? document.getElementById(containerId) : null;
      if (!container) container = document.getElementById('task-widget-' + instanceId);
      if (!container) {
        var inst = this.instances.get(instanceId);
        var taskName = inst && inst.taskName;
        if (taskName) container = document.getElementById('sidebar-widget-' + taskName);
      }
      if (!container) return;
      var els = container.querySelectorAll('.task-widget-field');
      var params = {};
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var name = el.getAttribute('data-field');
        if (!name) continue;
        if (el.type === 'checkbox') params[name] = el.checked;
        else if (el.type === 'number') params[name] = parseInt(el.value) || 0;
        else params[name] = parseInt(el.value);
      }
      this._send({ type: 'task:widget_action', payload: { instanceId: instanceId, action: 'updateConfig', params: params } });
    },

    _initWidgetController: function(scriptStr, instanceId, containerId, taskName) {
      var oldCtrl = this._widgetControllers[instanceId];
      if (oldCtrl && oldCtrl.onDestroy) try { oldCtrl.onDestroy(); } catch(e) {}
      if (oldCtrl && oldCtrl._timer) clearInterval(oldCtrl._timer);

      var container = document.getElementById(containerId);
      if (!container) return;

      var self = this;
      var api = {
        taskName: taskName || '',
        instanceId: instanceId || '',
        getContainer: function() { return container; },
        getData: function() { return self._widgetData[instanceId] || {}; },
        sendAction: function(action, params) {
          self._send({ type: 'task:widget_action', payload: { instanceId: instanceId, action: action, params: params || {} } });
        },
        submitTask: function(taskName, params) {
          self._send({
            type: 'task:submit',
            payload: {
              taskName: taskName,
              taskType: 'builtin',
              builtinId: taskName,
              target: 'server',
              mode: 'one-shot',
              env: 'auto',
              params: params || {},
              files: []
            }
          });
        },
        saveInstanceParams: function(taskName, instanceId, params) {
          self._send({ type: 'task:update_instance_params', payload: { taskName: taskName, instanceId: instanceId, params: params || {} } });
        },
        _onUpdate: null,
        _onDestroy: null,
        _timer: null,
        onUpdate: function(fn) { this._onUpdate = fn; },
        onDestroy: function(fn) { this._onDestroy = fn; },
        setInterval: function(fn, ms) { this._timer = setInterval(fn, ms); }
      };

      try {
        (new Function('api', scriptStr))(api);
      } catch (e) {
        // console.error('[TaskPanel] widget script error:', e);
      }

      this._widgetControllers[instanceId] = {
        onUpdate: api._onUpdate ? function(data) { api._onUpdate(data); } : null,
        onDestroy: api._onDestroy ? function() { try { api._onDestroy(); } catch(e) {} } : null,
        _timer: api._timer
      };

      if (api._onUpdate) {
        try { api._onUpdate(self._widgetData[instanceId] || {}); } catch(e) { /* console.error('[TaskPanel] widget init update error:', e); */ }
      }
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
      if (view === 'list') {
        var listTab = document.querySelector('[data-tab="list"]');
        if (listTab) listTab.click();
      }
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
