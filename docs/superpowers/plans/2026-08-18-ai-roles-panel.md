# AI 角色面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 控制端网页聊天面板可添加/删除「工作 AI 角色」，每角色一个持久 claude 独立对话（复用聊天 UI，服务器重启进程不中断）。

**Architecture:** 前端完全复用现有聊天面板（tab + 输入框 + 流式气泡），新增 `mode:'role'` 对话模式与角色 tab。后端新增 `src/apps/server/modules/ai-roles/` 模块：`role-store` 持久化角色/历史，`pipe-keeper`（detached 微型进程持有 in.fifo 写端防 claude stdin EOF），`claude-bridge` 每角色懒启动一个 detached claude（stream-json 协议走 FIFO），`ai-roles-service` 聚合。`server-app.js` 在 `chatMessage` 分支检测 `mode==='role'` 转交 ai-roles 服务，返回标准 `chatChunk`/`chatResponse`。

**Tech Stack:** Node.js（v25.7，node:test），Linux `mkfifo` 命令，Claude CLI `claude --print --verbose --input-format stream-json --output-format stream-json --include-partial-messages`，`ws` WebSocket。

## Global Constraints

- 使用 `const/let`，不用 `var`；异步用 `async/await`；错误处理用 `try-catch`
- 注释用中文，说明「为什么」而非「是什么」
- 遵守 AASC 规则：避免大段 `if-else-if` 链（新代码用小的单一职责函数/映射表）
- 每任务 TDD：先写失败测试 → 跑确认失败 → 实现 → 跑确认通过 → 提交
- 运行时状态目录：`~/.config/aasc-user/ai-roles/<角色名>/`（`USER_CONFIG_DIR`，退出 git 跟踪，重启保留）
- 角色提示词复用 `workgroup/roles/<角色名>.md` 内容（不存在用默认提示词）
- claude 进程必须 `detached`（服务器重启不中断），靠 PID 文件 + `kill(pid,0)` 存活检测管理，删除角色必须可回收（SIGTERM→2s→SIGKILL）

---

### Task 1: role-store（角色与对话历史持久化）

**Files:**
- Create: `src/apps/server/modules/ai-roles/role-store.js`
- Test: `src/apps/server/modules/ai-roles/role-store.test.js`

**Interfaces:**
- Consumes: 无
- Produces: `class RoleStore`，构造 `new RoleStore(baseDir)`；方法 `list() → [{name,createdAt}]`、`exists(name) → bool`、`add(name, createdAt?) → {name,createdAt}`（重名/空名抛 `Error`）、`remove(name)`、`loadHistory(name) → Array`、`appendHistory(name, msg) → Array`、`roleDir(name) → string`（后续任务依赖 `roleDir`）

- [ ] **Step 1: 写失败测试**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const RoleStore = require('./role-store');

function tmpBase() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'role-store-'));
}

test('add/list/exists/remove 往返', () => {
    const store = new RoleStore(tmpBase());
    const role = store.add('后端助手');
    assert.deepStrictEqual(role, { name: '后端助手', createdAt: role.createdAt });
    assert.ok(store.exists('后端助手'));
    assert.deepStrictEqual(store.list(), [role]);
    store.remove('后端助手');
    assert.ok(!store.exists('后端助手'));
    assert.deepStrictEqual(store.list(), []);
});

test('重名/空名抛错', () => {
    const store = new RoleStore(tmpBase());
    store.add('a');
    assert.throws(() => store.add('a'), /已存在/);
    assert.throws(() => store.add('  '), /不能为空/);
});

test('appendHistory/loadHistory 往返且持久', () => {
    const base = tmpBase();
    const store = new RoleStore(base);
    store.add('前端');
    store.appendHistory('前端', { role: 'control', name: '用户', content: 'hi', mode: 'role', target: '前端' });
    const hist = store.appendHistory('前端', { role: 'assistant', name: '前端', content: 'hello', mode: 'role', target: '前端' });
    assert.strictEqual(hist.length, 2);
    // 重新实例化（模拟服务器重启）后历史仍在
    const store2 = new RoleStore(base);
    assert.strictEqual(store2.loadHistory('前端').length, 2);
    assert.strictEqual(store2.loadHistory('前端')[1].content, 'hello');
});

test('不存在角色 history 返回空数组', () => {
    const store = new RoleStore(tmpBase());
    assert.deepStrictEqual(store.loadHistory('nobody'), []);
});

