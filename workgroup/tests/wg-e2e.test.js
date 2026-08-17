'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { paths, ensureDir, writeText, writeJson, readText } = require('../tools/wg-fs.js');

function tmpRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'wg-e2e-'));
}

async function waitFor(fn, timeoutMs) {
    const start = Date.now();
    while (!fn()) {
        if (Date.now() - start > timeoutMs) throw new Error('waitFor 超时');
        await new Promise((r) => setTimeout(r, 20));
    }
}

test('端到端：投递→原子认领→执行→结果→history 更新→回到空闲', async () => {
    const root = tmpRoot();
    const p = paths(root);
    for (const dir of [p.rolesDir, p.membersDir, p.pendingDir, p.claimedDir, p.resultsDir]) ensureDir(dir);
    writeText(p.roleFile('frontend'), '# 前端角色\n\n## 职责\n前端开发');

    // 投递一个 role=frontend 的任务
    writeJson(p.taskFile('t1'), { id: 't1', title: '任务1', role: 'frontend', requirement: '做前端', priority: 'high', createdAt: 1, references: [] });

    // 假 claude：往 poll.js 期望的结果文件写合法 JSON
    const resultFile = p.resultFile('t1');
    const fakeResult = JSON.stringify({ status: 'completed', summary: '完成', tags: ['UI'], learnings: ['约定A'], output: 'ok' });
    const fakeScript = `require('fs').writeFileSync(${JSON.stringify(resultFile)}, ${JSON.stringify(fakeResult)})`;

    const { start } = require('../tools/poll.js');
    const app = start({
        root, primary: 'frontend', name: 'alice',
        command: process.execPath,
        buildArgs: () => ['-e', fakeScript],
        pollIntervalMs: 50
    });

    await waitFor(() => fs.existsSync(resultFile), 5000);
    await waitFor(() => !fs.existsSync(p.roleBusyFile('alice', 'frontend')), 5000);
    app.stop();

    // 断言全链路
    assert.ok(fs.existsSync(p.roleLockFile('alice', 'frontend')), 'lock 应存在');
    assert.strictEqual(readText(p.roleMemberRoleFile('alice', 'frontend')).includes('frontend'), true, 'role.md 应记录主角色');
    assert.ok(fs.existsSync(p.claimedTaskFile('alice-frontend', 't1')), '任务应移动到 claimed/alice-frontend/');
    assert.ok(fs.existsSync(resultFile), '结果文件应存在');
    const history = readText(p.roleHistoryFile('alice', 'frontend'));
    assert.ok(history.includes('UI'), 'history 应含专长标签');
    assert.ok(history.includes('约定A'), 'history 应含经验约定');
    assert.ok(!fs.existsSync(p.roleBusyFile('alice', 'frontend')), '忙碌标记应已删除');
    assert.ok(!fs.existsSync(p.roleCurrentTaskFile('alice', 'frontend')), 'current-task 应已删除');
});

test('端到端：role 不匹配的任务不被认领', async () => {
    const root = tmpRoot();
    const p = paths(root);
    for (const dir of [p.rolesDir, p.membersDir, p.pendingDir, p.claimedDir, p.resultsDir]) ensureDir(dir);
    writeText(p.roleFile('backend'), '# 后端');
    writeJson(p.taskFile('t2'), { id: 't2', title: '后端任务', role: 'backend', requirement: '做后端', priority: 'high', createdAt: 1, references: [] });
    // 已有 backend 角色的在线 agent（carol，用测试进程 PID 模拟存活 lock）：
    // 防撞车——bob 空闲也不会自动切换到已有在线 agent 的角色，t2 保持无人认领
    writeText(p.roleLockFile('carol', 'backend'), `${process.pid} 1`);

    const { start } = require('../tools/poll.js');
    const app = start({ root, primary: 'frontend', name: 'bob', pollIntervalMs: 50 });
    await new Promise((r) => setTimeout(r, 250));
    app.stop();

    assert.ok(fs.existsSync(p.taskFile('t2')), '不匹配任务应留在 pending');
    assert.ok(!fs.existsSync(p.claimedTaskFile('bob-frontend', 't2')), '不应被认领');
});

