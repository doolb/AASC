'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const test = require('node:test');

const {
    publishOfflineUpdate,
    verifyHttpTarget
} = require('../scripts/ops/publish-offline-update');
const {
    signManifestPayload
} = require('../scripts/ops/offline-update-package');

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

async function createFixture(mode) {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aasc-offline-publish-'));
    const artifactRoot = path.join(root, 'artifacts');
    const localRoot = path.join(root, 'published');
    const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privateKeyPem = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    const publicKeyPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' });
    await fs.promises.mkdir(artifactRoot, { recursive: true });

    const codeBytes = Buffer.from('new server source archive');
    const codeVersion = 2;
    const dependencyVersion = mode === 'all' ? 2 : 1;
    const codeRelativeUrl = `code/code-v${codeVersion}.zip`;
    await fs.promises.mkdir(path.dirname(path.join(artifactRoot, codeRelativeUrl)), { recursive: true });
    await fs.promises.writeFile(path.join(artifactRoot, codeRelativeUrl), codeBytes);
    const code = {
        version: codeVersion,
        requiredDependencyVersion: dependencyVersion,
        requiredLockSha256: 'a'.repeat(64),
        relativeUrl: codeRelativeUrl,
        size: codeBytes.length,
        sha256: sha256(codeBytes)
    };
    const deployedDependencyBytes = Buffer.from('deployed old dependencies');
    const dependencies = {
        version: dependencyVersion,
        lockSha256: 'a'.repeat(64),
        relativeUrl: `dependencies/dependencies-v${dependencyVersion}.zip`,
        size: deployedDependencyBytes.length,
        sha256: sha256(deployedDependencyBytes)
    };
    if (mode === 'all') {
        const dependencyBytes = Buffer.from('new node_modules archive');
        dependencies.size = dependencyBytes.length;
        dependencies.sha256 = sha256(dependencyBytes);
        await fs.promises.mkdir(path.dirname(path.join(artifactRoot, dependencies.relativeUrl)), { recursive: true });
        await fs.promises.writeFile(path.join(artifactRoot, dependencies.relativeUrl), dependencyBytes);
    } else {
        await fs.promises.mkdir(path.dirname(path.join(artifactRoot, dependencies.relativeUrl)), { recursive: true });
        await fs.promises.writeFile(path.join(artifactRoot, dependencies.relativeUrl), deployedDependencyBytes);
    }
    let apkMin;
    if (mode === 'apk-min') {
        const apkBytes = Buffer.from('update-only offline APK');
        const relativeUrl = 'apk/aasc-display-offline-min-v3.apk';
        await fs.promises.mkdir(path.dirname(path.join(artifactRoot, relativeUrl)), { recursive: true });
        await fs.promises.writeFile(path.join(artifactRoot, relativeUrl), apkBytes);
        apkMin = {
            versionCode: 3,
            versionName: '0.2.1-offline-min',
            packageName: 'com.aasc.display.offline',
            signerSha256: 'd'.repeat(64),
            modelCompatibilitySha256: 'e'.repeat(64),
            relativeUrl,
            size: apkBytes.length,
            sha256: sha256(apkBytes)
        };
    }
    const payload = {
        schemaVersion: 1,
        generatedAt: '2026-09-16T00:00:00.000Z',
        components: { code, dependencies, ...(apkMin ? { apkMin } : {}) }
    };
    const manifest = {
        payload,
        signature: signManifestPayload(payload, privateKeyPem)
    };
    const manifestPath = path.join(artifactRoot, 'manifest.json');
    await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    return { root, artifactRoot, localRoot, manifestPath, manifest, privateKeyPem, publicKeyPem };
}

test('code-only publishes source and signed manifest without replacing the existing dependency archive', async (t) => {
    const fixture = await createFixture('code-only');
    t.after(() => fs.promises.rm(fixture.root, { recursive: true, force: true }));
    const privateKeyPath = path.join(fixture.root, 'offline-update-private.pem');
    const publicKeyPath = path.join(fixture.root, 'offline-update-public.pem');
    await fs.promises.writeFile(privateKeyPath, fixture.privateKeyPem, { mode: 0o600 });
    await fs.promises.writeFile(publicKeyPath, fixture.publicKeyPem, { mode: 0o644 });
    const existingDependencies = Buffer.from('deployed old dependencies');
    const dependencyPath = path.join(fixture.localRoot, 'dependencies/dependencies-v1.zip');
    await fs.promises.mkdir(path.dirname(dependencyPath), { recursive: true });
    await fs.promises.writeFile(dependencyPath, existingDependencies);

    const result = await publishOfflineUpdate({
        mode: 'code-only',
        artifactRoot: fixture.artifactRoot,
        manifestPath: fixture.manifestPath,
        privateKeyPath,
        publicKeyPath,
        localRoot: fixture.localRoot
    });

    assert.equal((await fs.promises.readFile(dependencyPath)).compare(existingDependencies), 0);
    assert.deepEqual(JSON.parse(await fs.promises.readFile(path.join(fixture.localRoot, 'manifest.json'), 'utf8')),
        JSON.parse(await fs.promises.readFile(fixture.manifestPath, 'utf8')));
    assert.deepEqual(result.publishedRelativePaths, ['code/code-v2.zip', 'manifest.json']);
});

