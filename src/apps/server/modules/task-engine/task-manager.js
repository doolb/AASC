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
    this.maxInstances = options.maxInstances || 50;
  }

  _generateId() {
    return crypto.randomBytes(4).toString('hex');
  }

  async submit(task) {
    if (this.instances.size >= this.maxInstances) {
      throw new Error('超出最大实例数 (' + this.maxInstances + ')');
    }
    const instanceId = this._generateId();
    const timestamp = Date.now();

    const instance = {
      taskName: task.taskName,
      instanceId,
      taskType: task.taskType || 'user',
      target: task.target || 'server',
      env: task.env || 'auto',
      mode: task.mode || 'one-shot',
      status: 'pending',
      timestamp
    };

    this.instances.set(instanceId, instance);

    this.emit('progress', instanceId, 'preparing', 10);
    this.emit('log', instanceId, 'system', 'info', '正在准备文件...');

    await this.taskIO.saveTaskFiles(task.taskName, task.files || []);
    await this.taskIO.createInstanceDir(task.taskName, instanceId);
    await this.taskIO.updateIndex(task.taskName, { instanceId, taskName: task.taskName, status: 'running', timestamp });

    instance.status = 'running';
    this.emit('progress', instanceId, 'running', 30);

    const resolvedRefs = this.taskIO.resolveRefs(task.taskName, task.refs);
    const context = {
      params: task.params || {},
      refs: resolvedRefs,
      workDir: this.taskIO._taskPath(task.taskName)
    };

    try {
      this.emit('log', instanceId, 'system', 'info', '目标: ' + task.target + ', 环境: ' + task.env);

      // 服务端执行时，GPU 环境走 Puppeteer
      const usePuppeteer = (task.target === 'server' || !task.target) &&
        (task.env === 'webgl' || task.env === 'webgpu');

      if (task.taskType === 'builtin') {
        if (!builtinRegistry) throw new Error('内置任务模块不可用');
        const result = await builtinRegistry.run(task.builtinId, {
          ...context,
          instanceId,
          taskName: task.taskName,
          taskIO: this.taskIO
        });
        await this._handleResult(task, instanceId, instance, result);
      } else if (task.target === 'display' || task.target === 'subdisplay') {
        instance.status = 'pending_forward';
        instance.targetInfo = { displayId: task.displayId };
        process.nextTick(() => {
          this.emit('forward', instanceId, task);
        });
        return { taskName: task.taskName, instanceId, status: 'pending_forward' };
      } else {
        const runner = usePuppeteer ? this.puppeteerRunner : this.nodeRunner;
        const result = await runner.run({
          entryFile: task.entryFile,
          workDir: this.taskIO._taskPath(task.taskName),
          context,
          instanceId,
          timeout: task.timeout || 30000
        });
        await this._handleResult(task, instanceId, instance, result);
      }

      await this.taskIO.updateLatestLink(task.taskName, instanceId);
      await this.taskIO.cleanupOldInstances(task.taskName, this.maxInstances);

      return { taskName: task.taskName, instanceId, status: instance.status };
    } catch (err) {
      instance.status = 'failed';
      this.emit('log', instanceId, 'system', 'error', '执行异常: ' + err.message);
      this.emit('progress', instanceId, 'failed', 0);
      this.emit('result', instanceId, { success: false, error: err.message });
      await this.taskIO.updateIndex(task.taskName, { instanceId, status: 'failed', error: err.message });
      await this.taskIO.writeInstanceLog(task.taskName, instanceId, 'system', 'error', err.message);
      return { taskName: task.taskName, instanceId, status: 'failed', error: err.message };
    }
  }

  async _handleResult(task, instanceId, instance, result) {
    if (result && result.logs) {
      const writePromises = result.logs.map(log => {
        this.emit('log', instanceId, log.stream, log.level, log.message);
        return this.taskIO.writeInstanceLog(task.taskName, instanceId, log.stream, log.level, log.message);
      });
      await Promise.all(writePromises);
    }

    if (result && result.success !== false) {
      instance.status = 'completed';
      this.emit('log', instanceId, 'system', 'info', '执行完成');
      this.emit('progress', instanceId, 'completed', 100);
      this.emit('result', instanceId, { success: true, data: result.data || {} });
      await this.taskIO.updateIndex(task.taskName, { instanceId, status: 'completed', completedAt: Date.now() });
    } else {
      instance.status = 'failed';
      const errMsg = result ? result.error : '未知错误';
      this.emit('log', instanceId, 'system', 'error', '执行失败: ' + errMsg);
      this.emit('progress', instanceId, 'failed', 0);
      this.emit('result', instanceId, { success: false, error: errMsg, stack: result ? result.stack : null });
      await this.taskIO.updateIndex(task.taskName, { instanceId, status: 'failed', error: errMsg });
    }
  }

  async stopInstance(taskName, instanceId) {
    const instance = this.instances.get(instanceId);
    if (!instance) return { success: false, error: '实例不存在' };
    if (this.nodeRunner.kill) {
      this.nodeRunner.kill(instanceId);
    }
    instance.status = 'stopped';
    await this.taskIO.updateIndex(taskName, { instanceId, status: 'stopped' });
    await this.taskIO.writeInstanceLog(taskName, instanceId, 'system', 'info', '已停止执行');
    this.emit('log', instanceId, 'system', 'info', '已停止执行');
    return { success: true };
  }

  async handleForwardResult(taskName, instanceId, result) {
    const instance = this.instances.get(instanceId);
    if (!instance) return { success: false, error: '实例不存在' };
    const task = { taskName: instance.taskName };
    await this._handleResult(task, instanceId, instance, {
      success: result.success,
      error: result.error,
      data: result.outputFiles ? { outputFiles: result.outputFiles } : undefined
    });
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
