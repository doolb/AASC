(function() {
  'use strict';

  var TaskPanel = {
    instances: new Map(),
    initDone: false,

    init: function() {
      if (this.initDone) return;
      this.initDone = true;
      this._render();
      this._setupWS();
    },

    _render: function() {
      var panel = document.getElementById('panel-task');
      if (!panel) return;
      panel.innerHTML =
        '<h1 class="page-title">远程任务</h1>' +

        // ---- 提交表单 ----
        '<div class="section">' +
          '<div class="task-config-grid">' +
            // 任务名称
            '<div class="task-config-item task-config-full">' +
              '<label>任务名称</label>' +
              '<input type="text" id="taskName" placeholder="my-task">' +
            '</div>' +
            // 任务类型
            '<div class="task-config-item">' +
              '<label>任务类型</label>' +
              '<select id="taskType">' +
                '<option value="user">用户代码</option>' +
                '<option value="builtin">内置功能</option>' +
              '</select>' +
            '</div>' +
            // 执行目标
            '<div class="task-config-item">' +
              '<label>执行目标</label>' +
              '<select id="taskTarget">' +
                '<option value="server">服务端</option>' +
                '<option value="display">显示端</option>' +
                '<option value="subdisplay">子显示端</option>' +
              '</select>' +
            '</div>' +
            // 执行环境
            '<div class="task-config-item">' +
              '<label>执行环境</label>' +
              '<select id="taskEnv">' +
                '<option value="auto">自适应</option>' +
                '<option value="cpu">CPU</option>' +
                '<option value="webgl">WebGL</option>' +
                '<option value="webgpu">WebGPU</option>' +
              '</select>' +
            '</div>' +
            // 模式
            '<div class="task-config-item">' +
              '<label>模式</label>' +
              '<select id="taskMode">' +
                '<option value="one-shot">一次性</option>' +
                '<option value="resident">常驻</option>' +
              '</select>' +
            '</div>' +
          '</div>' +

          // 入口文件
          '<div class="task-config-item" style="margin-bottom:12px">' +
            '<label>入口文件</label>' +
            '<input type="text" id="entryFile" placeholder="task.js" value="task.js">' +
          '</div>' +

          // 文件拖拽区
          '<div class="task-file-zone" id="taskFileZone">' +
            '<div class="task-file-zone-icon">📂</div>' +
            '<div class="task-file-zone-text">点击选择或拖拽文件到此处</div>' +
            '<div class="task-file-zone-hint">执行文件 + 输入文件</div>' +
          '</div>' +
          '<input type="file" id="taskFiles" multiple style="display:none">' +
          '<div class="task-file-list" id="taskFileList"></div>' +

          // 内置任务参数区
          '<div class="builtin-params-area" id="builtinParamsArea">' +
            '<div class="task-config-item">' +
              '<label>内置功能</label>' +
              '<select id="builtinId"></select>' +
            '</div>' +
            '<div id="builtinParams"></div>' +
          '</div>' +

          // 参数
          '<div class="task-config-item" style="margin-top:12px">' +
            '<label>参数 (JSON)</label>' +
            '<textarea id="taskParams" rows="2" placeholder=\'{"width": 800}\'></textarea>' +
          '</div>' +

          // 目标设备
          '<div class="task-config-item" style="margin-top:12px">' +
            '<label>目标设备 ID <span style="color:#555;font-size:11px">(留空自动选择)</span></label>' +
            '<input type="text" id="displayId" placeholder="显示端或子显示端 ID">' +
          '</div>' +

          '<button class="task-submit-btn" id="taskSubmitBtn">⚡ 提交任务</button>' +
        '</div>' +

        // ---- 日志区域 ----
        '<div class="section" id="taskLogSection" style="display:none">' +
          '<div class="task-log-container">' +
            '<div class="task-log-header">' +
              '<span class="task-log-header-label">📋 实时日志</span>' +
              '<div class="task-log-header-actions">' +
                '<button onclick="TaskPanel._clearLog()">清空</button>' +
              '</div>' +
            '</div>' +
            '<div class="task-log-content" id="taskLog"></div>' +
          '</div>' +
        '</div>' +

        // ---- 实例列表 ----
        '<div class="section">' +
          '<h2>任务实例</h2>' +
          '<div id="taskInstanceList">' +
            '<div class="task-empty-state">' +
              '<div class="task-empty-state-icon">⚡</div>' +
              '<div class="task-empty-state-text">暂无任务实例</div>' +
            '</div>' +
          '</div>' +
        '</div>';

      this._bindEvents();
    },

    _bindEvents: function() {
      var self = this;

      // 任务类型切换
      document.getElementById('taskType').addEventListener('change', function(e) {
        document.getElementById('entryFile').disabled = e.target.value === 'builtin';
        document.getElementById('builtinParamsArea').style.display = e.target.value === 'builtin' ? 'block' : 'none';
        if (e.target.value === 'builtin') self._loadBuiltinTasks();
      });

      // 文件拖拽 / 点击
      var fileZone = document.getElementById('taskFileZone');
      var fileInput = document.getElementById('taskFiles');

      fileZone.addEventListener('click', function() { fileInput.click(); });

      fileZone.addEventListener('dragover', function(e) {
        e.preventDefault();
        fileZone.classList.add('dragover');
      });
      fileZone.addEventListener('dragleave', function() {
        fileZone.classList.remove('dragover');
      });
      fileZone.addEventListener('drop', function(e) {
        e.preventDefault();
        fileZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
          fileInput.files = e.dataTransfer.files;
          self._updateFileList();
        }
      });

      fileInput.addEventListener('change', function() { self._updateFileList(); });

      // 提交
      document.getElementById('taskSubmitBtn').addEventListener('click', function() { self._submit(); });
    },

    _updateFileList: function() {
      var files = document.getElementById('taskFiles').files;
      var list = document.getElementById('taskFileList');
      list.innerHTML = '';
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        var chip = document.createElement('span');
        chip.className = 'task-file-chip';
        chip.innerHTML = '📄 ' + f.name + ' <span style="color:#666">(' + (f.size / 1024).toFixed(1) + 'KB)</span>';
        list.appendChild(chip);
      }
    },

    _loadBuiltinTasks: function() {
      // 预留：后续可从服务端获取内置任务列表
      var sel = document.getElementById('builtinId');
      sel.innerHTML = '<option value="image.resize">图片缩放</option>';
    },

    _setupWS: function() {
      var self = this;
      var ws = window.WebSocketManager;
      if (!ws) { setTimeout(function() { self._setupWS(); }, 500); return; }
      var orig = ws.handleMessage;
      ws.handleMessage = function(data) {
        self._onWSMessage(data);
        if (orig) orig.call(ws, data);
      };
    },

    _onWSMessage: function(data) {
      var p = data.payload || {};
      switch (data.type) {
        case 'task:submitted':
          this._addInstance(p);
          this._pLog('系统', '任务已提交: ' + p.taskName + ' (#' + p.instanceId.substring(0,8) + ')');
          break;
        case 'task:progress':
          this._updateProgress(p);
          break;
        case 'task:log':
          this._pLog(p.stream, p.message, p);
          break;
        case 'task:result':
          this._onResult(p);
          break;
        case 'task:error':
          this._pLog('错误', p.error, { stream: 'stderr' });
          break;
        case 'task:stopped':
          this._pLog('系统', '实例已停止');
          this._updateInstance(p.instanceId, { status: 'stopped' });
          break;
      }
    },

    _addInstance: function(p) {
      this.instances.set(p.instanceId, { ...p, status: 'running', stage: 'submitted', timestamp: Date.now() });
      this._refreshList();
    },

    _updateProgress: function(p) {
      var inst = this.instances.get(p.instanceId);
      if (inst) { inst.stage = p.stage; inst.progress = p.progress; this._refreshList(); }
    },

    _updateInstance: function(id, data) {
      var inst = this.instances.get(id);
      if (inst) { for (var k in data) { inst[k] = data[k]; } this._refreshList(); }
    },

    _onResult: function(p) {
      var inst = this.instances.get(p.instanceId);
      if (inst) {
        inst.status = p.success ? 'completed' : 'failed';
        inst.result = p;
        this._refreshList();
      }
      if (p.success) {
        this._pLog('系统', '✅ 执行成功');
        if (p.outputFiles && p.outputFiles.length > 0) {
          this._pLog('系统', '输出: ' + p.outputFiles.map(function(f) { return f.url || f.name; }).join(', '));
        }
      } else {
        this._pLog('错误', '❌ ' + (p.error || '未知错误'), { stream: 'stderr' });
      }
    },

    _pLog: function(stream, message, meta) {
      var cont = document.getElementById('taskLog');
      if (!cont) return;
      var section = document.getElementById('taskLogSection');
      if (section) section.style.display = 'block';

      var time = new Date();
      var ts = ('0' + time.getHours()).slice(-2) + ':' +
               ('0' + time.getMinutes()).slice(-2) + ':' +
               ('0' + time.getSeconds()).slice(-2);

      var cls = 'task-log-line';
      if (stream === 'stderr') cls += ' task-log-stream-stderr';
      else if (stream === 'system') cls += ' task-log-stream-system';
      else cls += ' task-log-stream-stdout';

      var line = document.createElement('div');
      line.className = cls;
      line.innerHTML = '<span class="task-log-time">' + ts + '</span> ' + this._escapeHtml(message);

      cont.appendChild(line);
      cont.scrollTop = cont.scrollHeight;
    },

    _clearLog: function() {
      var cont = document.getElementById('taskLog');
      if (cont) cont.innerHTML = '';
      var section = document.getElementById('taskLogSection');
      if (section) section.style.display = 'none';
    },

    _refreshList: function() {
      var container = document.getElementById('taskInstanceList');
      if (!container) return;

      var items = Array.from(this.instances.entries())
        .sort(function(a, b) { return b[1].timestamp - a[1].timestamp; })
        .slice(0, 30);

      if (items.length === 0) {
        container.innerHTML =
          '<div class="task-empty-state">' +
            '<div class="task-empty-state-icon">⚡</div>' +
            '<div class="task-empty-state-text">暂无任务实例</div>' +
          '</div>';
        return;
      }

      var icons = {
        running: '🔄',
        completed: '✅',
        failed: '❌',
        stopped: '⏹',
        pending: '⏳',
        pending_forward: '📤'
      };

      container.innerHTML = items.map(function(item) {
        var id = item[0], inst = item[1];
        var icon = icons[inst.status] || '❓';
        var statusText = inst.stage || inst.status;
        var progressHtml = '';
        if (inst.progress != null && inst.status === 'running') {
          progressHtml = '<div class="task-progress-bar"><div class="task-progress-fill" style="width:' + inst.progress + '%"></div></div>';
        }
        return '<div class="task-instance-item ' + inst.status + '">' +
          '<div class="task-instance-left">' +
            '<span class="task-instance-icon">' + icon + '</span>' +
            '<div class="task-instance-info">' +
              '<div class="task-instance-name">' + (inst.taskName || '-') + '</div>' +
              '<div class="task-instance-id">#' + id.substring(0, 8) + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="task-instance-meta">' +
            progressHtml +
            '<span class="task-instance-status ' + inst.status + '">' + statusText + '</span>' +
          '</div>' +
        '</div>';
      }).join('');
    },

    _submit: function() {
      var self = this;
      var taskName = document.getElementById('taskName').value.trim();
      if (!taskName) { alert('请输入任务名称'); return; }

      var fileInput = document.getElementById('taskFiles');
      var files = [];
      var pending = fileInput.files.length;

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

      var msg = {
        type: 'task:submit',
        payload: {
          taskName: taskName,
          taskType: document.getElementById('taskType').value,
          entryFile: document.getElementById('entryFile').value.trim(),
          target: document.getElementById('taskTarget').value,
          displayId: document.getElementById('displayId').value.trim() || null,
          mode: document.getElementById('taskMode').value,
          env: document.getElementById('taskEnv').value,
          files: files,
          params: params
        }
      };

      this._clearLog();
      this._pLog('系统', '📤 提交任务: ' + taskName + ' (' + files.length + ' 个文件)');

      var ws = window.WebSocketManager;
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        ws.ws.send(JSON.stringify(msg));
      } else {
        this._pLog('错误', 'WebSocket 未连接', { stream: 'stderr' });
      }
    },

    _escapeHtml: function(text) {
      var div = document.createElement('div');
      div.appendChild(document.createTextNode(text));
      return div.innerHTML;
    }
  };

  window.TaskPanel = TaskPanel;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(function() { TaskPanel.init(); }, 800); });
  } else {
    setTimeout(function() { TaskPanel.init(); }, 800);
  }
})();
