# 任务状态 + 验收打回 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 workgroup 的任务文件加显式生命周期状态（空=未开始 / 进行中 / 已完成 / 待修改 / 已验收），并支持验收打回：小改动由原 agent 改（reviewComment + 待修改状态）、大改动走 review 角色审查。

**Architecture:** 状态存任务文件内（`status` 字段）。poll.js 认领后写 `进行中`、完成后写 `已完成`，轮询循环除 pending 新任务外增加扫描自己 `claimed/<name>/` 里 `待修改` 任务。`wg-core.js` 的 `buildPrompt` 增加可选 `reviewComment` 注入。大改动 review 复用现有"角色认领任务"机制（review 是普通 role），poll.js 无需特殊处理。

**Tech Stack:** Node.js（v25，仅内置模块 `node:fs`/`node:path`），测试用 `node:test` + `node:assert`。

**Spec:** `workgroup/docs/spec.md` · **Design:** `workgroup/docs/design.md` · 前置实现：Task 1-5（提交 ca605663..a757108）+ 修复（ca0ead4）

## Global Constraints

- 无新增 npm 依赖，只用 Node 内置模块
- Node >= 22（项目环境 v25.7.0）
- 测试风格：`const { test } = require('node:test')` + `node:assert`，运行 `node <testfile>`
- AASC 规则：逻辑用纯函数/映射表，不写大段 if-else 链
- 代码中文注释
- 任务 `status` 取值（中文字符串精确）：`进行中`、`已完成`、`待修改`、`已验收`；空/缺失 = 未开始

---

### Task 1: buildPrompt 支持 reviewComment 注入

**Files:**
- Modify: `workgroup/tools/wg-core.js`（buildPrompt 函数）
- Test: `workgroup/tests/wg-core.test.js`（追加测试）

**Interfaces:**
- Consumes: 现有 `buildPrompt({ role, name, summary, taskFile, resultFile })`（wg-core.js:43-60）
- Produces: `buildPrompt` 增加可选参数 `reviewComment`；有值时在输出中插入 `【修改要求（上次验收打回）】` 段。Task 2 的 poll.js executeTask 传 `reviewComment: mine.reviewComment`。

- [ ] **Step 1: 追加失败测试**

在 `workgroup/tests/wg-core.test.js` 末尾追加：

```javascript
test('buildPrompt 带 reviewComment 时注入修改要求段', () => {
    const p = buildPrompt({
        role: 'frontend', name: 'alice',
        summary: '擅长UI',
        taskFile: '/t.json', resultFile: '/r.json',
        reviewComment: '按钮颜色改蓝色'
    });
    assert.ok(p.includes('【修改要求（上次验收打回）】'));
    assert.ok(p.includes('按钮颜色改蓝色'));
});

test('buildPrompt 不带 reviewComment 时不注入修改要求段', () => {
    const p = buildPrompt({
        role: 'frontend', name: 'alice',
        summary: '擅长UI',
        taskFile: '/t.json', resultFile: '/r.json'
    });
    assert.ok(!p.includes('【修改要求（上次验收打回）】'));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node workgroup/tests/wg-core.test.js`
Expected: FAIL — 新增 2 个测试失败（输出不含 reviewComment）

- [ ] **Step 3: 修改 buildPrompt**

将 `workgroup/tools/wg-core.js` 的 buildPrompt（现 43-60 行）替换为：

```javascript
// 子 agent 执行任务的 prompt：注入角色总结，指示读任务/写结果；可选注入验收打回修改要求
function buildPrompt({ role, name, summary, taskFile, resultFile, reviewComment }) {
    const review = reviewComment ? `\n【修改要求（上次验收打回）】\n${reviewComment}\n` : '';
    return `你是 workgroup 的「${role}」角色成员「${name}」。

【角色总结】
${summary || '（暂无总结）'}
${review}
【任务】
读取任务文件：${taskFile}
按任务文件中的 requirement 完成任务。
完成后把结果写入结果文件：${resultFile}
结果文件为 JSON，包含字段：
- status: "completed" 或 "failed"
- summary: 一句话摘要
- tags: 领域标签数组（如 ["前端","UI"]）
- learnings: 1-3 条项目约定/经验（供后续任务参考）
- output: 详细输出或说明
`;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node workgroup/tests/wg-core.test.js`
Expected: PASS（12 个测试全绿）

- [ ] **Step 5: 提交**

```bash
git add workgroup/tools/wg-core.js workgroup/tests/wg-core.test.js
git commit -m "feat(workgroup): buildPrompt 支持 reviewComment 注入（验收打回修改要求）"
```

---

### Task 2: poll.js 任务状态写入 + 待修改扫描