test('all publishes both component archives before exposing its signed manifest', async (t) => {
    const fixture = await createFixture('all');
    t.after(() => fs.promises.rm(fixture.root, { recursive: true, force: true }));

    const result = await publishOfflineUpdate({
        mode: 'all',
        artifactRoot: fixture.artifactRoot,
        manifestPath: fixture.manifestPath,
        publicKeyPem: fixture.publicKeyPem,
        localRoot: fixture.localRoot
    });

    assert.deepEqual(result.publishedRelativePaths, [
        'code/code-v2.zip',
        'dependencies/dependencies-v2.zip',
        'manifest.json'
    ]);
    assert.deepEqual(JSON.parse(await fs.promises.readFile(path.join(fixture.localRoot, 'manifest.json'), 'utf8')),
        JSON.parse(await fs.promises.readFile(fixture.manifestPath, 'utf8')));
});

test('apk-min 发布只上传 min APK，先验证并保留已有代码和依赖组件', async (t) => {
    const fixture = await createFixture('apk-min');
    t.after(() => fs.promises.rm(fixture.root, { recursive: true, force: true }));
    for (const relativeUrl of [
        fixture.manifest.payload.components.code.relativeUrl,
        fixture.manifest.payload.components.dependencies.relativeUrl
    ]) {
        const source = path.join(fixture.artifactRoot, relativeUrl);
        const target = path.join(fixture.localRoot, relativeUrl);
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        await fs.promises.copyFile(source, target);
    }

    const result = await publishOfflineUpdate({
        mode: 'apk-min',
        artifactRoot: fixture.artifactRoot,
        manifestPath: fixture.manifestPath,
        publicKeyPem: fixture.publicKeyPem,
        localRoot: fixture.localRoot
    });

    assert.deepEqual(result.publishedRelativePaths, [
        'apk/aasc-display-offline-min-v3.apk',
        'manifest.json'
    ]);
    assert.equal(fs.existsSync(path.join(fixture.localRoot,
        fixture.manifest.payload.components.code.relativeUrl)), true);
    assert.equal(fs.existsSync(path.join(fixture.localRoot,
        fixture.manifest.payload.components.dependencies.relativeUrl)), true);
});

test('publisher validates signature and every component size/hash before changing a target', async (t) => {
    const fixture = await createFixture('all');
    t.after(() => fs.promises.rm(fixture.root, { recursive: true, force: true }));
    fixture.manifest.payload.components.code.sha256 = 'f'.repeat(64);
    await fs.promises.writeFile(fixture.manifestPath, JSON.stringify(fixture.manifest));

    await assert.rejects(publishOfflineUpdate({
        mode: 'all',
        artifactRoot: fixture.artifactRoot,
        manifestPath: fixture.manifestPath,
        publicKeyPem: fixture.publicKeyPem,
        localRoot: fixture.localRoot
    }), /签名/);
    assert.equal(fs.existsSync(fixture.localRoot), false);
});

test('publisher refuses to follow or overwrite a symlink in the local release directory', async (t) => {
    const fixture = await createFixture('code-only');
    t.after(() => fs.promises.rm(fixture.root, { recursive: true, force: true }));
    await fs.promises.mkdir(fixture.localRoot, { recursive: true });
    await fs.promises.mkdir(path.join(fixture.localRoot, 'code'), { recursive: true });
    const outsidePath = path.join(fixture.root, 'outside.zip');
    await fs.promises.writeFile(outsidePath, 'keep me');
    await fs.promises.symlink(outsidePath, path.join(fixture.localRoot, 'code/code-v2.zip'));
    const dependencyPath = path.join(fixture.localRoot, 'dependencies/dependencies-v1.zip');
    await fs.promises.mkdir(path.dirname(dependencyPath), { recursive: true });
    await fs.promises.writeFile(dependencyPath, 'deployed old dependencies');

    await assert.rejects(publishOfflineUpdate({
        mode: 'code-only',
        artifactRoot: fixture.artifactRoot,
        manifestPath: fixture.manifestPath,
        publicKeyPem: fixture.publicKeyPem,
        localRoot: fixture.localRoot
    }), /symlink|symbolic|符号链接/i);
    assert.equal((await fs.promises.readFile(outsidePath, 'utf8')), 'keep me');
});

