# main 协调者 TUI 交互 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `node poll.js` 无 `--role` 且无 main 时，不再是保活空转，而是 spawn 一个交互式 claude TUI（stdio inherit），注入 main 协调者指令，让用户在 TUI 里直接对话说需求；claude 退出后删 main lock、poll.js 退出。

**Architecture:** poll.js 的 `mode === 'main'` 分支改为：写 `members/main/lock` → spawn `claude --append-system-prompt <main指令>`（stdio inherit，cwd = 项目根）→ `child.on('exit')` 删 main lock → `process.exit(0)`。main 指令文本放 `wg-fs.js` 常量导出，测试用假命令验证退出清理。

**Tech Stack:** Node.js（v25，仅内置模块），测试用 `node:test` + `node:assert`。

**Spec:** `workgroup/docs/spec.md` · **Design:** `workgroup/docs/design.md` · 前置：main keepalive 修复（bb92871）、claude CLI `--append-system-prompt` 已验证可用

## Global Constraints

- 无新增 npm 依赖，只用 Node 内置模块
- Node >= 22（项目环境 v25.7.0）
- 测试风格：`const { test } = require('node:test')` + `node:assert`，运行 `node <testfile>`
- AASC 规则：逻辑用纯函数/映射表，不写大段 if-else 链
- 代码中文注释
- `claude` CLI 在 PATH（已确认 `/usr/bin/claude` v2.1.118，`--append-system-prompt` 可用且不带 `-p` 时进入交互 TUI）

---

### Task 1: wg-fs.js 导出 MAIN_SYSTEM_PROMPT 常量

**Files:**
- Modify: `workgroup/tools/wg-fs.js`
- Test: `workgroup/tests/wg-fs.test.js`（追加测试）

**Interfaces:**
- Consumes: 无（纯常量）
- Produces: `MAIN_SYSTEM_PROMPT` 常量（main 协调者指令文本）。Task 2 的 poll.js spawn claude 用它。

- [ ] **Step 1: 追加失败测试**

在 `workgroup/tests/wg-fs.test.js` 末尾追加：

```javascript
test('MAIN_SYSTEM_PROMPT 提供 main 协调者指令', () => {
    const { MAIN_SYSTEM_PROMPT } = require('../tools/wg-fs.js');
    assert.ok(MAIN_SYSTEM_PROMPT.includes('main'), '应包含 main 角色');
    assert.ok(MAIN_SYSTEM_PROMPT.includes('roles/main.md'), '应提示读 main 角色定义');
    assert.ok(MAIN_SYSTEM_PROMPT.includes('tasks/pending'), '应提示投递任务');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node workgroup/tests/wg-fs.test.js`
Expected: FAIL — `MAIN_SYSTEM_PROMPT` 未导出（undefined）

- [ ] **Step 3: 追加常量**

在 `workgroup/tools/wg-fs.js` 的 `module.exports` 前追加：

```javascript
// main 协调者指令：注入 spawn 的 main claude TUI，让它知道自己扮演 main
// 职责：读 roles/main.md、按 L4-L7 等级路由拆任务、投递到 tasks/pending/、验收时扫描已验收/打回
const MAIN_SYSTEM_PROMPT = `你是 workgroup 的 main 协调者。

