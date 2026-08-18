'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createInterface } = require('node:readline');
const { spawn } = require('node:child_process');
const { paths, ensureDir, readJson, writeJson, readText, writeText, listDirs, listFiles, atomicClaim, isAlive, spawnClaude, MAIN_SYSTEM_PROMPT } = require('./wg-fs.js');
const { validateName, roleTemplate, parseHistory, updateHistory, buildSummary, buildPrompt, serializeRole } = require('./wg-core.js');

const ROOT = path.resolve(__dirname, '..'); // workgroup/ 根（tools/ 上一级）
const DEFAULT_POLL_MS = 5000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// main claude TUI 的默认启动参数：交互模式 + 注入 main 指令 + bypassPermissions 全自动
// （main 在 TUI 里读成员/写任务/验收改状态不被权限提示打断，同子 agent 策略）。
// 独立函数便于测试断言默认参数。
function defaultMainArgs() {
    return ['--append-system-prompt', MAIN_SYSTEM_PROMPT, '--permission-mode', 'bypassPermissions'];
}

// depends 依赖全部已验收才可认领（多角色协调）。
// 遍历 task.depends：在 tasks/claimed/ 各角色子目录（<名>-<角色>/）的 json 里找
// id==depId 且 status==已验收；只认已验收，results 存在但未验收不算满足（避免绕过验收门控）。
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
        // 只认 claimed/ 里 status=已验收 的依赖；results 文件存在但未验收不算满足
        if (!found) return false;
    }
    return true;
}

// 某角色是否有在线 agent：members/<名>-<角色>/lock 存在且 PID 存活。
// 只统计成员目录（<名>-<角色>），排除 main 协调者目录（main 不是任务执行 agent）。
// 空闲自动切换用它防撞车：该角色已有在线 agent（lock 未清且 PID 活着）时，不把主角色切过去。
function roleHasOnlineAgent(p, role) {
    const suffix = '-' + role;
    for (const dir of listDirs(p.membersDir)) {
        if (dir === 'main') continue;          // main 是协调者，非任务执行 agent
        if (!dir.endsWith(suffix)) continue;   // 只看该角色的成员目录
        const lockText = readText(path.join(p.membersDir, dir, 'lock'));
        if (lockText) {
            const pid = parseInt(lockText.split(' ')[0], 10);
            if (isAlive(pid)) return true;
        }
    }
    return false;
}