**Files:**
- Modify: `workgroup/tools/poll.js`（start 的 runLoop + executeTask）
- Test: `workgroup/tests/wg-e2e.test.js`（追加测试）

**Interfaces:**
- Consumes: Task 1 的 `buildPrompt(..., reviewComment)`；现有 wg-fs.js `paths/atomicClaim/listFiles/readJson/writeJson`
- Produces: poll.js 认领后任务文件 `status='进行中'`、完成后 `status='已完成'`；轮询扫描自己 `claimed/<name>/` 里 `status='待修改'` 任务并重做。行为供 Task 3 的 roles/review.md 与 main 验收人工流程依赖。

- [ ] **Step 1: 追加失败测试**

在 `workgroup/tests/wg-e2e.test.js` 末尾追加三个测试：

```javascript
test('端到端：任务状态流转 进行中→已完成', async () => {
    const root = tmpRoot();
    const p = paths(root);
    for (const dir of [p.rolesDir, p.membersDir, p.pendingDir, p.claimedDir, p.resultsDir]) ensureDir(dir);
    writeText(p.roleFile('frontend'), '# 前端角色');
    writeJson(p.taskFile('t4'), { id: 't4', title: '任务4', role: 'frontend', requirement: '做前端', priority: 'high', createdAt: 1, references: [], status: '' });

    const resultFile = p.resultFile('t4');
    const fakeResult = JSON.stringify({ status: 'completed', summary: '完成', tags: ['UI'], learnings: [], output: 'ok' });
    const fakeScript = `require('fs').writeFileSync(${JSON.stringify(resultFile)}, ${JSON.stringify(fakeResult)})`;

    const { start } = require('../tools/poll.js');
    const app = start({ root, role: 'frontend', name: 'alice', command: process.execPath, buildArgs: () => ['-e', fakeScript], pollIntervalMs: 50 });
    await waitFor(() => fs.existsSync(resultFile), 5000);
    await waitFor(() => !fs.existsSync(p.busyFile('alice')), 5000);
    app.stop();

    const task = JSON.parse(fs.readFileSync(p.claimedTaskFile('alice', 't4'), 'utf8'));
    assert.strictEqual(task.status, '已完成', '完成后任务状态应为已完成');
    assert.ok(fs.existsSync(p.claimedTaskFile('alice', 't4')), '任务应在 claimed/alice/');
});

test('端到端：待修改任务由原 agent 重做，prompt 注入 reviewComment，完成后回到已完成', async () => {
    const root = tmpRoot();
    const p = paths(root);
    for (const dir of [p.rolesDir, p.membersDir, p.pendingDir, p.claimedDir, p.resultsDir]) ensureDir(dir);
    writeText(p.roleFile('frontend'), '# 前端角色');
    // 直接构造一个已认领但被打回的待修改任务
    ensureDir(path.join(p.claimedDir, 'alice'));
    writeJson(p.claimedTaskFile('alice', 't5'), { id: 't5', title: '任务5', role: 'frontend', requirement: '做前端', priority: 'high', createdAt: 1, references: [], status: '待修改', reviewComment: '按钮颜色改蓝色' });

    const resultFile = p.resultFile('t5');
    const fakeResult = JSON.stringify({ status: 'completed', summary: '改完', tags: ['UI'], learnings: [], output: 'ok' });
    const fakeScript = `require('fs').writeFileSync(${JSON.stringify(resultFile)}, ${JSON.stringify(fakeResult)})`;

    let capturedPrompt = '';
    const { start } = require('../tools/poll.js');
    const app = start({
        root, role: 'frontend', name: 'alice',
        command: process.execPath,
        buildArgs: (prompt) => { capturedPrompt = prompt; return ['-e', fakeScript]; },
        pollIntervalMs: 50
    });
    await waitFor(() => fs.existsSync(resultFile), 5000);
    await waitFor(() => !fs.existsSync(p.busyFile('alice')), 5000);
    app.stop();

    assert.ok(capturedPrompt.includes('按钮颜色改蓝色'), 'prompt 应注入 reviewComment');
    const task = JSON.parse(fs.readFileSync(p.claimedTaskFile('alice', 't5'), 'utf8'));
    assert.strictEqual(task.status, '已完成', '重做完成后状态应为已完成');
});

test('端到端：role=review 任务被 review 角色认领执行', async () => {
    const root = tmpRoot();
    const p = paths(root);
    for (const dir of [p.rolesDir, p.membersDir, p.pendingDir, p.claimedDir, p.resultsDir]) ensureDir(dir);
    writeText(p.roleFile('review'), '# 审查角色');
    writeJson(p.taskFile('t6'), { id: 't6', title: '审查任务', role: 'review', requirement: '审查原任务', priority: 'high', createdAt: 1, references: [], status: '' });

    const resultFile = p.resultFile('t6');
    const fakeResult = JSON.stringify({ status: 'completed', summary: 'pass', tags: ['review'], learnings: [], output: 'verdict: pass' });
    const fakeScript = `require('fs').writeFileSync(${JSON.stringify(resultFile)}, ${JSON.stringify(fakeResult)})`;

    const { start } = require('../tools/poll.js');
    const app = start({ root, role: 'review', name: 'charlie', command: process.execPath, buildArgs: () => ['-e', fakeScript], pollIntervalMs: 50 });
    await waitFor(() => fs.existsSync(resultFile), 5000);
    await waitFor(() => !fs.existsSync(p.busyFile('charlie')), 5000);
    app.stop();

    const task = JSON.parse(fs.readFileSync(p.claimedTaskFile('charlie', 't6'), 'utf8'));
    assert.strictEqual(task.status, '已完成', 'review 任务完成后状态应为已完成');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node workgroup/tests/wg-e2e.test.js`
