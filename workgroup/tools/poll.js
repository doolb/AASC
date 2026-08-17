'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createInterface } = require('node:readline');
const { paths, ensureDir, readJson, writeJson, readText, writeText, listDirs, listFiles, atomicClaim, isAlive, spawnClaude } = require('./wg-fs.js');
const { validateName, roleTemplate, parseHistory, updateHistory, buildSummary, buildPrompt, serializeRole } = require('./wg-core.js');

const ROOT = path.resolve(__dirname, '..'); // workgroup/ 根（tools/ 上一级）
const DEFAULT_POLL_MS = 5000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// depends 依赖全部已验收才可认领（多角色协调）。
// 遍历 task.depends：在 tasks/claimed/ 各角色子目录（<名>-<角色>/）的 json 里找
// id==depId 且 status==已验收；找不到再容错检查结果文件 results/<depId>.json 是否存在。
function depsMet(p, task) {
    const deps = Array.isArray(task.depends) ? task.depends : [];
    if (!deps.length) return true;
    for (const depId of deps) {
        // claimed/ 下每角色一个子目录，逐子目录扫 json
        let found = false;
        for (const agentDir of listDirs(p.claimedDir)) {
            const dir = path.join(p.claimedDir, agentDir);
            found = listFiles(dir, '.json').some((f) => {
                const t = readJson(path.join(dir, f));
                return t && t.id === depId && t.status === '已验收';
            });
            if (found) break;
        }
        // 容错：claimed 里可能没有，但 results 有
        if (!found && !fs.existsSync(p.resultFile(depId))) return false;
    }
    return true;
}

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
            let mine = primary ? pending.find((t) => t.role === primary && (!t.status || t.status === '') && depsMet(p, t)) : null;
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
                mine = pending.find((t) => secondary.includes(t.role) && (!t.status || t.status === '') && depsMet(p, t));
            }
            if (mine) {
                // 待修改任务已在 claimed/ 内（非 pending），无需再原子认领；新任务走 atomicClaim
                const ok = mine._fromRework ? true : (isEmpty ? atomicClaim(p, name, mine.id) : atomicClaim(p, `${name}-${primary}`, mine.id));
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

// 执行单个任务：busy 标记 → 任务状态进行中 → 注入总结/修改要求 → spawn claude → 更新 history → 状态已完成 → 回到空闲
async function executeTask({ p, root, role, name, activeRole, mine, command, buildArgs, secondary }) {
    const agentDir = name + (activeRole ? '-' + activeRole : '');
    writeText(p.roleBusyFile(name, activeRole || ''), '');
    writeText(p.roleCurrentTaskFile(name, activeRole || ''), mine.id);
    const taskFile = p.claimedTaskFile(agentDir, mine.id);
    const resultFile = p.resultFile(mine.id);
    // 落盘状态=进行中
    writeJson(taskFile, { ...mine, status: '进行中' });
    const summary = buildSummary(readText(p.roleHistoryFile(name, mine.role || '')));
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
    // history 按任务实际角色（mine.role）写入：副角色任务的历史落到 <名>-<副角色>/ 目录
    const newHistory = updateHistory(readText(p.roleHistoryFile(name, mine.role || '')), {
        tags, learnings,
        record: { id: mine.id, title: mine.title || '', summary: res.summary || '', tags, at: Date.now() }
    });
    writeText(p.roleHistoryFile(name, mine.role || ''), newHistory);

    // 完成后状态 = 已完成
    const cur = readJson(taskFile) || mine;
    writeJson(taskFile, { ...cur, status: '已完成' });

    fs.rmSync(p.roleBusyFile(name, activeRole || ''), { force: true });
    fs.rmSync(p.roleCurrentTaskFile(name, activeRole || ''), { force: true });
    console.log(`[workgroup] 任务 ${mine.id} 完成（${res.status}）`);
}

// 判断是否为 review 审查子任务（kind === 'review'）。
// 大改动验收打回时，main 投递的 role=review 审查子任务带 kind:'review' + reviewOf（被审查原任务 id），
// 完成 status=已完成 后与普通任务无法仅凭 status 区分。main 验收扫描 tasks/claimed/*/ 时先经 isReviewTask 区分：
// - review 审查子任务（kind='review'）：呈现 results/<id>.json 的 output 中 verdict 与被审查原任务 id（reviewOf），
//   据此判定 pass→原任务已验收 / fail→原任务继续打回，不当作普通待验收任务呈现给用户。
// - 普通任务（kind 缺失）：走正常验收流程（通过→已验收 / 提修改→按大小打回）。
function isReviewTask(task) {
    return task && task.kind === 'review';
}

// —— 交互向导 ——

function askText(rl, question) {
    return new Promise((resolve) => rl.question(question, resolve));
}

async function selectRole(rl, p) {
    const roles = listFiles(p.rolesDir, '.md').map((f) => f.replace(/\.md$/, ''));
    console.log('选择角色：');
    roles.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
    console.log('  n. 创新新角色');
    const ans = (await askText(rl, '> ')).trim();
    if (ans === 'n' || ans === 'N') {
        return createRole(rl, p);
    }
    const idx = parseInt(ans, 10) - 1;
    if (idx >= 0 && idx < roles.length) return roles[idx];
    console.error('[workgroup] 无效选择');
    return selectRole(rl, p);
}

async function createRole(rl, p) {
    const name = (await askText(rl, '新角色名: ')).trim();
    const err = validateName(name);
    if (err) {
        console.error(`[workgroup] ${err}`);
        return createRole(rl, p);
    }
    writeText(p.roleFile(name), roleTemplate(name));
    console.log(`[workgroup] 已创建 roles/${name}.md，稍后可编辑完善`);
    return name;
}

async function selectMember(rl, p) {
    const members = listDirs(p.membersDir);
    if (members.length) {
        console.log('选择成员（有则复用，无需重输）：');
        members.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
        console.log('  n. 新建成员');
        const ans = (await askText(rl, '> ')).trim();
        if (ans === 'n' || ans === 'N') return createMember(rl);
        const idx = parseInt(ans, 10) - 1;
        if (idx >= 0 && idx < members.length) return members[idx];
        console.error('[workgroup] 无效选择');
        return selectMember(rl, p);
    }
    return createMember(rl);
}

async function createMember(rl) {
    const name = (await askText(rl, '成员名: ')).trim();
    const err = validateName(name);
    if (err) {
        console.error(`[workgroup] ${err}`);
        return createMember(rl);
    }
    return name;
}

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

if (require.main === module) {
    main();
}

module.exports = { start, isReviewTask };
