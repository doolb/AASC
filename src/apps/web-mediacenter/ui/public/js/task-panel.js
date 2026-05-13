(function() {
  'use strict';

  const TaskPanel = {
    instances: new Map(),
    currentInstanceId: null,
    initDone: false,

    init() {
      if (this.initDone) return;
      this.initDone = true;
      this._render();
      this._setupWS();
    },

    _render() {
      const panel = document.getElementById('panel-task');
      if (!panel) return;
      panel.innerHTML = `
        <h1 class="page-title">远程任务</h1>
        <div class="section">
          <div class="form-row">
            <label>任务类型:</label>
            <select id="taskType">
              <option value="user">用户代码</option>
              <option value="builtin">内置功能</option>
            </select>
            <label>执行目标:</label>
            <select id="taskTarget">
              <option value="server">服务端</option>
              <option value="display">显示端</option>
              <option value="subdisplay">子显示端</option>
            </select>
            <label>执行环境:</label>
            <select id="taskEnv">
              <option value="auto">自适应</option>
              <option value="cpu">CPU</option>
              <option value="webgl">WebGL</option>
              <option value="webgpu">WebGPU</option>
            </select>
            <label>模式:</label>
            <select id="taskMode">
              <option value="one-shot">一次性</option>
              <option value="resident">常驻</option>
            </select>
          </div>
          <div class="form-row">
            <label>任务名称:</label>
            <input type="text" id="taskName" placeholder="my-task" value="task-" style="flex:1">
          </div>
          <div class="form-row">
            <label>入口文件:</label>
            <input type="text" id="entryFile" placeholder="task.js" style="flex:1">
          </div>
          <div class="form-row">
            <label>执行文件 / 输入文件:</label>
            <input type="file" id="taskFiles" multiple style="flex:1">
          </div>
          <div id="taskFileList" class="file-list" style="margin:8px 0;font-size:13px;color:#888"></div>
          <div class="form-row">
            <label>参数 (JSON):</label>
            <textarea id="taskParams" rows="3" placeholder='{"width": 800}' style="flex:1"></textarea>
          </div>
          <div class="form-row">
            <label>目标设备 ID:</label>
            <input type="text" id="displayId" placeholder="留空自动选择" style="flex:1">
          </div>
          <button id="taskSubmitBtn" style="padding:8px 24px;margin-top:8px;cursor:pointer">提交任务</button>
        </div>
        <div class="section" id="taskLogSection" style="display:none">
          <h2>实时日志</h2>
          <pre id="taskLog" style="height:200px;overflow:auto;background:#1a1a2e;color:#e0e0e0;padding:8px;border-radius:4px;font-size:12px"></pre>
        </div>
        <div class="section">
          <h2>任务实例列表</h2>
          <div id="taskInstanceList"><div class="empty-list">暂无任务实例</div></div>
        </div>
      `;

      document.getElementById('taskType').addEventListener('change', (e) => {
        document.getElementById('entryFile').disabled = e.target.value === 'builtin';
      });

      document.getElementById('taskFiles').addEventListener('change', (e) => {
        const list = document.getElementById('taskFileList');
        list.innerHTML = '';
        for (const f of e.target.files) {
          const div = document.createElement('div');
          div.textContent = '  ' + f.name + ' (' + (f.size / 1024).toFixed(1) + 'KB)';
          list.appendChild(div);
        }
      });

      document.getElementById('taskSubmitBtn').addEventListener('click', () => this._submit());
    },

    _setupWS() {
      const ws = window.WebSocketManager;
      if (!ws) { setTimeout(() => this._setupWS(), 500); return; }
      const orig = ws.handleMessage;
      ws.handleMessage = (data) => {
        this._onWSMessage(data);
        if (orig) orig.call(ws, data);
      };
    },

    _onWSMessage(data) {
      const p = data.payload || {};
      switch (data.type) {
        case 'task:submitted':
          this._addInstance(p);
          this._log('任务已提交: ' + p.taskName + ' (#' + p.instanceId + ')');
          break;
        case 'task:progress':
          this._updateProgress(p);
          break;
        case 'task:log':
          this._log('[' + p.stream + '] ' + p.message, p);
          break;
        case 'task:result':
          this._onResult(p);
          break;
        case 'task:error':
          this._log('[错误] ' + p.error, { stream: 'stderr' });
          break;
        case 'task:stopped':
          this._log('[系统] 实例已停止');
          this._updateInstance(p.instanceId, { status: 'stopped' });
          break;
      }
    },

    _addInstance(p) {
      this.instances.set(p.instanceId, { ...p, status: 'running', stage: 'submitted', timestamp: Date.now() });
      this._refreshList();
    },

    _updateProgress(p) {
      const inst = this.instances.get(p.instanceId);
      if (inst) { inst.stage = p.stage; inst.progress = p.progress; this._refreshList(); }
    },

    _updateInstance(id, data) {
      const inst = this.instances.get(id);
      if (inst) { Object.assign(inst, data); this._refreshList(); }
    },

    _onResult(p) {
      const inst = this.instances.get(p.instanceId);
      if (inst) {
        inst.status = p.success ? 'completed' : 'failed';
        inst.result = p;
        this._refreshList();
      }
      if (p.success) {
        this._log('执行成功');
        if (p.outputFiles && p.outputFiles.length > 0) {
          this._log('输出: ' + p.outputFiles.map(function(f) { return f.url || f.name; }).join(', '));
        }
      } else {
        this._log('执行失败: ' + (p.error || '未知错误'));
      }
    },

    _log(message, meta) {
      const el = document.getElementById('taskLog');
      if (!el) return;
      var logSection = document.getElementById('taskLogSection');
      if (logSection) logSection.style.display = 'block';
      var time = new Date().toLocaleTimeString();
      var line = document.createElement('div');
      line.textContent = '[' + time + '] ' + message;
      if (meta && meta.stream === 'stderr') line.style.color = '#ff6b6b';
      else if (meta && meta.stream === 'system') line.style.color = '#69db7c';
      el.appendChild(line);
      el.scrollTop = el.scrollHeight;
    },

    _refreshList() {
      var container = document.getElementById('taskInstanceList');
      if (!container) return;
      var items = Array.from(this.instances.entries())
        .sort(function(a, b) { return b[1].timestamp - a[1].timestamp; })
        .slice(0, 20);
      if (items.length === 0) {
        container.innerHTML = '<div class="empty-list">暂无任务实例</div>';
        return;
      }
      var icons = { running: '🟢', completed: '✅', failed: '❌', stopped: '⏹', pending: '⏳' };
      container.innerHTML = items.map(function(item) {
        var id = item[0], inst = item[1];
        var icon = icons[inst.status] || '❓';
        return '<div class="task-instance" style="padding:6px;border-bottom:1px solid #333;cursor:pointer;display:flex;gap:12px;align-items:center">' +
          '<span>' + icon + '</span>' +
          '<span>' + (inst.taskName || '-') + '</span>' +
          '<span style="color:#888;font-size:12px">#' + id.substring(0,8) + '</span>' +
          '<span>' + (inst.stage || inst.status) + '</span>' +
          '<span>' + (inst.progress != null ? inst.progress + '%' : '') + '</span>' +
          '</div>';
      }).join('');
    },

    _submit() {
      var taskName = document.getElementById('taskName').value.trim();
      if (!taskName) { alert('请输入任务名称'); return; }

      var fileInput = document.getElementById('taskFiles');
      var files = [];
      var pending = fileInput.files.length;
      if (pending === 0) { this._doSubmit(taskName, files); return; }

      for (var i = 0; i < fileInput.files.length; i++) {
        (function(file) {
          var reader = new FileReader();
          reader.onload = function() {
            files.push({ name: file.name, data: reader.result.split(',')[1] });
            pending--;
            if (pending === 0) TaskPanel._doSubmit(taskName, files);
          };
          reader.readAsDataURL(file);
        })(fileInput.files[i]);
      }
    },

    _doSubmit(taskName, files) {
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

      var el = document.getElementById('taskLog');
      if (el) { el.innerHTML = ''; }

      this._log('提交任务: ' + taskName);
      var ws = window.WebSocketManager;
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        ws.ws.send(JSON.stringify(msg));
      } else {
        this._log('WebSocket 未连接');
      }
    }
  };

  window.TaskPanel = TaskPanel;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(function() { TaskPanel.init(); }, 800); });
  } else {
    setTimeout(function() { TaskPanel.init(); }, 800);
  }
})();
