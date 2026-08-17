# Workgroup 增强：角色拆分/切换/依赖门控/取消/原始输出 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 workgroup 工具加入 6 大增强：① 按项目架构拆分 21 角色文件 ② 主/副角色 + 每角色独立目录 ③ depends 依赖门控（多角色协调）④ 任务取消（信号 + kill）⑤ claude 原始输出（stdio inherit）⑥ main/空角色启动模式 + 空闲自动切换 + main 指派。

**Architecture:** 成员目录从 `members/<name>` 改为 `members/<名>-<角色>/`（每角色独立，历史隔离）；role.md 存 `{primary, secondary}`；poll.js 匹配顺序 = 主角色→指派→待修改→副角色→空闲自动切换；spawnClaude 改 `stdio:'inherit'` 且暴露 kill 句柄（取消用）；无 --role 时检测 `members/main/lock` 决定成为 main 还是空角色。

**Tech Stack:** Node.js（v25，仅内置模块），测试用 `node:test` + `node:assert`。

**Spec:** `workgroup/docs/spec.md` · **Design:** `workgroup/docs/design.md` · 前置实现：Task 1-5 + 修复 + 任务状态/验收打回（commit 876a3c8..ffa9a0a）

## Global Constraints

- 无新增 npm 依赖，只用 Node 内置模块
- Node >= 22（项目环境 v25.7.0）
- 测试风格：`const { test } = require('node:test')` + `node:assert`，运行 `node <testfile>`
- AASC 规则：逻辑用纯函数/映射表，不写大段 if-else 链
- 代码中文注释
- 任务 `status` 取值（中文字符串精确）：`进行中`、`已完成`、`待修改`、`已验收`、`已取消`；空/缺失 = 未开始
- 成员目录命名：`members/<名>-<角色>/`；main 身份目录：`members/main/`
- `role.md` 内容格式：`primary: <角色>\nsecondary: <逗号分隔角色列表>`

---

### Task 1: wg-fs.js 路径重构 + spawnClaude 输出与 kill 句柄

**Files:**
- Modify: `workgroup/tools/wg-fs.js`
- Test: `workgroup/tests/wg-fs.test.js`（追加测试）

**Interfaces:**
- Consumes: 现有 `paths(root)`、`spawnClaude({command,args,cwd,resultFile})`
- Produces: `paths` 增加 `cancelDir`、`roleDir(agent, role)`、`roleLockFile(agent,role)`、`roleBusyFile(agent,role)`、`roleHistoryFile(agent,role)`、`roleMemberRoleFile(agent,role)`、`roleCurrentTaskFile(agent,role)`、`mainLockFile`。`spawnClaude` 改 `stdio:'inherit'` 并返回 `{ child, done }`（child 立即可 kill 供取消，done 是 close/error 的 promise，resolve `{code, resultWritten}`）。现有测试需适配成员目录命名。

- [ ] **Step 1: 追加失败测试**

在 `workgroup/tests/wg-fs.test.js` 末尾追加：

```javascript
test('paths 提供角色目录与取消目录', () => {
    const p = paths('/wg');
    assert.strictEqual(p.cancelDir, path.join('/wg', 'tasks', 'cancel'));
    assert.strictEqual(p.roleDir('alice', 'frontend'), path.join('/wg', 'members', 'alice-frontend'));
    assert.strictEqual(p.roleLockFile('alice', 'frontend'), path.join('/wg', 'members', 'alice-frontend', 'lock'));
    assert.strictEqual(p.roleHistoryFile('alice', 'frontend'), path.join('/wg', 'members', 'alice-frontend', 'history.md'));
    assert.strictEqual(p.mainLockFile, path.join('/wg', 'members', 'main', 'lock'));
});

test('spawnClaude 返回 child 句柄且结果文件写入', async () => {
    const root = tmpRoot();
    const resultFile = path.join(root, 'r.json');
    const { child, done } = spawnClaude({
        command: process.execPath,
        args: ['-e', `require('fs').writeFileSync(${JSON.stringify(resultFile)}, '{}')`],
        cwd: root,
        resultFile
    });
    assert.ok(child, '应返回 child 句柄');
    const res = await done;
    assert.strictEqual(res.resultWritten, true);
});

test('spawnClaude child 可被 kill（取消用）', async () => {
    const root = tmpRoot();
    const resultFile = path.join(root, 'r.json');
    const { child, done } = spawnClaude({
        command: process.execPath,
        args: ['-e', 'setTimeout(()=>{}, 5000)'],
        cwd: root,
        resultFile
    });
    assert.ok(child.pid, 'child 应有 pid');
    try { process.kill(child.pid, 'SIGTERM'); } catch (_) {}
    const res = await done;
    assert.strictEqual(res.code, null, '被 kill 后 code 应为 null');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node workgroup/tests/wg-fs.test.js`
Expected: FAIL — `cancelDir`/`roleDir` 不存在，`spawnClaude` 无 child 返回

- [ ] **Step 3: 修改 wg-fs.js**

将 `paths` 函数替换为：

```javascript
// 返回工作区各关键路径（角色目录按 <名>-<角色> 隔离）
function paths(root) {
    return {
        rolesDir: path.join(root, 'roles'),
        membersDir: path.join(root, 'members'),
        pendingDir: path.join(root, 'tasks', 'pending'),
        claimedDir: path.join(root, 'tasks', 'claimed'),
        resultsDir: path.join(root, 'results'),
        cancelDir: path.join(root, 'tasks', 'cancel'),
        mainLockFile: path.join(root, 'members', 'main', 'lock'),
        // 角色目录：members/<名>-<角色>/
        roleDir: (name, role) => path.join(root, 'members', role ? `${name}-${role}` : name),
        roleLockFile: (name, role) => path.join(root, 'members', `${name}-${role}`, 'lock'),
        roleBusyFile: (name, role) => path.join(root, 'members', `${name}-${role}`, 'busy'),
        roleHistoryFile: (name, role) => path.join(root, 'members', `${name}-${role}`, 'history.md'),
        roleMemberRoleFile: (name, role) => path.join(root, 'members', `${name}-${role}`, 'role.md'),
        roleCurrentTaskFile: (name, role) => path.join(root, 'members', `${name}-${role}`, 'current-task'),
        roleFile: (name) => path.join(root, 'roles', `${name}.md`),
        taskFile: (id) => path.join(root, 'tasks', 'pending', `${id}.json`),
        claimedTaskFile: (agent, id) => path.join(root, 'tasks', 'claimed', agent, `${id}.json`),
        resultFile: (id) => path.join(root, 'results', `${id}.json`)
    };
}
```

