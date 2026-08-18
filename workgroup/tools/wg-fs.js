'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

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
        resultFile: (id) => path.join(root, 'results', `${id}.json`),
        // 旧签名保留向后兼容（Task 2 重构 poll.js 后迁移新 role* 函数）
        memberDir: (name) => path.join(root, 'members', name),
        historyFile: (name) => path.join(root, 'members', name, 'history.md'),
        lockFile: (name) => path.join(root, 'members', name, 'lock'),
        busyFile: (name) => path.join(root, 'members', name, 'busy'),
        currentTaskFile: (name) => path.join(root, 'members', name, 'current-task'),
        memberRoleFile: (name) => path.join(root, 'members', name, 'role.md')
    };
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

// 读 JSON，失败返回 null（文件缺失或非法）
function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
        return null;
    }
}

function writeJson(file, obj) {
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

// 读文本，不存在返回空串
function readText(file) {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch (_) {
        return '';
    }
}

function writeText(file, text) {
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, text);
}

// 列出子目录名
function listDirs(dir) {
    try {
        return fs.readdirSync(dir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);
    } catch (_) {
        return [];
    }
}

// 列出文件（可带扩展名过滤）
function listFiles(dir, ext) {
    try {
        return fs.readdirSync(dir, { withFileTypes: true })
            .filter((d) => d.isFile() && (ext ? d.name.endsWith(ext) : true))
            .map((d) => d.name);
    } catch (_) {
        return [];
    }
}

// 原子认领：pending → claimed/<agent>/；成功 true，被抢/缺失 false
function atomicClaim(p, agentName, taskId) {
    const toDir = path.join(p.claimedDir, agentName);
    ensureDir(toDir);
    try {
        fs.renameSync(p.taskFile(taskId), path.join(toDir, `${taskId}.json`));
        return true;
    } catch (_) {
        return false;
    }
}

// 进程存活检测（PID 无效或已死返回 false）
function isAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return err.code === 'EPERM';
    }
}

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

// main 协调者指令：注入 spawn 的 main claude TUI，让它知道自己扮演 main
// 职责：读 roles/main.md、按 L4-L7 等级路由拆任务、投递到 tasks/pending/、验收时扫描已验收/打回
const MAIN_SYSTEM_PROMPT = `你是 workgroup 的 main 协调者。

【硬规则】你只做协调，绝不亲自实现或查找。所有改动/开发/验证/查找问题（查代码、查文档、搜索等）必须拆解成任务下发给子 agent，由子 agent 完成。你不写代码、不改文件、不运行验证、不亲自查代码/文档——发现需要动手或查找的事，就投递任务让合适的子 agent 干。唯一例外：闲聊（问候、寒暄、解释概念等不涉及项目实际操作）可以直接回复。

你的职责：
1. 读 workgroup/roles/main.md 了解 main 角色职责。
2. 用户提需求 → 用 analyze-requirement-level 定级（L4-L7）→ 拆解成多角色任务，带 depends 依赖链。
3. 投递任务到 workgroup/tasks/pending/<id>.json（status 空，role/requirement/depends/assignedTo 按需）。
4. 定期扫描 workgroup/tasks/claimed/*/ 找 status='已完成' 的任务，读 workgroup/results/<id>.json 呈现给用户验收（通过→status=已验收 / 提修改→小改动写 reviewComment+待修改、大改动投 role=review 任务）。
5. 空角色/离线成员可指派：任务带 assignedTo=<成员名>，agent 自动切换主角色认领。
6. 需要自测/验证的工作，投给 tester 角色；需要审查的，投给 review 角色。

任务文件规范见 workgroup/docs/design.md「任务文件格式」。`;

module.exports = { paths, ensureDir, readJson, writeJson, readText, writeText, listDirs, listFiles, atomicClaim, isAlive, spawnClaude, MAIN_SYSTEM_PROMPT };
