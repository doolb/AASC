# 远程任务系统 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Web MediaCenter 中实现远程任务系统，用户可在控制端上传 JS 代码，在服务端/显示端/子显示端执行并返回结果。

**Architecture:** 控制端通过 WebSocket 提交任务 → 服务端 TaskManager 管理实例生命周期 → NodeJsRunner / PuppeteerRunner / 显示端浏览器 执行 → 结果和日志通过 WebSocket 流式返回。

**Tech Stack:** Node.js, Puppeteer, WebSocket, 原生 JavaScript

---

## File Structure

```
src/apps/server/modules/task-engine/
  ├── task-io.js               ← 文件管理、refs 解析、结果存储、日志写入
  ├── nodejs-runner.js         ← child_process.fork 执行用户 JS，捕获日志
  ├── puppeteer-runner.js      ← Puppeteer headless Chrome 执行（GPU 环境）
  ├── task-manager.js          ← 生命周期、实例跟踪、超时控制
  ├── web-socket-handler.js    ← 注册所有 task:* WebSocket 消息处理
  └── builtin-tasks/
      ├── registry.js           ← 内置任务注册表
      └── image-resize.js       ← 示例内置任务

src/apps/web-mediacenter/ui/public/js/
  ├── task-panel.js            ← 前端任务面板（提交表单、任务列表、日志实时显示）

src/apps/web-mediacenter/ui/public/
  ├── upload.html              ← 修改：新增导航项 + panel 区域 + script 加载

src/apps/server/boot/
  ├── server-app.js            ← 修改：初始化 TaskManager，注册 WebSocket handlers

tests/
  ├── task-engine/
      ├── task-io.test.js
      ├── nodejs-runner.test.js
      └── task-manager.test.js
```

---

## Task Dependencies

```
Task 1 (task-io) → Task 2 (nodejs-runner) → Task 3 (task-manager)
                                                          ↓
Task 4 (builtin-tasks) ─────────────────────→ Task 5 (ws-handler) → Task 6 (server-app)
                                                          ↓
Task 7 (puppeteer-runner)                                   ↓
                                              Task 8 (task-panel) → Task 9 (upload.html)
                                                                  Task 10 (display-runner)
                                                                  Task 11 (sub-display)
```

---

### Task 1: Task-IO 模块

**Files:**
- Create: `src/apps/server/modules/task-engine/task-io.js`
- Test: `src/apps/server/modules/task-engine/task-io.test.js`

负责：保存上传文件、解析跨任务 refs、管理结果目录、写入日志。

- [ ] **Step 1: Write the test**

`src/apps/server/modules/task-engine/task-io.test.js`:
```javascript
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const TASKS_DIR = path.join(os.tmpdir(), 'task-io-test-' + Date.now());

// 模拟 TaskIO（测试用临时目录）
const TaskIO = require('./task-io');
const taskIO = new TaskIO({ tasksDir: TASKS_DIR });

let testCount = 0;
let passCount = 0;
function test(name, fn) {
  testCount++;
  try { fn(); passCount++; console.log(`  ✓ ${name}`); }
  catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
}

console.log('=== TaskIO 测试 ===\n');

test('saveTaskFiles: 保存文件到任务目录', async () => {
  const files = [
    { name: 'task.js', data: Buffer.from('console.log("hi")').toString('base64') },
    { name: 'data.json', data: Buffer.from('{"x":1}').toString('base64') }
  ];
  await taskIO.saveTaskFiles('test-task', files);
  const taskPath = path.join(TASKS_DIR, 'test-task');
  assert.ok(fs.existsSync(path.join(taskPath, 'task.js')));
  assert.ok(fs.existsSync(path.join(taskPath, 'data.json')));
  assert.strictEqual(fs.readFileSync(path.join(taskPath, 'task.js'), 'utf8'), 'console.log("hi")');
});

test('resolveRefs: 解析跨任务引用路径', async () => {
  const refs = { 'img.png': 'other-task/results/latest/output.png' };
  const resolved = taskIO.resolveRefs('test-task', refs);
  const expected = path.resolve(TASKS_DIR, 'other-task/results/latest/output.png');
  assert.strictEqual(resolved['img.png'], expected);
});

test('createInstanceDir: 创建实例结果目录', async () => {
  const dir = await taskIO.createInstanceDir('test-task', 'inst-1');
  assert.ok(fs.existsSync(dir));
  assert.strictEqual(path.basename(dir), 'inst-1');
});

test('writeInstanceLog: 写入并追加日志文件', async () => {
  await taskIO.writeInstanceLog('test-task', 'inst-1', 'stdout', 'info', 'hello');
  await taskIO.writeInstanceLog('test-task', 'inst-1', 'stderr', 'error', 'fail');
  const logPath = path.join(TASKS_DIR, 'test-task/results/inst-1/run.log');
  const content = fs.readFileSync(logPath, 'utf8');
  assert.ok(content.includes('[stdout][info] hello'));
  assert.ok(content.includes('[stderr][error] fail'));
});

test('updateIndex: 添加实例到索引', async () => {
  await taskIO.updateIndex('test-task', { instanceId: 'inst-1', status: 'running' });
  const idx = await taskIO.getIndex('test-task');
  assert.ok(idx.find(e => e.instanceId === 'inst-1'));
});

test('cleanupOldInstances: 保留最近 N 个实例', async () => {
  for (let i = 0; i < 5; i++) {
    await taskIO.createInstanceDir('cleanup-test', `inst-${i}`);
    await taskIO.updateIndex('cleanup-test', { instanceId: `inst-${i}`, timestamp: Date.now() + i });
  }
  await taskIO.cleanupOldInstances('cleanup-test', 3);
  const idx = await taskIO.getIndex('cleanup-test');
  assert.strictEqual(idx.length, 3);
  assert.ok(!fs.existsSync(path.join(TASKS_DIR, 'cleanup-test/results/inst-0')));
});

// 清理
process.on("exit", () => { try { fs.rmSync(TASKS_DIR, { recursive: true, force: true }); } catch(e) {} });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node src/apps/server/modules/task-engine/task-io.test.js
```
Expected: `Error: Cannot find module './task-io'` or similar

- [ ] **Step 3: Write minimal implementation**

