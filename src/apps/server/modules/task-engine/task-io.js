const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

class TaskIO extends EventEmitter {
  constructor(options = {}) {
    super();
    this.tasksDir = options.tasksDir || path.resolve(__dirname, '../../../../../res/tasks');
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

  async writeInstanceLog(taskName, instanceId, stream, level, message) {
    const dir = this._instancePath(taskName, instanceId);
    await fs.promises.mkdir(dir, { recursive: true });
    const logPath = path.join(dir, 'run.log');
    const line = '[' + new Date().toISOString() + '] [' + stream + '][' + level + '] ' + message + '\n';
    await fs.promises.appendFile(logPath, line, 'utf8');
  }

  async updateIndex(taskName, entry) {
    const idxPath = this._indexPath(taskName);
    await fs.promises.mkdir(path.dirname(idxPath), { recursive: true });
    let idx = [];
    try { idx = JSON.parse(await fs.promises.readFile(idxPath, 'utf8')); } catch (e) {}
    const existing = idx.findIndex(e => e.instanceId === entry.instanceId);
    if (existing >= 0) { idx[existing] = { ...idx[existing], ...entry }; }
    else { idx.push(entry); }
    await fs.promises.writeFile(idxPath, JSON.stringify(idx, null, 2));
  }

  async getIndex(taskName) {
    try { return JSON.parse(await fs.promises.readFile(this._indexPath(taskName), 'utf8')); }
    catch (e) { return []; }
  }

  async cleanupOldInstances(taskName, maxInstances = 50) {
    const idx = await this.getIndex(taskName);
    if (idx.length <= maxInstances) return;
    idx.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    const toRemove = idx.slice(0, idx.length - maxInstances);
    for (const entry of toRemove) {
      try { fs.rmSync(this._instancePath(taskName, entry.instanceId), { recursive: true, force: true }); } catch (e) {}
    }
    const remaining = idx.slice(idx.length - maxInstances);
    await fs.promises.writeFile(this._indexPath(taskName), JSON.stringify(remaining, null, 2));
  }

}

module.exports = TaskIO;
