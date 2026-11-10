'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { parseArguments, findResumeReport, assertPublishOnlyReport, verifyReportFiles } = require('../scripts/ops/release-offline');
const { DEFAULT_LOCAL_ROOT, DEFAULT_LOCAL_VERIFY_URL, DEFAULT_WAN_VERIFY_URL } = require('../scripts/ops/publish-offline-update');

test('仅发布参数独立于构建参数并支持预览', () => {
    assert.equal(parseArguments(['--publish-only', '--dry-run']).publishOnly, true);
    for (const flag of ['--publish', '--new', '--fresh', '--resume', '--only=code']) {
        assert.throws(() => parseArguments(['--publish-only', flag]), /--publish-only/);
    }
});

test('最新构建未完成时不回退旧报告、不创建构建产物', async t => {
    const projectRoot = path.resolve(__dirname, '..');
    const outputDir = await fs.mkdtemp(path.join(projectRoot, 'tmp', 'publish-only-test-'));
    t.after(() => fs.rm(outputDir, { recursive: true, force: true }));
    const directory = path.join(outputDir, 'releases');
    await fs.mkdir(directory);
    const targets = { localRoot: DEFAULT_LOCAL_ROOT, remote: { host: 'as@120.79.245.103', directory: '/home/as/a/aasc-offline' },
        localVerifyUrl: DEFAULT_LOCAL_VERIFY_URL, remoteVerifyUrl: DEFAULT_WAN_VERIFY_URL };
    const report = { schemaVersion: 1, plan: { projectRoot, artifactRoot: outputDir, targets, selected: ['code'] },
        completed: ['code'], files: [{ path: 'example' }], manifestPath: 'example', phase: 'built' };
    const old = path.join(directory, 'release-20261109T000000000Z-1.json');
    const newest = path.join(directory, 'release-20261110T000000000Z-2.json');
    await fs.writeFile(old, JSON.stringify(report));
    const incomplete = { ...report, completed: [], phase: 'building' };
    await fs.writeFile(newest, JSON.stringify(incomplete));
    const selected = await findResumeReport({ outputDir, publishOnly: true }, projectRoot);
    assert.equal(selected, newest);
    assert.throws(() => assertPublishOnlyReport(JSON.parse(require('node:fs').readFileSync(selected))), /不完整|尚未构建成功/);
    const result = spawnSync(process.execPath, ['scripts/ops/release-offline.js', '--publish-only', '--output-dir=' + outputDir],
        { cwd: projectRoot, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /最新构建报告不完整/);
    assert.deepEqual((await fs.readdir(directory)).sort(), [path.basename(old), path.basename(newest)].sort());
    assert.deepEqual(JSON.parse(await fs.readFile(newest, 'utf8')), incomplete);
    assert.deepEqual(await fs.readdir(outputDir), ['releases']);
});

test('仅发布校验文件摘要但允许源码与已有快照不同', async t => {
    const dir = await fs.mkdtemp(path.join(__dirname, '.publish-only-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'code.zip');
    await fs.writeFile(file, '原有产物');
    const content = await fs.readFile(file);
    const report = { schemaVersion: 1, phase: 'built', plan: { projectRoot: dir, selected: ['code'] }, completed: ['code'],
        manifestPath: file, files: [{ path: file, size: content.length, sha256: crypto.createHash('sha256').update(content).digest('hex') }] };
    assert.doesNotThrow(() => assertPublishOnlyReport(report));
    await verifyReportFiles(report, false, true);
    await fs.writeFile(file, '已改产物');
    await assert.rejects(verifyReportFiles(report, false, true), /产物已改变/);
    await fs.unlink(file);
    await assert.rejects(verifyReportFiles(report, false, true), /ENOENT/);
});
