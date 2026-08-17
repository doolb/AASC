'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createInterface } = require('node:readline');
const { paths, ensureDir, readJson, writeJson, readText, writeText, listDirs, listFiles, atomicClaim, isAlive, spawnClaude } = require('./wg-fs.js');
const { validateName, roleTemplate, parseHistory, updateHistory, buildSummary, buildPrompt } = require('./wg-core.js');

const ROOT = path.resolve(__dirname, '..'); // workgroup/ 根（tools/ 上一级）
const DEFAULT_POLL_MS = 5000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 启动子 agent：创建成员、lock、进入轮询循环
function start({ root = ROOT, role, name, command = 'claude', buildArgs, pollIntervalMs = DEFAULT_POLL_MS, onTaskDone }) {
    // 统一 trim：交互向导已 trim，--role/--name 参数路径也在此 trim，保证目录名干净
    role = String(role || '').trim();
    name = String(name || '').trim();
    const p = paths(root);
    const memberDir = p.memberDir(name);
    ensureDir(memberDir);
    writeText(p.memberRoleFile(name), role); // role.md 覆盖
    // history.md 存在则保留（重启历史不覆盖）

    // 崩溃残留检查：lock 内 PID 存活则拒绝启动
    const lockText = readText(p.lockFile(name));
    if (lockText) {
        const pid = parseInt(lockText.split(' ')[0], 10);
        if (isAlive(pid)) {
            console.error(`[workgroup] 已有同名 agent「${name}」在线（PID ${pid}），退出`);
            process.exit(1);
            return; // 防御：process.exit 被替换时不再继续
        }
        console.warn(`[workgroup] 覆盖残留 lock（PID ${pid} 已死）`);
    }
    writeText(p.lockFile(name), `${process.pid} ${Date.now()}`);

    // 崩溃残留清理：agent 崩溃可能留下 busy / current-task，main 会误判该成员永久忙碌。
    // 进程重新上线后清掉，回到空闲状态。
    fs.rmSync(p.busyFile(name), { force: true });
    fs.rmSync(p.currentTaskFile(name), { force: true });
    // 崩溃残留：任务可能停在 status=进行中（写完进行中、未写已完成即崩溃）。
    // 该状态不匹配 pending 扫描（要 status 空）也不匹配 rework 扫描（要 status=待修改），
    // 会静默不可见 → 重启后把 claimed/<name>/ 里 进行中 任务重置为 待修改，
    // 重新进入 rework 路径被原 agent 拾取重做。
    const crashDir = path.join(p.claimedDir, name);
    for (const f of listFiles(crashDir, '.json')) {
        const t = readJson(path.join(crashDir, f));
        if (t && t.status === '进行中') {
            writeJson(path.join(crashDir, f), { ...t, status: '待修改' });
            console.warn(`[workgroup] 崩溃残留：任务 ${t.id} 由「进行中」重置为「待修改」，等待重做`);
        }
    }

    // 正常退出/中断时删除 lock
    const cleanup = () => {
        fs.rmSync(p.lockFile(name), { force: true });
        process.exit(0);
    };
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);

    let running = true;
    const runLoop = async () => {
        while (running) {
            // 1) 新任务：pending 里 role 匹配且 status 空（空/缺失 = 未开始）
            const pending = listFiles(p.pendingDir, '.json')
                .map((f) => readJson(path.join(p.pendingDir, f)))
                .filter(Boolean);
            const mine = pending.find((t) => t.role === role && (!t.status || t.status === ''));
            if (mine) {
                const ok = atomicClaim(p, name, mine.id);
                if (ok) {
                    await executeTask({ p, root, role, name, mine, command, buildArgs });
                    if (onTaskDone) await onTaskDone();
                }
            } else {
                // 2) 待修改：自己 claimed/<name>/ 里 status=待修改 且 role 匹配（验收打回小改动，原 agent 重做）
                const mineDir = path.join(p.claimedDir, name);
                const rework = listFiles(mineDir, '.json')
                    .map((f) => readJson(path.join(mineDir, f)))
                    .find((t) => t && t.status === '待修改' && t.role === role);
                if (rework) {
                    await executeTask({ p, root, role, name, mine: rework, command, buildArgs });
                    if (onTaskDone) await onTaskDone();
                }
            }
            await sleep(pollIntervalMs);
        }
    };
    const loopPromise = runLoop();
    return { stop: () => { running = false; }, done: loopPromise };
}

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
    if (roleArg && nameArg) {
        // 方式一：带参数启动
        console.log(`[workgroup] 启动 ${roleArg} / ${nameArg}`);
        start({ root: ROOT, role: roleArg, name: nameArg });
        return;
    }
    // 方式二：交互向导
    const p = paths(ROOT);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const role = await selectRole(rl, p);
    const name = await selectMember(rl, p);
    rl.close();
    console.log(`[workgroup] 启动 ${role} / ${name}`);
    start({ root: ROOT, role, name });
}

if (require.main === module) {
    main();
}

module.exports = { start };
