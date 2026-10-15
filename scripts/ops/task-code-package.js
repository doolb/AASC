'use strict';

// .src/framework/task-code-sync.md：只从固定源码根读取显式选择的代码，输出独立 ZIP 暂存树。
const fs = require('node:fs');
const path = require('node:path');
const contract = require('../../src/apps/server/modules/aasc/task-code-contract');

async function regularPath(root, relative, directory = false) {
    const segments = relative.split('/'); let current = root;
    const rootStat = await fs.promises.lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('任务源码根必须是普通目录');
    for (let index = 0; index < segments.length; index++) {
        current = path.join(current, segments[index]);
        const stat = await fs.promises.lstat(current);
        const isDirectory = index < segments.length - 1 || directory;
        if (stat.isSymbolicLink() || (isDirectory ? !stat.isDirectory() : !stat.isFile())) throw new Error(`任务路径不是普通文件/目录: ${relative}`);
    }
    return current;
}

async function stageTaskCode(projectRoot, stagingRoot, version, options = {}) {
    if (!contract.positive(version)) throw new Error('taskCodeVersion 必须为正整数');
    const selection = options.selection || JSON.parse(await fs.promises.readFile(path.join(projectRoot, 'release/task-code-files.json'), 'utf8'));
    if (selection.schemaVersion !== 1 || !Array.isArray(selection.tasks)) throw new Error('任务选择清单格式无效');
    const sourceRoot = path.join(projectRoot, 'res/tasks');
    if ((await fs.promises.lstat(path.join(projectRoot, 'res'))).isSymbolicLink()) throw new Error('任务源码父目录不能是链接');
    const manifest = { format: 'aasc-task-code', schemaVersion: 1, version,
        ...contract.aggregateRequirements(selection.tasks), requiredApkVersionCode: selection.requiredApkVersionCode,
        tasks: [], retiredTaskNames: [...(selection.retiredTaskNames || [])].sort() };
    await fs.promises.mkdir(stagingRoot, { recursive: true });
    let total = 0; let count = 0;
    for (const selected of [...selection.tasks].sort((a, b) => String(a.taskName).localeCompare(String(b.taskName), 'en'))) {
        if (!contract.validName(selected.taskName) || !Array.isArray(selected.files) || !selected.files.length) throw new Error('任务名或文件清单无效');
        const task = { taskName: selected.taskName, codeRequirement: contract.normalizeCodeRequirement(selected.codeRequirement),
            dependencyRequirement: contract.normalizeDependencyRequirement(selected.dependencyRequirement), files: [] };
        for (const relative of [...selected.files].sort()) {
            contract.validateCodePath(relative);
            const file = await regularPath(sourceRoot, `${selected.taskName}/${relative}`);
            const stat = await fs.promises.stat(file);
            if (stat.size > contract.MAX_FILE_BYTES || (total += stat.size) > contract.MAX_TOTAL_BYTES || ++count > contract.MAX_FILES) throw new Error('任务代码大小/数量超限');
            const content = await fs.promises.readFile(file);
            if (content.length !== stat.size) throw new Error('任务代码在读取期间发生变化');
            const destination = path.join(stagingRoot, 'tasks', selected.taskName, relative);
            await fs.promises.mkdir(path.dirname(destination), { recursive: true });
            await fs.promises.writeFile(destination, content, { flag: 'wx' });
            task.files.push({ path: relative, size: content.length, sha256: contract.hash(content) });
        }
        task.revision = contract.taskRevision(task); manifest.tasks.push(task);
    }
    manifest.bundleSha256 = contract.bundleHash(manifest);
    contract.validateManifest(manifest);
    const metadata = JSON.stringify(manifest, null, 2) + '\n';
    if (Buffer.byteLength(metadata) > 1024 * 1024) throw new Error('任务包清单超过1MiB上限');
    await fs.promises.writeFile(path.join(stagingRoot, 'task-code-manifest.json'), metadata, { flag: 'wx' });
    return manifest;
}
module.exports = { stageTaskCode, regularPath };