test('roleDir 返回角色目录绝对路径', () => {
    const base = tmpBase();
    const store = new RoleStore(base);
    assert.strictEqual(store.roleDir('a'), path.join(base, 'a'));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test src/apps/server/modules/ai-roles/role-store.test.js`
Expected: FAIL with `Error: Cannot find module './role-store'`

- [ ] **Step 3: 实现 role-store.js**

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');

// 角色与对话历史持久化：每个角色一个子目录（role.json + history.json）。
// 运行时状态（含历史）落盘，服务器重启后角色与对话都保留。
class RoleStore {
    constructor(baseDir) {
        this.baseDir = baseDir; // ai-roles 根目录
    }

    roleDir(name) { return path.join(this.baseDir, name); }
    _roleFile(name) { return path.join(this.roleDir(name), 'role.json'); }
    _historyFile(name) { return path.join(this.roleDir(name), 'history.json'); }

    _readRole(name) {
        try { return JSON.parse(fs.readFileSync(this._roleFile(name), 'utf8')); } catch (_) { return null; }
    }

    // 列出所有角色（跳过残留的非法目录）
    list() {
        try {
            return fs.readdirSync(this.baseDir, { withFileTypes: true })
                .filter((d) => d.isDirectory() && this._readRole(d.name))
                .map((d) => this._readRole(d.name));
        } catch (_) { return []; }
    }

    exists(name) { return !!this._readRole(name); }

    add(name, createdAt = Date.now()) {
        if (!name || typeof name !== 'string' || !name.trim()) throw new Error('角色名不能为空');
        const clean = name.trim();
        if (this.exists(clean)) throw new Error(`角色「${clean}」已存在`);
        fs.mkdirSync(this.roleDir(clean), { recursive: true });
        fs.writeFileSync(this._roleFile(clean), JSON.stringify({ name: clean, createdAt }, null, 2));
        return { name: clean, createdAt };
    }

    remove(name) {
        fs.rmSync(this.roleDir(name), { recursive: true, force: true });
    }

    loadHistory(name) {
        try { return JSON.parse(fs.readFileSync(this._historyFile(name), 'utf8')) || []; } catch (_) { return []; }
    }

    appendHistory(name, msg) {
        const history = this.loadHistory(name);
        history.push({ ...msg, timestamp: msg.timestamp || Date.now() });
        fs.mkdirSync(this.roleDir(name), { recursive: true });
        fs.writeFileSync(this._historyFile(name), JSON.stringify(history, null, 2));
        return history;
    }
}
module.exports = RoleStore;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test src/apps/server/modules/ai-roles/role-store.test.js`
Expected: PASS (5 个用例)

- [ ] **Step 5: 提交**

```bash
git add src/apps/server/modules/ai-roles/role-store.js src/apps/server/modules/ai-roles/role-store.test.js
git commit -m "feat(ai-roles): role-store 角色与对话历史持久化"
```

---

### Task 2: pipe-keeper（FIFO 管道守卫）

**Files:**
- Create: `src/apps/server/modules/ai-roles/pipe-keeper.js`
- Test: `src/apps/server/modules/ai-roles/pipe-keeper.test.js`

**Interfaces:**
- Consumes: 无（Task 3 会 spawn 它）
- Produces: CLI 程序 `node pipe-keeper.js <inFifo> <pidFile>`：以 O_RDWR 打开 in.fifo 持有写端，写自身 PID 到 pidFile，直到 SIGTERM/SIGINT 退出

- [ ] **Step 1: 写失败测试**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-')); }
const KEEPER = path.join(__dirname, 'pipe-keeper.js');

test('守卫持有 in.fifo 写端并记录 PID，可 SIGTERM 退出', async () => {
    const dir = tmpDir();
    const inFifo = path.join(dir, 'in.fifo');
    const pidFile = path.join(dir, 'keeper.pid');
    execFileSync('mkfifo', [inFifo]);

    const keeper = spawn(process.execPath, [KEEPER, inFifo, pidFile], { stdio: 'ignore' });
    // 等待 pid 文件出现（表示已打开 in.fifo 写端）
    const deadline = Date.now() + 3000;
    while (!fs.existsSync(pidFile) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    assert.ok(fs.existsSync(pidFile), '守卫应写入 pid 文件');

    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    // 存活
    let alive = true;
    try { process.kill(pid, 0); } catch (e) { alive = e.code === 'EPERM'; }
    assert.ok(alive, '守卫进程应存活');

    // 守卫持有写端：此时尝试只读打开 in.fifo 不应阻塞（有写者）
    const reader = fs.openSync(inFifo, 'r');
    assert.ok(reader, '有守卫持有写端时，读端应能立即打开');
    fs.closeSync(reader);

    // SIGTERM 后退出
    process.kill(pid, 'SIGTERM');
    const end = Date.now() + 3000;
    let running = true;
    while (Date.now() < end) {
        try { process.kill(pid, 0); running = true; } catch (e) { running = e.code === 'EPERM'; }
        if (!running) break;
        await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(!running, '守卫收到 SIGTERM 后应退出');
});

test('守卫退出后，只读打开无写者的 FIFO 会阻塞直到出现写者', async () => {
    const dir = tmpDir();
    const inFifo = path.join(dir, 'in.fifo');
    execFileSync('mkfifo', [inFifo]);
    // 无守卫、无写者：读端 open 在子进程里会阻塞 —— 只验证它被阻塞，不验证超时
    const child = spawn('node', ['-e', `const fs=require('fs');fs.openSync(process.argv[1],'r');`], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 300));
    // 此时 child 仍存活（open 阻塞中）
    let running = true;
    try { process.kill(child.pid, 0); } catch (e) { running = e.code === 'EPERM'; }
    assert.ok(running, '无写者时读端 open 应阻塞');
    child.kill('SIGKILL');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test src/apps/server/modules/ai-roles/pipe-keeper.test.js`
Expected: FAIL（`pipe-keeper.js` 不存在，spawn 失败，pid 文件不出现）

- [ ] **Step 3: 实现 pipe-keeper.js**

```js
'use strict';
// 管道守卫：以 O_RDWR 打开 in.fifo 并一直持有写端。
// 服务器退出时服务器持有的写端关闭，若无人持有写端，claude 的 stdin 会读到 EOF 而退出；
// 守卫持有写端 → claude stdin 永不 EOF → 服务器重启期间 claude 进程不中断。
// O_RDWR 打开不阻塞（Linux FIFO），无需等待读者即可立即持有写端。
const fs = require('node:fs');
const [,, inFifo, pidFile] = process.argv;

const fd = fs.openSync(inFifo, 'r+'); // 持有写端（r+ = O_RDWR）
fs.writeFileSync(pidFile, String(process.pid));

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
setInterval(() => {}, 1 << 30); // 保持事件循环存活（fd 由模块级 const 引用，不会 GC）
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test src/apps/server/modules/ai-roles/pipe-keeper.test.js`
Expected: PASS (2 个用例)

- [ ] **Step 5: 提交**

```bash
git add src/apps/server/modules/ai-roles/pipe-keeper.js src/apps/server/modules/ai-roles/pipe-keeper.test.js
git commit -m "feat(ai-roles): pipe-keeper 持有 in.fifo 写端防 claude stdin EOF"
```

---

### Task 3: claude-bridge（每角色 claude 进程桥）

**Files:**
- Create: `src/apps/server/modules/ai-roles/claude-bridge.js`
- Test: `src/apps/server/modules/ai-roles/claude-bridge.test.js`

**Interfaces:**
- Consumes: `pipe-keeper.js`（spawn）、Linux `mkfifo`、claude CLI stream-json 协议
- Produces: `class ClaudeBridge`，构造 `new ClaudeBridge({ dir, name, command, promptFile, cwd, keeperPath })`；方法：
  - `ensureStarted() → Promise<void>`（懒启动，可重复调用）
  - `chat(content, { onChunk, onComplete, onError }) → Promise<{success, message}|{success:false,error}>`
  - `isAlive() → bool`
  - `stop()`（SIGTERM→2s→SIGKILL 回收 claude+守卫）
  - `reconnect() → bool`（服务器重启后：存活则重开 out.fifo 读端返回 true，否则清理返回 false）
  - `cleanup()`（强杀 + 删 FIFO/pid）

- [ ] **Step 1: 写失败测试**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ClaudeBridge = require('./claude-bridge');
const KEEPER = path.join(__dirname, 'pipe-keeper.js');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-')); }

// 假 claude：读 stdin 每行，先逐字输出 text_delta，再输出 result 事件（与真实 claude stream-json 同构）
const FAKE_SCRIPT = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let req;
  try { req = JSON.parse(line); } catch (e) { return; }
  const text = 'echo:' + (req.message && req.message.content ? req.message.content : '');
  for (const ch of text) {
    process.stdout.write(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ch } } }) + '\\n');
  }
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: text }) + '\\n');
});
`;

function makeBridge(dir, overrides = {}) {
    const fakePath = path.join(dir, 'fake-claude.js');
    fs.writeFileSync(fakePath, FAKE_SCRIPT);
    return new ClaudeBridge({
        dir,
        name: '测试角色',
        command: `${process.execPath} ${fakePath}`,
        promptFile: path.join(dir, 'prompt.txt'),
        cwd: dir,
        keeperPath: KEEPER,
        ...overrides
    });
}

test('懒启动 + 发消息 + 流式转发 + 完成回包', async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'prompt.txt'), '你是测试角色');
    const bridge = makeBridge(dir);
    assert.ok(!bridge.isAlive(), '未发消息前不启动');

    const chunks = [];
    let done = null;
    const result = await bridge.chat('你好', {
        onChunk: (chunk) => chunks.push(chunk),
        onComplete: (message) => { done = message; }
    });

    assert.ok(result.success, `聊天应成功: ${result.error}`);
    assert.strictEqual(done, 'echo:你好');
    assert.strictEqual(chunks.join(''), 'echo:你好');
    assert.ok(bridge.isAlive(), '聊天后进程存活');
});

test('多轮持久：同一进程，上下文连续', async () => {
    const dir = tmpDir();
    const bridge = makeBridge(dir);
    const r1 = await bridge.chat('alpha', {});
    const pid1 = parseInt(fs.readFileSync(path.join(dir, 'claude.pid'), 'utf8').trim(), 10);
    const r2 = await bridge.chat('beta', {});
    const pid2 = parseInt(fs.readFileSync(path.join(dir, 'claude.pid'), 'utf8').trim(), 10);
    assert.strictEqual(r1.message, 'echo:alpha');
    assert.strictEqual(r2.message, 'echo:beta');
    assert.strictEqual(pid1, pid2, '两次聊天应为同一进程');
    assert.ok(bridge.isAlive());
});

test('stop() 回收进程并清管道', async () => {
    const dir = tmpDir();
    const bridge = makeBridge(dir);
    await bridge.chat('x', {});
    assert.ok(bridge.isAlive());
    bridge.stop();
    // 等待 SIGTERM 生效
    const end = Date.now() + 3000;
    while (bridge.isAlive() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    assert.ok(!bridge.isAlive(), 'stop 后 claude 应退出');
    assert.ok(!fs.existsSync(path.join(dir, 'in.fifo')), 'in.fifo 应删除');
    assert.ok(!fs.existsSync(path.join(dir, 'out.fifo')), 'out.fifo 应删除');
});

test('进程被强杀后 isAlive 变 false，cleanup 清理残留', async () => {
    const dir = tmpDir();
    const bridge = makeBridge(dir);
    await bridge.chat('x', {});
    const pid = parseInt(fs.readFileSync(path.join(dir, 'claude.pid'), 'utf8').trim(), 10);
    process.kill(pid, 'SIGKILL');
    const end = Date.now() + 3000;
    while (bridge.isAlive() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    assert.ok(!bridge.isAlive(), '强杀后检测到退出');
    bridge.cleanup();
    assert.ok(!fs.existsSync(path.join(dir, 'in.fifo')));
});

test('crash 后再次 chat 自动重建', async () => {
    const dir = tmpDir();
    const bridge = makeBridge(dir);
    await bridge.chat('a', {});
    const pid = parseInt(fs.readFileSync(path.join(dir, 'claude.pid'), 'utf8').trim(), 10);
    process.kill(pid, 'SIGKILL');
    await new Promise((r) => setTimeout(r, 200));
    const r2 = await bridge.chat('b', {});
    assert.strictEqual(r2.message, 'echo:b');
    assert.ok(bridge.isAlive());
});

test('reconnect()：存活返回 true 并重开读端；已死清理返回 false', async () => {
    const dir = tmpDir();
    const bridge = makeBridge(dir);
    await bridge.chat('a', {});
    // 模拟服务器重启：丢弃内存里的 reader，仅靠 pid 存活检测
    bridge.reader = null;
    const ok = bridge.reconnect();
    assert.strictEqual(ok, true);
    assert.ok(bridge.isAlive());
    // 再发消息仍可用（重连后读端已重开）
    const r2 = await bridge.chat('b', {});
    assert.strictEqual(r2.message, 'echo:b');

    // 已死场景
    const dir2 = tmpDir();
    const bridge2 = makeBridge(dir2);
    await bridge2.chat('a', {});
    const pid = parseInt(fs.readFileSync(path.join(dir2, 'claude.pid'), 'utf8').trim(), 10);
    process.kill(pid, 'SIGKILL');
    const end = Date.now() + 3000;
    while (bridge2.isAlive() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(bridge2.reconnect(), false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test src/apps/server/modules/ai-roles/claude-bridge.test.js`
Expected: FAIL（`Cannot find module './claude-bridge'`）

- [ ] **Step 3: 实现 claude-bridge.js**

```js
'use strict';
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createReadStream } = require('node:fs');

// 进程存活检测（PID 无效或已死返回 false）
function isAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return err.code === 'EPERM';
    }
}

const READ_TIMEOUT_MS = 60000;

// 每角色一个 claude 进程桥：懒启动 → detached claude（stdin/stdout 接命名管道）→ 流式转发 → 回收。
// 进程 detached + pipe-keeper 持有 in.fifo 写端 + stdout 走 out.fifo（无读者时阻塞、重连后自愈），
// 实现「服务器重启 claude 进程不中断」。
class ClaudeBridge {
    constructor({ dir, name, command = 'claude', promptFile = null, cwd, keeperPath }) {
        this.dir = dir;                 // 角色目录（FIFO/pid/prompt 都在这）
        this.name = name;
        this.command = command;         // claude 基础命令（不含重定向/提示词参数）
        this.promptFile = promptFile;   // --append-system-prompt-file 指向的文件
        this.cwd = cwd;                 // spawn 工作目录（项目根）
        this.keeperPath = keeperPath;   // pipe-keeper.js 绝对路径
        this.claudePidFile = path.join(dir, 'claude.pid');
        this.keeperPidFile = path.join(dir, 'keeper.pid');
        this.inFifo = path.join(dir, 'in.fifo');
        this.outFifo = path.join(dir, 'out.fifo');
        this.errLog = path.join(dir, 'err.log');
        this.reader = null;             // out.fifo 读取流
        this._turn = null;              // 当前待处理一轮 { onChunk, onComplete, onError, resolve }
        this._fullMessage = '';
        this._timeout = null;
    }

    isAlive() {
        return isAlive(this._readPid(this.claudePidFile));
    }

    _readPid(file) {
        try { return parseInt(fs.readFileSync(file, 'utf8').trim(), 10); } catch (_) { return 0; }
    }

    _writePid(file, pid) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, String(pid));
    }

    // 清理：强杀旧进程、删 FIFO、丢弃读端（用于崩溃重建或已死检测后的重置）
    cleanup() {
        for (const file of [this.claudePidFile, this.keeperPidFile]) {
            const pid = this._readPid(file);
            if (isAlive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch (_) {} }
        }
        for (const f of [this.inFifo, this.outFifo]) { try { fs.unlinkSync(f); } catch (_) {} }
        if (this.reader) { try { this.reader.destroy(); } catch (_) {} }
        this.reader = null;
    }

    // 懒启动：确保守卫 + claude + out.fifo 读端就绪（可重复调用）
    async ensureStarted() {
        if (this.isAlive() && this.reader) return;
        this.cleanup();
        fs.mkdirSync(this.dir, { recursive: true });
        try { execFileSync('mkfifo', [this.inFifo, this.outFifo]); } catch (_) { /* 已存在忽略 */ }

        // 1) 管道守卫：detached 持有 in.fifo 写端，防 claude stdin EOF
        const keeper = spawn(process.execPath, [this.keeperPath, this.inFifo, this.keeperPidFile], { detached: true, stdio: 'ignore' });
        keeper.unref();
        const deadline = Date.now() + 3000;
        while (!fs.existsSync(this.keeperPidFile) && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 20));
        }
        if (!fs.existsSync(this.keeperPidFile)) throw new Error('管道守卫启动超时');

        // 2) claude：sh -c 'exec <cmd> ... < in.fifo > out.fifo'。exec 让 sh 变为 claude → child.pid 即 claude pid。
        //    提示词走 --append-system-prompt-file（避免 argv 超长），重定向由 sh 完成，claude 自持 fd 不依赖服务器。
        const promptArg = this.promptFile ? ` --append-system-prompt-file "${this.promptFile}"` : '';
        const shellCmd = `exec ${this.command}${promptArg} < "${this.inFifo}" > "${this.outFifo}" 2> "${this.errLog}"`;
        const child = spawn('sh', ['-c', shellCmd], { detached: true, cwd: this.cwd, stdio: 'ignore' });
        this._writePid(this.claudePidFile, child.pid);
        child.unref();

        this._startReader();
    }

    // 读 out.fifo（claude stdout）：按行解析 stream-json 事件
    _startReader() {
        this.reader = createReadStream(this.outFifo);
        let buf = '';
        this.reader.on('data', (chunk) => {
            buf += chunk.toString('utf8');
            let idx;
            while ((idx = buf.indexOf('\n')) !== -1) {
                const line = buf.slice(0, idx).trim();
                buf = buf.slice(idx + 1);
                if (line) this._onLine(line);
            }
        });
        this.reader.on('end', () => {
            this.reader = null;
            this._failTurn('claude 进程退出');
        });
        this.reader.on('error', () => { /* 无读者阻塞等，忽略 */ });
    }

    _resetTimeout() {
        if (this._timeout) clearTimeout(this._timeout);
        this._timeout = setTimeout(() => {
            this._failTurn('等待 claude 响应超时（60s 无输出）');
        }, READ_TIMEOUT_MS);
    }

    _failTurn(error) {
        const turn = this._turn;
        if (!turn) return;
        if (this._timeout) clearTimeout(this._timeout);
        this._timeout = null;
        this._turn = null;
        if (turn.onError) turn.onError(error);
        turn.resolve({ success: false, error });
    }

    _onLine(line) {
        let ev;
        try { ev = JSON.parse(line); } catch (_) { return; }
        if (!ev || typeof ev !== 'object') return;

        // 流式文本增量
        if (ev.type === 'stream_event' && ev.event && ev.event.type === 'content_block_delta' &&
            ev.event.delta && ev.event.delta.type === 'text_delta') {
            const text = ev.event.delta.text || '';
            this._fullMessage += text;
            if (this._turn) {
                this._resetTimeout();
                if (this._turn.onChunk) this._turn.onChunk(text, this._fullMessage);
            }
            return;
        }

        // 一轮结束
        if (ev.type === 'result') {
            const turn = this._turn;
            if (!turn) return;
            if (this._timeout) clearTimeout(this._timeout);
            this._timeout = null;
            this._turn = null;
            if (ev.subtype === 'success') {
                const msg = ev.result || this._fullMessage;
                if (turn.onComplete) turn.onComplete(msg);
                turn.resolve({ success: true, message: msg });
            } else {
                const err = ev.result || 'claude 出错';
                if (turn.onError) turn.onError(err);
                turn.resolve({ success: false, error: err });
            }
            return;
        }
        // system / assistant / 其他 stream_event 忽略
    }

    // 发消息给 claude（流式回调 + 返回 Promise）。调用方需串行化。
    chat(content, { onChunk, onComplete, onError } = {}) {
        return new Promise((resolve) => {
            this.ensureStarted().then(() => {
                this._turn = { onChunk, onComplete, onError, resolve };
                this._fullMessage = '';
                this._resetTimeout();
                const payload = JSON.stringify({ type: 'user', message: { role: 'user', content } });
                fs.writeFileSync(this.inFifo, payload + '\n');
            }).catch((err) => {
                if (onError) onError(err.message);
                resolve({ success: false, error: err.message });
            });
        });
    }

    // 服务器重启恢复：存活则重开 out.fifo 读端（排空阻塞缓冲），死亡则清理返回 false
    reconnect() {
        if (!this.isAlive()) {
            this.cleanup();
            return false;
        }
        if (!this.reader) this._startReader();
        return true;
    }

    // 回收：SIGTERM → 2s 未退 → SIGKILL（claude + 守卫），并删除 FIFO（测试断言 stop 后 FIFO 清除）
    stop() {
        for (const file of [this.claudePidFile, this.keeperPidFile]) {
            const pid = this._readPid(file);
            if (isAlive(pid)) { try { process.kill(pid, 'SIGTERM'); } catch (_) {} }
        }
        setTimeout(() => {
            for (const file of [this.claudePidFile, this.keeperPidFile]) {
                const pid = this._readPid(file);
                if (isAlive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch (_) {} }
            }
        }, 2000);
        for (const f of [this.inFifo, this.outFifo]) { try { fs.unlinkSync(f); } catch (_) {} }
        if (this.reader) { try { this.reader.destroy(); } catch (_) {} }
        this.reader = null;
    }
}
module.exports = ClaudeBridge;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test src/apps/server/modules/ai-roles/claude-bridge.test.js`
Expected: PASS (6 个用例)。若有 `claude 进程退出`/超时，说明 FIFO 时序问题，检查 `err.log`（角色目录下）排障。

- [ ] **Step 5: 提交**

```bash
git add src/apps/server/modules/ai-roles/claude-bridge.js src/apps/server/modules/ai-roles/claude-bridge.test.js
git commit -m "feat(ai-roles): claude-bridge 懒启动 detached claude 进程，FIFO 流式转发与回收"
```

---

### Task 4: ai-roles-service（聚合服务）

**Files:**
- Create: `src/apps/server/modules/ai-roles/ai-roles-service.js`
- Test: `src/apps/server/modules/ai-roles/ai-roles-service.test.js`

**Interfaces:**
- Consumes: `RoleStore`（Task 1）、`ClaudeBridge`（Task 3）、`USER_CONFIG_DIR`（`../config/user-config-paths`）、`workgroup/roles/<名>.md`
- Produces: `class AiRolesService`，构造 `new AiRolesService({ baseDir, projectRoot, command, keeperPath })`；方法：
  - `list() → [{name, createdAt, running}]`
  - `add(name) → {name, createdAt}`（重名抛 `Error`）
  - `remove(name)`
  - `history(name) → Array`
  - `chat(name, content, { onChunk, onComplete, onError }) → Promise<{success, message}|{success:false, error}>`（完成时 `onComplete(message, history)`）
  - `restoreAll()`（服务器启动恢复）

- [ ] **Step 1: 写失败测试**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AiRolesService = require('./ai-roles-service');
const KEEPER = path.join(__dirname, 'pipe-keeper.js');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'svc-')); }

const FAKE_SCRIPT = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let req;
  try { req = JSON.parse(line); } catch (e) { return; }
  const text = 'echo:' + (req.message && req.message.content ? req.message.content : '');
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: text }) + '\\n');
});
`;

function makeService(dir, baseDir) {
    const fakePath = path.join(dir, 'fake.js');
    fs.writeFileSync(fakePath, FAKE_SCRIPT);
    // 造一个 workgroup/roles/ 目录结构，供提示词复用
    fs.mkdirSync(path.join(dir, 'workgroup', 'roles'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'workgroup', 'roles', '后端.md'), '你是后端角色，负责接口。');
    return new AiRolesService({
        baseDir,
        projectRoot: dir,
        command: `${process.execPath} ${fakePath}`,
        keeperPath: KEEPER
    });
}

test('add/list 往返，running 状态', async () => {
    const dir = tmpDir();
    const base = path.join(dir, 'roles');
    const svc = makeService(dir, base);
    svc.add('后端');
    const list = svc.list();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].name, '后端');
    assert.strictEqual(list[0].running, false, '未对话不启动');
    assert.throws(() => svc.add('后端'), /已存在/);
    svc.remove('后端');
    assert.deepStrictEqual(svc.list(), []);
});

