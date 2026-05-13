const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const crypto = require('crypto');
const TaskIO = require('./task-io');
const NodeJsRunner = require('./nodejs-runner');

class TaskManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.taskIO = new TaskIO(options);
    this.nodeRunner = new NodeJsRunner();
    this.instances = new Map();
    this.maxInstances = options.maxInstances || 50;
  }

  _generateId() {
    return crypto.randomBytes(4).toString('hex');
  }

  async submit(task) {
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

      if (task.taskType === 'builtin') {
        const registry = require('./builtin-tasks/registry');
        const result = await registry.run(task.builtinId, {
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
        const result = await this.nodeRunner.run({
          entryFile: task.entryFile,
          workDir: this.taskIO._taskPath(task.taskName),
          context,
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
      for (const log of result.logs) {
        this.emit('log', instanceId, log.stream, log.level, log.message);
        await this.taskIO.writeInstanceLog(task.taskName, instanceId, log.stream, log.level, log.message);
      }
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
    instance.status = 'stopped';
    this.emit('log', instanceId, 'system', 'info', '已发送停止指令');
    return { success: true };
  }

  getInstance(instanceId) {
    return this.instances.get(instanceId) || null;
  }

  async getInstanceStatus(taskName, instanceId) {
    if (instanceId) {
      const inst = this.instances.get(instanceId);
      if (inst) return inst;
    }
    if (!instanceId) {
      const idx = await this.taskIO.getIndex(taskName);
      if (idx.length > 0) {
        idx.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        return idx[0];
      }
    }
    return null;
  }
}

module.exports = TaskManager;