将 `spawnClaude` 替换为：

```javascript
// 执行子 agent（默认 claude --print），stdio inherit 实时输出到 poll 终端。
// 返回 { child, done }：child 立即可 kill（取消用），done 是 close/error 的 promise。
function spawnClaude({ command, args, cwd, resultFile }) {
    // stdio 用 'inherit'：子进程输出直接打到 poll.js 所在终端，无管道缓冲、不会死锁。
    const child = spawn(command, args, { cwd, stdio: ['inherit', 'inherit', 'inherit'] });
    const done = new Promise((resolve) => {
        child.on('close', (code) => resolve({ code, resultWritten: fs.existsSync(resultFile) }));
        child.on('error', (err) => resolve({ code: -1, error: err.message, resultWritten: false }));
    });
    return { child, done };
}
```

**注意**：`wg-fs.js` 现有 `memberDir`/`lockFile`/`busyFile`/`currentTaskFile`/`memberRoleFile`/`historyFile` 这些旧函数签名会保留给向后兼容（Task 2 会重构 poll.js 改用新 `role*` 函数）。`atomicClaim` 不改（它用 `p.claimedDir` + `agentName`，agentName 在 poll.js 层已含角色后缀）。

- [ ] **Step 4: 运行测试确认通过**

Run: `node workgroup/tests/wg-fs.test.js`
Expected: PASS（10 个测试全绿，含新增 2 个）

- [ ] **Step 5: 提交**

```bash
git add workgroup/tools/wg-fs.js workgroup/tests/wg-fs.test.js
git commit -m "feat(workgroup): wg-fs 角色目录路径 + spawnClaude stdio inherit 实时输出 + child 句柄"
```

---

### Task 2: wg-core.js 状态值"已取消" + role.md 序列化

**Files:**
- Modify: `workgroup/tools/wg-core.js`
- Test: `workgroup/tests/wg-core.test.js`（追加测试）

**Interfaces:**
- Consumes: 现有 `validateName`/`roleTemplate`/`buildPrompt`
- Produces: `serializeRole({primary,secondary}) → string`、`parseRole(text) → {primary,secondary}`。状态常量 `STATUS_*`（可选）。Task 3+ 的 poll.js 依赖 `parseRole`/`serializeRole`。

- [ ] **Step 1: 追加失败测试**

在 `workgroup/tests/wg-core.test.js` 末尾追加：

```javascript
const { serializeRole, parseRole } = require('../tools/wg-core.js');

test('serializeRole/parseRole 往返', () => {
    const text = serializeRole({ primary: 'frontend', secondary: ['backend-media', 'tester'] });
    const r = parseRole(text);
    assert.strictEqual(r.primary, 'frontend');
    assert.deepStrictEqual(r.secondary, ['backend-media', 'tester']);
});

test('parseRole 空文本返回空主角色', () => {
    const r = parseRole('');
    assert.strictEqual(r.primary, '');
    assert.deepStrictEqual(r.secondary, []);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node workgroup/tests/wg-core.test.js`
Expected: FAIL — `serializeRole`/`parseRole` 不存在

- [ ] **Step 3: 追加实现**

在 `workgroup/tools/wg-core.js` 的 `module.exports` 前追加：

```javascript
// role.md 序列化：primary: <角色> \n secondary: <逗号分隔>
function serializeRole({ primary = '', secondary = [] }) {
    return `primary: ${primary}\nsecondary: ${(secondary || []).join(',')}`;
}

// role.md 解析
function parseRole(text) {
    const out = { primary: '', secondary: [] };
    if (!text) return out;
    for (const line of text.split('\n')) {
        const m = line.trim().match(/^primary:\s*(.*)$/);
        if (m) { out.primary = m[1].trim(); continue; }
        const m2 = line.trim().match(/^secondary:\s*(.*)$/);
        if (m2) {
            out.secondary = m2[1].split(',').map((s) => s.trim()).filter(Boolean);
        }
    }
    return out;
}
```

更新 `module.exports` 为：

```javascript
module.exports = { genId, validateName, roleTemplate, buildPrompt, parseHistory, updateHistory, buildSummary, serializeRole, parseRole, MAX_LEARNINGS, MAX_RECORDS };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node workgroup/tests/wg-core.test.js`
Expected: PASS（16 个测试全绿）

- [ ] **Step 5: 提交**

```bash
git add workgroup/tools/wg-core.js workgroup/tests/wg-core.test.js
git commit -m "feat(workgroup): role.md 主/副角色序列化与解析"
```

---

### Task 3: poll.js 主/副角色 + 每角色独立目录 + 启动模式

**Files:**
- Modify: `workgroup/tools/poll.js`
- Test: `workgroup/tests/wg-e2e.test.js`（追加测试）

**Interfaces:**
- Consumes: Task 1 的 `paths` role* 函数、Task 2 的 `serializeRole`/`parseRole`
- Produces: `start({root, primary, secondary, name, mode, ...})`；`mode` 取值 `'agent'`（默认）/`'main'`/`'empty'`。poll.js 成员目录改 `members/<名>-<角色>/`。Task 4-7 继续扩展 start 内逻辑。

- [ ] **Step 1: 追加失败测试**

在 `workgroup/tests/wg-e2e.test.js` 末尾追加：