test('chat 走 claude，历史写入并随响应返回', async () => {
    const dir = tmpDir();
    const base = path.join(dir, 'roles');
    const svc = makeService(dir, base);
    svc.add('后端');

    const chunks = [];
    const result = await svc.chat('做个接口', {
        onChunk: (c) => chunks.push(c),
        onComplete: (message, history) => {
            assert.strictEqual(message, 'echo:做个接口');
            assert.strictEqual(history.length, 2, '完成时历史含 user+assistant 两条');
            assert.strictEqual(history[0].role, 'control');
            assert.strictEqual(history[1].role, 'assistant');
        }
    });
    assert.ok(result.success, `chat 应成功: ${result.error}`);
    assert.strictEqual(chunks.join(''), 'echo:做个接口');
    assert.strictEqual(svc.history('后端').length, 2, '历史应持久化');
    assert.strictEqual(svc.list()[0].running, true, '对话后进程运行');
});

test('提示词复用 workgroup/roles/<名>.md', async () => {
    const dir = tmpDir();
    const base = path.join(dir, 'roles');
    const svc = makeService(dir, base);
    svc.add('后端');
    // prompt 文件内容应来自 roles/后端.md
    const promptFile = path.join(base, '后端', 'prompt.txt');
    assert.ok(fs.existsSync(promptFile));
    assert.strictEqual(fs.readFileSync(promptFile, 'utf8'), '你是后端角色，负责接口。');
});

