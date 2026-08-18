'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { paths, ensureDir, readJson, writeJson, readText, writeText, listDirs, listFiles, atomicClaim, isAlive, spawnClaude } = require('../tools/wg-fs.js');

function tmpRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'wg-test-'));
}

test('paths 返回各目录绝对路径', () => {
    const p = paths('/wg');
    assert.strictEqual(p.rolesDir, path.join('/wg', 'roles'));
    assert.strictEqual(p.pendingDir, path.join('/wg', 'tasks', 'pending'));
    assert.strictEqual(p.memberDir('alice'), path.join('/wg', 'members', 'alice'));
    assert.strictEqual(p.claimedTaskFile('alice', 't1'), path.join('/wg', 'tasks', 'claimed', 'alice', 't1.json'));
});

test('ensureDir 幂等创建', () => {
    const root = tmpRoot();
    const p = paths(root);
    ensureDir(p.memberDir('alice'));
    assert.ok(fs.existsSync(p.memberDir('alice')));
    ensureDir(p.memberDir('alice')); // 不抛错
});

test('readJson/writeJson 往返与缺失返回 null', () => {
    const root = tmpRoot();
    const f = path.join(root, 'a.json');
    writeJson(f, { x: 1 });
    assert.deepStrictEqual(readJson(f), { x: 1 });
    assert.strictEqual(readJson(path.join(root, 'nope.json')), null);
});

test('readText 不存在返回空串', () => {
    const root = tmpRoot();
    assert.strictEqual(readText(path.join(root, 'nope.txt')), '');
});

test('listDirs/listFiles 过滤', () => {
    const root = tmpRoot();
    const p = paths(root);
    ensureDir(p.memberDir('alice'));
    ensureDir(p.memberDir('bob'));
    writeText(p.roleFile('frontend'), 'x');
    writeText(path.join(p.rolesDir, 'readme.txt'), 'y');
    assert.deepStrictEqual(listDirs(p.membersDir), ['alice', 'bob']);
    assert.deepStrictEqual(listFiles(p.rolesDir, '.md'), ['frontend.md']);
});

test('atomicClaim 原子抢到返回 true，任务不存在返回 false', () => {
    const root = tmpRoot();
    const p = paths(root);
    ensureDir(p.pendingDir);
    ensureDir(p.claimedDir);
    writeJson(p.taskFile('t1'), { id: 't1' });
    assert.strictEqual(atomicClaim(p, 'alice', 't1'), true);
    assert.ok(fs.existsSync(p.claimedTaskFile('alice', 't1')));
    assert.ok(!fs.existsSync(p.taskFile('t1')));
    assert.strictEqual(atomicClaim(p, 'bob', 't1'), false); // 已被抢走
});

test('isAlive 判断进程存活', () => {
    assert.strictEqual(isAlive(process.pid), true);
    assert.strictEqual(isAlive(99999999), false);
});

test('spawnClaude 执行后返回 code 与 resultWritten', async () => {
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
    assert.strictEqual(res.code, 0);
    assert.strictEqual(res.resultWritten, true);
});

test('paths 提供角色目录与取消目录', () => {
    const p = paths('/wg');
    assert.strictEqual(p.cancelDir, path.join('/wg', 'tasks', 'cancel'));
    assert.strictEqual(p.roleDir('alice', 'frontend'), path.join('/wg', 'members', 'alice-frontend'));
    assert.strictEqual(p.roleLockFile('alice', 'frontend'), path.join('/wg', 'members', 'alice-frontend', 'lock'));
    assert.strictEqual(p.roleHistoryFile('alice', 'frontend'), path.join('/wg', 'members', 'alice-frontend', 'history.md'));
    assert.strictEqual(p.mainLockFile, path.join('/wg', 'members', 'main', 'lock'));
    // 空角色（role 空串）：目录应无尾横线 members/<name>/，与 roleDir 一致。
    // 否则空角色 lock 落在 members/<name>-/，main 误以为成员名带横线、assignedTo 填错、任务永不认领。
    assert.strictEqual(p.roleDir('bob', ''), path.join('/wg', 'members', 'bob'));
    assert.strictEqual(p.roleLockFile('bob', ''), path.join('/wg', 'members', 'bob', 'lock'));
    assert.strictEqual(p.roleBusyFile('bob', ''), path.join('/wg', 'members', 'bob', 'busy'));
    assert.strictEqual(p.roleHistoryFile('bob', ''), path.join('/wg', 'members', 'bob', 'history.md'));
    assert.strictEqual(p.roleMemberRoleFile('bob', ''), path.join('/wg', 'members', 'bob', 'role.md'));
    assert.strictEqual(p.roleCurrentTaskFile('bob', ''), path.join('/wg', 'members', 'bob', 'current-task'));
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

test('MAIN_SYSTEM_PROMPT 提供 main 协调者指令', () => {
    const { MAIN_SYSTEM_PROMPT } = require('../tools/wg-fs.js');
    assert.ok(MAIN_SYSTEM_PROMPT.includes('main'), '应包含 main 角色');
    assert.ok(MAIN_SYSTEM_PROMPT.includes('tasks/pending'), '应提示投递任务');
    assert.ok(MAIN_SYSTEM_PROMPT.includes('绝不亲自处理'), '应声明 main 不亲自做事');
    assert.ok(MAIN_SYSTEM_PROMPT.includes('保持最小上下文'), '应声明 main 保持最小上下文');
    assert.ok(MAIN_SYSTEM_PROMPT.includes('analyze-requirement-level'), '应声明需求分析也下发给子 agent');
    assert.ok(MAIN_SYSTEM_PROMPT.includes('查找问题'), '应声明查找问题也下发给子 agent');
    assert.ok(MAIN_SYSTEM_PROMPT.includes('闲聊'), '应声明闲聊例外可直接回复');
    assert.ok(MAIN_SYSTEM_PROMPT.includes('主动轮询'), '应声明 main 主动轮询任务');
    assert.ok(MAIN_SYSTEM_PROMPT.includes('不打扰用户'), '应声明无进展不打扰用户');
});