// 启动子 agent（或 main/空角色）：创建成员、lock、进入轮询循环
function start({ root = ROOT, primary = '', secondary = [], name, mode = 'agent', command = 'claude', buildArgs, pollIntervalMs = DEFAULT_POLL_MS, onTaskDone, mainCommand, mainArgs }) {
    primary = String(primary || '').trim();
    name = String(name || '').trim();
    const p = paths(root);

    // main 协调者模式：spawn claude TUI（stdio inherit 透传 TTY），注入 main 指令。
    // claude 退出（/exit 或 Ctrl+C）→ 删 main lock → poll.js 进程退出（整个 main 会话结束）。
    // mainCommand/mainArgs 可注入假命令供测试（默认 claude --append-system-prompt <MAIN_SYSTEM_PROMPT>）。
    if (mode === 'main') {
        ensureDir(path.join(p.membersDir, 'main'));
        writeText(p.mainLockFile, `${process.pid} ${Date.now()}`);
        const cleanup = () => { fs.rmSync(p.mainLockFile, { force: true }); process.exit(0); };
        process.once('SIGINT', cleanup);
        process.once('SIGTERM', cleanup);
        const cmd = mainCommand || 'claude';
        const args = mainArgs || defaultMainArgs();
        // cwd = 项目根（workgroup/ 上一级），main claude 既能读项目代码拆需求、又能用 workgroup/ 相对路径投递验收
        const projectRoot = path.resolve(root, '..');
        const child = spawn(cmd, args, { stdio: 'inherit', cwd: projectRoot });
        console.log(`[workgroup] 启动 main 协调者 TUI（PID ${process.pid}，spawn ${cmd}）`);
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

    // 正常退出/中断时删除 lock：用可变 primary（切换后追踪当前角色），
    // 避免捕获启动时 activeRole 导致切换后只删旧 lock、留新角色死 PID lock。
    const cleanup = () => {
        fs.rmSync(p.roleLockFile(name, primary || ''), { force: true });
        process.exit(0);
    };
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);

    let running = true;
    const runLoop = async () => {
        while (running) {
            const pending = listFiles(p.pendingDir, '.json')
                .map((f) => readJson(path.join(p.pendingDir, f)))
                .filter(Boolean);
            // ② 指派：pending 里 assignedTo == name（main 指派给空角色或非空角色）
            let mine = pending.find((t) => t.assignedTo === name && (!t.status || t.status === '') && depsMet(p, t));
            if (mine) {
                // 任务 role 与主角色不符 → 切换主角色到任务 role
                if (mine.role !== primary) {
                    console.log(`[workgroup] main 指派：主角色 ${primary || '空'} → ${mine.role}`);
                    // 删旧 lock（空角色 primary='' 也删 members/<名>/lock，避免同 PID 死 lock 残留）
                    fs.rmSync(p.roleLockFile(name, primary || ''), { force: true });
                    primary = mine.role;
                    ensureDir(p.roleDir(name, primary));
                    writeText(p.roleMemberRoleFile(name, primary), serializeRole({ primary, secondary }));
                    writeText(p.roleLockFile(name, primary), `${process.pid} ${Date.now()}`);
                }
            } else if (primary) {
                // ① 主角色新任务（仅非空角色）
                mine = pending.find((t) => t.role === primary && (!t.status || t.status === '') && depsMet(p, t));
            }
            if (!mine) {
                // ③ 待修改：自己 claimed/ 里 status=待修改 且 role 匹配
                // 空角色也需重做自己认领过、被打回的任务：空角色切主角色后 primary 非空，
                // claimed/<名>-<角色>/ 里的待修改任务应被扫描；未切换前 primary='' 目录无任务，安全跳过。
                const mineDir = path.join(p.claimedDir, `${name}-${primary}`);
                const rework = listFiles(mineDir, '.json')
                    .map((f) => readJson(path.join(mineDir, f)))
                    .find((t) => t && t.status === '待修改' && (t.role === primary || secondary.includes(t.role)));
                if (rework) mine = { ...rework, _fromRework: true };
            }
            if (!mine && !isEmpty) {
                // ④ 副角色：pending 里 secondary 匹配
                mine = pending.find((t) => secondary.includes(t.role) && (!t.status || t.status === '') && depsMet(p, t));
            }
            if (mine) {
                // 待修改任务已在 claimed/ 内（非 pending），无需再原子认领；新任务走 atomicClaim。
                // 认领目标目录始终用当前 primary：指派/空闲切换已把 primary 切到任务 role，
                // 空角色切换后也走 <名>-<角色>，避免残留 claimed/<名>/ 无角色副本。
                const ok = mine._fromRework ? true : atomicClaim(p, `${name}-${primary}`, mine.id);
                if (ok) {
                    await executeTask({ p, root, role: mine.role, name, activeRole: primary, mine, command, buildArgs, secondary });
                    if (onTaskDone) await onTaskDone();
                }
            }
            if (!mine && !isEmpty) {
                // ⑤ 空闲自动切换：主/副/待修改/指派都无活 → 探测 pending 有积压角色且无在线 agent → 切主角色
                const target = pending.find((t) =>
                    (!t.status || t.status === '') &&
                    t.role !== primary && !secondary.includes(t.role) &&
                    !roleHasOnlineAgent(p, t.role)
                );
                if (target) {
                    console.log(`[workgroup] 空闲自动切换：主角色 ${primary || '空'} → ${target.role}`);
                    // 切换：删旧 lock（空角色 primary='' 也删 members/<名>/lock）、写新 lock + role.md
                    fs.rmSync(p.roleLockFile(name, primary || ''), { force: true });
                    primary = target.role;
                    ensureDir(p.roleDir(name, primary));
                    writeText(p.roleMemberRoleFile(name, primary), serializeRole({ primary, secondary }));
                    writeText(p.roleLockFile(name, primary), `${process.pid} ${Date.now()}`);
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
    // 剥掉 _fromRework 内部标记（仅 runLoop 内部用，不残留进任务文件）
    const { _fromRework, ...clean } = mine;
    // 落盘状态=进行中
    writeJson(taskFile, { ...clean, status: '进行中' });
    const summary = buildSummary(readText(p.roleHistoryFile(name, mine.role || '')));
    const prompt = buildPrompt({ role: mine.role, name: agentDir, summary, taskFile, resultFile, reviewComment: mine.reviewComment });
    const args = buildArgs ? buildArgs(prompt, taskFile, resultFile) : ['--print', '--permission-mode', 'bypassPermissions', prompt];
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
        const cur = readJson(taskFile) || clean;
        writeJson(taskFile, { ...cur, status: '已取消' });
        fs.rmSync(p.roleBusyFile(name, activeRole || ''), { force: true });
        fs.rmSync(p.roleCurrentTaskFile(name, activeRole || ''), { force: true });
        console.log(`[workgroup] 任务 ${mine.id} 已取消`);
        return;
    }

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
    const cur = readJson(taskFile) || clean;
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

module.exports = { start, isReviewTask, defaultMainArgs };