test('restoreAll：角色存活则重连，删除后 remove 回收', async () => {
    const dir = tmpDir();
    const base = path.join(dir, 'roles');
    const svc = makeService(dir, base);
    svc.add('后端');
    await svc.chat('hi', {});
    svc.restoreAll();
    assert.strictEqual(svc.list()[0].running, true, '存活角色应重连保持 running');

    // 删除回收：claude + 守卫进程与目录都清除
    svc.remove('后端');
    assert.deepStrictEqual(svc.list(), []);
    assert.ok(!fs.existsSync(path.join(base, '后端')), '角色目录应删除');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test src/apps/server/modules/ai-roles/ai-roles-service.test.js`
Expected: FAIL（`Cannot find module './ai-roles-service'`）

- [ ] **Step 3: 实现 ai-roles-service.js**

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const RoleStore = require('./role-store');
const ClaudeBridge = require('./claude-bridge');
const { USER_CONFIG_DIR } = require('../config/user-config-paths');

const DEFAULT_BASE = path.join(USER_CONFIG_DIR, 'ai-roles');
const KEEPER_PATH = path.join(__dirname, 'pipe-keeper.js');

// 默认提示词（workgroup/roles/<名>.md 不存在时）
const defaultPrompt = (name) => `你是 ${name}，一个专注${name}相关工作的助手。请用简洁的中文回答。`;

// 聚合：角色持久化 + 每角色 claude 进程桥 + 提示词来源 + 消息路由
class AiRolesService {
    constructor({ baseDir = DEFAULT_BASE, projectRoot, command = 'claude', keeperPath = KEEPER_PATH } = {}) {
        this.store = new RoleStore(baseDir);
        this.projectRoot = projectRoot;
        this.command = command;
        this.keeperPath = keeperPath;
        this.bridges = new Map(); // name -> ClaudeBridge
    }

    _bridge(name) {
        let b = this.bridges.get(name);
        if (!b) {
            b = new ClaudeBridge({
                dir: this.store.roleDir(name),
                name,
                command: this.command,
                cwd: this.projectRoot,
                keeperPath: this.keeperPath
            });
            this.bridges.set(name, b);
        }
        return b;
    }

    // 提示词来源：复用 workgroup/roles/<名>.md；不存在用默认
    _promptFor(name) {
        const roleFile = path.join(this.projectRoot, 'workgroup', 'roles', `${name}.md`);
        try {
            const content = fs.readFileSync(roleFile, 'utf8').trim();
            if (content) return content;
        } catch (_) {}
        return defaultPrompt(name);
    }

    // 把提示词落盘为 prompt.txt（懒启动注入用），幂等
    _ensurePromptFile(name) {
        const file = path.join(this.store.roleDir(name), 'prompt.txt');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, this._promptFor(name));
        return file;
    }

    list() {
        return this.store.list().map((r) => ({ ...r, running: this._bridge(r.name).isAlive() }));
    }

    add(name) {
        const role = this.store.add(name);
        return { ...role, running: false };
    }

    remove(name) {
        const b = this.bridges.get(name);
        if (b) { b.stop(); this.bridges.delete(name); }
        this.store.remove(name);
    }

    history(name) {
        return this.store.loadHistory(name);
    }

    // 发消息给角色：懒启动 → 流式 → 完成写历史。
    // 历史条目与 llm-service 同构（{role, name, content, mode, target}），前端 renderHistory 直接可用。
    async chat(name, content, { onChunk, onComplete, onError } = {}) {
        const bridge = this._bridge(name);
        bridge.promptFile = this._ensurePromptFile(name);
        this.store.appendHistory(name, { role: 'control', name: '用户', content, mode: 'role', target: name });
        const result = await bridge.chat(content, {
            onChunk,
            onComplete: (message) => {
                this.store.appendHistory(name, { role: 'assistant', name, content: message, mode: 'role', target: name });
                if (onComplete) onComplete(message, this.store.loadHistory(name));
            },
            onError
        });
        return result;
    }

    // 服务器启动：遍历角色，claude 存活则重连 FIFO（进程不中断），已死则清残留待重建
    restoreAll() {
        for (const role of this.store.list()) {
            const b = this._bridge(role.name);
            b.promptFile = this._ensurePromptFile(role.name);
            if (!b.reconnect()) {
                console.warn(`[ai-roles] 角色「${role.name}」claude 进程已停止，下次发消息重建`);
            }
        }
    }
}
module.exports = AiRolesService;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test src/apps/server/modules/ai-roles/ai-roles-service.test.js`
Expected: PASS (4 个用例)

- [ ] **Step 5: 提交**

```bash
git add src/apps/server/modules/ai-roles/ai-roles-service.js src/apps/server/modules/ai-roles/ai-roles-service.test.js
git commit -m "feat(ai-roles): ai-roles-service 聚合角色持久化与 claude 进程桥"
```

---

### Task 5: server-app.js 接线（角色消息路由）

**Files:**
- Modify: `src/apps/server/boot/server-app.js`
  - 顶部 imports 附近（约 `require` 区）加 `const AiRolesService = require('../modules/ai-roles/ai-roles-service');`
  - 模块初始化区（`const taskManager = ...` 之后）加 `const aiRoles = new AiRolesService({ projectRoot: PROJECT_ROOT }); aiRoles.restoreAll();`
  - `controlTypes` 数组（第 450-459 行）加 `'roleList', 'roleAdd', 'roleDelete', 'roleHistory'`
  - `handleControlMessageFallback` 内 `chatMessage` 分支（第 3783 行）顶部加 `mode==='role'` 路由；并在其附近加 `roleList/roleAdd/roleDelete/roleHistory` 分支

**Interfaces:**
- Consumes: `AiRolesService`（Task 4）、`PROJECT_ROOT`（已定义）、`broadcastToControls`、`ws`
- Produces: WS 协议——
  - 收 `{type:'roleList'}` → 回 `{type:'roleList', roles}`
  - 收 `{type:'roleAdd', name}` → 广播 `{type:'roleList', roles}`；失败回 `{type:'roleError', message}`
  - 收 `{type:'roleDelete', name}` → 广播 `{type:'roleList', roles}`
  - 收 `{type:'roleHistory', role}` → 回 `{type:'roleHistory', role, history}`
  - 收 `{type:'chatMessage', mode:'role', role, content}` → 走 aiRoles.chat，转发 `chatChunk`/`chatResponse`

- [ ] **Step 1: 加 import 与初始化**

在 `src/apps/server/boot/server-app.js` 的 import 区（紧跟 `const { registerTaskHandlers } = ...` 之后）加入：

```js
const AiRolesService = require('../modules/ai-roles/ai-roles-service');
```

在 `const taskManager = ...` / `registerTaskHandlers` 初始化附近（文件内 `let taskManager` 定义之后的初始化处，搜 `registerTaskHandlers(` 的调用）之后加入：

```js
// AI 角色面板：每角色一个 detached claude 进程。启动时恢复：存活进程重连 FIFO，已死清残留。
const aiRoles = new AiRolesService({ projectRoot: PROJECT_ROOT });
aiRoles.restoreAll();
```

- [ ] **Step 2: 注册 WS 消息类型**

在 `controlTypes` 数组（约 450-459 行）末尾追加：

```js
'roleList', 'roleAdd', 'roleDelete', 'roleHistory',
```

- [ ] **Step 3: 在 chatMessage 分支加 role 路由 + 新增角色管理分支**

在 `handleControlMessageFallback` 的 `} else if (data.type === 'chatMessage') {` 分支顶部（`(async () => {` 内的第一行 `try {` 之后）插入：

```js
// AI 角色对话：mode==='role' 走 ai-roles 桥，返回标准 chatChunk/chatResponse
if (data.mode === 'role' && data.role) {
    await aiRoles.chat(data.role, data.content, {
        onChunk: (chunk, message) => ws.send(JSON.stringify({ type: 'chatChunk', chunk, message })),
        onComplete: (message, history) => ws.send(JSON.stringify({ type: 'chatResponse', success: true, message, history })),
        onError: (error) => ws.send(JSON.stringify({ type: 'chatResponse', success: false, error }))
    });
    return;
}
```

在 `handleControlMessageFallback` 内、`chatMessage` 分支之前（`} else if (data.type === 'chatMessage')` 那行之前）插入角色管理分支：

```js
} else if (data.type === 'roleList') {
    ws.send(JSON.stringify({ type: 'roleList', roles: aiRoles.list() }));
} else if (data.type === 'roleAdd') {
    try {
        aiRoles.add(data.name);
        broadcastToControls({ type: 'roleList', roles: aiRoles.list() });
    } catch (err) {
        ws.send(JSON.stringify({ type: 'roleError', message: err.message }));
    }
} else if (data.type === 'roleDelete') {
    aiRoles.remove(data.name);
    broadcastToControls({ type: 'roleList', roles: aiRoles.list() });
} else if (data.type === 'roleHistory') {
    ws.send(JSON.stringify({ type: 'roleHistory', role: data.role, history: aiRoles.history(data.role) }));
}
```

- [ ] **Step 4: 语法与启动冒烟检查**

Run: `node --check src/apps/server/boot/server-app.js`
Expected: 无输出（语法 OK）

Run: `node --check src/apps/server/modules/ai-roles/*.js`
Expected: 无输出

（完整启动 + 浏览器联调放 Task 7。）

- [ ] **Step 5: 提交**

```bash
git add src/apps/server/boot/server-app.js
git commit -m "feat(ai-roles): server-app 接线角色消息路由与角色管理 WS action"
```

---

### Task 6: 前端聊天面板（角色 tab + mode:'role'）

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/chat.js`
- Modify: `src/apps/web-mediacenter/ui/public/js/websocket.js`
- Modify: `src/apps/web-mediacenter/ui/public/css/chat.css`

**Interfaces:**
- Consumes: WS 协议（Task 5 产出）
- Produces: 前端 `Chat.aiRoles`、`Chat.roleHistories`、`Chat.session.roleTarget`、`loadAiRoles/showAddRole/deleteRole/setRoleMode`；`websocket.js` 处理 `roleList/roleHistory/roleError`

说明：本仓库对 chat.js 无自动化测试（浏览器对象 + DOM），本任务用浏览器手动验证步骤代替（与仓库现状一致）。

- [ ] **Step 1: chat.js 状态与初始化**

在 `session` 对象（约 13-20 行）加 `roleTarget: null`：

```js
    session: {
        mode: 'group',
        privateTarget: null,
        roleTarget: null,
        privateSessionId: 'default',
        playOnControl: false,
        commandMode: true,
        sessions: {}
    },
```

在 `session` 声明之后加角色状态：

```js
    aiRoles: [],          // 工作 AI 角色列表 [{name, createdAt, running}]
    roleHistories: {},    // 每个角色的独立对话历史
```

在 `init()`（约 48-59 行）与 `onWebSocketOpen()`（约 61-66 行）中，`this.loadSession();` 之后各加一行 `this.loadAiRoles();`：

```js
    init() {
        this.loadHistory();
        this.loadTemplates();
        this.loadConfig();
        this.loadProfiles();
        this.loadAssistantConfig();
        this.loadSearchHistory();
        this.loadSession();
        this.loadAiRoles();
        this.loadCommands();
        this.initVoiceRecognition();
        this.render();
    },

    onWebSocketOpen() {
        this.loadHistory();
        this.loadSession();
        this.loadAiRoles();
        this.loadCommands();
        this.loadProfiles();
    },
```

- [ ] **Step 2: chat.js 角色管理方法**

在 `setMode` 方法（约 562 行）之后新增：

```js
    // 加载角色列表（WS roleList）
    loadAiRoles() {
        if (window.WebSocketManager && window.WebSocketManager.ws && window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({ type: 'roleList' }));
        }
    },

    // 添加角色：弹窗输入名字，校验非空/不与模板重名
    showAddRole() {
        const name = window.prompt('输入工作 AI 角色名：');
        if (!name || !name.trim()) return;
        const clean = name.trim();
        if (this.templates.some(t => t.name === clean)) {
            window.showToast('该名字与聊天模板冲突', 'error');
            return;
        }
        window.WebSocketManager.send({ type: 'roleAdd', name: clean });
    },

    // 删除角色：确认后发 roleDelete（服务端回收 claude 进程并清历史）
    deleteRole(name) {
        if (!window.confirm(`删除角色「${name}」将关闭其 claude 进程并清除对话历史，确定？`)) return;
        window.WebSocketManager.send({ type: 'roleDelete', name });
    },

    // 进入角色对话：切 mode='role'，拉取该角色历史
    setRoleMode(name) {
        this.session.mode = 'role';
        this.session.roleTarget = name;
        this.session.privateTarget = null;
        this.saveSession();
        this.render();
        window.WebSocketManager.send({ type: 'roleHistory', role: name });
    },
```

在 `setMode`（约 562-571 行）里把 `roleTarget` 清空，避免切回群聊/私聊时残留角色状态：

```js
    setMode(mode, target = null) {
        this.session.mode = mode;
        this.session.privateTarget = target;
        this.session.roleTarget = null;
        this.session.privateSessionId = 'default';
        this.saveSession();
        this.render();
        if (mode === 'private' && target) {
            this.loadSessions(target);
        }
    },
```

- [ ] **Step 3: chat.js tab 栏渲染**

在 `render()` 的 `tabsHtml` 构建处（约 604-609 行，`this.templates.forEach(...)` 之后、`tabsHtml += '</div>'` 之前）插入角色 tab 与添加按钮：

```js
        this.aiRoles.forEach(r => {
            const isActive = this.session.mode === 'role' && this.session.roleTarget === r.name;
            tabsHtml += `<div class="chat-tab${isActive ? ' active' : ''}" onclick="Chat.setRoleMode('${this.escapeHtml(r.name)}')">${this.escapeHtml(r.name)}<span class="chat-tab-del" title="删除角色" onclick="event.stopPropagation();Chat.deleteRole('${this.escapeHtml(r.name)}')">×</span></div>`;
        });
        tabsHtml += '<div class="chat-tab chat-tab-add" title="添加工作 AI 角色" onclick="Chat.showAddRole()">+</div>';
```

在 `renderModeIndicator()`（约 654-671 行）的角色分支（在 `if (this.session.mode === 'private')` 之前插入）：

```js
        if (this.session.mode === 'role') {
            html += `
                <span class="mode-badge role">角色: ${this.escapeHtml(this.session.roleTarget)}</span>
                <button class="mode-exit-btn" onclick="Chat.setMode('group', null)">退出角色</button>
            `;
        } else if (this.session.mode === 'private') {
```

- [ ] **Step 4: chat.js renderHistory 角色分支**

把 `renderHistory()` 开头的过滤逻辑（约 727-737 行）替换为：

```js
        let indexedHistory = [];
        if (this.session.mode === 'role' && this.session.roleTarget) {
            indexedHistory = (this.roleHistories[this.session.roleTarget] || []).map((item, index) => ({ item, originalIndex: index }));
        } else {
            indexedHistory = this.history.map((item, index) => ({ item, originalIndex: index }));
            if (this.session.mode === 'private' && this.session.privateTarget) {
                indexedHistory = indexedHistory.filter(({ item }) =>
                    item.mode === 'private' && item.target === this.session.privateTarget
                    && (item.sessionId || 'default') === (this.session.privateSessionId || 'default')
                );
            } else {
                indexedHistory = indexedHistory.filter(({ item }) =>
                    item.mode !== 'private' && item.mode !== 'role'
                );
            }
        }
```

在消息渲染的 assistant 名字处（约 752-757 行）支持角色名：

```js
            } else if (item.role === 'assistant') {
                if ((item.mode === 'private' || item.mode === 'role') && item.target) {
                    name = item.target;
                } else {
                    name = item.name || '助手';
                }
            }
```

- [ ] **Step 5: chat.js sendMessage / handleResponse 角色分支**

在 `sendMessage()` 的 assistantName 计算（约 891-897 行）支持角色：

```js
        let assistantName = '助手';
        if (mode === 'private' && target) {
            assistantName = target;
        } else if (mode === 'role' && this.session.roleTarget) {
            assistantName = this.session.roleTarget;
        } else if (templateTarget) {
            assistantName = templateTarget;
        }
```

在 `sendMessage()` 构造 `chatMessage` 处（约 902-911 行）加 `role` 字段：

```js
            const chatMessage = {
                type: 'chatMessage',
                content: sendMessage,
                displayContent: displayMessage,
                mode: mode,
                target: target,
                role: mode === 'role' ? this.session.roleTarget : undefined,
                sessionId: this.session.privateSessionId || 'default',
                playOnControl: this.session.playOnControl
            };
```

在 `handleResponse()` 成功分支（约 1178-1182 行）按角色分历史：

```js
        if (data.success) {
            if (this.session.mode === 'role' && this.session.roleTarget) {
                this.roleHistories[this.session.roleTarget] = data.history;
            } else {
                this.history = data.history;
            }
        } else {
            window.showToast('聊天失败: ' + data.error, 'error');
        }
```

- [ ] **Step 6: websocket.js 路由角色消息**

在 `handleMessage` 末尾（`logBlocklistApplied` 分支之后、`sendControl` 之前）新增：

```js
        } else if (data.type === 'roleList') {
            if (window.Chat) {
                window.Chat.aiRoles = data.roles || [];
                window.Chat.render();
            }
        } else if (data.type === 'roleHistory') {
            if (window.Chat && data.role) {
                window.Chat.roleHistories[data.role] = data.history || [];
                if (window.Chat.session.mode === 'role' && window.Chat.session.roleTarget === data.role) {
                    window.Chat.renderHistory();
                }
            }
        } else if (data.type === 'roleError') {
            window.showToast(data.message || '操作失败', 'error');
        }