```javascript
test('端到端：主角色认领任务，成员目录为 <名>-<角色>', async () => {
    const root = tmpRoot();
    const p = paths(root);
    for (const dir of [p.rolesDir, p.membersDir, p.pendingDir, p.claimedDir, p.resultsDir]) ensureDir(dir);
    writeText(p.roleFile('frontend'), '# 前端角色');
    writeJson(p.taskFile('t9'), { id: 't9', title: '任务9', role: 'frontend', requirement: '做前端', priority: 'high', createdAt: 1, references: [], status: '', depends: [], level: 'L4' });

    const resultFile = p.resultFile('t9');
    const fakeResult = JSON.stringify({ status: 'completed', summary: '完成', tags: ['UI'], learnings: [], output: 'ok' });
    const fakeScript = `require('fs').writeFileSync(${JSON.stringify(resultFile)}, ${JSON.stringify(fakeResult)})`;

    const { start } = require('../tools/poll.js');
    const app = start({ root, primary: 'frontend', secondary: [], name: 'alice', command: process.execPath, buildArgs: () => ['-e', fakeScript], pollIntervalMs: 50 });
    await waitFor(() => fs.existsSync(resultFile), 5000);
    await waitFor(() => !fs.existsSync(p.roleBusyFile('alice', 'frontend')), 5000);
    app.stop();

    assert.ok(fs.existsSync(p.roleLockFile('alice', 'frontend')), '成员目录 <名>-<角色>/lock 应存在');
    assert.strictEqual(readText(p.roleMemberRoleFile('alice', 'frontend')).includes('frontend'), true, 'role.md 应记录主角色');
    assert.ok(fs.existsSync(p.claimedTaskFile('alice-frontend', 't9')), '任务应移动到 claimed/alice-frontend/');
    assert.ok(fs.existsSync(resultFile), '结果文件应存在');
});

test('端到端：副角色任务仅主角色无活时认领，历史写到副角色目录', async () => {
    const root = tmpRoot();
    const p = paths(root);
    for (const dir of [p.rolesDir, p.membersDir, p.pendingDir, p.claimedDir, p.resultsDir]) ensureDir(dir);
    writeText(p.roleFile('frontend'), '# 前端');
    writeText(p.roleFile('backend-media'), '# 后端媒体');
    // 只有副角色 backend-media 的任务，主角色 frontend 无活
    writeJson(p.taskFile('t10'), { id: 't10', title: '任务10', role: 'backend-media', requirement: '做后端媒体', priority: 'high', createdAt: 1, references: [], status: '', depends: [], level: 'L4' });

    const resultFile = p.resultFile('t10');
    const fakeResult = JSON.stringify({ status: 'completed', summary: '完成', tags: ['媒体'], learnings: [], output: 'ok' });
    const fakeScript = `require('fs').writeFileSync(${JSON.stringify(resultFile)}, ${JSON.stringify(fakeResult)})`;

    const { start } = require('../tools/poll.js');
    const app = start({ root, primary: 'frontend', secondary: ['backend-media'], name: 'alice', command: process.execPath, buildArgs: () => ['-e', fakeScript], pollIntervalMs: 50 });
    await waitFor(() => fs.existsSync(resultFile), 5000);
    await waitFor(() => !fs.existsSync(p.roleBusyFile('alice', 'frontend')), 5000);
    app.stop();

    assert.ok(fs.existsSync(p.claimedTaskFile('alice-frontend', 't10')), '副角色任务认领后仍在活动目录 claimed/alice-frontend/');
    const history = readText(p.roleHistoryFile('alice', 'backend-media'));
    assert.ok(history.includes('t10'), '副角色历史应写到 backend-media 目录');
});

test('端到端：无 main 时启动为 main 协调者，有 main 时空角色', async () => {
    const root = tmpRoot();
    const p = paths(root);
    for (const dir of [p.rolesDir, p.membersDir, p.pendingDir, p.claimedDir, p.resultsDir]) ensureDir(dir);
    const { start } = require('../tools/poll.js');

    // 无 main：启动为 main（模式 'main'，直接由调用方指定，不写 main lock 由测试断言）
    const mainApp = start({ root, mode: 'main', name: 'mainCoord', pollIntervalMs: 50 });
    // main 模式不进入子 agent 轮询，start 应正常返回
    mainApp.stop();
    assert.ok(true, 'main 模式 start 应正常返回');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node workgroup/tests/wg-e2e.test.js`
Expected: FAIL — 现有测试用 `p.memberDir('alice')`（旧签名），且 `start` 不接受 `primary`/`secondary`/`mode`

- [ ] **Step 3: 重构 poll.js 的 start 与交互向导**

替换 `start` 函数（现 12-91 行）为：

```javascript
// 启动子 agent（或 main/空角色）：创建成员、lock、进入轮询循环
function start({ root = ROOT, primary = '', secondary = [], name, mode = 'agent', command = 'claude', buildArgs, pollIntervalMs = DEFAULT_POLL_MS, onTaskDone }) {
    primary = String(primary || '').trim();
    name = String(name || '').trim();
    const p = paths(root);

    // main 协调者模式：只写 main lock，不进入子 agent 轮询
    if (mode === 'main') {
        ensureDir(path.join(p.membersDir, 'main'));
        writeText(p.mainLockFile, `${process.pid} ${Date.now()}`);
        const cleanup = () => { fs.rmSync(p.mainLockFile, { force: true }); process.exit(0); };
        process.once('SIGINT', cleanup);
        process.once('SIGTERM', cleanup);
        console.log(`[workgroup] 启动 main 协调者（PID ${process.pid}）`);
        return { stop: () => {}, mode: 'main' };
    }

    // 空角色模式：无主角色起步，只认 assignedTo 自己的任务
    const isEmpty = mode === 'empty' || !primary;
    const activeRole = isEmpty ? '' : primary;
    const roleDir = p.roleDir(name, activeRole);
    ensureDir(roleDir);
    writeText(p.roleMemberRoleFile(name, activeRole || ''), serializeRole({ primary: activeRole, secondary }));
    // history.md 存在则保留（重启历史不覆盖）

    // 崩溃残留检查：lock 内 PID 存活则拒绝启动
    const lockText = readText(p.roleLockFile(name, activeRole || ''));
    if (lockText) {
        const pid = parseInt(lockText.split(' ')[0], 10);
        if (isAlive(pid)) {
            console.error(`[workgroup] 已有同名 agent「${name}-${activeRole}」在线（PID ${pid}），退出`);
            process.exit(1);
            return;
        }
        console.warn(`[workgroup] 覆盖残留 lock（PID ${pid} 已死）`);
    }
    writeText(p.roleLockFile(name, activeRole || ''), `${process.pid} ${Date.now()}`);

    // 崩溃残留清理：busy / current-task / 进行中任务重置
    fs.rmSync(p.roleBusyFile(name, activeRole || ''), { force: true });
    fs.rmSync(p.roleCurrentTaskFile(name, activeRole || ''), { force: true });
    const crashDir = path.join(p.claimedDir, `${name}-${activeRole}`);
    for (const f of listFiles(crashDir, '.json')) {
        const t = readJson(path.join(crashDir, f));
        if (t && t.status === '进行中') {
            writeJson(path.join(crashDir, f), { ...t, status: '待修改' });
            console.warn(`[workgroup] 崩溃残留：任务 ${t.id} 由「进行中」重置为「待修改」`);
        }
    }

    // 正常退出/中断时删除 lock
    const cleanup = () => {
        fs.rmSync(p.roleLockFile(name, activeRole || ''), { force: true });
        process.exit(0);
    };
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);

    let running = true;
    const runLoop = async () => {
        while (running) {
            // ① 主角色新任务：pending 里 role==primary 且 status 空
            const pending = listFiles(p.pendingDir, '.json')
                .map((f) => readJson(path.join(p.pendingDir, f)))
                .filter(Boolean);
            let mine = primary ? pending.find((t) => t.role === primary && (!t.status || t.status === '')) : null;
            if (!mine && !isEmpty) {
                // ③ 待修改：自己 claimed/ 里 status=待修改 且 role 匹配
                const mineDir = path.join(p.claimedDir, `${name}-${primary}`);
                const rework = listFiles(mineDir, '.json')
                    .map((f) => readJson(path.join(mineDir, f)))
                    .find((t) => t && t.status === '待修改' && t.role === primary);
                if (rework) mine = { ...rework, _fromRework: true };
            }
            if (!mine && !isEmpty) {
                // ④ 副角色：pending 里 secondary 匹配
                mine = pending.find((t) => secondary.includes(t.role) && (!t.status || t.status === ''));
            }
            if (mine) {
                const ok = isEmpty ? atomicClaim(p, name, mine.id) : atomicClaim(p, `${name}-${primary}`, mine.id);
                if (ok) {
                    await executeTask({ p, root, role: mine.role, name, activeRole: primary, mine, command, buildArgs, secondary });
                    if (onTaskDone) await onTaskDone();
                }
            }
            await sleep(pollIntervalMs);
        }
    };
    const loopPromise = runLoop();
    return { stop: () => { running = false; }, done: loopPromise, mode };
}
```