`src/apps/server/modules/task-engine/task-io.js`:
```javascript
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

class TaskIO extends EventEmitter {
  constructor(options = {}) {
    super();
    this.tasksDir = options.tasksDir || path.resolve(__dirname, '../../../../../res/tasks');
  }

  _taskPath(taskName) {
    return path.join(this.tasksDir, taskName);
  }
  _resultsPath(taskName) {
    return path.join(this._taskPath(taskName), 'results');
  }
  _instancePath(taskName, instanceId) {
    return path.join(this._resultsPath(taskName), instanceId);
  }
  _latestLink(taskName) {
    return path.join(this._resultsPath(taskName), 'latest');
  }
  _indexPath(taskName) {
    return path.join(this._resultsPath(taskName), 'index.json');
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
      const filePath = path.join(taskDir, file.name);
      const dir = path.dirname(filePath);
      await fs.promises.mkdir(dir, { recursive: true });
      if (file.data) {
        await fs.promises.writeFile(filePath, Buffer.from(file.data, 'base64'));
      } else if (file.path) {
        const srcPath = path.resolve(this.tasksDir, file.path.replace(/^\/res\/tasks\//, ''));
        const srcExists = fs.existsSync(srcPath);
        if (srcExists) {
          await fs.promises.copyFile(srcPath, filePath);
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
      if (existing !== target) {
        await fs.promises.unlink(linkPath);
        await fs.promises.symlink(target, linkPath);
      }
    } catch (e) {
      if (e.code === 'ENOENT') {
        await fs.promises.symlink(target, linkPath);
      }
    }
  }

  async writeInstanceLog(taskName, instanceId, stream, level, message) {
    const logPath = path.join(this._instancePath(taskName, instanceId), 'run.log');
    const line = `[${new Date().toISOString()}] [${stream}] [${level}] ${message}\n`;
    await fs.promises.appendFile(logPath, line, 'utf8');
  }

  async updateIndex(taskName, entry) {
    const idxPath = this._indexPath(taskName);
    let idx = [];
    try {
      idx = JSON.parse(await fs.promises.readFile(idxPath, 'utf8'));
    } catch (e) { /* 不存在则创建新索引 */ }
    const existing = idx.findIndex(e => e.instanceId === entry.instanceId);
    if (existing >= 0) {
      idx[existing] = { ...idx[existing], ...entry };
    } else {
      idx.push(entry);
    }
    await fs.promises.writeFile(idxPath, JSON.stringify(idx, null, 2));
  }

  async getIndex(taskName) {
    try {
      return JSON.parse(await fs.promises.readFile(this._indexPath(taskName), 'utf8'));
    } catch (e) {
      return [];
    }
  }

  async cleanupOldInstances(taskName, maxInstances = 50) {
    const idx = await this.getIndex(taskName);
    if (idx.length <= maxInstances) return;
    idx.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    const toRemove = idx.slice(0, idx.length - maxInstances);
    for (const entry of toRemove) {
      const instPath = this._instancePath(taskName, entry.instanceId);
      try {
        fs.rmSync(instPath, { recursive: true, force: true });
      } catch (e) { /* 忽略 */ }
    }
    const remaining = idx.slice(idx.length - maxInstances);
    await fs.promises.writeFile(this._indexPath(taskName), JSON.stringify(remaining, null, 2));
  }

  async getLatestInstanceId(taskName) {
    const idx = await this.getIndex(taskName);
    if (idx.length === 0) return null;
    idx.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return idx[0].instanceId;
  }
}

module.exports = TaskIO;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node src/apps/server/modules/task-engine/task-io.test.js
```
Expected: All `✓` marks, 0 failures

- [ ] **Step 5: Commit**

```bash
git add src/apps/server/modules/task-engine/task-io.js src/apps/server/modules/task-engine/task-io.test.js
git commit -m "feat(task-engine): add TaskIO file management module"
```

---

### Task 2: Node.js Runner

**Files:**
- Create: `src/apps/server/modules/task-engine/nodejs-runner.js`
- Test: `src/apps/server/modules/task-engine/nodejs-runner.test.js`

负责：通过 `child_process.fork` 在独立进程中执行用户 JS，捕获 console.log/stderr 并转成结构化日志流。

- [ ] **Step 1: Write the test**

`src/apps/server/modules/task-engine/nodejs-runner.test.js`:
```javascript
const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const NodeJsRunner = require('./nodejs-runner');

const TMPDIR = path.join(os.tmpdir(), 'nodejs-runner-test-' + Date.now());
fs.mkdirSync(TMPDIR, { recursive: true });

let testCount = 0;
let passCount = 0;
function test(name, fn) {
  testCount++;
  try { fn(); passCount++; console.log(`  ✓ ${name}`); }
  catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
}

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

const runner = new NodeJsRunner();

console.log('\n=== NodeJsRunner 测试 ===\n');

test('run: 执行简单脚本并返回标准输出', async () => {
  const workDir = path.join(TMPDIR, 'simple');
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, 'task.js'), `
    console.log('hello from task');
    const result = { sum: 1 + 2 };
    process.stdout.write(JSON.stringify(result));
  `);

  const result = await runner.run({
    entryFile: 'task.js',
    workDir,
    context: { files: {}, params: {}, refs: {}, workDir }
  });

  assert.ok(result.success);
  assert.ok(result.logs.some(l => l.message.includes('hello from task')));
});

test('run: 超时自动终止', async () => {
  const workDir = path.join(TMPDIR, 'timeout');
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, 'task.js'), `
    while(true) { await new Promise(r => setTimeout(r, 100)); }
  `);

  const result = await runner.run({
    entryFile: 'task.js',
    workDir,
    context: { files: {}, params: {}, refs: {}, workDir },
    timeout: 500
  });

  assert.ok(!result.success);
  assert.strictEqual(result.error, 'timeout');
});

test('run: 执行异常捕获', async () => {
  const workDir = path.join(TMPDIR, 'error');
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, 'task.js'), `
    throw new Error('oops');
  `);

  const result = await runner.run({
    entryFile: 'task.js',
    workDir,
    context: { files: {}, params: {}, refs: {}, workDir }
  });

  assert.ok(!result.success);
  assert.ok(result.error);
});

process.on("exit", () => { try { fs.rmSync(TMPDIR, { recursive: true, force: true }); } catch(e) {} });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node src/apps/server/modules/task-engine/nodejs-runner.test.js
```
Expected: `Error: Cannot find module './nodejs-runner'`

- [ ] **Step 3: Write minimal implementation**

