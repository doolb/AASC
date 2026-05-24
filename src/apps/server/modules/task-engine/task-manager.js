const path = require('path');
const { EventEmitter } = require('events');
const crypto = require('crypto');
const TaskIO = require('./task-io');
const NodeJsRunner = require('./nodejs-runner');
const PuppeteerRunner = require('./puppeteer-runner');

let builtinRegistry = null;
try {
  builtinRegistry = require('./builtin-tasks/registry');
} catch (e) {
  /* 内置任务模块尚不存在 */
}

class TaskManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.taskIO = new TaskIO(options);
    this.nodeRunner = new NodeJsRunner();
    this.puppeteerRunner = new PuppeteerRunner();
    this.instances = new Map();
    this._services = new Map();  // instanceId -> { stop, status }
    this._sendToDisplay = null;  // 由 setSendToDisplay() 注入
    this._widgetActions = new Map();  // instanceId -> Map<action, handler>
    this._isRestoring = false;
    this.maxInstances = options.maxInstances || 50;
  }

  _generateId() {
    return crypto.randomBytes(4).toString('hex');
  }

  /**
   * 注入 sendToDisplay / broadcastToDisplays 函数，供服务任务推送到显示端
   */
  setSendToDisplay(fn) {
    this._sendToDisplay = fn;
  }
  setBroadcastToDisplays(fn) {
    this._broadcastToDisplays = fn;
  }

  /**
   * 启动时恢复孤儿服务实例（上次崩溃/重启时 running 的实例）
   * 先创建 draft，再 runInstance() 启动
   */
  async restoreAutoStartServices() {
    const taskList = await this.taskIO.listTasks().catch(() => []);
    this._isRestoring = true;
    for (const task of taskList) {
      for (const entry of (task.instances || [])) {
        if (entry.mode === 'service' && entry.status === 'running') {
          try {
            console.log('[TaskManager] 恢复服务实例:', entry.taskName, entry.instanceId);
            const isBuiltin = builtinRegistry && builtinRegistry.getTask(entry.taskName);
            await this.submit({
              ...entry, instanceId: entry.instanceId,
              taskType: isBuiltin ? 'builtin' : (entry.taskType || 'user'),
              builtinId: isBuiltin ? entry.taskName : null,
              entryFile: isBuiltin ? null : (entry.entryFile || 'service.js')
            });
            await this.runInstance(entry.taskName, entry.instanceId);
          } catch (err) {
            console.error('[TaskManager] 服务恢复失败:', entry.taskName, err.message);
          }
          break;
        }
      }
    }
    this._isRestoring = false;
  }

  /** 执行 draft 实例（draft → pending → running → completed/failed） */
  async runInstance(taskName, instanceId) {
    const idx = await this.taskIO.getIndex(taskName).catch(() => []);
    const entry = idx.find(e => e.instanceId === instanceId);
    if (!entry) return { success: false, error: '实例不存在' };
    if (entry.status !== 'draft' && entry.status !== 'created') {
      return { success: false, error: '实例状态必须是 draft: ' + entry.status };
    }

    let instance = this.instances.get(instanceId);
    if (!instance) {
      instance = { taskName, instanceId, status: entry.status, timestamp: entry.timestamp || Date.now() };
      this.instances.set(instanceId, instance);
    }

    // 从 index entry 重建 task 配置
    const task = {
      taskName: entry.taskName,
      instanceId,
      taskType: entry.taskType || 'user',
      builtinId: entry.builtinId || entry.taskName,
      target: entry.target || 'server',
      env: entry.env || 'auto',
      mode: entry.mode || 'one-shot',
      displayId: entry.displayId || null,
      entryFile: entry.entryFile || (entry.mode === 'service' ? 'service.js' : 'task.js'),
      params: entry.params || {},
      refs: entry.refs || {}
    };

    instance.status = 'running';
    this.emit('progress', instanceId, 'running', 30);
    this.emit('log', instanceId, 'system', 'info', '开始执行, 目标: ' + task.target + ', 环境: ' + task.env);
    await this.taskIO.updateIndex(taskName, { instanceId, status: 'running' });

    const resolvedRefs = this.taskIO.resolveRefs(task.taskName, task.refs);
    const context = {
      params: task.params,
      refs: resolvedRefs,
      workDir: this.taskIO._taskPath(task.taskName)
    };

    try {
      if (task.mode === 'service') {
        for (const [sid, svc] of this._services) {
          const sInst = this.instances.get(sid);
          if (sInst && sInst.taskName === task.taskName && svc.status === 'running') {
            console.log('[TaskManager] 停止旧服务实例:', sid, 'taskName:', task.taskName);
            try { await svc.stop(); } catch (e) { }
            this._services.delete(sid);
            this._widgetActions.delete(sid);
          }
        }
        this.emit('log', instanceId, 'system', 'info', '服务模式，在主进程运行');
        this._runServiceTask(task, instanceId, instance, context);
        return { taskName, instanceId, status: 'running' };
      }

      const usePuppeteer = (task.target === 'server' || !task.target) &&
        (task.env === 'webgl' || task.env === 'webgpu');

      if (task.taskType === 'builtin') {
        if (!builtinRegistry) throw new Error('内置任务模块不可用');

        const builtinCtx = { ...context, instanceId, taskName: task.taskName, taskIO: this.taskIO, postStream: (data) => this.emit('stream', instanceId, data) };
        const result = await builtinRegistry.run(task.builtinId, builtinCtx);

        if (result && result.forwardTo === 'display') {
          instance.status = 'pending_forward';
          instance.targetInfo = { displayId: task.displayId };
          this.emit('progress', instanceId, 'forwarding', 50);
          this.emit('log', instanceId, 'system', 'info', '正在转发到显示端...');
          this._forwardToDisplay(task, instanceId, result.forwardParams);
          return { taskName, instanceId, status: 'pending_forward' };
        }

        await this._handleResult(task, instanceId, instance, result);
        return { taskName, instanceId, status: instance.status };
      }

      if (task.target === 'display' || task.target === 'subdisplay') {
        instance.status = 'pending_forward';
        instance.targetInfo = { displayId: task.displayId };
        console.log('[TaskManager] 转发到显示端, instanceId:', instanceId, 'displayId:', task.displayId);
        this._forwardToDisplay(task, instanceId, task.params);
        instance._forwardTimeout = setTimeout(() => {
          const inst = this.instances.get(instanceId);
          if (inst && inst.status === 'pending_forward') {
            inst.status = 'failed';
            this.emit('log', instanceId, 'system', 'error', '转发超时: 显示端未响应');
            this.emit('progress', instanceId, 'failed', 0);
            this.emit('result', instanceId, { success: false, error: '显示端未响应' });
            this.taskIO.writeInstanceLog(task.taskName, instanceId, 'system', 'error', '转发超时: 显示端未响应');
            this.taskIO.updateIndex(task.taskName, { instanceId, status: 'failed', error: '显示端未响应' });
          }
        }, 30000);
        return { taskName, instanceId, status: 'pending_forward' };
      }

      console.log('[TaskManager] 服务端执行, runner:', usePuppeteer ? 'puppeteer' : 'nodejs', 'instanceId:', instanceId);
      const runner = usePuppeteer ? this.puppeteerRunner : this.nodeRunner;
      this._runServerTask(task, instanceId, instance, runner, context);
      return { taskName, instanceId, status: 'running' };

    } catch (err) {
      if (instance) instance.status = 'failed';
      this.emit('log', instanceId, 'system', 'error', '执行异常: ' + err.message);
      this.emit('progress', instanceId, 'failed', 0);
      this.emit('result', instanceId, { success: false, error: err.message });
      await this.taskIO.updateIndex(task.taskName, { instanceId, status: 'failed', error: err.message });
      await this.taskIO.writeInstanceLog(task.taskName, instanceId, 'system', 'error', err.message);
      return { taskName, instanceId, status: 'failed', error: err.message };
    }
  }

  /** 重置已完成/失败/已停止的实例为 draft */
  async rerunInstance(taskName, instanceId) {
    const idx = await this.taskIO.getIndex(taskName).catch(() => []);
    const entry = idx.find(e => e.instanceId === instanceId);
    if (!entry) return { success: false, error: '实例不存在' };
    if (entry.status === 'draft') return { success: false, error: '草稿无需重置' };
    if (entry.status === 'pending' || entry.status === 'running' || entry.status === 'pending_forward') {
      return { success: false, error: '实例正在运行，无法重置' };
    }

    await this.taskIO.updateIndex(taskName, { instanceId, status: 'draft' });

    let instance = this.instances.get(instanceId);
    if (!instance) {
      instance = { taskName, instanceId, status: 'draft', timestamp: entry.timestamp || Date.now() };
      this.instances.set(instanceId, instance);
    } else {
      instance.status = 'draft';
    }

    this.emit('log', instanceId, 'system', 'info', '实例已重置为草稿，可编辑参数后再运行');
    return { taskName, instanceId, status: 'draft' };
  }

  /** 将任务转发到显示端执行 */
  async _forwardToDisplay(task, instanceId, forwardParams) {
    let forwardFiles = task.files || [];
    if (forwardFiles.length === 0 && task.taskType === 'user' && task.entryFile) {
      forwardFiles = await this.taskIO.readTaskFiles(task.taskName, task.entryFile);
    }

    const payload = {
      type: 'task:execute',
      payload: {
        taskName: task.taskName,
        instanceId,
        builtinId: task.builtinId || null,
        entryFile: task.entryFile,
        files: forwardFiles,
        params: forwardParams || task.params || {},
        env: task.env || 'auto'
      }
    };

    const displayId = task.displayId;
    if (displayId && this._sendToDisplay) {
      console.log('[TaskManager] 转发 task:execute 到显示端', displayId, 'builtinId:', payload.payload.builtinId);
      const sent = this._sendToDisplay(displayId, payload);
      if (!sent) {
        console.error('[TaskManager] 转发失败: 显示端不在线', displayId);
        this.handleForwardResult(task.taskName, instanceId, {
          success: false, error: '显示端不在线或连接关闭: ' + displayId
        });
      }
    }
  }

  /** 处理来自控制端的 widget 动作 */
  async handleWidgetAction(instanceId, action, params) {
    const handlers = this._widgetActions.get(instanceId);
    if (handlers && handlers.has(action)) {
      try {
        return await handlers.get(action)(params || {});
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
    return { success: false, error: '未知动作: ' + action };
  }

  async submit(task) {
    if (this.instances.size >= this.maxInstances) {
      throw new Error('超出最大实例数 (' + this.maxInstances + ')');
    }

    // 自动检测内置任务：如果任务名匹配内置注册表，修正 taskType/builtinId
    if (task.taskType !== 'builtin' && builtinRegistry) {
      const builtinTask = builtinRegistry.getTask(task.taskName);
      if (builtinTask) {
        console.log('[TaskManager] 自动检测为内置任务:', task.taskName);
        task.taskType = 'builtin';
        task.builtinId = task.taskName;
        delete task.entryFile;
      }
    }

    const instanceId = task.instanceId || this._generateId();
    const timestamp = Date.now();

    const instance = {
      taskName: task.taskName,
      instanceId,
      taskType: task.taskType || 'user',
      target: task.target || 'server',
      env: task.env || 'auto',
      mode: task.mode || 'one-shot',
      status: 'draft',
      timestamp
    };

    this.instances.set(instanceId, instance);
    console.log('[TaskManager] submit:', task.taskName, 'type:', task.taskType, 'target:', task.target, 'instanceId:', instanceId);

    this.emit('progress', instanceId, 'preparing', 10);
    this.emit('log', instanceId, 'system', 'info', '正在准备文件...');

    await this.taskIO.saveTaskFiles(task.taskName, task.files || []);
    await this.taskIO.createInstanceDir(task.taskName, instanceId);
    await this.taskIO.updateIndex(task.taskName, {
      instanceId, taskName: task.taskName, status: 'draft', timestamp,
      target: task.target, env: task.env, mode: task.mode,
      displayId: task.displayId, params: task.params || {},
      taskType: task.taskType || 'user',
      builtinId: task.builtinId || null,
      entryFile: task.entryFile || null
    });

    this.emit('log', instanceId, 'system', 'info', '草稿已创建，可编辑参数后再运行');

    return { taskName: task.taskName, instanceId, status: 'draft' };
  }

  async _handleResult(task, instanceId, instance, result) {
    if (result && result.logs) {
      for (const log of result.logs) {
        this.emit('log', instanceId, log.stream, log.level, log.message);
        await this.taskIO.writeInstanceLog(task.taskName, instanceId, log.stream, log.level, log.message);
      }
    }

    if (result && result.success !== false) {
      instance.status = 'completed';
      this.emit('log', instanceId, 'system', 'info', '执行完成');
      this.emit('progress', instanceId, 'completed', 100);
      this.emit('result', instanceId, { success: true, data: result.data || {}, metrics: result.metrics || {} });
      await this.taskIO.updateIndex(task.taskName, { instanceId, status: 'completed', completedAt: Date.now() });
    } else {
      instance.status = 'failed';
      const errMsg = result ? result.error : '未知错误';
      this.emit('log', instanceId, 'system', 'error', '执行失败: ' + errMsg);
      this.emit('progress', instanceId, 'failed', 0);
      this.emit('result', instanceId, { success: false, error: errMsg, stack: result ? result.stack : null, metrics: result.metrics || {} });
      await this.taskIO.updateIndex(task.taskName, { instanceId, status: 'failed', error: errMsg });
    }
  }

  /**
   * 异步执行服务端任务，不阻塞调用者（WebSocket 消息处理）
   * 执行结果通过 this.emit('progress'/'log'/'result') 广播到控制端
   */
  async _runServerTask(task, instanceId, instance, runner, context) {
    try {
      const result = await runner.run({
        entryFile: task.entryFile,
        workDir: this.taskIO._taskPath(task.taskName),
        context,
        instanceId,
        timeout: task.timeout || 30000
      });
      // 检查实例是否已被 stopInstance 终止
      const current = this.instances.get(instanceId);
      if (!current || current.status === 'stopped') {
        console.log('[TaskManager] 实例已停止，忽略结果:', instanceId);
        return;
      }
      await this._handleResult(task, instanceId, instance, result);
      await this.taskIO.updateLatestLink(task.taskName, instanceId);
      await this.taskIO.cleanupOldInstances(task.taskName, this.maxInstances);
    } catch (err) {
      const current = this.instances.get(instanceId);
      if (!current || current.status === 'stopped') return;
      instance.status = 'failed';
      this.emit('log', instanceId, 'system', 'error', '执行异常: ' + err.message);
      this.emit('progress', instanceId, 'failed', 0);
      this.emit('result', instanceId, { success: false, error: err.message });
      try {
        await this.taskIO.updateIndex(task.taskName, { instanceId, status: 'failed', error: err.message });
        await this.taskIO.writeInstanceLog(task.taskName, instanceId, 'system', 'error', err.message);
      } catch (ioErr) {
        console.error('[TaskManager] 结果写入失败:', ioErr.message);
      }
    }
  }

  async stopInstance(taskName, instanceId) {
    const instance = this.instances.get(instanceId);
    if (!instance) return { success: false, error: '实例不存在' };

    // 服务任务：调控制器的 stop()
    const svc = this._services.get(instanceId);
    if (svc) {
      try {
        if (svc.status === 'running') await svc.stop();
      } catch (err) {
        console.error('[TaskManager] 服务停止出错:', err.message);
      }
      this._services.delete(instanceId);
      this._widgetActions.delete(instanceId);

      this.emit('log', instanceId, 'system', 'info', '服务已停止');
      await this.taskIO.updateIndex(taskName, { instanceId, status: 'stopped' });
      return { success: true };
    }

    // 一次性/转发任务：kill 子进程
    if (this.nodeRunner.kill) {
      this.nodeRunner.kill(instanceId);
    }
    instance.status = 'stopped';
    await this.taskIO.updateIndex(taskName, { instanceId, status: 'stopped' });
    await this.taskIO.writeInstanceLog(taskName, instanceId, 'system', 'info', '已停止执行');
    this.emit('log', instanceId, 'system', 'info', '已停止执行');
    return { success: true };
  }

  /**
   * 在主进程运行服务任务（内置或用户上传），返回控制器
   */
  async _runServiceTask(task, instanceId, instance, context) {
    try {
      let controller;

      if (task.taskType === 'builtin') {
        if (!builtinRegistry) throw new Error('内置任务模块不可用');
        if (task.files && task.files.length > 0) {
          context.files = {};
          for (const f of task.files) {
            if (f.data) context.files[f.name] = Buffer.from(f.data, 'base64');
          }
        }
        // 注册 widget 动作处理
        const actionHandlers = new Map();
        this._widgetActions.set(instanceId, actionHandlers);

        const result = await builtinRegistry.run(task.builtinId, {
          ...context, instanceId, taskName: task.taskName, taskIO: this.taskIO,
          sendToDisplay: this._sendToDisplay,
          broadcastToDisplays: this._broadcastToDisplays,
          postWidgetUpdate: (data) => this.emit('widgetUpdate', instanceId, data),
          postStream: (data) => this.emit('stream', instanceId, data),
          onWidgetAction: (action, handler) => actionHandlers.set(action, handler)
        });
        if (!result || result.type !== 'service' || !result.stop) {
          throw new Error('内置任务未返回服务控制器 (type: service + stop())');
        }
        controller = { stop: result.stop.bind(result), status: 'running' };
      } else {
        // 用户上传服务：require() 加载，清理缓存支持重新上传
        const entryFile = task.entryFile || 'service.js';
        const servicePath = path.resolve(this.taskIO._taskPath(task.taskName), entryFile);
        if (!require('fs').existsSync(servicePath)) {
          throw new Error('服务入口文件不存在: ' + entryFile);
        }
        delete require.cache[require.resolve(servicePath)];
        const mod = require(servicePath);
        const run = typeof mod === 'function' ? mod : mod.run;
        if (typeof run !== 'function') throw new Error('服务模块未导出 run 函数');

        const serviceContext = {
          params: task.params || {},
          workDir: this.taskIO._taskPath(task.taskName),
          log: (msg) => this.emit('log', instanceId, 'service', 'info', msg)
        };
        const result = await run(serviceContext);
        if (!result || typeof result.stop !== 'function') {
          throw new Error('用户服务未返回 stop 方法');
        }
        controller = { stop: result.stop.bind(result), status: 'running' };
      }

      this._services.set(instanceId, controller);
      instance.status = 'running';
      instance.stage = 'running';
      instance.progress = 100;
      this.emit('progress', instanceId, 'running', 100);
    } catch (err) {
      instance.status = 'failed';
      this.emit('log', instanceId, 'system', 'error', '服务启动失败: ' + err.message);
      this.emit('progress', instanceId, 'failed', 0);
      this.emit('result', instanceId, { success: false, error: err.message });
      await this.taskIO.updateIndex(task.taskName, { instanceId, status: 'failed', error: err.message });
    }
  }

  async handleForwardResult(taskName, instanceId, result) {
    console.log('[TaskManager] handleForwardResult:', instanceId, '成功:', result.success, 'error:', result.error || 'none');
    const instance = this.instances.get(instanceId);
    if (!instance) return { success: false, error: '实例不存在' };
    const task = { taskName: instance.taskName };
    await this._handleResult(task, instanceId, instance, {
      success: result.success,
      error: result.error,
      data: result.outputFiles ? { outputFiles: result.outputFiles } : undefined,
      metrics: result.metrics
    });
    // 清除转发超时
    if (instance && instance._forwardTimeout) {
      clearTimeout(instance._forwardTimeout);
      instance._forwardTimeout = null;
    }
    await this.taskIO.updateLatestLink(task.taskName, instanceId);
    await this.taskIO.cleanupOldInstances(task.taskName, this.maxInstances);
    return { success: true };
  }

  getInstance(instanceId) {
    return this.instances.get(instanceId) || null;
  }

  async getInstanceStatus(taskName, instanceId) {
    if (instanceId) {
      // 先查内存
      const inst = this.instances.get(instanceId);
      if (inst) return inst;
      // 再查索引
      const idx = await this.taskIO.getIndex(taskName);
      return idx.find(e => e.instanceId === instanceId) || null;
    }
    // 没有 instanceId，返回最新
    const idx = await this.taskIO.getIndex(taskName);
    if (idx.length > 0) {
      const sorted = [...idx].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      return sorted[0];
    }
    return null;
  }

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

  async getInstanceLog(taskName, instanceId) {
    const content = await this.taskIO.readInstanceLog(taskName, instanceId);
    if (content == null) {
      // 尝试从内存获取日志
      const memInst = this.instances.get(instanceId);
      if (memInst && memInst.logs && memInst.logs.length > 0) {
        return memInst.logs.map(l => {
          const time = l.time ? new Date(l.time).toISOString() : new Date().toISOString();
          return '[' + time + '] [' + (l.stream || 'stdout') + '][' + (l.level || 'info') + '] ' + l.message;
        }).join('\n');
      }
      return '';
    }
    return content;
  }

  async clearInstanceLogs(taskName, instanceId) {
    await this.taskIO.clearInstanceLog(taskName, instanceId);
    const inst = this.instances.get(instanceId);
    if (inst) inst.logs = [];
    return { success: true };
  }

  async deleteInstance(taskName, instanceId) {
    // 清理内存中的实例
    this.instances.delete(instanceId);
    try { if (this.nodeRunner.kill) this.nodeRunner.kill(instanceId); } catch (e) {}
    return this.taskIO.deleteInstance(taskName, instanceId);
  }

  async deleteTask(taskName) {
    // 清除此任务在内存中的所有实例
    for (const [id, inst] of this.instances) {
      if (inst.taskName === taskName) {
        try { if (this.nodeRunner.kill) this.nodeRunner.kill(id); } catch (e) {}
        this.instances.delete(id);
      }
    }
    return this.taskIO.deleteTask(taskName);
  }

  async updateTask(taskName, updates = {}) {
    const toReplace = (updates.files || []).filter(f => f.action === 'replace' || !f.action);
    const toDelete = (updates.files || []).filter(f => f.action === 'delete').map(f => f.name);

    if (toDelete.length > 0) {
      await this.taskIO.deleteTaskFiles(taskName, toDelete);
    }
    if (toReplace.length > 0) {
      await this.taskIO.saveTaskFiles(taskName, toReplace);
    }
    return { success: true };
  }

  async destroy() {
    // 终止所有运行中的 child process
    if (this.nodeRunner && this.nodeRunner._children) {
      for (const [id, child] of this.nodeRunner._children) {
        child.kill('SIGKILL');
      }
      this.nodeRunner._children.clear();
    }
    // 关闭 Puppeteer browser
    if (this.puppeteerRunner && this.puppeteerRunner.close) {
      await this.puppeteerRunner.close();
    }
    this.removeAllListeners();
    this.instances.clear();
  }
}

module.exports = TaskManager;