替换 `executeTask` 的签名与内部路径（现 94-127 行）为：

```javascript
// 执行单个任务：busy 标记 → 任务状态进行中 → 注入总结/修改要求 → spawn claude → 更新 history → 状态已完成 → 回到空闲
async function executeTask({ p, root, role, name, activeRole, mine, command, buildArgs, secondary }) {
    const agentDir = name + (activeRole ? '-' + activeRole : '');
    writeText(p.roleBusyFile(name, activeRole || ''), '');
    writeText(p.roleCurrentTaskFile(name, activeRole || ''), mine.id);
    const taskFile = p.claimedTaskFile(agentDir, mine.id);
    const resultFile = p.resultFile(mine.id);
    // 落盘状态=进行中
    writeJson(taskFile, { ...mine, status: '进行中' });
    const summary = buildSummary(readText(p.roleHistoryFile(name, activeRole || '')));
    const prompt = buildPrompt({ role: mine.role, name: agentDir, summary, taskFile, resultFile, reviewComment: mine.reviewComment });
    const args = buildArgs ? buildArgs(prompt, taskFile, resultFile) : ['--print', '--permission-mode', 'bypassPermissions', prompt];
    await spawnClaude({ command, args, cwd: root, resultFile }).done; // 等待子进程结束（Task 5 加取消轮询）

    // 结果容错：非法/缺失则标记 failed
    let res = readJson(resultFile);
    if (!res) {
        res = { id: mine.id, status: 'failed', summary: '子 agent 未返回有效结果', tags: [], learnings: [], output: '' };
        writeJson(resultFile, res);
    }
    const tags = Array.isArray(res.tags) ? res.tags : [];
    const learnings = Array.isArray(res.learnings) ? res.learnings : [];
    const newHistory = updateHistory(readText(p.roleHistoryFile(name, activeRole || '')), {
        tags, learnings,
        record: { id: mine.id, title: mine.title || '', summary: res.summary || '', tags, at: Date.now() }
    });
    writeText(p.roleHistoryFile(name, activeRole || ''), newHistory);

    // 完成后状态 = 已完成
    const cur = readJson(taskFile) || mine;
    writeJson(taskFile, { ...cur, status: '已完成' });

    fs.rmSync(p.roleBusyFile(name, activeRole || ''), { force: true });
    fs.rmSync(p.roleCurrentTaskFile(name, activeRole || ''), { force: true });
    console.log(`[workgroup] 任务 ${mine.id} 完成（${res.status}）`);
}
```

替换 `main()`（现 198-220 行）为：

```javascript
async function main() {
    const args = process.argv.slice(2);
    const getArg = (flag) => {
        const i = args.indexOf(flag);
        return i >= 0 ? args[i + 1] : null;
    };
    const roleArg = getArg('--role');
    const nameArg = getArg('--name');
    const secondaryArg = getArg('--secondary');
    if (roleArg && nameArg) {
        // 方式一：带参数启动 → 子 agent
        const secondary = secondaryArg ? secondaryArg.split(',').map((s) => s.trim()).filter(Boolean) : [];
        console.log(`[workgroup] 启动子 agent：主角色 ${roleArg} / 成员 ${nameArg} / 副角色 ${secondary.join(',') || '无'}`);
        start({ root: ROOT, primary: roleArg, secondary, name: nameArg });
        return;
    }
    // 方式二：无 --role → 检测 main 是否在线
    const p = paths(ROOT);
    const mainLock = readText(p.mainLockFile);
    let mainAlive = false;
    if (mainLock) {
        const pid = parseInt(mainLock.split(' ')[0], 10);
        mainAlive = isAlive(pid);
    }
    if (!mainAlive) {
        // 无 main → 成为 main 协调者
        console.log('[workgroup] 无 main 在线，启动为 main 协调者');
        start({ root: ROOT, mode: 'main', name: 'mainCoord' });
        return;
    }
    // 有 main → 空角色：交互向导选成员名
    console.log('[workgroup] 已有 main 在线，启动为空角色（等待 main 指派）');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const name = await selectMember(rl, p);
    rl.close();
    console.log(`[workgroup] 启动空角色 / 成员 ${name}`);
    start({ root: ROOT, mode: 'empty', name });
}
```