Expected: FAIL — 新增 3 个测试失败（任务文件无 status 字段、待修改任务不被扫描）

- [ ] **Step 3: 修改 poll.js**

将 `workgroup/tools/poll.js` 的 runLoop（start 内，现 50-65 行）替换为：

```javascript
    let running = true;
    const runLoop = async () => {
        while (running) {
            // 1) 新任务：pending 里 role 匹配（status 空/缺失）
            const pending = listFiles(p.pendingDir, '.json')
                .map((f) => readJson(path.join(p.pendingDir, f)))
                .filter(Boolean);
            const mine = pending.find((t) => t.role === role);
            if (mine) {
                const ok = atomicClaim(p, name, mine.id);
                if (ok) {
                    await executeTask({ p, root, role, name, mine, command, buildArgs });
                    if (onTaskDone) await onTaskDone();
                }
            } else {
                // 2) 待修改：自己 claimed/<name>/ 里 status=待修改（验收打回小改动，原 agent 重做）
                const mineDir = path.join(p.claimedDir, name);
                const rework = listFiles(mineDir, '.json')
                    .map((f) => readJson(path.join(mineDir, f)))
                    .find((t) => t && t.status === '待修改');
                if (rework) {
                    await executeTask({ p, root, role, name, mine: rework, command, buildArgs });
                    if (onTaskDone) await onTaskDone();
                }
            }
            await sleep(pollIntervalMs);
        }
    };
```

将 `workgroup/tools/poll.js` 的 executeTask（现 70-98 行）替换为：

```javascript
// 执行单个任务：busy 标记 → 任务状态进行中 → 注入总结/修改要求 → spawn claude → 更新 history → 状态已完成 → 回到空闲
async function executeTask({ p, root, role, name, mine, command, buildArgs }) {
    writeText(p.busyFile(name), '');
    writeText(p.currentTaskFile(name), mine.id);
    const taskFile = p.claimedTaskFile(name, mine.id);
    const resultFile = p.resultFile(mine.id);
    // 落盘状态=进行中（pending 新任务 rename 后、待修改任务就地更新）
    writeJson(taskFile, { ...mine, status: '进行中' });
    const summary = buildSummary(readText(p.historyFile(name)));
    const prompt = buildPrompt({ role, name, summary, taskFile, resultFile, reviewComment: mine.reviewComment });
    const args = buildArgs ? buildArgs(prompt, taskFile, resultFile) : ['--print', '--permission-mode', 'bypassPermissions', prompt];
    await spawnClaude({ command, args, cwd: root, resultFile });

    // 结果容错：非法/缺失则标记 failed
    let res = readJson(resultFile);
    if (!res) {
        res = { id: mine.id, status: 'failed', summary: '子 agent 未返回有效结果', tags: [], learnings: [], output: '' };
        writeJson(resultFile, res);
    }
    const tags = Array.isArray(res.tags) ? res.tags : [];
    const learnings = Array.isArray(res.learnings) ? res.learnings : [];
    const newHistory = updateHistory(readText(p.historyFile(name)), {
        tags, learnings,
        record: { id: mine.id, title: mine.title || '', summary: res.summary || '', tags, at: Date.now() }
    });
    writeText(p.historyFile(name), newHistory);

    // 完成后状态 = 已完成
    const cur = readJson(taskFile) || mine;
    writeJson(taskFile, { ...cur, status: '已完成' });

    fs.rmSync(p.busyFile(name), { force: true });
    fs.rmSync(p.currentTaskFile(name), { force: true });
    console.log(`[workgroup] 任务 ${mine.id} 完成（${res.status}）`);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node workgroup/tests/wg-e2e.test.js`