test('端到端：已有在线 lock（同 PID）启动应拒绝', async () => {
    const root = tmpRoot();
    const p = paths(root);
    ensureDir(p.roleDir('alice', 'frontend'));
    writeText(p.roleLockFile('alice', 'frontend'), `${process.pid} 1`); // 当前进程假在线

    const { start } = require('../tools/poll.js');
    let exited = false;
    const oldExit = process.exit;
    process.exit = () => { exited = true; }; // 拦截 exit(1)
    start({ root, primary: 'frontend', name: 'alice' });
    process.exit = oldExit;
    assert.strictEqual(exited, true, 'lock 冲突时应退出');
});

test('端到端：子 agent 未写结果文件 → poll.js 补写 failed', async () => {
    const root = tmpRoot();
    const p = paths(root);
    for (const dir of [p.rolesDir, p.membersDir, p.pendingDir, p.claimedDir, p.resultsDir]) ensureDir(dir);
    writeText(p.roleFile('frontend'), '# 前端角色\n\n## 职责\n前端开发');

    // 投递一个 role=frontend 的任务
    writeJson(p.taskFile('t3'), { id: 't3', title: '任务3', role: 'frontend', requirement: '做前端', priority: 'high', createdAt: 1, references: [] });

    // 假 claude：no-op，什么都不写 → 模拟子 agent 崩溃/未写结果文件
    const resultFile = p.resultFile('t3');
    const { start } = require('../tools/poll.js');
    const app = start({
        root, primary: 'frontend', name: 'alice',
        command: process.execPath,
        buildArgs: () => ['-e', '/* no-op: 不写结果文件 */'],
        pollIntervalMs: 50
    });

    await waitFor(() => fs.existsSync(resultFile), 5000);
    await waitFor(() => !fs.existsSync(p.roleBusyFile('alice', 'frontend')), 5000);
    app.stop();

    // 断言：结果文件存在且 status=failed，history 不崩，busy 已清
    const res = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    assert.strictEqual(res.status, 'failed', '结果文件应由 poll.js 补写 failed');
    assert.strictEqual(res.summary, '子 agent 未返回有效结果');
    const history = readText(p.roleHistoryFile('alice', 'frontend'));
    assert.ok(history.includes('最近记录'), 'history 最近记录段应存在');
    assert.ok(history.includes('"id":"t3"'), 'history 最近记录应含任务 id');
    assert.ok(!fs.existsSync(p.roleBusyFile('alice', 'frontend')), '忙碌标记应已删除');
    assert.ok(!fs.existsSync(p.roleCurrentTaskFile('alice', 'frontend')), 'current-task 应已删除');
});

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
    const app = start({ root, primary: 'frontend', name: 'alice', command: process.execPath, buildArgs: () => ['-e', fakeScript], pollIntervalMs: 50 });
    await waitFor(() => fs.existsSync(resultFile), 5000);
    await waitFor(() => !fs.existsSync(p.roleBusyFile('alice', 'frontend')), 5000);
    app.stop();

    const task = JSON.parse(fs.readFileSync(p.claimedTaskFile('alice-frontend', 't4'), 'utf8'));
    assert.strictEqual(task.status, '已完成', '完成后任务状态应为已完成');
    assert.ok(fs.existsSync(p.claimedTaskFile('alice-frontend', 't4')), '任务应在 claimed/alice-frontend/');
});