**注意**：`executeTask` 不再接收 `role`（改用 `mine.role`）；`activeRole` 是当前主角色。Task 4 会在这个基础上加 depends 门控，Task 5 加取消，Task 6 加切换，Task 7 加 main 指派。现有 e2e 测试的 `start({role, name})` 参数需改为 `start({primary, name})`。

- [ ] **Step 4: 更新现有 e2e 测试适配新签名**

所有 `workgroup/tests/wg-e2e.test.js` 中 `start({ root, role: 'X', name: 'Y', ... })` 改为 `start({ root, primary: 'X', name: 'Y', ... })`。用 `p.memberDir`/`p.lockFile`/`p.busyFile`/`p.historyFile` 的断言改为 `p.roleDir('Y','X')`/`p.roleLockFile('Y','X')`/`p.roleBusyFile('Y','X')`/`p.roleHistoryFile('Y','X')`；`p.claimedTaskFile('Y', id)` 改为 `p.claimedTaskFile('Y-X', id)`。

- [ ] **Step 5: 运行测试确认通过**

Run: `node workgroup/tests/wg-e2e.test.js`
Expected: PASS（12 个测试全绿，含新增 3 个 + 适配 9 个）

- [ ] **Step 6: 运行全量测试确认无回归**

Run: `node workgroup/tests/wg-core.test.js && node workgroup/tests/wg-fs.test.js && node workgroup/tests/wg-e2e.test.js`
Expected: 全部 PASS（16 + 10 + 12 = 38）

- [ ] **Step 7: 提交**

```bash
git add workgroup/tools/poll.js workgroup/tests/wg-e2e.test.js
git commit -m "feat(workgroup): 主/副角色 + 每角色独立目录 + main/空角色启动模式"
```

---

### Task 4: depends 依赖门控

**Files:**
- Modify: `workgroup/tools/poll.js`（runLoop 主角色/副角色扫描 predicate）
- Test: `workgroup/tests/wg-e2e.test.js`（追加测试）

**Interfaces:**
- Consumes: Task 3 的 `start`（primary/secondary 已就位）
- Produces: runLoop 中主角色/副角色匹配任务时额外检查 `depends` 依赖全部已验收；未满足则跳过该任务（下轮再查）。依赖状态判断需扫描 `tasks/claimed/*/` 里对应任务 id 的 status。

- [ ] **Step 1: 追加失败测试**

在 `workgroup/tests/wg-e2e.test.js` 末尾追加：

```javascript
test('端到端：depends 依赖未验收的任务不被认领，依赖验收后可认领', async () => {
    const root = tmpRoot();
    const p = paths(root);
    for (const dir of [p.rolesDir, p.membersDir, p.pendingDir, p.claimedDir, p.resultsDir]) ensureDir(dir);
    writeText(p.roleFile('frontend'), '# 前端');

    // 任务 A 依赖任务 D（未验收）
    writeJson(p.taskFile('tA'), { id: 'tA', title: '任务A', role: 'frontend', requirement: '做A', priority: 'high', createdAt: 1, references: [], status: '', depends: ['tD'], level: 'L5' });
    // 先投递依赖任务 tD
    writeJson(p.taskFile('tD'), { id: 'tD', title: '依赖D', role: 'frontend', requirement: '做D', priority: 'high', createdAt: 1, references: [], status: '', depends: [], level: 'L4' });

    const resultD = p.resultFile('tD');
    const resultA = p.resultFile('tA');
    const { start } = require('../tools/poll.js');

    // 第一轮：只有 tD 可认领（tA 依赖 tD 未验收）
    // 让 agent 只处理 tD（buildArgs 根据任务文件写对应结果）
    const app = start({
        root, primary: 'frontend', name: 'alice', command: process.execPath,
        buildArgs: (prompt, taskFile) => {
            const task = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
            const rf = p.resultFile(task.id);
            const res = JSON.stringify({ status: 'completed', summary: '完成', tags: [task.role], learnings: [], output: 'ok' });
            return ['-e', `require('fs').writeFileSync(${JSON.stringify(rf)}, ${JSON.stringify(res)})`];
        },
        pollIntervalMs: 50
    });
    // 等 tD 完成
    await waitFor(() => fs.existsSync(resultD), 5000);
    // 此时 tA 应仍在 pending（依赖未验收）
    assert.ok(fs.existsSync(p.taskFile('tA')), 'tA 依赖未验收不应被认领');
    app.stop();

    // 验收 tD（人工模拟 main）
    writeJson(p.claimedTaskFile('alice-frontend', 'tD'), { id: 'tD', role: 'frontend', status: '已验收' });
    // 第二：重新启动 agent，tA 依赖已验收可认领
    const app2 = start({ root, primary: 'frontend', name: 'alice', command: process.execPath, buildArgs: (prompt, taskFile) => {
        const task = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
        const rf = p.resultFile(task.id);
        const res = JSON.stringify({ status: 'completed', summary: '完成', tags: [], learnings: [], output: 'ok' });
        return ['-e', `require('fs').writeFileSync(${JSON.stringify(rf)}, ${JSON.stringify(res)})`];
    }, pollIntervalMs: 50 });
    await waitFor(() => fs.existsSync(resultA), 5000);
    app2.stop();

    assert.ok(fs.existsSync(p.claimedTaskFile('alice-frontend', 'tA')), '依赖验收后 tA 应被认领');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node workgroup/tests/wg-e2e.test.js`
Expected: FAIL — 无 depends 门控时 tA 在第一轮就被认领

- [ ] **Step 3: 修改 runLoop 匹配 predicate**

将 Task 3 的 runLoop 中两处 `mine` 匹配（主角色 + 副角色）加上依赖检查。在主角色匹配后、认领前增加依赖判断：

```javascript
// depends 依赖全部已验收才可认领（多角色协调）
function depsMet(p, task) {
    const deps = Array.isArray(task.depends) ? task.depends : [];
    if (!deps.length) return true;
    for (const depId of deps) {
        // 在 claimed/ 所有角色目录里找该依赖任务，需 status==已验收
        const found = listFiles(p.claimedDir, '.json').some((f) => {
            const t = readJson(path.join(p.claimedDir, f));
            return t && t.id === depId && t.status === '已验收';
        });
        // 也检查结果文件存在（容错：claimed 里可能没有，但 results 有）
        if (!found && !fs.existsSync(p.resultFile(depId))) return false;
    }
    return true;
}
```