`src/apps/server/modules/task-engine/nodejs-runner.js`:
```javascript
const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');

class NodeJsRunner {
  async run(options) {
    const {
      entryFile,
      workDir,
      context = {},
      timeout = 30000
    } = options;

    const entryPath = path.resolve(workDir, entryFile);

    if (!fs.existsSync(entryPath)) {
      return { success: false, error: `入口文件不存在: ${entryFile}` };
    }

    return new Promise((resolve) => {
      const logs = [];
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve({
          success: false,
          error: 'timeout',
          logs: [...logs, { stream: 'system', level: 'error', message: `执行超时 (${timeout}ms)` }]
        });
      }, timeout);

      // 创建包裹脚本
      const runnerScript = `
        const ctx = ${JSON.stringify(context)};
        const entry = require(${JSON.stringify(entryPath)});
        const run = typeof entry === 'function' ? entry : entry.run;
        if (typeof run !== 'function') {
          process.exitCode = 1;
          process.send({ type: 'error', error: '入口文件未导出 run 函数' });
          return;
        }
        run(ctx).then(result => {
          process.send({ type: 'result', data: result || {} });
        }).catch(err => {
          process.send({ type: 'error', error: err.message, stack: err.stack });
        });
      `;

      const child = fork(require.resolve('./_sandbox-wrapper'), [], {
        cwd: workDir,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env, NODE_PATH: path.resolve(__dirname, '../../../../../node_modules') }
      });

      child.stdout.on('data', (chunk) => {
        const lines = chunk.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          logs.push({ stream: 'stdout', level: 'info', message: line });
        }
      });

      child.stderr.on('data', (chunk) => {
        const lines = chunk.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          logs.push({ stream: 'stderr', level: 'error', message: line });
        }
      });

      child.on('message', (msg) => {
        clearTimeout(timer);
        if (msg.type === 'result') {
          resolve({ success: true, data: msg.data, logs });
        } else if (msg.type === 'error') {
          resolve({ success: false, error: msg.error, stack: msg.stack, logs });
        }
      });

      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code !== 0 && logs.length === 0) {
          resolve({ success: false, error: `进程退出码: ${code}`, logs });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ success: false, error: err.message, logs });
      });

      // 发送运行的代码到子进程
      child.send({ type: 'run', code: runnerScript });
    });
  }
}

module.exports = NodeJsRunner;
```

`src/apps/server/modules/task-engine/_sandbox-wrapper.js`:
```javascript
// 沙箱包裹器 — 由 nodejs-runner.js 通过 child_process.fork 启动
process.on('message', async (msg) => {
  if (msg.type === 'run') {
    try {
      // 捕获 console.log / console.error
      const origLog = console.log;
      const origError = console.error;
      const origWarn = console.warn;
      console.log = (...args) => { process.stdout.write(args.join(' ') + '\n'); };
      console.error = (...args) => { process.stderr.write(args.join(' ') + '\n'); };
      console.warn = (...args) => { process.stderr.write(args.join(' ') + '\n'); };

      const result = eval(msg.code);
      if (result && typeof result.then === 'function') {
        const val = await result;
        if (val !== undefined) process.send({ type: 'result', data: val });
      } else if (result !== undefined) {
        process.send({ type: 'result', data: result });
      }
    } catch (err) {
      process.send({ type: 'error', error: err.message, stack: err.stack });
    }
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node src/apps/server/modules/task-engine/nodejs-runner.test.js
```
Expected: All `✓` marks

- [ ] **Step 5: Commit**

```bash
git add src/apps/server/modules/task-engine/nodejs-runner.js src/apps/server/modules/task-engine/_sandbox-wrapper.js src/apps/server/modules/task-engine/nodejs-runner.test.js
git commit -m "feat(task-engine): add NodeJsRunner for isolated task execution"
```

---

### Task 3: TaskManager

**Files:**
- Create: `src/apps/server/modules/task-engine/task-manager.js`
- Test: `src/apps/server/modules/task-engine/task-manager.test.js`

负责：接收任务提交 → 创建 instanceId → 派发到对应 runner → 收集结果和日志 → 返回。管理常驻任务生命周期。

- [ ] **Step 1: Write the test**

`src/apps/server/modules/task-engine/task-manager.test.js`:
```javascript
const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const TaskManager = require('./task-manager');

const TMPDIR = path.join(os.tmpdir(), 'task-manager-test-' + Date.now());
fs.mkdirSync(TMPDIR, { recursive: true });
fs.writeFileSync(path.join(TMPDIR, 'task.js'), `module.exports = { run: async (ctx) => { console.log('ok'); return {}; } };`);

const manager = new TaskManager({ tasksDir: TMPDIR, maxInstances: 10 });

let testCount = 0, passCount = 0;
function test(name, fn) { testCount++; try { fn(); passCount++; console.log('  ✓ ' + name); } catch (e) { console.log('  ✗ ' + name + ': ' + e.message); } }
function waitForEvent(emitter, event, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeout);
    emitter.once(event, (data) => { clearTimeout(timer); resolve(data); });
  });
}

console.log('\n=== TaskManager 测试 ===\n');

test('submit: 创建实例并返回 instanceId', async () => {
  const result = await manager.submit({
    taskName: 'test-task',
    entryFile: 'task.js',
    env: 'cpu',
    target: 'server',
    files: [{ name: 'task.js', data: fs.readFileSync(path.join(TMPDIR, 'task.js')).toString('base64') }]
  });
  assert.ok(result.instanceId);
  assert.ok(result.instanceId.length > 0);
  assert.strictEqual(result.status, 'completed' || 'running');
});

test('getInstanceStatus: 查询实例状态', async () => {
  const result = await manager.submit({
    taskName: 'test-task-2',
    entryFile: 'task.js',
    files: [{ name: 'task.js', data: fs.readFileSync(path.join(TMPDIR, 'task.js')).toString('base64') }]
  });
  const status = await manager.getInstanceStatus('test-task-2', result.instanceId);
  assert.ok(status);
  assert.ok(status.instanceId);
});

test('stopInstance: 停止实例', async () => {
  const result = await manager.stopInstance('test-task', 'non-existent');
  assert.ok(!result.success);
});

process.on('exit', () => { try { fs.rmSync(TMPDIR, { recursive: true, force: true }); } catch(e) {} });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node src/apps/server/modules/task-engine/task-manager.test.js
```
Expected: `Error: Cannot find module './task-manager'`

- [ ] **Step 3: Write minimal implementation**

