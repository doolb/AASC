const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const DataSnapshot = require('../../../../core/data-snapshot');

class TaskIndex extends DataSnapshot {
  static defaults = { instances: [] };
}

class TaskIO extends EventEmitter {
  constructor(options = {}) {
    super();
    this.tasksDir = options.tasksDir || path.resolve(__dirname, '../../../../../res/tasks');
    this._indexes = new Map();
  }

  _validateSafePath(base, target) {
    const resolved = path.resolve(base, target);
    const normalizedBase = path.resolve(base);
    if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
      throw new Error(`路径越界: ${target} 不在 ${base} 目录内`);
    }
    return resolved;
  }

  _taskPath(taskName) { return path.join(this.tasksDir, taskName); }
  _resultsPath(taskName) { return path.join(this._taskPath(taskName), 'results'); }
  _instancePath(taskName, instanceId) { return path.join(this._resultsPath(taskName), instanceId); }
  _latestLink(taskName) { return path.join(this._resultsPath(taskName), 'latest'); }
  _indexPath(taskName) { return path.join(this._resultsPath(taskName), 'index.json'); }

  async readTaskFiles(taskName, entryFile) {
    const taskDir = this._taskPath(taskName);
    const files = [];
    try {
      const entries = await fs.promises.readdir(taskDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || entry.name === 'results') continue;
        if (entryFile && entry.name !== entryFile) continue;
        const filePath = path.join(taskDir, entry.name);
        const data = await fs.promises.readFile(filePath);
        files.push({ name: entry.name, data: data.toString('base64') });
      }
    } catch (e) { console.warn('[TaskIO] 读取任务文件失败:', taskName, e.message); }
    return files;
  }

  async ensureTaskDir(taskName) {
    const dir = this._taskPath(taskName);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.mkdir(this._resultsPath(taskName), { recursive: true });
    return dir;
  }

  async saveTaskFiles(taskName, files) {
    const taskDir = await this.ensureTaskDir(taskName);
    for (const file of files) {
      const filePath = this._validateSafePath(taskDir, file.name);
      const dir = path.dirname(filePath);
      await fs.promises.mkdir(dir, { recursive: true });
      if (file.data) {
        await fs.promises.writeFile(filePath, Buffer.from(file.data, 'base64'));
      } else if (file.path) {
        const srcPath = this._validateSafePath(this.tasksDir, file.path.replace(/^\/res\/tasks\//, ''));
        const srcExists = fs.existsSync(srcPath);
        if (srcExists) {
          await fs.promises.copyFile(srcPath, filePath);
        } else {
          throw new Error(`引用的源文件不存在: ${file.path}`);
        }
      }
    }
  }

  resolveRefs(taskName, refs) {
    const resolved = {};
    if (!refs) return resolved;
    for (const [key, refPath] of Object.entries(refs)) {
      resolved[key] = path.resolve(this.tasksDir, refPath);
    }
    return resolved;
  }

  async createInstanceDir(taskName, instanceId) {
    const dir = this._instancePath(taskName, instanceId);
    await fs.promises.mkdir(dir, { recursive: true });
    return dir;
  }

  async updateLatestLink(taskName, instanceId) {
    const linkPath = this._latestLink(taskName);
    const target = path.relative(this._resultsPath(taskName), this._instancePath(taskName, instanceId));
    try {
      const existing = await fs.promises.readlink(linkPath);
      if (existing !== target) { await fs.promises.unlink(linkPath); await fs.promises.symlink(target, linkPath); }
    } catch (e) {
      if (e.code === 'ENOENT') { await fs.promises.symlink(target, linkPath); }
    }
  }

  async getTaskConfig(taskName) {
    const configPath = path.join(this._taskPath(taskName), 'config.json');
    try {
      const content = await fs.promises.readFile(configPath, 'utf8');
      return JSON.parse(content);
    } catch (e) {
      return {};
    }
  }

  async setTaskConfig(taskName, config) {
    const configPath = path.join(this._taskPath(taskName), 'config.json');
    await fs.promises.mkdir(this._taskPath(taskName), { recursive: true });
    await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
  }

  async writeInstanceLog(taskName, instanceId, stream, level, message) {
    const dir = this._instancePath(taskName, instanceId);
    await fs.promises.mkdir(dir, { recursive: true });
    const logPath = path.join(dir, 'run.log');
    const line = '[' + new Date().toISOString() + '] [' + stream + '][' + level + '] ' + message + '\n';
    await fs.promises.appendFile(logPath, line, 'utf8');
  }

  async clearInstanceLog(taskName, instanceId) {
    const logPath = path.join(this._instancePath(taskName, instanceId), 'run.log');
    try {
      await fs.promises.unlink(logPath);
      return { success: true };
    } catch (e) {
      if (e.code === 'ENOENT') return { success: true };
      throw e;
    }
  }

  async readInstanceLog(taskName, instanceId) {
    const logPath = path.join(this._instancePath(taskName, instanceId), 'run.log');
    try {
      const content = await fs.promises.readFile(logPath, 'utf8');
      return content;
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }

  async deleteInstance(taskName, instanceId) {
    const index = this._getIndex(taskName);
    const before = index.instances.length;
    index.instances = index.instances.filter(e => e.instanceId !== instanceId);
    if (index.instances.length === before) return { success: false, error: '实例不存在' };
    try { await fs.promises.rm(this._instancePath(taskName, instanceId), { recursive: true, force: true }); } catch (e) {}
    if (index.instances.length > 0) {
      const sorted = [...index.instances].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      await this.updateLatestLink(taskName, sorted[0].instanceId);
    } else {
      try { await fs.promises.unlink(this._latestLink(taskName)); } catch (e) {}
    }
    return { success: true };
  }

  _getIndex(taskName) {
    let index = this._indexes.get(taskName);
    if (!index) {
      const idxPath = this._indexPath(taskName);
      const dir = path.dirname(idxPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      index = new TaskIndex(idxPath);
      this._indexes.set(taskName, index);
    }
    return index;
  }

  async updateIndex(taskName, entry) {
    const index = this._getIndex(taskName);
    const existing = index.instances.findIndex(e => e.instanceId === entry.instanceId);
    if (existing >= 0) {
      index.instances[existing] = { ...index.instances[existing], ...entry };
    } else {
      index.instances.push(entry);
    }
  }

  async getIndex(taskName) {
    try { return [...this._getIndex(taskName).instances]; }
    catch (e) { return []; }
  }

  async cleanupOldInstances(taskName, maxInstances = 50) {
    const index = this._getIndex(taskName);
    if (index.instances.length <= maxInstances) return;
    const sorted = [...index.instances].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    const toRemove = sorted.slice(0, sorted.length - maxInstances);
    for (const entry of toRemove) {
      try { fs.rmSync(this._instancePath(taskName, entry.instanceId), { recursive: true, force: true }); } catch (e) {}
    }
    index.instances = sorted.slice(sorted.length - maxInstances);
  }

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
        } catch (e) { console.warn('[TaskIO] 读取任务文件失败:', taskName, e.message); }
        const idx = await this.getIndex(taskName).catch(() => []);
        tasks.push({ taskName, files, instances: idx });
      }
    } catch (e) { console.warn('[TaskIO] 读取任务目录失败:', e.message); }
    return tasks;
  }

  async deleteTask(taskName) {
    this._indexes.delete(taskName);
    const taskDir = this._validateSafePath(this.tasksDir, taskName);
    try {
      await fs.promises.rm(taskDir, { recursive: true, force: true });
      return { success: true };
    } catch (e) {
      throw new Error('删除任务失败: ' + e.message);
    }
  }

  async deleteTaskFiles(taskName, fileNames) {
    const taskDir = this._validateSafePath(this.tasksDir, taskName);
    const results = [];
    for (const fileName of fileNames) {
      try {
        const filePath = this._validateSafePath(taskDir, fileName);
        await fs.promises.rm(filePath, { force: true });
        results.push({ name: fileName, success: true });
      } catch (e) {
        console.warn('[TaskIO] 删除任务文件失败:', fileName, e.message);
        results.push({ name: fileName, success: false, error: e.message });
      }
    }
    return results;
  }

}

module.exports = TaskIO;