在主角色匹配后加：

```javascript
const mine = primary ? pending.find((t) => t.role === primary && (!t.status || t.status === '') && depsMet(p, t)) : null;
```

在副角色匹配后加：

```javascript
mine = pending.find((t) => secondary.includes(t.role) && (!t.status || t.status === '') && depsMet(p, t));
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node workgroup/tests/wg-e2e.test.js`
Expected: PASS（13 个测试全绿）

- [ ] **Step 5: 提交**

```bash
git add workgroup/tools/poll.js workgroup/tests/wg-e2e.test.js
git commit -m "feat(workgroup): depends 依赖门控——依赖全已验收才可认领"
```

---

### Task 5: 任务取消（取消信号 + kill 子进程）

**Files:**
- Modify: `workgroup/tools/poll.js`（executeTask + spawnClaude 调用）
- Modify: `workgroup/tools/wg-fs.js`（spawnClaude 需暴露 child 供 kill，Task 1 已改）
- Test: `workgroup/tests/wg-e2e.test.js`（追加测试）

**Interfaces:**
- Consumes: Task 1 的 `paths.cancelDir`、Task 3 的 executeTask
- Produces: executeTask 执行期间轮询 `tasks/cancel/<id>` 信号；发现则 `child.kill()` 终止子进程 → 任务 `status='已取消'`。Task 6-7 不变。

- [ ] **Step 1: 追加失败测试**

在 `workgroup/tests/wg-e2e.test.js` 末尾追加：

```javascript
test('端到端：执行中写取消信号 → 任务 status=已取消', async () => {
    const root = tmpRoot();
    const p = paths(root);
    for (const dir of [p.rolesDir, p.membersDir, p.pendingDir, p.claimedDir, p.resultsDir, p.cancelDir]) ensureDir(dir);
    writeText(p.roleFile('frontend'), '# 前端');
    writeJson(p.taskFile('tC'), { id: 'tC', title: '任务C', role: 'frontend', requirement: '做C', priority: 'high', createdAt: 1, references: [], status: '', depends: [], level: 'L4' });

    // 假 claude：sleep 5 秒（模拟长任务），期间可取消
    const { start } = require('../tools/poll.js');
    const app = start({
        root, primary: 'frontend', name: 'alice', command: process.execPath,
        buildArgs: () => ['-e', 'setTimeout(()=>{}, 5000)'],
        pollIntervalMs: 50
    });
    // 等任务被认领（busy 出现）
    await waitFor(() => fs.existsSync(p.roleBusyFile('alice', 'frontend')), 5000);
    // 写取消信号
    writeText(path.join(p.cancelDir, 'tC'), '');
    // 等任务被取消（busy 清 + 任务已取消）
    await waitFor(() => !fs.existsSync(p.roleBusyFile('alice', 'frontend')), 5000);
    app.stop();

    const task = JSON.parse(fs.readFileSync(p.claimedTaskFile('alice-frontend', 'tC'), 'utf8'));
    assert.strictEqual(task.status, '已取消', '任务应标记为已取消');
    assert.ok(!fs.existsSync(path.join(p.cancelDir, 'tC')), '取消信号应被删除');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node workgroup/tests/wg-e2e.test.js`
Expected: FAIL — 无取消逻辑，任务会跑完 5 秒标记已完成

- [ ] **Step 3: 修改 executeTask**

将 Task 3 的 executeTask 中 spawn 部分（`await spawnClaude(...)` 那行）替换为：

```javascript
    // 启动子进程（不 await）：{ child, done }——child 立即可 kill，done 在 close 时 resolve
    const { child, done } = spawnClaude({ command, args, cwd: root, resultFile });
    const cancelSignal = path.join(p.cancelDir, mine.id);
    let cancelled = false;
    while (true) {
        if (fs.existsSync(cancelSignal)) {
            cancelled = true;
            if (child.pid) { try { process.kill(child.pid, 'SIGTERM'); } catch (_) {} }
            break;
        }
        // 每 500ms 检查取消信号，同时检测子进程是否已结束
        if (await Promise.race([done.then(() => true), sleep(500).then(() => false)])) break;
    }
    await done; // 确保 done 已 resolve（子进程正常结束或被 kill）
    fs.rmSync(cancelSignal, { force: true });
    if (cancelled) {
        const cur = readJson(taskFile) || mine;
        writeJson(taskFile, { ...cur, status: '已取消' });
        fs.rmSync(p.roleBusyFile(name, activeRole || ''), { force: true });
        fs.rmSync(p.roleCurrentTaskFile(name, activeRole || ''), { force: true });
        console.log(`[workgroup] 任务 ${mine.id} 已取消`);
        return;
    }
```

**说明**：`spawnClaude` 返回 `{ child, done }`——child 立即可 kill（取消时 SIGTERM），done 在子进程 close 后 resolve `{code, resultWritten}`。executeTask 用 `Promise.race` 每 500ms 轮询取消信号，同时等待 done；子进程被 kill 后 done resolve（code 为 null）。`cancelled` 为 true 时标记任务 `已取消` 并 return，跳过后续结果容错/history/已完成逻辑。

- [ ] **Step 4: 运行测试确认通过**

Run: `node workgroup/tests/wg-e2e.test.js`
Expected: PASS（14 个测试全绿）

- [ ] **Step 5: 提交**

```bash
git add workgroup/tools/poll.js workgroup/tests/wg-e2e.test.js
git commit -m "feat(workgroup): 任务取消——cancel 信号 kill 子进程 + status 已取消"
```

---

### Task 6: 主角色自动切换（空闲 + 防撞车）

**Files:**
- Modify: `workgroup/tools/poll.js`（runLoop 末尾加空闲自动切换）
- Test: `workgroup/tests/wg-e2e.test.js`（追加测试）

**Interfaces:**
- Consumes: Task 3 的 runLoop、Task 1 的 `isAlive`
- Produces: runLoop 在主/副/待修改/指派都无任务时，探测 pending 有积压的角色且该角色无在线 agent（lock 不存在或 PID 已死），自动切换主角色到该角色（删旧 lock、写新 lock + role.md）。Task 7 加 main 指派入口。

- [ ] **Step 1: 追加失败测试**

在 `workgroup/tests/wg-e2e.test.js` 末尾追加：

