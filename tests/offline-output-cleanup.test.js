'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { signManifestPayload } = require('../scripts/ops/offline-update-package');
const { cleanupOutputArtifacts } = require('../scripts/ops/offline-output-cleanup');

async function fixture(t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-output-cleanup-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const root = path.join(dir, 'output');
    const localRoot = path.join(dir, 'lan');
    await fs.mkdir(path.join(root, 'releases'), { recursive: true });
    await fs.mkdir(localRoot);
    const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' });
    const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
    const lock = 'a'.repeat(64);
    const payload = { schemaVersion: 1, generatedAt: '2026-11-10T00:00:00Z', components: {
        code: { version: 4, requiredDependencyVersion: 15, requiredLockSha256: lock, relativeUrl: 'code/code-v4.zip', size: 1, sha256: 'b'.repeat(64) },
        dependencies: { version: 15, lockSha256: lock, relativeUrl: 'dependencies/dependencies-v10.zip', size: 1, sha256: 'c'.repeat(64) }
    } };
    const manifest = { payload, signature: signManifestPayload(payload, privateKeyPem) };
    await fs.writeFile(path.join(localRoot, 'manifest.json'), JSON.stringify(manifest));
    const report = { plan: { artifactRoot: root, targets: { localRoot, remoteVerifyUrl: 'http://example.test/' } }, files: [] };
    const reportPath = path.join(root, 'releases/release-20261110T000000000Z-1.json');
    const fetchImpl = async url => String(url).endsWith('manifest.json') && !String(url).endsWith('full-apk-manifest.json')
        ? { ok: true, json: async () => manifest } : { status: 404 };
    const put = async (relative, content = 'x') => {
        const file = path.join(root, relative);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, content);
        return file;
    };
    return { dir, root, report, reportPath, manifest, publicKeyPem, fetchImpl, put };
}

test('清理只删除未引用旧包并保护未完成报告、最新包及链接', async t => {
    const f = await fixture(t);
    for (const file of ['code/code-v1.zip', 'code/code-v2.zip', 'code/code-v3.zip', 'code/code-v4.zip', 'code/code-v5.zip',
        'dependencies/dependencies-v9.zip', 'dependencies/dependencies-v10.zip', 'dependencies/dependencies-v11.zip',
        'apk/aasc-display-offline-min-v1.apk', 'apk/aasc-display-offline-min-v2.apk', 'data/data-repair-v1.zip']) await f.put(file);
    await f.put('releases/release-20261109T000000000Z-2.json', JSON.stringify({ schemaVersion: 1, phase: 'building',
        plan: { versions: { code: 2 } }, files: [{ path: path.join(f.root, 'code/code-v3.zip') }] }));
    await fs.symlink(path.join(f.root, 'code/code-v4.zip'), path.join(f.root, 'code/code-v0.zip'));
    const result = await cleanupOutputArtifacts(f.report, f.reportPath, f.manifest, f.publicKeyPem, { fetchImpl: f.fetchImpl });
    assert.deepEqual(result.removed.sort(), ['apk/aasc-display-offline-min-v1.apk', 'code/code-v1.zip', 'dependencies/dependencies-v9.zip']);
    for (const file of ['code/code-v0.zip', 'code/code-v2.zip', 'code/code-v3.zip', 'code/code-v4.zip', 'code/code-v5.zip',
        'dependencies/dependencies-v10.zip', 'dependencies/dependencies-v11.zip', 'data/data-repair-v1.zip']) await fs.lstat(path.join(f.root, file));
});

test('清单或未完成报告不安全时不删除任何包', async t => {
    const f = await fixture(t);
    await f.put('code/code-v1.zip');
    await f.put('code/code-v4.zip');
    await assert.rejects(cleanupOutputArtifacts(f.report, f.reportPath, f.manifest, f.publicKeyPem,
        { fetchImpl: async () => { throw new Error('offline'); } }), /无法确认发布清单/);
    await f.put('releases/release-20261109T000000000Z-2.json', '{');
    await assert.rejects(cleanupOutputArtifacts(f.report, f.reportPath, f.manifest, f.publicKeyPem, { fetchImpl: f.fetchImpl }));
    await fs.access(path.join(f.root, 'code/code-v1.zip'));
});
