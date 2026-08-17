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