```javascript
test('端到端：主/副角色无活时自动切到有积压任务且无在线 agent 的角色', async () => {
    const root = tmpRoot();
    const p = paths(root);
    for (const dir of [p.rolesDir, p.membersDir, p.pendingDir, p.claimedDir, p.resultsDir]) ensureDir(dir);
    writeText(p.roleFile('frontend'), '# 前端');
    writeText(p.roleFile('backend-media'), '# 后端媒体');
    // frontend 无任务，backend-media 有积压任务
    writeJson(p.taskFile('t11'), { id: 't11', title: '任务11', role: 'backend-media', requirement: '做后端媒体', priority: 'high', createdAt: 1, references: [], status: '', depends: [], level: 'L4' });

    const resultFile = p.resultFile('t11');
    const { start } = require('../tools/poll.js');
    const app = start({
        root, primary: 'frontend', name: 'alice', command: process.execPath,
        buildArgs: () => ['-e', `require('fs').writeFileSync(${JSON.stringify(resultFile)}, ${JSON.stringify({ status: 'completed', summary: 'ok', tags: [], learnings: [], output: 'x' })})`],
        pollIntervalMs: 50
    });
    await waitFor(() => fs.existsSync(resultFile), 5000);
    await waitFor(() => !fs.existsSync(p.roleBusyFile('alice', 'backend-media')), 5000);
    app.stop();

    assert.ok(fs.existsSync(p.claimedTaskFile('alice-backend-media', 't11')), '应切到 backend-media 并认领任务');
    assert.ok(fs.existsSync(p.roleLockFile('alice', 'backend-media')), '新主角色目录应有 lock');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node workgroup/tests/wg-e2e.test.js`
Expected: FAIL — 无自动切换，frontend 无活时直接 sleep

- [ ] **Step 3: 修改 runLoop 末尾加自动切换**

在 Task 3 的 runLoop 中 `if (mine) {...}` 之后、`await sleep` 之前加：

```javascript
            if (!mine && !isEmpty) {
                // ⑤ 空闲自动切换：主/副/待修改/指派都无活 → 探测 pending 有积压角色且无在线 agent → 切主角色
                const target = pending.find((t) =>
                    (!t.status || t.status === '') &&
                    t.role !== primary && !secondary.includes(t.role) &&
                    !roleHasOnlineAgent(p, t.role)
                );
                if (target) {
                    console.log(`[workgroup] 空闲自动切换：主角色 ${primary || '空'} → ${target.role}`);
                    // 切换：删旧 lock、写新 lock + role.md
                    if (primary) fs.rmSync(p.roleLockFile(name, primary), { force: true });
                    primary = target.role;
                    ensureDir(p.roleDir(name, primary));
                    writeText(p.roleMemberRoleFile(name, primary), serializeRole({ primary, secondary }));
                    writeText(p.roleLockFile(name, primary), `${process.pid} ${Date.now()}`);
                }
            }
```

新增辅助函数（在 runLoop 外）：

```javascript
// 某角色是否有在线 agent（lock 存在且 PID 存活）
function roleHasOnlineAgent(p, role) {
    for (const dir of listDirs(p.membersDir)) {
        const lockText = readText(path.join(p.membersDir, dir, 'lock'));
        if (lockText) {
            const pid = parseInt(lockText.split(' ')[0], 10);
            if (isAlive(pid)) return true;
        }
    }
    return false;
}
```

**注意**：此处的 `roleHasOnlineAgent` 应只统计成员目录（`members/<名>-<角色>/`），不包含 `members/main/`（main 不是任务执行 agent）。用 `listDirs(p.membersDir)` 会包含 main——过滤掉名字为 `main` 的目录。

- [ ] **Step 4: 运行测试确认通过**

Run: `node workgroup/tests/wg-e2e.test.js`
Expected: PASS（15 个测试全绿）

- [ ] **Step 5: 提交**

```bash
git add workgroup/tools/poll.js workgroup/tests/wg-e2e.test.js
git commit -m "feat(workgroup): 主角色空闲自动切换（有积压角色且无在线 agent）+ 防撞车"
```

---

### Task 7: main 指派（assignedTo）

**Files:**
- Modify: `workgroup/tools/poll.js`（runLoop 加指派分支）
- Test: `workgroup/tests/wg-e2e.test.js`（追加测试）

**Interfaces:**
- Consumes: Task 3 的空角色模式、Task 6 的切换逻辑
- Produces: runLoop 扫描 pending 里 `assignedTo == name` 的任务；空角色或主角色不符时切换主角色到任务 role 再认领。

- [ ] **Step 1: 追加失败测试**

在 `workgroup/tests/wg-e2e.test.js` 末尾追加：

```javascript
test('端到端：空角色只认 assignedTo 自己的任务并切换主角色认领', async () => {
    const root = tmpRoot();
    const p = paths(root);
    for (const dir of [p.rolesDir, p.membersDir, p.pendingDir, p.claimedDir, p.resultsDir]) ensureDir(dir);
    writeText(p.roleFile('backend-media'), '# 后端媒体');
    // main 指派给 alice（空角色）一个 backend-media 任务
    writeJson(p.taskFile('t12'), { id: 't12', title: '任务12', role: 'backend-media', requirement: '做后端媒体', priority: 'high', createdAt: 1, references: [], status: '', depends: [], level: 'L4', assignedTo: 'alice' });

    const resultFile = p.resultFile('t12');
    const { start } = require('../tools/poll.js');
    const app = start({
        root, mode: 'empty', name: 'alice', command: process.execPath,
        buildArgs: () => ['-e', `require('fs').writeFileSync(${JSON.stringify(resultFile)}, ${JSON.stringify({ status: 'completed', summary: 'ok', tags: [], learnings: [], output: 'x' })})`],
        pollIntervalMs: 50
    });
    await waitFor(() => fs.existsSync(resultFile), 5000);
    await waitFor(() => !fs.existsSync(p.roleBusyFile('alice', 'backend-media')), 5000);
    app.stop();

    assert.ok(fs.existsSync(p.claimedTaskFile('alice-backend-media', 't12')), '空角色应切主角色到 backend-media 并认领');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node workgroup/tests/wg-e2e.test.js`
Expected: FAIL — 空角色不认 assignedTo 任务

- [ ] **Step 3: 修改 runLoop 加指派分支**