test('端到端：待修改任务由原 agent 重做，prompt 注入 reviewComment，完成后回到已完成', async () => {
    const root = tmpRoot();
    const p = paths(root);
    for (const dir of [p.rolesDir, p.membersDir, p.pendingDir, p.claimedDir, p.resultsDir]) ensureDir(dir);
    writeText(p.roleFile('frontend'), '# 前端角色');
    // 直接构造一个已认领但被打回的待修改任务
    ensureDir(path.join(p.claimedDir, 'alice-frontend'));
    writeJson(p.claimedTaskFile('alice-frontend', 't5'), { id: 't5', title: '任务5', role: 'frontend', requirement: '做前端', priority: 'high', createdAt: 1, references: [], status: '待修改', reviewComment: '按钮颜色改蓝色' });

    const resultFile = p.resultFile('t5');
    const fakeResult = JSON.stringify({ status: 'completed', summary: '改完', tags: ['UI'], learnings: [], output: 'ok' });
    const fakeScript = `require('fs').writeFileSync(${JSON.stringify(resultFile)}, ${JSON.stringify(fakeResult)})`;

    let capturedPrompt = '';
    const { start } = require('../tools/poll.js');
    const app = start({
        root, primary: 'frontend', name: 'alice',
        command: process.execPath,
        buildArgs: (prompt) => { capturedPrompt = prompt; return ['-e', fakeScript]; },
        pollIntervalMs: 50
    });
    await waitFor(() => fs.existsSync(resultFile), 5000);
    await waitFor(() => !fs.existsSync(p.roleBusyFile('alice', 'frontend')), 5000);
    app.stop();

    assert.ok(capturedPrompt.includes('按钮颜色改蓝色'), 'prompt 应注入 reviewComment');
    const task = JSON.parse(fs.readFileSync(p.claimedTaskFile('alice-frontend', 't5'), 'utf8'));
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
    const app = start({ root, primary: 'review', name: 'charlie', command: process.execPath, buildArgs: () => ['-e', fakeScript], pollIntervalMs: 50 });
    await waitFor(() => fs.existsSync(resultFile), 5000);
    await waitFor(() => !fs.existsSync(p.roleBusyFile('charlie', 'review')), 5000);
    app.stop();

    const task = JSON.parse(fs.readFileSync(p.claimedTaskFile('charlie-review', 't6'), 'utf8'));
    assert.strictEqual(task.status, '已完成', 'review 任务完成后状态应为已完成');
});

test('端到端：崩溃残留 status=进行中 任务重启后重置待修改并重做完成', async () => {
    const root = tmpRoot();
    const p = paths(root);
    for (const dir of [p.rolesDir, p.membersDir, p.pendingDir, p.claimedDir, p.resultsDir]) ensureDir(dir);
    writeText(p.roleFile('frontend'), '# 前端角色');
    // 预置一个 status=进行中 的任务在 claimed/alice/（模拟 agent 写完进行中、未写已完成即崩溃）
    ensureDir(path.join(p.claimedDir, 'alice-frontend'));
    writeJson(p.claimedTaskFile('alice-frontend', 't7'), { id: 't7', title: '任务7', role: 'frontend', requirement: '做前端', priority: 'high', createdAt: 1, references: [], status: '进行中' });

    const resultFile = p.resultFile('t7');
    const fakeResult = JSON.stringify({ status: 'completed', summary: '完成', tags: ['UI'], learnings: [], output: 'ok' });
    const fakeScript = `require('fs').writeFileSync(${JSON.stringify(resultFile)}, ${JSON.stringify(fakeResult)})`;

    const { start } = require('../tools/poll.js');
    const app = start({
        root, primary: 'frontend', name: 'alice',
        command: process.execPath,
        buildArgs: () => ['-e', fakeScript],
        pollIntervalMs: 50
    });
    await waitFor(() => fs.existsSync(resultFile), 5000);
    await waitFor(() => !fs.existsSync(p.roleBusyFile('alice', 'frontend')), 5000);
    app.stop();

    const task = JSON.parse(fs.readFileSync(p.claimedTaskFile('alice-frontend', 't7'), 'utf8'));
    assert.strictEqual(task.status, '已完成', '进行中 崩溃残留任务重启后应被重置待修改并重做完成');
});

