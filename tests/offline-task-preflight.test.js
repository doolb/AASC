'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { taskRequirements, assertTaskDependencies } = require('../scripts/ops/offline-task-preflight');

test('任务精确依赖在构建前与目标版本和锁指纹比较', async () => {
    const lock = 'a'.repeat(64);
    const selection = { schemaVersion: 1, tasks: [{ taskName: 'demo',
        codeRequirement: { minimumVersion: 1, taskCodeApiVersion: 1 },
        dependencyRequirement: { version: 10, lockSha256: lock } }] };
    const task = await taskRequirements('.', true, null, selection);
    assert.doesNotThrow(() => assertTaskDependencies(task, 10, lock));
    assert.throws(() => assertTaskDependencies(task, 11, lock), /版本 10.*版本 11/u);
    assert.throws(() => assertTaskDependencies(task, 10, 'b'.repeat(64)), /锁指纹/u);
    selection.tasks[0].dependencyRequirement = null;
    assert.doesNotThrow(() => assertTaskDependencies(null, 11, lock));
    assert.doesNotThrow(() => assertTaskDependencies(undefined, 11, lock));
    assert.doesNotThrow(() => assertTaskDependencies({ taskCodeApiVersion: 1 }, 11, lock));
    assert.equal((await taskRequirements('.', true, null, selection)).requiredDependencyVersion, undefined);
    assert.equal(await taskRequirements('.', false, task), task);
});
