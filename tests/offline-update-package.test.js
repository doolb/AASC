'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const {
    canonicalJson,
    createOfflineUpdateArtifacts,
    fetchCurrentManifestFromNetwork,
    parseCliArguments,
    resolveUpdatePlan,
    signManifestPayload,
    verifySignedManifest
} = require('../scripts/ops/offline-update-package');

function createFixture() {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-offline-package-'));
    const outputDir = path.join(projectRoot, 'output');
    const sourceRoot = path.join(projectRoot, 'src');
    fs.mkdirSync(path.join(sourceRoot, 'apps/server/boot'), { recursive: true });
    fs.mkdirSync(path.join(sourceRoot, 'apps/web-mediacenter/ui'), { recursive: true });
    fs.mkdirSync(path.join(sourceRoot, 'apps/android-display'), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, 'apps/server/boot/server-launcher.js'), 'process.exit(0);\n');
    fs.writeFileSync(path.join(sourceRoot, 'apps/web-mediacenter/ui/index.html'), '<main>fixture</main>\n');
    fs.writeFileSync(path.join(sourceRoot, 'apps/android-display/not-server.js'), 'excluded\n');
    fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({
        name: 'fixture',
        version: '1.0.0',
        dependencies: { express: '4.18.2' }
    }, null, 2));
    fs.writeFileSync(path.join(projectRoot, 'package-lock.json'), JSON.stringify({
        name: 'fixture',
        version: '1.0.0',
        lockfileVersion: 3,
        packages: { '': { dependencies: { express: '4.18.2' } } }
    }, null, 2));
    const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privateKeyPem = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    const publicKeyPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' });
    const lockSha256 = sha256(fs.readFileSync(path.join(projectRoot, 'package-lock.json')));
    const currentManifest = {
        payload: {
            schemaVersion: 1,
            generatedAt: '2026-09-01T00:00:00.000Z',
            components: {
                code: {
                    version: 1,
                    requiredDependencyVersion: 1,
                    requiredLockSha256: lockSha256,
                    relativeUrl: 'code/v1.zip',
                    size: 1,
                    sha256: 'a'.repeat(64)
                },
                dependencies: {
                    version: 1,
                    lockSha256,
                    relativeUrl: 'dependencies/v1.zip',
                    size: 1,
                    sha256: 'b'.repeat(64)
                },
                apkMin: {
                    versionCode: 3,
                    versionName: '0.1.2-offline-min',
                    packageName: 'com.aasc.display.offline',
                    signerSha256: 'd'.repeat(64),
                    modelCompatibilitySha256: 'e'.repeat(64),
                    relativeUrl: 'apk/aasc-display-offline-min-v3.apk',
                    size: 2,
                    sha256: 'c'.repeat(64)
                }
            }
        },
        signature: null
    };
    currentManifest.signature = signManifestPayload(currentManifest.payload, privateKeyPem);
    return { projectRoot, outputDir, privateKeyPem, publicKeyPem, currentManifest, lockSha256 };
}

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function archiveEntries(archivePath) {
    return execFileSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' })
        .split(/\r?\n/)
        .filter(Boolean);
}

async function removeFixture(fixture) {
    await fs.promises.rm(fixture.projectRoot, { recursive: true, force: true });
}

test('code-only builds the complete server/UI source archive without invoking npm ci or changing dependencies', async (t) => {
    const fixture = createFixture();
    t.after(() => removeFixture(fixture));
    let commandCount = 0;

    const result = await createOfflineUpdateArtifacts({
        ...fixture,
        mode: 'code-only',
        codeVersion: 2,
        commandRunner: async () => { commandCount += 1; throw new Error('npm ci must not run'); }
    });

    const entries = archiveEntries(result.codeArchivePath);
    assert.equal(commandCount, 0);
    assert.ok(entries.includes('src/apps/server/boot/server-launcher.js'));
    assert.ok(entries.includes('src/apps/web-mediacenter/ui/index.html'));
    assert.ok(entries.includes('package.json'));
    assert.ok(entries.includes('package-lock.json'));
    assert.ok(!entries.some((entry) => entry.startsWith('src/apps/android-display/')));
    assert.ok(!entries.some((entry) => entry.startsWith('node_modules/')));
    assert.equal(result.dependenciesArchivePath, null);
    assert.equal(result.manifest.payload.components.dependencies.version, 1);
    assert.equal(result.manifest.payload.components.apkMin.versionCode, 3);
    assert.equal(result.manifest.payload.components.code.requiredDependencyVersion, 1);
    assert.equal(result.manifest.payload.components.code.requiredLockSha256, fixture.lockSha256);
    assert.equal(verifySignedManifest(result.manifest, fixture.publicKeyPem), true);
});