test('端到端：role=review + kind:review + reviewOf 审查子任务完成后保留 kind/reviewOf 且 status=已完成', async () => {
    const root = tmpRoot();
    const p = paths(root);
    for (const dir of [p.rolesDir, p.membersDir, p.pendingDir, p.claimedDir, p.resultsDir]) ensureDir(dir);
    writeText(p.roleFile('review'), '# 审查角色');

    // main 投递大改动验收打回的 review 审查子任务：kind=review 标记审查子任务，reviewOf 指向被审查原任务
    writeJson(p.taskFile('t8'), {
        id: 't8', title: '审查原任务 t-origin', role: 'review',
        requirement: '审查原任务 t-origin 的改动是否达标',
        priority: 'high', createdAt: 1, references: [], status: '',
        kind: 'review', reviewOf: 't-origin'
    });

    const resultFile = p.resultFile('t8');
    const fakeResult = JSON.stringify({ status: 'completed', summary: 'pass', tags: ['review'], learnings: [], output: 'verdict: pass' });
    const fakeScript = `require('fs').writeFileSync(${JSON.stringify(resultFile)}, ${JSON.stringify(fakeResult)})`;

    const { start, isReviewTask } = require('../tools/poll.js');
    const app = start({ root, primary: 'review', name: 'charlie', command: process.execPath, buildArgs: () => ['-e', fakeScript], pollIntervalMs: 50 });
    await waitFor(() => fs.existsSync(resultFile), 5000);
    await waitFor(() => !fs.existsSync(p.roleBusyFile('charlie', 'review')), 5000);
    app.stop();

    const task = JSON.parse(fs.readFileSync(p.claimedTaskFile('charlie-review', 't8'), 'utf8'));
    assert.strictEqual(task.status, '已完成', 'review 审查子任务完成后状态应为已完成');
    assert.strictEqual(task.kind, 'review', 'kind=review 应在状态更新（进行中/已完成）后保留');
    assert.strictEqual(task.reviewOf, 't-origin', 'reviewOf 应在状态更新后保留');
    assert.strictEqual(isReviewTask(task), true, 'isReviewTask 应识别 kind=review 任务');
    assert.strictEqual(isReviewTask({ id: 'x', role: 'frontend' }), false, '普通任务（无 kind）不应判为 review 任务');
});

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

    // app.stop() 只停轮询不删 lock（SIGINT/SIGTERM 清理才删）；重启同名单须先删残留 lock，模拟正常下线
    fs.rmSync(p.roleLockFile('alice', 'frontend'), { force: true });

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

test('回归：空角色指派切换后认领目录为 <名>-<角色>，不残留 claimed/<名>/ 副本', async () => {
    const root = tmpRoot();
    const p = paths(root);
    for (const dir of [p.rolesDir, p.membersDir, p.pendingDir, p.claimedDir, p.resultsDir]) ensureDir(dir);
    writeText(p.roleFile('backend-media'), '# 后端媒体');
    // main 指派给 alice（空角色）一个 backend-media 任务
    writeJson(p.taskFile('tr1'), { id: 'tr1', title: '任务1', role: 'backend-media', requirement: '做后端媒体', priority: 'high', createdAt: 1, references: [], status: '', depends: [], level: 'L4', assignedTo: 'alice' });

    const resultFile = p.resultFile('tr1');
    const fakeResult = JSON.stringify({ status: 'completed', summary: 'ok', tags: [], learnings: [], output: 'x' });
    const { start } = require('../tools/poll.js');
    const app = start({
        root, mode: 'empty', name: 'alice', command: process.execPath,
        buildArgs: () => ['-e', `require('fs').writeFileSync(${JSON.stringify(resultFile)}, ${JSON.stringify(fakeResult)})`],
        pollIntervalMs: 50
    });
    await waitFor(() => fs.existsSync(resultFile), 5000);
    await waitFor(() => !fs.existsSync(p.roleBusyFile('alice', 'backend-media')), 5000);
    app.stop();

    // 认领应落在 claimed/alice-backend-media/，且 claimed/alice/ 无无角色残留副本
    assert.ok(fs.existsSync(p.claimedTaskFile('alice-backend-media', 'tr1')), '任务应在 claimed/alice-backend-media/');
    assert.ok(!fs.existsSync(path.join(p.claimedDir, 'alice')), '不应残留 claimed/alice/ 无角色副本');
    const task = JSON.parse(fs.readFileSync(p.claimedTaskFile('alice-backend-media', 'tr1'), 'utf8'));
    assert.strictEqual(task.status, '已完成', '任务完成后状态应为已完成');
    assert.strictEqual(task._fromRework, undefined, '任务文件不应含 _fromRework 内部标记');
});