test('publisher sends remote versioned packages before atomically switching the remote manifest', async (t) => {
    const fixture = await createFixture('all');
    t.after(() => fs.promises.rm(fixture.root, { recursive: true, force: true }));
    const calls = [];

    await publishOfflineUpdate({
        mode: 'all',
        artifactRoot: fixture.artifactRoot,
        manifestPath: fixture.manifestPath,
        publicKeyPem: fixture.publicKeyPem,
        remote: { host: 'as@120.79.245.103', directory: '~/a/aasc-offline' },
        commandRunner: async (file, args) => {
            calls.push({ file, args });
            return file === 'ssh' ? { stdout: 'MISSING' } : {};
        }
    });

    const scpCalls = calls.filter(({ file }) => file === 'scp');
    const sshCalls = calls.filter(({ file }) => file === 'ssh');
    const manifestUploadIndex = scpCalls.findIndex(({ args }) => String(args.at(-1)).includes('manifest.json.tmp'));
    assert.equal(scpCalls.length, 3);
    assert.ok(sshCalls.length > 0);
    for (const { args } of sshCalls) {
        assert.equal(args[1], '/bin/sh');
        assert.equal(args[2], '-c');
        assert.match(args[3], /^'.*'$/s);
    }
    assert.ok(manifestUploadIndex >= 2, '组件包应先于 manifest 上传');
    assert.equal(calls.at(-1).file, 'ssh');
    assert.match(calls.at(-1).args.at(-1), /manifest\.json\.tmp/);
    assert.match(calls.at(-1).args.at(-1), /chmod 0644/);
    assert.match(calls.at(-1).args.at(-1), /mv/);
});

test('remote publish failure before the final manifest rename leaves the previous channel untouched', async (t) => {
    const fixture = await createFixture('all');
    t.after(() => fs.promises.rm(fixture.root, { recursive: true, force: true }));
    const calls = [];

    await assert.rejects(publishOfflineUpdate({
        mode: 'all',
        artifactRoot: fixture.artifactRoot,
        manifestPath: fixture.manifestPath,
        publicKeyPem: fixture.publicKeyPem,
        remote: { host: 'as@120.79.245.103', directory: '~/a/aasc-offline' },
        commandRunner: async (file, args) => {
            calls.push({ file, args });
            if (file === 'ssh') return { stdout: 'MISSING' };
            if (String(args.at(-1)).includes('dependencies/dependencies-v2.zip.tmp')) {
                throw new Error('simulated SCP failure');
            }
            return {};
        }
    }), /SCP failure/);

    assert.equal(calls.some(({ file, args }) => file === 'scp' && String(args.at(-1)).includes('manifest.json.tmp')), false);
    assert.equal(calls.some(({ file, args }) => file === 'ssh' && String(args.at(-1)).includes('manifest.json')), false);
});

test('code-only remote publication sends only code archive and manifest', async (t) => {
    const fixture = await createFixture('code-only');
    t.after(() => fs.promises.rm(fixture.root, { recursive: true, force: true }));
    const calls = [];

    await publishOfflineUpdate({
        mode: 'code-only',
        artifactRoot: fixture.artifactRoot,
        manifestPath: fixture.manifestPath,
        publicKeyPem: fixture.publicKeyPem,
        remote: { host: 'as@120.79.245.103', directory: '~/a/aasc-offline' },
        commandRunner: async (file, args) => {
            calls.push({ file, args });
            if (file !== 'ssh') return {};
            const command = String(args.at(-1));
            if (command.includes('dependencies/dependencies-v1.zip')) return { stdout: 'EXISTS' };
            return { stdout: 'MISSING' };
        }
    });

    const scpTargets = calls.filter(({ file }) => file === 'scp').map(({ args }) => String(args.at(-1)));
    assert.equal(scpTargets.length, 2);
    assert.ok(scpTargets.some((target) => target.includes('code/code-v2.zip')));
    assert.ok(scpTargets.some((target) => target.includes('manifest.json.tmp')));
    assert.ok(!scpTargets.some((target) => target.includes('dependencies/')));
});

test('HTTP verification checks the signed manifest and streams every component hash', async (t) => {
    const fixture = await createFixture('all');
    t.after(() => fs.promises.rm(fixture.root, { recursive: true, force: true }));
    const calls = [];

    await verifyHttpTarget('http://update.test/channel/', fixture.manifest, fixture.publicKeyPem, async (url) => {
        const requestedUrl = String(url);
        calls.push(requestedUrl);
        if (requestedUrl.endsWith('/manifest.json')) {
            return { ok: true, json: async () => fixture.manifest };
        }
        const relativePath = new URL(requestedUrl).pathname.replace('/channel/', '');
        const bytes = await fs.promises.readFile(path.join(fixture.artifactRoot, relativePath));
        return { ok: true, status: 200, body: Readable.from([bytes]) };
    });

    assert.equal(calls.length, 3);
    assert.ok(calls[0].endsWith('/manifest.json'));
});

test('publisher npm script is registered', async () => {
    const packageJson = JSON.parse(await fs.promises.readFile(path.join(__dirname, '../package.json'), 'utf8'));
    assert.equal(packageJson.scripts['publish:offline-update'], 'node scripts/ops/publish-offline-update.js');
});