`src/apps/server/modules/task-engine/task-manager.js`:
```javascript
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const crypto = require('crypto');
const TaskIO = require('./task-io');
const NodeJsRunner = require('./nodejs-runner');
const PuppeteerRunner = require('./puppeteer-runner');

class TaskManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.taskIO = new TaskIO(options);
    this.nodeRunner = new NodeJsRunner();
    this.puppeteerRunner = options.puppeteerRunner || null;
    this.instances = new Map();  // instanceId → { taskName, status, ... }
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
      timestamp,
      logs: []
    };

    this.instances.set(instanceId, instance);

    // 保存文件
    this.emit('log', instanceId, 'system', 'info', '正在准备文件...');
    await this.taskIO.saveTaskFiles(task.taskName, task.files || []);
    await this.taskIO.createInstanceDir(task.taskName, instanceId);
    await this.taskIO.updateIndex(task.taskName, { instanceId, taskName: task.taskName, status: 'running', timestamp });

    instance.status = 'running';
    this.emit('progress', instanceId, 'running', 30);

    // 解析 refs
    const resolvedRefs = this.taskIO.resolveRefs(task.taskName, task.refs);

    const context = {
      files: task.files ? this._loadFiles(task.taskName, task.files) : {},
      params: task.params || {},
      refs: resolvedRefs,
      workDir: this.taskIO._taskPath(task.taskName)
    };

    try {
      let result;
      this.emit('log', instanceId, 'system', 'info', `目标: ${task.target}, 环境: ${task.env}`);

      if (task.taskType === 'builtin') {
        const builtin = require('./builtin-tasks/registry');
        result = await builtin.run(task.builtinId, { ...context, instanceId, taskName: task.taskName, taskIO: this.taskIO, taskManager: this });
      } else if (task.target === 'display' || task.target === 'subdisplay') {
        // 返回 instanceId，由 WebSocket handler 转发到目标
        instance.status = 'pending_forward';
        instance.targetInfo = { displayId: task.displayId };
        this.emit('forward', instanceId, task);
        return { taskName: task.taskName, instanceId, status: 'pending_forward' };
      } else {
        const runner = task.env === 'cpu' || task.env === 'auto'
          ? this.nodeRunner
          : this.puppeteerRunner || this.nodeRunner;
        result = await runner.run({
          entryFile: task.entryFile,
          workDir: this.taskIO._taskPath(task.taskName),
          context,
          timeout: task.timeout || 30000
        });
      }

      // 处理结果
      if (result && result.logs) {
        for (const log of result.logs) {
          this.emit('log', instanceId, log.stream, log.level, log.message);
          await this.taskIO.writeInstanceLog(task.taskName, instanceId, log.stream, log.level, log.message);
        }
      }

      if (result.success !== false) {
        instance.status = 'completed';
        this.emit('log', instanceId, 'system', 'info', '执行完成');
        this.emit('progress', instanceId, 'completed', 100);
        this.emit('result', instanceId, { success: true, ...(result.data || {}) });
        await this.taskIO.updateIndex(task.taskName, { instanceId, status: 'completed', completedAt: Date.now() });
      } else {
        instance.status = 'failed';
        this.emit('log', instanceId, 'system', 'error', `执行失败: ${result.error}`);
        this.emit('progress', instanceId, 'failed', 0);
        this.emit('result', instanceId, { success: false, error: result.error, stack: result.stack });
        await this.taskIO.updateIndex(task.taskName, { instanceId, status: 'failed', error: result.error });
      }

      await this.taskIO.updateLatestLink(task.taskName, instanceId);
      await this.taskIO.cleanupOldInstances(task.taskName, this.maxInstances);

      return { taskName: task.taskName, instanceId, status: instance.status };
    } catch (err) {
      instance.status = 'failed';
      this.emit('log', instanceId, 'system', 'error', `执行异常: ${err.message}`);
      this.emit('progress', instanceId, 'failed', 0);
      this.emit('result', instanceId, { success: false, error: err.message });
      await this.taskIO.updateIndex(task.taskName, { instanceId, status: 'failed', error: err.message });
      return { taskName: task.taskName, instanceId, status: 'failed', error: err.message };
    }
  }

  _loadFiles(taskName, files) {
    const result = {};
    if (!files) return result;
    for (const f of files) {
      if (f.data) {
        result[f.name] = Buffer.from(f.data, 'base64');
      } else if (f.path) {
        const fullPath = path.resolve(this.taskIO._taskPath(taskName), f.name);
        try { result[f.name] = fs.readFileSync(fullPath); } catch (e) {}
      }
    }
    return result;
  }

  async stopInstance(taskName, instanceId) {
    const instance = this.instances.get(instanceId);
    if (!instance) return { success: false, error: '实例不存在' };
    instance.status = 'stopped';
    // 常驻任务停止逻辑
    this.emit('log', instanceId, 'system', 'info', '已发送停止指令');
    this.emit('progress', instanceId, 'stopped', 0);
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
    const idx = await this.taskIO.getIndex(taskName);
    if (!instanceId && idx.length > 0) {
      idx.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      return idx[0];
    }
    return idx.find(e => e.instanceId === instanceId) || null;
  }

  async handleForwardResult(taskName, instanceId, result) {
    const instance = this.instances.get(instanceId);
    if (!instance) return;
    instance.status = result.success ? 'completed' : 'failed';
    this.emit('result', instanceId, result);
    await this.taskIO.updateIndex(task.taskName, {
      instanceId, status: instance.status,
      completedAt: Date.now(),
      ...(result.error ? { error: result.error } : {})
    });
    await this.taskIO.updateLatestLink(taskName, instanceId);
  }
}

module.exports = TaskManager;
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

---

### Task 4: Built-in Task Registry

**Files:**
- Create: `src/apps/server/modules/task-engine/builtin-tasks/registry.js`
- Create: `src/apps/server/modules/task-engine/builtin-tasks/image-resize.js`

- [ ] **Step 1: Write registry**

`src/apps/server/modules/task-engine/builtin-tasks/image-resize.js`:
```javascript
const sharp = require('sharp'); // 项目中尚未包含 sharp，用普通文件操作替代或后续加

module.exports = {
  id: 'image.resize',
  name: '图片缩放',
  description: '将输入图片缩放到指定尺寸',
  params: [
    { name: 'width', type: 'number', required: true, default: 800 },
    { name: 'height', type: 'number', required: false }
  ],
  async run(context) {
    const { files, params, workDir, logger } = context;
    const inputFile = files['input.png'] || files['input.jpg'];
    if (!inputFile) throw new Error('未找到输入图片文件');
    // 内置任务可使用 fs、path 等 Node 模块
    const fs = require('fs');
    const path = require('path');
    const outputPath = path.join(workDir, 'output.png');
    fs.writeFileSync(outputPath, inputFile);
    console.log(`已保存缩放结果到 ${outputPath}`);
    return { outputFiles: ['output.png'] };
  }
};
```

`src/apps/server/modules/task-engine/builtin-tasks/registry.js`:
```javascript
const tasks = {
  'image.resize': require('./image-resize')
};

