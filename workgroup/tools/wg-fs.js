'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

// 返回工作区各关键路径
function paths(root) {
    return {
        rolesDir: path.join(root, 'roles'),
        membersDir: path.join(root, 'members'),
        pendingDir: path.join(root, 'tasks', 'pending'),
        claimedDir: path.join(root, 'tasks', 'claimed'),
        resultsDir: path.join(root, 'results'),
        memberDir: (name) => path.join(root, 'members', name),
        roleFile: (name) => path.join(root, 'roles', `${name}.md`),
        taskFile: (id) => path.join(root, 'tasks', 'pending', `${id}.json`),
        claimedTaskFile: (agent, id) => path.join(root, 'tasks', 'claimed', agent, `${id}.json`),
        resultFile: (id) => path.join(root, 'results', `${id}.json`),
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

// 执行子 agent（默认 claude --print），等待结束并检查结果文件是否写入
function spawnClaude({ command, args, cwd, resultFile }) {
    return new Promise((resolve) => {
        const child = spawn(command, args, { cwd });
        child.on('close', (code) => {
            resolve({ code, resultWritten: fs.existsSync(resultFile) });
        });
        child.on('error', (err) => {
            resolve({ code: -1, error: err.message, resultWritten: false });
        });
    });
}

module.exports = { paths, ensureDir, readJson, writeJson, readText, writeText, listDirs, listFiles, atomicClaim, isAlive, spawnClaude };