test('all builds matching source and Android production dependency archives', async (t) => {
    const fixture = createFixture();
    t.after(() => removeFixture(fixture));
    let commandCount = 0;

    const result = await createOfflineUpdateArtifacts({
        ...fixture,
        mode: 'all',
        codeVersion: 2,
        dependencyVersion: 2,
        commandRunner: async (_file, args, options) => {
            commandCount += 1;
            assert.deepEqual(args, ['ci', '--omit=dev', '--ignore-scripts']);
            assert.ok(fs.existsSync(path.join(options.cwd, 'package-lock.json')));
            const expressDir = path.join(options.cwd, 'node_modules/express');
            await fs.promises.mkdir(expressDir, { recursive: true });
            await fs.promises.writeFile(path.join(expressDir, 'index.js'), 'module.exports = {};' );
            await fs.promises.writeFile(path.join(expressDir, 'package.json'), JSON.stringify({ name: 'express' }));
            const shimDir = path.join(options.cwd, 'node_modules/.bin');
            await fs.promises.mkdir(shimDir, { recursive: true });
            await fs.promises.symlink('../express/index.js', path.join(shimDir, 'express'));
        }
    });

    const dependencyEntries = archiveEntries(result.dependenciesArchivePath);
    assert.equal(commandCount, 1);
    assert.ok(dependencyEntries.includes('node_modules/express/index.js'));
    assert.ok(!dependencyEntries.some((entry) => entry.includes('node_modules/.bin/')));
    assert.ok(dependencyEntries.includes('dependency-manifest.json'));
    assert.equal(result.manifest.payload.components.code.requiredDependencyVersion, 2);
    assert.equal(result.manifest.payload.components.dependencies.version, 2);
    assert.equal(result.manifest.payload.components.dependencies.lockSha256, fixture.lockSha256);
    assert.equal(verifySignedManifest(result.manifest, fixture.publicKeyPem), true);
});

test('data-repair builds a signed archive containing only repair.js and preserves the current components', async (t) => {
    const fixture = createFixture();
    t.after(() => removeFixture(fixture));
    const repairFile = path.join(fixture.projectRoot, 'repair.js');
    await fs.promises.writeFile(repairFile, "module.exports = async ({ services }) => services.config.set('server.port', 8082);\n");

    const result = await createOfflineUpdateArtifacts({
        ...fixture,
        mode: 'data-repair',
        dataRepairFile: repairFile,
        repairVersion: 1,
        repairId: 'server-config-1',
        requiredCodeVersion: 1,
        requiredDataVersion: 0,
        targetDataVersion: 1,
        repairCapabilities: ['config']
    });

    assert.deepEqual(archiveEntries(result.dataRepairArchivePath), ['repair.js']);
    assert.equal(result.manifest.payload.components.code.version, 1);
    assert.equal(result.manifest.payload.components.dataRepair.repairId, 'server-config-1');
    assert.equal(result.manifest.payload.components.dataRepair.scriptSha256, sha256(
        fs.readFileSync(repairFile)
    ));
    assert.equal(verifySignedManifest(result.manifest, fixture.publicKeyPem), true);
});