在 Task 6 的 runLoop 主角色匹配之前（`let mine = primary ? ...` 那行之前）加：

```javascript
            // ② 指派：pending 里 assignedTo == name（main 指派给空角色或非空角色）
            let mine = pending.find((t) => t.assignedTo === name && (!t.status || t.status === '') && depsMet(p, t));
            if (mine) {
                // 任务 role 与主角色不符 → 切换主角色到任务 role
                if (mine.role !== primary) {
                    console.log(`[workgroup] main 指派：主角色 ${primary || '空'} → ${mine.role}`);
                    if (primary) fs.rmSync(p.roleLockFile(name, primary), { force: true });
                    primary = mine.role;
                    ensureDir(p.roleDir(name, primary));
                    writeText(p.roleMemberRoleFile(name, primary), serializeRole({ primary, secondary }));
                    writeText(p.roleLockFile(name, primary), `${process.pid} ${Date.now()}`);
                }
            } else if (primary) {
                // ① 主角色新任务（仅非空角色）
                mine = pending.find((t) => t.role === primary && (!t.status || t.status === '') && depsMet(p, t));
            }
```

**注意**：原 Task 3 的 `let mine = primary ? pending.find(...) : null;` 需被此结构替换。`isEmpty` 空角色时 `primary` 初始为空串，指派分支会先命中。

- [ ] **Step 4: 运行测试确认通过**

Run: `node workgroup/tests/wg-e2e.test.js`
Expected: PASS（16 个测试全绿）

- [ ] **Step 5: 提交**

```bash
git add workgroup/tools/poll.js workgroup/tests/wg-e2e.test.js
git commit -m "feat(workgroup): main 指派——assignedTo 任务空角色/不符角色自动切换主角色认领"
```

---

### Task 8: 21 角色文件 + 删旧角色 + README + gitignore

**Files:**
- Create: 16 个新角色（`workgroup/roles/`）
- Delete: `workgroup/roles/frontend.md`、`workgroup/roles/voice.md`
- Modify: `workgroup/roles/main.md`（等级路由）、`workgroup/roles/review.md`、`workgroup/roles/tester.md`
- Modify: `workgroup/README.md`、`workgroup/.gitignore`

**Interfaces:**
- Consumes: 各角色定义映射（见 design.md 目录结构）
- Produces: 21 个角色文件，README 记录启动方式/角色清单/任务字段，gitignore 忽略 `members/main/`、`tasks/cancel/`

- [ ] **Step 1: 创建 16 个新角色文件**

按以下模板创建（每个文件内容参照对应领域，用 `workgroup/roles/main.md` 作为格式参考）。创建这些文件：
`frontend-ui.md`、`frontend-media.md`、`frontend-task.md`、`backend-aasc.md`、`backend-media.md`、`backend-task.md`、`backend-general.md`、`server-app.md`、`display.md`、`3d.md`、`observability.md`、`chat.md`、`auto-brain.md`、`asr.md`、`tts.md`、`voice-capture.md`、`android.md`、`framework.md`

每个文件内容（示例 `backend-media.md`）：

```markdown
# 角色：backend-media

## 职责
- 后台媒体库管理：媒体库提供者、播放列表、文件操作
- 媒体库相关的服务端逻辑

## 负责目录/文件
- src/apps/web-mediacenter/modules/media/
- 对应 docs/spec/media-library.md、docs/spec/batch-playlist.md

## 工作规范
- 遵循项目 CLAUDE.md 文档体系（design/spec/changelog 同步更新）
- 用 AASC 规则组织逻辑，避免大段 if-else
- 完成改动后补充 docs/spec/ 对应模块伪代码
```

其余文件按各自负责目录编写（映射见 `workgroup/docs/design.md` 目录结构段）。

- [ ] **Step 2: 删除旧角色文件**

```bash
git rm workgroup/roles/frontend.md workgroup/roles/voice.md
```

- [ ] **Step 3: 更新 main.md 加等级路由**

在 `workgroup/roles/main.md` 的工作规范中追加等级路由段：

```markdown
## 等级路由（analyze-requirement-level）
- 收到需求先用 analyze-requirement-level 定级（L4-L7）
- L4 单 agent 直接干 / L5 可拆依赖链 / L6 依赖链+强制 review / L7 依赖链+review+严格把关
- 副角色主要承接 L4/L5 低等级任务
```

- [ ] **Step 4: 更新 .gitignore**

在 `workgroup/.gitignore` 追加：

```gitignore
# main 协调者身份（运行时）
members/main/

# 取消信号（运行时）
tasks/cancel/
```

- [ ] **Step 5: 更新 README**

在 `workgroup/README.md` 更新：
- 「启动子 agent」段落改为两种模式（子 agent 带 --role / main 或空角色无 --role）
- 新增「角色清单」段（21 个角色）
- 「任务文件格式」JSON 补充 `level`、`depends`、`assignedTo` 字段
- 「任务状态」表格补充 `已取消`

- [ ] **Step 6: 运行全量测试确认无回归**

Run: `node workgroup/tests/wg-core.test.js && node workgroup/tests/wg-fs.test.js && node workgroup/tests/wg-e2e.test.js`
Expected: 全部 PASS（16 + 10 + 16 = 42）

- [ ] **Step 7: 提交**

```bash
git add workgroup/roles/ workgroup/README.md workgroup/.gitignore
git commit -m "feat(workgroup): 21 角色拆分 + main 等级路由 + README/gitignore 更新"
```

---

## 自测用例对照

| design 自测用例 | 验证位置 |
|---|---|
| 主角色+副角色 | Task 3 e2e「副角色任务仅主角色无活时认领」 |
| 每角色独立目录 | Task 3 e2e「主角色认领任务，成员目录为 <名>-<角色>」 |
| 两种启动模式 | Task 3 e2e「无 main 时启动为 main，有 main 时空角色」 |
| depends 依赖门控 | Task 4 e2e「依赖未验收不被认领」 |
| 任务取消 | Task 5 e2e「执行中写取消信号」 |
| 空闲自动切换 | Task 6 e2e「自动切到有积压角色」 |
| main 指派 | Task 7 e2e「空角色只认 assignedTo」 |
| claude 原始输出 | Task 1 wg-fs spawnClaude stdio inherit 测试（无管道阻塞断言） |