Expected: PASS（7 个端到端测试全绿，含新增 3 个）

- [ ] **Step 5: 运行全量测试确认无回归**

Run: `node workgroup/tests/wg-core.test.js && node workgroup/tests/wg-fs.test.js && node workgroup/tests/wg-e2e.test.js`
Expected: 全部 PASS（12 + 8 + 7 = 27）

- [ ] **Step 6: 提交**

```bash
git add workgroup/tools/poll.js workgroup/tests/wg-e2e.test.js
git commit -m "feat(workgroup): 任务状态写入（进行中/已完成）+ 待修改任务原 agent 重做扫描"
```

---

### Task 3: review 角色定义 + 文档收尾

**Files:**
- Create: `workgroup/roles/review.md`
- Modify: `workgroup/README.md`（状态说明）
- Modify: `changelog.md`（追加增量记录）

**Interfaces:**
- Consumes: Task 2 的 poll.js（review 是普通 role，可被认领执行）
- Produces: review 角色定义（供 main 大改动打回时投递 role=review 任务）

- [ ] **Step 1: 创建 review 角色定义**

创建 `workgroup/roles/review.md`：

```markdown
# 角色：review

## 职责
- 审查验收打回的大改动任务
- 读原任务文件的 requirement / reviewComment、读 results/<id>.json 的 output
- 判定改动是否达标，结果文件 status 写 completed（pass）或 failed（fail）

## 负责目录/文件
- tasks/claimed/（被审查任务）
- results/（被审查结果）

## 工作规范
- 遵循项目 CLAUDE.md 文档体系（design/spec/changelog 同步更新）
- verdict 写入结果文件的 output 字段，status 用 completed/failed 表达 pass/fail
```

- [ ] **Step 2: 更新 README 状态说明**

在 `workgroup/README.md` 的「任务文件格式」JSON 块中，把 `"priority": "high",` 行后补一行 `"status": "",` 和 `"reviewComment": "",`；并在 JSON 块下方追加状态说明：

```markdown
## 任务状态

| status | 含义 |
|--------|------|
| （空） | 未开始（main 投递） |
| 进行中 | 已认领，子 agent 干活 |
| 已完成 | 干完、结果已写，待 main 验收 |
| 待修改 | 验收打回（小改动，原 agent 重做） |
| 已验收 | 用户确认通过 |

验收：main 扫描 status=已完成 任务呈现结果 → 用户通过（已验收）或提修改（写 reviewComment；小改动原 agent 改，大改动投 role=review 任务审查）。
```

- [ ] **Step 3: 追加 changelog**

在 `changelog.md` 顶部 `### 新增` 下、现有 workgroup 条目之前追加：

```markdown
- ✅ [2026-08-17] workgroup 任务状态 + 验收打回
  - 任务文件加 status 字段（空=未开始 / 进行中 / 已完成 / 待修改 / 已验收），认领后写进行中、完成后写已完成
  - 验收打回：小改动写 reviewComment + 待修改，原 agent 重做；大改动投 role=review 任务，review 角色审查
  - buildPrompt 支持 reviewComment 注入；roles/review.md 审查角色
  - 改动文件：
    - workgroup/tools/poll.js（状态写入 + 待修改扫描）
    - workgroup/tools/wg-core.js（buildPrompt reviewComment）
    - workgroup/roles/review.md（新增）
    - workgroup/tests/wg-e2e.test.js、wg-core.test.js（+5 测试）
    - workgroup/README.md
```

- [ ] **Step 4: 运行全量测试确认无回归**

Run: `node workgroup/tests/wg-core.test.js && node workgroup/tests/wg-fs.test.js && node workgroup/tests/wg-e2e.test.js`
Expected: 全部 PASS（12 + 8 + 7 = 27）

- [ ] **Step 5: 提交**

```bash
git add workgroup/roles/review.md workgroup/README.md changelog.md
git commit -m "feat(workgroup): review 审查角色 + README/changelog 记录任务状态与验收打回"
```

---

## 自测用例对照

| design 自测用例 | 验证位置 |
|---|---|
| 任务状态流转（进行中→已完成） | wg-e2e.test.js「状态流转 进行中→已完成」 |
| 打回小改动（待修改 + reviewComment → 原 agent 重做 → 已完成） | wg-e2e.test.js「待修改任务由原 agent 重做」 |
| 打回大改动（review 角色审查） | wg-e2e.test.js「role=review 任务被 review 角色认领」+ roles/review.md |
| buildPrompt reviewComment 注入 | wg-core.test.js「带 reviewComment」 |