test('all publishes code, dependencies, and manifest when output is on a different filesystem', async (t) => {
    const fixture = createFixture();
    const outputDir = fs.mkdtempSync(path.join(__dirname, '.offline-update-output-'));
    t.after(async () => {
        await removeFixture(fixture);
        await fs.promises.rm(outputDir, { recursive: true, force: true });
    });

    const result = await createOfflineUpdateArtifacts({
        ...fixture,
        outputDir,
        mode: 'all',
        codeVersion: 2,
        dependencyVersion: 2,
        commandRunner: async (_file, _args, options) => {
            const expressDirectory = path.join(options.cwd, 'node_modules/express');
            await fs.promises.mkdir(expressDirectory, { recursive: true });
            await fs.promises.writeFile(path.join(expressDirectory, 'index.js'), 'module.exports = {};');
            await fs.promises.writeFile(path.join(expressDirectory, 'package.json'), JSON.stringify({ name: 'express' }));
        }
    });

    assert.equal(fs.existsSync(result.codeArchivePath), true);
    assert.equal(fs.existsSync(result.dependenciesArchivePath), true);
    assert.equal(fs.existsSync(result.manifestPath), true);
    assert.equal(verifySignedManifest(result.manifest, fixture.publicKeyPem), true);
    assert.equal((await fs.promises.readdir(path.join(outputDir, 'code'))).length, 1);
    assert.equal((await fs.promises.readdir(path.join(outputDir, 'dependencies'))).length, 1);
    assert.equal((await fs.promises.readdir(path.join(outputDir, 'manifests'))).length, 1);
});

test('service update builder reads the configured production key pair when PEM values are not injected', async (t) => {
    const fixture = createFixture();
    t.after(() => removeFixture(fixture));
    const privateKeyPath = path.join(fixture.projectRoot, 'update-private.pem');
    const publicKeyPath = path.join(fixture.projectRoot, 'update-public.pem');
    await fs.promises.writeFile(privateKeyPath, fixture.privateKeyPem, { mode: 0o600 });
    await fs.promises.writeFile(publicKeyPath, fixture.publicKeyPem, { mode: 0o644 });

    const result = await createOfflineUpdateArtifacts({
        ...fixture,
        privateKeyPem: undefined,
        publicKeyPem: undefined,
        privateKeyPath,
        publicKeyPath,
        mode: 'code-only',
        codeVersion: 2
    });

    assert.equal(result.publicKeyPath, publicKeyPath);
    assert.equal(verifySignedManifest(result.manifest, fixture.publicKeyPem), true);
});

test('code-only automatically upgrades to all when the package-lock fingerprint differs', async (t) => {
    const fixture = createFixture();
    t.after(() => removeFixture(fixture));
    fs.appendFileSync(path.join(fixture.projectRoot, 'package-lock.json'), '\n');

    let commandCount = 0;
    const result = await createOfflineUpdateArtifacts({
        ...fixture,
        mode: 'code-only',
        codeVersion: 2,
        commandRunner: async (_file, args, options) => {
            commandCount += 1;
            assert.deepEqual(args, ['ci', '--omit=dev', '--ignore-scripts']);
            const expressDirectory = path.join(options.cwd, 'node_modules/express');
            await fs.promises.mkdir(expressDirectory, { recursive: true });
            await fs.promises.writeFile(path.join(expressDirectory, 'package.json'), JSON.stringify({ name: 'express' }));
        }
    });

    assert.equal(result.requestedMode, 'code-only');
    assert.equal(result.mode, 'all');
    assert.equal(result.autoDependencyUpgrade, true);
    assert.equal(commandCount, 1);
    assert.ok(result.dependenciesArchivePath);
    assert.equal(result.manifest.payload.components.dependencies.version, 2);
    assert.equal(result.manifest.payload.components.dependencies.lockSha256, sha256(fs.readFileSync(path.join(fixture.projectRoot, 'package-lock.json'))));
    assert.equal(result.manifest.payload.components.code.requiredDependencyVersion, 2);
});

test('code-only still rejects an invalid dependency baseline', () => {
    assert.throws(() => resolveUpdatePlan({
        requestedMode: 'code-only',
        currentDependencies: null,
        lockSha256: 'a'.repeat(64)
    }), /有效的已发布 dependencies/);
});

