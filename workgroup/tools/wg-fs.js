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
        // 角色目录：members/<名>-<角色>/；空 role（空角色）→ members/<名>/（无尾横线）
        // 空 role 若带尾横线（members/<名>-/），main 扫目录会误以为成员名含横线、assignedTo 填错、空角色永不认领。
        roleDir: (name, role) => path.join(root, 'members', role ? `${name}-${role}` : name),
        roleLockFile: (name, role) => path.join(root, 'members', role ? `${name}-${role}` : name, 'lock'),
        roleBusyFile: (name, role) => path.join(root, 'members', role ? `${name}-${role}` : name, 'busy'),
        roleHistoryFile: (name, role) => path.join(root, 'members', role ? `${name}-${role}` : name, 'history.md'),
        roleMemberRoleFile: (name, role) => path.join(root, 'members', role ? `${name}-${role}` : name, 'role.md'),
        roleCurrentTaskFile: (name, role) => path.join(root, 'members', role ? `${name}-${role}` : name, 'current-task'),
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

【硬规则】除闲聊外所有事都下发给子 agent，绝不亲自处理。main 保持最小上下文：不读代码/文档、不跑命令、不加载分析 skill（如 analyze-requirement-level）、不亲自探查成员状态或文件系统。包括但不限于：需求分析/定级、实现、验证、查找问题、探查状态——一律拆解成任务投递给子 agent 干。唯一例外：闲聊（问候、寒暄、解释概念等不涉及项目实际操作）可以直接回复。

你的职责（仅编排，不做事）：
1. 用户提需求 → 拆解成多角色任务，带 depends 依赖链。需求定级分析在任务里要求子 agent 完成（角色可投对应领域或 main 指派）。
2. 投递任务到 workgroup/tasks/pending/<id>.json（status 空，role/requirement/depends/assignedTo 按需）。
3. 待验收由 poll.js 扫描：poll.js 每 3 分钟扫 claimed 发现 status='已完成' 任务时，会在终端打印【main】发现待验收任务提示。你不主动轮询文件系统；看到终端提示或用户要求时，读 workgroup/results/<id>.json 呈现给用户验收（通过→status=已验收 / 提修改→小改动写 reviewComment+待修改、大改动投 role=review 任务）。
4. 空角色/离线成员可指派：任务带 assignedTo=<成员名>，agent 自动切换主角色认领。
5. 需要自测/验证 → tester 角色；审查 → review 角色；查找/分析 → 对应领域角色。

任务文件规范见 workgroup/docs/design.md「任务文件格式」。`;

module.exports = { paths, ensureDir, readJson, writeJson, readText, writeText, listDirs, listFiles, atomicClaim, isAlive, spawnClaude, MAIN_SYSTEM_PROMPT };