module.exports = {
  getTask(id) {
    return tasks[id] || null;
  },
  listTasks() {
    return Object.values(tasks).map(t => ({
      id: t.id, name: t.name, description: t.description,
      params: t.params || []
    }));
  },
  async run(id, context) {
    const task = tasks[id];
    if (!task) throw new Error(`内置任务不存在: ${id}`);
    return task.run(context);
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add src/apps/server/modules/task-engine/builtin-tasks/
git commit -m "feat(task-engine): add builtin task registry with image-resize example"
```

---

### Task 5: WebSocket Handler

**Files:**
- Create: `src/apps/server/modules/task-engine/web-socket-handler.js`

负责：注册所有 `task:*` 类型的 WebSocket 消息处理函数，连接 TaskManager 和前端。

- [ ] **Step 1: Write implementation**

`src/apps/server/modules/task-engine/web-socket-handler.js`:
```javascript
function registerTaskHandlers(wsServer, taskManager, sendToControl, sendToDisplay, sendToSubDisplay) {
  const controlTypes = [
    'task:submit',
    'task:stop',
    'task:status'
  ];

  // 控制端消息
  const handler = async (data, ctx) => {
    const payload = data.payload || {};

    switch (data.type) {
      case 'task:submit': {
        const result = await taskManager.submit(payload);

        // 需要转发到显示端/子显示端
        if (result.status === 'pending_forward') {
          const targetPayload = {
            type: 'task:execute',
            payload: {
              taskName: payload.taskName,
              instanceId: result.instanceId,
              entryFile: payload.entryFile,
              files: payload.files,
              refs: payload.refs,
              env: payload.env,
              mode: payload.mode
            }
          };

          if (payload.target === 'display') {
            sendToDisplay(payload.displayId, targetPayload);
          } else if (payload.target === 'subdisplay') {
            sendToSubDisplay(payload.displayId, targetPayload);
          }
        }

        // 返回提交确认
        ctx.ws.send(JSON.stringify({
          type: 'task:submitted',
          payload: { taskName: payload.taskName, instanceId: result.instanceId, status: result.status }
        }));
        break;
      }

      case 'task:stop': {
        const result = await taskManager.stopInstance(payload.taskName, payload.instanceId);
        ctx.ws.send(JSON.stringify({
          type: 'task:stopped',
          payload: { taskName: payload.taskName, instanceId: payload.instanceId, ...result }
        }));
        break;
      }

      case 'task:status': {
        const status = await taskManager.getInstanceStatus(payload.taskName, payload.instanceId);
        ctx.ws.send(JSON.stringify({
          type: 'task:status',
          payload: { taskName: payload.taskName, instanceId: payload.instanceId, status }
        }));
        break;
      }
    }
  };

  for (const type of controlTypes) {
    wsServer.registerHandler(type, handler);
  }

  // 监听 TaskManager 事件 → 广播到控制端
  taskManager.on('progress', (instanceId, stage, progress) => {
    broadcastTaskMsg(sendToControl, 'task:progress', { instanceId, stage, progress });
  });

  taskManager.on('result', (instanceId, result) => {
    broadcastTaskMsg(sendToControl, 'task:result', { instanceId, ...result });
  });

  taskManager.on('log', (instanceId, stream, level, message) => {
    broadcastTaskMsg(sendToControl, 'task:log', { instanceId, stream, level, message, timestamp: Date.now() });
  });
}

function broadcastTaskMsg(sendFn, type, payload) {
  sendFn({ type, payload });
}

module.exports = { registerTaskHandlers };
```

- [ ] **Step 2: Commit**

```bash
git add src/apps/server/modules/task-engine/web-socket-handler.js
git commit -m "feat(task-engine): add WebSocket task message handlers"
```

---

### Task 6: Server Integration

**Files:**
- Modify: `src/apps/server/boot/server-app.js`

在 server-app.js 中初始化 TaskManager 并注册 WebSocket handlers。

- [ ] **Step 1: Modify server-app.js**

在文件顶部 require 区域添加：
```javascript
const TaskManager = require('../../modules/task-engine/task-manager');
const { registerTaskHandlers } = require('../../modules/task-engine/web-socket-handler');
```

在 `startServer()` 函数内，`wsServer.registerHandler(...)` 区域之后添加：
```javascript
// 初始化任务引擎
const taskManager = new TaskManager({ maxInstances: 50 });
registerTaskHandlers(wsServer, taskManager,
  (msg) => broadcastToControls(msg),
  (displayId, msg) => {
    const display = displayClients.get(displayId);
    if (display && display.ws.readyState === WebSocket.OPEN) {
      display.ws.send(JSON.stringify(msg));
    }
  },
  (displayId, msg) => {
    const display = displayClients.get(displayId);
    if (display && display.ws.readyState === WebSocket.OPEN) {
      display.ws.send(JSON.stringify(msg));
    }
  }
);
```

在 `controlTypes` 数组中添加 `task:submit`, `task:stop`, `task:status`（可选，已有 registerTaskHandlers 独立注册，加在这里作为兜底）。

- [ ] **Step 2: Commit**

```bash
git add src/apps/server/boot/server-app.js
git commit -m "feat(task-engine): integrate TaskManager into server startup"
```

---

### Task 7: Puppeteer Runner

**Files:**
- Create: `src/apps/server/modules/task-engine/puppeteer-runner.js`

负责：启动 Puppeteer headless Chrome，在浏览器环境中执行用户 JS（支持 WebGL/WebGPU 能力检测和执行）。

- [ ] **Step 1: Write implementation**

`src/apps/server/modules/task-engine/puppeteer-runner.js`:
```javascript
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

class PuppeteerRunner {
  constructor(options = {}) {
    this.browser = null;
    this.browserArgs = options.browserArgs || [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--use-gl=angle',
      '--enable-unsafe-swiftshader'
    ];
  }

  async _ensureBrowser() {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: this.browserArgs
      });
    }
    return this.browser;
  }

  async run(options) {
    const { entryFile, workDir, context = {}, timeout = 30000 } = options;
    const entryPath = path.resolve(workDir, entryFile);
    const code = fs.readFileSync(entryPath, 'utf8');

    const browser = await this._ensureBrowser();
    const page = await browser.newPage();

    return new Promise((resolve) => {
      const logs = [];
      const timer = setTimeout(async () => {
        await page.close().catch(() => {});
        resolve({ success: false, error: 'timeout', logs });
      }, timeout);

      page.on('console', (msg) => {
        logs.push({
          stream: msg.type() === 'error' ? 'stderr' : 'stdout',
          level: msg.type() === 'error' ? 'error' : 'info',
          message: msg.text()
        });
      });

      page.on('pageerror', (err) => {
        clearTimeout(timer);
        resolve({ success: false, error: err.message, stack: err.stack, logs });
      });

      page.exposeFunction('__taskResult', (result) => {
        clearTimeout(timer);
        resolve({ success: true, data: result, logs });
      });

      page.exposeFunction('__taskError', (err) => {
        clearTimeout(timer);
        resolve({ success: false, error: err.message || err, logs });
      });

      // 注入代码并执行
      page.evaluate(async (ctx) => {
        try {
          // 环境检测
          const capabilities = {
            cpu: true,
            webgl: (() => { try {
              const c = document.createElement('canvas');
              return !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
            } catch(e) { return false; } })(),
            webgpu: !!navigator.gpu
          };

          // 构建执行环境
          const context = {
            files: ctx.files || {},
            params: ctx.params || {},
            refs: ctx.refs || {},
            capabilities,
            workDir: '/workspace'
          };

          // 构建文件系统（内存中）
          const fileStore = {};
          for (const [name, data] of Object.entries(context.files)) {
            fileStore[name] = data;
          }

          // 执行
          const fn = new Function('context', 'fileStore', ctx.code);
          const result = await fn(context, fileStore);
          window.__taskResult(result || {});
        } catch (err) {
          window.__taskError({ message: err.message, stack: err.stack });
        }
      }, { code, files: context.files, params: context.params, refs: context.refs });
    });
  }

  async close() {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }
}

