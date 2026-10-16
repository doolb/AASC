'use strict';

const fs = require('node:fs');
const path = require('node:path');
const files = require('./files');

/** 健康后精确扫描受管版本目录；拒绝链接与特殊文件，不触碰下载/模型/配置/任务结果。 */
async function removeTree(root, target) {
    files.safe(root, target);
    const stat = await fs.promises.lstat(target);
    if (!stat.isDirectory()) throw new Error('版本清理目标不是普通目录');
    async function inspect(directory) {
        for (const name of await fs.promises.readdir(directory)) {
            const child = files.safe(root, path.join(directory, name)); const stat = await fs.promises.lstat(child);
            if (stat.isDirectory()) await inspect(child);
            else if (!stat.isFile()) throw new Error('版本目录包含特殊文件');
        }
    }
    await inspect(target); await fs.promises.rm(target, { recursive: true });
}
async function cleanup(root) {
    const pointer = files.read(root, 'updates/active-release.json');
    if (pointer?.pendingHealth) return [];
    const launcher = files.read(root, 'updates/launcher-state.json', {});
    const code = new Set(); const dependencies = new Set(); const task = new Set();
    for (const release of [pointer, pointer?.previous]) if (release) {
        code.add(release.codeVersion); dependencies.add(release.dependencyVersion); task.add(release.taskCodeVersion);
    }
    for (const selected of [launcher.active, launcher.previous, launcher.pending]) if (selected) code.add(selected.version);
    const errors = [];
    for (const [directory, prefix, keep] of [['code', 'code-v', code], ['dependencies', 'dependencies-v', dependencies], ['task-code', 'task-code-v', task]]) {
        const parent = files.safe(root, path.join(root, 'updates', directory));
        if (!fs.existsSync(parent)) continue;
        for (const name of await fs.promises.readdir(parent)) {
            const match = new RegExp(`^${prefix}([1-9][0-9]*)$`).exec(name);
            if (!match || !Number.isSafeInteger(Number(match[1])) || keep.has(Number(match[1]))) continue;
            try { await removeTree(root, path.join(parent, name)); }
            catch (error) { errors.push(`${directory}/${name}: ${error.message}`); }
        }
    }
    return errors;
}
module.exports = { cleanup, removeTree };
