'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { offlineBuildTempRoot } = require('../scripts/ops/offline-build-temp');

test('Offline 构建默认使用项目目录，调用者指定目录优先且不可用时明确报错', async t => {
    const fixture = await fs.mkdtemp(path.join(__dirname, '.offline-build-temp-'));
    t.after(() => fs.rm(fixture, { recursive: true, force: true }));
    const project = path.join(fixture, 'project');
    const fallback = path.join(project, 'tmp', 'offline-build');
    assert.equal(await offlineBuildTempRoot(project, {}, 'linux'), fallback);
    assert.ok((await fs.stat(fallback)).isDirectory());
    const selected = path.join(fixture, 'selected');
    assert.equal(await offlineBuildTempRoot(project, { TMPDIR: selected }, 'linux'), selected);
    const windowsTemp = path.join(fixture, 'windows');
    assert.equal(await offlineBuildTempRoot(project, { TEMP: windowsTemp }, 'win32'), windowsTemp);
    const blocked = path.join(fixture, 'file');
    await fs.writeFile(blocked, '保留');
    await assert.rejects(offlineBuildTempRoot(project, { TMPDIR: blocked }, 'linux'), error =>
        error.message.includes('Offline 构建临时目录不可用') && error.message.includes(blocked));
    assert.equal(await fs.readFile(blocked, 'utf8'), '保留');
});