test('automatic dependency version can be explicitly overridden only above the deployed version', () => {
    assert.deepEqual(resolveUpdatePlan({
        requestedMode: 'code-only',
        currentDependencies: { version: 3, lockSha256: 'a'.repeat(64) },
        lockSha256: 'b'.repeat(64),
        dependencyVersion: 5
    }), {
        mode: 'all',
        dependencyVersion: 5,
        autoDependencyUpgrade: true
    });
    assert.throws(() => resolveUpdatePlan({
        requestedMode: 'code-only',
        currentDependencies: { version: 3, lockSha256: 'a'.repeat(64) },
        lockSha256: 'b'.repeat(64),
        dependencyVersion: 3
    }), /dependencyVersion/);
});

test('signature verification rejects any modified manifest payload', (t) => {
    const fixture = createFixture();
    t.after(() => removeFixture(fixture));
    const changed = structuredClone(fixture.currentManifest);
    changed.payload.components.dependencies.version = 99;
    assert.throws(() => verifySignedManifest(changed, fixture.publicKeyPem), /signature|签名/i);
});

test('canonical JSON fixture matches the Android manifest verifier ordering and URL escaping', () => {
    assert.equal(
        canonicalJson({ z: 'https://host/path', a: [3, true, '喵'] }),
        '{"a":[3,true,"喵"],"z":"https://host/path"}'
    );
});

test('package.json exposes the Offline update package builder', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    assert.equal(packageJson.scripts['build:offline-update'], 'node scripts/ops/offline-update-package.js');
    assert.equal(packageJson.scripts['sync:offline-update'], 'node scripts/ops/sync-offline-update.js');
});

test('CLI parser accepts explicit versions and rejects duplicates or unknown options', () => {
    assert.deepEqual(parseCliArguments([
        '--mode=all',
        '--code-version', '4',
        '--dependency-version=2',
        '--output-dir=/tmp/offline-updates'
    ]), {
        mode: 'all',
        codeVersion: 4,
        dependencyVersion: 2,
        outputDir: '/tmp/offline-updates'
    });
    assert.throws(() => parseCliArguments(['--mode=all', '--mode=code-only']), /重复/);
    assert.throws(() => parseCliArguments(['--unknown=x']), /未知/);
    assert.deepEqual(parseCliArguments(['--mode=all', '--bootstrap']), {
        mode: 'all',
        bootstrap: true
    });
    assert.throws(() => parseCliArguments(['--mode=all', '--bootstrap=true']), /不接收值/);
});

test('manifest fetch falls back from an unreachable LAN source to WAN', async () => {
    const calls = [];
    const expected = { payload: { schemaVersion: 1 }, signature: { algorithm: 'SHA256withRSA', value: 'x' } };
    const result = await fetchCurrentManifestFromNetwork({
        baseUrls: ['http://lan.invalid/mnt/aasc-offline/', 'http://wan.invalid/mnt/aasc-offline/'],
        fetchImpl: async (url) => {
            calls.push(String(url));
            if (calls.length === 1) throw new Error('LAN unavailable');
            return { ok: true, status: 200, text: async () => JSON.stringify(expected) };
        }
    });
    assert.deepEqual(calls, [
        'http://lan.invalid/mnt/aasc-offline/manifest.json',
        'http://wan.invalid/mnt/aasc-offline/manifest.json'
    ]);
    assert.deepEqual(result, expected);
});

test('manifest fetch returns null only when both configured sources report not found', async () => {
    let calls = 0;
    const result = await fetchCurrentManifestFromNetwork({
        baseUrls: ['http://lan.invalid/', 'http://wan.invalid/'],
        fetchImpl: async () => {
            calls += 1;
            return { ok: false, status: 404 };
        }
    });
    assert.equal(result, null);
    assert.equal(calls, 2);
});

test('source snapshots reject symbolic links instead of publishing external files', async (t) => {
    const fixture = createFixture();
    t.after(() => removeFixture(fixture));
    const outsideFile = path.join(fixture.projectRoot, 'outside.txt');
    await fs.promises.writeFile(outsideFile, 'not part of source');
    await fs.promises.symlink(outsideFile, path.join(fixture.projectRoot, 'src/apps/server/boot/external.js'));

    await assert.rejects(
        createOfflineUpdateArtifacts({
            ...fixture,
            mode: 'code-only',
            codeVersion: 2
        }),
        /symbolic link|符号链接/i
    );
});