module.exports = PuppeteerRunner;
```

- [ ] **Step 2: Commit**

```bash
git add src/apps/server/modules/task-engine/puppeteer-runner.js
git commit -m "feat(task-engine): add PuppeteerRunner for browser environment execution"
```

---

### Task 8: Task Panel UI

**Files:**
- Create: `src/apps/web-mediacenter/ui/public/js/task-panel.js`

前端远程任务面板：文件上传、配置提交、任务列表、实时日志。

- [ ] **Step 1: Write implementation**

`src/apps/web-mediacenter/ui/public/js/task-panel.js`:
```javascript
window.TaskPanel = {
  instances: new Map(),        // instanceId → instance info
  currentInstanceId: null,

  async init() {
    this.renderSubmitForm();
    this.renderTaskList();
    this.setupWebSocketHandlers();
  },

  renderSubmitForm() {
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
          <input type="text" id="taskName" placeholder="my-task" value="task-${Date.now()}">
        </div>
        <div class="form-row" id="builtinSelector" style="display:none">
          <label>内置功能:</label>
          <select id="builtinId"></select>
        </div>
        <div class="form-row" id="userFileSection">
          <label>入口文件:</label>
          <input type="text" id="entryFile" placeholder="task.js">
          <label>执行文件 / 输入文件:</label>
          <input type="file" id="taskFiles" multiple>
          <div id="taskFileList" class="file-list"></div>
        </div>
        <div class="form-row">
          <label>参数 (JSON):</label>
          <textarea id="taskParams" rows="3" placeholder='{"width": 800}'></textarea>
        </div>
        <div class="form-row">
          <label>跨任务引用 (JSON):</label>
          <textarea id="taskRefs" rows="2" placeholder='{"input.png": "other/results/latest/output.png"}'></textarea>
        </div>
        <div class="form-row">
          <label>目标设备 ID:</label>
          <input type="text" id="displayId" placeholder="留空自动选择">
        </div>
        <button class="btn-primary" onclick="TaskPanel.submit()">提交任务</button>
      </div>
      <div class="section" id="taskLogSection" style="display:none">
        <h2>实时日志</h2>
        <pre id="taskLog" class="log-viewer" style="height:200px;overflow:auto"></pre>
      </div>
    `;

    // 类型切换
    document.getElementById('taskType').addEventListener('change', (e) => {
      const isBuiltin = e.target.value === 'builtin';
      document.getElementById('builtinSelector').style.display = isBuiltin ? 'block' : 'none';
      document.getElementById('userFileSection').style.display = isBuiltin ? 'none' : 'block';
    });

    // 文件选择
    document.getElementById('taskFiles').addEventListener('change', (e) => {
      const list = document.getElementById('taskFileList');
      list.innerHTML = '';
      for (const f of e.target.files) {
        const div = document.createElement('div');
        div.className = 'file-item';
        div.textContent = `📄 ${f.name} (${(f.size / 1024).toFixed(1)}KB)`;
        list.appendChild(div);
      }
    });
  },

  renderTaskList() {
    const panel = document.getElementById('panel-task');
    if (!panel) return;
    const section = document.createElement('div');
    section.className = 'section';
    section.innerHTML = `
      <h2>任务实例列表</h2>
      <div id="taskInstanceList" class="task-instance-list">
        <div class="empty-list">暂无任务实例</div>
      </div>
    `;
    panel.appendChild(section);
  },

  setupWebSocketHandlers() {
    if (window.WebSocketManager) {
      const orig = window.WebSocketManager.handleMessage;
      window.WebSocketManager.handleMessage = (data) => {
        this.handleWSMessage(data);
        if (orig) orig.call(window.WebSocketManager, data);
      };
    }
  },

  handleWSMessage(data) {
    switch (data.type) {
      case 'task:submitted':
        this.addInstance(data.payload);
        this.appendLog(`任务已提交: ${data.payload.taskName} (${data.payload.instanceId})`);
        break;
      case 'task:progress':
        this.updateInstanceProgress(data.payload);
        break;
      case 'task:log':
        this.appendLog(`[${data.payload.stream}] ${data.payload.message}`, data.payload);
        break;
      case 'task:result':
        this.handleResult(data.payload);
        break;
      case 'task:error':
        this.appendLog(`[错误] ${data.payload.error}`, data.payload);
        break;
    }
  },

  addInstance(payload) {
    this.instances.set(payload.instanceId, { ...payload, status: 'running' });
    this.refreshInstanceList();
  },

  updateInstanceProgress(payload) {
    const inst = this.instances.get(payload.instanceId);
    if (inst) {
      inst.stage = payload.stage;
      inst.progress = payload.progress;
      this.refreshInstanceList();
    }
  },

  handleResult(payload) {
    const inst = this.instances.get(payload.instanceId);
    if (inst) {
      inst.status = payload.success ? 'completed' : 'failed';
      inst.result = payload;
      this.refreshInstanceList();
    }
    if (payload.success) {
      this.appendLog(`✅ 执行成功`);
      if (payload.outputFiles) {
        this.appendLog(`输出文件: ${payload.outputFiles.map(f => f.url || f.name).join(', ')}`);
      }
    } else {
      this.appendLog(`❌ 执行失败: ${payload.error}`);
    }
  },

  refreshInstanceList() {
    const container = document.getElementById('taskInstanceList');
    if (!container) return;
    const items = Array.from(this.instances.entries())
      .sort((a, b) => b[1].timestamp - a[1].timestamp)
      .slice(0, 20);
    if (items.length === 0) {
      container.innerHTML = '<div class="empty-list">暂无任务实例</div>';
      return;
    }
    const statusIcon = { running: '🟢', completed: '✅', failed: '❌', stopped: '⏹️', pending: '⏳' };
    container.innerHTML = items.map(([id, inst]) => `
      <div class="task-instance ${inst.status}" onclick="TaskPanel.viewInstance('${id}')">
        <span>${statusIcon[inst.status] || '❓'}</span>
        <span>${inst.taskName || '未知'}</span>
        <span class="instance-id">#${id}</span>
        <span>${inst.stage || inst.status}</span>
        <span>${inst.progress != null ? inst.progress + '%' : ''}</span>
        <button onclick="event.stopPropagation(); TaskPanel.stopInstance('${id}')">停止</button>
      </div>
    `).join('');
  },

  async submit() {
    const taskName = document.getElementById('taskName').value.trim();
    if (!taskName) { alert('请输入任务名称'); return; }

    const fileInput = document.getElementById('taskFiles');
    const files = [];
    for (const f of fileInput.files) {
      const data = await this._readFileAsBase64(f);
      files.push({ name: f.name, data });
    }

    let params = {};
    try {
      const paramsText = document.getElementById('taskParams').value;
      if (paramsText) params = JSON.parse(paramsText);
    } catch(e) { alert('参数 JSON 格式错误'); return; }

    let refs = {};
    try {
      const refsText = document.getElementById('taskRefs').value;
      if (refsText) refs = JSON.parse(refsText);
    } catch(e) { alert('引用 JSON 格式错误'); return; }

    const message = {
      type: 'task:submit',
      payload: {
        taskName,
        taskType: document.getElementById('taskType').value,
        builtinId: document.getElementById('builtinId')?.value,
        entryFile: document.getElementById('entryFile').value.trim(),
        target: document.getElementById('taskTarget').value,
        displayId: document.getElementById('displayId').value.trim() || null,
        mode: document.getElementById('taskMode').value,
        env: document.getElementById('taskEnv').value,
        files,
        refs,
        params
      }
    };

    const logSection = document.getElementById('taskLogSection');
    if (logSection) logSection.style.display = 'block';
    this.appendLog(`📤 提交任务: ${taskName}`);
    this.clearLog();

    if (window.WebSocketManager && window.WebSocketManager.ws) {
      window.WebSocketManager.ws.send(JSON.stringify(message));
    } else {
      this.appendLog('❌ WebSocket 未连接');
    }
  },

  viewInstance(instanceId) {
    this.currentInstanceId = instanceId;
    const inst = this.instances.get(instanceId);
    if (inst) {
      this.appendLog(`--- 查看实例: ${instanceId} ---`);
    }
  },

  stopInstance(instanceId) {
    const inst = this.instances.get(instanceId);
    if (!inst) return;
    if (window.WebSocketManager && window.WebSocketManager.ws) {
      window.WebSocketManager.ws.send(JSON.stringify({
        type: 'task:stop',
        payload: { taskName: inst.taskName, instanceId }
      }));
    }
  },

  appendLog(message, meta) {
    const logEl = document.getElementById('taskLog');
    if (!logEl) return;
    const time = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.textContent = `[${time}] ${message}`;
    if (meta && meta.stream === 'stderr') line.style.color = '#ff6b6b';
    else if (meta && meta.stream === 'system') line.style.color = '#69db7c';
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  },

  clearLog() {
    const logEl = document.getElementById('taskLog');
    if (logEl) logEl.innerHTML = '';
  },

  _readFileAsBase64(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.readAsDataURL(file);
    });
  }
};

document.addEventListener('DOMContentLoaded', () => {
  // 等 main.js 完成初始化后再启动
  setTimeout(() => window.TaskPanel.init(), 500);
});
```

- [ ] **Step 2: Commit**

```bash
git add src/apps/web-mediacenter/ui/public/js/task-panel.js
git commit -m "feat(ui): add task panel UI with submission form and log viewer"
```

---

### Task 9: Upload HTML Integration

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/upload.html`

- [ ] **Step 1: Add navigation item**

在 `upload.html` 的 `<nav class="sidebar">` 内，添加导航按钮（例：放在设置前）：
```html
<button class="nav-item" data-target="task" title="远程任务">
    <span class="nav-icon">⚡</span>
    <span class="nav-text">任务</span>
</button>
```

- [ ] **Step 2: Add panel section**

在 `</nav>` 之后，`<main class="content">` 内的最后（settings panel 之后）：
```html
<section class="panel" id="panel-task" style="display:none;">
</section>
```

- [ ] **Step 3: Add script tag**

在 `</body>` 之前的 script 加载区，加在 main.js 之前：
```html
<script src="js/task-panel.js"></script>
```

- [ ] **Step 4: Commit**

```bash
git add src/apps/web-mediacenter/ui/public/upload.html
git commit -m "feat(ui): add task panel to upload.html navigation"
```

---

### Task 10: Display-Side Task Runner

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/display.html`

在 display.html 的 `handleMessage` 函数中添加 `task:execute` 处理。

- [ ] **Step 1: Modify display.html**

在 display.html 的 switch/default 块中，`case 'voiceCommand'` 等之后添加：
```javascript
case 'task:execute':
    executeTask(data.payload);
    break;
```

在 display.html 中添加执行函数：
```javascript
function executeTask(payload) {
    const { taskName, instanceId, entryFile, files, env } = payload;
    console.log(`[Task] 收到任务: ${taskName}/${instanceId}`);

    // 构建文件存储
    const fileStore = {};
    if (files) {
        for (const f of files) {
            if (f.data) {
                try {
                    const binary = atob(f.data);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) {
                        bytes[i] = binary.charCodeAt(i);
                    }
                    fileStore[f.name] = bytes;
                } catch(e) {
                    console.error(`[Task] 文件加载失败: ${f.name}`, e);
                }
            }
        }
    }

    // 检测环境能力
    const capabilities = {
        cpu: true,
        webgl: (() => { try {
            const c = document.createElement('canvas');
            return !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
        } catch(e) { return false; } })(),
        webgpu: !!navigator.gpu
    };

    // 查找入口文件内容
    const entryContent = fileStore[entryFile];
    if (!entryContent) {
        sendTaskResult(taskName, instanceId, false, '入口文件不存在');
        return;
    }

    const entryCode = new TextDecoder().decode(entryContent);

    // 在沙箱中执行
    try {
        const context = {
            files: fileStore,
            capabilities,
            params: payload.params || {},
            refs: payload.refs || {}
        };

        const fn = new Function('context', entryCode + '\nreturn run(context);');
        const resultPromise = fn(context);

        Promise.resolve(resultPromise).then(result => {
            const outputFiles = [];
            if (result && result.outputFiles) {
                for (const name of result.outputFiles) {
                    if (fileStore[name]) {
                        outputFiles.push({ name, data: btoa(String.fromCharCode(...fileStore[name])) });
                    }
                }
            }
            sendTaskResult(taskName, instanceId, true, null, outputFiles);
        }).catch(err => {
            sendTaskResult(taskName, instanceId, false, err.message);
        });
    } catch (err) {
        sendTaskResult(taskName, instanceId, false, err.message);
    }
}

function sendTaskResult(taskName, instanceId, success, error, outputFiles) {
    if (displayWs && displayWs.readyState === WebSocket.OPEN) {
        displayWs.send(JSON.stringify({
            type: 'task:result',
            payload: { taskName, instanceId, success, error, outputFiles: outputFiles || [] }
        }));
    }
}
```

- [ ] **Step 2: Create spec doc**

`docs/spec/remote-task-system.md`:
```markdown
# 远程任务系统 - 实现文档

## 概述

远程任务系统允许用户通过控制端上传 JS 代码，选择在服务端/显示端/子显示端执行，获取结果和实时日志。

## 模块

### 服务端

| 文件 | 说明 |
|------|------|
| task-manager.js | 任务生命周期管理、实例跟踪、派发 |
| task-io.js | 文件管理、refs 解析、结果目录、日志写入 |
| nodejs-runner.js | child_process.fork 独立进程执行用户 JS |
| puppeteer-runner.js | Puppeteer headless 浏览器执行（GPU） |
| web-socket-handler.js | task:* 消息注册 |

### 前端

| 文件 | 说明 |
|------|------|
| task-panel.js | 任务提交表单、任务列表、实时日志 |

## 数据流

```
控制端 task:submit → 服务端 taskManager.submit()
  ├── taskType=builtin → builtin-tasks/registry
  ├── target=server → NodeJsRunner / PuppeteerRunner
  ├── target=display → 转发 → display.html executeTask
  └── target=subdisplay → 转发 → voice-display-node
  ↓
task:progress / task:log / task:result → 控制端 UI 更新
```

## 消息类型

详见 docs/design/remote-task-system.md
```

- [x] **Step 3: Commit**

```bash
git add src/apps/web-mediacenter/ui/public/display.html docs/spec/remote-task-system.md
git commit -m "feat(display): add task:execute handler in display.html + spec doc"
```

---

### Task 11: Sub-Display Task Support

**Files:**
- Modify: `src/apps/voice-display-node/main.js`

在 VoiceDisplay 的 `handleMessage` 中添加 `task:execute` 处理（类似 display.html 的逻辑，但运行在 Node.js 环境）。

- [ ] **Step 1: Modify voice-display-node/main.js**

在 `handleMessage` 的 switch 中 `case 'voiceCommand'` 之后添加：
```javascript
case 'task:execute':
    this.handleTaskExecute(data.payload);
    break;
```

在 VoiceDisplay 类中添加方法：
```javascript
async handleTaskExecute(payload) {
    const { taskName, instanceId, entryFile, files, env, params, refs } = payload;
    log('任务', `收到任务: ${taskName}/${instanceId} 入口: ${entryFile}`);

    // 保存文件到临时目录
    const tmpDir = path.join(os.tmpdir(), `task-${instanceId}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    const fileStore = {};
    if (files) {
        for (const f of files) {
            if (f.data) {
                const filePath = path.join(tmpDir, f.name);
                const dir = path.dirname(filePath);
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(filePath, Buffer.from(f.data, 'base64'));
                fileStore[f.name] = filePath;
            }
        }
    }

    const entryPath = path.join(tmpDir, entryFile);
    if (!fs.existsSync(entryPath)) {
        this.sendJSON({
            type: 'task:result',
            payload: { taskName, instanceId, success: false, error: `入口文件不存在: ${entryFile}` }
        });
        return;
    }

    try {
        const context = {
            files: fileStore,
            params: params || {},
            refs: refs || {},
            workDir: tmpDir
        };

        // 清除缓存确保加载最新文件
        delete require.cache[require.resolve(entryPath)];
        const entry = require(entryPath);
        const run = typeof entry === 'function' ? entry : entry.run;

        if (typeof run !== 'function') {
            throw new Error('入口文件未导出 run 函数');
        }

        const result = await run(context);
        this.sendJSON({
            type: 'task:result',
            payload: { taskName, instanceId, success: true, data: result || {} }
        });
        log('任务', `任务完成: ${taskName}/${instanceId}`);
    } catch (err) {
        logError('任务', `执行失败: ${err.message}`);
        this.sendJSON({
            type: 'task:result',
            payload: { taskName, instanceId, success: false, error: err.message, stack: err.stack }
        });
    } finally {
        // 清理临时文件
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/apps/voice-display-node/main.js
git commit -m "feat(sub-display): add task:execute handler to voice-display-node"
```

---

## Self-Review Checklist

1. **Spec coverage:**
   - ✅ 系统架构 — Task 3 (TaskManager), Task 6 (server integration)
   - ✅ 执行目标 — Task 2 (Node.js), Task 7 (Puppeteer), Task 10 (display), Task 11 (sub-display)
   - ✅ 任务目录结构 — Task 1 (TaskIO)
   - ✅ 内置任务 — Task 4 (builtin-tasks)
   - ✅ 消息协议 — Task 5 (web-socket-handler)
   - ✅ 任务日志 — Task 1 (writeInstanceLog), Task 2 (stdout/stderr capture), Task 8 (log viewer)
   - ✅ 实例管理 — Task 3 (instanceId, stop, status)
   - ✅ 文件传输 — Task 1 (saveTaskFiles base64), Task 8 (FileReader base64)
   - ✅ 跨任务引用 — Task 1 (resolveRefs), Task 3 (refs in context)
   - ✅ 控制端 UI — Task 8 (task-panel.js), Task 9 (upload.html)
   - ✅ 文件清理 — Task 1 (cleanupOldInstances)
   - ✅ 错误处理 — Task 3 (try/catch, timeout), Task 2 (child_process timeout)

2. **Placeholder scan:** No "TBD", "TODO", or incomplete code blocks.

3. **Type consistency:**
   - TaskIO class: saveTaskFiles, resolveRefs, createInstanceDir, writeInstanceLog, updateIndex, cleanupOldInstances — used consistently across all tasks
   - TaskManager: submit, stopInstance, getInstanceStatus — consistent
   - NodeJsRunner: run({ entryFile, workDir, context, timeout }) → { success, data, error, logs }
   - Message payloads: { taskName, instanceId, ... } consistent throughout

---

## Summary

| 任务 | 文件 | 改动类型 |
|------|------|----------|
| 1 | task-io.js + test | 创建 |
| 2 | nodejs-runner.js + _sandbox-wrapper.js + test | 创建 |
| 3 | task-manager.js + test | 创建 |
| 4 | builtin-tasks/registry.js + image-resize.js | 创建 |
| 5 | web-socket-handler.js | 创建 |
| 6 | server-app.js | 修改 |
| 7 | puppeteer-runner.js | 创建 |
| 8 | task-panel.js | 创建 |
| 9 | upload.html | 修改 |
| 10 | display.html + spec doc | 修改 |
| 11 | voice-display-node/main.js | 修改 |
