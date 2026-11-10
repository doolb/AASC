'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const contract = require('../../src/apps/server/modules/aasc/task-code-contract');

// 构建前读取真实选择清单，避免耗时构建完成后才发现精确依赖不匹配。
async function taskRequirements(projectRoot, selected, currentTask, selection) {
    if (!selected) return currentTask;
    const manifest = selection || JSON.parse(await fs.readFile(path.join(projectRoot, 'release/task-code-files.json'), 'utf8'));
    if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.tasks)) throw new Error('任务选择清单格式无效');
    return contract.aggregateRequirements(manifest.tasks);
}

function assertTaskDependencies(task, version, lockSha256) {
    if (!task || task.requiredDependencyVersion === undefined) return;
    if (task.requiredDependencyVersion !== version || task.requiredLockSha256 !== lockSha256) {
        throw new Error(`任务代码包要求依赖版本 ${task.requiredDependencyVersion}、锁指纹 ${task.requiredLockSha256}；目标为版本 ${version}、锁指纹 ${lockSha256}。请检查 release/task-code-files.json 的兼容声明并选择 task`);
    }
}

module.exports = { taskRequirements, assertTaskDependencies };