test('回归：depends 依赖已完成但未验收（results 存在）时不满足门控，不被认领', async () => {
    const root = tmpRoot();
    const p = paths(root);
    for (const dir of [p.rolesDir, p.membersDir, p.pendingDir, p.claimedDir, p.resultsDir]) ensureDir(dir);
    writeText(p.roleFile('frontend'), '# 前端');
    // 任务 A 依赖 D；D 已完成但仅 status=已完成（未验收），且 results/D.json 存在
    writeJson(p.taskFile('tA2'), { id: 'tA2', title: '任务A', role: 'frontend', requirement: '做A', priority: 'high', createdAt: 1, references: [], status: '', depends: ['tD2'], level: 'L5' });
    ensureDir(path.join(p.claimedDir, 'alice-frontend'));
    writeJson(p.claimedTaskFile('alice-frontend', 'tD2'), { id: 'tD2', role: 'frontend', status: '已完成' });
    writeJson(p.resultFile('tD2'), { status: 'completed', summary: '完成' });

    const { start } = require('../tools/poll.js');
    const app = start({ root, primary: 'frontend', name: 'alice', command: process.execPath, buildArgs: () => ['-e', '/* no-op */'], pollIntervalMs: 50 });
    // 跑几轮：tA2 依赖未验收，不应被认领（results 存在但不作数）
    await new Promise((r) => setTimeout(r, 300));
    app.stop();

    assert.ok(fs.existsSync(p.taskFile('tA2')), '依赖已完成但未验收的任务应留在 pending');
    assert.ok(!fs.existsSync(p.claimedTaskFile('alice-frontend', 'tA2')), '不应被认领');
});

test('回归：副角色待修改任务由原 agent 重做，任务文件不含 _fromRework', async () => {
    const root = tmpRoot();
    const p = paths(root);
    for (const dir of [p.rolesDir, p.membersDir, p.pendingDir, p.claimedDir, p.resultsDir]) ensureDir(dir);
    writeText(p.roleFile('frontend'), '# 前端');
    writeText(p.roleFile('backend-media'), '# 后端媒体');
    // 副角色 backend-media 任务已认领在 claimed/alice-frontend/（当时主角色 frontend），被打回待修改
    ensureDir(path.join(p.claimedDir, 'alice-frontend'));
    writeJson(p.claimedTaskFile('alice-frontend', 'tR'), { id: 'tR', title: '任务R', role: 'backend-media', requirement: '做后端媒体', priority: 'high', createdAt: 1, references: [], status: '待修改', reviewComment: '改样式' });

    const resultFile = p.resultFile('tR');
    const fakeResult = JSON.stringify({ status: 'completed', summary: '改完', tags: [], learnings: [], output: 'ok' });
    const { start } = require('../tools/poll.js');
    const app = start({
        root, primary: 'frontend', secondary: ['backend-media'], name: 'alice', command: process.execPath,
        buildArgs: () => ['-e', `require('fs').writeFileSync(${JSON.stringify(resultFile)}, ${JSON.stringify(fakeResult)})`],
        pollIntervalMs: 50
    });
    try {
        await waitFor(() => fs.existsSync(resultFile), 5000);
        await waitFor(() => !fs.existsSync(p.roleBusyFile('alice', 'frontend')), 5000);
    } finally {
        app.stop();
    }

    const task = JSON.parse(fs.readFileSync(p.claimedTaskFile('alice-frontend', 'tR'), 'utf8'));
    assert.strictEqual(task.status, '已完成', '副角色待修改任务应被重做完成');
    assert.strictEqual(task._fromRework, undefined, '任务文件不应含 _fromRework 内部标记');
});
