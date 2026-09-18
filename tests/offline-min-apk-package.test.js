'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { signManifestPayload, verifySignedManifest } = require('../scripts/ops/offline-update-package');
const {
    createOfflineMinApkArtifact,
    normalizeReleaseNotes,
    parseCliArguments
} = require('../scripts/ops/offline-min-apk-package');

test('min APK 打包清单绑定 APK 签名、应用版本和完整包模型兼容指纹', async (t) => {
    const projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aasc-offline-min-package-'));
    t.after(() => fs.promises.rm(projectRoot, { recursive: true, force: true }));
    const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privateKeyPem = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    const publicKeyPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' });
    const privateKeyPath = path.join(projectRoot, 'offline-update-private.pem');
    const publicKeyPath = path.join(projectRoot, 'offline-update-public.pem');
    await fs.promises.writeFile(privateKeyPath, privateKeyPem, { mode: 0o600 });
    await fs.promises.writeFile(publicKeyPath, publicKeyPem, { mode: 0o644 });
    const apkPath = path.join(projectRoot, 'aasc-display-offline-min.apk');
    const apkBytes = Buffer.from('signed apk bytes');
    await fs.promises.writeFile(apkPath, apkBytes);
    const buildManifestPath = path.join(projectRoot, 'build-manifest.json');
    await fs.promises.writeFile(buildManifestPath, JSON.stringify({
        profile: 'allserver-min',
        updateOnly: true,
        versionCode: 3,
        versionName: '0.2.1-offline-min',
        apk: path.basename(apkPath),
        sha256: crypto.createHash('sha256').update(apkBytes).digest('hex')
    }));
    const modelCompatibilitySha256 = 'f'.repeat(64);
    const compatibilityPath = path.join(projectRoot, 'offline-model-compatibility.json');
    await fs.promises.writeFile(compatibilityPath, JSON.stringify({
        schemaVersion: 1,
        modelCompatibilitySha256
    }));
    const currentPayload = {
        schemaVersion: 1,
        generatedAt: '2026-09-01T00:00:00.000Z',
        components: {
            code: {
                version: 2,
                requiredDependencyVersion: 1,
                requiredLockSha256: 'a'.repeat(64),
                relativeUrl: 'code/code-v2.zip',
                size: 5,
                sha256: 'b'.repeat(64)
            },
            dependencies: {
                version: 1,
                lockSha256: 'a'.repeat(64),
                relativeUrl: 'dependencies/dependencies-v1.zip',
                size: 6,
                sha256: 'c'.repeat(64)
            }
        }
    };
    const currentManifestPath = path.join(projectRoot, 'current-manifest.json');
    await fs.promises.writeFile(currentManifestPath, JSON.stringify({
        payload: currentPayload,
        signature: signManifestPayload(currentPayload, privateKeyPem)
    }));
    const signerSha256 = 'd'.repeat(64);
    const releaseNotesFile = path.join(projectRoot, 'release-notes.md');
    await fs.promises.writeFile(releaseNotesFile, '\n修复 Offline 显示缩放\n\n- 1920@160dpi 调整为 100%\n');
    const result = await createOfflineMinApkArtifact({
        projectRoot,
        apkPath,
        buildManifestPath,
        modelCompatibilityPath: compatibilityPath,
        currentManifestPath,
        outputDir: path.join(projectRoot, 'output'),
        releaseNotesFile,
        privateKeyPath,
        publicKeyPath,
        commandRunner: async () => ({
            stdout: `Signer #1 certificate SHA-256 digest: ${signerSha256}\n`,
            stderr: ''
        })
    });

    verifySignedManifest(result.manifest, publicKeyPem);
    assert.equal(result.manifest.payload.components.code.version, 2);
    assert.equal(result.manifest.payload.components.dependencies.version, 1);
    assert.equal(result.manifest.payload.components.apkMin.versionCode, 3);
    assert.equal(result.manifest.payload.components.apkMin.packageName, 'com.aasc.display.offline');
    assert.equal(result.manifest.payload.components.apkMin.signerSha256, signerSha256);
    assert.equal(result.manifest.payload.components.apkMin.modelCompatibilitySha256, modelCompatibilitySha256);
    assert.equal(result.manifest.payload.components.apkMin.releaseNotes, '修复 Offline 显示缩放\n\n- 1920@160dpi 调整为 100%');
    assert.equal(await fs.promises.readFile(result.apkPath, 'utf8'), 'signed apk bytes');
});


test('min APK 发布参数支持更新日志文件且限制重复参数', () => {
    assert.deepEqual(parseCliArguments([
        '--manifest-file', 'manifest.json',
        '--release-notes-file', 'release-notes.md'
    ]), {
        manifestFile: 'manifest.json',
        releaseNotesFile: 'release-notes.md'
    });
    assert.throws(
        () => parseCliArguments(['--release-notes-file', 'a.md', '--release-notes-file', 'b.md']),
        /不能重复/u
    );
});

test('发布更新日志会裁剪空白并拒绝超出 Unicode 字符上限的内容', () => {
    assert.equal(normalizeReleaseNotes(' \n\t '), null);
    assert.equal(normalizeReleaseNotes('  修复完成  '), '修复完成');
    assert.throws(
        () => normalizeReleaseNotes('😀'.repeat(4097)),
        /4096/u
    );
});
