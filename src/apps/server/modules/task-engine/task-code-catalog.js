'use strict';

// .src/framework/task-code-sync.md：启动时验证固定快照，统一代码读取、入口解析和只读约束。
const fs = require('node:fs');
const path = require('node:path');
const contract = require('../aasc/task-code-contract');

class TaskCodeCatalog {
    constructor(context, options = {}) {
        this.context = Object.freeze({ ...context });
        const projectRoot = path.resolve(options.projectRoot || process.env.AASC_PROJECT_ROOT || process.cwd());
        this.root = path.join(projectRoot, 'updates/task-code', `task-code-v${context.version}`);
        if (!contract.positive(context.version) || context.path !== this.root || !/^[a-f0-9]{64}$/.test(context.sha256)) {
            throw new Error('任务代码启动快照身份/路径无效');
        }
        const readJson = name => JSON.parse(this.readRegular(name, 1024 * 1024).toString('utf8'));
        const marker = readJson('.offline-update-verified.json');
        if (marker.kind !== 'taskCode' || marker.version !== context.version || marker.sha256 !== context.sha256) {
            throw new Error('任务代码安装身份不匹配');
        }
        this.manifest = contract.validateManifest(readJson('task-code-manifest.json'));
        if (this.manifest.version !== context.version) throw new Error('任务代码版本与启动快照不匹配');
        contract.assertCombination(this.manifest,
            { version: context.codeVersion, taskCodeApiVersion: contract.API_VERSION,
                requiredDependencyVersion: context.dependencyVersion, requiredLockSha256: context.lockSha256 },
            { version: context.dependencyVersion, lockSha256: context.lockSha256 },
            Number(options.apkVersionCode || process.env.AASC_APK_VERSION_CODE || 0));
        this.tasks = new Map(this.manifest.tasks.map(task => [task.taskName, task]));
        this.retired = new Set(this.manifest.retiredTaskNames);
        this.foldedNames = new Map([...this.tasks.keys(), ...this.retired].map(name => [name.toLowerCase(), name]));
        const allowed = new Set(['task-code-manifest.json', '.offline-update-verified.json']);
        for (const task of this.tasks.values()) {
            for (const file of task.files) {
                const relative = `tasks/${task.taskName}/${file.path}`;
                allowed.add(relative);
                const bytes = this.readRegular(relative, contract.MAX_FILE_BYTES);
                if (bytes.length !== file.size || contract.hash(bytes) !== file.sha256) throw new Error(`任务代码校验失败: ${relative}`);
            }
        }
        const visit = (directory, prefix = '') => {
            for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                const relative = prefix + entry.name;
                if (entry.isFile() && allowed.has(relative)) continue;
                if (entry.isDirectory() && [...allowed].some(name => name.startsWith(relative + '/'))) {
                    visit(path.join(directory, entry.name), relative + '/'); continue;
                }
                throw new Error(`任务代码目录包含额外文件、链接或特殊文件: ${relative}`);
            }
        };
        visit(this.root);
    }
    readRegular(relative, maximum) {
        let current = this.root;
        // 从项目根下的updates起逐级检查，不能通过父目录链接绕出版本目录。
        const parent = path.dirname(path.dirname(this.root));
        for (const part of ['.', 'task-code', path.basename(this.root), ...relative.split('/')]) {
            current = part === '.' ? parent : path.join(current, part);
            const stat = fs.lstatSync(current);
            if (stat.isSymbolicLink() || !(stat.isDirectory() || stat.isFile())) throw new Error('任务代码路径包含链接或特殊文件');
        }
        const stat = fs.lstatSync(current);
        if (!stat.isFile() || stat.size > maximum) throw new Error('任务代码文件类型/大小无效');
        return fs.readFileSync(current);
    }
    isManaged(name) { return typeof name === 'string' && this.foldedNames.has(name.toLowerCase()); }
    task(name) {
        const task = this.tasks.get(name);
        if (!task) throw new Error(`受管任务已退役或名称不匹配: ${name}`);
        return task;
    }
    resolve(name, file) {
        const task = this.task(name);
        if (!task.files.some(entry => entry.path === file)) throw new Error(`受管任务文件不存在: ${name}/${file}`);
        return path.join(this.root, 'tasks', name, file);
    }
    files(name, entryFile) {
        return this.task(name).files.filter(file => !entryFile || file.path === entryFile).map(file => {
            const bytes = this.readRegular(`tasks/${name}/${file.path}`, contract.MAX_FILE_BYTES);
            if (bytes.length !== file.size || contract.hash(bytes) !== file.sha256) throw new Error('受管任务代码已损坏');
            return { name: file.path, data: bytes.toString('base64') };
        });
    }
    assertWritable(name, files = null) {
        if (!this.isManaged(name)) return;
        if (files === null || this.retired.has(name)) throw new Error('官方任务代码只读；自定义请使用不同任务名');
        const codeFiles = this.task(name).files.map(file => file.path);
        for (const item of files) {
            const file = typeof item === 'string' ? item : item.name;
            if (typeof file !== 'string' || file.split('/').some(part => !part || part === '.' || part === '..') ||
                file.includes('\\') || contract.isCodePath(file) || codeFiles.some(code => code.startsWith(file + '/'))) {
                throw new Error('官方任务代码只读；自定义请使用不同任务名');
            }
        }
    }
    status() { return { version: this.context.version, sha256: this.context.sha256, path: this.root,
        bundleSha256: this.manifest.bundleSha256, verified: true, taskCodeApiVersion: contract.API_VERSION,
        codeVersion: this.context.codeVersion, dependencyVersion: this.context.dependencyVersion, lockSha256: this.context.lockSha256 }; }
    middleware() {
        return (req, res, next) => {
            try {
                const parts = decodeURIComponent(req.path).replace(/^\//, '').split('/');
                const name = parts.shift();
                if (!this.isManaged(name)) return next();
                const file = parts.join('/');
                // 数据查询保持原路径职责；所有代码请求和退役任务禁止回退到旧种子。
                const dataPath = ['results', 'logs', 'inputs', 'outputs'].includes(parts[0]) || file === 'config.json';
                if (dataPath && !contract.isCodePath(file) && !this.retired.has(name)) return next();
                const target = this.resolve(name, file);
                this.files(name, file);
                res.set('Cache-Control', 'no-store');
                return res.sendFile(target);
            } catch (error) { return res.status(404).end(); }
        };
    }
}
let catalog;
function getTaskCodeCatalog() {
    if (catalog !== undefined) return catalog;
    catalog = process.env.AASC_TASK_CODE_CONTEXT ? new TaskCodeCatalog(JSON.parse(process.env.AASC_TASK_CODE_CONTEXT)) : null;
    return catalog;
}
module.exports = { TaskCodeCatalog, getTaskCodeCatalog };