```

- [ ] **Step 7: chat.css 角色 tab 样式**

在 `src/apps/web-mediacenter/ui/public/css/chat.css` 末尾追加：

```css
/* 工作 AI 角色 tab：删除按钮与添加按钮 */
.chat-tab-del {
    margin-left: 4px;
    color: #999;
    cursor: pointer;
    font-weight: bold;
}
.chat-tab-del:hover {
    color: #e55;
}
.chat-tab-add {
    cursor: pointer;
    color: #888;
    font-weight: bold;
}
.mode-badge.role {
    background: #e8f0fe;
    color: #1a56db;
}
```

- [ ] **Step 8: 语法检查**

Run: `node --check src/apps/web-mediacenter/ui/public/js/chat.js && node --check src/apps/web-mediacenter/ui/public/js/websocket.js`
Expected: 无输出

- [ ] **Step 9: 提交**

```bash
git add src/apps/web-mediacenter/ui/public/js/chat.js src/apps/web-mediacenter/ui/public/js/websocket.js src/apps/web-mediacenter/ui/public/css/chat.css
git commit -m "feat(ai-roles): 聊天面板加角色 tab 与 mode=role 独立对话"
```

---

### Task 7: 文档与端到端验证

**Files:**
- Modify: `docs/spec/server.md`（若存在；不存在则建 `docs/spec/ai-roles.md`）——按项目规则用伪代码描述本模块
- Modify: `docs/design/ai-roles.md`（新建，记录功能需求与模块职责）
- Modify: `changelog.md`（新增条目）
- Modify: `docs/todo.md`（若含相关条目则移除）

**Interfaces:**
- Consumes: 全部 Task 1-6 成果
- Produces: 文档、人工端到端验证记录

- [ ] **Step 1: 写 design 文档**

创建 `docs/design/ai-roles.md`，内容：功能需求（控制端添加/删除工作 AI 角色、每角色独立 claude 对话、复用聊天 UI）、模块职责（role-store / pipe-keeper / claude-bridge / ai-roles-service）、生命周期（懒启动、detached 不中断、删角色回收）、数据流。

- [ ] **Step 2: 写 spec 文档（伪代码）**

创建/更新 `docs/spec/ai-roles.md`，用伪代码描述：WS 消息协议、`aiRoles.chat` 流程、`ensureStarted`（mkfifo → 守卫 → claude → 读端）、`_onLine` 事件解析、`stop/reconnect`。与实际代码同步。

- [ ] **Step 3: 更新 changelog 与 todo**

`changelog.md` 追加：
```
# AI 角色面板
- ✅已完成 [2026-08-18] 控制端可添加/删除工作 AI 角色，每角色独立 claude 持久对话（复用聊天面板）
  - src/apps/server/modules/ai-roles/*.js、src/apps/server/boot/server-app.js、chat.js、websocket.js、chat.css
  - 角色与历史持久化到 ~/.config/aasc-user/ai-roles/，claude 进程 detached 服务器重启不中断
```
`docs/todo.md` 中如有相关未完成任务则移除。

- [ ] **Step 4: 全量单元测试**

Run: `node --test src/apps/server/modules/ai-roles/`
Expected: PASS（role-store 5 + pipe-keeper 2 + claude-bridge 6 + service 4 ≈ 17 个用例）

- [ ] **Step 5: 浏览器端到端手动验证**

启动服务器：`npm start`（或现有启动方式）。浏览器打开控制端（`upload.html`），验证清单：
1. 聊天面板 tab 栏出现「+」添加按钮；点击输入角色名「后端」→ 出现「后端」tab
2. 点「后端」tab → 模式指示「角色: 后端」；输入「写个 hello 接口」→ 流式输出 → 回复完成
3. 切回「群聊」→ 群聊历史仍在；切回「后端」→ 该角色独立历史还在
4. 再点「+」添加「测试」→ 两个角色 tab 并列，各自对话互不干扰
5. 删除「后端」（tab 上的 ×）→ 确认弹窗 → tab 消失、claude 进程退出（`ps aux | grep claude` 无该进程）
6. **服务器重启不中断**：添加「后端」并对话 → 控制端 `/api/restart` 重启服务器 → 服务器起来后点「后端」tab → 历史还在、可继续对话；`ps aux | grep claude` 显示该角色进程 PID 未变

- [ ] **Step 6: 提交**

```bash
git add docs/design/ai-roles.md docs/spec/ai-roles.md changelog.md docs/todo.md
git commit -m "docs(ai-roles): design/spec/changelog 记录 AI 角色面板"
```

---

## Self-Review 记录

**Spec 覆盖核对（对照 docs/superpowers/specs/2026-08-18-ai-roles-panel-design.md）：**
- 前端 tab/模式/渲染/发消息 → Task 6
- 角色管理 WS action → Task 5
- role-store 持久化 → Task 1
- pipe-keeper → Task 2
- claude-bridge 懒启动/FIFO/流式/回收/崩溃自愈/restoreAll → Task 3
- ai-roles-service 聚合/提示词来源/历史 → Task 4
- 错误处理（超时、崩溃、重名）→ Task 3/4/5
- 测试与文档 → Task 7

**占位符扫描：** 无 TBD/TODO；每步含完整代码或精确 diff。

**类型/命名一致性：**
- `role-store.roleDir(name)` 被 `ai-roles-service._bridge` 与 `_ensurePromptFile` 使用 —— 一致
- `bridge.chat` 返回 `{success, message}` / `{success:false, error}`，service.chat 原样返回 —— 一致
- WS 消息 `roleList/roleAdd/roleDelete/roleHistory/roleError` 前后端一致 —— 一致
- 历史条目形状 `{role:'control'|'assistant', name, content, mode:'role', target}` 前后端一致 —— 一致