你的职责：
1. 读 workgroup/roles/main.md 了解 main 角色职责。
2. 用户提需求 → 用 analyze-requirement-level 定级（L4-L7）→ 拆解成多角色任务，带 depends 依赖链。
3. 投递任务到 workgroup/tasks/pending/<id>.json（status 空，role/requirement/depends/assignedTo 按需）。
4. 定期扫描 workgroup/tasks/claimed/*/ 找 status='已完成' 的任务，读 workgroup/results/<id>.json 呈现给用户验收（通过→status=已验收 / 提修改→小改动写 reviewComment+待修改、大改动投 role=review 任务）。
5. 空角色/离线成员可指派：任务带 assignedTo=<成员名>，agent 自动切换主角色认领。

任务文件规范见 workgroup/docs/design.md「任务文件格式」。`;
```

更新 `module.exports` 为：

```javascript
module.exports = { paths, ensureDir, readJson, writeJson, readText, writeText, listDirs, listFiles, atomicClaim, isAlive, spawnClaude, MAIN_SYSTEM_PROMPT };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node workgroup/tests/wg-fs.test.js`
Expected: PASS（12 个测试全绿）

- [ ] **Step 5: 提交**

```bash
git add workgroup/tools/wg-fs.js workgroup/tests/wg-fs.test.js
git commit -m "feat(workgroup): MAIN_SYSTEM_PROMPT main 协调者指令常量"
```

---

### Task 2: poll.js main 分支改 spawn claude TUI + 退出清理

**Files:**
- Modify: `workgroup/tools/poll.js`
- Test: `workgroup/tests/wg-e2e.test.js`（修改 main 存活测试 + 追加退出清理测试）

**Interfaces:**
- Consumes: Task 1 的 `MAIN_SYSTEM_PROMPT`；现有 `start({root, mode, name, ...})`
- Produces: `mode:'main'` 的 start 分支 spawn `claude --append-system-prompt <MAIN_SYSTEM_PROMPT>`（stdio inherit，cwd = 项目根 = ROOT 上一级），`child.on('exit')` → 删 `members/main/lock` → `process.exit(0)`。可注入 `mainCommand`/`mainArgs` 供测试替换假命令。

- [ ] **Step 1: 修改失败测试**

将 `workgroup/tests/wg-e2e.test.js` 的「main 模式进程持续存活」测试改为验证 main 分支 spawn 子进程 + 退出清理。在文件末尾追加：

```javascript
test('端到端：main 模式 spawn 子进程（默认 claude TUI）并在子进程退出后清理 main lock', async () => {
    const root = tmpRoot();
    const p = paths(root);
    for (const dir of [p.rolesDir, p.membersDir, p.pendingDir, p.claimedDir, p.resultsDir]) ensureDir(dir);
    // 假 main 命令：写一个 marker 文件然后退出（模拟 claude TUI 短暂运行后 /exit）
    const marker = path.join(root, 'main-spawned');
    const fakeMain = process.execPath;
    const fakeMainArgs = ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ok')`];
    const { start } = require('../tools/poll.js');
    const app = start({ root, mode: 'main', name: 'mainCoord', mainCommand: fakeMain, mainArgs: fakeMainArgs, mainPollMs: 30 });
    // 等待假 main 执行 + poll.js 退出清理
    await waitFor(() => !fs.existsSync(p.mainLockFile), 5000);
    app.stop();
    assert.ok(fs.existsSync(marker), 'main 子进程应被执行');
    assert.ok(!fs.existsSync(p.mainLockFile), 'main 子进程退出后应删 main lock');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node workgroup/tests/wg-e2e.test.js`
Expected: FAIL — main 分支不 spawn 子进程，marker 不存在、mainLock 仍存在

- [ ] **Step 3: 修改 poll.js main 分支**

将 `start` 的 main 分支（现 61-71 行，keepalive 版本）替换为：

```javascript
    // main 协调者模式：spawn claude TUI（stdio inherit 透传 TTY），注入 main 指令。
    // claude 退出（/exit 或 Ctrl+C）→ 删 main lock → poll.js 进程退出（整个 main 会话结束）。
    // mainCommand/mainArgs 可注入假命令供测试（默认 claude --append-system-prompt <MAIN_SYSTEM_PROMPT>）。
    if (mode === 'main') {
        ensureDir(path.join(p.membersDir, 'main'));
        writeText(p.mainLockFile, `${process.pid} ${Date.now()}`);
        const cleanup = () => { fs.rmSync(p.mainLockFile, { force: true }); process.exit(0); };
        process.once('SIGINT', cleanup);
        process.once('SIGTERM', cleanup);
        const mainCommand = startOpts.mainCommand || 'claude';
        const mainArgs = startOpts.mainArgs || ['--append-system-prompt', MAIN_SYSTEM_PROMPT];
        // cwd = 项目根（workgroup/ 上一级），main claude 既能读项目代码拆需求、又能用 workgroup/ 相对路径投递验收
        const projectRoot = path.resolve(root, '..');
        const child = spawn(mainCommand, mainArgs, { stdio: 'inherit', cwd: projectRoot });
        console.log(`[workgroup] 启动 main 协调者 TUI（PID ${process.pid}，spawn ${mainCommand}）`);
        child.on('exit', (code) => {
            console.log(`[workgroup] main TUI 退出（code ${code}），清理 main lock`);
            fs.rmSync(p.mainLockFile, { force: true });
            process.exit(0);
        });
        child.on('error', (err) => {
            console.error(`[workgroup] 启动 main TUI 失败：${err.message}`);
            fs.rmSync(p.mainLockFile, { force: true });
            process.exit(1);
        });
        return { stop: () => { try { child.kill(); } catch (_) {} }, mode: 'main' };
    }
```

**注意**：
- 需在文件顶部 import 增加 `MAIN_SYSTEM_PROMPT` 到 wg-fs require 行（现在 import 的是 `{ paths, ensureDir, ..., spawnClaude }`），把 `MAIN_SYSTEM_PROMPT` 加进去。
- `spawn` 已在文件顶部 import（`const { spawn } = require('node:child_process')`），确认存在。
- `start` 函数签名需接收 `startOpts`（或把 mainCommand/mainArgs/mainPollMs 加入解构参数）。当前签名 `function start({ root = ROOT, primary = '', secondary = [], name, mode = 'agent', command = 'claude', buildArgs, pollIntervalMs = DEFAULT_POLL_MS, onTaskDone })`。把 main 分支里用的 `startOpts.mainCommand/mainArgs` 改为从解构参数读：在函数签名加 `mainCommand, mainArgs`，main 分支用 `mainCommand || 'claude'` / `mainArgs || [...]`。

- [ ] **Step 4: 修改既有 main 存活测试**

`workgroup/tests/wg-e2e.test.js` 的「main 模式进程持续存活」测试现用子进程 spawn `start({mode:'main'})` 观察 800ms 不退出——但新 main 分支会 spawn claude，测试环境的子进程会卡住等 claude。改为删除该测试（被新测试「spawn 子进程+退出清理」取代），或改为注入假命令验证。**建议删除**「main 模式进程持续存活」测试（其意图已被新测试覆盖）。

- [ ] **Step 5: 运行测试确认通过**

Run: `node workgroup/tests/wg-e2e.test.js`
Expected: PASS（19 个测试全绿：删 1 旧 + 加 1 新，保持 20→19？——实际原 20 个，删「main 存活」=19，加新=20）

- [ ] **Step 6: 运行全量测试确认无回归**

Run: `node workgroup/tests/wg-core.test.js && node workgroup/tests/wg-fs.test.js && node workgroup/tests/wg-e2e.test.js`
Expected: 全部 PASS（16 + 12 + 20 = 48）

- [ ] **Step 7: 真实场景验证**

Run: `cd /mnt/AASC/workgroup && rm -f members/main/lock && timeout 5 node tools/poll.js`
Expected: 看到 `[workgroup] 无 main 在线，启动为 main 协调者` + `[workgroup] 启动 main 协调者 TUI`，随后进入 claude TUI（timeout 5 秒后被 SIGTERM 杀，exit=124；SIGTERM cleanup 删 lock）。若环境无 TTY 无法进入 TUI，则验证到 spawn 日志即算通过。

- [ ] **Step 8: 提交**

```bash
git add workgroup/tools/poll.js workgroup/tests/wg-e2e.test.js
git commit -m "feat(workgroup): main 协调者 TUI——spawn claude 交互 + 退出清理 main lock"
```

---

## 自测用例对照

| 需求 | 验证位置 |
|------|----------|
| main TUI spawn claude | wg-e2e「main 模式 spawn 子进程」+ 真实场景 timeout 验证 |
| main 指令注入 | wg-fs「MAIN_SYSTEM_PROMPT 提供 main 协调者指令」|
| 退出清理 main lock | wg-e2e「子进程退出后清理 main lock」|
| cwd = 项目根 | poll.js main 分支 `path.resolve(root,'..')`（代码审查）|
