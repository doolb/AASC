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
        root, role: 'frontend', name: 'alice',
        command: process.execPath,
        buildArgs: () => ['-e', fakeScript],
        pollIntervalMs: 50
    });

    await waitFor(() => fs.existsSync(resultFile), 5000);
    await waitFor(() => !fs.existsSync(p.busyFile('alice')), 5000);
    app.stop();

    // 断言全链路
    assert.ok(fs.existsSync(p.lockFile('alice')), 'lock 应存在');
    assert.strictEqual(readText(p.memberRoleFile('alice')), 'frontend', 'role.md 应记录角色');
    assert.ok(fs.existsSync(p.claimedTaskFile('alice', 't1')), '任务应移动到 claimed/alice/');
    assert.ok(fs.existsSync(resultFile), '结果文件应存在');
    const history = readText(p.historyFile('alice'));
    assert.ok(history.includes('UI'), 'history 应含专长标签');
    assert.ok(history.includes('约定A'), 'history 应含经验约定');
    assert.ok(!fs.existsSync(p.busyFile('alice')), '忙碌标记应已删除');
    assert.ok(!fs.existsSync(p.currentTaskFile('alice')), 'current-task 应已删除');
});

test('端到端：role 不匹配的任务不被认领', async () => {
    const root = tmpRoot();
    const p = paths(root);
    for (const dir of [p.rolesDir, p.membersDir, p.pendingDir, p.claimedDir, p.resultsDir]) ensureDir(dir);
    writeText(p.roleFile('backend'), '# 后端');
    writeJson(p.taskFile('t2'), { id: 't2', title: '后端任务', role: 'backend', requirement: '做后端', priority: 'high', createdAt: 1, references: [] });

    const { start } = require('../tools/poll.js');
    const app = start({ root, role: 'frontend', name: 'bob', pollIntervalMs: 50 });
    await new Promise((r) => setTimeout(r, 250));
    app.stop();

    assert.ok(fs.existsSync(p.taskFile('t2')), '不匹配任务应留在 pending');
    assert.ok(!fs.existsSync(p.claimedTaskFile('bob', 't2')), '不应被认领');
});

test('端到端：已有在线 lock（同 PID）启动应拒绝', async () => {
    const root = tmpRoot();
    const p = paths(root);
    ensureDir(p.memberDir('alice'));
    writeText(p.lockFile('alice'), `${process.pid} 1`); // 当前进程假在线

    const { start } = require('../tools/poll.js');
    let exited = false;
    const oldExit = process.exit;
    process.exit = () => { exited = true; }; // 拦截 exit(1)
    start({ root, role: 'frontend', name: 'alice' });
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
        root, role: 'frontend', name: 'alice',
        command: process.execPath,
        buildArgs: () => ['-e', '/* no-op: 不写结果文件 */'],
        pollIntervalMs: 50
    });

    await waitFor(() => fs.existsSync(resultFile), 5000);
    await waitFor(() => !fs.existsSync(p.busyFile('alice')), 5000);
    app.stop();

    // 断言：结果文件存在且 status=failed，history 不崩，busy 已清
    const res = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    assert.strictEqual(res.status, 'failed', '结果文件应由 poll.js 补写 failed');
    assert.strictEqual(res.summary, '子 agent 未返回有效结果');
    const history = readText(p.historyFile('alice'));
    assert.ok(history.includes('最近记录'), 'history 最近记录段应存在');
    assert.ok(history.includes('"id":"t3"'), 'history 最近记录应含任务 id');
    assert.ok(!fs.existsSync(p.busyFile('alice')), '忙碌标记应已删除');
    assert.ok(!fs.existsSync(p.currentTaskFile('alice')), 'current-task 应已删除');
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
